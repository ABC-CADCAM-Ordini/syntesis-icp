"""
Syntesis-ICP — Backend API
Copyright (C) Francesco Biaggini. Tutti i diritti riservati.
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Header
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

from auth import router as auth_router, verify_token
from icp_engine import analyze_stl_pair
from pdf_gen import generate_pdf
from database import init_db, log_analysis, get_leaderboard, save_result

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(
    title="Syntesis-ICP API",
    version="1.0.0",
    docs_url=None,   # disabilita Swagger pubblico
    redoc_url=None,
    lifespan=lifespan
)

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

@app.get("/", include_in_schema=False)
async def serve_frontend():
    if _INDEX.exists():
        return FileResponse(str(_INDEX))
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
        result = await asyncio.get_event_loop().run_in_executor(
            None, analyze_stl_pair, data_a, data_b, file_a.filename, file_b.filename
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


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/debug/fs", include_in_schema=False)
async def debug_fs():
    import os, pathlib
    app_dir = pathlib.Path("/app")
    result = {}
    for root, dirs, files in os.walk("/app"):
        rel = os.path.relpath(root, "/app")
        if rel == ".":
            result["files_in_app"] = files
            result["dirs_in_app"] = dirs
        if "static" in root:
            result[f"static_contents_{rel}"] = files
    result["__file__"] = __file__
    result["cwd"] = os.getcwd()
    result["index_exists"] = str(_INDEX)
    result["index_is_file"] = _INDEX.is_file()
    return result
