# Syntesis-ICP — Guida operativa Claude Code

## 1. Cos'è
SaaS B2B per analisi di precisione di scansioni intraorali dentali. Confronta due STL via ICP, individua scanbody (cilindri di riferimento), calcola deviazioni centroide-per-centroide (ΔXY, ΔZ, ΔD3D), gestisce posizionamento MUA con cono di accoppiamento e fresabilità 5-assi, genera report PDF clinici. Target: laboratori odontotecnici e studi dentistici italiani. URL live: https://app.syntesis-icp.com — alias https://syntesis-icp-production.up.railway.app/.

## 2. Stack
- **Backend**: FastAPI + Uvicorn + asyncpg + NumPy/SciPy/scikit-learn (Python 3.12)
- **Frontend**: vanilla JS, single-page, no framework. File principale `backend/static/syntesis-analyzer-v3b.html` (~3.87 MB, ~19 200 righe)
- **DB**: PostgreSQL su Railway (interno, non esposto)
- **Deploy**: Railway su 2 servizi paralleli (LEGACY + BACKEND principale) per l'environment unico
- **Custom domain**: `app.syntesis-icp.com` → CNAME verso il dominio Railway BACKEND

## 3. Regole ferree (rispettare sempre)
- `backend/static/syntesis-analyzer-v3b.html` è 3.87 MB, 19 000+ righe. **MAI** Read integrale né tool view su tutto il file. Sempre `grep -n` per localizzare, poi `sed -n 'N,Mp'` o `Read` con `offset`/`limit` su range stretti (max ~50 righe per blocco).
- Ogni modifica al codice di backend o frontend richiede bump versione coerente. Schema: `MAJOR.MINOR.BUILD-FASE.STEP` (es. `8.1.7-A.5.1`). Quando la Fase A viene promossa, il suffisso sparisce → `8.2.0`.
- Aggiornare `ARG CACHEBUST` nel `Dockerfile` con timestamp nuovo prima di **ogni** deploy. Senza bump, il layer Docker `COPY backend/` resta cached e il deploy serve la versione vecchia.
- Deploy **sempre** su entrambi i servizi Railway (LEGACY + BACKEND). Disallineamento = utenti su due URL vedono versioni diverse.
- **Niente `Co-Authored-By`** o riferimenti AI nei commit. Author = Francesco Biaggini, biaggini.francesco@gmail.com.
- Token e segreti **solo via `scripts/.env.local`** (gitignored). Mai inline nei prompt, nei commit, nei log shell. Se l'utente li paste in chat, segnalare.
- Mostrare diff prima di applicare patch non banali. Aspettare approvazione esplicita prima di Edit. Per fix triviali (typo, una riga isolata) si può procedere senza, ma flagga.
- Niente `git push --force` salvo amend di commit non ancora deployati. Preferire `--force-with-lease`.

## 4. Schema versioning
Formato: `MAJOR.MINOR.BUILD-FASE.STEP`
- `MAJOR.MINOR.BUILD` = era del prodotto (8.x = post-v3b unificato, allineato alla serie Analizzare)
- `-FASE.STEP` = sospeso del refactor in corso (es. `-A.5.1`). Sparisce alla promozione della fase intera.

Esempi: `8.1.7-A.5.1`, `8.2.0` (= Fase A promossa). Versioni live correnti: vedi `STATO_SISTEMA.md`.

Il bump si applica in 4 punti coerenti:
1. `backend/static/syntesis-analyzer-v3b.html` → `<title>` (~riga 9)
2. Stesso file → `window.ANALIZZA_BUILD` e `window.ANALIZZA_BUILD_DATE` (~riga 2251)
3. `backend/registry.py` → `BACKEND_VERSION`, `LAST_UPDATED`, voce nuova in History
4. `Dockerfile` → `ARG CACHEBUST` con timestamp `YYYYMMDDhhmmss`

