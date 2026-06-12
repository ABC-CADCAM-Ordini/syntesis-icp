"""
Database — Syntesis-ICP
PostgreSQL via asyncpg
"""

import os
import asyncpg
import re
import logging
from typing import Optional
from datetime import datetime

log = logging.getLogger("syntesis.db")


def rit_parse_display_mmd(display):
    """(marca, modello, diametro) best-effort dal display libreria, es.
    '(IPD Lite) Megagen AnyRidge Ø4.0' o 'Megagen AnyRidge Ø4.0' ->
    ('Megagen','AnyRidge','4.0'). Per le LITE e il backfill della cascata
    Marca>Modello>Diametro; usato anche da admin._rit_parse_zip.
    (None,None,None) se vuoto."""
    s = (display or "").strip()
    while s.startswith("("):                 # strip prefissi parentetici (anche annidati)
        end = s.find(")")
        if end == -1:
            break
        s = s[end + 1:].lstrip()
    toks = s.split()
    if not toks:
        return (None, None, None)
    marca = toks[0]
    if len(toks) == 1:
        return (marca, None, None)
    last = toks[-1]
    diam = last[1:] if last[:1] in ("Ø", "ø", "⌀") else last
    modello = " ".join(toks[1:-1]) or None
    return (marca, modello, diam or None)

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

        -- v8.x - Nuovo flusso registrazione/autorizzazione
        ALTER TABLE users ADD COLUMN IF NOT EXISTS city        TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS phone       TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login  TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0;
        """)



        # v7.3.9.062 - Cartelle condivise (sistema invito + accept)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS shared_folders (
                id                      TEXT PRIMARY KEY,
                owner_user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                folder_name             TEXT NOT NULL,
                description             TEXT,
                owner_drive_folder_id   TEXT NOT NULL,
                created_at              TIMESTAMPTZ DEFAULT NOW(),
                updated_at              TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS shared_folder_members (
                id                       TEXT PRIMARY KEY,
                shared_folder_id         TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
                member_user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
                member_email             TEXT NOT NULL,
                member_drive_folder_id   TEXT,
                status                   TEXT NOT NULL DEFAULT 'pending',
                invited_by               TEXT NOT NULL REFERENCES users(id),
                invited_at               TIMESTAMPTZ DEFAULT NOW(),
                responded_at             TIMESTAMPTZ,
                UNIQUE (shared_folder_id, member_email)
            );
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sfm_email_pending
                ON shared_folder_members(member_email)
                WHERE status='pending';
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sfm_user_active
                ON shared_folder_members(member_user_id)
                WHERE status='active';
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sf_owner
                ON shared_folders(owner_user_id);
        """)

        # === v7.3.9.087 - Modello Medico/Laboratorio + cartelle paziente ===
        # users.pro_role: ruolo professionale dell'utente (medico/laboratorio)
        # Diverso da users.role che e\' privilege level (user/admin/etc)
        await conn.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_role TEXT
                CHECK (pro_role IS NULL OR pro_role IN ('medico','laboratorio'));
        """)
        await conn.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_role_set_at TIMESTAMPTZ;
        """)

        # case_folders: cartella-paziente DENTRO una shared_folder
        # E\' una sotto-cartella nel Drive del medico, replicata sul lab.
        # Contiene tutti i file e i metadati clinico-organizzativi del caso.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS case_folders (
                id                        TEXT PRIMARY KEY,
                shared_folder_id          TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
                drive_folder_id           TEXT,
                case_label                TEXT NOT NULL,
                case_notes                TEXT,
                urgenza                   TEXT NOT NULL DEFAULT 'standard'
                    CHECK (urgenza IN ('non_urgente','standard','urgente','molto_urgente')),
                data_consegna_richiesta   DATE,
                data_consegna_proposta    DATE,
                pipeline_stato            TEXT NOT NULL DEFAULT 'inviata'
                    CHECK (pipeline_stato IN ('inviata','ricevuta','in_lavorazione','in_consegna','chiuso')),
                created_by                TEXT NOT NULL REFERENCES users(id),
                created_at                TIMESTAMPTZ DEFAULT NOW(),
                updated_at                TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_cf_shared_folder
                ON case_folders(shared_folder_id);
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_cf_pipeline_stato
                ON case_folders(pipeline_stato);
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_cf_urgenza
                ON case_folders(urgenza)
                WHERE pipeline_stato NOT IN ('chiuso');
        """)

        # case_events: audit log immutabile di ogni evento sul caso.
        # Necessario per medico-legale: chi-quando-cosa.
        # Per ora viene popolato silenzioso, l\'UI lo espone in v.095.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS case_events (
                id                  TEXT PRIMARY KEY,
                case_folder_id      TEXT NOT NULL REFERENCES case_folders(id) ON DELETE CASCADE,
                event_type          TEXT NOT NULL
                    CHECK (event_type IN (
                        'created','file_uploaded','file_downloaded',
                        'urgenza_changed','date_proposed','state_changed',
                        'message_added'
                    )),
                event_data          JSONB,
                actor_user_id       TEXT REFERENCES users(id),
                actor_pro_role      TEXT,
                created_at          TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ce_case
                ON case_events(case_folder_id, created_at DESC);
        """)

        # === v7.3.9.089 - Tag ruolo professionale sui contatti ===
        # Nuova colonna pulita con CHECK. La vecchia contacts.role
        # resta per backward compat ma la UI ignora.
        await conn.execute("""
            ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_pro_role TEXT
                CHECK (contact_pro_role IS NULL OR contact_pro_role IN ('medico','laboratorio'));
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_contacts_pro_role
                ON contacts(owner_user_id, contact_pro_role)
                WHERE contact_pro_role IS NOT NULL;
        """)

        # === v8.16.0 - Replace-iT (Passo 1): librerie scanbody Exocad ===
        # Ingest fidato di librerie Exocad (config.xml + STL marker) dietro
        # require_admin. Gli STL sono deduplicati per sha256 del CONTENUTO ed
        # e\' GLOBALE cross-libreria (rit_marker_stl): salva su Postgres come
        # bytea (niente volume -> simmetria dei due servizi). L\'unita\' clinica
        # e\' il TYPE (ImplantTypeConfig), NON il file: lo stesso marker e\'
        # condiviso tra piu\' type (ENG/Non-ENG) con click-center/asse propri,
        # quindi i parametri stanno sul type. Subtype (ImplantSubtypeConfig),
        # .sdfa e firme RSA sono ignorati. Vedi admin.py -> /admin/rit/*.
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS rit_marker_stl (
            sha256              CHAR(64) PRIMARY KEY,
            content             BYTEA NOT NULL,
            original_filename   TEXT,
            size_bytes          INTEGER,
            first_seen_at       TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS rit_library (
            id                   SERIAL PRIMARY KEY,
            import_name          TEXT UNIQUE NOT NULL,
            keyword              TEXT,
            display              TEXT,
            connection_id        TEXT,
            rotation_lock_count  INTEGER,
            ref_rotation_offset  DOUBLE PRECISION,
            axis_occlusal_x      DOUBLE PRECISION,
            axis_occlusal_y      DOUBLE PRECISION,
            axis_occlusal_z      DOUBLE PRECISION,
            supplier             TEXT,
            supplier_version     TEXT,
            marca                TEXT,
            modello              TEXT,
            diametro             TEXT,
            preview_png          BYTEA,
            logo_png             BYTEA,
            active               BOOLEAN DEFAULT FALSE,
            uploaded_at          TIMESTAMPTZ DEFAULT NOW(),
            uploaded_by          TEXT
        );

        CREATE TABLE IF NOT EXISTS rit_scanbody_type (
            id                   SERIAL PRIMARY KEY,
            library_id           INTEGER NOT NULL REFERENCES rit_library(id) ON DELETE CASCADE,
            display              TEXT,
            keyword              TEXT,
            marker_filename      TEXT,
            marker_sha256        CHAR(64) REFERENCES rit_marker_stl(sha256),
            click_center_x       DOUBLE PRECISION,
            click_center_y       DOUBLE PRECISION,
            click_center_z       DOUBLE PRECISION,
            axis_asymmetric_x    DOUBLE PRECISION,
            axis_asymmetric_y    DOUBLE PRECISION,
            axis_asymmetric_z    DOUBLE PRECISION,
            is_eng               BOOLEAN,
            ord                  INTEGER,
            active               BOOLEAN NOT NULL DEFAULT TRUE
        );

        CREATE INDEX IF NOT EXISTS idx_rit_type_library ON rit_scanbody_type(library_id);
        CREATE INDEX IF NOT EXISTS idx_rit_library_active ON rit_library(active);
        """)

        # === v8.50.0 - Replace-iT: archivio STL + librerie da CSV/editor ===
        # rit_stl_asset = la "cartella unica" visibile per NOME: ogni riga e' un
        # nome-file che punta a un contenuto in rit_marker_stl (dedup per sha256).
        # Modello "live per nome": sovrascrivere un asset ripunta i type delle
        # librerie con source csv/editor che usano quel nome (match su
        # marker_filename); le librerie Exocad NON seguono. locked = lucchetto
        # anti cancellazione/sovrascrittura, si sblocca solo col codice di
        # sicurezza (rit_lock_secret, riga singola id=1, hash pbkdf2 via
        # auth.hash_password — MAI in chiaro). rit_library.source discrimina
        # exocad|csv|editor (NULL = exocad, librerie pre-8.50);
        # rit_scanbody_type.role = madre|figlio (NULL per le Exocad).
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS rit_stl_asset (
            name         TEXT PRIMARY KEY,
            sha256       CHAR(64) NOT NULL REFERENCES rit_marker_stl(sha256),
            locked       BOOLEAN NOT NULL DEFAULT FALSE,
            size_bytes   INTEGER,
            uploaded_by  TEXT,
            uploaded_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS rit_lock_secret (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            code_hash    TEXT NOT NULL,
            code_salt    TEXT NOT NULL,
            updated_by   TEXT,
            updated_at   TIMESTAMPTZ DEFAULT NOW()
        );

        ALTER TABLE rit_scanbody_type ADD COLUMN IF NOT EXISTS role TEXT;
        ALTER TABLE rit_scanbody_type ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE rit_library ADD COLUMN IF NOT EXISTS source TEXT;
        ALTER TABLE rit_library ADD COLUMN IF NOT EXISTS marca TEXT;
        ALTER TABLE rit_library ADD COLUMN IF NOT EXISTS modello TEXT;
        ALTER TABLE rit_library ADD COLUMN IF NOT EXISTS diametro TEXT;
        """)

        # v8.52.0 cascata: marca/modello/diametro strutturati su rit_library
        # (la cascata Marca>Modello>Diametro nel runtime li legge). Backfill
        # delle librerie esistenti (CSV/editor e LITE) parsando il display.
        # Idempotente: tocca solo le righe con marca NULL.
        for _r in await conn.fetch(
                "SELECT id, display FROM rit_library WHERE marca IS NULL"):
            _mc, _md, _di = rit_parse_display_mmd(_r["display"])
            if _mc:
                await conn.execute(
                    "UPDATE rit_library SET marca=$2, modello=$3, diametro=$4 WHERE id=$1",
                    _r["id"], _mc, _md, _di)

        # v8.50.0 archivio UNICO: le librerie gia' importate (Exocad incluse)
        # devono comparire nella cartella. (1) normalizzo i marker_filename
        # storici a basename (chiave di match per nome dell'archivio); (2)
        # backfillo rit_stl_asset con un asset per nome dai type esistenti.
        # Idempotente: la UPDATE tocca solo righe con '/', l'INSERT e' ON
        # CONFLICT DO NOTHING. Non resuscita asset cancellati: la delete e'
        # permessa solo per asset NON referenziati, che qui non verrebbero
        # ricreati (il SELECT parte dai type esistenti).
        await conn.execute("""
        UPDATE rit_scanbody_type
           SET marker_filename = regexp_replace(marker_filename, '^.*/', '')
         WHERE marker_filename LIKE '%/%';
        """)

        # COLLISIONI STORICHE: prima dell'archivio unico, due librerie Exocad
        # potevano avere un marker con lo STESSO basename ma contenuto DIVERSO
        # (dedup solo per sha, i path completi li distinguevano). NON li fondo
        # alla cieca: questi nomi NON entrano in archivio (esclusi sotto) e li
        # segnalo nei log per revisione admin — cosi' un overwrite "live per
        # nome" non muta in silenzio una libreria mai rappresentata.
        collisions = await conn.fetch("""
            SELECT marker_filename, COUNT(DISTINCT marker_sha256) AS n
              FROM rit_scanbody_type
             WHERE marker_filename IS NOT NULL AND marker_filename <> ''
               AND marker_sha256 IS NOT NULL
             GROUP BY marker_filename
            HAVING COUNT(DISTINCT marker_sha256) > 1
        """)
        if collisions:
            log.warning(
                "rit backfill: %d nomi con contenuti divergenti, NON messi in "
                "archivio (revisione admin): %s",
                len(collisions),
                ", ".join(f"{r['marker_filename']} ({r['n']} sha)" for r in collisions))

        await conn.execute("""
        INSERT INTO rit_stl_asset (name, sha256, size_bytes)
        SELECT DISTINCT ON (t.marker_filename)
               t.marker_filename, t.marker_sha256, m.size_bytes
          FROM rit_scanbody_type t
          JOIN rit_marker_stl m ON m.sha256 = t.marker_sha256
         WHERE t.marker_filename IS NOT NULL AND t.marker_filename <> ''
           AND t.marker_sha256 IS NOT NULL
           AND t.marker_filename NOT IN (
               SELECT marker_filename FROM rit_scanbody_type
                WHERE marker_filename IS NOT NULL AND marker_filename <> ''
                  AND marker_sha256 IS NOT NULL
                GROUP BY marker_filename
               HAVING COUNT(DISTINCT marker_sha256) > 1)
         ORDER BY t.marker_filename, t.id
        ON CONFLICT (name) DO NOTHING;
        """)

        # Migrazione retroattiva: i contatti esistenti hanno gia\' role (TEXT libero)
        # ma per il nuovo flusso vogliamo solo medico/laboratorio. Aggiungo un commento
        # senza vincoli (i vecchi role restano validi). La UI filtrera\' solo per
        # medico/laboratorio quando serve.



