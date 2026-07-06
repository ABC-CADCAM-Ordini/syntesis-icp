# CLAUDE.md — Syntesis-ICP

Regole permanenti di progetto. Leggile prima di toccare codice. Valgono a ogni
sessione, non vanno reinserite a mano.

## 1. Cos'è Syntesis-ICP

SaaS B2B per analisi di precisione di scansioni intraorali dentali. Confronta due
STL via ICP, individua scanbody (cilindri di riferimento), calcola deviazioni
centroide-per-centroide (ΔXY, ΔZ, ΔD3D), gestisce posizionamento MUA con cono di
accoppiamento e fresabilità 5-assi, genera report PDF clinici. Target: laboratori
odontotecnici e studi dentistici italiani.
URL live (canonico, brand "Synthesis" CON h): https://app.synthesis-icp.com. Il
vecchio host SENZA h https://app.syntesis-icp.com resta attivo ma fa **308 redirect
permanente** al canonico (middleware `redirect_legacy_host` in `main.py`, dal 8.87.0).
Alias tecnico Railway: https://syntesis-icp-production.up.railway.app/.

Architettura reale, da rispettare per com'è, non per come "dovrebbe" essere:
- Backend FastAPI su Railway.
- Il frontend è servito come file HTML statici di grandi dimensioni, NON come app
  a componenti con build step. Il file principale di analisi
  (`backend/static/syntesis-analyzer-v3b.html`) è un monolite da ~3.87 MB,
  ~19.200 righe. La logica CAD/ICP (confronto STL, allineamento Kabsch+SVD,
  deviazioni assiali, report) gira nel browser, dentro questi file.
- Autenticazione a stati: utenti `pending` (autenticati ma non autorizzati),
  `authorized`, `admin`.

## 2. Stack
- **Backend**: FastAPI + Uvicorn + asyncpg + NumPy/SciPy/scikit-learn (Python 3.12)
- **Frontend**: vanilla JS, single-page, no framework. File principale
  `backend/static/syntesis-analyzer-v3b.html` (~3.87 MB, ~19.200 righe)
- **DB**: PostgreSQL su Railway (interno, non esposto)
- **Deploy**: Railway su 2 servizi paralleli (LEGACY + BACKEND principale) per
  l'environment unico
- **Custom domain (canonico)**: `app.synthesis-icp.com` (CON h) → CNAME verso il
  dominio Railway BACKEND. Il legacy `app.syntesis-icp.com` (SENZA h) resta attaccato
  al BACKEND e fa 308 redirect al canonico (vedi §10)

## 3. Divieti assoluti (la cosa più importante di questo file)

Non prendere iniziativa su questi punti. Se pensi che servano, FERMATI e chiedi.

1. NON spezzare i file HTML monolitici in moduli, NON introdurre un build step
   (bundler, transpiler, framework), NON aggiungere dipendenze npm al frontend.
   Il monolite è una scelta, non un debito da saldare.
2. NON fare refactor architetturali non richiesti. Niente nuovi servizi, nuove
   astrazioni o riorganizzazioni di cartelle "per pulizia".
3. NON creare un nuovo servizio se uno esistente copre già la responsabilità.
4. NON rimuovere dead code o fare pulizie cosmetiche durante un task funzionale o
   a ridosso di un deploy. Annotalo, fallo in un passo dedicato.
5. NON hardcodare segreti, token, API key, nomi di bucket, credenziali. Token e
   segreti solo via `scripts/.env.local` (gitignored). Se l'utente li incolla in
   chat, segnalare.
6. NON modificare `.env`, file di chiavi, migrazioni di database senza conferma
   esplicita.
7. Prima di aggiungere una dipendenza, spiega perché codice nativo o una
   dipendenza esistente non basta.
8. MAI Read integrale né view sull'intero `syntesis-analyzer-v3b.html` (3.87 MB):
   sempre `grep -n` per localizzare, poi `sed -n 'N,Mp'` / `Read` con
   `offset`/`limit` su range stretti (≤50 righe per blocco).
