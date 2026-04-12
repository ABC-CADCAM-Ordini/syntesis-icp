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
