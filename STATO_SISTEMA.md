# Syntesis-ICP — Stato sistema

> Snapshot corrente. Aggiornare dopo ogni fase chiusa.

## Versione live (2026-06-02, 8.6.8 — rendering viewport /analizzare revertito a 8.6.4)

| Componente | Versione |
|---|---|
| Backend principale (b7671e12) | 8.6.8 (live, commit `8c39afa` del 2026-06-02) |
| Legacy syntesis-icp (7ac922ce) | 8.6.8 (live, commit `8c39afa` del 2026-06-02) |
| / (home pubblica, 8.6.4) | `synthesis-home.html` — splash **dark** (`--dark #0F1923`): cornice perimetrale animata **cava** (`.synt-frame` via `mask`, fixed, `pointer-events:none`), logo bianco (invert), hero (headline + immagine crop in card chiara) + 4 tool-card. **Layout 16:9 "una schermata"** (8.6.2): `.viewport` inset:22px dentro la cornice + misure `vh`/`clamp` → tutto in `100vh` senza scroll; su desktop bassi compressione mirata (8.6.3, `@media max-height:900` + `overflow:hidden`); mobile verticale con scroll dentro la cornice. Sostituisce il redirect 302 a /vedere (fallback) |
| /analizzare | v8.6.8 — **rendering viewport = stato 8.6.4** (tentativo fix Solid-transparency 8.6.5-8.6.7 revertito in 8.6.8; vedi Sospesi → Bug rendering viewport); reader `?wf=`; export STL Sostituire con dialog nome file; `.sostituire-only` solo in Sostituire; "Tipo scanbody" (Box A) solo in Analizza/Accoppia; gate accesso attivo |
| /accedi | ritorno al deep-link dopo login (consuma `sessionStorage.syn_after_login`; fallback /vedere) — 8.5.0 |
| /vedere | v8.0.0-refactor — fix primo-click `#btnPick` (8.4.8). Non più target del redirect `/` (ora home), resta servito e fallback |
| Design system | introdotto in 8.3.0, attivo in prod dal 8.3.1, pilota su /vedere |

> 8.3.3 fix cutview opacità 100% **confermato risolto a freddo dopo verifica con cache pulita** (2026-05-08). Il fix slider (`material.transparent = true` forzato in /vedere) risolve davvero: ripristina il queue ordering corretto fra layer mesh, stencil meshes e cap plane. Le diagnosi 8.3.4 (angolo camera) e 8.3.5 (collisione cromatica) erano artefatti di test su browser cache stale che continuava a servire 8.3.1. Ticket archiviato in MASTER_DOC §B.8 (CHIUSO). Lezione di processo aggiunta a MASTER_DOC §A.6.2: cache busting esplicito (Cmd+Shift+R o `?v=$(date +%s)`) prima di ogni verifica visiva post-deploy. 8.3.4-5-6 sono doc patch (registry version trail), non deployati.

> **Incident 2026-05-20 → 2026-05-21**: backend+legacy giù per Postgres in sleep/freeze, ripristinati con sequenza postgres → backend → legacy via `serviceInstanceDeploy latestCommit:true` + warm-up 45s. Vedi sezione dedicata sotto.