9. NIENTE `Co-Authored-By` o riferimenti AI nei commit. Author = Francesco
   Biaggini <biaggini.francesco@gmail.com> (configurato in `git config --global`).
10. `git add` specifico per file, MAI `git add .` / `git add -A` (rischio di
    committare credenziali o file sporchi). Niente `git push --force` salvo amend
    di commit NON ancora deployati; preferire `--force-with-lease`.
11. NON committare una modifica che tocca un elemento UI senza aggiornare
    `docs/MAPPA_FUNZIONALE.md` nello stesso commit (vedi §4).

## 4. Pattern tecnici obbligatori

### GitHub (aggiornamento file via API)
- Aggiornare un file richiede prima una GET per ottenere lo SHA, poi la PUT.
- File oltre 1 MB: usare la Git Blobs API, non l'endpoint contents standard.

### Railway (deploy)
- Per modifiche al codice usare SEMPRE `serviceInstanceDeploy` con
  `latestCommit: true`. MAI `serviceInstanceRedeploy` per cambi di codice
  (redeploy rilancia lo stesso commit, non prende il nuovo).
- Le chiamate alla GraphQL API di Railway richiedono header
  `User-Agent: Mozilla/5.0`, altrimenti falliscono.
- Verifica gli ID dei servizi su Railway PRIMA di ogni deploy. Non fidarti di ID
  presi dalla memoria, da un handoff o da una sessione precedente: leggi i servizi
  del progetto e identifica quelli pertinenti dal dominio servito.
- Le mutation si lanciano via `curl` diretto a `/graphql/v2` (gli script
  `scripts/deploy_railway.py` / `verify_live.py` citati storicamente NON esistono
  ancora; usare GraphQL diretto — vedi MASTER_DOC §A.6.1).

### Deploy multi-servizio
- Il backend è servito da più di un servizio Railway (almeno principale e legacy).
  Una release va deployata su TUTTI i servizi che servono il backend. Disallineamento
  = utenti su due URL vedono versioni diverse.
- Determina quali servizi sono pertinenti verificandolo su Railway a ogni deploy,
  NON assumendo un numero fisso.
- Sequenza: deploy del primo servizio, verifica completa (vedi sotto), e SOLO se
  sano si procede al successivo. Se la verifica fallisce, fermarsi e riferire,
  senza toccare gli altri servizi.

### Verifica post-deploy
- `SUCCESS` su Railway NON garantisce che il processo stia ascoltando. Verificare
  sempre con una chiamata HTTP reale.
- Usare `curl -sL`: il flag `-L` (segui redirect) è obbligatorio.
- Controllare: numero di versione atteso (`/api/registry/constants` →
  `backend_version`), route attese che rispondono 200, e il comportamento di
  gating atteso (es. un utente pending riceve 403 su un endpoint protetto).
- Dopo la verifica, aggiornare `STATO_SISTEMA.md` (versioni live + sospesi).

### Mappa funzionale (sincronizzazione obbligatoria)
- `docs/MAPPA_FUNZIONALE.md` mappa viste/route, elementi UI, handler, funzioni
  collegate e classi di visibilità, verificata per riga. Al rilascio (commit che
  va in deploy), codice e mappa DEVONO essere allineati: la modifica UI e
  l'aggiornamento della mappa stanno nello stesso commit.
- Qualsiasi modifica che aggiunge, rimuove o altera un elemento UI (pulsante, voce
  di menu, pannello, handler, funzione legata a UI, classe di visibilità) DEVE
  aggiornare la/le riga/e corrispondenti di `docs/MAPPA_FUNZIONALE.md` nello STESSO
  commit del codice. È parte della checklist di rilascio (§11), come il bump di
  versione — non un passo separato.
