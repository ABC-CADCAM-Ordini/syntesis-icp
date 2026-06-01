# Syntesis-ICP — Stato sistema

> Snapshot corrente. Aggiornare dopo ogni fase chiusa.

## Versione live (2026-06-01, export Sostituire con dialog nome file)

| Componente | Versione |
|---|---|
| Backend principale (b7671e12) | 8.4.7 (live, commit `76107ef` del 2026-06-01) |
| Legacy syntesis-icp (7ac922ce) | 8.4.7 (live, commit `76107ef` del 2026-06-01) |
| /analizzare | v8.4.7 — export STL Sostituire chiede il nome file (modale `#sostExportDialog`) prima del download; bottoni `.sostituire-only` solo in Sostituire; pannello "Tipo scanbody" (Box A) solo in Analizza/Accoppia; pulsante Reset nell'header; gate accesso attivo |
| /vedere (default home) | v8.0.0-refactor |
| Design system | introdotto in 8.3.0, attivo in prod dal 8.3.1, pilota su /vedere |

> 8.3.3 fix cutview opacità 100% **confermato risolto a freddo dopo verifica con cache pulita** (2026-05-08). Il fix slider (`material.transparent = true` forzato in /vedere) risolve davvero: ripristina il queue ordering corretto fra layer mesh, stencil meshes e cap plane. Le diagnosi 8.3.4 (angolo camera) e 8.3.5 (collisione cromatica) erano artefatti di test su browser cache stale che continuava a servire 8.3.1. Ticket archiviato in MASTER_DOC §B.8 (CHIUSO). Lezione di processo aggiunta a MASTER_DOC §A.6.2: cache busting esplicito (Cmd+Shift+R o `?v=$(date +%s)`) prima di ogni verifica visiva post-deploy. 8.3.4-5-6 sono doc patch (registry version trail), non deployati.

> **Incident 2026-05-20 → 2026-05-21**: backend+legacy giù per Postgres in sleep/freeze, ripristinati con sequenza postgres → backend → legacy via `serviceInstanceDeploy latestCommit:true` + warm-up 45s. Vedi sezione dedicata sotto.

