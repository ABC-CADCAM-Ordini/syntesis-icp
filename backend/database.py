"""
Database — Syntesis-ICP
PostgreSQL via asyncpg
"""

import os
import asyncpg
from typing import Optional
from datetime import datetime

_pool: Optional[asyncpg.Pool] = None
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/syntesis")


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


async def init_db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS licenses (
            key         TEXT PRIMARY KEY,
            used_by     TEXT,
            used_at     TIMESTAMPTZ,
            active      BOOLEAN DEFAULT TRUE,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS users (
            id              TEXT PRIMARY KEY,
            email           TEXT UNIQUE NOT NULL,
            name            TEXT NOT NULL,
            organization    TEXT,
            password_hash   TEXT NOT NULL,
            salt            TEXT NOT NULL,
            role            TEXT DEFAULT 'user',
            active          BOOLEAN DEFAULT TRUE,
            license_key     TEXT REFERENCES licenses(key),
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS analyses (
            id              TEXT PRIMARY KEY,
            user_id         TEXT REFERENCES users(id),
            filename_a      TEXT,
            filename_b      TEXT,
            score           INTEGER,
            rmsd            DOUBLE PRECISION,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            result_json     JSONB
        );

        CREATE TABLE IF NOT EXISTS leaderboard (
            id              TEXT PRIMARY KEY,
            analysis_id     TEXT REFERENCES analyses(id),
            operator_name   TEXT,
            location        TEXT,
            score           INTEGER,
            rmsd            DOUBLE PRECISION,
            n_pairs         INTEGER,
            brand           TEXT,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
        CREATE INDEX IF NOT EXISTS idx_lb_score ON leaderboard(score DESC);
        """)


async def get_user_by_email(email: str) -> Optional[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM users WHERE email = $1", email)
        return dict(row) if row else None


async def create_user(email: str, name: str, password_hash: str, salt: str,
                      organization: Optional[str], license_key: str) -> str:
    import uuid
    user_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("""
                INSERT INTO users (id, email, name, organization, password_hash, salt, license_key)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, user_id, email, name, organization, password_hash, salt, license_key)
            # Marca licenza come usata
            await conn.execute("""
                UPDATE licenses SET used_by = $1, used_at = NOW()
                WHERE key = $2 AND used_by IS NULL
            """, user_id, license_key)
    return user_id


async def verify_license(key: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT active, used_by FROM licenses WHERE key = $1", key)
        if not row:
            return False
        return bool(row["active"]) and row["used_by"] is None


async def log_analysis(analysis_id: str, user_id: str, filename_a: str,
                        filename_b: str, score: int, rmsd: float,
                        result_json: Optional[dict] = None):
    """v7.3.9.039: persistenza completa di result come JSONB.
    Permette al PDF server-side di accedere a pairs/cyl_axes/profile/warnings."""
    import json as _json
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO analyses (id, user_id, filename_a, filename_b, score, rmsd, result_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """, analysis_id, user_id, filename_a, filename_b, score, rmsd,
            _json.dumps(result_json) if result_json else None)


async def get_analysis(analysis_id: str, user_id: str) -> Optional[dict]:
    """v7.3.9.039: fonde result_json con i campi base.
    Il PDF server-side ora trova pairs/cyl_axes/warnings dentro il record."""
    import json as _json
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM analyses WHERE id = $1 AND user_id = $2",
            analysis_id, user_id)
        if not row:
            return None
        record = dict(row)
        # Fondi result_json (se presente) con i campi top-level.
        # I campi base (id, score, rmsd, filenames, created_at) hanno priorita'.
        rj = record.pop("result_json", None)
        if rj:
            try:
                payload = _json.loads(rj) if isinstance(rj, str) else dict(rj)
                merged = dict(payload)
                merged.update(record)
                return merged
            except Exception:
                pass
        return record


async def save_result(analysis_id: str, operator_name: str, location: str,
                       score: int, rmsd: float, n_pairs: int, brand: str):
    import uuid
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO leaderboard (id, analysis_id, operator_name, location, score, rmsd, n_pairs, brand)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """, str(uuid.uuid4()), analysis_id, operator_name, location,
            score, rmsd, n_pairs, brand)


async def get_leaderboard(brand: Optional[str] = None, limit: int = 50) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if brand:
            rows = await conn.fetch("""
                SELECT operator_name, location, score, rmsd, n_pairs, brand, created_at
                FROM leaderboard
                WHERE brand = $1
                ORDER BY score DESC, rmsd ASC
                LIMIT $2
            """, brand, limit)
        else:
            rows = await conn.fetch("""
                SELECT operator_name, location, score, rmsd, n_pairs, brand, created_at
                FROM leaderboard
                ORDER BY score DESC, rmsd ASC
                LIMIT $1
            """, limit)
        return [dict(r) for r in rows]


# ── Utility admin: crea licenze (da usare via script) ─────────────────────────
async def create_licenses(keys: list[str]):
    """Inserisce nuove licenze nel database."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        for key in keys:
            await conn.execute(
                "INSERT INTO licenses (key) VALUES ($1) ON CONFLICT DO NOTHING", key)
    print(f"✓ {len(keys)} licenze inserite.")
