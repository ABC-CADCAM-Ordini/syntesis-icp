"""
Syntesis-ICP — Backend API
Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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
    get_user_storage_status, log_usage, can_upload_bytes, PLAN_LIMITS,
    create_shared_folder, add_shared_folder_member,
    get_shared_folder, list_owned_shared_folders, list_member_shared_folders,
    list_pending_invites_for_user, get_membership,
    accept_shared_invite, decline_shared_invite,
    list_active_members_of_folder, get_shared_folder_by_drive_id,
    reconcile_pending_shared_invites,
    get_user_pro_role, set_user_pro_role,
)
import gdrive  # v7.3.9.048: modulo OAuth + Drive API
import email_service  # v7.3.9.065 - email transazionali Resend
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

# v7.3.9.093 - Compressione gzip delle response.
# Riduce ~75% il payload di /api/analyze-public (da ~6.8 MB a ~1.5 MB tipici).
# Trasparente al client: i browser decomprimono automaticamente.
# minimum_size=1024 evita compressione su payload piccoli (overhead).
app.add_middleware(GZipMiddleware, minimum_size=1024)

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
    # Redirect 302 a /vedere (Blocco 5j: il workflow Vedere e' il default).
    # Manteniamo il fallback all'index.html storico se esiste, ma di norma
    # /vedere e' la prima esperienza utente. Status 302 = temporaneo, cosi'
    # se in futuro vogliamo cambiare default e' facile.
    return RedirectResponse(url="/vedere", status_code=302)

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


# ── LAB: branch parallelo del modulo Analizzare ─────────────────────────────
# Stesso codice del modulo Analizzare al giorno zero, ma su rotta separata
# (/lab) e con motore ICP isolato (icp_engine_lab.py). Permette di iterare
# sull'algoritmo ICP senza toccare la produzione. Quando il motore lab sara'
# validato, sostituira' icp_engine.py e questa rotta verra' rimossa.
@app.get("/lab", include_in_schema=False)
async def analyzer_lab_page():
    _lb = _STATIC_DIR / "syntesis-analyzer-lab.html"
    if _lb.exists():
        return FileResponse(str(_lb), headers=_NO_STORE_HEADERS)
    return JSONResponse({"error": "Lab analyzer not found"}, status_code=404)

@app.get("/vedere", include_in_schema=False)
async def vedere_page():
    """Workflow Vedere: viewer 3D multi-formato (STL/OBJ/PLY/XYZ/PCD/PTS)
    con strumenti di misura, forme e annotazioni. Prima voce dell'elenco workflow."""
    _vd = _STATIC_DIR / "syntesis-icp-vedere.html"
    if _vd.exists():
        return FileResponse(str(_vd), headers=_NO_STORE_HEADERS)
    return JSONResponse({"error": "Vedere not found"}, status_code=404)

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


# ── LAB: endpoint parallelo per il modulo /lab ───────────────────────────
# Identico a /api/place-mua al giorno zero, ma importa da icp_engine_lab.
# Cosi' le modifiche al motore ICP nel branch lab non toccano la produzione.
@app.post("/api/place-mua-lab")
async def place_mua_lab(req: PlaceMuaRequest, current_user: dict = Depends(verify_token)):
    """LAB branch: come /api/place-mua, ma usa icp_engine_lab (motore isolato)."""
    import time as _time
    import numpy as _np
    from icp_engine_lab import (
        align_template_to_marker, find_components, _cap_centroid_for_cluster,
        cyl_axis
    )

    t0 = _time.time()

    if not req.scan_crop_tris or len(req.scan_crop_tris) < 30:
        raise HTTPException(400, detail="Crop scansione troppo piccolo (min 30 triangoli).")
    if len(req.click_point) != 3 or len(req.click_normal) != 3:
        raise HTTPException(400, detail="click_point e click_normal devono essere [x,y,z].")

    try:
        scan_tris = _np.array(req.scan_crop_tris, dtype=_np.float32)
        if scan_tris.ndim != 3 or scan_tris.shape[1:] != (3, 3):
            raise ValueError(f"Shape inattesa: {scan_tris.shape}, atteso (N,3,3)")
        click_pt = _np.array(req.click_point, dtype=_np.float32)
        click_n = _np.array(req.click_normal, dtype=_np.float32)
        click_n = click_n / (_np.linalg.norm(click_n) + 1e-9)
    except Exception as e:
        raise HTTPException(400, detail=f"Input malformato: {e}")

    centroids = scan_tris.mean(axis=1)
    dists = _np.linalg.norm(centroids - click_pt, axis=1)
    near_mask = dists < 5.0
    near_pts = centroids[near_mask]

    if len(near_pts) < 30:
        raise HTTPException(
            422,
            detail=f"Pochi punti vicini al click ({len(near_pts)} < 30)."
        )

    radius_map = {"1T3": 2.515, "OS": 1.78, "SR": 2.03}
    radius = req.template_radius or radius_map.get(req.template_id, 2.515)

    n_side = 80
    n_cap = 60
    template_pts = []
    for i in range(n_side):
        ang = 2 * 3.14159 * i / n_side
        for z in [0.5, 1.5, 2.5, 3.5]:
            template_pts.append([radius * _np.cos(ang), radius * _np.sin(ang), z])
    for i in range(n_cap):
        r = radius * (i / n_cap) ** 0.5
        ang = 2 * 3.14159 * i * 0.382
        template_pts.append([r * _np.cos(ang), r * _np.sin(ang), 4.0])
    template_pts = _np.array(template_pts, dtype=_np.float32)
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

    cap_top_local = _np.array([0, 0, 4.0])
    center = (R @ cap_top_local + t).tolist()
    axis_z_local = _np.array([0, 0, 1.0])
    axis_world = (R @ axis_z_local).tolist()

    elapsed_ms = int((_time.time() - t0) * 1000)

    return {
        "center": center,
        "axis": axis_world,
        "rmsd": rmsd,
        "method": result.get("method", "weighted_icp"),
        "algorithm": "server_weighted_icp_lab_v1",
        "elapsed_ms": elapsed_ms,
        "n_marker_pts": int(len(near_pts)),
        "template_id": req.template_id,
        "template_radius": radius,
        "branch": "lab"
    }




