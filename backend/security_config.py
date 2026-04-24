"""
Syntesis-ICP — Validazione della configurazione di sicurezza.

Un servizio che parte con valori di default insicuri e` un servizio
compromesso in attesa che qualcuno se ne accorga. Meglio che il deploy
fallisca rumorosamente all'avvio invece di emettere token JWT firmati
con "CAMBIA-QUESTA-CHIAVE-IN-PRODUZIONE" per ore prima di un incidente.

Si invoca una sola volta, subito dopo l'import del modulo, in main.py.
"""

import os
import sys


# Valori di default dei moduli originari. Se li troviamo in produzione
# significa che una env var non e` stata impostata.
_INSECURE_JWT_DEFAULT = "CAMBIA-QUESTA-CHIAVE-IN-PRODUZIONE"
_INSECURE_DB_DEFAULT = "postgresql://postgres:password@localhost:5432/syntesis"
_MIN_JWT_SECRET_LEN = 32


def validate_security_config() -> None:
    """Rifiuta i default pericolosi quando ENV=production.

    In sviluppo locale (ENV=development) passa con warning, non con errore:
    cosi` si puo` lavorare senza dover impostare JWT_SECRET a mano.

    Raises:
        RuntimeError: se uno o piu` requisiti di sicurezza non sono soddisfatti
                      in ambiente di produzione.
    """
    env = os.getenv("ENV", "production").lower()

    jwt_secret = os.getenv("JWT_SECRET", "")
    db_url = os.getenv("DATABASE_URL", "")
    origins_raw = os.getenv("ALLOWED_ORIGINS", "")
    origins = [o.strip() for o in origins_raw.split(",") if o.strip()]

    errors = []
    warnings = []

    # 1. JWT secret
    if not jwt_secret:
        errors.append("JWT_SECRET non impostato.")
    elif jwt_secret == _INSECURE_JWT_DEFAULT:
        errors.append("JWT_SECRET lasciato al valore di default.")
    elif len(jwt_secret) < _MIN_JWT_SECRET_LEN:
        errors.append(
            f"JWT_SECRET troppo corto ({len(jwt_secret)} caratteri, "
            f"minimo {_MIN_JWT_SECRET_LEN})."
        )

    # 2. Database URL
    if not db_url:
        errors.append("DATABASE_URL non impostato.")
    elif db_url == _INSECURE_DB_DEFAULT or "postgres:password@localhost" in db_url:
        errors.append("DATABASE_URL contiene la password di default 'password'.")

    # 3. CORS
    if not origins:
        warnings.append("ALLOWED_ORIGINS vuoto: nessun cross-origin accettato.")
    elif "*" in origins:
        errors.append(
            "ALLOWED_ORIGINS contiene '*': incompatibile con "
            "allow_credentials=True, apertura al mondo di endpoint autenticati."
        )

    # 4. OAuth audience (solo warning: il social login e` opzionale)
    if not os.getenv("GOOGLE_CLIENT_ID"):
        warnings.append("GOOGLE_CLIENT_ID non impostato: Google login disabilitato.")
    if not os.getenv("APPLE_CLIENT_ID"):
        warnings.append("APPLE_CLIENT_ID non impostato: Apple login disabilitato.")

    # Stampa warning su stderr (visibili nei log Railway senza essere fatali)
    for w in warnings:
        print(f"[security_config] WARNING: {w}", file=sys.stderr)

    if errors:
        msg = (
            "Configurazione di sicurezza non valida:\n  - "
            + "\n  - ".join(errors)
            + f"\n\nAmbiente rilevato: ENV={env}."
        )
        if env == "development":
            # In dev: warning rumoroso, non blocca
            print(f"[security_config] ERRORE (DEV, non bloccante):\n{msg}", file=sys.stderr)
        else:
            # In prod: boot fallisce
            raise RuntimeError(msg)
