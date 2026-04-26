"""
Syntesis-ICP — Backend API
Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import io
import os
import uuid
import time
import logging
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path

from pydantic import BaseModel
from auth import router as auth_router, verify_token
from icp_engine import analyze_stl_pair
from pdf_gen import generate_pdf
from database import (
    init_db, log_analysis, get_leaderboard, save_result,
    list_user_analyses, count_user_analyses, update_analysis_meta,
    delete_user_analysis, get_user_profile, update_user_profile,
    list_user_projects, get_user_project, create_user_project,
    update_user_project, delete_user_project, assign_analysis_to_project,
    set_gdrive_credentials, get_gdrive_credentials, clear_gdrive_credentials,
    set_project_gdrive_folder,
    list_user_contacts, create_user_contact, update_user_contact,
    delete_user_contact, reconcile_pending_contacts,
    get_user_storage_status, log_usage, can_upload_bytes, PLAN_LIMITS
)
import gdrive  # v7.3.9.048: modulo OAuth + Drive API
from security_config import validate_security_config
from rate_limit import limiter, ANALYZE_PUBLIC_LIMIT

# Fail-fast all'import: rifiuta default pericolosi in produzione.
# Deve stare PRIMA della creazione dell'app FastAPI.
validate_security_config()

# Timeout massimo per una singola analisi ICP (secondi).
# Se l'ICP non converge entro questo tempo, l'endpoint restituisce 504
# invece di bloccare il worker Uvicorn indefinitamente.
ICP_TIMEOUT_SECONDS = int(os.getenv("ICP_TIMEOUT_SECONDS", "60"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # La sorgente unica del frontend e` backend/static/index.html nel repo.
    # Viene copiata dal Dockerfile (COPY backend/ .) e servita staticamente.
    # Nessuna decodifica o riscrittura al boot (v7.3.7.004+).
    await init_db()
    yield


# Auto-download missing static files on startup
import subprocess, sys as _sys
try:
    _startup = Path(__file__).parent / "startup.py"
    if _startup.exists():
        subprocess.run([_sys.executable, str(_startup)], check=False, timeout=60)
except Exception as _e:
    print(f"Startup warning: {_e}")

app = FastAPI(
    title="Syntesis-ICP API",
    version="1.0.0",
    docs_url=None,   # disabilita Swagger pubblico
    redoc_url=None,
    lifespan=lifespan
)

# Registra SlowAPI per rate limiting per IP (prima dei middleware CORS).
# I 429 Too Many Requests vengono gestiti dal suo exception handler.
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS: permetti solo il tuo dominio in produzione
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")

# ── Serve frontend statico ────────────────────────────────────────────────────
import pathlib
_STATIC_DIR = pathlib.Path(__file__).parent / "static"
_INDEX = _STATIC_DIR / "index.html"

if _INDEX.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

# Header anti-cache per pagine HTML dinamiche (hub + moduli)
# Evita che browser/CDN servano versioni stale dopo un deploy
_NO_STORE_HEADERS = {"Cache-Control": "no-store, must-revalidate"}

@app.get("/", include_in_schema=False)
async def serve_frontend():
    if _INDEX.exists():
        return FileResponse(str(_INDEX), headers=_NO_STORE_HEADERS)
    return JSONResponse({"status": "ok", "message": "Syntesis-ICP API"})

# ── Rate limiting semplice in memoria ────────────────────────────────────────
_rate_store: dict[str, list[float]] = {}
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_HOUR", "50"))

def check_rate_limit(user_id: str):
    now = time.time()
    window = now - 3600
    calls = [t for t in _rate_store.get(user_id, []) if t > window]
    if len(calls) >= RATE_LIMIT:
        raise HTTPException(429, detail="Rate limit raggiunto. Riprova tra un'ora.")
    calls.append(now)
    _rate_store[user_id] = calls


# ── Endpoint analisi principale ───────────────────────────────────────────────

@app.get("/analizzare", include_in_schema=False)
async def analyzer_page():
    _an = _STATIC_DIR / "syntesis-analyzer-v3b.html"
    if _an.exists():
        return FileResponse(str(_an), headers=_NO_STORE_HEADERS)
    return JSONResponse({"error": "Analyzer not found"}, status_code=404)

@app.get("/statistiche", include_in_schema=False)
async def statistiche_page():
    _st = _STATIC_DIR / "syntesis-statistiche-v7.4.0.002.html"
    if _st.exists():
        return FileResponse(str(_st), headers=_NO_STORE_HEADERS)
    return JSONResponse({"error": "Statistiche not found"}, status_code=404)

@app.get("/dashboard", include_in_schema=False)
async def dashboard_page():
    """v7.3.9.046: backend utente - area personale (mie analisi, profilo)."""
    _dh = _STATIC_DIR / "syntesis-dashboard-v1.html"
    if _dh.exists():
        return FileResponse(str(_dh), headers=_NO_STORE_HEADERS)
    return JSONResponse({"error": "Dashboard not found"}, status_code=404)

@app.post("/api/analyze")
async def analyze(
    file_a: UploadFile = File(..., description="STL riferimento"),
    file_b: UploadFile = File(..., description="STL confronto"),
    save_to_leaderboard: bool = False,
    operator_name: Optional[str] = None,
    location: Optional[str] = None,
    consent: bool = False,
    current_user: dict = Depends(verify_token)
):
    check_rate_limit(current_user["user_id"])

    # Validazione file
    for f in [file_a, file_b]:
        if not f.filename.lower().endswith(".stl"):
            raise HTTPException(400, detail=f"Il file '{f.filename}' non è un STL valido.")
        if f.size and f.size > 50 * 1024 * 1024:
            raise HTTPException(413, detail="File troppo grande (max 50 MB).")

    data_a = await file_a.read()
    data_b = await file_b.read()

    if len(data_a) < 84 or len(data_b) < 84:
        raise HTTPException(400, detail="File STL non valido o corrotto.")

    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, analyze_stl_pair, data_a, data_b, file_a.filename, file_b.filename
            ),
            timeout=ICP_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        logger.warning(
            f"Timeout ICP dopo {ICP_TIMEOUT_SECONDS}s su "
            f"{file_a.filename} + {file_b.filename} "
            f"(user={current_user['user_id']})"
        )
        raise HTTPException(
            504,
            detail=f"Analisi troppo lunga (>{ICP_TIMEOUT_SECONDS}s). "
                   "File molto complessi o malformati."
        )
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    except Exception as e:
        logger.error(f"Errore analisi ICP: {e}", exc_info=True)
        raise HTTPException(500, detail="Errore interno durante l'analisi.")

    # v7.3.9.043: marca esplicitamente l'algoritmo usato (Misurare = sempre server)
    result["algorithm"] = "server_weighted_icp_v1"
    analysis_id = str(uuid.uuid4())
    await log_analysis(
        analysis_id=analysis_id,
        user_id=current_user["user_id"],
        filename_a=file_a.filename,
        filename_b=file_b.filename,
        score=result["score"],
        rmsd=result["icp_rmsd"],
        result_json=result
    )

    if save_to_leaderboard and consent and operator_name and location:
        await save_result(
            analysis_id=analysis_id,
            operator_name=operator_name,
            location=location,
            score=result["score"],
            rmsd=result["icp_rmsd"],
            n_pairs=len(result["pairs"]),
            brand=result.get("detected_profile", "Generico")
        )

    return {
        "analysis_id": analysis_id,
        "score": result["score"],
        "score_label": result["score_label"],
        "icp_rmsd": result["icp_rmsd"],
        "icp_angle": result["icp_angle"],
        "n_pairs": len(result["pairs"]),
        "detected_profile": result.get("detected_profile"),
        "excluded_a": result.get("excluded_a", 0),
        "excluded_b": result.get("excluded_b", 0),
        "analysis_mode": result.get("analysis_mode", "pairwise"),
        "extra_instances_b": result.get("extra_instances_b", 0),
        "pairs": result["pairs"],
        "cyl_axes": result["cyl_axes"],
        "filename_a": file_a.filename,
        "filename_b": file_b.filename,
    }


@app.post("/api/report/{analysis_id}")
async def get_report(
    analysis_id: str,
    current_user: dict = Depends(verify_token)
):
    """Genera e restituisce il PDF firmato server-side."""
    # Recupera risultato dal db (implementato in database.py)
    from database import get_analysis
    record = await get_analysis(analysis_id, current_user["user_id"])
    if not record:
        raise HTTPException(404, detail="Analisi non trovata.")

    pdf_bytes = generate_pdf(record)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="syntesis-icp-{analysis_id[:8]}.pdf"',
            "X-Syntesis-Signed": "1"
        }
    )


@app.get("/api/leaderboard")
async def leaderboard(
    brand: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(verify_token)
):
    rows = await get_leaderboard(brand=brand, limit=min(limit, 100))
    return {"rows": rows}



# ── Endpoint analisi pubblica (no auth) ──────────────────────────────────────
@app.post("/api/analyze-public")
@limiter.limit(ANALYZE_PUBLIC_LIMIT)
async def analyze_public(
    request: Request,
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
    landmarks: Optional[str] = Form(None),
    lang: Optional[str] = Form(None)
):
    """Analisi STL senza autenticazione. La logica ICP gira sul server.
    landmarks: JSON opzionale {"a":[{x,y,z}x3], "b":[{x,y,z}x3]} per pre-allineamento manuale."""
    for f in [file_a, file_b]:
        if not f.filename.lower().endswith(".stl"):
            raise HTTPException(400, detail=f"'{f.filename}' non è un STL valido.")
        if f.size and f.size > 50 * 1024 * 1024:
            raise HTTPException(413, detail="File troppo grande (max 50 MB).")

    data_a = await file_a.read()
    data_b = await file_b.read()

    if len(data_a) < 84 or len(data_b) < 84:
        raise HTTPException(400, detail="File STL non valido o corrotto.")

    # Parsing landmarks
    lm_parsed = None
    if landmarks:
        try:
            import json as _json
            lm_parsed = _json.loads(landmarks)
        except Exception:
            lm_parsed = None

    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, analyze_stl_pair, data_a, data_b,
                file_a.filename, file_b.filename, lm_parsed
            ),
            timeout=ICP_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        logger.warning(
            f"Timeout ICP dopo {ICP_TIMEOUT_SECONDS}s su "
            f"{file_a.filename} + {file_b.filename}"
        )
        raise HTTPException(
            504,
            detail=f"Analisi troppo lunga (>{ICP_TIMEOUT_SECONDS}s). "
                   "File molto complessi o malformati."
        )
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    except Exception as e:
        logger.error(f"Errore analisi ICP: {e}", exc_info=True)
        raise HTTPException(500, detail="Errore interno durante l'analisi.")

    return {
        "pairs":            result["pairs"],
        "cyl_axes":         result["cyl_axes"],
        "icp_rmsd":         result["icp_rmsd"],
        "icp_angle":        result["icp_angle"],
        "score":            result["score"],
        "score_label":      result["score_label"],
        "detected_profile": result.get("detected_profile"),
        "n_scan_a":         result.get("n_scan_a", 0),
        "n_scan_b":         result.get("n_scan_b", 0),
        "excluded_a":       result.get("excluded_a", 0),
        "excluded_b":       result.get("excluded_b", 0),
        "analysis_mode":    result.get("analysis_mode", "pairwise"),
        "extra_instances_b": result.get("extra_instances_b", 0),
        "off":              result.get("off", [0, 0, 0]),
        "ct_a":             result.get("ct_a", []),
        "ct_b_final":       result.get("ct_b_final", []),
        "filename_a":       file_a.filename,
        "filename_b":       file_b.filename,
        # Dati mesh per anteprime e PDF
        "tris_a":           result.get("tris_a", []),
        "tris_b_all":       result.get("tris_b_all", []),
        "bg_a":             result.get("bg_a", []),
        "cyl_tris_a":       result.get("cyl_tris_a", []),
        "cyl_tris_b":       result.get("cyl_tris_b", []),
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}




# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.042 - Endpoint posizionamento MUA con weighted ICP server-side
# Feature flag opt-in: il client invia scan_crop + click + template_id e
# riceve center/axis/rmsd dal weighted ICP. Path parallela a findScanbodyCenter
# client-side, attivata da settings utente.
# ─────────────────────────────────────────────────────────────────────────────
class PlaceMuaRequest(BaseModel):
    scan_crop_tris: list  # lista di triangoli [[v0,v1,v2], ...] in coordinate scan
    click_point: list     # [x,y,z]
    click_normal: list    # [x,y,z]
    template_id: str      # "1T3" | "OS" | "SR" | custom
    template_radius: Optional[float] = None  # mm, override del raggio CAD


@app.post("/api/place-mua")
async def place_mua(req: PlaceMuaRequest, current_user: dict = Depends(verify_token)):
    """v7.3.9.042: posizionamento singolo MUA con weighted ICP server-side.

    Path opt-in alternativa a findScanbodyCenter() client-side. Stesso input
    semantico (un crop di scansione + un click), output equivalente
    (center, axis), ma calcolato con weighted ICP cap+cylinder.

    Permette confronto A/B fra il fit deterministico client e il weighted
    ICP server, per validazione clinica e decisione futura su quale
    algoritmo mantenere.
    """
    import time as _time
    import numpy as _np
    from icp_engine import (
        align_template_to_marker, find_components, _cap_centroid_for_cluster,
        cyl_axis
    )

    t0 = _time.time()

    # Validazione
    if not req.scan_crop_tris or len(req.scan_crop_tris) < 30:
        raise HTTPException(400, detail="Crop scansione troppo piccolo (min 30 triangoli).")
    if len(req.click_point) != 3 or len(req.click_normal) != 3:
        raise HTTPException(400, detail="click_point e click_normal devono essere [x,y,z].")

    # Conversione input
    try:
        scan_tris = _np.array(req.scan_crop_tris, dtype=_np.float32)
        if scan_tris.ndim != 3 or scan_tris.shape[1:] != (3, 3):
            raise ValueError(f"Shape inattesa: {scan_tris.shape}, atteso (N,3,3)")
        click_pt = _np.array(req.click_point, dtype=_np.float32)
        click_n = _np.array(req.click_normal, dtype=_np.float32)
        click_n = click_n / (_np.linalg.norm(click_n) + 1e-9)
    except Exception as e:
        raise HTTPException(400, detail=f"Input malformato: {e}")

    # Trovo i punti del cluster marker (entro 5mm dal click + normale concorde)
    centroids = scan_tris.mean(axis=1)
    dists = _np.linalg.norm(centroids - click_pt, axis=1)
    near_mask = dists < 5.0
    near_pts = centroids[near_mask]

    if len(near_pts) < 30:
        raise HTTPException(
            422,
            detail=f"Pochi punti vicini al click ({len(near_pts)} < 30)."
        )

    # Per il template usiamo direttamente la geometria attesa CAD (1T3, OS, SR)
    # Costruisco un template sintetico: cilindro + cap basato su parametri noti
    radius_map = {"1T3": 2.515, "OS": 1.78, "SR": 2.03}
    radius = req.template_radius or radius_map.get(req.template_id, 2.515)

    # Genero un template parametrico cilindro-con-cap (semplificato)
    # In produzione si caricherebbero dal CAD ufficiale; per ora:
    # 200 punti su un cilindro raggio=radius, altezza=4mm, cap a z=4mm
    n_side = 80
    n_cap = 60
    template_pts = []
    for i in range(n_side):
        ang = 2 * 3.14159 * i / n_side
        for z in [0.5, 1.5, 2.5, 3.5]:
            template_pts.append([radius * _np.cos(ang), radius * _np.sin(ang), z])
    for i in range(n_cap):
        r = radius * (i / n_cap) ** 0.5
        ang = 2 * 3.14159 * i * 0.382  # golden angle per distribuzione
        template_pts.append([r * _np.cos(ang), r * _np.sin(ang), 4.0])
    template_pts = _np.array(template_pts, dtype=_np.float32)
    # Faccio triangoli fittizzi da questi punti per soddisfare API align_template_to_marker
    # (richiede shape Nx3x3) - uso una triangolazione semplice consecutiva
    n_tri = (len(template_pts) - 2) // 3
    template_tris = template_pts[:n_tri*3].reshape(n_tri, 3, 3)

    try:
        result = align_template_to_marker(
            template_tris=template_tris,
            marker_pts=near_pts,
            use_icp=True,
            n_rot_attempts=8
        )
    except Exception as e:
        raise HTTPException(500, detail=f"Allineamento fallito: {type(e).__name__}: {e}")

    R = _np.array(result["R"])
    t = _np.array(result["t"])
    rmsd = float(result["rmsd"])

    # Centro = trasformazione del cap-top template
    cap_top_local = _np.array([0, 0, 4.0])
    center = (R @ cap_top_local + t).tolist()

    # Asse = R applicato all'asse Z locale del template
    axis_z_local = _np.array([0, 0, 1.0])
    axis_world = (R @ axis_z_local).tolist()

    elapsed_ms = int((_time.time() - t0) * 1000)

    return {
        "center": center,
        "axis": axis_world,
        "rmsd": rmsd,
        "method": result.get("method", "weighted_icp"),
        "algorithm": "server_weighted_icp_v1",
        "elapsed_ms": elapsed_ms,
        "n_marker_pts": int(len(near_pts)),
        "template_id": req.template_id,
        "template_radius": radius
    }



# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.046 - BACKEND UTENTE
# Area personale: lista mie analisi, rinomina, archivia, elimina, profilo
# ─────────────────────────────────────────────────────────────────────────────

class AnalysisMetaUpdate(BaseModel):
    display_name: Optional[str] = None
    notes: Optional[str] = None
    archived: Optional[bool] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    organization: Optional[str] = None


@app.get("/api/me/profile")
async def me_profile(current_user: dict = Depends(verify_token)):
    """Profilo utente corrente con statistiche."""
    profile = await get_user_profile(current_user["user_id"])
    if not profile:
        raise HTTPException(404, detail="Utente non trovato.")
    return profile


@app.patch("/api/me/profile")
async def me_update_profile(req: ProfileUpdate,
                              current_user: dict = Depends(verify_token)):
    """Aggiorna nome o organizzazione del profilo (mai email/role)."""
    # Validazione minima dei valori
    name = req.name.strip() if req.name else None
    org = req.organization.strip() if req.organization else None
    if name is not None and (len(name) < 1 or len(name) > 200):
        raise HTTPException(400, detail="Nome lunghezza non valida (1-200 caratteri).")
    if org is not None and len(org) > 200:
        raise HTTPException(400, detail="Organizzazione troppo lunga (max 200).")
    ok = await update_user_profile(current_user["user_id"], name=name, organization=org)
    if not ok:
        raise HTTPException(400, detail="Nessun campo da aggiornare.")
    return {"ok": True}


@app.get("/api/me/analyses")
async def me_analyses(archived: bool = False, limit: int = 50, offset: int = 0,
                        current_user: dict = Depends(verify_token)):
    """Lista delle mie analisi (paginate, filtrabili per archived).
    archived=False (default): solo attive
    archived=True: solo archiviate"""
    if limit < 1 or limit > 200:
        raise HTTPException(400, detail="limit deve essere fra 1 e 200.")
    if offset < 0:
        raise HTTPException(400, detail="offset non puo' essere negativo.")
    items = await list_user_analyses(
        user_id=current_user["user_id"],
        archived=archived, limit=limit, offset=offset
    )
    total = await count_user_analyses(
        user_id=current_user["user_id"], archived=archived
    )
    # Serializzo datetimes a ISO string
    for it in items:
        for k in ("created_at", "updated_at"):
            v = it.get(k)
            if v and hasattr(v, "isoformat"):
                it[k] = v.isoformat()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/me/analyses/{analysis_id}")
async def me_analysis_detail(analysis_id: str,
                               current_user: dict = Depends(verify_token)):
    """Dettaglio completo di un'analisi (con result_json fuso)."""
    from database import get_analysis
    record = await get_analysis(analysis_id, current_user["user_id"])
    if not record:
        raise HTTPException(404, detail="Analisi non trovata.")
    # Serializzo datetimes
    for k in ("created_at", "updated_at"):
        v = record.get(k)
        if v and hasattr(v, "isoformat"):
            record[k] = v.isoformat()
    return record