async def get_user_pro_role(user_id: str) -> Optional[str]:
    """Ritorna 'medico'/'laboratorio'/None per l\'utente."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT pro_role FROM users WHERE id = $1", user_id)
        return row["pro_role"] if row else None


async def set_user_pro_role(user_id: str, pro_role: str) -> bool:
    """Imposta il ruolo professionale dell\'utente (medico/laboratorio).
    Si puo\' settare solo una volta: se gia\' impostato, ritorna False."""
    if pro_role not in ("medico", "laboratorio"):
        raise ValueError("pro_role deve essere 'medico' o 'laboratorio'")
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE users SET pro_role = $1, pro_role_set_at = NOW()
            WHERE id = $2 AND pro_role IS NULL
        """, pro_role, user_id)
        return result.endswith("1")


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


# ── v8.x: nuovo flusso registrazione → autorizzazione ─────────────────────────
async def create_user_pending(email: str, name: str, password_hash: str, salt: str,
                              organization: Optional[str], city: str, phone: str) -> str:
    """Crea un utente in attesa di autorizzazione (nessuna licenza).
    active = FALSE, license_key = NULL. Solleva ValueError se l'email esiste già."""
    import uuid
    user_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute("""
                INSERT INTO users (id, email, name, organization, password_hash, salt,
                                   city, phone, role, active, license_key, login_count)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user', FALSE, NULL, 0)
            """, user_id, email, name, organization, password_hash, salt, city, phone)
        except Exception as e:
            if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
                raise ValueError("Email già registrata.")
            raise
    return user_id


