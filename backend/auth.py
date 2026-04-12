"""
Autenticazione JWT per Syntesis-ICP
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
    user_id = await create_user(
        email=req.email,
        name=req.name,
        password_hash=hashed,
        salt=salt,
        organization=req.organization,
        license_key=req.license_key
    )

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


async def _verify_google_token(token: str) -> dict:
    """Verifica ID token Google tramite Google tokeninfo API."""
    import urllib.request, json as _json
    url = f"https://oauth2.googleapis.com/tokeninfo?id_token={token}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = _json.loads(resp.read())
        if "email" not in data:
            raise ValueError("Token Google non valido")
        return {"email": data["email"], "name": data.get("name", "")}
    except Exception as e:
        raise HTTPException(401, detail=f"Token Google non valido: {e}")


async def _verify_apple_token(token: str) -> dict:
    """Verifica Apple ID token decodificando il JWT (senza dipendenze)."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Formato JWT non valido")
        import base64 as _b64, json as _json
        payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
        payload = _json.loads(_b64.urlsafe_b64decode(payload_b64))
        email = payload.get("email", "")
        if not email:
            raise ValueError("Email non presente nel token Apple")
        return {"email": email, "name": ""}
    except Exception as e:
        raise HTTPException(401, detail=f"Token Apple non valido: {e}")


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
    """Login/registrazione tramite provider social. Nessuna licenza richiesta."""
    import uuid as _uuid

    # Verifica token con il provider
    provider = req.provider.lower()
    if provider == "google":
        user_info = await _verify_google_token(req.token)
    elif provider == "apple":
        user_info = await _verify_apple_token(req.token)
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
        # Login
        if not existing["active"]:
            raise HTTPException(403, detail="Account disabilitato.")
        user_id = existing["id"]
        user_name = existing["name"]
        user_role = existing["role"]
        user_org = existing.get("organization", "")
    else:
        # Registrazione automatica senza licenza (social)
        user_id = str(_uuid.uuid4())
        user_name = name
        user_role = "user"
        user_org = ""
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO users (id, email, name, password_hash, salt, role, active, license_key)
                VALUES ($1, $2, $3, $4, $5, $6, TRUE, NULL)
                ON CONFLICT (email) DO NOTHING
            """, user_id, email, user_name, f"social_{provider}", f"social_{provider}")
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