@app.patch("/api/me/analyses/{analysis_id}")
async def me_update_analysis(analysis_id: str, req: AnalysisMetaUpdate,
                               current_user: dict = Depends(verify_token)):
    """Aggiorna metadata di un'analisi (rinomina, note, archivia/de-archivia)."""
    name = req.display_name.strip() if req.display_name is not None else None
    if name is not None and (len(name) < 1 or len(name) > 200):
        raise HTTPException(400, detail="Nome lunghezza non valida (1-200 caratteri).")
    notes = req.notes.strip() if req.notes is not None else None
    if notes is not None and len(notes) > 5000:
        raise HTTPException(400, detail="Note troppo lunghe (max 5000 caratteri).")
    ok = await update_analysis_meta(
        analysis_id=analysis_id,
        user_id=current_user["user_id"],
        display_name=name,
        notes=notes,
        archived=req.archived
    )
    if not ok:
        raise HTTPException(404, detail="Analisi non trovata o nessun campo da aggiornare.")
    return {"ok": True}


@app.delete("/api/me/analyses/{analysis_id}")
async def me_delete_analysis(analysis_id: str,
                               current_user: dict = Depends(verify_token)):
    """Elimina permanentemente un'analisi.
    Rimuove cascata l'eventuale entry leaderboard."""
    ok = await delete_user_analysis(analysis_id, current_user["user_id"])
    if not ok:
        raise HTTPException(404, detail="Analisi non trovata.")
    return {"ok": True, "deleted": analysis_id}



# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.047 - PROGETTI
# Un progetto raggruppa analisi e (in futuro) file su cloud personale.
# La cartella cloud verra' creata da Drive/Dropbox solo dopo connessione OAuth.
# ─────────────────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    patient_ref: Optional[str] = None
    color: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    patient_ref: Optional[str] = None
    color: Optional[str] = None
    archived: Optional[bool] = None


class AnalysisAssignToProject(BaseModel):
    project_id: Optional[str] = None  # None per dissociare


@app.get("/api/me/projects")
async def me_list_projects(archived: bool = False,
                            current_user: dict = Depends(verify_token)):
    """Lista progetti dell'utente con conteggio analisi."""
    items = await list_user_projects(current_user["user_id"], archived=archived)
    # Serializzo datetimes
    for it in items:
        for k in ("created_at", "updated_at", "last_analysis_at"):
            v = it.get(k)
            if v and hasattr(v, "isoformat"):
                it[k] = v.isoformat()
    return {"items": items}


@app.get("/api/me/projects/{project_id}")
async def me_project_detail(project_id: str,
                              current_user: dict = Depends(verify_token)):
    """Dettaglio progetto + analisi associate."""
    proj = await get_user_project(project_id, current_user["user_id"])
    if not proj:
        raise HTTPException(404, detail="Progetto non trovato.")
    for k in ("created_at", "updated_at"):
        v = proj.get(k)
        if v and hasattr(v, "isoformat"):
            proj[k] = v.isoformat()
    for a in proj.get("analyses", []):
        for k in ("created_at",):
            v = a.get(k)
            if v and hasattr(v, "isoformat"):
                a[k] = v.isoformat()
    return proj