- Mantieni la mappa verificata per riga: se i numeri di riga citati shiftano per
  effetto dell'edit, aggiorna i riferimenti. Localizza con `grep -n`, non a memoria.
- A ogni rilascio che cambia versione, aggiorna anche la "Versione software
  mappata" in testa al documento.
- Le voci marcate **DA CHIARIRE** vanno risolte quando si tocca la parte di codice
  relativa (es. tracciare gli handler della toolbar Vedere quando si lavora su
  `syntesis-icp-vedere.html`).
- **Mappa strutturale (UNICA mappa, decisione 2026-07-05)**: la MAPPA_FUNZIONALE
  contiene anche la sezione "Mappa strutturale del monolite" (composizione, domini,
  superficie di accoppiamento), GENERATA — mai editata a mano — da
  `python3 scripts/dep_census.py --write-mappa` (marker DEP-CENSUS). Va rigenerata:
  (a) a ogni bump MINOR; (b) SEMPRE prima di qualsiasi passo di estrazione dal
  monolite. `docs/MODULARIZZAZIONE_STUDIO.md` resta la strategia (meccanismi,
  ordine, rischi) e NON contiene numeri: i numeri vivono solo nella MAPPA.

## 5. Autorizzazione (modello a stati)
- Endpoint operativi / di prodotto (analisi, ICP, report, leaderboard, scrittura
  ruolo): protetti, richiedono utente autorizzato.
- Gestione account e lettura del proprio stato (profilo GET/PATCH, cambio
  password, lettura del proprio ruolo): accessibili anche ai pending. Un pending
  deve poter gestire il proprio account e la UI deve poter leggere il suo stato
  senza 403.
- Il gating sta SEMPRE lato server. I controlli lato client non sono sicurezza.

## 6. Versioning
- A ogni feature, bumpare la versione del backend in `backend/registry.py`
  (`BACKEND_VERSION`, `LAST_UPDATED`, voce nuova in `# History:`).
- Semver: nuove funzionalità retrocompatibili = MINOR; bugfix = PATCH. Schema
  storico `MAJOR.MINOR.BUILD-FASE.STEP` (es. `8.1.7-A.5.1`): il suffisso `-FASE.STEP`
  spariva alla promozione della fase (Fase A promossa in `8.2.0`). Dalla Fase A in
  poi si usa semver puro (es. `8.4.0`).
- Il numero di versione è il discriminatore post-deploy più affidabile: dopo il
  deploy deve permettere di confermare in un colpo che ogni servizio ha preso il
  commit giusto.
- Se la modifica tocca il monolite frontend `syntesis-analyzer-v3b.html`, bumpare
  anche `<title>` (~riga 9) e `window.ANALIZZA_BUILD` / `window.ANALIZZA_BUILD_DATE`
  (~riga 2251), che vivono dentro il file.
- `ARG CACHEBUST` nel `Dockerfile`: storicamente bumpato a ogni deploy per evitare
  che il layer `COPY backend/` restasse cached; oggi superfluo con
  `serviceInstanceDeploy latestCommit:true` + `skipBuildCache:true`. Reintrodurre
  solo se si cambia metodo di deploy.

## 7. Costanti cliniche IPD (immutabili senza autorizzazione)
- `MUA_CONE_HALF_ANGLE = 20°` (datasheet IPD Standard Europeo: 21°. Margine conservativo)
- `MAX_COUPLE_DIVERGENCE = 40°` (datasheet: 42°)
- `MAX_MILLING_ANGLE = 30°` (configurabile via Impostazioni → Fresatori, default 30° = VHF S5/Jiny F5T Pro/SK-5A)
- IPD MUA angolari disponibili: 17° e 30°
- **Solo fresatura 5 assi** supportata (4 assi non gestisce undercut MUA: il canale vite cilindrico richiede 2 DOF rotazionali)