## 5. Costanti cliniche IPD (immutabili senza autorizzazione)
- `MUA_CONE_HALF_ANGLE = 20°` (datasheet IPD Standard Europeo: 21°. Margine conservativo)
- `MAX_COUPLE_DIVERGENCE = 40°` (datasheet: 42°)
- `MAX_MILLING_ANGLE = 30°` (configurabile via Impostazioni → Fresatori, default 30° = VHF S5/Jiny F5T Pro/SK-5A)
- IPD MUA angolari disponibili: 17° e 30°
- **Solo fresatura 5 assi** supportata (4 assi non gestisce undercut MUA: il canale vite cilindrico richiede 2 DOF rotazionali)

Frontend legge da `window.SYN.thresholds.mua.{cone_half_deg, couple_div_deg, milling_deg}` (bootstrap A.5.1+). Backend canonico in `backend/registry.py` → `THRESHOLDS`.

## 6. CAD template scanbody
| Tipo | bbox xyz (mm) | cap area % | cap z (mm) | radius (mm) | searchR (mm) | flip X 180° | colore brand |
|---|---|---|---|---|---|---|---|
| 1T3 | 5.03×5.03×1.90 | 40% | +10 | 2.515 | 5.0 | no | `#FFAA44` (ambra) |
| OS  | 3.56×3.56×1.10 | 3%  | +6  | 1.78  | 3.0 | no | `#639922` (verde) |
| SR  | 4.06×4.06×3.00 | 6%  | +5 (post-flip) | 2.03 | 3.5 | sì (CAD nativo Z invertita) | `#0052A3` (blu) |

`searchR ≈ 1.7-2.0× radius` (rapporti reali: 1T3=1.99×, OS=1.69×, SR=1.72× — non uniforme). Validato clinicamente in v8.1.0 (16 MUA reali). Sorgente di verità: `backend/registry.py` → `SCANBODY` + `SEARCH_R_MM`. Frontend: `window.SYN.scanbody`.

## 7. Soglie cliniche (registry → window.SYN.thresholds)
**d3 (deviazione locale, micrometri)** — `window.SYN.thresholds.d3_um = [50, 100, 150, 250]`:
| Range | Classe | Colore |
|---|---|---|
| <50 | Ottimo | `#639922` |
| 50-100 | Accettabile | `#D97706` |
| 100-150 | Rischioso | `#F97316` |
| 150-250 | Tensione | `#EF4444` |
| >250 | Fuori posizione | `#A855F7` |