> Voce `/replacer v7.3.9.107` rimossa il 2026-05-06: era stale, riferimento a un frontend obsoleto / mai integrato (la route `/replacer` non esiste in `main.py` e il file `syntesis-icp-replacer.html` non e' mai esistito in `backend/static/`).

> Cleanup 2026-05-08 (8.2.1): rimosso `backend/static/syntesis-statistiche-v7.4.0.001.html` (146KB, 1089 righe). Era dead code: zero referenze nel repo (CI, scripts, Dockerfile, href HTML, .py); sostituito da `v7.4.0.002` servito su `/statistiche`.

> DS introdotto pilota /vedere (8.3.0/8.3.1, 2026-05-08): `backend/static/ds/tokens.css` e `backend/static/ds/components.css` come fonte unica per token visuali e classi `.syn-*`. Pilota su Vedere migra `.header` (proprieta' di pattern bar) e bottone btnPick "Aggiungi file" (da outline a primary CTA). Replica su Dashboard e v3b a tappe nelle prossime sessioni.

## 8.4.7 — export Sostituire: dialog nome file (2026-06-01)

Il pulsante "Esporta STL" del workflow Sostituire (`#sostBtnExport` → `sostExportSTL`) ora chiede il **nome del file** con un modale in-app (`#sostExportDialog`, ricalca `#groupDialog`) **prima** del download — opzione A (niente API di sistema → funziona su tutti i browser). Prima il nome era costruito automaticamente e scaricato senza chiedere.

- `sostExportSTL` refattorizzato in 5 funzioni: valida + nome di default (base scan + componenti attivi) + apre il modale precompilato (focus+select); `confirmSostExport` sanifica (`.stl` strip, caratteri illegali → `_`, niente spazi/punti ai bordi, fallback al default se vuoto) e lancia l'export via `_sostDoExport` (pipeline build/serialize/download invariata, nome iniettato in `a.download`); Annulla non scarica. Invio=Conferma, Esc=Annulla; niente click-fuori (coerente con `#groupDialog`/`#settingsDialog`). Solo frontend.
- `docs/MAPPA_FUNZIONALE.md` aggiornata nello stesso commit (regola §4): riga `#sostBtnExport` + nuova riga Funzioni chiave (5 funzioni export) + 2 ref bumpati ai valori reali.

Deploy verificato live su entrambi i servizi (commit `76107ef`, sequenza LEGACY canary → BACKEND; build ~200-225s, più lenti del solito ma SUCCESS): `backend_version=8.4.7`, `/analizzare` HTTP 200 con `<title>` `v8.4.7`, **check markup**: `#sostExportDialog`, `#sostExportName`, `confirmSostExport`, `_sostDoExport` presenti nell'HTML servito; gating anonimo → 403. `app.syntesis-icp.com` escluso (cert SSL pre-esistente). Sospesi: nessuno aperto, nessuno chiuso.

## 8.4.6 — fix leak gemello .sostituire-only (2026-06-01)

Bugfix simmetrico al fix `#panelScanbodyType` 8.4.5. I 2 bottoni toolbar `.sostituire-only` (Livelli ~1345, Sezione/cutview ~1408 di `syntesis-analyzer-v3b.html`) avevano `display:none` inline (sicuri al load) ma, una volta mostrati nel ramo sostituire di `selectWorkflow`, nessuno li rinascondeva uscendo (il blocco di uscita nasconde solo `panelSostituire`; i rami analizza/accoppia/misurare settano `analisiBtns`/`misurareBtns` ma mai `sostituireBtns`) → restavano visibili negli altri workflow dopo una visita a Sostituire.

- Fix: gestione centralizzata a fine `selectWorkflow` (`querySelectorAll('.sostituire-only')` + `display` per `wf === 'sostituire'`) — nessun ramo può dimenticarli. Riga inline ridondante invariata. Solo frontend, nessun backend/API. Niente CACHEBUST.
- `docs/MAPPA_FUNZIONALE.md` aggiornata nello stesso commit (regola CLAUDE.md §4): leak gemello → corretto; corretti anche ~17 riferimenti di riga del cluster `sost*` che erano stale (numeri pre-8.4.5).

Deploy verificato live su entrambi i servizi (commit `284e2ed`, sequenza LEGACY canary → BACKEND): `backend_version=8.4.6`, `/analizzare` HTTP 200 con `<title>` `v8.4.6`, **check markup**: `querySelectorAll('.sostituire-only')` (×2: inline + centralizzato) e la riga `sostBtns … display per wf` presenti nell'HTML servito; gating anonimo `/api/me/analyses` → 403. `app.syntesis-icp.com` escluso (cert SSL pre-esistente). Sospesi: nessuno aperto, nessuno chiuso.

## 8.4.5 — fix leak visibilità Box A "Tipo scanbody" (2026-06-01)

Bugfix di leak di visibilità nel pannello destro di `syntesis-analyzer-v3b.html`. Il pannello `#panelScanbodyType` (Box A "Tipo scanbody", che imposta `window._ANALYZE_SBTYPE` per il posizionamento MUA in Analizza via `placeMUA`) non aveva `display:none` di default e non era mai referenziato da `selectWorkflow` → restava visibile in **tutti** i workflow. In Sostituire duplicava visivamente il Box B "SOSTITUIRE SCAN BODY" (`#sostSourceRadio` / `sostSourceTemplate`, tipo di marker presente nella scansione di partenza), generando l'ambiguità "due box per la stessa cosa"; in Misurare era ugualmente inerte.

- Fix additivo e centralizzato in `selectWorkflow` (~riga 4611, dopo le dichiarazioni dei pannelli): `#panelScanbodyType` visibile solo in `analizza`/`accoppia` — gli unici workflow dove `placeMUA` consuma `_ANALYZE_SBTYPE` (il bottone "+ Posiziona" è `.analisi-only`, mostrato in entrambi) — nascosto altrove. Posizionato dopo i `return` anticipati, così uno switch annullato non altera lo stato.
- Box B (`#sostSourceRadio` / `sostSourceTemplate`) e `placeMUA` non toccati. Solo frontend, nessun backend/API. Niente CACHEBUST.

Deploy verificato live su entrambi i servizi (commit `a9c11ce`, sequenza LEGACY canary → BACKEND): `backend_version=8.4.5`, `/analizzare` HTTP 200 con `<title>` `v8.4.5`, e **check markup nell'HTML servito**: `getElementById('panelScanbodyType')` e il ternary `panSbType ... (wf === 'analizza' || wf === 'accoppia')` presenti (1 occorrenza ciascuno). Gating anonimo `/api/me/analyses` → 403. `app.syntesis-icp.com` escluso (cert SSL pre-esistente, sospeso noto). Sospesi: nessuno aperto, nessuno chiuso.

## 8.4.4 — pulsante Reset nell'header (2026-06-01)

Nuovo pulsante **Reset** persistente nell'header di `syntesis-analyzer-v3b.html`, tra il blocco File e il blocco WorkFlow. Affordance UI additiva per ripartire con una nuova analisi da zero senza passare da File → Nuovo: `hardReset()` ricarica l'applicazione con un cache-bust querystring (`?_r=Date.now()`), chiedendo conferma solo se c'è stato corrente da perdere (`scanMesh` caricata o `muaObjects` posizionati). Solo frontend: nessun endpoint, API o logica backend toccata.

- Markup `.btn` + SVG freccia circolare (blu `#0065B3`) dopo la chiusura di `.file-menu-wrapper` (~riga 1262).
- Funzione `hardReset()` accanto a `newCase()` (~riga 4218).
- Bump 8.4.3 → 8.4.4 sui 3 marker (`<title>`, `window.ANALIZZA_BUILD`, `BACKEND_VERSION`/`LAST_UPDATED` + History). Niente CACHEBUST (superfluo con `serviceInstanceDeploy latestCommit:true`, CLAUDE.md §6).

Deploy verificato live su entrambi i servizi (commit `9ca5a68`, sequenza LEGACY canary → BACKEND): `/api/registry/constants` `backend_version=8.4.4`, `/analizzare` HTTP 200 con `<title>` `v8.4.4` + `ANALIZZA_BUILD = '8.4.4'`, pulsante Reset presente nell'HTML servito, gating anonimo `/api/me/analyses` → 403. `app.syntesis-icp.com` escluso dalla verifica (cert SSL pre-esistente, sospeso noto). Sospesi: nessuno aperto, nessuno chiuso.

## 8.4.3 — gate accesso /analizzare (2026-05-29)

Gate di accesso client-side su `/analizzare`, ora **chiuso ai non autorizzati** e verificato funzionante su entrambi i servizi. Nuovo `backend/static/ds/syn-gate.js` agganciato nel `<head>` di `syntesis-analyzer-v3b.html`: nasconde la pagina (`visibility:hidden` + backup CSS anti-flash), interroga `/auth/me` col token, redirige a `/accedi` per utente pending / anonimo / errore / rete giù, rivela il body solo per `authorized` o `admin`. Il deep link richiesto viene salvato in `sessionStorage.syn_after_login`.

- **8.4.2** (commit `ec068c5`): feature introdotta come canary sul solo LEGACY. `syn-gate.js` + aggancio in v3b (`<head>`: backup CSS anti-flash + `<script src="/static/ds/syn-gate.js">`).
- **8.4.3** (commit `618d23b`): fix `reveal()` — su /analizzare la pagina restava nera anche per authorized/admin perché `visibility = ""` (stringa vuota) non vinceva per specificity sul backup CSS `html{visibility:hidden}`. Corretto in `visibility = "visible"` (inline non vuoto = override). 1 riga in `syn-gate.js`. Promosso live su entrambi i servizi.

Il gating server-side `require_authorized` resta intatto: è la sicurezza vera, `syn-gate.js` è solo lo strato UX (niente flash di contenuto protetto, redirect pulito). `/vedere` e `/dashboard` NON sono ancora agganciati (vedi Sospesi). Versione live confermata da `registry.py` (`BACKEND_VERSION = 8.4.3`) e v3b (`window.ANALIZZA_BUILD = 8.4.3`); ID di deploy Railway non annotati in questa sessione.

## 8.4.1 — fix layout tabella pannello /gestione (2026-05-29)

Bugfix CSS chirurgico su `backend/static/syntesis-gestione.html` (pannello admin "Richieste di accesso"). La tabella andava in overflow orizzontale rispetto al `.wrap` da 1080px e `.tablecard{overflow:hidden}` clippava la colonna Licenza e il bottone Revoca a destra ("Revoc..." invece di "Revoca"). Tre modifiche puntuali:

- `.wrap` `max-width` 1080 → 1200px (+120px utili)
- padding orizzontale celle thead/tbody 18 → 12px (-108px su 9 colonne)
- `.tablecard` `overflow:hidden` → `overflow-x:auto` (safety net per dati lunghi/viewport stretti; `border-radius:14px` preservato sia con sia senza scrollbar)

Nessuna modifica a HTML, JS, struttura colonne, media-query mobile (`@media max-width:720px`). `/accedi` non toccato: usa layout card centered (`.card max-width:412px`), non condivide `.wrap` dashboard. Deploy combinato verificato su entrambi i servizi: BACKEND principale (`/api/registry/constants` HTTP 200 `backend_version=8.4.1`, `/gestione` HTTP 200) e LEGACY (idem su `syntesis-icp-production-40e1.up.railway.app`). Sospesi: nessuno in apertura, nessuno in chiusura — il pannello `/gestione` era nato in 8.4.0 (2026-05-28), il bug è emerso nell'uso reale del giorno dopo.

## 8.2.1 — UI alignment Vedere (2026-05-08)

Allineamento header `/vedere` al pattern canonico `.app-header` (Hub/Calibrator). Singolo cambio CSS sulla classe genitore `.header` di `syntesis-icp-vedere.html`:

- `border-bottom: 1px solid var(--border)` → `3px solid var(--blue)` (separazione identitaria forte)
- `padding: 10px 16px` → `14px 20px` (respiro verticale, in linea con Hub)
- `gap: 6px` → `12px` (logo / titolo / toolbar / bottoni distanziati)

Toolbar interna (logo, "Vedere", home/File/Workflow, Aggiungi file/Svuota scena) intatta: il delta tocca solo le proprietà del genitore. Verificato live su entrambi i servizi Railway (BACKEND + LEGACY): HTTP 200, `backend_version: 8.2.1`, `ANALIZZA_BUILD = '8.2.1'`.

Punto #2 del piano UI (allineamento font/header tra moduli) chiuso. Statistiche v002 era già su Source Sans 3, niente da migrare lato font. Resta sospeso il dominio custom `app.syntesis-icp.com` (#2 sospesi).

## Incident 2026-05-20 → 2026-05-21 — Postgres sleep, backend+legacy giù

**Timeline.** 2026-05-20 04:14 CEST: shutdown pulito di backend (b7671e12) e legacy (7ac922ce) — `Shutting down` → `Terminated` → `Application shutdown complete`, no traceback, no crash. 2026-05-21 ~13:50 CEST: utente segnala "Application failed to respond" sui due URL operativi. ~14:00-14:50 CEST: diagnosi + fix.

**Root cause.** Postgres Railway (d29be03b) in sleep/freeze: deployment SUCCESS dal 13-mag (id `469d293c`, 8 giorni di stabilità apparente) ma processo non in ascolto su `postgres.railway.internal:5432`. Al boot dei servizi applicativi `asyncpg.create_pool` andava in `TimeoutError`, FastAPI lifespan abortiva con `Application startup failed. Exiting.`. Sintomo derivato: i servizi sembravano "morti senza causa" perché Railway li marcava SUCCESS storicamente, mentre erano in realtà bloccati al lifespan.

**Diagnosi falsificata.** Prima ipotesi (basata su deployment logs Railway): il backend andava redeployato per ricreazione container, postgres era "Completed" e quindi sano. Verifica al 21-mag 12:32 CEST: `curl` ai due URL Railway dava 502 con `x-railway-fallback: true` (anche il legacy che secondo log era 200-OK il 18-mag). Primo redeploy backend (`99552fe5`, latestCommit:true) → FAILED in application startup con stack `asyncpg.create_pool ... TimeoutError`. La causa non era il container: era il DB irraggiungibile.

**Fix applicato.**

1. `serviceInstanceDeploy` su postgres con `latestCommit:true` → deploy `55806f24` SUCCESS al primo polling.
2. Warm-up 45s perché il processo Postgres salisse in ascolto effettivo.
3. `serviceInstanceDeploy` su backend con `latestCommit:true` → deploy `2beaa3ff` SUCCESS in 25s. Pool asyncpg inizializzata regolarmente.
4. Autorizzazione esplicita utente al redeploy legacy (servizio operativo che riceve traffico utente attivo, non servizio di fallback dormiente — chiarimento contro un'ipotesi operativa errata emersa in fase diagnostica).
5. `serviceInstanceDeploy` su legacy con `latestCommit:true` → deploy `62422769` SUCCESS in 75s (rebuild non da cache; codice eseguito invariato vs `b843be8` precedente — delta `b843be8 → 82b1ab3` = 3 commit doc-only + bump `registry.py`). Pool inizializzata al primo tentativo (postgres caldo da ~12 min).

**Verifica live post-fix:**

| Endpoint | HTTP | backend_version |
|---|---|---|
| `syntesis-icp-production.up.railway.app/` | 200 | 8.3.6 |
| `syntesis-icp-production-40e1.up.railway.app/vedere` | 200 | — |
| `syntesis-icp-production-40e1.up.railway.app/api/registry/constants` | 200 | 8.3.6 |

## Runbook — Postgres-first restart

**Quando applicare.** Servizio applicativo Railway in shutdown pulito apparentemente immotivato (no traceback, no crash, solo `Shutting down` → `Terminated` → `Application shutdown complete`). Sintomo aggiuntivo: nuovo deploy fallisce al lifespan FastAPI con `asyncpg.create_pool ... TimeoutError`.

**Diagnosi primaria.** Postgres in sleep/freeze, non problema del servizio applicativo. Su Railway, lo stato `SUCCESS` del deployment Postgres non implica processo in ascolto dopo periodi di inattività.

**Procedura.**

1. Verifica stato postgres con query `deployments(first:1, input:{serviceId:$RW_SVC_POSTGRES, ...})`. Status SUCCESS non basta.
2. `serviceInstanceDeploy(serviceId:$RW_SVC_POSTGRES, environmentId:$RW_ENV_ID, latestCommit:true)`. Poll fino a SUCCESS.
3. **Warm-up 45-60s** perché il processo Postgres salga in ascolto effettivo (l'istante SUCCESS marca il deploy job completato, non la disponibilità TCP).
4. Solo dopo: `serviceInstanceDeploy` sul servizio applicativo con `latestCommit:true`. Poll fino a SUCCESS.
5. Verifica con `curl -sL` sull'endpoint canonico (atteso HTTP 200) + `curl /api/registry/constants` per `backend_version` coerente.

**Anti-pattern.** Saltare lo step 3 produce `asyncpg.TimeoutError` allo startup applicativo e ricicla il problema. Estensione della lezione operativa 8.3.1 (verifica versione live prima di asserirla): «verifica stato Postgres prima di redeployare un servizio applicativo crashato al lifespan».

## Fase A — Chiusa (2026-05-06)

Refactor "centralizzazione costanti del dominio via `backend/registry.py` + bootstrap `window.SYN` nei frontend". Single source of truth per scanbody (1T3, OS, SR), soglie cliniche (d3 in um, angular in deg, MUA cone, fresabilita'), palette colori (classi cliniche, brand).

Step chiusi:
- **A.1, A.2** (2026-05-02): introduzione `backend/registry.py` + endpoint `/api/registry/constants`
- **A.3** (2026-05-02): `icp_engine.py` legge `max_tris` dal registry
- **A.4** (2026-05-02): `pdf_gen.py` legge palette brand dal registry
- **A.4.1** (2026-05-02): `BACKEND_VERSION` esplicito nel registry
- **A.5.0** (2026-05-02): aggiunte soglie angolari (`angular_deg`, `angular_classes_it`)
- **A.5.1** (2026-05-03): bootstrap `window.SYN` nel frontend `v3b.html` (`SCANBODY_CFG`, `MUA_*`, `MIS_CLIN`, `MIS_CLIN_AX`)
- **A.5.2** (2026-05-06): `SOSTITUIRE_TEMPLATE_INFO` + `TPL_ORDER` allineati a `window.SYN`; SR a `0x0052A3` ovunque
- **A.5.x post-batch** (2026-05-06): chiusura debito su `icp_engine.CLIN_LEVELS`/`CLIN_AXIS` (audit C15) — derivati da `registry.THRESHOLDS`+`PALETTE`, vocabolario `angular_classes_it` allineato a `d3_classes_it` (`"Fuori posizione"`).

`A.6` originariamente pianificata (estensione pattern a `index.html` Hub e `syntesis-icp-replacer.html`) verificata e cancellata: `index.html` e' un Hub navigazionale puro senza costanti dominio, e `syntesis-icp-replacer.html` non esiste. L'unico file che effettivamente conteneva costanti CAD/cliniche era `syntesis-analyzer-v3b.html`, gia' migrato in A.5.x.

Promozione `8.1.13-A.5.2 → 8.2.0`: suffisso `-A.x.y` sparisce, MINOR bump come da schema versioning.

## Sospesi

**Gate accesso — completamento rollout** (aperti in 8.4.3)
- Agganciare il gate `syn-gate.js` anche a `/vedere` e `/dashboard` (oggi protegge solo `/analizzare`).
- Rimuovere l'endpoint `/api/analyze-public`: finché esiste è un bypass del gate (analisi senza utente autorizzato).
- Gestire il deep link in `/accedi`: consumare `sessionStorage.syn_after_login` dopo il login e tornare alla pagina richiesta (oggi `syn-gate.js` lo salva ma `/accedi` non lo rilegge).

**Alta priorità**
1. Fase 0 stabilizzazione: split v3b.html, scripts/, pytest base
2. app.syntesis-icp.com HTTP 404 + cert SSL mismatch (verificato 2026-05-21 post-incident: edge Railway risponde 404 sulla "/", cert servito è `*.up.railway.app` invece di copertura `syntesis-icp.com`). Fix: rigenerare custom domain in Railway Settings → Networking del backend. Workaround attuale: URL Railway diretto.
3. Audit 2026-05-06 finding open: C1 (JWT in query), C4 (Google access-token client) — diventano critici al lancio Fase 1 SaaS (sharing folder cross-utente, free-tier registration)

**Media**
4. Merge Albero Scena + Scene Registry in /analizzare (lista lineare con RMSD/gruppo/opacità)
5. Test pytest sul motore ICP (set base: 16 MUA reali validati clinicamente in v8.1.0)

> Sospeso #6 "Cleanup syntesis-analyzer-lab.html" chiuso il 2026-05-08 in 8.2.5 con cancellazione del file e della route /lab.

> Sospeso "Cutview /vedere collisione cromatica" aperto e chiuso nello stesso giorno (2026-05-08, 8.3.6): era falso allarme. La diagnosi cromatica 8.3.5 e l'angle-camera 8.3.4 erano entrambe artefatti di test su browser cache stale. Verifica utente a freddo con hard refresh ha confermato che il fix 8.3.3 (forzare `material.transparent = true` nello slider opacità) risolve davvero il bug. Vedi MASTER_DOC §B.8 (CHIUSO) e §A.6.2 (regola hard refresh post-deploy).

**Bassa**
6. Spegnimento servizio Railway legacy (7ac922ce)
7. Sentry / monitoring errori frontend
8. Pubblicazione paper JIPD con dati Syntesis-ICP
9. Audit 2026-05-06 cluster MEDI/BASSI: ~25 finding di code health, performance icp_engine, listener/dispose leak in v3b.html
10. Servizio Railway `frontend` (8fa17f74): "Build failed last month" rilevato in diagnosi 2026-05-21, non toccato. Riattivare o cancellare quando ne viene chiarito il ruolo.

> **Nota su sospeso #6** (spegnimento legacy): al 2026-05-21 il legacy è il servizio operativo che riceve traffico utente (URL `...-40e1`). Lo spegnimento è bloccato finché non si completa la migrazione a backend principale. Vedi Incident 2026-05-20 → 2026-05-21.

## Roadmap prodotto

- **Fase 0 stabilizzazione** (corso): split v3b.html, infra scripts/, test base
- **Fase 1 SaaS** (Q3 2026): multi-tenant Clerk, pagamenti (TBD), email Resend, dashboard cliente
- **Fase 2 lancio** (Q4 2026): rete LifeDental, paper JIPD, espansione laboratori e studi

## Hardening proposto (non eseguito)

Ipotesi di riduzione blast-radius per ripetizione dell'incident 2026-05-21. Da valutare in sessione dedicata, fuori scope ripristino:

1. **Retry con backoff in [backend/database.py](backend/database.py)**. Su `asyncpg.create_pool` fallito, retry 5 tentativi con backoff esponenziale base 2s (2, 4, 8, 16, 32 = 62s totali). Previene crash al boot quando Postgres è lento a salire in ascolto post-redeploy. Aderisce al pattern «warm-up tollerato» senza richiedere intervento operatore.
2. **Keep-alive Postgres**. Cron Railway o GitHub Actions schedulato ogni 5-10 min: query `SELECT 1` (o ping su `/api/registry/constants` che già usa la pool). Previene sleep alla radice se la causa è inactivity policy del piano.
3. **Verifica piano Railway**. Se l'environment è su piano con sleep-on-inactivity attivo, root cause confermata e il keep-alive (punto 2) è il fix corretto. Se piano paid senza sleep, indagare ulteriormente: kernel-level pause, OOM silenzioso, healthcheck failure non loggato.

## TODO Francesco

- **Ruotare credenziali post-incident 2026-05-21** (operazione manuale dalla UI Railway, non delegata a Claude):
  - `RW_TOKEN` in [scripts/.env.local](scripts/.env.local) → UI Railway account settings → revoca corrente + crea nuovo + aggiorna `.env.local`.
  - Password Postgres dalla UI servizio postgres → `DATABASE_URL` si rigenera e si propaga al backend via reference. **Pianificare in finestra a basso traffico**: la rotazione triggera redeploy automatico del backend (~30-60s downtime).

## Documentazione storica

- [docs/STORIA.md](docs/STORIA.md) — cronologia commit per commit
- [docs/AUDIT_2026-05-06.md](docs/AUDIT_2026-05-06.md) — audit codebase pre-promozione

---
*Snapshot 2026-06-01 — export Sostituire con dialog nome file live su entrambi i servizi (8.4.7). Aggiornare al prossimo cambio di stato.*