@app.post("/api/me/projects")
async def me_create_project(req: ProjectCreate,
                              current_user: dict = Depends(verify_token)):
    """Crea un nuovo progetto."""
    name = (req.name or "").strip()
    if len(name) < 1 or len(name) > 200:
        raise HTTPException(400, detail="Nome progetto richiesto (1-200 caratteri).")
    desc = req.description.strip() if req.description else None
    if desc and len(desc) > 2000:
        raise HTTPException(400, detail="Descrizione troppo lunga (max 2000).")
    patient = req.patient_ref.strip() if req.patient_ref else None
    if patient and len(patient) > 200:
        raise HTTPException(400, detail="Riferimento paziente troppo lungo (max 200).")
    color = req.color.strip() if req.color else None
    if color and not (color.startswith("#") and len(color) in (4, 7)):
        raise HTTPException(400, detail="Colore deve essere hex tipo #0065B3.")

    project_id = await create_user_project(
        user_id=current_user["user_id"],
        name=name, description=desc, patient_ref=patient, color=color
    )

    # NOTA: la creazione della cartella su Google Drive avverra' nella Fase C
    # quando l'utente avra' connesso il provider via OAuth. Per ora gdrive_folder_id
    # resta NULL e verra' valorizzato lazy al primo upload.

    return {"id": project_id, "ok": True}


