"""
Database — Syntesis-ICP
PostgreSQL via asyncpg
"""

import os
import asyncpg
import re
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

        -- v7.3.9.047: progetti (contenitori di analisi e file)
        CREATE TABLE IF NOT EXISTS projects (
            id                  TEXT PRIMARY KEY,
            user_id             TEXT REFERENCES users(id) ON DELETE CASCADE,
            name                TEXT NOT NULL,
            description         TEXT,
            patient_ref         TEXT,           -- riferimento paziente (libero, anonimizzabile)
            color               TEXT DEFAULT '#0065B3',
            archived            BOOLEAN DEFAULT FALSE,
            -- Storage cloud (popolati quando l'utente connette il provider e crea il progetto)
            gdrive_folder_id    TEXT,
            dropbox_folder_id   TEXT,
            -- Audit
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
        CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(user_id, archived);

        -- v7.3.9.047: associo analisi a progetto (nullable, retrocompat)
        ALTER TABLE analyses ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_analyses_project ON analyses(project_id);

        -- v7.3.9.047: cloud connection per utente (nullable, opt-in)
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gdrive_email TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gdrive_refresh_token_enc TEXT;  -- cifrato
        ALTER TABLE users ADD COLUMN IF NOT EXISTS gdrive_connected_at TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS dropbox_email TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS dropbox_refresh_token_enc TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS dropbox_connected_at TIMESTAMPTZ;

        -- v7.3.9.053 - Rubrica contatti per scambio file fra utenti
        CREATE TABLE IF NOT EXISTS contacts (
            id                  TEXT PRIMARY KEY,
            owner_user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            -- Email del contatto (puo\' essere o non essere un utente Syntesis registrato)
            contact_email       TEXT NOT NULL,
            -- Se il contatto ha un account Syntesis, FK al suo user_id (altrimenti NULL = pending)
            contact_user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
            -- Etichetta libera (es. "Studio Rossi", "Lab Bianchi")
            display_name        TEXT,
            -- Ruolo descrittivo libero (clinica, laboratorio, collega, ...)
            role                TEXT,
            -- Note libere
            notes               TEXT,
            -- Stato: pending (l\'altro non e\' ancora registrato), active (attivo), blocked
            status              TEXT DEFAULT 'pending',
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW(),
            -- Un utente non puo\' avere due contatti con la stessa email
            UNIQUE(owner_user_id, contact_email)
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_contacts_target ON contacts(contact_user_id) WHERE contact_user_id IS NOT NULL;

        -- v7.3.9.054 - Tracking consumo storage mensile
        -- Ogni evento di upload registra bytes utilizzati. Il consumo
        -- mensile e' la somma dei bytes nel periodo (UTC, day-of-month).
        CREATE TABLE IF NOT EXISTS usage_log (
            id              BIGSERIAL PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            event_type      TEXT NOT NULL,        -- 'upload', 'analysis', 'share', etc.
            bytes_delta     BIGINT NOT NULL,      -- positivo per upload, negativo per delete
            ref_type        TEXT,                 -- 'analysis', 'project_file', 'shared_file'
            ref_id          TEXT,                 -- riferimento all'oggetto
            metadata        JSONB,                -- info extra (filename, mime, etc.)
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_log(user_id, created_at DESC);

        -- v7.3.9.054 - Piano di abbonamento per utente
        ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_renewed_at TIMESTAMPTZ DEFAULT NOW();
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





# ──────────────────────────────────────────────────────────────────────────────
# v7.3.9.047 - Backend utente: progetti
# Un progetto e' un contenitore logico per analisi e file (cloud).
# Per ora la cartella cloud e' opzionale (gdrive_folder_id puo' essere NULL).
# Quando l'utente connettera' Drive, verra' creata la cartella alla creazione progetto.
# ──────────────────────────────────────────────────────────────────────────────

async def list_user_projects(user_id: str, archived: bool = False) -> list[dict]:
    """Lista progetti dell'utente con conteggio analisi associate."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT p.id, p.name, p.description, p.patient_ref, p.color,
                   p.archived, p.created_at, p.updated_at,
                   p.gdrive_folder_id, p.dropbox_folder_id,
                   COUNT(a.id) FILTER (WHERE COALESCE(a.archived, FALSE) = FALSE) AS n_analyses,
                   MAX(a.created_at) AS last_analysis_at
            FROM projects p
            LEFT JOIN analyses a ON a.project_id = p.id
            WHERE p.user_id = $1 AND COALESCE(p.archived, FALSE) = $2
            GROUP BY p.id
            ORDER BY COALESCE(p.updated_at, p.created_at) DESC
        """, user_id, archived)
        return [dict(r) for r in rows]


async def get_user_project(project_id: str, user_id: str) -> Optional[dict]:
    """Dettaglio progetto + lista analisi associate."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM projects WHERE id = $1 AND user_id = $2
        """, project_id, user_id)
        if not row:
            return None
        proj = dict(row)
        # Analisi del progetto
        analyses = await conn.fetch("""
            SELECT id, filename_a, filename_b, display_name,
                   score, rmsd, created_at, archived
            FROM analyses
            WHERE project_id = $1 AND user_id = $2
            ORDER BY created_at DESC
        """, project_id, user_id)
        proj["analyses"] = [dict(a) for a in analyses]
        return proj


async def create_user_project(user_id: str, name: str,
                                description: Optional[str] = None,
                                patient_ref: Optional[str] = None,
                                color: Optional[str] = None) -> str:
    """Crea un progetto per l'utente. Le folder cloud verranno create
    al primo upload se l'utente ha connesso Drive/Dropbox."""
    import uuid
    project_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO projects (id, user_id, name, description, patient_ref, color)
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, '#0065B3'))
        """, project_id, user_id, name, description, patient_ref, color)
    return project_id


async def update_user_project(project_id: str, user_id: str,
                                name: Optional[str] = None,
                                description: Optional[str] = None,
                                patient_ref: Optional[str] = None,
                                color: Optional[str] = None,
                                archived: Optional[bool] = None) -> bool:
    if all(v is None for v in [name, description, patient_ref, color, archived]):
        return False
    pool = await get_pool()
    async with pool.acquire() as conn:
        sets = ["updated_at = NOW()"]
        params = []
        if name is not None:
            sets.append(f"name = ${len(params)+1}"); params.append(name)
        if description is not None:
            sets.append(f"description = ${len(params)+1}"); params.append(description)
        if patient_ref is not None:
            sets.append(f"patient_ref = ${len(params)+1}"); params.append(patient_ref)
        if color is not None:
            sets.append(f"color = ${len(params)+1}"); params.append(color)
        if archived is not None:
            sets.append(f"archived = ${len(params)+1}"); params.append(archived)
        params.append(project_id)
        params.append(user_id)
        sql = f"""UPDATE projects SET {", ".join(sets)}
                  WHERE id = ${len(params)-1} AND user_id = ${len(params)}"""
        result = await conn.execute(sql, *params)
        return result.endswith(" 1")


async def delete_user_project(project_id: str, user_id: str,
                                cascade_analyses: bool = False) -> bool:
    """Elimina un progetto. Se cascade_analyses=True elimina anche le analisi
    associate. Altrimenti le analisi restano ma con project_id=NULL (ON DELETE SET NULL)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if cascade_analyses:
                # Rimuovi anche le entry leaderboard delle analisi associate
                await conn.execute("""
                    DELETE FROM leaderboard WHERE analysis_id IN (
                        SELECT id FROM analyses WHERE project_id = $1 AND user_id = $2
                    )
                """, project_id, user_id)
                await conn.execute("""
                    DELETE FROM analyses WHERE project_id = $1 AND user_id = $2
                """, project_id, user_id)
            # Il delete del progetto setta project_id=NULL nelle analisi (ON DELETE SET NULL)
            result = await conn.execute("""
                DELETE FROM projects WHERE id = $1 AND user_id = $2
            """, project_id, user_id)
            return result.endswith(" 1")


async def assign_analysis_to_project(analysis_id: str, user_id: str,
                                        project_id: Optional[str]) -> bool:
    """Associa o disassocia (project_id=None) un'analisi a un progetto.
    Se project_id e' fornito, verifica che il progetto appartenga all'utente."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        if project_id:
            # Verifica ownership del progetto
            owner = await conn.fetchval(
                "SELECT user_id FROM projects WHERE id = $1", project_id)
            if owner != user_id:
                return False
        result = await conn.execute("""
            UPDATE analyses SET project_id = $1, updated_at = NOW()
            WHERE id = $2 AND user_id = $3
        """, project_id, analysis_id, user_id)
        return result.endswith(" 1")





# ──────────────────────────────────────────────────────────────────────────────
# v7.3.9.048 - Google Drive credentials (refresh_token cifrato)
# ──────────────────────────────────────────────────────────────────────────────

async def set_gdrive_credentials(user_id: str, email: str,
                                    refresh_token_encrypted: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE users
            SET gdrive_email = $1,
                gdrive_refresh_token_enc = $2,
                gdrive_connected_at = NOW()
            WHERE id = $3
        """, email, refresh_token_encrypted, user_id)
        return result.endswith(" 1")


async def get_gdrive_credentials(user_id: str) -> Optional[dict]:
    """Ritorna { email, refresh_token_encrypted, connected_at } se l'utente
    ha connesso Drive, None altrimenti."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT gdrive_email, gdrive_refresh_token_enc, gdrive_connected_at
            FROM users WHERE id = $1
        """, user_id)
        if not row or not row['gdrive_refresh_token_enc']:
            return None
        return {
            'email': row['gdrive_email'],
            'refresh_token_encrypted': row['gdrive_refresh_token_enc'],
            'connected_at': row['gdrive_connected_at'],
        }


