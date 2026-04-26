"""
Autenticazione JWT per Syntesis-ICP

v7.3.1 — verifica firma crittografica per Apple ID token e claim audience
          per Google ID token. La sessione Syntesis continua a usare HMAC-SHA256
          in casa (nessuna dipendenza esterna). Solo le verifiche di token di
          terze parti passano per PyJWT.
"""

import os
import hashlib
import hmac
import time
import json
import base64
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from database import get_user_by_email, create_user, verify_license

router = APIRouter()
security = HTTPBearer()

SECRET_KEY = os.getenv("JWT_SECRET", "CAMBIA-QUESTA-CHIAVE-IN-PRODUZIONE")
TOKEN_EXPIRE_HOURS = int(os.getenv("TOKEN_EXPIRE_HOURS", "24"))

# OAuth client IDs per validazione audience dei token di terze parti
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID", "")   # Bundle ID o Services ID
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"


# ── JWT minimalista (nessuna dipendenza esterna) ──────────────────────────────
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * (pad % 4))

def create_token(payload: dict) -> str:
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload["exp"] = int(time.time()) + TOKEN_EXPIRE_HOURS * 3600
    body = _b64url(json.dumps(payload).encode())
    msg = f"{header}.{body}".encode()
    sig = hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).digest()
    return f"{header}.{body}.{_b64url(sig)}"

def decode_token(token: str) -> dict:
    try:
        header, body, sig = token.split(".")
        msg = f"{header}.{body}".encode()
        expected = hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64url_decode(sig)):
            raise ValueError("Firma non valida")
        payload = json.loads(_b64url_decode(body))
        if payload.get("exp", 0) < time.time():
            raise ValueError("Token scaduto")
        return payload
    except Exception as e:
        raise HTTPException(401, detail=f"Token non valido: {e}")


async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    return decode_token(credentials.credentials)


# ── Password hashing ──────────────────────────────────────────────────────────
def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    if not salt:
        salt = os.urandom(16).hex()
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
    return h.hex(), salt

def verify_password(password: str, hashed: str, salt: str) -> bool:
    h, _ = hash_password(password, salt)
    return hmac.compare_digest(h, hashed)


# ── Endpoints ─────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str
    license_key: Optional[str] = None

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    license_key: str
    organization: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    user = await get_user_by_email(req.email)
    if not user:
        raise HTTPException(401, detail="Credenziali non valide.")
    if not verify_password(req.password, user["password_hash"], user["salt"]):
        raise HTTPException(401, detail="Credenziali non valide.")
    if not user["active"]:
        raise HTTPException(403, detail="Account disabilitato. Contatta il supporto.")

    token = create_token({
        "user_id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "org": user.get("organization", "")
    })
    return {
        "access_token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "organization": user.get("organization")
        }
    }


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest):
    # Verifica licenza
    license_ok = await verify_license(req.license_key)
    if not license_ok:
        raise HTTPException(403, detail="Chiave di licenza non valida o già usata.")

    existing = await get_user_by_email(req.email)
    if existing:
        raise HTTPException(409, detail="Email già registrata.")

    if len(req.password) < 8:
        raise HTTPException(400, detail="La password deve essere di almeno 8 caratteri.")

    hashed, salt = hash_password(req.password)
    # v7.3.9.040: cattura race condition fra verify_license e create_user
    try:
        user_id = await create_user(
            email=req.email,
            name=req.name,
            password_hash=hashed,
            salt=salt,
            organization=req.organization,
            license_key=req.license_key
        )
    except ValueError as ve:
        raise HTTPException(409, detail=str(ve))

    token = create_token({
        "user_id": user_id,
        "email": req.email,
        "name": req.name,
        "role": "user",
        "org": req.organization or ""
    })
    return {
        "access_token": token,
        "user": {
            "id": user_id,
            "email": req.email,
            "name": req.name,
            "role": "user",
            "organization": req.organization
        }
    }


@router.get("/me")
async def me(current_user: dict = Depends(verify_token)):
    return current_user


# ── Social Login (Google, Apple, Facebook) ────────────────────────────────────
class SocialLoginRequest(BaseModel):
    provider: str          # "google" | "apple" | "facebook"
    token: str             # ID token (Google/Apple) o access token (Facebook)
    name: Optional[str] = ""
    email: Optional[str] = ""
    license_key: Optional[str] = ""  # v7.3.9.041: richiesta solo per primo accesso (registrazione)


