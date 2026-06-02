# Syntesis-ICP - Handover 8.6.4

> **Versione live:** 8.6.4 (2026-06-01, su entrambi i servizi Railway). **Doc generato:** 2026-06-02.
> Sintesi di handover per project-knowledge. Per il dettaglio canonico: `CLAUDE.md` (regole), `STATO_SISTEMA.md` (stato/incident/TODO), `docs/MAPPA_FUNZIONALE.md` (mappa UI per-riga), `MASTER_DOC.md` (documento maestro storico).

## 1. Cos'è
SaaS B2B per analisi di precisione di scansioni intraorali dentali. Confronta due STL via ICP, individua gli scanbody (cilindri di riferimento), calcola deviazioni centroide-per-centroide (ΔXY, ΔZ, ΔD3D), gestisce il posizionamento MUA (cono di accoppiamento, fresabilità 5 assi), genera report PDF clinici. Target: laboratori odontotecnici e studi dentistici italiani. Il brand corretto del prodotto è **"Synthesis"** (con la h); buona parte di file/route/domini usa ancora "syntesis" (senza h) per ragioni storiche.
Live: `https://app.syntesis-icp.com` (alias `syntesis-icp-production.up.railway.app`).

## 2. Architettura & stack
- **Backend**: FastAPI + Uvicorn + asyncpg + NumPy/SciPy/scikit-learn (Python 3.12).
- **Frontend**: vanilla JS, **file HTML statici serviti via `FileResponse`**, NO build step, NO framework, NO npm. La logica CAD/ICP (confronto STL, Kabsch+SVD, deviazioni assiali, report) gira **nel browser**.
- **DB**: PostgreSQL su Railway (interno, non esposto).
- **Deploy**: Railway, **due servizi** che servono lo stesso backend (BACKEND principale + LEGACY) nello stesso environment, via GitHub App.
- **Auth a stati**: `pending` (autenticato ma non autorizzato), `authorized`, `admin`. Il gating è **server-side** (`require_authorized`); `syn-gate.js` è solo lo strato UX.

## 3. Struttura del codice
- Monolite analyzer: **`backend/static/syntesis-analyzer-v3b.html`** (3.88 MB, 19.289 righe), 4 workflow interni (analizza / accoppia / misurare / sostituire) commutati da `selectWorkflow`.
- Altre viste statiche: `/` → `synthesis-home.html`, `/vedere` → `syntesis-icp-vedere.html`, `/dashboard` → `syntesis-dashboard-v1.html`, `/accedi` → `syntesis-accedi.html`, `/gestione` → `syntesis-gestione.html`.
- Backend: `main.py` (route + API), `icp_engine.py` (motore ICP / Kabsch), `pdf_gen.py` (PDF server-side), **`registry.py`** (single source of truth: scanbody, soglie cliniche, palette, `BACKEND_VERSION`).
- `backend/static/ds/`: design system (`tokens.css`, `components.css`) + `syn-gate.js`.
- Mappa per-riga completa: `docs/MAPPA_FUNZIONALE.md`.

## 4. Stato corrente (8.6.4)
- Live **8.6.4** su BACKEND (`b7671e12`) e LEGACY (`7ac922ce`).
- Home pubblica dark su `/` (splash con cornice perimetrale animata, deep-link `?wf=`, allineamento desktop ampio in 8.6.4).
- Gate accesso attivo su `/analizzare` (dalla 8.4.3).
- Dominio no-h `app.syntesis-icp.com` sano (HTTP 200, cert VALID). Dominio brand con-h `app.synthesis-icp.com` con cert in finalizzazione (vedi `STATO_SISTEMA.md` Sospesi #2).

## 5. Deploy (riassunto operativo)
1. Bump `registry.BACKEND_VERSION` (+ `<title>` / `window.ANALIZZA_BUILD` SOLO se tocchi il monolite v3b). Commit + push `origin main`.
2. `serviceInstanceDeploy(serviceId, environmentId, latestCommit:true)` su **entrambi** i servizi (header `User-Agent: Mozilla/5.0`). Mai `serviceDelete`; mai `serviceInstanceRedeploy` per cambi di codice.
3. Sequenza LEGACY (canary) → verifica → BACKEND. Poll fino a `SUCCESS`.
4. Verifica live (`curl -sL`): `/api/registry/constants` versione attesa, route 200, utente pending → 403.

Procedura autorevole: `CLAUDE.md` §4/§11 + skill `syntesis-deploy`.

## 6. Versioning
Semver `MAJOR.MINOR.PATCH` (era 8.x, post-unificazione v3b). Suffisso storico `-FASE.STEP` abbandonato alla chiusura della Fase A in 8.2.0. Canonico: `registry.BACKEND_VERSION` (`/api/registry/constants`).

## 7. Costanti cliniche (immutabili senza autorizzazione)
Scanbody 1T3 / OS / SR; soglie d3 (µm) `[50,100,150,250]`; angolari (deg) `[0.5,1.5,3,6]`; MUA cono semi-angolo 20°, divergenza coppia 40°, fresatura max 30° (solo 5 assi). Sorgente: `registry.py` → frontend `window.SYN`. Dettaglio: `CLAUDE.md` §7-9.

## 8. Incident & runbook
Incident 2026-05-20 → 21: Postgres in sleep/freeze → backend+legacy giù (lifespan FastAPI abortito su timeout `asyncpg`). Runbook **Postgres-first restart**: deploy Postgres → warm-up 45-60s → deploy servizio applicativo → verifica HTTP. Dettaglio completo in `STATO_SISTEMA.md`.

## 9. Aperti / TODO
- **TODO Francesco** (manuali): rotazione `RW_TOKEN` + rotazione password Postgres (in finestra a basso traffico: la rotazione triggera redeploy backend).
- Cert dominio brand con-h `app.synthesis-icp.com` (validazione finale Railway/Let's Encrypt).
- Gate `syn-gate.js` da estendere a `/vedere` e `/dashboard`; rimuovere `/api/analyze-public` (bypass del gate).
- Fase 0: split `syntesis-analyzer-v3b.html`, infra `scripts/`, pytest base sul motore ICP.
- (Sicurezza) Repo GitHub: verificare la visibilità voluta (era stato reso privato il 2026-06-01; oggi risulta pubblico).
- Coerenza naming "syntesis" (senza h) → brand "Synthesis" (con h) in file/route.

## 10. Divieti chiave (vedi `CLAUDE.md` §3)
NON spezzare i monoliti HTML / NON introdurre build step o npm; NON refactor non richiesti; NON hardcodare segreti (solo `scripts/.env.local`); `git add` per-file (mai `.` / `-A`); NESSUN trailer `Co-Authored-By` nei commit; MAI Read integrale di `syntesis-analyzer-v3b.html` (sempre `grep -n` + range stretti); ogni modifica UI aggiorna `docs/MAPPA_FUNZIONALE.md` nello stesso commit.

## 11. Documenti canonici
- `CLAUDE.md` - regole permanenti di progetto.
- `STATO_SISTEMA.md` - stato live, sospesi, incident log, runbook, TODO.
- `docs/MAPPA_FUNZIONALE.md` - mappa UI per-riga (5 viste).
- `MASTER_DOC.md` - documento maestro (architettura + storia stratificata).
- `docs/STORIA.md` - cronologia commit per commit.