> Voce `/replacer v7.3.9.107` rimossa il 2026-05-06: era stale, riferimento a un frontend obsoleto / mai integrato (la route `/replacer` non esiste in `main.py` e il file `syntesis-icp-replacer.html` non e' mai esistito in `backend/static/`).

> Cleanup 2026-05-08 (8.2.1): rimosso `backend/static/syntesis-statistiche-v7.4.0.001.html` (146KB, 1089 righe). Era dead code: zero referenze nel repo (CI, scripts, Dockerfile, href HTML, .py); sostituito da `v7.4.0.002` servito su `/statistiche`.

> DS introdotto pilota /vedere (8.3.0/8.3.1, 2026-05-08): `backend/static/ds/tokens.css` e `backend/static/ds/components.css` come fonte unica per token visuali e classi `.syn-*`. Pilota su Vedere migra `.header` (proprieta' di pattern bar) e bottone btnPick "Aggiungi file" (da outline a primary CTA). Replica su Dashboard e v3b a tappe nelle prossime sessioni.

## 8.6.8 — revert stack rendering viewport /analizzare (2026-06-02)

Rollback completo dello stack rendering del viewport principale di `/analizzare` allo stato **8.6.4**. I tre fix tentati (8.6.5 culling MUA `FrontSide`, 8.6.6 `depthWrite` accoppiato all'opacità, 8.6.7 `scanMesh.renderOrder=1`) risolvevano ognuno un pezzo scoprendone un altro; il cumulato in Solid era **meno leggibile** dell'originale, quindi ritorno alla base conosciuta. Metodo: `git revert` dei 3 commit (`ab4b2c4`, `b8a54f2`, `99ef34e`) in ordine inverso (no reset/force, storia preservata). Codice viewport **byte-identico a 8.6.4** (verificato: diff netto 0 vs `99ef34e^`; MUA di nuovo `side:THREE.DoubleSide`, `depthWrite` coupling rimosso dai 3 punti, `scanMesh.renderOrder` rimosso; camera/renderer mai toccati). Solo i marker di versione cambiano (8.6.4 → 8.6.8, monotono). Problema rendering ancora **aperto come design**: vedi Sospesi → "Bug rendering viewport /analizzare". Il Fix A (culling MUA) era di per sé corretto e potrà essere ririprovato a parte.

Deploy verificato live su entrambi (commit `8c39afa`, sequenza LEGACY canary → BACKEND): `backend_version=8.6.8`, `/analizzare` 200, gating `/api/me/storage` → 403, HTML servito = stato 8.6.4 (MUA `side:THREE.DoubleSide` ×3, FrontSide×0 sui MUA, depthWrite coupling 0, `scanMesh.renderOrder` 0). `app.syntesis-icp.com` (no-h) → 200. Sospesi: aperto "Bug rendering viewport /analizzare" (design); chiuso il tentativo 8.6.5-8.6.7.

## 8.6.4 — allineamento home desktop ampio (2026-06-01)

Rifinitura di `synthesis-home.html` su schermi medi/grandi (riferimento utente). Il logo era in una `.topbar` separata sopra l'hero → più in alto e scollegato dall'immagine, e piccolo. Modifiche: logo spostato DENTRO `.hero-left` come primo elemento (ordine logo → headline → lead, stesso bordo sinistro); `.hero` `align-items:center → start` → **top del logo = top dell'immagine** (misurato a 1920×1080: scarto 166px → 0). Logo più grande: `clamp(48px,8vh,84px)` → `clamp(70px,12vh,124px)` (+48%). Eyebrow "Synthesis-ICP" rimosso dall'HTML (assente nel riferimento; il logo ne fa le veci) — la regola CSS `.eyebrow` resta orfana (follow-up cleanup §3.4). Layout più ampio: `.page` `max-width 1340 → 1600` + `justify-content:center` → margini simmetrici (a 1920×1080: sx=dx=192px, alto=basso=105px; a 4:3 1600×1200: 167/167 centrato). `.hero` `flex 1 1 auto → 0 0 auto`. Immagine a filo del bordo destro = ultima card. Desktop basso (≤900h) e mobile (≤900w) protetti con `justify-content:flex-start` + logo ridimensionato → "una schermata" e responsive verticale invariati (overflow 0). Verificato via JS getBoundingClientRect. Solo `synthesis-home.html`; v3b non toccato (`ANALIZZA_BUILD`/`<title>` restano 8.5.0).

Deploy verificato live su entrambi (commit `7cc5151`, sequenza LEGACY canary → BACKEND, ~60s ciascuno): `backend_version=8.6.4`, `GET /` 200 col marker `v8.6.4` + `eyebrow` assente + `max-width:1600px` servito, `/analizzare` 200, gating `/api/me/storage` → 403. `app.syntesis-icp.com` (no-h) → 200. Sospesi: nessuno aperto/chiuso (resta il follow-up cert dominio-H, ora in validazione finale: vedi Sospesi #2).

## 8.6.3 — fit home 16:9 anche su schermi bassi (2026-06-01)

8.6.2 stava in una schermata sui monitor ampi/alti, ma sui desktop **bassi** (~13", viewport ≤~880px d'altezza) il contenuto sforava ~39px (misurato live; causa: `.hero-img max-height:min(58vh,100%)` col `100%` indefinito → l'immagine non si rimpiccioliva). Fix **additivo** (base 8.6.2 invariata → look generoso intatto sugli schermi ampi): `@media (min-width:901px) and (max-height:900px)` comprime logo/headline/lead/immagine(`max-height:44vh`)/card/padding/gap **solo** sui desktop bassi → stessa composizione, niente scroll. `@media (min-width:901px){.viewport{overflow:hidden}}` azzera la barra per il residuo sub-pixel del flex (clippa solo ~9px di padding di fondo, **nessun contenuto tagliato**).

Deploy verificato live su entrambi (commit `c0515fd`, LEGACY canary → BACKEND, ~48s/24s): `backend_version=8.6.3`, markup col blocco `max-height:900` + `overflow:hidden` servito. **Misura live a 1352×873** (simula 13", compressione attiva): immagine 432→373px, `overflowPx 39→9`, `overflowY:hidden` → nessuna barra di scroll. `/analizzare` 200, gating 403, `app.syntesis-icp.com` 200. Sospesi: nessuno aperto/chiuso.

## 8.6.2 — layout home "una schermata" 16:9 + crop immagine (2026-06-01)

Layout `synthesis-home.html` rivisto perché su desktop 16:9 stia **tutto in una schermata senza scroll** dentro la cornice, e fix del **contenuto che scrollava sotto la cornice fissa**. Architettura: `.viewport` `position:fixed; inset:22px` (= cornice 18 + bordo 4) con `overflow-y:auto` → lo scroll vive DENTRO la cornice (mai sotto l'anello); `.page` flex-column con misure in `vh`/`clamp` (logo, headline, lead, immagine `max-height:min(58vh,100%)`, card) → logo + hero + 4 card in `100vh`. Mobile ≤900px: `.viewport` block (scroll naturale dentro la cornice), verticale (logo→testo→immagine→card; 2 col ≤900 / 1 col ≤560). **Immagine**: sostituito il file col **crop** (1920×1080/774315B → 1233×889/544942B) + `?v=862` sul `src` (cache-busting). Mantenuti: cornice cava animata, tema scuro, logo invert, hover card, link workflow.

Deploy verificato live su entrambi (commit `0580299`, LEGACY canary → BACKEND): `backend_version=8.6.2`, immagine servita 544942 B (crop nuovo), markup layout (`.viewport`, `?v=862`). NB: su desktop bassi restava ~39px di overflow → risolto in 8.6.3.

## 8.6.1 — fix home dark invisibile (cornice cava) (2026-06-01)

Hotfix del redesign 8.6.0: sul live la home mostrava **solo il bordo animato**, tutto il contenuto invisibile (scuro dentro la cornice). Causa: `.synt-frame` (overlay `position:fixed`, `z-index:9999`) col trucco doppio-background **riempiva il proprio interno** di `--dark` opaco (layer `linear-gradient(--dark)` clippato a `padding-box`) → coperchio su `.page` (`z-index:1`). Il contenuto era integro nel markup (verificato: headline, 4 card, logo, immagine presenti) → problema puramente CSS, non perdita di file.

- Fix: cornice **cava** via `mask`. Il conic-gradient riempie tutto l'elemento; `-webkit-mask`/`mask-composite:exclude` esclude il `content-box` → interno **trasparente**, contenuto sotto visibile. Mantenuti: spin (`@property --synt-sa` + `@keyframes syntSpin` 4s), `position:fixed`, `pointer-events:none`, glow.
- Robustezza (richiesta): animazioni d'ingresso (`fadeUp`/`fadeDown`/`fadeIn`) spostate sotto `@media (prefers-reduced-motion:no-preference)`; tolti gli `animation:...both` dai blocchi base → contenuto `opacity:1` di default, fade solo enhancement (un'animazione che non parte non può più lasciare il contenuto invisibile).
- Verifica logo a immagine: `#000` + `filter:invert(1) brightness(1.9)` → `(255,255,255)` bianco pieno, leggibile sul fondo scuro. Solo `synthesis-home.html`; `v3b` non toccato.

Deploy verificato live su entrambi i servizi (commit `d8d0890`, LEGACY canary → BACKEND, build ~168s/~48s): `backend_version=8.6.1`, `GET /` 200 con `v8.6.1`, **markup servito**: `mask-composite:exclude` ×1 e **0** riempimento `--dark` opaco (cornice cava), `filter:invert(1) brightness(1.9)` ×1, contenuto presente (headline/4 card/logo/immagine), `@media no-preference` ×1; logo + immagine 200; `/analizzare` 200, gating `/api/me/storage` → 403. `app.syntesis-icp.com` → 200. Sospesi: nessuno aperto/chiuso (resta follow-up cert dominio-H).

## 8.6.0 — home dark + bordo perimetrale animato (2026-06-01)

Redesign visivo della sola `synthesis-home.html` in **tema scuro stile software** (le 4 card workflow e i link invariati). Tema `--dark #0F1923`; **bordo perimetrale animato** `.synt-frame`: un `div` `position:fixed` in overlay (`inset:18px`, `pointer-events:none`, `z-index:9999`) con conic-gradient rosa/viola/arancio il cui angolo `--synt-sa` è animato via `@property` + `@keyframes syntSpin` 4s linear infinite — resta fermo allo scroll e **non blocca i click** sulle card (la home scrolla, a differenza del bordo originale di Vedere che è su `<body>` a tutto schermo). Header col logo reale reso **bianco** da `filter:invert(1) brightness(1.9)` (PNG nero su trasparente, pixel opachi 100% neri → invert pulito, niente aloni). Hero: eyebrow "Synthesis-ICP" + headline con accent blu ("…implantare diventa misura.") + lead; immagine `padova-17_001.jpeg` in card chiara `.hero-img-wrap` (`#F0F1F5` + ombra/glow) che la stacca dal fondo scuro. 4 `.tool-card` scure con hover-lift e SVG inline. Template di partenza fornito dall'utente; i 2 segnaposto (`.logo-placeholder`, `.hero-img-ph`) sostituiti coi file reali e rimossi i CSS/commenti orfani. `main.py` invariato; `v3b` non toccato (`ANALIZZA_BUILD`/`<title>` restano 8.5.0).

Deploy verificato live su entrambi i servizi (commit `725786a`, sequenza LEGACY canary → BACKEND, build ~120s/~24s): `backend_version=8.6.0`, `GET /` 200 con `<title>Synthesis-ICP</title>` e **markup dark servito** verificato (`--dark:#0F1923`, `.synt-frame`, `@property`/`@keyframes`, `pointer-events:none`, `filter:invert`, img logo+hero reali, zero residui segnaposto), logo `/static/synthesis-logo.png` 200 (png 75645 B) e immagine `/static/assets/padova-17_001.jpeg` 200 (jpeg 774315 B), `/analizzare` 200, gating anonimo `/api/me/storage` → 403. `app.syntesis-icp.com` → 200. Sospesi: nessuno aperto/chiuso (resta il follow-up cert dominio-H `app.synthesis-icp.com`).

## 8.5.1 — redesign testata+hero home (2026-06-01)

Ritocco grafico alla sola `synthesis-home.html` (le 4 card workflow invariate). Testata: logo ingrandito 42px→84px, rimosso il suffisso "ICP" (resta solo il logo). Hero: rimosso l'H1 "Synthesis-ICP" (ridondante col logo), la tagline diventa l'headline (blu, 30px); immagine `padova-17_001.jpeg` ingrandita (`grid 1fr 1.25fr`) e privata di card/bordo/ombra. **Fusione**: sfondo della pagina unificato a `#F0F1F5` — il colore reale campionato dal fondo del JPEG (via PIL; bordi/angoli uniformi 240,241,245) — così il fondo è continuo dall'alto in basso e l'immagine si dissolve senza fascia né bordo. Le card bianche restano staccate (Δ luminanza ~15 + bordo + ombra). Responsive: ≤900px le colonne si impilano (testo sopra, immagine sotto). Solo frontend; `v3b`/analyzer non toccato (`ANALIZZA_BUILD`/`<title>` restano 8.5.0); `registry.BACKEND_VERSION` = versione canonica del rilascio.

Deploy verificato live su entrambi i servizi (commit `f874e5f`, sequenza LEGACY canary → BACKEND; build LEGACY ~48s, BACKEND ~264s — più lento ma SUCCESS): `backend_version=8.5.1`, `GET /` 200 con `<title>Synthesis-ICP</title>` e **markup servito** verificato (`height:84px` ×1, `background:#F0F1F5` ×1, `<h1>` 0, `class="suffix"` 0), immagine hero 200 (image/jpeg, 774315 B), `/analizzare` 200, gating anonimo `/api/me/storage` → 403. `app.syntesis-icp.com` → 200. Sospesi: nessuno aperto/chiuso (resta il follow-up cert dominio-H `app.synthesis-icp.com`).

## 8.5.0 — home pubblica + deep-link ?wf= + ritorno login (2026-06-01)

Prima esperienza utente su `/`: una **splash pubblica** (`backend/static/synthesis-home.html`, statica/vanilla, CSS inline, design token riusati da `vedere.html`) che sostituisce il vecchio redirect 302 a `/vedere`. Logo + wordmark, hero (testo di presentazione + immagine reale dente→mesh `/static/assets/padova-17_001.jpeg`) e griglia di 4 card workflow (Vedere/Analizzare/Misurare/Sostituire) con le 4 SVG del menu WorkFlow.

- `main.py`: `GET /` ora `FileResponse(synthesis-home.html)`, **pubblica** (nessun gate, com'era il redirect); fallback a `/vedere` se il file manca.
- Deep-link `?wf=`: le card Misurare/Sostituire puntano a `/analizzare?wf=<wf>`. Reader al `DOMContentLoaded` di `v3b.html` (dopo `setMode`) che valida `wf ∈ {analizza,accoppia,misurare,sostituire}` e apre `selectWorkflow(wf)` via `setTimeout(0)`; default analizza. Bump `<title>`/`ANALIZZA_BUILD` → 8.5.0.
- Ritorno post-login: `syntesis-accedi.html` (`#enter-app`) ora consuma `sessionStorage.syn_after_login` (salvato dal gate `syn-gate.js`) e torna al deep-link same-origin dopo login (guardie anti open-redirect); fallback `/vedere` invariato quando assente → un utente non autorizzato che clicca Misurare torna su `/analizzare?wf=misurare` dopo l'accesso.
- `docs/MAPPA_FUNZIONALE.md` aggiornata nello stesso commit (regola §4): vista Home, nota deep-link `?wf=`, versione mappata 8.5.0.

Deploy verificato live su entrambi i servizi (commit `8736299`, sequenza LEGACY canary → BACKEND, build ~24-48s): `backend_version=8.5.0`, `GET /` 200 con `<title>Synthesis-ICP</title>`, immagine hero `/static/assets/padova-17_001.jpeg` 200 (image/jpeg, 774315 B), `/vedere`/`/analizzare`/`/analizzare?wf=misurare` 200, gating anonimo `/api/me/storage` → 403. `app.syntesis-icp.com` (senza H) 200; `app.synthesis-icp.com` (con H) handshake SSL fallito (HTTP 000) — custom domain con cert non ancora provisioned, **non** regressione del deploy. Sospesi: nessuno aperto; aperto follow-up cert dominio-H.

## 8.4.8 — fix primo-click #btnPick su Vedere (2026-06-01)

Bugfix runtime su `syntesis-icp-vedere.html` (Vedere): al primo click su "Aggiungi file" (`#btnPick`) il file dialog di sistema si apriva e si richiudeva subito; al secondo restava. Causa: **doppio trigger** — `#btnPick` aveva sia `onclick` inline (`document.getElementById('filePicker').click()`, ~riga 1020) sia `addEventListener('click', pickFiles)` (~2727, con `pickFiles` = `filePicker.click()`), quindi due `.click()` sincroni per un click utente → la seconda chiamata annullava il dialog appena aperto.

- Fix: rimosso l'`onclick` inline (~1020); `#btnPick` ora ha il solo `addEventListener` → single trigger, coerente con `#btnAdd`/`#btnReset`. Confermato runtime (anteprima + live). Solo Vedere; `v3b`/analyzer non toccato.
- Versioning: bump in `registry.py BACKEND_VERSION` → 8.4.8 (fonte di verità unica). `ANALIZZA_BUILD`/`<title>` dell'analyzer e il tag Vedere `v8.0.0-refactor` invariati (architetturale).
- `docs/MAPPA_FUNZIONALE.md` completata su Vedere (handler toolbar per-bottone) + voce primo-click → RISOLTO (regola §4).

Deploy verificato live su entrambi i servizi (commit `6c54bf7`, LEGACY canary → BACKEND): `backend_version=8.4.8`, `/vedere` HTTP 200 con **`#btnPick` senza `onclick` inline nell'HTML servito** (resta solo 1 onclick→filePicker = voce menu Importa), `/analizzare` 200, gating anonimo → 403. `app.syntesis-icp.com` escluso (cert SSL pre-esistente). Sospesi: nessuno aperto, nessuno chiuso.

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

**Bug rendering viewport `/analizzare` (Solid transparency)**: aperto 2026-06-02, da ripensare come DESIGN, non incident.
- **Sintomo**: la mesh scansione semitrasparente, in modalità Solid, oscura o rende confusi i MUA che ha dietro; la forma si legge bene solo in modalità "Entrambi".
- **Cosa è stato provato** (8.6.5 -> 8.6.7, poi revertito in 8.6.8): (A) culling MUA `DoubleSide->FrontSide`; (B) `depthWrite` accoppiato all'opacità sulla scansione; (C) `renderOrder=1` sulla scansione. Ogni fix risolveva un pezzo scoprendone un altro; il risultato cumulativo era meno leggibile dell'originale, quindi rollback completo allo stato 8.6.4.
- **Causa profonda**: la mesh scansione è grande, avvolgente, concava. Il rendering trasparente standard di Three.js r128 è order-dependent e non gestisce bene questa geometria: è un limite della tecnica, non un flag mancante.
- **Cosa NON funziona**: patch incrementali sulla transparency pipeline.
- **Direzione futura** (sessione dedicata, non a fine giornata): ripensare il "vedere dentro" come problema di design: valutare clipping/sezione (depthWrite-safe) invece della trasparenza dell'intera mesh, oppure order-independent transparency.
- **Da tenere**: il Fix A (culling MUA `FrontSide`) era di per sé corretto e risolveva il foro-che-mostra-l'interno; è ririprovabile e riverificabile a parte, separato dalla questione trasparenza.

**Gate accesso — completamento rollout** (aperti in 8.4.3)
- Agganciare il gate `syn-gate.js` anche a `/vedere` e `/dashboard` (oggi protegge solo `/analizzare`).
- Rimuovere l'endpoint `/api/analyze-public`: finché esiste è un bypass del gate (analisi senza utente autorizzato).
- Gestire il deep link in `/accedi`: consumare `sessionStorage.syn_after_login` dopo il login e tornare alla pagina richiesta (oggi `syn-gate.js` lo salva ma `/accedi` non lo rilegge).

**Alta priorità**
1. Fase 0 stabilizzazione: split v3b.html, scripts/, pytest base
2. **[CHIUSO 2026-06-02] Dominio brand con-h `app.synthesis-icp.com`** → **live** (HTTP 200, cert `VALID`/`COMPLETE`). Entrambi i domini ok: no-h `app.syntesis-icp.com` 200 (era già sano; la vecchia voce "404 + cert mismatch" del 2026-05-21 era stale) e con-h `app.synthesis-icp.com` (brand corretto "Synthesis", con la h) 200. **Causa del blocco**: il con-h restava in `VALIDATING_OWNERSHIP` (`verified:False`) per il **record TXT di ownership mancante** (CNAME `wcu5nq5m.up.railway.app` corretto, nessun CAA, nameserver coerenti, nessun errore CA). **Diagnosi**: Railway atteso TXT host `_railway-verify.app` (FQDN `_railway-verify.app.synthesis-icp.com`, zona synthesis-icp.com), valore `railway-verify=fcb8c2cfa9f853b272635c64a77273198eb5584ffe9513576f664d49627971dd`. **Fix** (azione manuale Francesco su register.it, 2026-06-02 ~17:33): aggiunto quel TXT → Railway ha verificato l'ownership (`verified:True`) → cert Let's Encrypt emesso → con-h a 200. (Antefatto: il 2026-06-01 delete+recreate del custom domain con nuovo target CNAME `wcu5nq5m`; da solo non bastava senza il TXT.)
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
- **Rendering viewport `/analizzare` (tech, da valutare)**: upgrade Three.js r128 → ultima + clipping/sezione invece della trasparenza dell'intera mesh. Metodo deciso: **POC standalone** (input STL reale, criterio di successo definito a priori), fuori dal repo di produzione, prima di stimare la migrazione. Contesto: vedi Sospesi → "Bug rendering viewport /analizzare".

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
*Snapshot 2026-06-02 — 8.6.8 live su entrambi i servizi (rendering viewport /analizzare revertito a 8.6.4; tentativo 8.6.5-8.6.7 annullato). Aggiornare al prossimo cambio di stato.*