async def touch_login(user_id: str) -> None:
    """Aggiorna last_login e incrementa login_count a ogni accesso riuscito."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE users
            SET last_login = NOW(),
                login_count = COALESCE(login_count, 0) + 1
            WHERE id = $1
        """, user_id)


async def list_all_users() -> list[dict]:
    """Tutti gli utenti con metriche per il pannello admin.
    Una sola query con LEFT JOIN sul conteggio analisi (niente N+1)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT u.id, u.email, u.name, u.organization, u.city, u.phone,
                   u.role, u.active, u.license_key, u.created_at,
                   u.last_login, COALESCE(u.login_count, 0) AS login_count,
                   COALESCE(a.cnt, 0) AS analyses_count
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS cnt FROM analyses GROUP BY user_id
            ) a ON a.user_id = u.id
            ORDER BY u.created_at DESC
        """)
        return [dict(r) for r in rows]


async def authorize_user(user_id: str) -> Optional[str]:
    """Autorizza un utente pending: genera una chiave SICP, la inserisce in licenses,
    la associa all'utente e mette active = TRUE. Tutto in transazione.
    Ritorna la chiave generata, None se l'utente non esiste.
    Se l'utente ha già una licenza, la restituisce senza generarne una nuova."""
    import uuid
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            urow = await conn.fetchrow(
                "SELECT license_key FROM users WHERE id = $1 FOR UPDATE", user_id)
            if not urow:
                return None
            if urow["license_key"]:
                await conn.execute("UPDATE users SET active = TRUE WHERE id = $1", user_id)
                return urow["license_key"]

            def _gen():
                parts = [uuid.uuid4().hex[:4].upper() for _ in range(3)]
                return f"SICP-{'-'.join(parts)}"
            key = _gen()
            for _ in range(5):
                exists = await conn.fetchval("SELECT 1 FROM licenses WHERE key = $1", key)
                if not exists:
                    break
                key = _gen()

            await conn.execute("""
                INSERT INTO licenses (key, used_by, used_at, active)
                VALUES ($1, $2, NOW(), TRUE)
            """, key, user_id)
            await conn.execute("""
                UPDATE users SET license_key = $1, active = TRUE WHERE id = $2
            """, key, user_id)
            return key


