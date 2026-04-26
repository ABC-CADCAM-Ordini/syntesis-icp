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
            result_json     JSONB,
            -- v7.3.9.046: gestione utente
            display_name    TEXT,
            notes           TEXT,
            archived        BOOLEAN DEFAULT FALSE,
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        );

        -- v7.3.9.046: migrazione idempotente per DB esistenti
        ALTER TABLE analyses ADD COLUMN IF NOT EXISTS display_name TEXT;
        ALTER TABLE analyses ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE analyses ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
        ALTER TABLE analyses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

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
    """v7.3.9.040: race condition fix.
    Tenta UPDATE...RETURNING della licenza PRIMA di creare l'utente.
    Se la licenza e' gia' usata da qualcun altro fra verify_license() e qui,
    UPDATE ritorna 0 righe e la transazione si annulla con eccezione esplicita.
    Cosi' due richieste concorrenti non possono entrambe consumare la stessa
    licenza."""
    import uuid
    user_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. Tenta lock atomico della licenza
            row = await conn.fetchrow("""
                UPDATE licenses
                SET used_by = $1, used_at = NOW()
                WHERE key = $2
                  AND active = TRUE
                  AND used_by IS NULL
                RETURNING key
            """, user_id, license_key)
            if not row:
                # Licenza non disponibile: race detected o licenza disattivata
                raise ValueError("Licenza non disponibile o gia' utilizzata.")
            # 2. Solo se la licenza e' stata bloccata, crea l'utente
            await conn.execute("""
                INSERT INTO users (id, email, name, organization, password_hash, salt, license_key)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, user_id, email, name, organization, password_hash, salt, license_key)
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





# ──────────────────────────────────────────────────────────────────────────────
# v7.3.9.046 - Backend utente: lista, dettaglio, rinomina, archivio, elimina
# ──────────────────────────────────────────────────────────────────────────────

async def list_user_analyses(user_id: str, archived: bool = False,
                              limit: int = 100, offset: int = 0) -> list[dict]:
    """Lista analisi dell'utente, ordinate per data desc.
    archived=False: solo attive, archived=True: solo archiviate."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, filename_a, filename_b, display_name, notes,
                   score, rmsd, created_at, updated_at, archived
            FROM analyses
            WHERE user_id = $1 AND COALESCE(archived, FALSE) = $2
            ORDER BY COALESCE(updated_at, created_at) DESC
            LIMIT $3 OFFSET $4
        """, user_id, archived, limit, offset)
        return [dict(r) for r in rows]


async def count_user_analyses(user_id: str, archived: bool = False) -> int:
    """Conta totale analisi dell'utente (per paginazione)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS n FROM analyses
            WHERE user_id = $1 AND COALESCE(archived, FALSE) = $2
        """, user_id, archived)
        return int(row["n"]) if row else 0


async def update_analysis_meta(analysis_id: str, user_id: str,
                                display_name: Optional[str] = None,
                                notes: Optional[str] = None,
                                archived: Optional[bool] = None) -> bool:
    """Aggiorna metadati di un'analisi (solo se appartiene all'utente).
    Restituisce True se la riga e' stata modificata."""
    if display_name is None and notes is None and archived is None:
        return False
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Costruisco UPDATE dinamico mantenendo i parametri esistenti immutati
        sets = ["updated_at = NOW()"]
        params = []
        if display_name is not None:
            sets.append(f"display_name = ${len(params)+1}")
            params.append(display_name)
        if notes is not None:
            sets.append(f"notes = ${len(params)+1}")
            params.append(notes)
        if archived is not None:
            sets.append(f"archived = ${len(params)+1}")
            params.append(archived)
        params.append(analysis_id)
        params.append(user_id)
        sql = f"""
            UPDATE analyses SET {", ".join(sets)}
            WHERE id = ${len(params)-1} AND user_id = ${len(params)}
        """
        result = await conn.execute(sql, *params)
        # asyncpg restituisce 'UPDATE n' come stringa
        return result.endswith(" 1")


async def delete_user_analysis(analysis_id: str, user_id: str) -> bool:
    """Elimina permanentemente un'analisi (solo se appartiene all'utente).
    Cascata: rimuove anche eventuali entry leaderboard collegate."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Prima rimuovo dalla leaderboard (FK)
            await conn.execute(
                "DELETE FROM leaderboard WHERE analysis_id = $1", analysis_id)
            # Poi l'analisi
            result = await conn.execute("""
                DELETE FROM analyses
                WHERE id = $1 AND user_id = $2
            """, analysis_id, user_id)
            return result.endswith(" 1")


async def get_user_profile(user_id: str) -> Optional[dict]:
    """Profilo utente (senza password_hash/salt) + statistiche minime."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, email, name, organization, role, active,
                   license_key, created_at
            FROM users WHERE id = $1
        """, user_id)
        if not row:
            return None
        prof = dict(row)
        # Statistiche
        stats_row = await conn.fetchrow("""
            SELECT COUNT(*) AS n_total,
                   COUNT(*) FILTER (WHERE COALESCE(archived, FALSE) = TRUE) AS n_archived,
                   AVG(score) AS avg_score,
                   MAX(score) AS best_score
            FROM analyses WHERE user_id = $1
        """, user_id)
        prof["stats"] = dict(stats_row) if stats_row else {}
        return prof


async def update_user_profile(user_id: str, name: Optional[str] = None,
                               organization: Optional[str] = None) -> bool:
    """Aggiorna nome o organizzazione (mai email/role/license)."""
    if name is None and organization is None:
        return False
    pool = await get_pool()
    async with pool.acquire() as conn:
        sets = []
        params = []
        if name is not None:
            sets.append(f"name = ${len(params)+1}")
            params.append(name)
        if organization is not None:
            sets.append(f"organization = ${len(params)+1}")
            params.append(organization)
        params.append(user_id)
        sql = f"UPDATE users SET {', '.join(sets)} WHERE id = ${len(params)}"
        result = await conn.execute(sql, *params)
        return result.endswith(" 1")


# ── Utility admin: crea licenze (da usare via script) ─────────────────────────
async def create_licenses(keys: list[str]):
    """Inserisce nuove licenze nel database."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        for key in keys:
            await conn.execute(
                "INSERT INTO licenses (key) VALUES ($1) ON CONFLICT DO NOTHING", key)
    print(f"✓ {len(keys)} licenze inserite.")