@app.patch("/api/me/projects/{project_id}")
async def me_update_project(project_id: str, req: ProjectUpdate,
                              current_user: dict = Depends(verify_token)):
    """Aggiorna metadati progetto."""
    name = req.name.strip() if req.name is not None else None
    if name is not None and (len(name) < 1 or len(name) > 200):
        raise HTTPException(400, detail="Nome progetto lunghezza non valida.")
    desc = req.description.strip() if req.description is not None else None
    if desc and len(desc) > 2000:
        raise HTTPException(400, detail="Descrizione troppo lunga.")
    patient = req.patient_ref.strip() if req.patient_ref is not None else None
    color = req.color.strip() if req.color is not None else None
    if color and not (color.startswith("#") and len(color) in (4, 7)):
        raise HTTPException(400, detail="Colore deve essere hex tipo #0065B3.")
    ok = await update_user_project(
        project_id=project_id, user_id=current_user["user_id"],
        name=name, description=desc, patient_ref=patient,
        color=color, archived=req.archived
    )
    if not ok:
        raise HTTPException(404, detail="Progetto non trovato o nessun campo da aggiornare.")
    return {"ok": True}


@app.delete("/api/me/projects/{project_id}")
async def me_delete_project(project_id: str, cascade: bool = False,
                              current_user: dict = Depends(verify_token)):
    """Elimina un progetto.
    cascade=False (default): le analisi restano ma con project_id=NULL
    cascade=True: elimina anche le analisi associate."""
    ok = await delete_user_project(project_id, current_user["user_id"],
                                    cascade_analyses=cascade)
    if not ok:
        raise HTTPException(404, detail="Progetto non trovato.")
    return {"ok": True, "deleted": project_id, "cascade": cascade}