async def clear_gdrive_credentials(user_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE users
            SET gdrive_email = NULL,
                gdrive_refresh_token_enc = NULL,
                gdrive_connected_at = NULL
            WHERE id = $1
        """, user_id)
        return result.endswith(" 1")


async def set_project_gdrive_folder(project_id: str, user_id: str,
                                       folder_id: str) -> bool:
    """Salva l'ID della folder Drive associata a un progetto."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE projects SET gdrive_folder_id = $1, updated_at = NOW()
            WHERE id = $2 AND user_id = $3
        """, folder_id, project_id, user_id)
        return result.endswith(" 1")





# ──────────────────────────────────────────────────────────────────────────────
# v7.3.9.054 - Tracking consumo storage mensile
# Free plan: 1 GB/mese (1024 MB = 1073741824 bytes)
# Periodo: dal 1\xb0 del mese corrente alla mezzanotte del 1\xb0 successivo (UTC)
# ──────────────────────────────────────────────────────────────────────────────

PLAN_LIMITS = {
    "free":    1 * 1024 * 1024 * 1024,        # 1 GB
    "pro":     50 * 1024 * 1024 * 1024,       # 50 GB
    "studio":  500 * 1024 * 1024 * 1024,      # 500 GB
}


async def log_usage(user_id: str, event_type: str, bytes_delta: int,
                      ref_type: Optional[str] = None,
                      ref_id: Optional[str] = None,
                      metadata: Optional[dict] = None) -> None:
    """Registra un evento di uso storage. bytes_delta puo' essere negativo
    in caso di delete (libera spazio nel mese)."""
    pool = await get_pool()
    import json as _json
    md_json = _json.dumps(metadata) if metadata else None
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO usage_log (user_id, event_type, bytes_delta, ref_type, ref_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6)
        """, user_id, event_type, bytes_delta, ref_type, ref_id, md_json)