async def revoke_user(user_id: str) -> bool:
    """Revoca l'autorizzazione: disattiva la licenza, la scollega dall'utente,
    mette active = FALSE. L'utente torna in stato pending."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            urow = await conn.fetchrow(
                "SELECT license_key FROM users WHERE id = $1 FOR UPDATE", user_id)
            if not urow:
                return False
            if urow["license_key"]:
                await conn.execute(
                    "UPDATE licenses SET active = FALSE WHERE key = $1", urow["license_key"])
            await conn.execute(
                "UPDATE users SET license_key = NULL, active = FALSE WHERE id = $1", user_id)
            return True


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
                   c.role, c.contact_pro_role, c.notes, c.status, c.created_at, c.updated_at,
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
                                contact_pro_role: Optional[str] = None,
                                notes: Optional[str] = None) -> dict:
    """Aggiunge un contatto. Se l'email corrisponde a un utente Syntesis,
    lo collega automaticamente (status=active). Altrimenti pending.
    Solleva ValueError se duplicato (owner+email)."""
    if contact_pro_role is not None and contact_pro_role not in ('medico', 'laboratorio'):
        raise ValueError("contact_pro_role deve essere 'medico' o 'laboratorio'")
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
                                       display_name, role, contact_pro_role, notes, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, contact_id, owner_user_id, contact_email, contact_user_id,
                display_name, role, contact_pro_role, notes, status)
        except asyncpg.UniqueViolationError:
            raise ValueError("Hai gia' un contatto con questa email.")
    return {
        "id": contact_id,
        "contact_email": contact_email,
        "contact_user_id": contact_user_id,
        "display_name": display_name,
        "role": role,
        "contact_pro_role": contact_pro_role,
        "notes": notes,
        "status": status,
    }


async def update_user_contact(contact_id: str, owner_user_id: str,
                                display_name: Optional[str] = None,
                                role: Optional[str] = None,
                                contact_pro_role: Optional[str] = None,
                                notes: Optional[str] = None) -> bool:
    """Aggiorna metadati di un contatto (nome/ruolo/note). NON cambia email."""
    if display_name is None and role is None and contact_pro_role is None and notes is None:
        return False
    pool = await get_pool()
    async with pool.acquire() as conn:
        sets = ["updated_at = NOW()"]
        params = []
        if display_name is not None:
            sets.append(f"display_name = ${len(params)+1}"); params.append(display_name)
        if role is not None:
            sets.append(f"role = ${len(params)+1}"); params.append(role)
        if contact_pro_role is not None:
            if contact_pro_role and contact_pro_role not in ('medico', 'laboratorio'):
                raise ValueError("contact_pro_role deve essere 'medico'/'laboratorio'/''")
            # stringa vuota = clear (NULL)
            value = contact_pro_role if contact_pro_role else None
            sets.append(f"contact_pro_role = ${len(params)+1}"); params.append(value)
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



# ─────────────────────────────────────────────────────────────────────────────
# v7.3.9.062 - CARTELLE CONDIVISE
# ─────────────────────────────────────────────────────────────────────────────

import secrets

def _gen_id() -> str:
    """Genera un ID compatto sicuro per shared_folders."""
    return secrets.token_urlsafe(12)


async def create_shared_folder(
    owner_user_id: str,
    folder_name: str,
    owner_drive_folder_id: str,
    description: Optional[str] = None,
) -> dict:
    """Crea un record shared_folders. La cartella su Drive deve gia' essere creata."""
    pool = await get_pool()
    sf_id = _gen_id()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO shared_folders
                (id, owner_user_id, folder_name, description, owner_drive_folder_id)
            VALUES ($1, $2, $3, $4, $5)
        """, sf_id, owner_user_id, folder_name, description, owner_drive_folder_id)
    return {
        "id": sf_id,
        "owner_user_id": owner_user_id,
        "folder_name": folder_name,
        "owner_drive_folder_id": owner_drive_folder_id,
    }


async def add_shared_folder_member(
    shared_folder_id: str,
    member_email: str,
    invited_by_user_id: str,
) -> dict:
    """Aggiunge un membro a una cartella condivisa. Se l'email corrisponde
    a un utente registrato, ne valorizza l'user_id. Status=pending fino all'accept."""
    member_email = member_email.lower().strip()
    pool = await get_pool()
    member_id = _gen_id()
    async with pool.acquire() as conn:
        # Cerco se l'email e' di un utente gia' registrato
        existing_user = await conn.fetchrow(
            "SELECT id FROM users WHERE LOWER(email) = $1 AND active = TRUE",
            member_email
        )
        member_user_id = existing_user["id"] if existing_user else None

        try:
            await conn.execute("""
                INSERT INTO shared_folder_members
                    (id, shared_folder_id, member_user_id, member_email, status, invited_by)
                VALUES ($1, $2, $3, $4, 'pending', $5)
            """, member_id, shared_folder_id, member_user_id, member_email, invited_by_user_id)
        except Exception as e:
            # Probabilmente UNIQUE violation (gia' invitato)
            return {"id": None, "error": "already_invited"}
    return {
        "id": member_id,
        "member_email": member_email,
        "member_user_id": member_user_id,
        "status": "pending",
    }


async def get_shared_folder(shared_folder_id: str) -> Optional[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, owner_user_id, folder_name, description,
                   owner_drive_folder_id, created_at, updated_at
            FROM shared_folders WHERE id = $1
        """, shared_folder_id)
    return dict(row) if row else None


async def list_owned_shared_folders(owner_user_id: str) -> list[dict]:
    """Cartelle che ho condiviso io con altri."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT sf.id, sf.folder_name, sf.description, sf.owner_drive_folder_id,
                   sf.created_at,
                   (SELECT COUNT(*) FROM shared_folder_members
                    WHERE shared_folder_id = sf.id AND status = 'active') AS n_active,
                   (SELECT COUNT(*) FROM shared_folder_members
                    WHERE shared_folder_id = sf.id AND status = 'pending') AS n_pending
            FROM shared_folders sf
            WHERE sf.owner_user_id = $1
            ORDER BY sf.created_at DESC
        """, owner_user_id)
    return [dict(r) for r in rows]


async def list_member_shared_folders(member_user_id: str) -> list[dict]:
    """Cartelle condivise CON me, dove ho gia' accettato (status=active)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT sfm.id AS membership_id,
                   sfm.member_drive_folder_id,
                   sf.id AS shared_folder_id,
                   sf.folder_name, sf.description,
                   sf.owner_user_id,
                   u.email AS owner_email, u.name AS owner_name,
                   sfm.responded_at AS accepted_at
            FROM shared_folder_members sfm
            JOIN shared_folders sf ON sf.id = sfm.shared_folder_id
            JOIN users u ON u.id = sf.owner_user_id
            WHERE sfm.member_user_id = $1 AND sfm.status = 'active'
            ORDER BY sfm.responded_at DESC
        """, member_user_id)
    return [dict(r) for r in rows]


async def list_pending_invites_for_user(member_user_id: str, member_email: str) -> list[dict]:
    """Inviti pending per questo utente (matched per user_id O per email)."""
    pool = await get_pool()
    member_email = member_email.lower().strip()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT sfm.id AS membership_id,
                   sf.id AS shared_folder_id,
                   sf.folder_name, sf.description,
                   sf.owner_user_id,
                   u.email AS owner_email, u.name AS owner_name,
                   sfm.invited_at
            FROM shared_folder_members sfm
            JOIN shared_folders sf ON sf.id = sfm.shared_folder_id
            JOIN users u ON u.id = sf.owner_user_id
            WHERE sfm.status = 'pending'
              AND (sfm.member_user_id = $1 OR LOWER(sfm.member_email) = $2)
            ORDER BY sfm.invited_at DESC
        """, member_user_id, member_email)
    return [dict(r) for r in rows]


async def get_membership(membership_id: str) -> Optional[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, shared_folder_id, member_user_id, member_email,
                   member_drive_folder_id, status, invited_by, invited_at, responded_at
            FROM shared_folder_members WHERE id = $1
        """, membership_id)
    return dict(row) if row else None


