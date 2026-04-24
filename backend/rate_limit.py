"""
Syntesis-ICP — Rate limiting per IP tramite SlowAPI.

L'endpoint /api/analyze-public e` pubblico e non autenticato: con due file
STL da 50 MB a richiesta, un attaccante blocca i worker Uvicorn in pochi
secondi. Il rate limit in-memory esistente (in main.py) agisce per user_id
e serve solo sugli endpoint autenticati.

Questo modulo aggiunge un secondo strato per IP, indipendente dall'auth.

Railway sta dietro a un reverse proxy: il client reale e` nel primo elemento
dell'header X-Forwarded-For. Senza questa cura, tutte le richieste Railway
sembrerebbero arrivare da un unico IP interno e il limite non avrebbe senso.
"""

import os
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def client_ip_key(request: Request) -> str:
    """Key function per SlowAPI che rispetta la catena di proxy.

    Controlla X-Forwarded-For (Railway lo imposta), e in assenza ripiega
    sull'IP remoto diretto della connessione.
    """
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        # Primo IP nella catena = client reale.
        # I successivi sono proxy intermedi.
        first = xff.split(",")[0].strip()
        if first:
            return first
    real_ip = request.headers.get("x-real-ip", "")
    if real_ip:
        return real_ip.strip()
    return get_remote_address(request)


# Limite di default applicato globalmente (usato come fallback).
# Limite specifico per endpoint pubblici pesanti: override con decorator.
DEFAULT_LIMIT = os.getenv("RATE_LIMIT_DEFAULT", "120/hour")
ANALYZE_PUBLIC_LIMIT = os.getenv("RATE_LIMIT_ANALYZE_PUBLIC", "10/hour")

limiter = Limiter(
    key_func=client_ip_key,
    default_limits=[DEFAULT_LIMIT],
    # In memory: sopravvive solo all'interno di un worker.
    # Per un singolo servizio Railway con 2 worker questo e` accettabile:
    # un attaccante puo` raddoppiare il limite, non sfondarlo.
    # Per scalare su N repliche, impostare RATE_LIMIT_STORAGE a un URL redis://.
    storage_uri=os.getenv("RATE_LIMIT_STORAGE", "memory://"),
)
