"""
Endpoint amministrativi per Syntesis-ICP.

Gestione dei registrati e del flusso di autorizzazione:
- GET  /admin/users               elenco registrati con metriche
- POST /admin/users/{id}/authorize  genera la chiave di licenza e attiva l'utente
- POST /admin/users/{id}/revoke     revoca l'autorizzazione (utente torna pending)

Tutti gli endpoint sono protetti da require_admin: accessibili solo agli utenti
con role == 'admin'. Il primo admin va impostato a mano sul database una volta sola.
"""

import io
import os
import re
import csv
import json
import hashlib
import zipfile
import posixpath
import unicodedata
import xml.etree.ElementTree as ET
from typing import Optional

import asyncpg
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from auth import verify_token

router = APIRouter()

# Replace-iT (Passo 1): cap sulla dimensione dello ZIP di libreria caricato.
# Il file passa per la RAM del worker (lo materializziamo per parsare lo zip),
# quindi un cap evita che un admin OOMmi il worker con un file enorme. 200MB e'
# molto > qualunque libreria Exocad reale (la ZIM-TSV-35 di riferimento e' ~10MB).
RIT_MAX_ZIP_BYTES = int(os.getenv("RIT_MAX_ZIP_BYTES", str(200 * 1024 * 1024)))


async def require_admin(current_user: dict = Depends(verify_token)) -> dict:
    """Consente l'accesso solo agli amministratori."""
    if current_user.get("role") != "admin":
        raise HTTPException(403, detail="Accesso riservato agli amministratori.")
    return current_user


@router.get("/users")
async def admin_list_users(admin: dict = Depends(require_admin)):
    """Elenco di tutti gli utenti registrati con stato, contatti e metriche d'uso."""
    from database import list_all_users
    users = await list_all_users()
    # serializza i timestamp in ISO per il frontend
    for u in users:
        for k in ("created_at", "last_login"):
            if u.get(k) is not None:
                try:
                    u[k] = u[k].isoformat()
                except AttributeError:
                    pass
    return {"users": users}


@router.post("/users/{user_id}/authorize")
async def admin_authorize(user_id: str, admin: dict = Depends(require_admin)):
    """Autorizza un utente: genera la chiave SICP, la associa e attiva l'account.
    Ritorna la chiave generata (verrà mostrata all'utente nel suo pannello)."""
    from database import authorize_user
    key = await authorize_user(user_id)
    if key is None:
        raise HTTPException(404, detail="Utente non trovato.")
    return {"user_id": user_id, "license_key": key}


@router.post("/users/{user_id}/revoke")
async def admin_revoke(user_id: str, admin: dict = Depends(require_admin)):
    """Revoca l'autorizzazione: disattiva la licenza e riporta l'utente in attesa."""
    from database import revoke_user
    ok = await revoke_user(user_id)
    if not ok:
        raise HTTPException(404, detail="Utente non trovato.")
    return {"user_id": user_id, "revoked": True}


# =====================================================================
# Replace-iT (Passo 1) — ingest librerie scanbody Exocad
# Modello dati + ingest. NON tocca il runtime di Sostituisci ne' l'analisi.
# Tutto dietro require_admin. Schema/scrittura in database.py (rit_*).
# =====================================================================

class RitIngestError(Exception):
    """Errore di parsing/validazione dello ZIP libreria (-> 400, niente import)."""


def _rit_text(node, tag):
    """Testo di un figlio diretto <tag> (strip); None se assente/vuoto."""
    if node is None:
        return None
    child = node.find(tag)
    if child is None or child.text is None:
        return None
    t = child.text.strip()
    return t or None


def _rit_float(node, tag):
    t = _rit_text(node, tag)
    if t is None:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _rit_int(node, tag):
    t = _rit_text(node, tag)
    if t is None:
        return None
    try:
        return int(float(t))
    except ValueError:
        return None


def _rit_vec(node, tag):
    """Legge un sotto-nodo <tag><x/><y/><z/> come tripla di float (None se assente)."""
    sub = node.find(tag) if node is not None else None
    if sub is None:
        return (None, None, None)
    return (_rit_float(sub, "x"), _rit_float(sub, "y"), _rit_float(sub, "z"))


def _rit_is_eng(display, keyword):
    """ENG vs Non-ENG dal display/keyword del TYPE. 'Non-ENG'/'NENG' battono
    'ENG_' (la sottostringa 'ENG_' compare anche dentro 'Non-ENG_')."""
    s = ((display or "") + " " + (keyword or "")).upper()
    if "NON-ENG" in s or "NENG" in s:
        return False
    return "ENG_" in s


