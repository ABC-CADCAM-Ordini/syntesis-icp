"""
Syntesis-ICP - Google Drive integration
v7.3.9.048

OAuth 2.0 flow + Drive API helpers.

Architettura privacy-first:
- Scope: drive.file (vede SOLO file creati dall'app, non l'intero Drive)
- Refresh token cifrati con Fernet (chiave derivata da JWT_SECRET via SHA-256)
- Stato OAuth firmato con JWT temporaneo (no session storage)
- Cartella radice "Syntesis-ICP" creata in My Drive dell'utente al primo upload
- Sottocartelle per progetto

Flusso OAuth:
1. Frontend chiama GET /auth/gdrive/connect
   -> backend genera state JWT (user_id + nonce, exp 15 min)
   -> ritorna URL Google authorize con state nel parametro
2. Utente autorizza su Google -> Google redirect a /auth/gdrive/callback?code=...&state=...
3. Callback verifica state JWT, scambia code per (access_token, refresh_token)
   -> cifra refresh_token con Fernet
   -> salva (gdrive_email, gdrive_refresh_token_enc, gdrive_connected_at) in users
   -> redirect a /dashboard?tab=cloud&connected=1
4. Endpoint successivi: get_drive_service(user_id) recupera refresh_token, lo decifra,
   ottiene access_token fresco, restituisce un service Drive autenticato

Sicurezza:
- Mai loggare il client_secret o i token
- L'utente puo' revocare l'accesso da Google in qualsiasi momento
  (in tal caso le chiamate falliscono con 401, l'app mostra "non connesso")
- /auth/gdrive/disconnect rimuove i token dal nostro DB
  (rimane revocato anche da Google se l'utente lo fa manualmente da
   https://myaccount.google.com/permissions)
"""

import os
import io
import base64
import hashlib
import logging
from typing import Optional

import jwt
from cryptography.fernet import Fernet
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaFileUpload
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

# ── Configurazione ────────────────────────────────────────────────────────────
SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'https://www.googleapis.com/auth/userinfo.email']
GDRIVE_ROOT_FOLDER_NAME = 'Syntesis-ICP'
STATE_TOKEN_EXP_SECONDS = 15 * 60  # 15 minuti per completare OAuth

CLIENT_ID = os.getenv('GOOGLE_OAUTH_CLIENT_ID', '')
CLIENT_SECRET = os.getenv('GOOGLE_OAUTH_CLIENT_SECRET', '')
REDIRECT_URI = os.getenv('GOOGLE_OAUTH_REDIRECT_URI',
                          'https://syntesis-icp-production.up.railway.app/auth/gdrive/callback')
JWT_SECRET = os.getenv('JWT_SECRET', '')


def is_configured() -> bool:
    """True se tutte le env vars OAuth sono presenti."""
    return bool(CLIENT_ID and CLIENT_SECRET and JWT_SECRET)


# ── Cifratura refresh token (Fernet derivata da JWT_SECRET) ──────────────────
def _get_fernet() -> Fernet:
    """Chiave Fernet derivata da JWT_SECRET via SHA-256 + base64.
    Usare lo stesso secret di JWT garantisce che se compromesso JWT_SECRET
    sono compromessi anche i token Drive (un solo secret da proteggere)."""
    if not JWT_SECRET:
        raise RuntimeError('JWT_SECRET non configurato')
    digest = hashlib.sha256(JWT_SECRET.encode('utf-8')).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_token(token: str) -> str:
    """Cifra un refresh token per il salvataggio in DB."""
    if not token:
        return ''
    return _get_fernet().encrypt(token.encode('utf-8')).decode('utf-8')


def decrypt_token(encrypted: str) -> str:
    """Decifra un refresh token recuperato dal DB."""
    if not encrypted:
        return ''
    return _get_fernet().decrypt(encrypted.encode('utf-8')).decode('utf-8')


