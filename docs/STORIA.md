# Storia delle modifiche

Cronologia delle feature e fix significativi. Stile: una entry per modifica, in ordine cronologico inverso (piu' recente in alto).

---

## 2026-06-05 — 8.11.0: estrai clip engine in ds/syn-clip.js

Primo modulo della campagna di modularizzazione del monolite `syntesis-analyzer-v3b.html`. Il clip engine di /analizzare (clipping plane + stencil cap "vedere dentro" + pannello "Taglio") estratto dal monolite (ex righe 2574-2717, 144 righe) nel modulo `backend/static/ds/syn-clip.js` (`<script src>` classico come `syn-render.js`/`syn-gate.js`, parse-safe su `window.THREE`). Motore INVARIATO; diff sul monolite +1 riga (`<script src>`) / −144 (blocco rimosso).

Meccanismo: stato su `window.synClip*` + funzioni ri-esposte coi nomi bare → i call-site esterni del monolite (loadScanFile, rebuildScanMeshGeometry, "opacità comanda" treeUnified_setScanOpacity/ghostAll che scrivono synClipEnabled, handler inline #panelTaglio) restano invariati — è il motivo per cui lo stato resta su window.

Validazione: gate di equivalenza `scripts/gate/clip` (harness Node A/B con THREE reale headless, scanMesh sintetica) — G1 numerico/strutturale (piano, centro/diag, stencil group, cap pos/quat/material) + G2 DOM pannello → golden(verbatim) ≡ after(modulo), 0 scostamenti a precisione piena (Object.is). `node --check` OK su tutti gli 8 `<script>` inline del monolite.

Implementazione:
- estratto `backend/static/ds/syn-clip.js` (synClipArr/synMakeStencilGroup/synPositionCap/synUpdateClipPlane/synRebuildClip + openTaglio/closeTaglio/tagSyncUI/tagOn*/tagForceScanOpaque + stato synClip*/tagState), ri-esposto su window coi nomi bare + namespace `SynClip`.
- v3b: rimosso blocco 2574-2717, aggiunto `<script src="/static/ds/syn-clip.js">` (riga 11).
- bump 8.11.0: registry.py (BACKEND_VERSION/LAST_UPDATED/History) + v3b `<title>`/`ANALIZZA_BUILD(_DATE)`.
- docs/MAPPA_FUNZIONALE.md: sezione Taglio → sorgente ds/syn-clip.js (handler/motore nel modulo; markup/cross-ref v3b aggiornati alle righe reali post-estrazione).
- infra: gate template riusabile in `scripts/gate/` (gate.mjs, compare.mjs, check_inline_scripts.py).
- Branch `refactor-extract-clip-engine`, merge no-ff `5185d54`. Deploy canary LEGACY `681d90ca` + BACKEND `482ba95c`; verificato 8.11.0 live su BACKEND + LEGACY + `app.syntesis-icp.com` (syn-clip.js 200 11526B, gating 403).

---

## 2026-06-04 — 8.10.1: logo brand bianco su /accedi

Fix UI sulla pagina di login: il logo in alto a sinistra passa dal wordmark testuale "Syntesis ICP" al logo brand reale `/static/synthesis-logo.png` (lo stesso usato in home + header del software), reso bianco sul pannello scuro (`filter:invert(1) brightness(1.9)`, altezza 66px). Corregge anche l'incoerenza "Syntesis" (senza-h) → "Synthesis".

Implementazione:
- `syntesis-accedi.html`: markup `.brand` (span testo → `<img class="brand-logo" src="/static/synthesis-logo.png">`) + CSS `.brand-logo{height:66px;width:auto;filter:invert(1) brightness(1.9)}`.
- Bump solo `registry.BACKEND_VERSION` 8.10.0→8.10.1 (PATCH); v3b `<title>`/`ANALIZZA_BUILD` e `pdf_gen` non toccati (cambio non-v3b, pattern 8.6.4 home-only → backend_version 8.10.1 ma /analizzare title resta v8.10.0).
- Branch `fix-accedi-logo`, merge no-ff `786501e`, bump `fd2ebeb`. Deploy canary LEGACY `16b911af` + BACKEND `0e4d724b`. Verificato 8.10.1 live su BACKEND + LEGACY + `app.syntesis-icp.com` (logo servito, height 66px).

---

## 2026-06-04 — 8.10.0: allineamento motori rendering r169 (tutte le superfici 3D) + color picker /vedere + reticolo

Tutte le superfici 3D di Syntesis-ICP portate a Three.js r169 con la stessa pipeline, via la fonte unica `backend/static/ds/syn-render.js`. /analizzare retrofittato a comportamento invariato (gate pixel diffPixels=0); /vedere e /dashboard migrati da r128; zero r128 residuo nel codebase. Deploy canary LEGACY→BACKEND, live verificato 8.10.0 su entrambi i servizi + custom domain `app.syntesis-icp.com`.

Implementazione:
- F1: core `ds/syn-render.js` (applyRendererPipeline = CM ON + SRGBColorSpace + NoToneMapping + localClipping; addCameraLightRig = Ambient 1.2/key 1.8/fill 0.75; makeGradientTexture sRGB) + retrofit /analizzare a comportamento invariato, verificato con gate pixel headless (diffPixels 0/262144). Commit `6a69f15`.
- F2: /vedere r128→r169 — loader importmap+bridge `window.THREE`, init eager (parse-time) → differito a `three-ready`; addon jsm TrackballControls / TransformControls (`scene.add(getHelper())`, breaking r163) / OBJLoader / PLYLoader; clip/stencil sezione + PiP riconciliati. Colore Δ=0 vs /analizzare a parità di input. Commit `6424242`, `94f7c44`.
- F3: /dashboard preview STL r128→r169 — `import('three')` dinamico lazy (resta on-demand) + `applyRendererPipeline`. Commit `8ab2d8c`.
- Fix bug `async` orfano pre-esistente /dashboard (riga ~3585: ReferenceError a ogni load che interrompeva l'init top-level a valle). Commit `1d68348`.
- Color picker /vedere nativo (`<input type="color" class="tree-color">` + `setSceneObjectColor` copiato da /analizzare 8.9.0, vertex-color/highlight preservati). Commit `70f283b`.
- Reticolo "Entrambi" /vedere uniformato a /analizzare (MeshBasicMaterial blu density-scaled → WireframeGeometry+LineSegments nero 0.35). Commit `98bdc02`.
- Misurare ICP + Sostituire erano già r169 (workflow dentro /analizzare). Bump registry/v3b/pdf_gen 8.9.0→8.10.0 + MAPPA versione mappata. Merge no-ff `fb77cbf`, bump `b78fa8a`. Deploy LEGACY `2dcf031c` + BACKEND `bfcfe7be`. Verifica visiva utente OK su /vedere.

---

## 2026-06-02 — 8.6.8: revert stack rendering viewport /analizzare → stato 8.6.4

Rollback completo dello stack rendering del viewport principale di `/analizzare`. I tre fix tentati e deployati (8.6.5 culling MUA `DoubleSide->FrontSide`, 8.6.6 `depthWrite` accoppiato all'opacità sulla scansione, 8.6.7 `scanMesh.renderOrder=1`) miglioravano un aspetto peggiorandone un altro; il cumulato in Solid era meno leggibile dell'originale, quindi ritorno alla base 8.6.4.

Implementazione:
- `git revert` (ordine inverso) dei 3 commit: `ab4b2c4` (8.6.7), `b8a54f2` (8.6.6), `99ef34e` (8.6.5). No reset/force (commit pubblici e deployati), storia preservata.
- Codice viewport byte-identico a 8.6.4: diff netto 0 vs `99ef34e^` (verificato). MUA di nuovo `side:THREE.DoubleSide`, `depthWrite` coupling rimosso (load / `treeUnified_setScanOpacity` / `treeUnified_ghostAll`), `scanMesh.renderOrder` rimosso. camera/renderer invariati.
- Solo i marker di versione cambiano: 8.6.4 → 8.6.8 (monotono, niente secondo 8.6.4). Bump v3b `<title>`+`ANALIZZA_BUILD` 8.5.0 → 8.6.8; `registry.BACKEND_VERSION` 8.6.8 + voce History (nota revert + causa profonda); `docs/MAPPA_FUNZIONALE.md` mappata 8.6.8.
- Commit `8c39afa`. Deploy live su entrambi (LEGACY canary → BACKEND): `backend_version=8.6.8`, `/analizzare` 200, gating 403, stato rendering 8.6.4 confermato nell'HTML servito (MUA DoubleSide×3, FrontSide×0, depthWrite coupling 0, renderOrder 0), no-h 200.
- Problema rendering aperto come design (Sospesi `STATO_SISTEMA`): mesh scansione grande/avvolgente/concava + trasparenza order-dependent Three.js r128 = limite di tecnica; ripensare via clipping/sezione o OIT. Fix A culling riprovabile a parte.

---

## 2026-06-01 — 8.6.4: allineamento home su desktop ampio

Rifinitura di `synthesis-home.html` su schermi medi/grandi (da riferimento utente). Il logo stava in una `.topbar` separata sopra l'hero → più in alto e scollegato dall'immagine, e piccolo.

Implementazione:
- Logo spostato dentro `.hero-left` come primo elemento (logo → headline → lead, stesso bordo sinistro); `.hero` `align-items:center → start` → top logo = top immagine (misurato a 1920×1080: scarto 166px → 0).
- Logo +48%: `height clamp(48px,8vh,84px) → clamp(70px,12vh,124px)`.
- Eyebrow "Synthesis-ICP" rimosso dall'HTML (assente nel riferimento; il logo ne fa le veci). La regola CSS `.eyebrow` resta orfana → follow-up cleanup (§3.4).
- Layout più ampio: `.page max-width 1340 → 1600` + `justify-content:center` → margini simmetrici (1920×1080: sx=dx=192, alto=basso=105; 4:3 1600×1200: 167/167 centrato). `.hero flex 1 1 auto → 0 0 auto` (niente vuoto sotto l'immagine). Immagine a filo del bordo destro = ultima card.
- Mobile (≤900w) e desktop-basso (≤900h): `justify-content:flex-start` + logo ridimensionato → "una schermata" e responsive verticale invariati (overflow 0).
- Verificato via JS `getBoundingClientRect` a 1920×1080 e 4:3: relazioni a scarto 0. Solo `synthesis-home.html`; v3b non toccato (`ANALIZZA_BUILD`/`<title>` restano 8.5.0).
- `registry.py` `BACKEND_VERSION` 8.6.3 → 8.6.4 + History; commento home → v8.6.4. `docs/MAPPA_FUNZIONALE.md` sincronizzata (regola §4).
- Commit `7cc5151`. Deploy live su entrambi (LEGACY canary → BACKEND, ~60s ciascuno): `backend_version=8.6.4`, `GET /` 200 col marker `v8.6.4` + eyebrow assente + `max-width:1600`, `/analizzare` 200, gating 403, `app.syntesis-icp.com` (no-h) 200.

---

## 2026-06-01 — 8.6.3: fit home 16:9 anche su schermi bassi

8.6.2 stava in una schermata sui monitor ampi/alti, ma sui desktop bassi (~13", viewport ≤~880px) il contenuto sforava ~39px. Causa: `.hero-img max-height:min(58vh,100%)` col `100%` indefinito → l'immagine non si rimpiccioliva.

Implementazione:
- Fix **additivo** (base 8.6.2 invariata → look generoso intatto sugli schermi ampi, come richiesto dall'utente con screenshot): `@media (min-width:901px) and (max-height:900px)` comprime logo/headline/lead/immagine(`max-height:44vh`)/card/padding/gap solo sui desktop bassi → stessa composizione, niente scroll.
- `@media (min-width:901px){.viewport{overflow:hidden}}` azzera la barra per il residuo sub-pixel del flex (clippa ~9px di padding di fondo, nessun contenuto cut).
- Mobile invariato (verticale, `overflow-y:auto` dentro la cornice).
- `registry.py` 8.6.2 → 8.6.3. `docs/MAPPA_FUNZIONALE.md` (regola §4). v3b non toccato.
- Commit `c0515fd`. Deploy live su entrambi (LEGACY canary → BACKEND). Misura live a 1352×873 (13" sim): immagine 432→373, overflowPx 39→9, overflowY:hidden → nessuna barra.

---

## 2026-06-01 — 8.6.2: layout home "una schermata" 16:9 + crop immagine

Due interventi: (1) il layout `synthesis-home.html` ora sta tutto in una schermata su desktop 16:9 senza scroll, e risolve il contenuto che scrollava sotto la cornice fissa; (2) sostituita l'immagine hero col crop ritagliato.

Implementazione:
- Architettura: `.viewport` `position:fixed; inset:22px` (dentro la cornice) con `overflow-y:auto` → scroll DENTRO la cornice, mai sotto l'anello. `.page` flex-column con misure `vh`/`clamp` (logo, headline, lead, immagine `max-height:min(58vh,100%)`, card) → logo+hero+4 card in 100vh.
- Mobile ≤900px: `.viewport` block (scroll naturale dentro la cornice), layout verticale; card 2 col ≤900 / 1 col ≤560.
- Immagine: `backend/static/assets/padova-17_001.jpeg` sostituito col crop (1920×1080/774315B → 1233×889/544942B); `?v=862` sul `src` (cache-busting).
- `registry.py` 8.6.1 → 8.6.2. `docs/MAPPA_FUNZIONALE.md` (regola §4). v3b non toccato.
- Commit `0580299`. Deploy live su entrambi (LEGACY canary → BACKEND): immagine 544942 B servita, markup layout. Residuo ~39px su desktop bassi → risolto in 8.6.3.

---

## 2026-06-01 — 8.6.1: fix home dark invisibile (cornice cava + robustezza animazioni)

Hotfix di 8.6.0: la home dark sul live mostrava solo il bordo animato, tutto il contenuto invisibile. Il contenuto era integro nel markup → bug CSS, non perdita di file.

Implementazione:
- Causa: `.synt-frame` (overlay `position:fixed`, `z-index:9999`) col trucco doppio-background riempiva il proprio interno con `linear-gradient(--dark)` clippato a `padding-box` → lastra `--dark` opaca sopra `.page` (`z-index:1`) = coperchio. (Il trucco funziona su `<body>`, dove lo sfondo sta dietro al contenuto; come overlay separato no.)
- Fix: cornice **cava** via mask — `background:conic-gradient(...)` su tutto l'elemento + `-webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)` con `mask-composite:exclude` (`-webkit-mask-composite:xor`) → dipinge solo l'anello (`padding:4px`), interno trasparente. Spin (`@property`+`@keyframes syntSpin`), `position:fixed`, `pointer-events:none`, glow invariati.
- Robustezza animazioni: `fadeUp`/`fadeDown`/`fadeIn` spostate sotto `@media (prefers-reduced-motion:no-preference)`; rimossi gli `animation:...both` dai blocchi base → contenuto `opacity:1` di default, fade solo enhancement (non può più lasciare invisibile). Il blocco `reduce` resta solo per fermare la cornice.
- Verifica extra del logo: `#000` + `invert(1) brightness(1.9)` → `(255,255,255)` bianco pieno (simulato sui pixel reali + composito su `#0F1923`), leggibile sul fondo scuro.
- `registry.py` `BACKEND_VERSION` 8.6.0 → 8.6.1 (PATCH). `docs/MAPPA_FUNZIONALE.md` (regola §4). Solo `synthesis-home.html`; `v3b` non toccato.
- Commit `d8d0890`. Deploy verificato live su entrambi (LEGACY canary → BACKEND, ~168s/~48s): `8.6.1`, frame cavo servito (`mask-composite:exclude` ×1, 0 riempimento opaco), logo invert ×1, contenuto presente, logo+immagine 200, gating → 403, `app.syntesis-icp.com` 200.

---

## 2026-06-01 — 8.6.0: home dark + bordo perimetrale animato

Redesign visivo della sola `backend/static/synthesis-home.html` in tema scuro "stile software" (card workflow e link invariati). Da un template fornito dall'utente, con 2 segnaposto sostituiti coi file reali.

Implementazione:
- Tema scuro `--dark #0F1923`, testo chiaro; `html{background:#000}` come backdrop.
- **Bordo perimetrale animato** `.synt-frame`: `div` `position:fixed` overlay (`inset:18px`, `pointer-events:none`, `z-index:9999`); conic-gradient (#FF8C42/#FF4D8D/#FFD166/#C84BFF/#FF6B35/#FF9FC8) con angolo `--synt-sa` animato via `@property` (`<angle>`) + `@keyframes syntSpin` 4s linear infinite. Adattamento del bordo di Vedere (che è su `<body>` con `overflow:hidden`, app a tutto schermo) a una pagina che **scrolla**: overlay fisso che non blocca i click e resta fermo.
- Logo: swap segnaposto → `<img class="logo-img" src="/static/synthesis-logo.png">`, reso bianco da `filter:invert(1) brightness(1.9)`. Verificato a pixel: opachi 100% nero su trasparente → invert pulito, niente aloni (no versione bianca dedicata).
- Hero: eyebrow + `.headline` con `.accent` blu + `.lead`; immagine swap segnaposto → `<img class="hero-img" src="/static/assets/padova-17_001.jpeg">` dentro `.hero-img-wrap` (card chiara #F0F1F5 + ombra/glow) che la stacca dal fondo scuro.
- 4 `.tool-card` scure con hover-lift, SVG inline, link invariati (/vedere, /analizzare, /analizzare?wf=misurare, /analizzare?wf=sostituire). Rimossi CSS/commenti orfani dei segnaposto.
- `registry.py` `BACKEND_VERSION` 8.5.1 → 8.6.0 (MINOR: redesign sostanziale). `docs/MAPPA_FUNZIONALE.md` (regola §4): sezione Home riscritta. `main.py` invariato; `v3b` non toccato.
- Commit `725786a`. Deploy verificato live su entrambi i servizi (LEGACY canary → BACKEND, build ~120s/~24s): `backend_version=8.6.0`, `GET /` 200, markup dark servito, logo 200 + immagine 200, gating → 403, `app.syntesis-icp.com` 200.

---

## 2026-06-01 — 8.5.1: redesign testata+hero home

Ritocco grafico alla sola `backend/static/synthesis-home.html` (le 4 card workflow invariate). Testata più pulita e hero "fuso nel fondo".

Implementazione:
- Testata: logo topbar 42px→84px (PNG 3256×931@300dpi → nessuna sgranatura, ~11× downscale); rimosso il suffisso "ICP" (markup + CSS) — resta solo il logo come marchio.
- Hero: rimosso l'H1 "Synthesis-ICP" (ridondante col logo); la tagline diventa l'headline (blu, 30px, bold); immagine `padova-17_001.jpeg` ingrandita (`grid 1fr 1.25fr`, ~56% vs ~47%) e senza card/bordo/ombra.
- Fusione fondo: sfondo della **pagina** (body) unificato a `#F0F1F5` = colore reale campionato dal fondo del JPEG (PIL, bordi/angoli uniformi 240,241,245; Δ5 da `--pearl` #F0F5FA). Il fondo continuo elimina ogni fascia/bordo attorno all'immagine; le card bianche restano staccate.
- Responsive: ≤900px stack verticale (testo sopra, immagine sotto, tagline 26px), ≤560px tagline 22px.
- `registry.py` `BACKEND_VERSION` 8.5.0 → 8.5.1 (PATCH: ritocco UI). `docs/MAPPA_FUNZIONALE.md` (regola §4): righe Logo/Hero immagine + versione mappata 8.5.1. `v3b` non toccato (`ANALIZZA_BUILD`/`<title>` 8.5.0).
- Commit `f874e5f`. Deploy verificato live su entrambi i servizi (LEGACY canary → BACKEND, build 48s/264s): `backend_version=8.5.1`, `GET /` 200, markup redesign servito (logo 84px, fondo #F0F1F5, no H1/suffix), immagine 200, gating → 403, `app.syntesis-icp.com` 200.

---

## 2026-06-01 — 8.5.0: home pubblica + deep-link ?wf= + ritorno login

Prima esperienza utente su `/`: splash pubblica (`backend/static/synthesis-home.html`) che sostituisce il redirect 302 a `/vedere`. Presentazione del prodotto + immagine reale dente→mesh + 4 card workflow (Vedere/Analizzare/Misurare/Sostituire) con le 4 SVG del menu WorkFlow. Statica/vanilla, CSS inline, design token riusati da `vedere.html`.

Implementazione:
- `main.py`: `GET /` → `FileResponse(synthesis-home.html)`, pubblica (no gate), fallback `RedirectResponse` `/vedere` se il file manca.
- `synthesis-home.html` (nuovo, 118 righe, 0 JS): topbar logo+wordmark, hero 2-col (testo a sx, immagine `/static/assets/padova-17_001.jpeg` a dx in card arrotondata), griglia 4 card responsive 4→2→1, hover-lift; link `/vedere`, `/analizzare`, `/analizzare?wf=misurare`, `/analizzare?wf=sostituire`.
- Deep-link `?wf=`: reader al `DOMContentLoaded` di `v3b.html` (dopo `setMode`, ~4754) — valida `wf ∈ {analizza,accoppia,misurare,sostituire}`, apre `selectWorkflow(wf)` via `setTimeout(0)`, default analizza; mirror del pattern `?file_id=` di Vedere. Bump `<title>`/`window.ANALIZZA_BUILD` → 8.5.0.
- Ritorno post-login: `syntesis-accedi.html` `#enter-app` consuma `sessionStorage.syn_after_login` (salvato da `syn-gate.js` `rememberDeepLink` prima del rimbalzo su `/accedi`) e torna al deep-link same-origin dopo login (guardie: inizia con `/`, non `//`, non `/accedi`); fallback `/vedere` invariato se assente. Così un non-autorizzato che clicca Misurare/Sostituire torna al workflow giusto dopo l'accesso.
- `registry.py` `BACKEND_VERSION` 8.4.8 → 8.5.0 (MINOR: feature nuova). `docs/MAPPA_FUNZIONALE.md` (regola §4): vista Home, nota deep-link, versione mappata 8.5.0.
- Commit `8736299`. Deploy verificato live su entrambi i servizi (LEGACY canary → BACKEND, build 24-48s): `backend_version=8.5.0`, `GET /` 200 con `<title>Synthesis-ICP</title>`, immagine 200 (774315 B), route workflow 200, gating anonimo → 403. `app.syntesis-icp.com` (senza H) 200; variante con-H `app.synthesis-icp.com` SSL handshake KO (cert non provisioned) — follow-up.

---

## 2026-06-01 — 8.4.8: fix primo-click #btnPick su Vedere (doppio trigger)

Bugfix runtime su `backend/static/syntesis-icp-vedere.html` (Vedere): al primo click su "Aggiungi file" (`#btnPick`) il file dialog si apriva e si richiudeva subito; al secondo restava. Diagnosi guidata dalla mappa funzionale.

Implementazione:
- Causa: `#btnPick` aveva DUE handler che chiamavano entrambi `filePicker.click()` — `onclick` inline (~1020) + `addEventListener('click', pickFiles)` (~2727, `pickFiles`=`filePicker.click()` ~2726). Due `.click()` sincroni per click → il secondo annullava il dialog appena aperto.
- Fix: rimosso l'`onclick` inline da ~1020; `#btnPick` ora ha il solo `addEventListener` → single trigger (coerente con `#btnAdd`/`#btnReset`). 1 riga. Confermato runtime (anteprima locale + live su entrambi i servizi).
- Versioning: il fix è su Vedere, non sull'analyzer → `ANALIZZA_BUILD`/`<title>` di v3b invariati; tag Vedere `v8.0.0-refactor` invariato (architetturale); bump in `registry.py BACKEND_VERSION` → 8.4.8 (fonte di verità unica del rilascio).
- `docs/MAPPA_FUNZIONALE.md` (regola §4): completata sezione Vedere (handler toolbar tracciati per-bottone), voce primo-click → RISOLTO, nessuna voce DA CHIARIRE aperta.
- Commit `6c54bf7`. Deploy verificato live (LEGACY canary → BACKEND): `backend_version=8.4.8`, `/vedere` 200 con `#btnPick` senza `onclick` nell'HTML servito, gating → 403.

---

## 2026-06-01 — 8.4.7: export Sostituire chiede il nome file (dialog in-app)

Il pulsante "Esporta STL" del workflow Sostituire (`#sostBtnExport` → `sostExportSTL`) chiede il nome del file con un modale in-app (`#sostExportDialog`) prima del download — opzione A, niente API di sistema (`showSaveFilePicker`), così funziona su tutti i browser. Prima il nome era costruito automaticamente (base scan + componenti) e scaricato senza chiedere.

Implementazione:
- `sostExportSTL` refattorizzato in 5 funzioni: `sostExportSTL` (valida + nome default + apre modale), `openSostExportNameDialog` (precompila + focus/select), `closeSostExportNameDialog`, `confirmSostExport` (sanifica + scarica), `_sostDoExport` (pipeline build/serialize/download estratta invariata, nome in `a.download`).
- Sanificazione: `.stl` strip, `[^a-zA-Z0-9._ -]+ → _`, niente spazi/punti ai bordi, fallback al default se vuoto; estensione `.stl` garantita una volta (suffisso statico nel modale).
- Modale `#sostExportDialog` ricalca `#groupDialog`. Invio=Conferma, Esc=Annulla sull'input; niente click-fuori (verificato: `#groupDialog`/`#settingsDialog` non ce l'hanno → uniformato).
- Bump 8.4.6 → 8.4.7: `<title>`, `window.ANALIZZA_BUILD`, `registry.py` `BACKEND_VERSION` + History.
- `docs/MAPPA_FUNZIONALE.md` aggiornata nello stesso commit (regola §4): riga `#sostBtnExport`, nuova riga Funzioni chiave per le 5 funzioni export, 2 ref bumpati ai valori reali rigreppati (tasto P 17119→17176, syntesisOpenFileDialog 17132→17189).
- Commit `76107ef`. Deploy verificato live su entrambi i servizi (LEGACY canary → BACKEND, build ~200-225s): `backend_version=8.4.7`, `/analizzare` 200 con title `v8.4.7`, feature presente nell'HTML servito (#sostExportDialog, #sostExportName, confirmSostExport, _sostDoExport), gating anonimo → 403.

---

## 2026-06-01 — 8.4.6: fix leak gemello .sostituire-only (gestione centralizzata selectWorkflow)

Bugfix simmetrico al fix `#panelScanbodyType` 8.4.5, individuato tramite la mappa funzionale. I 2 bottoni toolbar `.sostituire-only` di `backend/static/syntesis-analyzer-v3b.html` (Livelli ~1345, Sezione/cutview ~1408) hanno `display:none` inline; il ramo sostituire di `selectWorkflow` li mostra, ma nessun ramo li rinascondeva all'uscita → dopo aver visitato Sostituire restavano visibili in analizza/accoppia/misurare.

Implementazione:
- Riga centralizzata a fine `selectWorkflow`: `var sostBtns = document.querySelectorAll('.sostituire-only'); sostBtns.forEach(el => el.style.display = (wf === 'sostituire') ? '' : 'none')`. Nessun ramo può dimenticarli; la riga inline ridondante del ramo sostituire è lasciata invariata.
- Bump 8.4.5 → 8.4.6: `<title>`, `window.ANALIZZA_BUILD`, `registry.py` `BACKEND_VERSION` + History.
- `docs/MAPPA_FUNZIONALE.md` aggiornata nello stesso commit (regola §4): voce leak → corretto; nel farlo corretti ~17 riferimenti di riga del cluster `sost*` che erano già stale (numeri pre-8.4.5) — promemoria della fragilità dei ref a riga assoluta (follow-up registrato).
- Commit `284e2ed`. Deploy verificato live su entrambi i servizi (LEGACY canary → BACKEND): `backend_version=8.4.6`, `/analizzare` 200 con title `v8.4.6`, fix `sostBtns` presente nell'HTML servito (querySelectorAll ×2, riga centralizzata ×1), gating anonimo → 403.

---

## 2026-06-01 — 8.4.5: fix leak visibilità Box A "Tipo scanbody" in Sostituire/Misurare

Bugfix di scoping di visibilità nel pannello destro di `backend/static/syntesis-analyzer-v3b.html`. Il pannello `#panelScanbodyType` — il Box A "Tipo scanbody" del workflow Analizza, che imposta `window._ANALYZE_SBTYPE` (tipo 1T3/OS/SR per il posizionamento di nuovi MUA via `placeMUA` → `findScanbodyCenter`) — non aveva `display:none` di default e non era mai gestito da `selectWorkflow` (zero referenze JS in tutto il file). Risultato: restava visibile in ogni workflow. In **Sostituire** finiva sopra il Box B "SOSTITUIRE SCAN BODY" (`#sostSourceRadio` / `sostSourceTemplate`, il tipo di marker già presente nella scansione di partenza, usato per l'allineamento), facendo sembrare che due box chiedessero la stessa cosa; per giunta lì era inerte (la pipeline Sostituire legge `sostSourceTemplate`, non `_ANALYZE_SBTYPE`). Stesso leak inerte in **Misurare**.

Diagnosi: i due selettori NON sono ridondanti in funzione — Box A guida `placeMUA` (Analizza), Box B guida la registrazione del source (Sostituire) — ma Box A era semplicemente nel posto sbagliato per via di un hide dimenticato in `selectWorkflow`.

Implementazione:
- Verifica preliminare: il bottone "+ Posiziona" (`startPlacement` → `placeMUA`) è `class="...analisi-only"` e `selectWorkflow` mostra i `.analisi-only` sia in `analizza` sia in `accoppia`, senza guardie `analysisMode` sul placement → `_ANALYZE_SBTYPE` è consumato in **entrambi**. Quindi il box va mostrato in `analizza` E `accoppia`.
- Fix additivo e centralizzato in `selectWorkflow` (~riga 4611, subito dopo le dichiarazioni dei pannelli, a valle dei `return` anticipati di vedere/wf-invalido/confirm-annullato): `var panSbType = document.getElementById('panelScanbodyType'); if(panSbType) panSbType.style.display = (wf === 'analizza' || wf === 'accoppia') ? '' : 'none';`. Un solo punto di verità, nessun ramo può più dimenticarlo.
- Box B e `placeMUA` non toccati. Solo frontend, nessun backend/API.
- Bump 8.4.4 → 8.4.5 (PATCH): `<title>`, `window.ANALIZZA_BUILD`, `registry.py` `BACKEND_VERSION` + voce History. Niente CACHEBUST.
- Commit `a9c11ce`. Deploy verificato live su entrambi i servizi (LEGACY canary → BACKEND): `backend_version=8.4.5`, `/analizzare` 200 con title `v8.4.5`, **check markup nell'HTML servito** (`getElementById('panelScanbodyType')` + ternary `analizza||accoppia` presenti), gating anonimo → 403.

---

## 2026-06-01 — 8.4.4: pulsante Reset persistente nell'header

Aggiunto un pulsante **Reset** nell'header di `backend/static/syntesis-analyzer-v3b.html`, tra il blocco File e il blocco WorkFlow. Dà all'utente un modo diretto e sempre visibile per ripartire con una nuova analisi da zero, senza passare da File → Nuovo. Cliccando, `hardReset()` ricarica l'applicazione con un cache-bust querystring (`?_r=Date.now()`); se c'è stato corrente da perdere (scansione caricata o MUA posizionati) chiede prima conferma. Affordance puramente frontend: nessun endpoint, API o logica backend toccata.

Implementazione:
- Markup `.btn` + SVG (freccia circolare blu `#0065B3`) subito dopo la chiusura di `.file-menu-wrapper`, prima di `.workflow-menu-wrapper` (~riga 1262 di v3b.html).
- `function hardReset()` accanto a `newCase()` (~riga 4218): `confirm()` condizionato su `scanMesh || muaObjects.length>0`, poi `window.location.replace` con `?_r=` timestamp.
- Version bump 8.4.3 → 8.4.4: `<title>`, `window.ANALIZZA_BUILD`(+`_DATE`), `registry.py` `BACKEND_VERSION`/`LAST_UPDATED` + voce History. Niente CACHEBUST (superfluo con `serviceInstanceDeploy latestCommit:true`).
- Commit `9ca5a68`. Deploy verificato live su entrambi i servizi (LEGACY canary → BACKEND): `backend_version=8.4.4`, `/analizzare` 200 con title `v8.4.4` e pulsante Reset presente nell'HTML servito, gating anonimo → 403.

Nota di processo: prima del deploy verificato che l'HTML servito agli utenti proviene dal file su disco via `FileResponse` (route `/analizzare`, `main.py:171`), non da una variabile inline. La variabile storica `_HTML_B64` (gzip+base64 estratto allo startup, introdotta nel commit `104d56b`) è stata rimossa in `06adfd7` (v7.3.4.001) e non esiste più: le modifiche al file `.html` su disco sono quindi servite direttamente, senza rigenerazione di blob inline.

---

## 2026-05-06 — 8.2.0: PROMOTION chiusura Fase A

Fase A formalmente chiusa. Refactor "centralizzazione costanti del dominio via registry + window.SYN" completato. Single source of truth per scanbody (1T3, OS, SR), soglie cliniche, palette colori e parametri ICP: `backend/registry.py`. Tutti i consumer (motore `icp_engine.py`, `pdf_gen.py`, frontend `v3b.html` via `window.SYN`) leggono dal registry con fallback canonico.

Promozione `8.1.13-A.5.2 → 8.2.0`: suffisso `-A.x.y` sparisce per regola schema versioning (Fase intera promossa = MINOR bump). Step chiusi: A.1, A.2, A.3, A.4, A.4.1, A.5.0, A.5.1, A.5.2 + chiusura debito su `icp_engine` (audit C15). A.6 originariamente prevista (estensione a `index.html` Hub e `syntesis-icp-replacer.html`) cancellata: `index.html` e' Hub navigazionale puro, `syntesis-icp-replacer.html` non esiste — la voce `/replacer v7.3.9.107` in STATO_SISTEMA era stale.

Stato Fase A architetturalmente: completa. Resta `syntesis-analyzer-lab.html` (3.87 MB, copia dev pre-A.5) come potenziale debito di pulizia, sospeso medio non bloccante.

---

## 2026-05-06 — 8.1.13-A.5.2: quick win cleanup (audit C3 C12 C15)

Batch di 3 fix dall'audit del codebase 2026-05-06, con allineamento del vocabolario angular ai d3 in registry.

**C12 (MEDIO) — `/api/me/projects/{id}/files` happy path restored.** L'endpoint ritornava `null` (return implicito) quando il progetto aveva un `gdrive_folder_id` configurato. Il blocco corretto (try gdrive.decrypt_token + service + list_folder) era stranded come dead code orfano dentro `_replicate_file_to_members` (avanzo merge, referenziava `creds`/`proj` non in scope). Spostato dentro `me_project_files` dopo l'early return su no-folder. Cancellato il dead code unreachable. Endpoint ora ritorna `{"files":[...], "folder_id":...}` sul happy path. Nessun consumer frontend al momento (verificato via grep), ma sblocca futura UI file-list.

**C3 (MEDIO) — Drive proxy size cap.** `/api/me/gdrive/file/{file_id}/content` materializzava in RAM tutti i bytes del file Drive prima di restituirli. Senza upper bound, un attaccante autenticato che caricava un file da GB nel proprio Drive poteva OOMare il worker uvicorn. Fix in due parti: (1) nuovo helper `gdrive.get_file_metadata(refresh_token, file_id) -> {id, name, mime_type, size}` che chiama l'API Drive solo per i metadata (1 round-trip, niente download); (2) nuovo `MAX_DRIVE_PROXY_BYTES = 100 MB` (env-overridable), check prima del download — raise 413 se eccede. Per Google Docs nativi `size` e' None e si lascia passare (sono testuali, raramente >100MB).

**C15 (MEDIO) — Chiude debito refactor Fase A su CLIN_LEVELS / CLIN_AXIS.** `icp_engine.py` aveva `CLIN_LEVELS` (soglie d3 in um + label + colori) e `CLIN_AXIS` (soglie angolari in deg + label) hardcoded inline, duplicando `registry.THRESHOLDS["d3_um"]`/`"angular_deg"` + `"d3_classes_it"`/`"angular_classes_it"` + `PALETTE["d3_hex"]`. Drift garantito: cambio in registry → frontend riceve nuovi valori via `/api/registry/constants`, ma motore ICP backend continuava sui vecchi.

Refactor: nuovi `_build_clin_levels()` e `_build_clin_axis()` derivano gli array da registry quando l'import e' andato a buon fine, fallback canonico altrimenti. Shape preservata (lista di dict con `max`/`label`/`col`), tutti i consumer di `CLIN_LEVELS[i]["max"]` etc. invariati. Esteso l'import di `registry` per includere `PALETTE` (prima solo `THRESHOLDS["max_tris_oom"]`).

**Allineamento vocabolario** (premessa al refactor C15): `registry.THRESHOLDS["angular_classes_it"][-1]` era `"Fuori"`, mentre `d3_classes_it[-1]` era `"Fuori posizione"`. Asimmetria probabilmente non voluta (commit di A.5.0 quando angular thresholds furono aggiunte). Allineato a `"Fuori posizione"` ovunque. Verificato che nessun frontend cerca le stringhe come literal — quindi cambio safe.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase A aperta), suffisso `-A.5.2` mantenuto. Status Fase A: A.5.x sub-step chiusi, debito Fase A su CLIN_LEVELS/CLIN_AXIS chiuso. Resta A.6 (estensione pattern window.SYN/registry a index.html Hub e syntesis-icp-replacer.html) prima della promozione 8.2.0.

---

## 2026-05-06 — 8.1.12-A.5.2: code health batch (audit C2 C6 C7 C8 C13)

Batch di 5 fix dall'audit del codebase 2026-05-06, raccolti in un singolo commit. Tutti rerated MEDIO/BASSO post-verifica rigorosa, ma chiusi insieme per pulizia.

**C7 (BASSO) — JWT error generic in main.py.** `/auth/gdrive/connect` esponeva `f"Token JWT non valido: {e}"` interpolando il messaggio dell'eccezione pyjwt. Cambio in `"Token non valido."` senza interpolazione. Il broad `except Exception` resta, ma niente leak del motivo specifico (signature mismatch, expired, malformed).

**C13 (BASSO) — CORS allow_methods esteso.** Aggiunti `PATCH`, `DELETE`, `OPTIONS` ai metodi consentiti dal middleware CORS in main.py r.104. Necessari per gli endpoint @app.patch / @app.delete (gia' usati su /api/me/projects, /contacts, /folders) quando un client cross-origin chiama l'API. Oggi frontend e backend sono same-origin in produzione, quindi nessun bug visibile, ma sblocca l'eventuale frontend separato (Fase 1 SaaS) e gli usi cross-origin in dev.

**C6 (MEDIO) — MAX_PLACE_MUA_TRIS cap + run_in_executor.** I due endpoint `/api/place-mua` e `/api/place-mua-lab` (entrambi richiedono auth) ricevono `scan_crop_tris: list` senza upper bound: un client autenticato malicious poteva mandare milioni di triangoli e saturare RAM/CPU del worker. Il workload numpy CPU-bound girava inline nell'event loop senza timeout, bloccando il worker. Fix in due parti: (1) nuovo `MAX_PLACE_MUA_TRIS = 200000` (env-overridable), check 413 se superato; (2) chiamata a `align_template_to_marker(...)` wrapping in `asyncio.wait_for(loop.run_in_executor(None, lambda: ...), timeout=ICP_TIMEOUT_SECONDS)` con catch su `asyncio.TimeoutError -> 504`, stesso pattern di `/api/analyze`.

**C2 (MEDIO) — Drive proxy hardening.** L'endpoint `/api/me/gdrive/file/{file_id}/content` settava `Content-Disposition: inline; filename="{name}"` con `name` arbitrario dal Drive dell'utente. Pre-condizione perche' diventi critico: condivisione folder cross-utente attiva (gia' implementata in `_replicate_file_to_members`). Fix preventivo: (1) sanitizzazione filename (strip `\r\n` + sostituzione `"` con `'`); (2) `Content-Disposition: attachment` forzato per MIME non `image/*` o `video/*` (HTML/SVG/PDF caricati per XSS vengono scaricati invece che eseguiti inline nell'origin); (3) header `X-Content-Type-Options: nosniff` per bloccare lo sniffing MIME del browser.

**C8 (MEDIO) — Cleanup 5x dead def fresClearAllArrows + 5x fresBuildAllArrows in v3b.html.** Le due funzioni avevano 6 ridefinizioni ravvicinate ognuna (~r.5029-5234). Solo l'ultima vince per hoisting JS, le 5 precedenti sono dead code. Hash dei corpi: 4 versioni distinte di Clear, 2 di Build (la maggior parte erano copie identiche). Rimosse 206 righe; resta 1 sola def per nome (verificato con grep: count 1+1). Niente impatto runtime (comportamento gia' dato dalla 6a versione), ma evita confusione futura per chi cerca da dove modificare.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase A aperta), suffisso `-A.5.2` mantenuto.

---

## 2026-05-06 — 8.1.11-A.5.2: fix run_icp ritorna rmsd corretto (audit C9)

Sprint 1 audit. `backend/icp_engine.py:run_icp()` ritornava `prev_rmsd` invece di `rmsd` post-convergenza: quando il loop ICP si interrompe per convergenza all'iter K, `prev_rmsd` contiene il valore dell'iter K-1 (non K). Inoltre se `max_iter=0` (caso degenere), la variabile `rmsd` non era mai definita prima del return — `NameError` runtime.

Cosa cambia:
- Aggiunta inizializzazione `rmsd = float("inf")` accanto a `prev_rmsd` (default per max_iter=0).
- Return cambia da `"rmsd": prev_rmsd` a `"rmsd": rmsd` — la variabile dell'iter corrente, sempre definita post-loop.

Impatto runtime:
- Delta numerico ≤ 1e-9 mm (la condizione di break impone questa precisione). Sotto la precisione visualizzata nei report PDF (4 decimali, ≈ 0.1 um).
- Due call site verificati (r.1521, r.1846): nessuno rompe per il fix. Il consumer a r.1847 usa rmsd come criterio di ordinamento per spin search; l'ordinamento relativo era preservato dal bug, lo resta col fix.
- Edge case `max_iter=0` ora ritorna `inf` invece di lanciare `NameError`; rilevante solo in contesti degeneri.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase A aperta), suffisso `-A.5.2` mantenuto.

---

## 2026-05-06 — 8.1.10-A.5.2: fix typo bbox OS in registry

Fix di un typo di lunga data in `backend/registry.py` r.79: `SCANBODY["OS"]["bbox_xyz_mm"]` era `[3.56, 5.56, 1.10]`, corretto a `[3.56, 3.56, 1.10]`. Lo scanbody OS e' un cilindro: x = y per definizione geometrica della cap CAD. Il valore Y=5.56 era incoerente con CLAUDE.md §6 (tabella scanbody, "OS: 3.56x3.56x1.10") e con la fisica del template. Verificato sul file STL reale.

Origine: emerso durante l'audit del codebase (2026-05-06). Probabile typo introdotto al primo populate del registry in A.2 (commit 85ca7e8, 2026-05-02). Nessun consumer attualmente legge `bbox_xyz_mm` per calcoli quantitativi, quindi l'impatto a runtime e' nullo - ma il valore esposto via `/api/registry/constants` ai frontend era sbagliato e poteva guidare male qualunque codice che facesse sanity check sulla geometria scanbody.

Versionamento: regola 4 (build bump per fix non-refactor durante Fase aperta), suffisso `-A.5.2` mantenuto.

---

## 2026-05-06 — 8.1.9-A.5.2: SOSTITUIRE_TEMPLATE_INFO e TPL_ORDER da window.SYN, SR a #0052A3 ovunque

Chiusura step A.5.2 della Fase A (refactor centralizzazione costanti via `window.SYN`). Stesso pattern di A.5.1: i consumer del frontend leggono da `window.SYN.scanbody` con fallback canonico allineato al registry.

Cosa cambia:
- `SOSTITUIRE_TEMPLATE_INFO` (in `backend/static/syntesis-analyzer-v3b.html`, prima del refactor a r.14881): trasformato da oggetto literal a IIFE che parte dal fallback canonico e sovrascrive `radius`/`color` con i valori di `window.SYN.scanbody.<key>` quando disponibili. `label` e `zDisc` restano locali (UI string + dato clinico, non vivono nel bootstrap window.SYN). Tutti i 9 consumer del frontend (r.15220, 15262, 15459, 15511, 15534, 15539, 16173, 16506, 16627) restano invariati.
- `TPL_ORDER` (prima del refactor a r.16276, scope locale dentro la closure di render albero scena): derivato da `SOSTITUIRE_TEMPLATE_INFO` invece che hardcoded. Single source of truth, conversione `int -> CSS hex string` inline.
- Allineamento SR a `#0052A3` ovunque: nel fallback canonico di `SOSTITUIRE_TEMPLATE_INFO` (era `0x0065B3`), in `TPL_ORDER` (era `#0065B3`), nello swatch del radio "SR" del selettore Sostituire-source (era `#0065B3`), nella CSS custom property `--syn-marker-sr` (era `#0065B3`).

Decisioni:
- `#0065B3` resta la `--blue` UI canonica (definita a inizio CSS) per tutti gli elementi interattivi non-SR (badge, icone SVG, swatch generici, palette MUA, ecc.). Solo i punti SR-specifici sono stati allineati al brand `#0052A3`.
- Nessun consumer di `SOSTITUIRE_TEMPLATE_INFO` legge `info.zDisc` come campo (verificato con `grep "\.zDisc\b"` = 0 match): `zDisc` resta solo come metadata clinico documentale.

Versionamento: regola 2 dello schema (build + step bump nella stessa Fase) `8.1.8-A.5.1` -> `8.1.9-A.5.2`. Fase A resta aperta: prossimo step A.6 (estensione del pattern a `index.html` Hub e `syntesis-icp-replacer.html`).



Aggiunta nuova pagina interpretativa nel report clinico jsPDF (`misICP_renderClinicalPDF` in `backend/static/syntesis-analyzer-v3b.html`), inserita tra "Note metodologiche" (pag. 2) e "Glossario e soglie cliniche" (pag. 3, ora pag. 4).

Cosa fa:
- Spiega la diversa pesatura diagnostica dei quattro componenti di scostamento (X, Y, Z, angolari).
- Sotto-sezione "Piano XY": gli scostamenti laterali ammettono una quota interpretativa per via dello scarico del cono interno alla struttura fresata.
- Sotto-sezione "Asse Z e valori angolari": vincoli geometrici rigidi, nessun gioco di interfaccia, indicatori puri della qualita' produttiva.
- Schema illustrativo: sezione dell'accoppiamento cono MUA-struttura fresata (PNG 1800x1323 pre-rasterizzato dall'SVG sorgente).

Implementazione:
- Nuova funzione `misICP_pdfDrawValuesGuidePage(doc)` (~80 righe, stesso pattern di header/body delle altre pagine doc).
- Asset statici in `backend/static/assets/`:
  - `scarico_cono_mua_v4.svg` (sorgente, 6.3 KB)
  - `scarico_cono_mua_v4.png` (rasterizzato 1800x1323, 154 KB)
- PNG precaricato come `Image()` al boot per evitare race condition al click "Genera report".
- `docPages` da 2 a 3 in `misICP_renderClinicalPDF`. Numerazione pagine cilindri/coppie auto-corretta.
- Fallback grafico (rect grigio + label "[schema in caricamento]") se l'immagine non e' ancora pronta.

Decisioni architetturali:
- PNG pre-rasterizzato e committato. Niente cairosvg + system libs Cairo nel Dockerfile + endpoint backend + cache: lo schema e' statico (non cambia per record), tutto il pipeline lato runtime sarebbe sovradimensionato.
- Versione `8.1.8-A.5.1` (build bump nello stesso step A.5.1) anziche' `8.1.8` plain: Fase A e' ancora aperta (A.5.2 e A.6 da chiudere), il suffisso resta.

Verifica end-to-end attesa:
- Pagina "Lettura dei valori" presente tra pag. 2 e pag. 3.
- Schema renderizzato nitido.
- Numero totale pagine = 19 (era 18) sul caso di test 001422_modificato3 vs 001422_modificato2.
- `/api/registry/constants` risponde con `backend_version: 8.1.8-A.5.1` su entrambi i domini Railway.