async def accept_shared_invite(
    membership_id: str,
    accepting_user_id: str,
    user_email: str,
    member_drive_folder_id: str,
) -> bool:
    """L'utente accetta l'invito. Aggiorna status=active, valorizza user_id e
    member_drive_folder_id (il mirror creato nel suo Drive)."""
    user_email = user_email.lower().strip()
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE shared_folder_members
            SET status = 'active',
                member_user_id = $1,
                member_drive_folder_id = $2,
                responded_at = NOW()
            WHERE id = $3
              AND status = 'pending'
              AND (member_user_id = $1 OR LOWER(member_email) = $4)
        """, accepting_user_id, member_drive_folder_id, membership_id, user_email)
    return result.endswith(" 1")


async def decline_shared_invite(
    membership_id: str,
    declining_user_id: str,
    user_email: str,
) -> bool:
    user_email = user_email.lower().strip()
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE shared_folder_members
            SET status = 'declined',
                member_user_id = COALESCE(member_user_id, $1),
                responded_at = NOW()
            WHERE id = $2
              AND status = 'pending'
              AND (member_user_id = $1 OR LOWER(member_email) = $3)
        """, declining_user_id, membership_id, user_email)
    return result.endswith(" 1")


async def list_active_members_of_folder(shared_folder_id: str) -> list[dict]:
    """Ritorna i membri attivi di una cartella condivisa, con i loro drive_folder_id.
    Serve per la replica file."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id AS membership_id, member_user_id, member_email,
                   member_drive_folder_id
            FROM shared_folder_members
            WHERE shared_folder_id = $1 AND status = 'active'
              AND member_drive_folder_id IS NOT NULL
        """, shared_folder_id)
    return [dict(r) for r in rows]


async def get_shared_folder_by_drive_id(drive_folder_id: str, user_id: str) -> Optional[dict]:
    """Data una drive_folder_id, ritorna la shared_folder se l'utente ne fa parte
    (come owner o come membro attivo). Serve per sapere se un upload va replicato."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Sono owner?
        row = await conn.fetchrow("""
            SELECT id, owner_user_id, folder_name, owner_drive_folder_id, 'owner' AS role
            FROM shared_folders
            WHERE owner_drive_folder_id = $1 AND owner_user_id = $2
        """, drive_folder_id, user_id)
        if row:
            return dict(row)
        # Sono membro?
        row = await conn.fetchrow("""
            SELECT sf.id, sf.owner_user_id, sf.folder_name, sf.owner_drive_folder_id, 'member' AS role
            FROM shared_folders sf
            JOIN shared_folder_members sfm ON sfm.shared_folder_id = sf.id
            WHERE sfm.member_drive_folder_id = $1
              AND sfm.member_user_id = $2
              AND sfm.status = 'active'
        """, drive_folder_id, user_id)
        return dict(row) if row else None


async def reconcile_pending_shared_invites(user_id: str, user_email: str) -> int:
    """Quando un utente si registra, collega gli inviti pending alla sua user_id.
    Ritorna il numero di inviti aggiornati."""
    user_email = user_email.lower().strip()
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE shared_folder_members
            SET member_user_id = $1
            WHERE LOWER(member_email) = $2
              AND member_user_id IS NULL
              AND status = 'pending'
        """, user_id, user_email)
    return int(result.split()[-1]) if result else 0


# =====================================================================
# Replace-iT (Passo 1) — librerie scanbody Exocad
# Schema creato in init_db() (blocco v8.16.0). Il PARSING dello ZIP vive
# in admin.py (non e\' DB); qui solo lettura/scrittura. La scrittura e\'
# ATOMICA: rit_import_library() fa tutto in un\'unica transazione, quindi
# un errore (es. import_name duplicato) lascia il DB invariato.
# =====================================================================

def _iso(dt):
    """Serializza un datetime in ISO; passa-attraverso None/altri tipi."""
    try:
        return dt.isoformat()
    except AttributeError:
        return dt