# ── State JWT per CSRF protection durante OAuth ──────────────────────────────
def make_state_token(user_id: str) -> str:
    """Token firmato che lega user_id all'OAuth callback. Scade in 15 min."""
    import time
    payload = {
        'user_id': user_id,
        'purpose': 'gdrive_oauth',
        'iat': int(time.time()),
        'exp': int(time.time()) + STATE_TOKEN_EXP_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def verify_state_token(token: str) -> Optional[str]:
    """Verifica state JWT, ritorna user_id se valido, None altrimenti."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        if payload.get('purpose') != 'gdrive_oauth':
            return None
        return payload.get('user_id')
    except jwt.PyJWTError as e:
        logger.warning(f'state token invalid: {e}')
        return None


# ── OAuth flow ────────────────────────────────────────────────────────────────
def _make_flow() -> Flow:
    """Costruisce un oggetto Flow Google OAuth con i config correnti."""
    if not is_configured():
        raise RuntimeError('Google OAuth non configurato (env vars mancanti)')
    client_config = {
        "web": {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [REDIRECT_URI],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=SCOPES)
    flow.redirect_uri = REDIRECT_URI
    return flow


def get_authorization_url(user_id: str) -> str:
    """Genera URL Google per l'utente. include state JWT firmato."""
    flow = _make_flow()
    state = make_state_token(user_id)
    auth_url, _ = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        prompt='consent',  # forza Google a ridare il refresh_token anche se gia' concesso
        state=state,
    )
    return auth_url


def exchange_code_for_tokens(code: str) -> dict:
    """Scambia il code OAuth per access_token + refresh_token + email utente.
    Ritorna dict: { 'refresh_token': str, 'email': str }
    Se Google non restituisce un refresh_token (puo' succedere se l'utente
    ha gia' concesso e non abbiamo forzato prompt=consent), solleva eccezione."""
    flow = _make_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials
    if not creds.refresh_token:
        raise RuntimeError(
            'Google non ha restituito refresh_token. '
            'L\'utente deve revocare l\'accesso e riprovare: '
            'https://myaccount.google.com/permissions'
        )
    # Recupera email dell'utente Google
    email = ''
    try:
        oauth2_service = build('oauth2', 'v2', credentials=creds, cache_discovery=False)
        info = oauth2_service.userinfo().get().execute()
        email = info.get('email', '')
    except Exception as e:
        logger.warning(f'Failed to fetch user email: {e}')
    return {
        'refresh_token': creds.refresh_token,
        'email': email,
    }


def build_credentials_from_refresh_token(refresh_token: str) -> Credentials:
    """Costruisce un oggetto Credentials da un refresh token.
    L'access_token verra' rigenerato automaticamente al primo uso."""
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=SCOPES,
    )


def get_drive_service(refresh_token: str):
    """Ritorna un service Drive API autenticato per l'utente.
    Solleva HttpError 401/403 se il token e' stato revocato."""
    creds = build_credentials_from_refresh_token(refresh_token)
    return build('drive', 'v3', credentials=creds, cache_discovery=False)


# ── Drive operations ──────────────────────────────────────────────────────────
def find_or_create_folder(service, name: str, parent_id: Optional[str] = None) -> str:
    """Cerca una folder per nome (e parent), la crea se non esiste.
    Ritorna l'ID Drive della folder."""
    # Search query: drive.file vede solo file CHE LUI ha creato
    q_parts = [
        f"name = '{name.replace(chr(39), chr(92)+chr(39))}'",
        "mimeType = 'application/vnd.google-apps.folder'",
        "trashed = false",
    ]
    if parent_id:
        q_parts.append(f"'{parent_id}' in parents")
    q = ' and '.join(q_parts)

    try:
        results = service.files().list(
            q=q, spaces='drive',
            fields='files(id, name, parents)',
            pageSize=10
        ).execute()
        items = results.get('files', [])
        if items:
            return items[0]['id']
    except HttpError as e:
        logger.error(f'find folder failed: {e}')
        raise

    # Crea
    metadata = {
        'name': name,
        'mimeType': 'application/vnd.google-apps.folder',
    }
    if parent_id:
        metadata['parents'] = [parent_id]
    folder = service.files().create(body=metadata, fields='id').execute()
    return folder['id']


def get_or_create_root_folder(service) -> str:
    """Folder radice 'Syntesis-ICP' in My Drive."""
    return find_or_create_folder(service, GDRIVE_ROOT_FOLDER_NAME, parent_id=None)


def get_or_create_project_folder(service, project_name: str,
                                    project_id: str) -> str:
    """Sottocartella progetto: 'Syntesis-ICP / <project_name> [<short_id>]'.
    Lo short_id evita conflitti se 2 progetti hanno lo stesso nome."""
    root_id = get_or_create_root_folder(service)
    folder_label = f"{project_name} [{project_id[:8]}]"
    return find_or_create_folder(service, folder_label, parent_id=root_id)


def upload_bytes(service, parent_folder_id: str, filename: str,
                  data: bytes, mime_type: str = 'application/octet-stream') -> dict:
    """Carica bytes come file Drive.
    Ritorna { 'id': str, 'name': str, 'webViewLink': str }."""
    metadata = {'name': filename, 'parents': [parent_folder_id]}
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime_type, resumable=False)
    f = service.files().create(
        body=metadata, media_body=media,
        fields='id, name, webViewLink, size, createdTime'
    ).execute()
    return f