async def get_user_storage_status(user_id: str) -> dict:
    """Ritorna dict con consumo del mese corrente, limite del piano,
    percentuale, periodo (start/end UTC), e plan."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Primo del mese successivo
    if period_start.month == 12:
        period_end = period_start.replace(year=period_start.year+1, month=1)
    else:
        period_end = period_start.replace(month=period_start.month+1)

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Plan dell'utente
        plan_row = await conn.fetchrow("SELECT plan FROM users WHERE id = $1", user_id)
        plan = (plan_row["plan"] if plan_row and plan_row.get("plan") else "free")
        limit_bytes = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

        # Somma bytes_delta nel periodo
        used_row = await conn.fetchrow("""
            SELECT COALESCE(SUM(bytes_delta), 0) AS used
            FROM usage_log
            WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
        """, user_id, period_start, period_end)
        used_bytes = max(0, int(used_row["used"]))

        # Storico ultimi 6 mesi (per grafico futuro)
        history = await conn.fetch("""
            SELECT date_trunc('month', created_at) AS month,
                   COALESCE(SUM(bytes_delta), 0) AS bytes
            FROM usage_log
            WHERE user_id = $1 AND created_at >= $2
            GROUP BY 1
            ORDER BY 1 DESC
            LIMIT 6
        """, user_id, period_start.replace(month=1) if period_start.month <= 6
                       else period_start.replace(month=period_start.month-5))

    pct = round(100.0 * used_bytes / limit_bytes, 2) if limit_bytes else 0
    return {
        "plan": plan,
        "limit_bytes": limit_bytes,
        "used_bytes": used_bytes,
        "free_bytes": max(0, limit_bytes - used_bytes),
        "percent": pct,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "history": [{"month": h["month"].isoformat(), "bytes": int(h["bytes"])} for h in history],
    }


async def can_upload_bytes(user_id: str, n_bytes: int) -> tuple[bool, dict]:
    """Verifica se l'utente puo' caricare n_bytes senza superare il limite mensile.
    Ritorna (ok, status_dict)."""
    status = await get_user_storage_status(user_id)
    ok = (status["used_bytes"] + n_bytes) <= status["limit_bytes"]
    return ok, status


# ──────────────────────────────────────────────────────────────────────────────
# v7.3.9.053 - Rubrica contatti
# Ogni utente ha una sua rubrica di "colleghi/laboratori/clinici" con cui
# scambia file. Un contatto puo' essere "pending" (email non ancora registrata
# su Syntesis) o "active" (collegato a un utente esistente).
# ──────────────────────────────────────────────────────────────────────────────

async def list_user_contacts(user_id: str) -> list[dict]:
    """Lista contatti dell'utente, con dettagli su ognuno se registrato."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT c.id, c.contact_email, c.contact_user_id, c.display_name,
                   c.role, c.notes, c.status, c.created_at, c.updated_at,
                   u.name AS contact_real_name,
                   u.organization AS contact_organization,
                   (u.gdrive_refresh_token_enc IS NOT NULL) AS contact_drive_connected
            FROM contacts c
            LEFT JOIN users u ON u.id = c.contact_user_id
            WHERE c.owner_user_id = $1
            ORDER BY c.display_name ASC NULLS LAST, c.contact_email ASC
        """, user_id)
        return [dict(r) for r in rows]


async def create_user_contact(owner_user_id: str, contact_email: str,
                                display_name: Optional[str] = None,
                                role: Optional[str] = None,
                                notes: Optional[str] = None) -> dict:
    """Aggiunge un contatto. Se l'email corrisponde a un utente Syntesis,
    lo collega automaticamente (status=active). Altrimenti pending.
    Solleva ValueError se duplicato (owner+email)."""
    import uuid
    contact_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Check se esiste utente con questa email
        target = await conn.fetchrow(
            "SELECT id FROM users WHERE LOWER(email) = LOWER($1)", contact_email)
        contact_user_id = target["id"] if target else None
        status = "active" if target else "pending"

        # Non permettere di aggiungersi da soli
        if contact_user_id == owner_user_id:
            raise ValueError("Non puoi aggiungere te stesso ai contatti.")

        try:
            await conn.execute("""
                INSERT INTO contacts (id, owner_user_id, contact_email, contact_user_id,
                                       display_name, role, notes, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, contact_id, owner_user_id, contact_email, contact_user_id,
                display_name, role, notes, status)
        except asyncpg.UniqueViolationError:
            raise ValueError("Hai gia' un contatto con questa email.")
    return {
        "id": contact_id,
        "contact_email": contact_email,
        "contact_user_id": contact_user_id,
        "display_name": display_name,
        "role": role,
        "notes": notes,
        "status": status,
    }