@app.patch("/api/me/analyses/{analysis_id}/project")
async def me_assign_analysis(analysis_id: str, req: AnalysisAssignToProject,
                                current_user: dict = Depends(verify_token)):
    """Associa o dissocia un'analisi a un progetto."""
    ok = await assign_analysis_to_project(
        analysis_id, current_user["user_id"], req.project_id
    )
    if not ok:
        raise HTTPException(404, detail="Analisi o progetto non trovato.")
    return {"ok": True, "project_id": req.project_id}



# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.048 - GOOGLE DRIVE OAUTH
# Connessione cloud personale dell'utente. Privacy-first: scope drive.file
# limita Syntesis-ICP ai SOLI file che lui stesso crea, mai il resto del Drive.
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/me/gdrive/status")
async def me_gdrive_status(current_user: dict = Depends(verify_token)):
    """Stato connessione Drive per l'utente corrente."""
    if not gdrive.is_configured():
        return {"configured": False, "connected": False,
                "message": "OAuth non configurato lato server"}
    creds = await get_gdrive_credentials(current_user["user_id"])
    if not creds:
        return {"configured": True, "connected": False}
    return {
        "configured": True,
        "connected": True,
        "email": creds["email"],
        "connected_at": creds["connected_at"].isoformat() if creds["connected_at"] else None,
    }


@app.get("/auth/gdrive/connect")
async def gdrive_connect_start(token: str):
    """Inizia OAuth: ritorna URL Google. Il frontend chiama questo endpoint
    passando il JWT come query param (perche' verra' aperto in window.location
    o popup, non come fetch con header)."""
    if not gdrive.is_configured():
        raise HTTPException(503, detail="OAuth non configurato sul server.")
    # Verifico il JWT manualmente (l'endpoint accetta token come query param)
    try:
        import jwt as pyjwt
        payload = pyjwt.decode(token, os.getenv("JWT_SECRET", ""), algorithms=["HS256"])
        user_id = payload.get("user_id") or payload.get("sub")
        if not user_id:
            raise HTTPException(401, detail="Token JWT non valido.")
    except Exception as e:
        raise HTTPException(401, detail=f"Token JWT non valido: {e}")
    auth_url = gdrive.get_authorization_url(user_id)
    return RedirectResponse(url=auth_url, status_code=302)