def list_folder(service, folder_id: str) -> list[dict]:
    """Elenca i file dentro una folder.
    Ritorna lista di { id, name, mimeType, size, webViewLink, createdTime }."""
    results = service.files().list(
        q=f"'{folder_id}' in parents and trashed = false",
        fields='files(id, name, mimeType, size, webViewLink, createdTime)',
        pageSize=100,
        orderBy='createdTime desc',
    ).execute()
    return results.get('files', [])


def delete_drive_file(service, file_id: str) -> bool:
    """Sposta un file nel cestino Drive (soft delete)."""
    try:
        service.files().update(fileId=file_id, body={'trashed': True}).execute()
        return True
    except HttpError as e:
        logger.error(f'delete drive file failed: {e}')
        return False



# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.056 - File browser Drive
# Funzioni di navigazione delle cartelle e file (browse + breadcrumb).
# ─────────────────────────────────────────────────────────────────────────────

def browse_folder(refresh_token: str, folder_id: Optional[str] = None) -> dict:
    """Lista contenuti di una cartella Drive (subfolders + files con dettagli).
    Se folder_id e' None, usa la root Syntesis-ICP (la crea se non esiste).
    Ritorna dict con folder_id, folder_name, parent_id, items[].
    items[] separa subfolders e files per facilitare il rendering."""
    service = get_drive_service(refresh_token)

    if folder_id is None:
        folder_id = find_or_create_folder(service, GDRIVE_ROOT_FOLDER_NAME, parent_id=None)
        folder_name = GDRIVE_ROOT_FOLDER_NAME
        parent_id = None
    else:
        # Verifica che folder_id sia accessibile (creato dall'app, scope drive.file)
        try:
            meta = service.files().get(
                fileId=folder_id,
                fields="id,name,mimeType,parents",
                supportsAllDrives=False
            ).execute()
            if meta.get("mimeType") != "application/vnd.google-apps.folder":
                raise ValueError("L'ID indicato non e' una cartella.")
            folder_name = meta.get("name", "")
            parents = meta.get("parents", [])
            parent_id = parents[0] if parents else None
        except Exception as e:
            raise ValueError(f"Cartella non accessibile: {e}")

    # Lista contenuti (solo non eliminati)
    query = f"'{folder_id}' in parents and trashed = false"
    page_token = None
    subfolders = []
    files = []
    MAX = 1000
    fetched = 0
    while True:
        resp = service.files().list(
            q=query,
            fields="nextPageToken, files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,iconLink,thumbnailLink)",
            pageSize=200,
            pageToken=page_token,
            orderBy="folder,name"
        ).execute()
        for f in resp.get("files", []):
            entry = {
                "id":            f.get("id"),
                "name":          f.get("name"),
                "mimeType":      f.get("mimeType"),
                "size":          int(f.get("size", 0)) if f.get("size") else None,
                "modified_time": f.get("modifiedTime"),
                "created_time":  f.get("createdTime"),
                "web_view_link": f.get("webViewLink"),
                "icon_link":     f.get("iconLink"),
                "thumbnail":     f.get("thumbnailLink"),
            }
            if f.get("mimeType") == "application/vnd.google-apps.folder":
                subfolders.append(entry)
            else:
                files.append(entry)
            fetched += 1
            if fetched >= MAX:
                break
        page_token = resp.get("nextPageToken")
        if not page_token or fetched >= MAX:
            break

    return {
        "folder_id":    folder_id,
        "folder_name":  folder_name,
        "parent_id":    parent_id,
        "subfolders":   subfolders,
        "files":        files,
        "n_subfolders": len(subfolders),
        "n_files":      len(files),
        "truncated":    fetched >= MAX,
    }


def get_folder_breadcrumb(refresh_token: str, folder_id: str) -> list[dict]:
    """Ritorna la catena di cartelle da root Syntesis-ICP fino a folder_id incluso.
    Lista di {id, name}, ordinata dalla root al target.
    Si ferma quando trova il folder con nome GDRIVE_ROOT_FOLDER_NAME (la nostra root)
    oppure quando non riesce a salire oltre (cartella fuori dallo scope drive.file)."""
    service = get_drive_service(refresh_token)
    chain = []
    visited = set()
    current_id = folder_id
    MAX_HOPS = 20
    hops = 0
    while current_id and hops < MAX_HOPS and current_id not in visited:
        visited.add(current_id)
        try:
            meta = service.files().get(
                fileId=current_id,
                fields="id,name,parents,mimeType"
            ).execute()
        except Exception:
            break
        chain.insert(0, {"id": meta.get("id"), "name": meta.get("name")})
        if meta.get("name") == GDRIVE_ROOT_FOLDER_NAME:
            break
        parents = meta.get("parents", [])
        current_id = parents[0] if parents else None
        hops += 1
    return chain