def _rit_parse_zip(zip_bytes: bytes) -> dict:
    """Parsa uno ZIP di libreria Exocad. Salta __MACOSX/ e i resource-fork
    '._*'; ignora subtype, .sdfa e firme RSA. Valida che OGNI MarkerFilename
    referenziato esista come STL nello ZIP: se ne manca uno -> RitIngestError
    (l'endpoint rifiuta TUTTO, niente import parziale)."""
    try:
        z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        raise RitIngestError("Il file caricato non e' uno ZIP valido.")

    # basename(lower) -> entry name, escludendo __MACOSX e i resource-fork ._*
    basemap = {}
    cfg_entry = None
    for name in z.namelist():
        if name.startswith("__MACOSX") or "/__MACOSX/" in name:
            continue
        base = posixpath.basename(name)
        if not base or base.startswith("._"):
            continue
        basemap.setdefault(base.lower(), name)
        if base.lower() == "config.xml":
            cfg_entry = name

    if cfg_entry is None:
        raise RitIngestError("config.xml non trovato nello ZIP.")

    try:
        root = ET.fromstring(z.read(cfg_entry))
    except ET.ParseError as e:
        raise RitIngestError(f"config.xml non valido: {e}")

    if root.tag != "ImplantLibraryEntry":
        raise RitIngestError(f"Root XML inatteso: <{root.tag}> (atteso ImplantLibraryEntry).")

    keyword = _rit_text(root, "Keyword")
    connection = root.find("ImplantConnection")
    conn_id = _rit_text(connection, "ID") if connection is not None else None

    def _read_image(tag):
        fn = _rit_text(root, tag)
        if not fn:
            return None
        ent = basemap.get(posixpath.basename(fn).lower())
        return z.read(ent) if ent else None

    parsed = {
        "keyword": keyword,
        "display": _rit_text(root, "DisplayInformation"),
        "connection_id": conn_id,
        "rotation_lock_count": _rit_int(root, "RotationLockCount"),
        "ref_rotation_offset": _rit_float(root, "ReferenceRotationOffset"),
        "axis_occlusal": _rit_vec(root, "AxisOcclusal"),
        "supplier": _rit_text(root, "Supplier"),
        "supplier_version": _rit_text(root, "SupplierVersion"),
        "preview_png": _read_image("PreviewV4IconFilename"),
        "logo_png": _read_image("SupplierV4IconFilename"),
        "markers": {},   # sha256 -> {content, filename, size}
        "types": [],
        "default_import_name": (keyword or posixpath.splitext(posixpath.basename(cfg_entry))[0] or "libreria"),
    }

    type_config = root.find("TypeConfig")
    types = type_config.findall("ImplantTypeConfig") if type_config is not None else []
    if not types:
        raise RitIngestError("Nessun ImplantTypeConfig nello ZIP.")

    missing = []
    for i, t in enumerate(types):
        marker_fn = _rit_text(t, "MarkerFilename")
        display = _rit_text(t, "DisplayInformation")
        kw = _rit_text(t, "Keyword")
        if not marker_fn:
            missing.append(f"[type #{i}: MarkerFilename assente]")
            continue
        ent = basemap.get(posixpath.basename(marker_fn).lower())
        if ent is None:
            missing.append(marker_fn)
            continue
        content = z.read(ent)
        sha = hashlib.sha256(content).hexdigest()
        if sha not in parsed["markers"]:
            parsed["markers"][sha] = {
                "content": content,
                "filename": posixpath.basename(ent),
                "size": len(content),
            }
        parsed["types"].append({
            "display": display,
            "keyword": kw,
            "marker_filename": marker_fn,
            "marker_sha256": sha,
            "click_center": _rit_vec(t, "RegistrationClickCenter"),
            "axis_asymmetric": _rit_vec(t, "AxisAsymmetric"),
            "is_eng": _rit_is_eng(display, kw),
            "ord": i,
        })

    if missing:
        raise RitIngestError(
            "STL marker mancanti nello ZIP (import rifiutato): " + ", ".join(missing)
        )

    return parsed


# =====================================================================
# Replace-iT v8.50.0 — librerie da CSV/editor + archivio STL condiviso
# Schema CSV (separatore , o ; — header obbligatorio):
#   marca,modello,diametro,asse_occlusale,ruolo,file,nome,eng
# Obbligatorie: marca, modello, diametro, ruolo (madre|figlio), file.
# Ogni (marca,modello,diametro) -> UNA rit_library; gli STL passano tutti
# dall'archivio rit_stl_asset ("cartella unica", link live-per-nome).
# =====================================================================

RIT_CSV_REQUIRED = ("marca", "modello", "diametro", "ruolo", "file")


def _rit_slug(s) -> str:
    """Slug ascii per import_name/keyword: 'Megagen AnyRidge Ø4.0' -> 'megagen-anyridge-4.0'."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9.]+", "-", s).strip("-.").lower()
    return s or "libreria"


def _rit_parse_axis(s, where: str):
    """'0,0,1' (o ; o spazi) -> tripla float. La virgola e' SOLO separatore;
    i decimali usano il punto ('0,0.5,1'). Default (0,0,1) se vuoto."""
    if s is None or not str(s).strip():
        return (0.0, 0.0, 1.0)
    parts = [p for p in re.split(r"[;,\s]+", str(s).strip()) if p]
    if len(parts) != 3:
        raise RitIngestError(f"{where}: asse_occlusale '{s}' non valido (attesi 3 numeri, es. 0,0,1).")
    try:
        v = tuple(float(p) for p in parts)
    except ValueError:
        raise RitIngestError(f"{where}: asse_occlusale '{s}' non numerico.")
    if v == (0.0, 0.0, 0.0):
        raise RitIngestError(f"{where}: asse_occlusale nullo (0,0,0).")
    return v


def _rit_parse_eng_flag(s, where: str):
    """'si'/'no'/vuoto -> True/False/None (tag UI ENG/Non-ENG, non geometrico)."""
    v = str(s or "").strip().lower()
    if v in ("si", "sì", "s", "yes", "y", "true", "1", "eng"):
        return True
    if v in ("no", "n", "false", "0", "non-eng", "neng"):
        return False
    if v == "":
        return None
    raise RitIngestError(f"{where}: eng '{s}' non valido (si|no|vuoto).")


def _rit_read_csv_rows(text: str) -> list[dict]:
    """libreria.csv -> righe normalizzate (chiavi lower/strip). Separatore
    auto (',' o ';' — Excel italiano usa ';'). Righe vuote scartate."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise RitIngestError("libreria.csv vuoto.")
    delim = ";" if lines[0].count(";") > lines[0].count(",") else ","
    rdr = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delim)
    header = [str(h or "").strip().lower() for h in (rdr.fieldnames or [])]
    miss = [c for c in RIT_CSV_REQUIRED if c not in header]
    if miss:
        raise RitIngestError("libreria.csv: colonne obbligatorie mancanti nell'header: "
                             + ", ".join(miss) + ".")
    rows = []
    for raw in rdr:
        row = {}
        for k, v in raw.items():
            if k is None:
                continue
            row[str(k).strip().lower()] = str(v or "").strip()
        if any(row.values()):
            rows.append(row)
    if not rows:
        raise RitIngestError("libreria.csv: nessuna riga dati.")
    return rows


