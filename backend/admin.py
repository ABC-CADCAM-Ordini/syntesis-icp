"""
Endpoint amministrativi per Syntesis-ICP.

Gestione dei registrati e del flusso di autorizzazione:
- GET  /admin/users               elenco registrati con metriche
- POST /admin/users/{id}/authorize  genera la chiave di licenza e attiva l'utente
- POST /admin/users/{id}/revoke     revoca l'autorizzazione (utente torna pending)

Tutti gli endpoint sono protetti da require_admin: accessibili solo agli utenti
con role == 'admin'. Il primo admin va impostato a mano sul database una volta sola.
"""

from fastapi import APIRouter, HTTPException, Depends
from auth import verify_token

router = APIRouter()


async def require_admin(current_user: dict = Depends(verify_token)) -> dict:
    """Consente l'accesso solo agli amministratori."""
    if current_user.get("role") != "admin":
        raise HTTPException(403, detail="Accesso riservato agli amministratori.")
    return current_user


@router.get("/users")
async def admin_list_users(admin: dict = Depends(require_admin)):
    """Elenco di tutti gli utenti registrati con stato, contatti e metriche d'uso."""
    from database import list_all_users
    users = await list_all_users()
    # serializza i timestamp in ISO per il frontend
    for u in users:
        for k in ("created_at", "last_login"):
            if u.get(k) is not None:
                try:
                    u[k] = u[k].isoformat()
                except AttributeError:
                    pass
    return {"users": users}


@router.post("/users/{user_id}/authorize")
async def admin_authorize(user_id: str, admin: dict = Depends(require_admin)):
    """Autorizza un utente: genera la chiave SICP, la associa e attiva l'account.
    Ritorna la chiave generata (verrà mostrata all'utente nel suo pannello)."""
    from database import authorize_user
    key = await authorize_user(user_id)
    if key is None:
        raise HTTPException(404, detail="Utente non trovato.")
    return {"user_id": user_id, "license_key": key}


@router.post("/users/{user_id}/revoke")
async def admin_revoke(user_id: str, admin: dict = Depends(require_admin)):
    """Revoca l'autorizzazione: disattiva la licenza e riporta l'utente in attesa."""
    from database import revoke_user
    ok = await revoke_user(user_id)
    if not ok:
        raise HTTPException(404, detail="Utente non trovato.")
    return {"user_id": user_id, "revoked": True}


# ── BOOTSTRAP TEMPORANEO: promozione primo admin ──────────────────────────────
# Da RIMUOVERE subito dopo l'uso. Protetto da BOOTSTRAP_ADMIN_SECRET (env var).
import os as _os
from pydantic import BaseModel as _BaseModel

class _BootstrapReq(_BaseModel):
    secret: str
    email: str

@router.post("/bootstrap-admin")
async def bootstrap_admin(req: _BootstrapReq):
    expected = _os.getenv("BOOTSTRAP_ADMIN_SECRET", "")
    import hmac as _hmac
    if not expected or not _hmac.compare_digest(req.secret, expected):
        raise HTTPException(403, detail="Non autorizzato.")
    from database import get_pool
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET role='admin', active=TRUE WHERE LOWER(email)=LOWER($1) RETURNING id, email, role, active",
            req.email)
    if not row:
        raise HTTPException(404, detail="Email non trovata.")
    return {"id": row["id"], "email": row["email"], "role": row["role"], "active": row["active"]}