async def rit_find_libraries_by_keyword(keyword: str) -> list[dict]:
    """Librerie che condividono lo stesso keyword Exocad (non-unique).
    Usata per rilevare il conflitto in ingest e popolare existing[] nel 409."""
    if not keyword:
        return []
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT l.id, l.import_name, l.keyword, l.display, l.supplier,
                   l.supplier_version, l.active, l.uploaded_by, l.uploaded_at,
                   (SELECT COUNT(*) FROM rit_scanbody_type t WHERE t.library_id = l.id) AS n_types
            FROM rit_library l
            WHERE l.keyword = $1
            ORDER BY l.uploaded_at DESC
        """, keyword)
    out = []
    for r in rows:
        d = dict(r)
        d["uploaded_at"] = _iso(d.get("uploaded_at"))
        d["n_types"] = int(d.get("n_types") or 0)
        out.append(d)
    return out


async def rit_list_libraries() -> list[dict]:
    """Elenco di tutte le librerie con conteggio type (per la tabella in /gestione)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT l.id, l.import_name, l.keyword, l.display, l.supplier,
                   l.supplier_version, l.active, l.uploaded_by, l.uploaded_at,
                   (SELECT COUNT(*) FROM rit_scanbody_type t WHERE t.library_id = l.id) AS n_types
            FROM rit_library l
            ORDER BY l.uploaded_at DESC
        """)
    out = []
    for r in rows:
        d = dict(r)
        d["uploaded_at"] = _iso(d.get("uploaded_at"))
        d["n_types"] = int(d.get("n_types") or 0)
        out.append(d)
    return out


async def rit_list_active_libraries() -> list[dict]:
    """Superficie clinica (/api/rit): solo librerie ATTIVE e soli campi clinici
    (niente uploaded_by/uploaded_at). Conteggio type incluso come `n_type`."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT l.id, l.import_name, l.keyword, l.display, l.supplier,
                   l.supplier_version, l.marca, l.modello, l.diametro,
                   (SELECT COUNT(*) FROM rit_scanbody_type t WHERE t.library_id = l.id AND t.active = TRUE) AS n_types
            FROM rit_library l
            WHERE l.active = TRUE
            ORDER BY l.display NULLS LAST, l.import_name
        """)
    return [{
        "id": r["id"],
        "import_name": r["import_name"],
        "keyword": r["keyword"],
        "display": r["display"],
        "supplier": r["supplier"],
        "supplier_version": r["supplier_version"],
        "marca": r["marca"],
        "modello": r["modello"],
        "diametro": r["diametro"],
        "n_type": int(r["n_types"] or 0),
    } for r in rows]


async def rit_get_library_detail(library_id: int, active_only: bool = False) -> Optional[dict]:
    """Dettaglio read-only: root-params + lista type con TUTTI i parametri.
    Esclude i BYTEA (preview/logo serviti a parte). None se non esiste.
    active_only=True (superficie clinica /api/rit): None anche se la libreria
    esiste ma non e' attiva."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        _act = " AND active = TRUE" if active_only else ""
        lib = await conn.fetchrow(f"""
            SELECT id, import_name, keyword, display, connection_id,
                   rotation_lock_count, ref_rotation_offset,
                   axis_occlusal_x, axis_occlusal_y, axis_occlusal_z,
                   supplier, supplier_version, source, marca, modello, diametro,
                   active, uploaded_by, uploaded_at,
                   (preview_png IS NOT NULL) AS has_preview,
                   (logo_png IS NOT NULL) AS has_logo
            FROM rit_library WHERE id = $1{_act}
        """, library_id)
        if lib is None:
            return None
        # superficie clinica (active_only): mostra solo i type ATTIVI; l'admin
        # (active_only=False) li vede tutti, anche i disattivati, per gestirli.
        _tact = " AND active = TRUE" if active_only else ""
        types = await conn.fetch(f"""
            SELECT id, display, keyword, marker_filename, marker_sha256,
                   click_center_x, click_center_y, click_center_z,
                   axis_asymmetric_x, axis_asymmetric_y, axis_asymmetric_z,
                   is_eng, role, active, ord
            FROM rit_scanbody_type
            WHERE library_id = $1{_tact}
            ORDER BY ord NULLS LAST, id
        """, library_id)
    return {
        "id": lib["id"],
        "import_name": lib["import_name"],
        "keyword": lib["keyword"],
        "display": lib["display"],
        "connection_id": lib["connection_id"],
        "rotation_lock_count": lib["rotation_lock_count"],
        "ref_rotation_offset": lib["ref_rotation_offset"],
        "axis_occlusal": {"x": lib["axis_occlusal_x"], "y": lib["axis_occlusal_y"], "z": lib["axis_occlusal_z"]},
        "supplier": lib["supplier"],
        "supplier_version": lib["supplier_version"],
        "source": lib["source"],
        "marca": lib["marca"],
        "modello": lib["modello"],
        "diametro": lib["diametro"],
        "active": lib["active"],
        "uploaded_by": lib["uploaded_by"],
        "uploaded_at": _iso(lib["uploaded_at"]),
        "has_preview": lib["has_preview"],
        "has_logo": lib["has_logo"],
        "types": [{
            "id": t["id"],
            "display": t["display"],
            "keyword": t["keyword"],
            "marker_filename": t["marker_filename"],
            "marker_sha256": t["marker_sha256"],
            "click_center": {"x": t["click_center_x"], "y": t["click_center_y"], "z": t["click_center_z"]},
            "axis_asymmetric": {"x": t["axis_asymmetric_x"], "y": t["axis_asymmetric_y"], "z": t["axis_asymmetric_z"]},
            "is_eng": t["is_eng"],
            "role": t["role"],
            "active": t["active"],
            "ord": t["ord"],
        } for t in types],
    }


class _RitInvariantError(Exception):
    """Sentinella interna: l'op lascerebbe una libreria ATTIVA senza madre o
    senza figlio. Sollevata DENTRO la transazione -> rollback."""


async def _rit_active_caps(conn, library_id: int):
    """(madre_capace, figlio_capace) tra i type ATTIVI della libreria."""
    rows = await conn.fetch(
        "SELECT role FROM rit_scanbody_type WHERE library_id = $1 AND active = TRUE",
        library_id)
    roles = [r["role"] for r in rows]
    return (any(r in ("madre", "entrambi") for r in roles),
            any(r in ("figlio", "entrambi") for r in roles))


async def rit_update_scanbody_type(*, type_id: int, library_id: int,
                                   updates: dict) -> str:
    """PATCH dei campi editabili di un type (SOLO quelli presenti in `updates`:
    display/role/is_eng/active — semantica PATCH). La geometria NON e' editabile.
    Scopato per library_id. Ritorna: updated | noop | not_found | would_break
    (l'op lascerebbe una libreria ATTIVA senza madre o senza figlio)."""
    cols = ("display", "role", "is_eng", "active")
    fields = [(c, updates[c]) for c in cols if c in updates]
    if not fields:
        return "noop"
    sets = ", ".join(f"{c} = ${i+3}" for i, (c, _) in enumerate(fields))
    vals = [v for _, v in fields]
    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            async with conn.transaction():
                lib_active = await conn.fetchval(
                    "SELECT active FROM rit_library WHERE id = $1", library_id)
                mb0, fb0 = await _rit_active_caps(conn, library_id)
                res = await conn.execute(
                    f"UPDATE rit_scanbody_type SET {sets} WHERE id = $1 AND library_id = $2",
                    type_id, library_id, *vals)
                if res.split()[-1] == "0":
                    return "not_found"
                if lib_active:
                    mb1, fb1 = await _rit_active_caps(conn, library_id)
                    # blocca solo se l'invariante ERA soddisfatta e ora si rompe
                    # (non penalizza librerie con ruoli ancora NULL)
                    if (mb0 and fb0) and not (mb1 and fb1):
                        raise _RitInvariantError()
                return "updated"
        except _RitInvariantError:
            return "would_break"


