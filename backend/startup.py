#!/usr/bin/env python3
"""Startup script: scarica i file static mancanti da GitHub"""
import os
import urllib.request
from pathlib import Path

STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(exist_ok=True)

GITHUB_RAW = "https://raw.githubusercontent.com/ABC-CADCAM-Ordini/syntesis-icp/main/backend/static"

# 8.80.4: lista svuotata. L'unica voce era syntesis-calibrator-v4.html, reliquia
# del modulo Calibrator dismesso (v7.3.9.001, cleanup 8.2.3): il download da
# raw.githubusercontent falliva SEMPRE in silenzio a ogni boot (repo privato ->
# 404) e il file non e' referenziato da alcuna route. Il meccanismo resta per
# eventuali futuri asset pubblici.
FILES_TO_CHECK = []

for fname in FILES_TO_CHECK:
    fpath = STATIC_DIR / fname
    if not fpath.exists():
        url = f"{GITHUB_RAW}/{fname}"
        print(f"Downloading {fname} from GitHub...")
        try:
            urllib.request.urlretrieve(url, str(fpath))
            print(f"  OK: {fpath.stat().st_size} bytes")
        except Exception as e:
            print(f"  ERROR: {e}")
    else:
        print(f"OK (exists): {fname} ({fpath.stat().st_size} bytes)")