async def _verify_google_token(token: str) -> dict:
    """Verifica ID token Google tramite Google tokeninfo API.

    Valida firma (lato Google), audience (il nostro Client ID) e issuer.
    Senza il check di audience, un token emesso per un'altra applicazione
    Google varrebbe come login per Syntesis: una vulnerabilità silenziosa
    ma reale.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, detail="Google login non configurato sul server.")

    import urllib.request, json as _json
    url = f"https://oauth2.googleapis.com/tokeninfo?id_token={token}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = _json.loads(resp.read())
        if "email" not in data:
            raise ValueError("Email non presente nel token Google.")
        if data.get("aud") != GOOGLE_CLIENT_ID:
            raise ValueError("Audience del token Google non corrisponde.")
        if data.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise ValueError("Issuer del token Google non valido.")
        # Google ritorna 'email_verified' come stringa "true"
        if str(data.get("email_verified", "")).lower() != "true":
            raise ValueError("Email Google non verificata.")
        return {"email": data["email"], "name": data.get("name", "")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, detail=f"Token Google non valido: {e}")


_apple_jwks_client = None

def _get_apple_jwks_client():
    """JWKS client Apple con cache interna delle chiavi pubbliche.

    Lazy init per evitare chiamate di rete al boot quando Apple login
    non e` configurato.
    """
    global _apple_jwks_client
    if _apple_jwks_client is None:
        try:
            import jwt
            from jwt import PyJWKClient
        except ImportError as e:
            raise HTTPException(500, detail=f"PyJWT non installato: {e}")
        _apple_jwks_client = PyJWKClient(APPLE_JWKS_URL, cache_keys=True, lifespan=86400)
    return _apple_jwks_client


async def _verify_apple_token(token: str, fallback_email: str = "", fallback_name: str = "") -> dict:
    """Verifica Apple ID token con firma RS256 contro le JWK pubbliche Apple.

    Il codice precedente decodificava solo il payload in base64 senza verificare
    la firma: chiunque poteva forgiare un JWT con qualsiasi email e ottenere un
    account. Questo fix chiude completamente quella via.

    Apple invia l'email solo al primo login; nei token successivi l'email manca
    e bisogna aver memorizzato il mapping sub -> email. Per retrocompatibilita`
    accettiamo anche un fallback_email fornito dal frontend in prima connessione.
    """
    if not APPLE_CLIENT_ID:
        raise HTTPException(500, detail="Apple login non configurato sul server.")

    try:
        import jwt
    except ImportError as e:
        raise HTTPException(500, detail=f"PyJWT non installato: {e}")

    try:
        client = _get_apple_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=APPLE_CLIENT_ID,
            issuer=APPLE_ISSUER,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, detail="Token Apple scaduto.")
    except jwt.InvalidAudienceError:
        raise HTTPException(401, detail="Audience del token Apple non corrisponde.")
    except jwt.InvalidIssuerError:
        raise HTTPException(401, detail="Issuer del token Apple non valido.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, detail=f"Token Apple non valido: {e}")

    email = (payload.get("email") or fallback_email or "").strip()
    if not email:
        raise HTTPException(400, detail="Email Apple non disponibile.")
    return {"email": email, "name": fallback_name or ""}


async def _verify_facebook_token(access_token: str, name: str, email: str) -> dict:
    """Verifica access token Facebook tramite Graph API."""
    import urllib.request, json as _json
    url = f"https://graph.facebook.com/me?fields=id,name,email&access_token={access_token}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = _json.loads(resp.read())
        if "id" not in data:
            raise ValueError("Token Facebook non valido")
        return {
            "email": data.get("email", email),
            "name": data.get("name", name)
        }
    except Exception as e:
        raise HTTPException(401, detail=f"Token Facebook non valido: {e}")


@router.post("/social", response_model=TokenResponse)
async def social_login(req: SocialLoginRequest):
    """v7.3.9.041: Login social.
    - Utente gia' registrato: login normale (la licenza era stata fornita al primo accesso).
    - Utente nuovo: richiede license_key valida e non ancora usata.
    Niente piu' bypass licenza tramite social provider.
    """
    import uuid as _uuid

    # Verifica token con il provider
    provider = req.provider.lower()
    if provider == "google":
        user_info = await _verify_google_token(req.token)
    elif provider == "apple":
        user_info = await _verify_apple_token(req.token, req.email or "", req.name or "")
    elif provider == "facebook":
        user_info = await _verify_facebook_token(req.token, req.name or "", req.email or "")
    else:
        raise HTTPException(400, detail=f"Provider non supportato: {req.provider}")

    email = user_info["email"].lower().strip()
    name = user_info.get("name") or req.name or email.split("@")[0]

    if not email:
        raise HTTPException(400, detail="Email non disponibile dal provider social.")

    # Cerca utente esistente
    from database import get_user_by_email as _get_user, get_pool
    existing = await _get_user(email)

    if existing:
        # Login: utente gia' registrato, la licenza era stata verificata al primo accesso.
        if not existing["active"]:
            raise HTTPException(403, detail="Account disabilitato.")
        user_id = existing["id"]
        user_name = existing["name"]
        user_role = existing["role"]
        user_org = existing.get("organization", "")
    else:
        # v7.3.9.041: REGISTRAZIONE social: licenza obbligatoria.
        license_key = (req.license_key or "").strip()
        if not license_key:
            raise HTTPException(
                403,
                detail="Per la prima registrazione e\' richiesta una chiave di licenza valida."
            )
        # Atomic UPDATE...RETURNING per evitare race condition (vedi v7.3.9.040)
        user_id = str(_uuid.uuid4())
        user_name = name
        user_role = "user"
        user_org = ""
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                # 1. Lock atomico licenza
                lic_row = await conn.fetchrow("""
                    UPDATE licenses
                    SET used_by = $1, used_at = NOW()
                    WHERE key = $2
                      AND active = TRUE
                      AND used_by IS NULL
                    RETURNING key
                """, user_id, license_key)
                if not lic_row:
                    raise HTTPException(
                        403,
                        detail="Chiave di licenza non valida, gia\' utilizzata o disattivata."
                    )
                # 2. Crea l'utente
                await conn.execute("""
                    INSERT INTO users (id, email, name, password_hash, salt, role, active, license_key)
                    VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
                    ON CONFLICT (email) DO NOTHING
                """, user_id, email, user_name, f"social_{provider}", f"social_{provider}",
                    user_role, license_key)
        # Rileggi per assicurarsi che sia stato inserito
        existing2 = await _get_user(email)
        if existing2:
            user_id = existing2["id"]

    token = create_token({
        "user_id": user_id,
        "email": email,
        "name": user_name,
        "role": user_role,
        "org": user_org,
        "provider": provider
    })

    return {
        "access_token": token,
        "user": {
            "id": user_id,
            "email": email,
            "name": user_name,
            "role": user_role,
            "organization": user_org
        }
    }