**Angolari (gradi)** — `window.SYN.thresholds.angular_deg = [0.5, 1.5, 3, 6]`. Stesse 5 classi (l'ultima si chiama "Fuori"), riusano la stessa palette per coerenza visiva.

`palette.d3_hex = ['#639922','#D97706','#F97316','#EF4444','#A855F7']`.

## 8. Token e infrastruttura
Tutto in `scripts/.env.local` (**gitignored**). NON includere mai i valori reali in CLAUDE.md, nel codice committato o in commit message.

Variabili attese:
```
GH_TOKEN=ghp_...
GH_REPO=ABC-CADCAM-Ordini/syntesis-icp
RW_TOKEN=...
RW_PROJECT_ID=204e60f5-2f71-4138-ac94-cf4f8a4dff5b
RW_ENV_ID=f944a213-371c-4377-9d4f-9c3eb2da3fb2
RW_SVC_LEGACY=7ac922ce-c3f2-4608-b333-3d35c3ca31c6
RW_SVC_BACKEND=b7671e12-545a-428e-9c2b-542916e8eff6
RW_GQL=https://backboard.railway.com/graphql/v2
DB_URL=postgresql://...@postgres.railway.internal:5432/syntesis
JWT_SECRET=...
ADMIN_USER=acadmin2025
```

Domini live:
- BACKEND principale: `syntesis-icp-production.up.railway.app` (alias `app.syntesis-icp.com`)
- LEGACY: `syntesis-icp-production-40e1.up.railway.app`

## 9. Procedure standard

### Patch chirurgica su v3b.html
1. `grep -n` per localizzare le sezioni interessate (mai Read integrale)
2. `sed -n 'N,Mp'` o `Read` con `offset/limit` su range stretti (≤50 righe per blocco)
3. Mostrare diff all'utente in formato `+/-` chiaro
4. Edit dopo approvazione esplicita
5. Validazione sintattica opzionale (saltare `node --check` su frammenti estratti — fragile per via di `<script>` mescolati)
6. `git add` specifico per file, **mai** `git add .` o `git add -A` (rischio di committare credenziali o file sporchi)

### Deploy
1. Bump versione coerente nei 4 punti (vedi §4)
2. `ARG CACHEBUST` con timestamp nuovo nel `Dockerfile`
3. `git commit` (corpo descrittivo, no `Co-Authored-By`), poi `git push origin main` (chiedere conferma se non ancora autorizzato)
4. `python scripts/deploy_railway.py` (lancia `serviceInstanceDeploy` su entrambi i servizi sul commit corrente)
5. Polling: query `deployments(first:1, input:{serviceId, environmentId})` su entrambi finché `status=SUCCESS` (timeout 5 min). Stop&ask se >3 min in `BUILDING`/`DEPLOYING`
6. `python scripts/verify_live.py` → curl `/analizzare` su entrambi i domini, grep `ANALIZZA_BUILD` per match della versione attesa; curl `/api/registry/constants` per `backend_version`
7. Aggiornare `STATO_SISTEMA.md` (versioni live + sospesi chiusi/aperti)

> NOTA: `scripts/` in costruzione (Sessione 0.2 della Fase 0). Fino al landing degli script Python, le mutation Railway si lanciano via `curl` diretto a `/graphql/v2` (vedi MASTER_DOC §A.6.1).

### Rollback
Non esiste uno SHA di rollback statico. La procedura corretta:
1. `git log --oneline -- backend/static/syntesis-analyzer-v3b.html`
2. Identificare il commit della versione validata da ripristinare (es. ultimo commit prima di una regressione)
3. `git revert <commit-sha> && git push` (preferito, history pulita)
   oppure
   `git reset --hard <commit-sha> && git push --force-with-lease` (solo se ultimo commit non deployato)
4. Ridelpoyare con procedura standard (Railway non torna automaticamente al commit precedente)

## 10. Documentazione di riferimento (in repo)
- `MASTER_DOC.md` — architettura completa, modello cliente, infra, pipeline
- `STATO_SISTEMA.md` — versioni live, sospesi aperti/chiusi (aggiornare dopo ogni fase chiusa)
- `docs/MERGE_ALBERO_REGISTRY_v1.md`, `docs/MODELLO_CASI_v1.md` — modelli interni
- `README.md` — entry point onboarding (deploy quickstart Railway)

## 11. Roadmap prodotto (alta vista)
- **Fase A (in corso)**: refactor centralizzazione costanti via `window.SYN`. Endpoint `/api/registry/constants`. Sub-step A.5.x in chiusura
- **Fase 0 stabilizzazione**: split di `v3b.html` in moduli separati, infra `scripts/` per deploy/verifica/rollback, suite pytest base sul motore ICP
- **Fase 1 SaaS**: multi-tenant via Clerk, pagamenti Stripe (TBD), email transazionale Resend, dashboard cliente (storico analisi, limiti, fatturazione)
- **Fase 2 lancio**: rete LifeDental Group, paper JIPD, espansione mercato laboratori odontotecnici e studi

## 12. Stile commit
- **Prima riga**: max 60 char, schema `FASE: cosa cambia` (es. `A.5.1 bootstrap window.SYN`)
- **Body**: bullet list di cosa fa, con dettaglio righe/file rilevanti per future bisect
- **No** `Co-Authored-By` trailer, **no** "Generated with Claude Code"
- **Author**: `Francesco Biaggini <biaggini.francesco@gmail.com>` (configurato globalmente in `git config --global`)
