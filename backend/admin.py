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
import hashlib
import zipfile
import posixpath
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


@router.post("/rit/libraries")
async def rit_ingest_library(
    file: UploadFile = File(...),
    import_name: Optional[str] = Form(None),
    mode: Optional[str] = Form(None),                 # None | "overwrite" | "new"
    target_library_id: Optional[int] = Form(None),
    admin: dict = Depends(require_admin),
):
    """Carica una libreria Exocad (ZIP). Parsa, valida (ogni MarkerFilename
    deve esistere come STL), scrive in transazione unica. active=FALSE.
    Conflitto keyword senza mode -> 409 keyword_conflict con existing[]."""
    from database import (
        rit_find_libraries_by_keyword, rit_import_library,
    )
    raw = await file.read()
    if len(raw) > RIT_MAX_ZIP_BYTES:
        raise HTTPException(400, detail=f"ZIP troppo grande (max {RIT_MAX_ZIP_BYTES // (1024*1024)} MB).")

    try:
        parsed = _rit_parse_zip(raw)
    except RitIngestError as e:
        raise HTTPException(400, detail=str(e))

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
    else:
        raise HTTPException(400, detail=f"mode non valido: {mode!r}")

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
        "n_markers": len(parsed["markers"]),
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