Frontend legge da `window.SYN.thresholds.mua.{cone_half_deg, couple_div_deg, milling_deg}`
(bootstrap A.5.1+). Backend canonico in `backend/registry.py` → `THRESHOLDS`.

## 8. CAD template scanbody
| Tipo | bbox xyz (mm) | cap area % | cap z (mm) | radius (mm) | searchR (mm) | flip X 180° | colore brand |
|---|---|---|---|---|---|---|---|
| 1T3 | 5.03×5.03×1.90 | 40% | +10 | 2.515 | 5.0 | no | `#FFAA44` (ambra) |
| OS  | 3.56×3.56×1.10 | 3%  | +6  | 1.78  | 3.0 | no | `#639922` (verde) |
| SR  | 4.06×4.06×3.00 | 6%  | +5 (post-flip) | 2.03 | 3.5 | sì (CAD nativo Z invertita) | `#0052A3` (blu) |

`searchR ≈ 1.7-2.0× radius` (rapporti reali: 1T3=1.99×, OS=1.69×, SR=1.72× — non
uniforme). Validato clinicamente in v8.1.0 (16 MUA reali). Sorgente di verità:
`backend/registry.py` → `SCANBODY` + `SEARCH_R_MM`. Frontend: `window.SYN.scanbody`.

## 9. Soglie cliniche (registry → window.SYN.thresholds)
**d3 (deviazione locale, micrometri)** — `window.SYN.thresholds.d3_um = [50, 100, 150, 250]`:
| Range | Classe | Colore |
|---|---|---|
| <50 | Ottimo | `#639922` |
| 50-100 | Accettabile | `#D97706` |
| 100-150 | Rischioso | `#F97316` |
| 150-250 | Tensione | `#EF4444` |
| >250 | Fuori posizione | `#A855F7` |