@app.get("/auth/gdrive/callback")
async def gdrive_callback(code: str = "", state: str = "", error: str = ""):
    """Callback OAuth da Google. Verifica state, scambia code per token,
    cifra il refresh_token, salva nel DB. Poi redirect a /dashboard."""
    if error:
        return RedirectResponse(
            url=f"/dashboard?tab=cloud&error={error}", status_code=302)
    if not code or not state:
        raise HTTPException(400, detail="Parametri OAuth mancanti.")
    user_id = gdrive.verify_state_token(state)
    if not user_id:
        raise HTTPException(400, detail="State token non valido o scaduto.")
    try:
        tokens = gdrive.exchange_code_for_tokens(code)
    except Exception as e:
        return RedirectResponse(
            url=f"/dashboard?tab=cloud&error={str(e)[:200]}", status_code=302)
    encrypted = gdrive.encrypt_token(tokens["refresh_token"])
    ok = await set_gdrive_credentials(
        user_id=user_id,
        email=tokens.get("email", ""),
        refresh_token_encrypted=encrypted,
    )
    if not ok:
        return RedirectResponse(
            url="/dashboard?tab=cloud&error=save_failed", status_code=302)
    return RedirectResponse(
        url="/dashboard?tab=cloud&connected=1", status_code=302)


@app.post("/auth/gdrive/disconnect")
async def gdrive_disconnect(current_user: dict = Depends(verify_token)):
    """Rimuove le credenziali Drive dal nostro DB.
    L'utente puo' anche revocare manualmente da
    https://myaccount.google.com/permissions per togliere il consent Google."""
    await clear_gdrive_credentials(current_user["user_id"])
    return {"ok": True}


@app.post("/api/me/projects/{project_id}/sync-folder")
async def me_project_sync_folder(project_id: str,
                                    current_user: dict = Depends(verify_token)):
    """Crea (o recupera) la folder Drive associata al progetto.
    Idempotente: se gia' esiste, ritorna l'ID esistente."""
    creds = await get_gdrive_credentials(current_user["user_id"])
    if not creds:
        raise HTTPException(400, detail="Drive non connesso.")
    proj = await get_user_project(project_id, current_user["user_id"])
    if not proj:
        raise HTTPException(404, detail="Progetto non trovato.")
    # Se gia' esiste un folder_id valido, lo restituisco senza ricreare
    if proj.get("gdrive_folder_id"):
        return {"folder_id": proj["gdrive_folder_id"], "created": False}
    # Crea folder
    try:
        refresh_token = gdrive.decrypt_token(creds["refresh_token_encrypted"])
        service = gdrive.get_drive_service(refresh_token)
        folder_id = gdrive.get_or_create_project_folder(
            service, proj["name"], project_id
        )
        await set_project_gdrive_folder(project_id, current_user["user_id"], folder_id)
        return {"folder_id": folder_id, "created": True}
    except Exception as e:
        logger.error(f"sync-folder failed: {e}")
        raise HTTPException(502, detail=f"Drive API error: {str(e)[:200]}")


@app.get("/api/me/projects/{project_id}/files")
async def me_project_files(project_id: str,
                              current_user: dict = Depends(verify_token)):
    """Lista file caricati su Drive per questo progetto."""
    creds = await get_gdrive_credentials(current_user["user_id"])
    if not creds:
        raise HTTPException(400, detail="Drive non connesso.")
    proj = await get_user_project(project_id, current_user["user_id"])
    if not proj:
        raise HTTPException(404, detail="Progetto non trovato.")
    if not proj.get("gdrive_folder_id"):
        return {"files": [], "folder_id": None}




# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.053 - RUBRICA CONTATTI
# Lista personale di altri utenti Syntesis con cui collaborare per scambio file.
# Un contatto e' "pending" se l'altra email non e' ancora registrata, "active"
# se l'altra persona ha gia' un account Syntesis.
# ─────────────────────────────────────────────────────────────────────────────

class ContactCreate(BaseModel):
    contact_email: str
    display_name: Optional[str] = None
    role: Optional[str] = None
    notes: Optional[str] = None


class ContactUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    notes: Optional[str] = None


@app.get("/api/me/contacts")
async def me_list_contacts(current_user: dict = Depends(verify_token)):
    """Lista contatti dell'utente corrente."""
    items = await list_user_contacts(current_user["user_id"])
    # Serializzo datetimes
    for it in items:
        for k in ("created_at", "updated_at"):
            v = it.get(k)
            if v and hasattr(v, "isoformat"):
                it[k] = v.isoformat()
    return {"items": items}