def _rit_zip_read(z: zipfile.ZipFile, entry: str) -> bytes:
    """z.read con cap sulla dimensione DECOMPRESSA dichiarata (anti zip-bomb:
    il cap RIT_MAX_ZIP_BYTES sull'upload vale solo sui byte compressi)."""
    info = z.getinfo(entry)
    if info.file_size > RIT_MAX_ZIP_BYTES:
        raise RitIngestError(
            f"'{posixpath.basename(entry)}': dimensione decompressa "
            f"({info.file_size // (1024*1024)} MB) oltre il limite "
            f"({RIT_MAX_ZIP_BYTES // (1024*1024)} MB).")
    return z.read(entry)


def _rit_csv_from_zip(zip_bytes: bytes):
    """ZIP manuale (libreria.csv + STL). Ritorna (rows, name->bytes) oppure
    None se lo ZIP non contiene libreria.csv (-> path Exocad). Errore se
    contiene SIA config.xml SIA libreria.csv (ambiguo), o se un file
    referenziato esiste in piu' cartelle con contenuti DIVERSI."""
    try:
        z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        return None
    basemap, dupes, csv_entry, cfg_entry = {}, {}, None, None
    for name in z.namelist():
        if name.startswith("__MACOSX") or "/__MACOSX/" in name:
            continue
        base = posixpath.basename(name)
        if not base or base.startswith("._"):
            continue
        k = base.lower()
        if k in basemap and basemap[k] != name:
            dupes.setdefault(k, []).append(name)
        basemap.setdefault(k, name)
        if k == "libreria.csv":
            csv_entry = name
        elif k == "config.xml":
            cfg_entry = name
    if csv_entry is None:
        return None
    if cfg_entry is not None:
        raise RitIngestError("ZIP ambiguo: contiene sia config.xml sia libreria.csv.")
    text = _rit_zip_read(z, csv_entry).decode("utf-8-sig", errors="replace")
    rows = _rit_read_csv_rows(text)
    name_to_bytes = {}
    for r in rows:
        fn = posixpath.basename(r.get("file") or "")
        if not fn:
            continue
        ent = basemap.get(fn.lower())
        if ent is not None and fn not in name_to_bytes:
            data = _rit_zip_read(z, ent)
            for alt in dupes.get(fn.lower(), ()):
                if _rit_zip_read(z, alt) != data:
                    raise RitIngestError(
                        f"ZIP ambiguo: piu' file '{fn}' con contenuti diversi "
                        f"({ent} vs {alt}). Tieni una sola versione.")
            name_to_bytes[fn] = data
    return rows, name_to_bytes


def _rit_build_libraries_from_rows(rows: list[dict], name_to_sha: dict,
                                   source: str) -> list[dict]:
    """Righe validate -> lista di parsed dict (uno per marca+modello+diametro),
    compatibili con rit_import_library. name_to_sha: nome asset -> sha256
    (gia' risolto, archivio o upload). Ogni libreria: >=1 madre e >=1 figlio.
    Numerazione errori: CSV parte da 2 (riga 1 = header), editor da 1
    (allineata alla griglia e a edReadRows lato client)."""
    groups, order = {}, []
    for i, row in enumerate(rows, start=(2 if source == "csv" else 1)):
        where = f"Riga {i}"
        miss = [c for c in RIT_CSV_REQUIRED if not (row.get(c) or "").strip()]
        if miss:
            raise RitIngestError(f"{where}: campi obbligatori mancanti: {', '.join(miss)}.")
        ruolo = row["ruolo"].strip().lower()
        if ruolo not in ("madre", "figlio"):
            raise RitIngestError(f"{where}: ruolo '{row['ruolo']}' non valido (madre|figlio).")
        fname = posixpath.basename(row["file"].strip())
        if fname not in name_to_sha:
            raise RitIngestError(f"{where}: file '{fname}' non trovato (ne' caricato ne' in archivio).")
        marca, modello, diam = row["marca"].strip(), row["modello"].strip(), row["diametro"].strip()
        key = (marca.lower(), modello.lower(), diam.lower())
        if key not in groups:
            groups[key] = {"marca": marca, "modello": modello, "diametro": diam,
                           "axis": None, "types": []}
            order.append(key)
        g = groups[key]
        label = f"{marca} {modello} Ø{diam}"
        if (row.get("asse_occlusale") or "").strip():
            ax = _rit_parse_axis(row["asse_occlusale"], where)
            if g["axis"] is not None and ax != g["axis"]:
                raise RitIngestError(f"{where}: asse_occlusale in conflitto con quello gia' dato per {label}.")
            g["axis"] = ax
        nome = (row.get("nome") or "").strip() or f"{ruolo.capitalize()} {fname}"
        g["types"].append({
            "display": nome,
            "keyword": None,
            "marker_filename": fname,
            "marker_sha256": name_to_sha[fname],
            "click_center": (None, None, None),
            "axis_asymmetric": (None, None, None),
            "is_eng": _rit_parse_eng_flag(row.get("eng"), where),
            "role": ruolo,
            "ord": len(g["types"]),
        })
    libs, seen_slugs = [], {}
    for key in order:
        g = groups[key]
        label = f"{g['marca']} {g['modello']} Ø{g['diametro']}"
        if not any(t["role"] == "madre" for t in g["types"]):
            raise RitIngestError(f"{label}: nessun file madre (serve almeno 1).")
        if not any(t["role"] == "figlio" for t in g["types"]):
            raise RitIngestError(f"{label}: nessun file figlio (serve almeno 1).")
        slug = _rit_slug(f"{g['marca']}-{g['modello']}-{g['diametro']}")
        # gruppi DIVERSI possono collassare sullo stesso slug (accenti/punteggiatura
        # rimossi dalla normalizzazione ascii): senza questo check la seconda
        # libreria sovrascriverebbe silenziosamente la prima nello stesso batch
        if slug in seen_slugs:
            raise RitIngestError(
                f"{label}: identificativo '{slug}' in conflitto con "
                f"{seen_slugs[slug]} (marca/modello/diametro diversi che producono "
                f"lo stesso nome). Rinomina uno dei due.")
        seen_slugs[slug] = label
        libs.append({
            "keyword": slug,
            "display": label,
            "connection_id": None,
            "rotation_lock_count": None,
            "ref_rotation_offset": None,
            "axis_occlusal": g["axis"] or (0.0, 0.0, 1.0),
            "supplier": g["marca"],
            "supplier_version": None,
            "preview_png": None,
            "logo_png": None,
            "markers": {},
            "types": g["types"],
            "source": source,
            "default_import_name": slug,
        })
    return libs