**Angolari (gradi)** — `window.SYN.thresholds.angular_deg = [0.5, 1.5, 3, 6]`. Stesse
5 classi (l'ultima si chiama "Fuori"), riusano la stessa palette per coerenza visiva.

`palette.d3_hex = ['#639922','#D97706','#F97316','#EF4444','#A855F7']`.

## 10. Token e infrastruttura
Tutto in `scripts/.env.local` (**gitignored**). NON includere mai i valori reali
in CLAUDE.md, nel codice committato o in commit message.

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
- Canonico brand (CON h): `app.synthesis-icp.com` → servito dal BACKEND, cert Let's Encrypt valido
- Legacy SENZA h: `app.syntesis-icp.com` → **308 redirect permanente** al canonico
  (middleware `redirect_legacy_host` in `main.py`, 8.87.0). Tenere ATTACCATO al BACKEND
  per intercettare i vecchi link — NON staccare, o i bookmark falliscono invece di redirigere.
- BACKEND principale (Railway): `syntesis-icp-production.up.railway.app`
- LEGACY (Railway): `syntesis-icp-production-40e1.up.railway.app`
- Apex nudo `synthesis-icp.com` / `www`: ancora parcheggiato su register.it (redirect
  apex+www → canonico = azione manuale pendente; il redirect 308 copre solo il sottodominio `app.`)

## 11. Procedure standard

### Patch chirurgica su v3b.html (e file grandi/fragili)
1. `grep -n` per localizzare le sezioni; usa anchor multi-riga univoci, non match
   ambigui. Mai Read integrale.
2. `sed -n 'N,Mp'` o `Read` con `offset/limit` su range stretti (≤50 righe per blocco).
3. Mostrare diff all'utente in formato `+/-` chiaro.
4. Edit dopo approvazione esplicita. Mantieni l'edit chirurgico e circoscritto:
   niente modifiche collaterali.
5. Validare la sintassi JS estraendo i blocchi `<script>` e passandoli a
   `node --check`. Nota: i numeri di riga del JS estratto non corrispondono a
   quelli del file HTML originale.
6. `git add` specifico per file (mai `git add .` / `-A`).
7. Se la patch tocca un elemento UI, aggiorna la/le riga/e corrispondenti di
   `docs/MAPPA_FUNZIONALE.md` e committale insieme al codice (vedi §4).

### Deploy
1. Bump versione in `registry.py` (+ punti frontend se tocchi v3b — vedi §6). Se
   la modifica tocca elementi UI, aggiorna `docs/MAPPA_FUNZIONALE.md` nello stesso
   commit (righe corrispondenti + "Versione software mappata") — vedi §4.
2. `git commit` (corpo descrittivo, NO `Co-Authored-By`), poi `git push origin main`
   (chiedere conferma se non già autorizzato).
3. Verifica ID servizi su Railway. Deploy via `serviceInstanceDeploy
   latestCommit:true` su TUTTI i servizi (header `User-Agent: Mozilla/5.0`).
4. Polling deployment finché `status=SUCCESS` (timeout ~5 min; stop&ask se >3 min
   in BUILDING/DEPLOYING).
5. Verifica live per OGNI servizio: `curl -sL` su `/api/registry/constants` per la
   versione attesa, route attese a 200, gating (pending → 403).
6. Aggiornare `STATO_SISTEMA.md`.

### Rollback
Non esiste uno SHA di rollback statico:
1. `git log --oneline -- backend/static/syntesis-analyzer-v3b.html`
2. Identificare il commit della versione validata.
3. `git revert <sha> && git push` (preferito), oppure
   `git reset --hard <sha> && git push --force-with-lease` (solo se ultimo commit
   non deployato).
4. Ridepployare con la procedura standard (Railway non torna automaticamente al
   commit precedente).

## 12. Documentazione di riferimento (in repo)
- `MASTER_DOC.md` — architettura completa, modello cliente, infra, pipeline
- `STATO_SISTEMA.md` — versioni live, sospesi aperti/chiusi (aggiornare dopo ogni fase chiusa)
- `STATO_AUTH.md` — stato del flusso di autenticazione (registrazione → autorizzazione)
- `docs/MERGE_ALBERO_REGISTRY_v1.md`, `docs/MODELLO_CASI_v1.md` — modelli interni
- `README.md` — entry point onboarding (deploy quickstart Railway)
- `docs/MAPPA_FUNZIONALE.md` — mappa funzionale UI (route/viste/elementi/handler/
  classi di visibilità), verificata per riga; sincronizzazione obbligatoria col
  codice (vedi §4)

## 13. Roadmap prodotto (alta vista)
- **Fase A (in corso)**: refactor centralizzazione costanti via `window.SYN`.
  Endpoint `/api/registry/constants`. Sub-step A.5.x in chiusura.
- **Fase 0 stabilizzazione**: infra `scripts/` per deploy/verifica/rollback, suite
  pytest base sul motore ICP.
- **Fase 1 SaaS**: multi-tenant, pagamenti (TBD), email transazionale, dashboard
  cliente (storico analisi, limiti, fatturazione).
- **Fase 2 lancio**: rete LifeDental Group, paper JIPD, espansione mercato.

## 14. Stile di lavoro atteso
- Prima di applicare modifiche che toccano la produzione o fanno partire un deploy,
  mostra il diff e chiedi conferma esplicita. Per fix triviali (typo, una riga
  isolata) si può procedere, ma flagga.
- Non dichiarare un task "fatto" finché non hai verificato (compilazione, check di
  sintassi, verifica live dove pertinente). Vedi la checklist `qa-release-check`.

## 15. Stile commit
- **Prima riga**: max 60 char, schema `FASE: cosa cambia` (es. `A.5.1 bootstrap window.SYN`).
- **Body**: bullet list di cosa fa, con dettaglio righe/file rilevanti per future bisect.
- **NO** `Co-Authored-By` trailer, **no** "Generated with Claude Code".
- **Author**: `Francesco Biaggini <biaggini.francesco@gmail.com>`.