# ─────────────────────────────────────────────────────────────────────────────
# /lab v8.0.0-fase3i: endpoint PUBBLICO senza auth per testing /lab.
# Permette al modulo /lab di chiamare il weighted ICP server-side senza
# richiedere il login dell'utente. Stessa logica di /api/place-mua-lab.
# Coerente con /api/analyze-public per il modulo Misurare.
# Rate limit: TBD (per ora open).
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/place-mua-lab-public")
async def place_mua_lab_public(req: PlaceMuaRequest):
    """LAB pubblico v4: cap-top centroid diretto + fallback ICP weighted.

    Ratio v4: per scanbody piccoli e ben definiti come OS, la cap top
    (superficie piatta orizzontale) e' il segnale piu' pulito. Calcolo
    diretto del centroide dei punti cap-top (normale strettamente
    parallela al click_normal) e media delle loro normali.
    Errore tipico < 0.05mm su scansioni OK.

    Pipeline:
      1. Filtra cap-top points (n_dot > 0.85 per partenza, abbassa a 0.65 se pochi)
      2. Centroide cap-top = center  |  Mean normal cap-top = axis
      3. Se n_cap_top < 8: fallback v3 ICP weighted multi-axis seed
    """
    import time as _time
    import numpy as _np
    from icp_engine_lab import (
        align_template_to_marker, find_components, _cap_centroid_for_cluster,
        cyl_axis, run_icp, _rotation_between_vectors, apply_transform
    )

    t0 = _time.time()

    if not req.scan_crop_tris or len(req.scan_crop_tris) < 30:
        raise HTTPException(400, detail="Crop scansione troppo piccolo (min 30 triangoli).")
    if len(req.click_point) != 3 or len(req.click_normal) != 3:
        raise HTTPException(400, detail="click_point e click_normal devono essere [x,y,z].")

    try:
        scan_tris = _np.array(req.scan_crop_tris, dtype=_np.float32)
        if scan_tris.ndim != 3 or scan_tris.shape[1:] != (3, 3):
            raise ValueError(f"Shape inattesa: {scan_tris.shape}, atteso (N,3,3)")
        click_pt = _np.array(req.click_point, dtype=_np.float32)
        click_n  = _np.array(req.click_normal, dtype=_np.float32)
        click_n  = click_n / (_np.linalg.norm(click_n) + 1e-9)
    except Exception as e:
        raise HTTPException(400, detail=f"Input malformato: {e}")

    tid = (req.template_id or "1T3").upper()
    type_cfg = {
        "1T3": {"radius": 2.515, "cap_z": 9.0, "body_levels": [1.0, 3.0, 5.0, 7.0],
                "crop_axial": 6.0, "crop_radial": 4.0, "cap_top_z_world": None},
        "OS":  {"radius": 1.78,  "cap_z": 6.0, "body_levels": [0.5, 1.5, 2.5, 3.5, 4.5],
                "crop_axial": 4.0, "crop_radial": 2.5, "cap_top_z_world": None},
        "SR":  {"radius": 2.03,  "cap_z": 3.0, "body_levels": [0.5, 1.0, 1.5, 2.0],
                "crop_axial": 4.0, "crop_radial": 2.6, "cap_top_z_world": None},
    }
    cfg = type_cfg.get(tid, type_cfg["1T3"])
    radius = req.template_radius or cfg["radius"]

    # ── Calcolo geometria triangoli ──────────────────────────────────────────
    v0 = scan_tris[:, 0, :]; v1 = scan_tris[:, 1, :]; v2 = scan_tris[:, 2, :]
    centroids = (v0 + v1 + v2) / 3.0
    e1 = v1 - v0; e2 = v2 - v0
    face_normals = _np.cross(e1, e2)
    fn_mag = _np.linalg.norm(face_normals, axis=1, keepdims=True) + 1e-12
    face_normals = face_normals / fn_mag

    # Project centroids to click frame (axial along click_n, radial perp)
    delta = centroids - click_pt
    axial = delta @ click_n
    radial_vec = delta - axial[:, None] * click_n
    radial = _np.linalg.norm(radial_vec, axis=1)

    # Crop direzionale base
    in_cyl = (_np.abs(axial) < cfg["crop_axial"]) & (radial < cfg["crop_radial"])

    # ── ALGORITMO PRINCIPALE: CAP-TOP CENTROID DIRETTO ───────────────────────
    # Score: n_dot SIGNED (positivo = upward-facing rispetto a click_n).
    n_dot_signed = face_normals @ click_n

    # Threshold strict prima (>0.85 = quasi perfettamente parallelo)
    cap_top_strict = (n_dot_signed > 0.85) & in_cyl
    n_strict = int(cap_top_strict.sum())

    used_method = "?"
    center = None
    axis_world = None
    n_cap_top_used = 0
    threshold_used = 0.0
    fallback_reason = None

    if n_strict >= 8:
        threshold_used = 0.85
        cap_mask = cap_top_strict
    else:
        # Allarga a 0.65 (cap leggermente curva o noise sui normali)
        cap_top_loose = (n_dot_signed > 0.65) & in_cyl
        n_loose = int(cap_top_loose.sum())
        if n_loose >= 8:
            threshold_used = 0.65
            cap_mask = cap_top_loose
        else:
            cap_mask = None
            fallback_reason = f"strict={n_strict}, loose={n_loose} (entrambi <8)"

    if cap_mask is not None:
        # ── Cap-top centroid + SVD plane axis ──
        cap_pts = centroids[cap_mask]
        cap_norms = face_normals[cap_mask]
        n_cap_top_used = len(cap_pts)

        # Centroide = centro XY della cap top (in world)
        center_arr = cap_pts.mean(axis=0)

        # Asse via SVD: piano di best-fit attraverso cap_pts.
        # L'autovettore con autovalore MINIMO = normale del piano = asse.
        # Robust al rumore di triangolazione (usa posizioni, non normali calcolate).
        Pc = cap_pts - center_arr
        try:
            _U, _S, Vt = _np.linalg.svd(Pc, full_matrices=False)
            axis_svd = Vt[-1]  # smallest singular value = plane normal
            axis_svd = axis_svd / (_np.linalg.norm(axis_svd) + 1e-9)
            # Allinea con click_n (cap-up)
            if axis_svd @ click_n < 0:
                axis_svd = -axis_svd
            axis_refined = axis_svd
            axis_method = "svd_plane"
        except Exception:
            # Fallback: media delle normali
            axis_refined = cap_norms.mean(axis=0)
            axis_refined = axis_refined / (_np.linalg.norm(axis_refined) + 1e-9)
            if axis_refined @ click_n < 0:
                axis_refined = -axis_refined
            axis_method = "mean_normal_fallback"

        center = center_arr.tolist()
        axis_world = axis_refined.tolist()
        used_method = f"cap_top_centroid_{axis_method}_thresh{threshold_used:.2f}"

    # ── FALLBACK: ICP weighted multi-axis (v3) ───────────────────────────────
    if center is None:
        # Filter for full crop (cap any direction OR body)
        is_cap_face  = _np.abs(face_normals @ click_n) > 0.75
        is_body_face = _np.abs(face_normals @ click_n) < 0.40
        keep = in_cyl & (is_cap_face | is_body_face)
        near_pts = centroids[keep]
        n_total_fb = int(keep.sum())
        if n_total_fb < 30:
            raise HTTPException(
                422,
                detail=f"Cap-top: {fallback_reason}. Fallback ICP: pochi punti ({n_total_fb}<30)."
            )

        # Build template (same as v3)
        n_side_per_lvl = 60
        n_cap_pts_tpl = 80
        template_pts = []
        template_is_cap = []
        for ang_i in range(n_side_per_lvl):
            ang = 2 * 3.14159 * ang_i / n_side_per_lvl
            for z in cfg["body_levels"]:
                template_pts.append([radius * _np.cos(ang), radius * _np.sin(ang), z])
                template_is_cap.append(False)
        for i in range(n_cap_pts_tpl):
            r = radius * (i / n_cap_pts_tpl) ** 0.5
            ang = 2 * 3.14159 * i * 0.382
            template_pts.append([r * _np.cos(ang), r * _np.sin(ang), cfg["cap_z"]])
            template_is_cap.append(True)
        template_pts = _np.array(template_pts, dtype=_np.float32)
        template_is_cap = _np.array(template_is_cap, dtype=bool)
        weights = _np.where(template_is_cap, 5.0, 1.0).astype(_np.float32)

        cap_top_local = _np.array([0.0, 0.0, cfg["cap_z"]], dtype=_np.float32)
        anchor = click_pt.copy()
        n_spin = 12

        overall_best_rmsd = float("inf")
        overall_best_R = _np.eye(3, dtype=_np.float32)
        overall_best_t = _np.zeros(3, dtype=_np.float32)

        # Single seed: click_normal (semplificazione fallback)
        R_init = _rotation_between_vectors(_np.array([0.0, 0.0, 1.0], dtype=_np.float32),
                                           click_n.astype(_np.float32))
        cap_top_after_R = R_init @ cap_top_local
        t_init = anchor - cap_top_after_R
        tpl_after_R_t = (R_init @ template_pts.T).T + t_init

        for k in range(n_spin):
            theta = (2 * _np.pi * k) / n_spin
            c_t, s_t = _np.cos(theta), _np.sin(theta)
            au = click_n
            K = _np.array([[0, -au[2], au[1]], [au[2], 0, -au[0]], [-au[1], au[0], 0]], dtype=_np.float32)
            R_spin = _np.eye(3, dtype=_np.float32) * c_t + s_t * K + (1 - c_t) * _np.outer(au, au)
            moving = (R_spin @ (tpl_after_R_t - anchor).T).T + anchor
            cur_pts = moving.copy()
            cur_R = R_spin @ R_init
            cur_t = R_spin @ (t_init - anchor) + anchor

            for it in range(20):
                diffs = near_pts[None, :, :] - cur_pts[:, None, :]
                d2 = _np.sum(diffs * diffs, axis=2)
                nn_idx = _np.argmin(d2, axis=1)
                target = near_pts[nn_idx]
                errs = _np.linalg.norm(target - cur_pts, axis=1)
                med = _np.median(errs)
                inlier = errs < (2.5 * med + 0.05)
                if inlier.sum() < 10:
                    break
                P = cur_pts[inlier]; Q = target[inlier]; W = weights[inlier]
                Wn = W / W.sum()
                cP = (P * Wn[:, None]).sum(axis=0); cQ = (Q * Wn[:, None]).sum(axis=0)
                Pc = P - cP; Qc = Q - cQ
                H = (Pc * W[:, None]).T @ Qc
                U, _, Vt = _np.linalg.svd(H)
                d = _np.sign(_np.linalg.det(Vt.T @ U.T))
                D = _np.diag([1.0, 1.0, d])
                R_step = Vt.T @ D @ U.T
                t_step = cQ - R_step @ cP
                cur_pts = (R_step @ cur_pts.T).T + t_step
                cur_R = R_step @ cur_R
                cur_t = R_step @ cur_t + t_step

            diffs = near_pts[None, :, :] - cur_pts[:, None, :]
            d2 = _np.sum(diffs * diffs, axis=2)
            nn_d = _np.sqrt(_np.min(d2, axis=1))
            med = _np.median(nn_d)
            inl = nn_d < (2.5 * med + 0.05)
            rmsd_k = float(_np.sqrt(_np.mean(nn_d[inl] ** 2))) if inl.sum() > 5 else float(_np.sqrt(_np.mean(nn_d ** 2)))

            if rmsd_k < overall_best_rmsd:
                overall_best_rmsd = rmsd_k
                overall_best_R = cur_R
                overall_best_t = cur_t

        center = (overall_best_R @ cap_top_local + overall_best_t).tolist()
        axis_world = (overall_best_R @ _np.array([0.0, 0.0, 1.0])).tolist()
        used_method = f"fallback_icp_weighted_spin{n_spin}"

    elapsed_ms = int((_time.time() - t0) * 1000)

    return {
        "center": center,
        "axis": axis_world,
        "rmsd": 0.0,  # cap-top non calcola rmsd ICP-style; per consistency
        "method": used_method,
        "algorithm": "server_weighted_icp_lab_public_v4",
        "elapsed_ms": elapsed_ms,
        "n_cap_top": n_cap_top_used,
        "cap_top_threshold": threshold_used,
        "fallback_reason": fallback_reason,
        "template_id": tid,
        "template_radius": radius,
        "crop_axial": cfg["crop_axial"],
        "crop_radial": cfg["crop_radial"],
        "branch": "lab-public-v4"
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



# v7.3.9.091 - Endpoint cambio password
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/me/change-password")
async def me_change_password(
    req: ChangePasswordRequest,
    current_user: dict = Depends(verify_token)
):
    """Cambia la password dell utente. Richiede la password attuale."""
    import os, hashlib, hmac
    if not req.current_password or not req.new_password:
        raise HTTPException(400, detail="Password mancanti.")
    if len(req.new_password) < 8:
        raise HTTPException(400, detail="La nuova password deve essere lunga almeno 8 caratteri.")
    if len(req.new_password) > 200:
        raise HTTPException(400, detail="Password troppo lunga.")
    if req.current_password == req.new_password:
        raise HTTPException(400, detail="La nuova password deve essere diversa dalla corrente.")
    
    # Carico user con hash + salt
    from database import get_pool
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT password_hash, salt FROM users WHERE id = $1",
            current_user["user_id"]
        )
        if not row:
            raise HTTPException(404, detail="Utente non trovato.")
        
        # Verifica password corrente
        h_check = hashlib.pbkdf2_hmac("sha256", req.current_password.encode(), row["salt"].encode(), 260000).hex()
        if not hmac.compare_digest(h_check, row["password_hash"]):
            raise HTTPException(403, detail="Password attuale non corretta.")
        
        # Imposta nuova password con nuovo salt
        new_salt = os.urandom(16).hex()
        new_hash = hashlib.pbkdf2_hmac("sha256", req.new_password.encode(), new_salt.encode(), 260000).hex()
        await conn.execute(
            "UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3",
            new_hash, new_salt, current_user["user_id"]
        )
    
    return {"ok": True, "message": "Password aggiornata con successo."}


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
    logger.info(f"[gdrive_callback] called code={bool(code)} state={bool(state)} error={error!r}")
    if error:
        logger.warning(f"[gdrive_callback] OAuth error from Google: {error}")
        from urllib.parse import quote as _q
        return RedirectResponse(
            url=f"/dashboard?tab=cloud&gdrive_error={_q(error)}", status_code=302)
    if not code or not state:
        logger.warning(f"[gdrive_callback] missing params code={bool(code)} state={bool(state)}")
        return RedirectResponse(
            url="/dashboard?tab=cloud&gdrive_error=missing_params", status_code=302)
    user_id = gdrive.verify_state_token(state)
    if not user_id:
        logger.warning("[gdrive_callback] state token invalid or expired")
        return RedirectResponse(
            url="/dashboard?tab=cloud&gdrive_error=state_invalid", status_code=302)
    logger.info(f"[gdrive_callback] state OK user_id={user_id}")
    try:
        tokens = gdrive.exchange_code_for_tokens(code)
        logger.info(f"[gdrive_callback] tokens received: refresh_token={'PRESENT' if tokens.get('refresh_token') else 'MISSING'} email={tokens.get('email','?')}")
    except Exception as e:
        from urllib.parse import quote as _q
        msg = str(e)
        logger.error(f"[gdrive_callback] exchange_code_for_tokens FAILED: {msg}")
        return RedirectResponse(
            url=f"/dashboard?tab=cloud&gdrive_error={_q(msg[:200])}", status_code=302)
    if not tokens.get("refresh_token"):
        logger.error("[gdrive_callback] refresh_token MISSING from tokens dict")
        return RedirectResponse(
            url="/dashboard?tab=cloud&gdrive_error=no_refresh_token", status_code=302)
    try:
        encrypted = gdrive.encrypt_token(tokens["refresh_token"])
        logger.info(f"[gdrive_callback] token encrypted len={len(encrypted)}")
    except Exception as e:
        logger.exception("[gdrive_callback] encrypt_token failed")
        return RedirectResponse(
            url="/dashboard?tab=cloud&gdrive_error=encrypt_failed", status_code=302)
    try:
        ok = await set_gdrive_credentials(
            user_id=user_id,
            email=tokens.get("email", ""),
            refresh_token_encrypted=encrypted,
        )
        logger.info(f"[gdrive_callback] set_gdrive_credentials ok={ok}")
    except Exception as e:
        logger.exception("[gdrive_callback] set_gdrive_credentials raised")
        return RedirectResponse(
            url="/dashboard?tab=cloud&gdrive_error=db_save_exception", status_code=302)
    if not ok:
        logger.error("[gdrive_callback] set_gdrive_credentials returned False")
        return RedirectResponse(
            url="/dashboard?tab=cloud&gdrive_error=db_save_failed", status_code=302)
    logger.info(f"[gdrive_callback] SUCCESS user_id={user_id}")
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
    contact_pro_role: Optional[str] = None
    notes: Optional[str] = None


class ContactUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    contact_pro_role: Optional[str] = None
    notes: Optional[str] = None


@app.get("/api/me/contacts")
async def me_list_contacts(
    pro_role: Optional[str] = None,
    current_user: dict = Depends(verify_token)
):
    """Lista contatti dell'utente corrente. Filtro opzionale ?pro_role=medico|laboratorio."""
    items = await list_user_contacts(current_user["user_id"])
    if pro_role:
        if pro_role not in ("medico", "laboratorio"):
            raise HTTPException(400, detail="pro_role deve essere 'medico' o 'laboratorio'.")
        items = [it for it in items if it.get("contact_pro_role") == pro_role]
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
    contact_pro_role = req.contact_pro_role.strip() if req.contact_pro_role else None
    if contact_pro_role and contact_pro_role not in ("medico", "laboratorio"):
        raise HTTPException(400, detail="contact_pro_role deve essere 'medico' o 'laboratorio'.")

    try:
        contact = await create_user_contact(
            owner_user_id=current_user["user_id"],
            contact_email=email,
            display_name=name,
            role=role,
            contact_pro_role=contact_pro_role,
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
    contact_pro_role = req.contact_pro_role.strip() if req.contact_pro_role is not None else None
    if contact_pro_role and contact_pro_role not in ("medico", "laboratorio", ""):
        raise HTTPException(400, detail="contact_pro_role deve essere 'medico'/'laboratorio'/''.")
    ok = await update_user_contact(
        contact_id, current_user["user_id"],
        display_name=name, role=role, contact_pro_role=contact_pro_role, notes=notes
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
    if not creds_data or not creds_data.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Google Drive non connesso. Vai su Cloud per collegarlo.")
    try:
        refresh_token = gdrive.decrypt_token(creds_data["refresh_token_encrypted"])
    except Exception as e:
        logger.exception("decrypt refresh_token fallito")
        raise HTTPException(500, detail="Token Drive corrotto. Disconnetti e riconnetti.")
    try:
        result = gdrive.browse_folder(refresh_token, folder_id=folder_id)
        # Aggiungo breadcrumb se siamo dentro una sottocartella
        if folder_id:
            try:
                breadcrumb = gdrive.get_folder_breadcrumb(refresh_token, folder_id)
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
    if not creds_data or not creds_data.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Google Drive non connesso.")
    return {
        "file_id": file_id,
        "web_view_link": f"https://drive.google.com/file/d/{file_id}/view",
        "download_link": f"https://drive.google.com/uc?export=download&id={file_id}",
    }







# ── v7.3.9.088 - Pro-role endpoints ────────────────────────────────────────
class ProRoleRequest(BaseModel):
    pro_role: str  # 'medico' | 'laboratorio'


@app.get("/api/me/pro-role")
async def me_get_pro_role(current_user: dict = Depends(verify_token)):
    """Ritorna il pro_role dell\'utente loggato (o null se non ancora scelto)."""
    pro_role = await get_user_pro_role(current_user["user_id"])
    return {"pro_role": pro_role}


@app.post("/api/me/pro-role")
async def me_set_pro_role(
    req: ProRoleRequest,
    current_user: dict = Depends(verify_token)
):
    """Imposta il pro_role dell\'utente (medico/laboratorio).
    Si puo\' settare una sola volta. Cambi successivi richiedono supporto admin."""
    if req.pro_role not in ("medico", "laboratorio"):
        raise HTTPException(400, detail="pro_role deve essere 'medico' o 'laboratorio'")
    try:
        ok = await set_user_pro_role(current_user["user_id"], req.pro_role)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    if not ok:
        # Era gia\' impostato - ritorno il valore corrente
        current = await get_user_pro_role(current_user["user_id"])
        raise HTTPException(409, detail=f"Ruolo gia\' impostato: {current}")
    return {"pro_role": req.pro_role, "ok": True}


@app.get("/api/me/gdrive/file/{file_id}/content")
async def me_gdrive_file_content(
    file_id: str,
    current_user: dict = Depends(verify_token)
):
    """Proxy del contenuto file da Drive. Streamed bytes con Content-Type
    inferito. Usato dal frontend per anteprime (immagini, pdf, stl, video).
    v7.3.9.075 - usa la funzione esistente download_file_bytes che ritorna
    (data, name, mime_type) come tupla."""
    from fastapi.responses import Response
    creds_data = await get_gdrive_credentials(current_user["user_id"])
    if not creds_data or not creds_data.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Google Drive non connesso.")
    try:
        refresh_token = gdrive.decrypt_token(creds_data["refresh_token_encrypted"])
    except Exception:
        logger.exception("decrypt refresh_token fallito (content endpoint)")
        raise HTTPException(500, detail="Token Drive corrotto. Disconnetti e riconnetti.")
    try:
        data, name, mime_type = gdrive.download_file_bytes(refresh_token, file_id)
    except Exception as e:
        logger.error(f"[gdrive content] file={file_id} error: {e}")
        raise HTTPException(500, detail=f"Errore download: {str(e)[:200]}")
    headers = {
        "Content-Disposition": f'inline; filename="{name}"',
        "Cache-Control": "private, max-age=300",
    }
    return Response(content=data, media_type=mime_type or "application/octet-stream", headers=headers)

# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.062 - CARTELLE CONDIVISE (Fase F)
# Sistema invito + accept tra utenti Synthesis. Cartelle Drive condivise via
# replica server-mediata (no Google Drive sharing nativo: scope drive.file
# permette accesso solo ai file creati da noi, non condivisione classica).
# ─────────────────────────────────────────────────────────────────────────────

class CreateFolderBody(BaseModel):
    name: str
    parent_id: Optional[str] = None  # None = dentro Syntesis-ICP root



@app.get("/api/me/gdrive/access-token")
async def me_gdrive_access_token(
    current_user: dict = Depends(verify_token)
):
    """Ritorna un access_token Drive short-lived per uso lato browser.
    Permette al frontend di scaricare file direttamente da Drive,
    bypassando il nostro server. v7.3.9.079 - ottimizzazione bandwidth."""
    creds_data = await get_gdrive_credentials(current_user["user_id"])
    if not creds_data or not creds_data.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Google Drive non connesso.")
    try:
        refresh_token = gdrive.decrypt_token(creds_data["refresh_token_encrypted"])
    except Exception:
        logger.exception("decrypt refresh_token fallito (access-token endpoint)")
        raise HTTPException(500, detail="Token Drive corrotto. Disconnetti e riconnetti.")
    try:
        access_token, expires_in = gdrive.get_access_token(refresh_token)
        return {
            "access_token": access_token,
            "expires_in": expires_in,
            "token_type": "Bearer"
        }
    except Exception as e:
        logger.error(f"[access-token] error: {e}")
        raise HTTPException(500, detail=f"Errore generazione token: {str(e)[:200]}")

@app.post("/api/me/folders")
async def me_create_folder(
    body: CreateFolderBody,
    current_user: dict = Depends(verify_token),
):
    """Crea una nuova cartella nel Drive dell'utente (dentro Syntesis-ICP o sub)."""
    creds_data = await get_gdrive_credentials(current_user["user_id"])
    if not creds_data or not creds_data.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Google Drive non connesso.")
    name = (body.name or "").strip()
    if not name or len(name) > 120:
        raise HTTPException(400, detail="Nome cartella non valido (1-120 char).")
    try:
        refresh_token = gdrive.decrypt_token(creds_data["refresh_token_encrypted"])
        result = gdrive.create_folder_in(refresh_token, name, body.parent_id)
        return result
    except Exception as e:
        logger.exception("create_folder fallito")
        raise HTTPException(500, detail=f"Errore Drive: {e}")


class CreateSharedFolderBody(BaseModel):
    folder_drive_id: str
    folder_name: str
    description: Optional[str] = None
    member_emails: list[str]

@app.post("/api/me/shared-folders")
async def me_create_shared_folder(
    body: CreateSharedFolderBody,
    current_user: dict = Depends(verify_token),
):
    """Registra una condivisione: la cartella esiste gia' su Drive (creata
    in precedenza con /api/me/folders), questa chiamata invita i membri."""
    creds_data = await get_gdrive_credentials(current_user["user_id"])
    if not creds_data or not creds_data.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Google Drive non connesso.")
    if not body.member_emails:
        raise HTTPException(400, detail="Nessun destinatario specificato.")

    sf = await create_shared_folder(
        owner_user_id=current_user["user_id"],
        folder_name=body.folder_name,
        owner_drive_folder_id=body.folder_drive_id,
        description=body.description,
    )
    invited = []
    skipped = []
    emails_sent = 0
    base_url = os.getenv("PUBLIC_BASE_URL", "https://syntesis-icp-production.up.railway.app")
    owner_name = current_user.get("name") or current_user.get("email", "")
    owner_email = current_user.get("email", "")
    for email in body.member_emails:
        email = (email or "").lower().strip()
        if not email or email == current_user.get("email", "").lower():
            continue
        m = await add_shared_folder_member(
            shared_folder_id=sf["id"],
            member_email=email,
            invited_by_user_id=current_user["user_id"],
        )
        if m.get("error"):
            skipped.append({"email": email, "reason": m["error"]})
            continue
        invited.append(m)
        # Email transazionale (silently fail se Resend non configurato)
        try:
            if m.get("member_user_id"):
                # Utente gia' registrato -> link al dashboard
                ok_email = email_service.send_share_invite_to_existing_user(
                    to_email=email,
                    to_name=None,  # nome utente non in scope qui, prendiamo dalla email
                    owner_name=owner_name,
                    owner_email=owner_email,
                    folder_name=body.folder_name,
                    description=body.description,
                    accept_url=f"{base_url}/dashboard?tab=files",
                )
            else:
                # Utente non registrato -> link a registrazione
                ok_email = email_service.send_share_invite_to_unregistered(
                    to_email=email,
                    owner_name=owner_name,
                    owner_email=owner_email,
                    folder_name=body.folder_name,
                    description=body.description,
                    register_url=f"{base_url}/analizzare?invite={sf['id']}",
                )
            if ok_email:
                emails_sent += 1
        except Exception as e:
            logger.warning(f"[shared-folder] email send fail to={email}: {e}")
    return {"shared_folder": sf, "invited": invited, "skipped": skipped,
            "emails_sent": emails_sent, "emails_configured": email_service.is_configured()}


@app.get("/api/me/shared-folders")
async def me_list_shared_folders(current_user: dict = Depends(verify_token)):
    """Lista cartelle che ho condiviso io (owned) e quelle condivise con me (member)."""
    owned = await list_owned_shared_folders(current_user["user_id"])
    member = await list_member_shared_folders(current_user["user_id"])
    return {"owned": owned, "member": member}


@app.get("/api/me/shared-folders/incoming")
async def me_list_incoming_invites(current_user: dict = Depends(verify_token)):
    """Inviti pending per me (non ancora accettati o rifiutati)."""
    invites = await list_pending_invites_for_user(
        current_user["user_id"],
        current_user.get("email", "")
    )
    return {"invites": invites}


@app.post("/api/me/shared-folders/invites/{membership_id}/accept")
async def me_accept_invite(
    membership_id: str,
    current_user: dict = Depends(verify_token),
):
    """Accetto un invito: creo cartella mirror nel mio Drive e replica i file
    esistenti dal Drive del creatore al mio (sync server-mediato, fino a 200 file)."""
    membership = await get_membership(membership_id)
    if not membership:
        raise HTTPException(404, detail="Invito non trovato.")
    if membership["status"] != "pending":
        raise HTTPException(400, detail=f"Invito gia' {membership['status']}.")

    # Verifica che l'invito sia per me (per email o user_id)
    user_email = (current_user.get("email") or "").lower().strip()
    if (membership["member_user_id"] != current_user["user_id"] and
        (membership["member_email"] or "").lower() != user_email):
        raise HTTPException(403, detail="Questo invito non e' per te.")

    sf = await get_shared_folder(membership["shared_folder_id"])
    if not sf:
        raise HTTPException(404, detail="Cartella condivisa non esiste piu'.")

    # Drive del destinatario
    my_creds = await get_gdrive_credentials(current_user["user_id"])
    if not my_creds or not my_creds.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Devi prima connettere Google Drive.")
    my_refresh = gdrive.decrypt_token(my_creds["refresh_token_encrypted"])

    # Drive dell'owner
    owner_creds = await get_gdrive_credentials(sf["owner_user_id"])
    if not owner_creds or not owner_creds.get("refresh_token_encrypted"):
        raise HTTPException(503,
            detail="Il proprietario ha disconnesso il suo Drive. Sincronizzazione non possibile.")
    owner_refresh = gdrive.decrypt_token(owner_creds["refresh_token_encrypted"])

    # 1. Creo cartella mirror nel mio Drive (dentro Syntesis-ICP)
    mirror_name = f"[Condiviso] {sf['folder_name']}"
    try:
        mirror = gdrive.create_folder_in(my_refresh, mirror_name, parent_id=None)
    except Exception as e:
        logger.exception("create mirror folder fallito")
        raise HTTPException(500, detail=f"Errore creazione cartella mirror: {e}")

    # 2. Aggiorno DB: status=active + member_drive_folder_id
    ok = await accept_shared_invite(
        membership_id=membership_id,
        accepting_user_id=current_user["user_id"],
        user_email=user_email,
        member_drive_folder_id=mirror["id"],
    )
    if not ok:
        raise HTTPException(500, detail="Aggiornamento DB fallito.")

    # 3. Replica i file esistenti (sync iniziale, fino a 200 file totali)
    replicated = 0
    errors = 0
    try:
        files_to_replicate = gdrive.list_files_recursive(
            owner_refresh, sf["owner_drive_folder_id"], max_files=200
        )
        logger.info(f"[accept_invite] {len(files_to_replicate)} files to replicate")
        for f in files_to_replicate:
            try:
                # Se il file e' troppo grande, skippo
                if f.get("size", 0) > 100 * 1024 * 1024:
                    errors += 1
                    continue
                # Scarico dal Drive owner
                data, _, mime = gdrive.download_file_bytes(owner_refresh, f["id"])
                # Trovo o creo la sottocartella nel mirror
                target_folder = gdrive.ensure_subfolder_path(
                    my_refresh, mirror["id"], f.get("relative_path", "")
                )
                # Carico nel mio Drive
                gdrive.upload_file_to_folder(
                    my_refresh, target_folder, f["name"], data, mime
                )
                replicated += 1
            except Exception as e:
                logger.warning(f"[accept_invite] replicate fail '{f['name']}': {e}")
                errors += 1
    except Exception as e:
        logger.exception("sync iniziale fallito (cartella accettata, file da risincronizzare)")

    return {
        "ok": True,
        "shared_folder_id": sf["id"],
        "mirror_drive_folder_id": mirror["id"],
        "files_replicated": replicated,
        "files_failed": errors,
    }


@app.post("/api/me/shared-folders/invites/{membership_id}/decline")
async def me_decline_invite(
    membership_id: str,
    current_user: dict = Depends(verify_token),
):
    user_email = (current_user.get("email") or "").lower().strip()
    ok = await decline_shared_invite(
        membership_id=membership_id,
        declining_user_id=current_user["user_id"],
        user_email=user_email,
    )
    if not ok:
        raise HTTPException(404, detail="Invito non trovato o gia' processato.")
    return {"ok": True}


@app.post("/api/me/folders/{folder_drive_id}/upload")
async def me_upload_file_to_folder(
    folder_drive_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: dict = Depends(verify_token),
):
    """Upload di un file in una cartella Drive. Se la cartella e' condivisa
    (owner o member), replica il file sui Drive degli altri membri attivi."""
    creds_data = await get_gdrive_credentials(current_user["user_id"])
    if not creds_data or not creds_data.get("refresh_token_encrypted"):
        raise HTTPException(409, detail="Google Drive non connesso.")
    refresh_token = gdrive.decrypt_token(creds_data["refresh_token_encrypted"])

    # Limite upload: 50MB
    MAX_SIZE = 50 * 1024 * 1024
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(413, detail="File troppo grande (max 50MB).")
    if len(data) == 0:
        raise HTTPException(400, detail="File vuoto.")

    filename = file.filename or "file"
    mime = file.content_type or "application/octet-stream"

    # Upload nel Drive dell'utente
    try:
        result = gdrive.upload_file_to_folder(refresh_token, folder_drive_id, filename, data, mime)
    except Exception as e:
        logger.exception("upload fallito")
        raise HTTPException(500, detail=f"Errore upload Drive: {e}")

    # Verifico se e' una cartella condivisa
    shared = await get_shared_folder_by_drive_id(folder_drive_id, current_user["user_id"])
    if shared:
        # Replica negli altri Drive in background
        background_tasks.add_task(
            _replicate_file_to_members,
            shared_folder_id=shared["id"],
            owner_user_id=shared["owner_user_id"],
            uploader_user_id=current_user["user_id"],
            uploader_drive_folder_id=folder_drive_id,
            file_data=data,
            filename=filename,
            mime_type=mime,
        )

    return {"ok": True, "file": result, "replicating": shared is not None}


async def _replicate_file_to_members(
    shared_folder_id: str,
    owner_user_id: str,
    uploader_user_id: str,
    uploader_drive_folder_id: str,
    file_data: bytes,
    filename: str,
    mime_type: str,
):
    """Background task: replica un file su tutti i Drive dei membri attivi
    (escluso chi ha caricato). Per la replica all'owner, usa owner_drive_folder_id."""
    try:
        sf = await get_shared_folder(shared_folder_id)
        if not sf:
            return
        active_members = await list_active_members_of_folder(shared_folder_id)
        # Ricavo i target: owner + tutti i membri attivi tranne chi ha caricato
        targets = []
        if owner_user_id != uploader_user_id:
            targets.append({"user_id": owner_user_id,
                            "drive_folder_id": sf["owner_drive_folder_id"]})
        for m in active_members:
            if m["member_user_id"] and m["member_user_id"] != uploader_user_id:
                targets.append({"user_id": m["member_user_id"],
                                "drive_folder_id": m["member_drive_folder_id"]})
        for t in targets:
            try:
                creds = await get_gdrive_credentials(t["user_id"])
                if not creds or not creds.get("refresh_token_encrypted"):
                    logger.warning(f"[replicate] skip {t['user_id']}: no creds")
                    continue
                rt = gdrive.decrypt_token(creds["refresh_token_encrypted"])
                gdrive.upload_file_to_folder(rt, t["drive_folder_id"], filename, file_data, mime_type)
                logger.info(f"[replicate] OK -> user={t['user_id']} folder={t['drive_folder_id']}")
            except Exception as e:
                logger.warning(f"[replicate] fail user={t['user_id']}: {e}")
    except Exception as e:
        logger.exception("replicate task crashed")
    try:
        refresh_token = gdrive.decrypt_token(creds["refresh_token_encrypted"])
        service = gdrive.get_drive_service(refresh_token)
        files = gdrive.list_folder(service, proj["gdrive_folder_id"])
        return {"files": files, "folder_id": proj["gdrive_folder_id"]}
    except Exception as e:
        logger.error(f"list files failed: {e}")
        raise HTTPException(502, detail=f"Drive API error: {str(e)[:200]}")
