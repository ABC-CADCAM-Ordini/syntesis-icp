"""
Syntesis-ICP — Backend API
Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
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

from auth import router as auth_router, verify_token
from icp_engine import analyze_stl_pair
from pdf_gen import generate_pdf
from database import init_db, log_analysis, get_leaderboard, save_result
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
    # Nessuna decodifica o riscrittura al boot (v7.3.3+).
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

@app.get("/replacer", include_in_schema=False)
async def replacer_page():
    _rep = _STATIC_DIR / "syntesis-icp-replacer.html"
    if _rep.exists():
        return FileResponse(str(_rep), headers=_NO_STORE_HEADERS)
    return JSONResponse({"error": "Replacer not found"}, status_code=404)

@app.get("/analizzare", include_in_schema=False)
async def analyzer_page():
    _an = _STATIC_DIR / "syntesis-analyzer-v3b.html"
    if _an.exists():
        return FileResponse(str(_an), headers=_NO_STORE_HEADERS)
    return JSONResponse({"error": "Analyzer not found"}, status_code=404)

@app.get("/calibrare", include_in_schema=False)
async def calibrare_page():
    _cal = _STATIC_DIR / "syntesis-calibrator-v4.html"
    if _cal.exists():
        return FileResponse(str(_cal), headers=_NO_STORE_HEADERS)
    # Fallback: serve da GitHub raw se il file locale non è presente
    import httpx
    raw_url = "https://raw.githubusercontent.com/ABC-CADCAM-Ordini/syntesis-icp/main/backend/static/syntesis-calibrator-v4.html"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(raw_url)
            if r.status_code == 200:
                from fastapi.responses import HTMLResponse
                return HTMLResponse(content=r.text, headers=_NO_STORE_HEADERS)
    except Exception:
        pass
    return JSONResponse({"error": "Calibrare not found"}, status_code=404)

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

    analysis_id = str(uuid.uuid4())
    await log_analysis(
        analysis_id=analysis_id,
        user_id=current_user["user_id"],
        filename_a=file_a.filename,
        filename_b=file_b.filename,
        score=result["score"],
        rmsd=result["icp_rmsd"]
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