async def rit_delete_scanbody_type(type_id: int, library_id: int) -> str:
    """Cancella un type da una libreria. Ritorna: deleted | not_found |
    would_break (lascerebbe una libreria ATTIVA senza madre o senza figlio)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            async with conn.transaction():
                lib_active = await conn.fetchval(
                    "SELECT active FROM rit_library WHERE id = $1", library_id)
                mb0, fb0 = await _rit_active_caps(conn, library_id)
                res = await conn.execute(
                    "DELETE FROM rit_scanbody_type WHERE id = $1 AND library_id = $2",
                    type_id, library_id)
                if res.split()[-1] == "0":
                    return "not_found"
                if lib_active:
                    mb1, fb1 = await _rit_active_caps(conn, library_id)
                    if (mb0 and fb0) and not (mb1 and fb1):
                        raise _RitInvariantError()
                return "deleted"
        except _RitInvariantError:
            return "would_break"


async def rit_get_library_image(library_id: int, which: str, active_only: bool = False) -> Optional[bytes]:
    """Ritorna i bytes di preview_png o logo_png; None se assenti.
    active_only=True (superficie clinica): None anche se la libreria non e' attiva."""
    col = "preview_png" if which == "preview" else "logo_png"
    pool = await get_pool()
    async with pool.acquire() as conn:
        _act = " AND active = TRUE" if active_only else ""
        val = await conn.fetchval(f"SELECT {col} FROM rit_library WHERE id = $1{_act}", library_id)
    return bytes(val) if val is not None else None


async def rit_get_marker_bytes(sha256: str) -> Optional[bytes]:
    """Bytes STL di un marker per sha256 (globale, /api/rit/markers). None se lo
    sha non esiste. Nessun filtro sull'attivazione (lo sha si scopre solo dal
    detail di una libreria attiva; la mesh marker non e' dato sensibile)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval(
            "SELECT content FROM rit_marker_stl WHERE sha256 = $1", sha256
        )
    return bytes(val) if val is not None else None


async def rit_set_library_active(library_id: int, active: bool) -> bool:
    """Attiva/disattiva una libreria. False se l\'id non esiste."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute(
            "UPDATE rit_library SET active = $2 WHERE id = $1", library_id, active
        )
    # asyncpg ritorna 'UPDATE n'
    return res.split()[-1] != "0"