@app.post("/api/me/contacts")
async def me_create_contact(req: ContactCreate,
                              current_user: dict = Depends(verify_token)):
    """Aggiunge un contatto alla rubrica. Se l'email corrisponde a un utente
    Syntesis, viene auto-collegato (status=active), altrimenti resta pending."""
    # Validazione email
    email = (req.contact_email or "").strip().lower()
    if not email or "@" not in email or len(email) > 200:
        raise HTTPException(400, detail="Email non valida.")
    name = req.display_name.strip() if req.display_name else None
    if name and len(name) > 200:
        raise HTTPException(400, detail="Nome troppo lungo (max 200).")
    role = req.role.strip() if req.role else None
    if role and len(role) > 100:
        raise HTTPException(400, detail="Ruolo troppo lungo (max 100).")
    notes = req.notes.strip() if req.notes else None
    if notes and len(notes) > 2000:
        raise HTTPException(400, detail="Note troppo lunghe (max 2000).")

    try:
        contact = await create_user_contact(
            owner_user_id=current_user["user_id"],
            contact_email=email,
            display_name=name,
            role=role,
            notes=notes,
        )
    except ValueError as e:
        raise HTTPException(409, detail=str(e))
    return contact


@app.patch("/api/me/contacts/{contact_id}")
async def me_update_contact(contact_id: str, req: ContactUpdate,
                              current_user: dict = Depends(verify_token)):
    """Aggiorna nome/ruolo/note di un contatto. L'email non e' modificabile."""
    name = req.display_name.strip() if req.display_name is not None else None
    if name is not None and len(name) > 200:
        raise HTTPException(400, detail="Nome troppo lungo.")
    role = req.role.strip() if req.role is not None else None
    notes = req.notes.strip() if req.notes is not None else None
    ok = await update_user_contact(
        contact_id, current_user["user_id"],
        display_name=name, role=role, notes=notes
    )
    if not ok:
        raise HTTPException(404, detail="Contatto non trovato o nessun campo da aggiornare.")
    return {"ok": True}


@app.delete("/api/me/contacts/{contact_id}")
async def me_delete_contact(contact_id: str,
                              current_user: dict = Depends(verify_token)):
    """Rimuove un contatto dalla rubrica."""
    ok = await delete_user_contact(contact_id, current_user["user_id"])
    if not ok:
        raise HTTPException(404, detail="Contatto non trovato.")
    return {"ok": True}



# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.054 - CONSUMO STORAGE
# Free: 1 GB/mese. Reset il 1\xb0 di ogni mese (UTC).
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/me/storage")
async def me_storage(current_user: dict = Depends(verify_token)):
    """Ritorna stato consumo mensile dell'utente: plan, used, limit, %, periodo."""
    status = await get_user_storage_status(current_user["user_id"])
    return status



# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.056 - File browser Drive (Fase E1)
# Permette di navigare i contenuti della cartella Syntesis-ICP del Drive utente
# direttamente dall'area personale, senza dover aprire drive.google.com.
# Usa lo scope drive.file: vediamo solo cio' che l'app stessa ha creato.
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/me/gdrive/browse")
async def me_gdrive_browse(
    folder_id: Optional[str] = None,
    current_user: dict = Depends(verify_token)
):
    """Lista contenuti di una cartella Drive dell'utente.
    Se folder_id e' omesso, ritorna la root Syntesis-ICP."""
    creds_data = await get_gdrive_credentials(current_user["user_id"])
    if not creds_data or not creds_data.get("refresh_token"):
        raise HTTPException(409, detail="Google Drive non connesso. Vai su Cloud per collegarlo.")
    try:
        result = gdrive.browse_folder(creds_data, folder_id=folder_id)
        # Aggiungo breadcrumb se siamo dentro una sottocartella
        if folder_id:
            try:
                breadcrumb = gdrive.get_folder_breadcrumb(creds_data, folder_id)
            except Exception:
                breadcrumb = []
        else:
            breadcrumb = [{"id": result["folder_id"], "name": result["folder_name"]}]
        result["breadcrumb"] = breadcrumb
        result["drive_web_url"] = gdrive.get_drive_web_url(result["folder_id"])
        return result
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:
        logger.exception("browse Drive fallito")
        raise HTTPException(500, detail=f"Errore Drive: {e}")


@app.get("/api/me/gdrive/file/{file_id}/link")
async def me_gdrive_file_link(
    file_id: str,
    current_user: dict = Depends(verify_token)
):
    """Ritorna il link diretto al file su Drive (per visualizzazione/download via Drive)."""
    creds_data = await get_gdrive_credentials(current_user["user_id"])
    if not creds_data or not creds_data.get("refresh_token"):
        raise HTTPException(409, detail="Google Drive non connesso.")
    return {
        "file_id": file_id,
        "web_view_link": f"https://drive.google.com/file/d/{file_id}/view",
        "download_link": f"https://drive.google.com/uc?export=download&id={file_id}",
    }
    try:
        refresh_token = gdrive.decrypt_token(creds["refresh_token_encrypted"])
        service = gdrive.get_drive_service(refresh_token)
        files = gdrive.list_folder(service, proj["gdrive_folder_id"])
        return {"files": files, "folder_id": proj["gdrive_folder_id"]}
    except Exception as e:
        logger.error(f"list files failed: {e}")
        raise HTTPException(502, detail=f"Drive API error: {str(e)[:200]}")