async def _rit_check_lock_code(code: Optional[str]) -> None:
    """Verifica il codice di sicurezza del lucchetto contro l'hash in DB.
    Il gating sta QUI, lato server: il client raccoglie il codice e basta."""
    from database import rit_get_lock_secret
    from auth import verify_password
    sec = await rit_get_lock_secret()
    if sec is None:
        raise HTTPException(400, detail="Nessun codice di sicurezza impostato. Impostalo dal pannello.")
    if not code or not verify_password(code, sec["code_hash"], sec["code_salt"]):
        raise HTTPException(403, detail="Codice di sicurezza errato.")


def _rit_json_list(s: Optional[str], what: str) -> Optional[list]:
    """Form-field JSON '["a","b"]' -> list. None se assente ('' = lista vuota = deciso)."""
    if s is None:
        return None
    s = s.strip()
    if not s:
        return []
    try:
        v = json.loads(s)
    except ValueError:
        raise HTTPException(400, detail=f"{what}: JSON non valido.")
    if not isinstance(v, list):
        raise HTTPException(400, detail=f"{what}: attesa una lista JSON.")
    return [str(x) for x in v]


async def _rit_resolve_files(referenced: list, content_of: dict, *,
                             stl_overwrite: Optional[list]) -> dict:
    """Risolve nomi-file verso l'ARCHIVIO unico (cartella). FASE PURA: nessuna
    scrittura. Usato da TUTTE le porte (Exocad/CSV/editor).
    - referenced: lista di basename univoci.
    - content_of: basename -> bytes | None (None = deve gia' stare in archivio).
    - stl_overwrite: None = nessuna decisione presa ancora; lista = i nomi da
      SOVRASCRIVERE (gli altri in conflitto -> si usa la versione in archivio).
    Ritorna {name_to_sha, conflicts, writes:[(name,content,overwrite)],
    locked_overwrites:[name]}. Un nome gia' presente con contenuto IDENTICO e'
    il figlio condiviso (riuso, nessuna scrittura)."""
    from database import rit_get_stl_asset
    name_to_sha, writes, conflicts, locked_ow = {}, [], [], []
    for fn in referenced:
        content = content_of.get(fn)
        asset = await rit_get_stl_asset(fn)
        if content is None and asset is None:
            raise RitIngestError(f"File '{fn}' non caricato e non presente in archivio.")
        if content is None:
            name_to_sha[fn] = asset["sha256"]
            continue
        sha = hashlib.sha256(content).hexdigest()
        if asset is None:
            name_to_sha[fn] = sha
            writes.append((fn, content, False))
        elif asset["sha256"] == sha:
            name_to_sha[fn] = sha            # figlio condiviso gia' in archivio
        elif stl_overwrite is None:
            conflicts.append({"name": fn, "locked": bool(asset["locked"])})
        elif fn in stl_overwrite:
            name_to_sha[fn] = sha
            writes.append((fn, content, True))
            if asset["locked"]:
                locked_ow.append(fn)
        else:
            name_to_sha[fn] = asset["sha256"]  # deciso: salta, usa l'archivio
    return {"name_to_sha": name_to_sha, "conflicts": conflicts,
            "writes": writes, "locked_overwrites": locked_ow}


async def _rit_write_resolved(resolved: dict, *, code: Optional[str],
                              uploaded_by: Optional[str]):
    """Esegue le scritture risolte (FASE 2). Se ci sono overwrite di asset
    BLOCCATI, verifica il codice (server-side) PRIMA di scrivere. Ritorna
    (created, overwritten)."""
    from database import rit_get_stl_asset, rit_save_stl_asset
    code_ok = False
    if resolved["locked_overwrites"]:
        still = [fn for fn in resolved["locked_overwrites"]
                 if ((await rit_get_stl_asset(fn)) or {}).get("locked")]
        if still:
            await _rit_check_lock_code(code)
            code_ok = True
    created, overwritten = [], []
    for fn, content, ow in resolved["writes"]:
        res = await rit_save_stl_asset(name=fn, content=content,
                                       uploaded_by=uploaded_by, overwrite=ow,
                                       allow_locked=code_ok)
        if res["status"] == "created":
            created.append(fn)
        elif res["status"] == "overwritten":
            overwritten.append(fn)
        elif res["status"] == "locked":
            raise RitIngestError(
                f"'{fn}' e' stato bloccato nel frattempo: riprova (serve il codice).")
        elif res["status"] == "conflict":
            raise RitIngestError(f"Conflitto concorrente sul file '{fn}': riprova.")
    return created, overwritten