async def update_user_contact(contact_id: str, owner_user_id: str,
                                display_name: Optional[str] = None,
                                role: Optional[str] = None,
                                notes: Optional[str] = None) -> bool:
    """Aggiorna metadati di un contatto (nome/ruolo/note). NON cambia email."""
    if display_name is None and role is None and notes is None:
        return False
    pool = await get_pool()
    async with pool.acquire() as conn:
        sets = ["updated_at = NOW()"]
        params = []
        if display_name is not None:
            sets.append(f"display_name = ${len(params)+1}"); params.append(display_name)
        if role is not None:
            sets.append(f"role = ${len(params)+1}"); params.append(role)
        if notes is not None:
            sets.append(f"notes = ${len(params)+1}"); params.append(notes)
        params.append(contact_id)
        params.append(owner_user_id)
        sql = f"""UPDATE contacts SET {', '.join(sets)}
                  WHERE id = ${len(params)-1} AND owner_user_id = ${len(params)}"""
        result = await conn.execute(sql, *params)
        return result.endswith(" 1")


async def delete_user_contact(contact_id: str, owner_user_id: str) -> bool:
    """Elimina un contatto dalla rubrica."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM contacts WHERE id = $1 AND owner_user_id = $2
        """, contact_id, owner_user_id)
        return result.endswith(" 1")


async def reconcile_pending_contacts(new_user_id: str, new_user_email: str) -> int:
    """Quando un nuovo utente si registra, controlla se ci sono contatti pending
    con la sua email e li attiva. Ritorna numero di contatti riconciliati."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE contacts
            SET contact_user_id = $1, status = 'active', updated_at = NOW()
            WHERE LOWER(contact_email) = LOWER($2)
              AND contact_user_id IS NULL
              AND status = 'pending'
        """, new_user_id, new_user_email)
        # asyncpg ritorna 'UPDATE n' come stringa
        m = re.search(r'UPDATE (\d+)', result)
        return int(m.group(1)) if m else 0


# ── Utility admin: crea licenze (da usare via script) ─────────────────────────
async def create_licenses(keys: list[str]):
    """Inserisce nuove licenze nel database."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        for key in keys:
            await conn.execute(
                "INSERT INTO licenses (key) VALUES ($1) ON CONFLICT DO NOTHING", key)
    print(f"✓ {len(keys)} licenze inserite.")