async def rit_import_library(*, parsed: dict, import_name: Optional[str],
                             uploaded_by: Optional[str],
                             overwrite_target_id: Optional[int] = None,
                             preserve_active: bool = False) -> int:
    """Scrive una libreria in UNICA transazione. Se overwrite_target_id e\'
    dato, cancella prima quella libreria (CASCADE sui type; gli STL marker
    deduplicati sopravvivono) e ne eredita l\'import_name se non fornito.
    Gli STL sono inseriti con ON CONFLICT DO NOTHING (dedup per sha256).
    preserve_active=True (upsert CSV/editor 8.50.0): la libreria ricreata
    eredita il flag active della precedente (default False = comportamento
    storico Exocad: import -> attivazione manuale).
    Solleva asyncpg.UniqueViolationError se import_name e\' gia\' preso ->
    l\'intera transazione viene annullata. Ritorna l\'id della nuova libreria."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            new_active = False
            preserved = {}   # (marker_filename, display) -> {"active","role"}
            if overwrite_target_id is not None:
                old = await conn.fetchrow(
                    "SELECT import_name, active FROM rit_library WHERE id = $1",
                    overwrite_target_id)
                if old is not None:
                    if not import_name:
                        import_name = old["import_name"]
                    if preserve_active:
                        new_active = bool(old["active"])
                # I flag per-type (active disattivato a mano, role assegnato a
                # mano alle LITE) NON sono nell'import: li preservo attraverso
                # l'overwrite, altrimenti un re-upload li azzererebbe.
                for r in await conn.fetch(
                    "SELECT marker_filename, display, active, role "
                    "FROM rit_scanbody_type WHERE library_id = $1",
                    overwrite_target_id):
                    preserved[(r["marker_filename"], r["display"])] = {
                        "active": r["active"], "role": r["role"]}
                await conn.execute("DELETE FROM rit_library WHERE id = $1", overwrite_target_id)
            if not import_name:
                import_name = parsed.get("default_import_name")

            # STL marker deduplicati per sha256 del contenuto (globali)
            for sha, m in parsed["markers"].items():
                await conn.execute("""
                    INSERT INTO rit_marker_stl (sha256, content, original_filename, size_bytes)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (sha256) DO NOTHING
                """, sha, m["content"], m["filename"], m["size"])

            ax = parsed.get("axis_occlusal") or (None, None, None)
            lib_id = await conn.fetchval("""
                INSERT INTO rit_library (
                    import_name, keyword, display, connection_id,
                    rotation_lock_count, ref_rotation_offset,
                    axis_occlusal_x, axis_occlusal_y, axis_occlusal_z,
                    supplier, supplier_version, preview_png, logo_png,
                    active, uploaded_by, source, marca, modello, diametro
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
                RETURNING id
            """, import_name, parsed.get("keyword"), parsed.get("display"),
                 parsed.get("connection_id"), parsed.get("rotation_lock_count"),
                 parsed.get("ref_rotation_offset"), ax[0], ax[1], ax[2],
                 parsed.get("supplier"), parsed.get("supplier_version"),
                 parsed.get("preview_png"), parsed.get("logo_png"), new_active,
                 uploaded_by, parsed.get("source"),
                 parsed.get("marca"), parsed.get("modello"), parsed.get("diametro"))

            for t in parsed["types"]:
                cc = t["click_center"]
                aa = t["axis_asymmetric"]
                prev = preserved.get((t["marker_filename"], t["display"]))
                # role: dall'import se presente (CSV/editor), altrimenti il
                # preservato (es. assegnato a mano a una LITE). active: il
                # preservato (nessun import lo porta), default TRUE.
                t_role = t.get("role") or (prev["role"] if prev else None)
                t_active = prev["active"] if prev else True
                await conn.execute("""
                    INSERT INTO rit_scanbody_type (
                        library_id, display, keyword, marker_filename, marker_sha256,
                        click_center_x, click_center_y, click_center_z,
                        axis_asymmetric_x, axis_asymmetric_y, axis_asymmetric_z,
                        is_eng, ord, role, active
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                """, lib_id, t["display"], t["keyword"], t["marker_filename"],
                     t["marker_sha256"], cc[0], cc[1], cc[2], aa[0], aa[1], aa[2],
                     t["is_eng"], t["ord"], t_role, t_active)

            return lib_id


# ─── v8.50.0: archivio STL ("cartella unica" per nome) + lucchetto ──────────

_RIT_ORPHAN_SWEEP = """
    DELETE FROM rit_marker_stl m WHERE m.sha256 = $1
      AND NOT EXISTS (SELECT 1 FROM rit_stl_asset a WHERE a.sha256 = m.sha256)
      AND NOT EXISTS (SELECT 1 FROM rit_scanbody_type t WHERE t.marker_sha256 = m.sha256)
"""


async def rit_list_stl_assets() -> list[dict]:
    """Archivio STL per nome (cartella unica). used_by = n. librerie che usano
    l'asset, di QUALSIASI sorgente (Exocad/CSV/editor): match per nome su
    marker_filename (gia' basename per tutte le righe dopo la normalizzazione
    in init_db)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT a.name, a.sha256, a.locked, a.size_bytes, a.uploaded_by,
                   a.uploaded_at, a.updated_at,
                   (SELECT COUNT(DISTINCT t.library_id)
                      FROM rit_scanbody_type t
                     WHERE t.marker_filename = a.name) AS used_by
            FROM rit_stl_asset a
            ORDER BY a.name
        """)
    out = []
    for r in rows:
        d = dict(r)
        d["uploaded_at"] = _iso(d.get("uploaded_at"))
        d["updated_at"] = _iso(d.get("updated_at"))
        d["used_by"] = int(d.get("used_by") or 0)
        out.append(d)
    return out


async def rit_get_stl_asset(name: str) -> Optional[dict]:
    """Asset per nome (name, sha256, locked, size_bytes). None se non esiste."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT name, sha256, locked, size_bytes FROM rit_stl_asset WHERE name = $1",
            name)
    return dict(row) if row else None


async def rit_save_stl_asset(*, name: str, content: bytes,
                             uploaded_by: Optional[str],
                             overwrite: bool = False,
                             allow_locked: bool = False) -> dict:
    """Crea o sovrascrive un asset dell'archivio. status:
    created | unchanged (stesso contenuto) | conflict (nome esistente con
    contenuto diverso e overwrite=False; include locked) | locked (asset
    bloccato e allow_locked=False: il lucchetto e' verificato QUI, dentro la
    transazione — il caller passa allow_locked=True SOLO dopo aver verificato
    il codice con _rit_check_lock_code) | overwritten (con n_types = type
    CSV/editor ripuntati al nuovo contenuto, "live per nome")."""
    import hashlib
    sha = hashlib.sha256(content).hexdigest()
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            ex = await conn.fetchrow(
                "SELECT sha256, locked FROM rit_stl_asset WHERE name = $1", name)
            if ex is not None and ex["sha256"] == sha:
                return {"status": "unchanged", "name": name, "sha256": sha}
            if ex is not None and not overwrite:
                return {"status": "conflict", "name": name, "locked": ex["locked"]}
            if ex is not None and ex["locked"] and not allow_locked:
                return {"status": "locked", "name": name}
            await conn.execute("""
                INSERT INTO rit_marker_stl (sha256, content, original_filename, size_bytes)
                VALUES ($1, $2, $3, $4) ON CONFLICT (sha256) DO NOTHING
            """, sha, content, name, len(content))
            if ex is None:
                await conn.execute("""
                    INSERT INTO rit_stl_asset (name, sha256, size_bytes, uploaded_by)
                    VALUES ($1, $2, $3, $4)
                """, name, sha, len(content), uploaded_by)
                return {"status": "created", "name": name, "sha256": sha}
            old_sha = ex["sha256"]
            await conn.execute("""
                UPDATE rit_stl_asset SET sha256 = $2, size_bytes = $3,
                       uploaded_by = $4, updated_at = NOW()
                WHERE name = $1
            """, name, sha, len(content), uploaded_by)
            # propagazione "live per nome" GLOBALE: ogni type (qualsiasi
            # sorgente, Exocad inclusa) che usa questo nome segue il nuovo
            # contenuto. Il lucchetto e' la protezione dei master validati.
            res = await conn.execute("""
                UPDATE rit_scanbody_type SET marker_sha256 = $2
                WHERE marker_filename = $1
            """, name, sha)
            n_types = int(res.split()[-1])
            await conn.execute(_RIT_ORPHAN_SWEEP, old_sha)
            return {"status": "overwritten", "name": name, "sha256": sha,
                    "n_types": n_types}


async def rit_delete_stl_asset(name: str) -> dict:
    """Cancella un asset. status: deleted | not_found | locked (sbloccare
    prima) | in_use (usato da librerie CSV/editor, con used_by)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            ex = await conn.fetchrow(
                "SELECT sha256, locked FROM rit_stl_asset WHERE name = $1", name)
            if ex is None:
                return {"status": "not_found"}
            if ex["locked"]:
                return {"status": "locked"}
            used = await conn.fetchval("""
                SELECT COUNT(DISTINCT t.library_id) FROM rit_scanbody_type t
                WHERE t.marker_filename = $1
            """, name)
            if int(used or 0) > 0:
                return {"status": "in_use", "used_by": int(used)}
            await conn.execute("DELETE FROM rit_stl_asset WHERE name = $1", name)
            await conn.execute(_RIT_ORPHAN_SWEEP, ex["sha256"])
            return {"status": "deleted"}


async def rit_set_stl_asset_locked(name: str, locked: bool) -> bool:
    """Imposta il lucchetto. False se l'asset non esiste. La verifica del
    codice (per lo SBLOCCO) sta nell'endpoint, non qui."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute(
            "UPDATE rit_stl_asset SET locked = $2 WHERE name = $1", name, locked)
    return res.split()[-1] != "0"


async def rit_get_lock_secret() -> Optional[dict]:
    """Hash+salt del codice di sicurezza del lucchetto (riga unica id=1)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT code_hash, code_salt FROM rit_lock_secret WHERE id = 1")
    return dict(row) if row else None


async def rit_set_lock_secret(code_hash: str, code_salt: str,
                              updated_by: Optional[str]) -> None:
    """Imposta/cambia il codice (gia' hashed dal caller via auth.hash_password)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO rit_lock_secret (id, code_hash, code_salt, updated_by, updated_at)
            VALUES (1, $1, $2, $3, NOW())
            ON CONFLICT (id) DO UPDATE
               SET code_hash = $1, code_salt = $2, updated_by = $3, updated_at = NOW()
        """, code_hash, code_salt, updated_by)


async def rit_find_library_by_import_name(import_name: str) -> Optional[dict]:
    """Libreria per import_name esatto (per l'upsert CSV/editor). None se assente."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT l.id, l.import_name, l.display, l.active, l.uploaded_by, l.uploaded_at,
                   (SELECT COUNT(*) FROM rit_scanbody_type t WHERE t.library_id = l.id) AS n_types
            FROM rit_library l WHERE l.import_name = $1
        """, import_name)
    if row is None:
        return None
    d = dict(row)
    d["uploaded_at"] = _iso(d.get("uploaded_at"))
    d["n_types"] = int(d.get("n_types") or 0)
    return d