async def _rit_ingest_rows(*, rows: list[dict], new_files: dict,
                           stl_overwrite: Optional[list],
                           lib_overwrite: bool, code: Optional[str],
                           uploaded_by: Optional[str], source: str):
    """Cuore condiviso CSV/editor. Fase 1 SENZA scritture: risolve ogni nome
    file verso l'archivio unico e ogni libreria (nuova / esistente). Se servono
    decisioni -> 409 confirm_needed. Fase 2: scrive asset (propagazione
    live-per-nome) e librerie (upsert per import_name)."""
    from database import rit_find_library_by_import_name, rit_import_library

    norm_files = {posixpath.basename(k): v for k, v in new_files.items()}
    referenced = []
    for r in rows:
        fn = posixpath.basename((r.get("file") or "").strip())
        if fn and fn not in referenced:
            referenced.append(fn)
    if not referenced:
        raise RitIngestError("Nessun file STL referenziato nelle righe.")

    # — fase 1a: risolvi i nomi verso l'archivio (pura) —
    content_of = {fn: norm_files.get(fn) for fn in referenced}
    resolved = await _rit_resolve_files(referenced, content_of, stl_overwrite=stl_overwrite)

    # — fase 1b: valida e costruisci le librerie (pura) —
    libs = _rit_build_libraries_from_rows(rows, resolved["name_to_sha"], source)

    existing = []
    for lib in libs:
        ex = await rit_find_library_by_import_name(lib["default_import_name"])
        if ex is not None:
            existing.append(ex)

    if resolved["conflicts"] or (existing and not lib_overwrite):
        return JSONResponse(status_code=409, content={
            "status": "confirm_needed",
            "stl_conflicts": resolved["conflicts"],
            "existing_libraries": existing,
            "libraries_planned": [{"import_name": l["default_import_name"],
                                   "display": l["display"],
                                   "n_types": len(l["types"])} for l in libs],
        })

    # — fase 2: scritture (asset, poi librerie) —
    written = {w[0] for w in resolved["writes"]}
    stl_created, stl_overwritten = await _rit_write_resolved(
        resolved, code=code, uploaded_by=uploaded_by)
    stl_unchanged = [fn for fn in referenced
                     if norm_files.get(fn) is not None and fn not in written]

    out_libs = []
    for lib in libs:
        ex = await rit_find_library_by_import_name(lib["default_import_name"])
        try:
            lib_id = await rit_import_library(
                parsed=lib, import_name=lib["default_import_name"],
                uploaded_by=uploaded_by,
                overwrite_target_id=(ex["id"] if ex else None),
                preserve_active=True)
        except (asyncpg.UniqueViolationError, asyncpg.ForeignKeyViolationError):
            # import concorrente / STL sovrascritto in parallelo: la singola
            # libreria fa rollback (transazione propria); rifiuta pulito,
            # gli asset gia' scritti restano e il retry converge
            raise RitIngestError(
                f"Conflitto concorrente sulla libreria "
                f"'{lib['default_import_name']}': riprova.")
        out_libs.append({"library_id": lib_id,
                         "import_name": lib["default_import_name"],
                         "display": lib["display"],
                         "n_types": len(lib["types"]),
                         "action": "updated" if ex else "created",
                         "active": bool(ex["active"]) if ex else False})

    return {"status": "ok", "kind": "rows",
            "libraries": out_libs,
            "stl_created": stl_created,
            "stl_overwritten": stl_overwritten,
            "stl_unchanged": stl_unchanged}


