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
    # Scrivi frontend HTML su disco se non presente
    import gzip, base64 as _b64
    _static = pathlib.Path("/app/static")
    _static.mkdir(exist_ok=True)
    _idx = _static / "index.html"
    if not _idx.exists():
        _idx.write_bytes(gzip.decompress(_b64.b64decode(_HTML_B64)))
        logger.info("Frontend HTML estratto in /app/static/index.html")
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
# ── Frontend HTML embedded (base64+gzip) ─────────────────────────────────────
_HTML_B64 = "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"
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