def get_drive_web_url(folder_id: Optional[str] = None) -> str:
    """Ritorna URL drive.google.com per aprire una cartella nel browser."""
    if folder_id:
        return f"https://drive.google.com/drive/folders/{folder_id}"
    return "https://drive.google.com/drive/my-drive"


# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.062 - Funzioni per cartelle condivise
# ─────────────────────────────────────────────────────────────────────────────

def create_folder_in(refresh_token: str, name: str, parent_id: Optional[str] = None) -> dict:
    """Crea una cartella nel Drive dell'utente. Se parent_id e' None, la crea
    dentro Syntesis-ICP (root). Ritorna {id, name}."""
    service = get_drive_service(refresh_token)
    if parent_id is None:
        parent_id = find_or_create_folder(service, GDRIVE_ROOT_FOLDER_NAME, parent_id=None)
    folder_id = find_or_create_folder(service, name, parent_id=parent_id)
    return {"id": folder_id, "name": name, "parent_id": parent_id}


def download_file_bytes(refresh_token: str, file_id: str) -> tuple[bytes, str, str]:
    """Scarica i bytes di un file da Drive. Ritorna (data, name, mime_type).
    Per replica server-mediata: il file passa per la RAM del server, non viene salvato su disco."""
    service = get_drive_service(refresh_token)
    meta = service.files().get(fileId=file_id, fields="id,name,mimeType,size").execute()
    name = meta.get("name", "file")
    mime_type = meta.get("mimeType", "application/octet-stream")
    # Streaming download
    from googleapiclient.http import MediaIoBaseDownload
    import io
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request, chunksize=2*1024*1024)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue(), name, mime_type


def list_files_recursive(refresh_token: str, folder_id: str, max_files: int = 200) -> list[dict]:
    """Lista TUTTI i file (no folders) dentro una cartella, ricorsivamente.
    Usato dall'accept per replicare i file esistenti nel Drive del nuovo membro.
    Ritorna list di {id, name, mime_type, size, parent_id, relative_path}."""
    service = get_drive_service(refresh_token)
    results = []
    # BFS: queue di (folder_id, relative_path)
    queue = [(folder_id, "")]
    visited_folders = set()
    while queue and len(results) < max_files:
        current_folder, rel = queue.pop(0)
        if current_folder in visited_folders:
            continue
        visited_folders.add(current_folder)
        page_token = None
        while True:
            resp = service.files().list(
                q=f"'{current_folder}' in parents and trashed = false",
                fields="nextPageToken, files(id,name,mimeType,size,parents)",
                pageSize=100,
                pageToken=page_token,
            ).execute()
            for f in resp.get("files", []):
                if f.get("mimeType") == "application/vnd.google-apps.folder":
                    sub_rel = (rel + "/" + f["name"]) if rel else f["name"]
                    queue.append((f["id"], sub_rel))
                else:
                    results.append({
                        "id":          f.get("id"),
                        "name":        f.get("name"),
                        "mime_type":   f.get("mimeType"),
                        "size":        int(f.get("size", 0)) if f.get("size") else 0,
                        "parent_id":   current_folder,
                        "relative_path": rel,
                    })
                    if len(results) >= max_files:
                        return results
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    return results


def upload_file_to_folder(refresh_token: str, folder_id: str, filename: str,
                            data: bytes, mime_type: str = "application/octet-stream") -> dict:
    """Wrapper di upload_bytes che usa direttamente il refresh_token."""
    service = get_drive_service(refresh_token)
    file_id = upload_bytes(service, folder_id, filename, data, mime_type)
    return {"id": file_id, "name": filename}


def ensure_subfolder_path(refresh_token: str, root_folder_id: str, relative_path: str) -> str:
    """Naviga il percorso relativo (es. "subA/subB"), creando le cartelle mancanti.
    Ritorna l'ID della cartella terminale. Usato per replica preservando struttura."""
    if not relative_path or relative_path == "":
        return root_folder_id
    service = get_drive_service(refresh_token)
    parent = root_folder_id
    parts = [p for p in relative_path.split("/") if p]
    for part in parts:
        parent = find_or_create_folder(service, part, parent_id=parent)
    return parent