@router.post("/rit/libraries")
async def rit_ingest_library(
    file: Optional[UploadFile] = File(None),
    import_name: Optional[str] = Form(None),
    mode: Optional[str] = Form(None),                 # None | "overwrite" | "new"
    target_library_id: Optional[int] = Form(None),
    rows: Optional[str] = Form(None),                 # editor in-pannello: righe JSON
    stl_files: Optional[list[UploadFile]] = File(None),  # editor: STL nuovi
    stl_overwrite: Optional[str] = Form(None),        # JSON [nomi] da sovrascrivere (presenza = deciso)
    lib_overwrite: Optional[str] = Form(None),        # "1" = sovrascrivi librerie esistenti
    code: Optional[str] = Form(None),                 # codice lucchetto (overwrite di asset bloccati)
    admin: dict = Depends(require_admin),
):
    """Ingest librerie Replace-iT — TRE porte, stesso modello dati:
    1) ZIP Exocad (config.xml): path storico, INVARIATO.
    2) ZIP manuale (libreria.csv + STL): righe CSV -> una libreria per
       marca+modello+diametro; gli STL entrano nell'archivio (cartella unica).
    3) Editor in-pannello: form 'rows' (JSON) + 'stl_files' (upload).
    Per 2 e 3: conflitti nome-file/libreria -> 409 confirm_needed (il client
    rilancia con stl_overwrite/lib_overwrite/code)."""
    from database import (
        rit_find_libraries_by_keyword, rit_find_library_by_import_name,
        rit_import_library,
    )

    # ── porta 3: editor in-pannello (rows JSON + upload multipli) ──
    if rows is not None:
        try:
            rows_list = json.loads(rows)
        except ValueError:
            raise HTTPException(400, detail="rows: JSON non valido.")
        if not isinstance(rows_list, list) or not rows_list:
            raise HTTPException(400, detail="rows: attesa una lista di righe non vuota.")
        norm_rows = []
        for r in rows_list:
            if not isinstance(r, dict):
                raise HTTPException(400, detail="rows: ogni riga deve essere un oggetto.")
            norm_rows.append({str(k).strip().lower(): str(v or "").strip()
                              for k, v in r.items()})
        new_files = {}
        total = 0
        for uf in (stl_files or []):
            # cap PRIMA della read (uf.size dichiarato) per non materializzare
            # in RAM un upload enorme; il check post-read resta come fallback
            if total + (uf.size or 0) > RIT_MAX_ZIP_BYTES:
                raise HTTPException(400, detail=f"Upload troppo grande (max {RIT_MAX_ZIP_BYTES // (1024*1024)} MB totali).")
            content = await uf.read()
            total += len(content)
            if total > RIT_MAX_ZIP_BYTES:
                raise HTTPException(400, detail=f"Upload troppo grande (max {RIT_MAX_ZIP_BYTES // (1024*1024)} MB totali).")
            fn = posixpath.basename(uf.filename or "")
            if not fn.lower().endswith(".stl"):
                raise HTTPException(400, detail=f"'{fn}': solo file .stl.")
            if fn in new_files and new_files[fn] != content:
                raise HTTPException(400, detail=f"'{fn}': caricato due volte con contenuti diversi.")
            new_files[fn] = content
        try:
            return await _rit_ingest_rows(
                rows=norm_rows, new_files=new_files,
                stl_overwrite=_rit_json_list(stl_overwrite, "stl_overwrite"),
                lib_overwrite=(lib_overwrite == "1"), code=code,
                uploaded_by=admin.get("email"), source="editor")
        except RitIngestError as e:
            raise HTTPException(400, detail=str(e))

    if file is None:
        raise HTTPException(400, detail="Nessun file ZIP e nessuna riga editor.")
    raw = await file.read()
    if len(raw) > RIT_MAX_ZIP_BYTES:
        raise HTTPException(400, detail=f"ZIP troppo grande (max {RIT_MAX_ZIP_BYTES // (1024*1024)} MB).")

    # ── porta 2: ZIP manuale con libreria.csv ──
    try:
        csv_pack = _rit_csv_from_zip(raw)
    except RitIngestError as e:
        raise HTTPException(400, detail=str(e))
    if csv_pack is not None:
        csv_rows, name_to_bytes = csv_pack
        try:
            return await _rit_ingest_rows(
                rows=csv_rows, new_files=name_to_bytes,
                stl_overwrite=_rit_json_list(stl_overwrite, "stl_overwrite"),
                lib_overwrite=(lib_overwrite == "1"), code=code,
                uploaded_by=admin.get("email"), source="csv")
        except RitIngestError as e:
            raise HTTPException(400, detail=str(e))

    # ── porta 1: ZIP Exocad (config.xml) — ora passa dall'ARCHIVIO unico ──
    try:
        parsed = _rit_parse_zip(raw)
    except RitIngestError as e:
        raise HTTPException(400, detail=str(e))

    # Archivio unico: risolvo i marker della libreria verso la cartella, come
    # CSV/editor. I figli condivisi (0T3/1T3/...) gia' presenti si riusano; un
    # nome presente con contenuto DIVERSO -> 409 stl_conflict (overwrite/skip).
    # NIENTE scritture finche' non sono decisi SIA gli STL SIA il keyword.
    content_of = {}
    for t in parsed["types"]:
        nm = posixpath.basename(t["marker_filename"] or "")
        if not nm:
            continue
        c = parsed["markers"][t["marker_sha256"]]["content"]
        if nm in content_of and content_of[nm] != c:
            raise HTTPException(400, detail=f"ZIP: due marker chiamati '{nm}' con contenuti diversi.")
        content_of[nm] = c
    referenced = list(content_of.keys())
    try:
        resolved = await _rit_resolve_files(
            referenced, content_of,
            stl_overwrite=_rit_json_list(stl_overwrite, "stl_overwrite"))
    except RitIngestError as e:
        raise HTTPException(400, detail=str(e))
    if resolved["conflicts"]:
        return JSONResponse(status_code=409, content={
            "status": "stl_conflict", "conflicts": resolved["conflicts"]})

    # keyword handling (gate libreria) — ancora nessuna scrittura
    keyword = parsed["keyword"]
    existing = await rit_find_libraries_by_keyword(keyword) if keyword else []

    overwrite_id = None
    chosen_import = (import_name or "").strip() or None

    if mode is None:
        if existing:
            return JSONResponse(status_code=409, content={
                "status": "keyword_conflict",
                "keyword": keyword,
                "existing": existing,
                "parsed": {
                    "display": parsed["display"],
                    "supplier": parsed["supplier"],
                    "supplier_version": parsed["supplier_version"],
                    "n_types": len(parsed["types"]),
                    "n_markers": len(parsed["markers"]),
                },
            })
        # nessun conflitto: import fresco (default = keyword)
    elif mode == "overwrite":
        if not target_library_id:
            raise HTTPException(400, detail="target_library_id richiesto per overwrite.")
        overwrite_id = target_library_id
    elif mode == "new":
        if not chosen_import:
            raise HTTPException(400, detail="import_name richiesto per importare come nuova libreria.")
        # pre-check PRIMA di scrivere in archivio: un import_name gia' preso
        # non deve far partire le scritture (overwrite live-per-nome + sweep)
        if await rit_find_library_by_import_name(chosen_import) is not None:
            return JSONResponse(status_code=409, content={
                "status": "import_name_taken",
                "import_name": chosen_import,
            })
    else:
        raise HTTPException(400, detail=f"mode non valido: {mode!r}")

    # entrambi i gate decisi -> scrivo gli asset nell'archivio, rimappo i type a
    # basename + sha risolto (skip -> usa la versione in archivio) e importo la
    # libreria (i contenuti sono gia' in archivio -> markers svuotato).
    try:
        stl_created, stl_overwritten = await _rit_write_resolved(
            resolved, code=code, uploaded_by=admin.get("email"))
    except RitIngestError as e:
        raise HTTPException(400, detail=str(e))
    for t in parsed["types"]:
        nm = posixpath.basename(t["marker_filename"] or "")
        if nm:
            t["marker_filename"] = nm
            t["marker_sha256"] = resolved["name_to_sha"][nm]
    parsed["markers"] = {}

    try:
        lib_id = await rit_import_library(
            parsed=parsed,
            import_name=chosen_import,
            uploaded_by=admin.get("email"),
            overwrite_target_id=overwrite_id,
        )
    except asyncpg.UniqueViolationError:
        return JSONResponse(status_code=409, content={
            "status": "import_name_taken",
            "import_name": chosen_import,
        })

    return {
        "status": "ok",
        "library_id": lib_id,
        "import_name": chosen_import or parsed["default_import_name"],
        "n_types": len(parsed["types"]),
        "n_markers": len(referenced),
        "stl_created": stl_created,
        "stl_overwritten": stl_overwritten,
        "active": False,
    }


@router.get("/rit/libraries")
async def rit_list_libraries_endpoint(admin: dict = Depends(require_admin)):
    """Elenco librerie con conteggio type (tabella in /gestione)."""
    from database import rit_list_libraries
    return {"libraries": await rit_list_libraries()}


@router.get("/rit/libraries/{library_id}")
async def rit_library_detail_endpoint(library_id: int, admin: dict = Depends(require_admin)):
    """Dettaglio read-only: root-params + type con tutti i parametri."""
    from database import rit_get_library_detail
    detail = await rit_get_library_detail(library_id)
    if detail is None:
        raise HTTPException(404, detail="Libreria non trovata.")
    return detail


@router.get("/rit/libraries/{library_id}/preview")
async def rit_library_preview_endpoint(library_id: int, admin: dict = Depends(require_admin)):
    """Serve preview_png (PNG) della libreria. 404 se assente."""
    from database import rit_get_library_image
    png = await rit_get_library_image(library_id, "preview")
    if png is None:
        raise HTTPException(404, detail="Anteprima non disponibile.")
    return Response(content=png, media_type="image/png")


@router.get("/rit/libraries/{library_id}/logo")
async def rit_library_logo_endpoint(library_id: int, admin: dict = Depends(require_admin)):
    """Serve logo_png (PNG) del fornitore. 404 se assente."""
    from database import rit_get_library_image
    png = await rit_get_library_image(library_id, "logo")
    if png is None:
        raise HTTPException(404, detail="Logo non disponibile.")
    return Response(content=png, media_type="image/png")


class RitActiveBody(BaseModel):
    active: bool


@router.patch("/rit/libraries/{library_id}/active")
async def rit_set_active_endpoint(library_id: int, body: RitActiveBody,
                                  admin: dict = Depends(require_admin)):
    """Attiva/disattiva una libreria (l'utente la attiva dopo la verifica)."""
    from database import rit_set_library_active
    ok = await rit_set_library_active(library_id, body.active)
    if not ok:
        raise HTTPException(404, detail="Libreria non trovata.")
    return {"library_id": library_id, "active": body.active}


# =====================================================================
# Replace-iT v8.50.0 — archivio STL (cartella unica) + lucchetto
# =====================================================================

@router.get("/rit/stl")
async def rit_stl_list_endpoint(admin: dict = Depends(require_admin)):
    """Archivio STL per nome (con used_by = n. librerie CSV/editor collegate)."""
    from database import rit_list_stl_assets
    return {"assets": await rit_list_stl_assets()}


@router.post("/rit/stl")
async def rit_stl_upload_endpoint(
    files: list[UploadFile] = File(...),
    stl_overwrite: Optional[str] = Form(None),   # JSON [nomi] (presenza = deciso)
    code: Optional[str] = Form(None),
    admin: dict = Depends(require_admin),
):
    """Upload diretto in archivio. Collisione per NOME con contenuto diverso:
    senza decisione -> 409 stl_conflict; con stl_overwrite, i nomi elencati
    vengono sovrascritti (propagazione live-per-nome) e gli altri saltati.
    Sovrascrivere un file bloccato richiede il codice (verifica server-side)."""
    from database import rit_get_stl_asset, rit_save_stl_asset
    decided = _rit_json_list(stl_overwrite, "stl_overwrite")

    items, total = [], 0
    for uf in files:
        # cap PRIMA della read (uf.size dichiarato), check post-read come fallback
        if total + (uf.size or 0) > RIT_MAX_ZIP_BYTES:
            raise HTTPException(400, detail=f"Upload troppo grande (max {RIT_MAX_ZIP_BYTES // (1024*1024)} MB totali).")
        content = await uf.read()
        total += len(content)
        if total > RIT_MAX_ZIP_BYTES:
            raise HTTPException(400, detail=f"Upload troppo grande (max {RIT_MAX_ZIP_BYTES // (1024*1024)} MB totali).")
        fn = posixpath.basename(uf.filename or "")
        if not fn.lower().endswith(".stl"):
            raise HTTPException(400, detail=f"'{fn}': solo file .stl.")
        # stesso nome, contenuto diverso nella STESSA richiesta -> rifiuto
        # esplicito (come le porte CSV/editor), non un 409 fuorviante in fase 2
        for prev_fn, prev_content in items:
            if prev_fn == fn and prev_content != content:
                raise HTTPException(400, detail=f"'{fn}': caricato due volte con contenuti diversi.")
        items.append((fn, content))
    if not items:
        raise HTTPException(400, detail="Nessun file.")

    # fase 1: rileva conflitti senza scrivere
    code_ok = False
    conflicts, plans = [], []   # plans: (name, content, overwrite|None=skip)
    for fn, content in items:
        asset = await rit_get_stl_asset(fn)
        sha = hashlib.sha256(content).hexdigest()
        if asset is None or asset["sha256"] == sha:
            plans.append((fn, content, False))
            continue
        if decided is None:
            conflicts.append({"name": fn, "locked": bool(asset["locked"])})
        elif fn in decided:
            if asset["locked"] and not code_ok:
                await _rit_check_lock_code(code)
                code_ok = True
            plans.append((fn, content, True))
        else:
            plans.append((fn, None, None))   # deciso: non caricare il duplicato
    if conflicts:
        return JSONResponse(status_code=409, content={
            "status": "stl_conflict", "conflicts": conflicts})

    created, overwritten, unchanged, skipped = [], [], [], []
    for fn, content, ow in plans:
        if content is None:
            skipped.append(fn)
            continue
        res = await rit_save_stl_asset(name=fn, content=content,
                                       uploaded_by=admin.get("email"),
                                       overwrite=ow, allow_locked=code_ok)
        if res["status"] == "created":
            created.append(fn)
        elif res["status"] == "overwritten":
            overwritten.append(fn)
        elif res["status"] == "unchanged":
            unchanged.append(fn)
        elif res["status"] == "locked":
            raise HTTPException(409, detail=f"'{fn}' e' stato bloccato nel frattempo: serve il codice.")
        else:   # conflict concorrente tra fase 1 e fase 2
            raise HTTPException(409, detail=f"Conflitto concorrente sul file '{fn}': riprova.")

    return {"status": "ok", "created": created, "overwritten": overwritten,
            "unchanged": unchanged, "skipped": skipped}


@router.get("/rit/stl/{name}/content")
async def rit_stl_content_endpoint(name: str, admin: dict = Depends(require_admin)):
    """Bytes STL di un asset per NOME (per l'anteprima 3D nel pannello)."""
    from database import rit_get_stl_asset, rit_get_marker_bytes
    asset = await rit_get_stl_asset(name)
    if asset is None:
        raise HTTPException(404, detail="File non trovato in archivio.")
    data = await rit_get_marker_bytes(asset["sha256"])
    if data is None:
        raise HTTPException(404, detail="Contenuto non trovato.")
    return Response(content=data, media_type="application/octet-stream",
                    headers={"ETag": asset["sha256"]})


@router.post("/rit/stl/{name}/lock")
async def rit_stl_lock_endpoint(name: str, admin: dict = Depends(require_admin)):
    """Blocca un file (lucchetto). Il blocco e' libero; lo SBLOCCO chiede il codice."""
    from database import rit_set_stl_asset_locked
    if not await rit_set_stl_asset_locked(name, True):
        raise HTTPException(404, detail="File non trovato in archivio.")
    return {"name": name, "locked": True}


class RitUnlockBody(BaseModel):
    code: str


@router.post("/rit/stl/{name}/unlock")
async def rit_stl_unlock_endpoint(name: str, body: RitUnlockBody,
                                  admin: dict = Depends(require_admin)):
    """Sblocca un file: richiede il codice di sicurezza (verifica server-side)."""
    from database import rit_set_stl_asset_locked
    await _rit_check_lock_code(body.code)
    if not await rit_set_stl_asset_locked(name, False):
        raise HTTPException(404, detail="File non trovato in archivio.")
    return {"name": name, "locked": False}


@router.delete("/rit/stl/{name}")
async def rit_stl_delete_endpoint(name: str, admin: dict = Depends(require_admin)):
    """Cancella un file dall'archivio. Rifiuta se bloccato (sbloccare prima)
    o se ancora usato da librerie CSV/editor."""
    from database import rit_delete_stl_asset
    res = await rit_delete_stl_asset(name)
    if res["status"] == "not_found":
        raise HTTPException(404, detail="File non trovato in archivio.")
    if res["status"] == "locked":
        raise HTTPException(409, detail="File bloccato dal lucchetto: sbloccalo prima con il codice.")
    if res["status"] == "in_use":
        raise HTTPException(409, detail=f"File usato da {res['used_by']} librerie: rimuovile o sostituisci il file.")
    return {"name": name, "deleted": True}


@router.get("/rit/lock-code")
async def rit_lock_code_status_endpoint(admin: dict = Depends(require_admin)):
    """Stato del codice di sicurezza (solo SE e' impostato, mai il valore)."""
    from database import rit_get_lock_secret
    return {"is_set": (await rit_get_lock_secret()) is not None}


class RitLockCodeBody(BaseModel):
    code_new: str
    code_current: Optional[str] = None


@router.post("/rit/lock-code")
async def rit_lock_code_set_endpoint(body: RitLockCodeBody,
                                     admin: dict = Depends(require_admin)):
    """Imposta/cambia il codice del lucchetto. Se gia' impostato richiede
    quello attuale. Salvato SOLO hashed (pbkdf2 via auth.hash_password)."""
    from database import rit_get_lock_secret, rit_set_lock_secret
    from auth import hash_password
    new = (body.code_new or "").strip()
    if len(new) < 4:
        raise HTTPException(400, detail="Codice troppo corto (minimo 4 caratteri).")
    if await rit_get_lock_secret() is not None:
        await _rit_check_lock_code(body.code_current)
    h, salt = hash_password(new)
    await rit_set_lock_secret(h, salt, admin.get("email"))
    return {"is_set": True}
