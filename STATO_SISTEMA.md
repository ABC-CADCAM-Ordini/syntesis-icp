# Syntesis-ICP — Stato sistema

> Snapshot corrente. Aggiornare dopo ogni fase chiusa.

## Versione live (2026-06-09, 8.13.0 — **motore asse lateral-wall robusto**: Raffina (`sostAlignAll`) deriva l'asse dalla parete scansionata invece che dalla rotazione del point-ICP + report Misurare (`misICP_cylAxis`) raffina dalla parete; chiude il gap angolare con Exocad (incoerenza export scan-to-scan **0.95°→0.14-0.31°**). Base 8.12.1 Raffina idempotente; 8.12.0 panel/UI infra `ds/syn-panel.js`; 8.11.0 clip engine `ds/syn-clip.js`; r169 via `ds/syn-render.js`)

| Componente | Versione |
|---|---|
| Backend principale (b7671e12) | 8.13.0 (live, commit `38cda88` del 2026-06-09, deploy `5ce821a7`) |
| Legacy syntesis-icp (7ac922ce) | 8.13.0 (live, commit `38cda88` del 2026-06-09, deploy `ce9ace7a`) |
| / (home pubblica, 8.6.4) | `synthesis-home.html` — splash **dark** (`--dark #0F1923`): cornice perimetrale animata **cava** (`.synt-frame` via `mask`, fixed, `pointer-events:none`), logo bianco (invert), hero (headline + immagine crop in card chiara) + 4 tool-card. **Layout 16:9 "una schermata"** (8.6.2): `.viewport` inset:22px dentro la cornice + misure `vh`/`clamp` → tutto in `100vh` senza scroll; su desktop bassi compressione mirata (8.6.3, `@media max-height:900` + `overflow:hidden`); mobile verticale con scroll dentro la cornice. Sostituisce il redirect 302 a /vedere (fallback) |
| /analizzare | v8.13.0 (**asse lateral-wall robusto** Sostituire/Misurare [8.13.0]; **motori r169 via fonte unica** `ds/syn-render.js`, retrofit a comportamento invariato Δ0; **resa colore corretta**: `ColorManagement ON` → colori fedeli al colore scelto, non più bruciati/virati al giallo; luci al rapporto r128 **1.2/1.8/0.75** + sfondo gradiente sRGB; include pannello **Taglio** 8.8.0 — **motore clip in `ds/syn-clip.js`** (8.11.0) + **panel/UI infra in `ds/syn-panel.js`** (8.12.0, relocazione in-place verbatim), comportamento INVARIATO via gate — + base r169 8.7.x) — il "vedere dentro" è pilotato dal pannello **Taglio** (`#btnOpenTaglio`, 4 controlli: taglio attivo / asse X-Y-Z / posizione / inverti); convivenza "opacità comanda"; reader `?wf=`; export STL Sostituire con dialog nome file; gate accesso attivo. **Color picker per-oggetto** in tutti gli alberi scena (8.9.0, gestione unica `setSceneObjectColor`). _Follow-up aperti: ombre di contatto AO (#6) + persistenza colori "apri caso" (#7) — vedi Sospesi._ |
| /accedi | **logo brand bianco** (8.10.1: `<img src="/static/synthesis-logo.png">` reso bianco via `filter:invert`, al posto del wordmark testo "Syntesis ICP"; corregge anche "Syntesis"→"Synthesis"). Ritorno al deep-link dopo login (consuma `sessionStorage.syn_after_login`; fallback /vedere) — 8.5.0 |
| /vedere | v8.0.0-refactor (**r169 dal 8.10.0**: loader importmap+bridge, init differito a three-ready, addon jsm Trackball/Transform[getHelper]/OBJ/PLY, clip/stencil+PiP; **color picker nativo** `setSceneObjectColor`; **reticolo "Entrambi"** uniformato a /analizzare WireframeGeometry nero 0.35; colore Δ0 vs /analizzare) — fix primo-click `#btnPick` (8.4.8). Non più target del redirect `/` (ora home), resta servito e fallback |
| /dashboard | preview STL **r169 dal 8.10.0** (`import('three')` dinamico lazy + `applyRendererPipeline`); fix bug `async` orfano pre-esistente (riga ~3585). Zero r128 residuo nel codebase |
| Design system | introdotto in 8.3.0, attivo in prod dal 8.3.1, pilota su /vedere |

> 8.3.3 fix cutview opacità 100% **confermato risolto a freddo dopo verifica con cache pulita** (2026-05-08). Il fix slider (`material.transparent = true` forzato in /vedere) risolve davvero: ripristina il queue ordering corretto fra layer mesh, stencil meshes e cap plane. Le diagnosi 8.3.4 (angolo camera) e 8.3.5 (collisione cromatica) erano artefatti di test su browser cache stale che continuava a servire 8.3.1. Ticket archiviato in MASTER_DOC §B.8 (CHIUSO). Lezione di processo aggiunta a MASTER_DOC §A.6.2: cache busting esplicito (Cmd+Shift+R o `?v=$(date +%s)`) prima di ogni verifica visiva post-deploy. 8.3.4-5-6 sono doc patch (registry version trail), non deployati.

> **Incident 2026-05-20 → 2026-05-21**: backend+legacy giù per Postgres in sleep/freeze, ripristinati con sequenza postgres → backend → legacy via `serviceInstanceDeploy latestCommit:true` + warm-up 45s. Vedi sezione dedicata sotto.

> Voce `/replacer v7.3.9.107` rimossa il 2026-05-06: era stale, riferimento a un frontend obsoleto / mai integrato (la route `/replacer` non esiste in `main.py` e il file `syntesis-icp-replacer.html` non e' mai esistito in `backend/static/`).

> Cleanup 2026-05-08 (8.2.1): rimosso `backend/static/syntesis-statistiche-v7.4.0.001.html` (146KB, 1089 righe). Era dead code: zero referenze nel repo (CI, scripts, Dockerfile, href HTML, .py); sostituito da `v7.4.0.002` servito su `/statistiche`.

> DS introdotto pilota /vedere (8.3.0/8.3.1, 2026-05-08): `backend/static/ds/tokens.css` e `backend/static/ds/components.css` come fonte unica per token visuali e classi `.syn-*`. Pilota su Vedere migra `.header` (proprieta' di pattern bar) e bottone btnPick "Aggiungi file" (da outline a primary CTA). Replica su Dashboard e v3b a tappe nelle prossime sessioni.

## 8.13.0 — motore asse "lateral-wall" robusto (Sostituire + Misurare) (LIVE su entrambi i servizi + custom domain) (2026-06-09)

Chiude il gap angolare con **Exocad** sul fit dell'asse cilindro. Root dimostrato sui dati reali (barra ID 2161): l'errore è nella **stima dell'asse**, NON nell'allineamento ICP (centroidi/RMSD ottimi, è l'asse a sballare).

- **FIX #1 (report Misurare ICP)** — `misICP_cylAxis` (v3b ~6303): con `syntesis_axis_engine='lateralwall'` l'asse viene raffinato dalla **parete laterale** (minor eigenvector di M=Σ area·nnᵀ sui triangoli con |n·seed|<0.35, via `misICP_jacobi3`); fallback al seed cap-PCA se <8 laterali; default `'cap'` **bit-identico**. Il cap-PCA aveva **~1.2° di errore strutturale** sullo scanbody SR (tozzo, un cap + base aperta), misurato sul marker ideale.
- **FIX #2 (coupling Sostituire, il root)** — `sostAlignAll`/Raffina (v3b ~15741 crop loop + ~15908 apply block): il point-ICP resta SOLO per il **centraggio** (R,t invariati); l'**asse** finale viene da un fit lateral-wall della parete scansionata e ri-orienta il marker attorno a `p.position` (delta-rotazione `T(+pos)·Rd·T(-pos)` propagata a `g.matrix`→export); fallback `R·seed` se <8 triangoli parete. Prima il Raffina **sovrascriveva** l'asse buono col rumore del point-ICP (~1° non-rigido).

**Verifica su click utente reali** (mock, codice vero via preview, scansioni barra ID 2161):
- degrado angoli relativi del Raffina **0.66°→0.13° (−81%)**, max 2.4°→0.27° (−89%);
- incoerenza export **scan-to-scan** (prima vs seconda) **0.95°→0.14–0.31° = Exocad** (0.14°);
- centraggio invariato (RMSD 0.11–0.14 mm).

Design + verifica avversariale 4-lensi su entrambe le patch; `node --check` PASS; gate sintassi inline OK. Bump 8.12.1→8.13.0 (registry + v3b `<title>`/`ANALIZZA_BUILD`). `docs/MAPPA_FUNZIONALE.md` aggiornata (`sostAlignAll`/`onAxisEngineChange`/`misICP_cylAxis`). **Rischio residuo**: la guardia `wallN>=8` conta i triangoli, non lo spread angolare delle normali (stesso limite del motore di placement già in prod) — monitorare su pareti quasi-planari.

**DEPLOYATO LIVE** il 2026-06-09 (canary **LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`, commit `38cda88`): LEGACY `7ac922ce` deploy `ce9ace7a`, BACKEND `b7671e12` deploy `5ce821a7`. **Verifica live (curl -sL):** `backend_version=8.13.0` + `<title>`/`ANALIZZA_BUILD` `8.13.0` + `/analizzare` 200 + gating (no auth) `/api/me/profile` & `/api/leaderboard` → 403, su BACKEND + LEGACY + `app.syntesis-icp.com` (alias risponde senza errori SSL).

## 8.12.1 — fix Raffina idempotente a convergenza (Sostituire) (LIVE su entrambi i servizi + custom domain) (2026-06-08)

Guard di **idempotenza** nel **Raffina** del workflow **Sostituire** (`sostAlignAll`): nel `forEach` per-marker, dopo il loop ICP e prima di applicare la matrice rigida `Rm`, se la trasformazione **TOTALE** accumulata (`R=Racc`, `t=tAcc`) è sotto soglia di rigidità (**rotazione < 0.01°** e **traslazione < 1 µm = 0.001 mm**) il marker è già a convergenza → `return` (no-op), posa invariata. Risolve il **micro-drift ~µm a ogni Raffina ripetuto** su scan rumorosi (prima `Racc`/`tAcc` non erano mai esattamente identità); i marker non ancora convergenti continuano a rifinirsi normalmente. Il `return` precede `nRefined++` → i convergenti non vengono contati in "Raffinamento completato (N/M)". ICP/pesi/crop/accumulo INVARIATI. **Gate visivo su scan reali OK** (Raffina ×2/×3 non muove i marker). Fix in v3b `sostAlignAll` ~15750 (commit `e6b402a`); bump PATCH 8.12.0→8.12.1 (registry + v3b `<title>`/`ANALIZZA_BUILD`, commit `e6e5fca`). `docs/MAPPA_FUNZIONALE.md` riallineata (drift righe regione Sostituire + shift guard).

**DEPLOYATO LIVE** il 2026-06-08 (canary **LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`): LEGACY `7ac922ce` deploy `14f08c96`, BACKEND `b7671e12` deploy `cbb4550b`. **Verifica live (curl -sL):** `backend_version=8.12.1` + `<title>`/`ANALIZZA_BUILD` `8.12.1` su BACKEND + LEGACY + `app.syntesis-icp.com`.

## 8.12.0 — estrazione panel/UI infra /analizzare in modulo ds/syn-panel.js (LIVE su entrambi i servizi + custom domain) (2026-06-05)

2° modulo della campagna di modularizzazione del monolite. La **panel/UI infra** di /analizzare (pannelli drag/resize, persistenza view-state, rail colonna destra, view-menu, tooltip `data-tip`, helper carica-file) estratta dal blocco `<script>` inline di fine body (v3b ex 17062-17766, 703 righe) nel modulo **`backend/static/ds/syn-panel.js`**. **Meccanismo diverso da clip**: **relocazione in-place verbatim** (classic non-strict) — `<script src>` al posto dell'inline **alla stessa riga** → timing identico (readyState, DOMContentLoaded/setTimeout, ordine vs script monolite); **zero modifiche al codice**; le funzioni globali restano globali per gli handler inline del markup (invariato). Diff v3b: +1 (`<script src>`) / −705 (blocco). Nessun link cross-modulo; localStorage chiavi proprie `syntesis_panel_*`/`syntesis_analizza_view`/`_rail`.

**Gate di equivalenza** (`scripts/gate/panel`, **browser reale** via preview, harness DOM A/B): G0 byte-identità + G1 esposizioni (16/16) + G2 view-state + G3 rail + G4 view-menu + G6 tooltip → old(inline) ≡ new(modulo), **diff 0, zero errori console**. `node --check` OK su tutti i blocchi. Il gate browser ha **esposto una fragilità PRE-ESISTENTE verbatim** (`syntesisRefreshLoadFileButton` ~riga 293: `… && scanMesh` bare ref) — **innocua in produzione** (`scanMesh` dichiarato in script #4 che gira prima del blocco), NON introdotta dall'estrazione; un gate G0-only non l'avrebbe vista. Bump 8.12.0 (registry + v3b `<title>`/`ANALIZZA_BUILD`); `docs/MAPPA_FUNZIONALE.md` handler panel → `ds/syn-panel.js`. Branch `refactor-extract-panel-ui`, merge no-ff `4599fa3`.

**DEPLOYATO LIVE** il 2026-06-05 (canary **LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`): LEGACY `7ac922ce` deploy `3460aa19`, BACKEND `b7671e12` deploy `d782e8fa`. **Verifica live (curl -sL):** `backend_version=8.12.0` + `ANALIZZA_BUILD 8.12.0` + **`/static/ds/syn-panel.js` 200 (27038 byte)** + `/analizzare` 200 + gating `/api/me/storage` → 403, su BACKEND + LEGACY + `app.syntesis-icp.com`.

## 8.11.0 — estrazione clip engine /analizzare in modulo ds/syn-clip.js (LIVE su entrambi i servizi + custom domain) (2026-06-05)

Primo modulo della **campagna di modularizzazione** del monolite `syntesis-analyzer-v3b.html`. Il **clip engine** di /analizzare (clipping plane + stencil cap "vedere dentro" + pannello "Taglio") estratto dal monolite (ex righe 2574-2717, 144 righe) nel modulo **`backend/static/ds/syn-clip.js`** (`<script src>` classico, stile `syn-render.js`/`syn-gate.js`; parse-safe: legge `window.THREE` solo a call-time dopo `three-ready`). **Meccanismo**: stato su `window.synClip*` + funzioni ri-esposte coi nomi bare → i call-site del monolite (`loadScanFile`, `rebuildScanMeshGeometry`, la regola "opacità comanda" `treeUnified_setScanOpacity`/`ghostAll` che scrivono `synClipEnabled`, gli handler inline `#panelTaglio`) restano **INVARIATI**. Diff v3b: +1 (`<script src>`) / −144 (blocco). **Motore INVARIATO.**

**Gate di equivalenza** (`scripts/gate/clip`, harness Node A/B con THREE reale headless, scanMesh sintetica): G1 numerico/strutturale (piano normale/const, centro/diag, stencil group, cap pos/quat/material) + G2 DOM pannello → golden(verbatim) ≡ after(modulo), **0 scostamenti a precisione piena** (Object.is). `node --check` OK su tutti gli 8 `<script>` inline del monolite. Bump 8.11.0 (registry + v3b `<title>`/`ANALIZZA_BUILD`); `docs/MAPPA_FUNZIONALE.md` sezione Taglio → sorgente `ds/syn-clip.js`. Infra: gate template riusabile in `scripts/gate/`. Branch `refactor-extract-clip-engine`, merge no-ff `5185d54`.

**DEPLOYATO LIVE** il 2026-06-05 (canary **LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`): LEGACY `7ac922ce` deploy `681d90ca`, BACKEND `b7671e12` deploy `482ba95c`. **Verifica live (curl -sL):** `backend_version=8.11.0` + `<title>`/`ANALIZZA_BUILD` `8.11.0` + **`/static/ds/syn-clip.js` 200 (11526 byte)** + gating `/api/me/storage` → 403, su BACKEND + LEGACY + `app.syntesis-icp.com`.

## 8.10.1 — logo brand bianco su /accedi (LIVE su entrambi i servizi + custom domain) (2026-06-04)

Fix UI sulla pagina di login `/accedi`: il logo in alto a sinistra passa dal wordmark testuale "Syntesis ICP" al **logo brand reale** `/static/synthesis-logo.png` (lo stesso usato in home + header del software), reso **bianco** sul pannello scuro via `filter:invert(1) brightness(1.9)`, altezza 66px. Corregge anche l'incoerenza "**Syntesis**" (senza-h) del testo → branding corretto "**Synthesis**". Solo `syntesis-accedi.html` (markup `.brand` + CSS `.brand-logo`). **Bump solo `registry.BACKEND_VERSION` 8.10.0→8.10.1** (PATCH): v3b `<title>`/`ANALIZZA_BUILD` e `pdf_gen` NON toccati → restano 8.10.0 (cambio non-v3b, come pattern 8.6.4 home-only). Branch `fix-accedi-logo`, merge no-ff `786501e`, bump `fd2ebeb`. **DEPLOYATO LIVE** il 2026-06-04 (canary LEGACY→BACKEND): LEGACY deploy `16b911af`, BACKEND deploy `0e4d724b`. **Verifica live (curl -sL):** `backend_version=8.10.1` su BACKEND + LEGACY + `app.syntesis-icp.com`, `/accedi` 200 + logo brand servito (height 66px); `/analizzare` title resta `v8.10.0` (v3b non ribumpato, atteso).

## 8.10.0 — allineamento motori rendering r169 (tutte le superfici 3D) + color picker /vedere + reticolo (LIVE su entrambi i servizi + custom domain) (2026-06-04)

Tutte le superfici 3D portate a Three.js **r169** con la stessa pipeline, via la **fonte unica** `backend/static/ds/syn-render.js` (`applyRendererPipeline` = CM ON + SRGBColorSpace + NoToneMapping + localClipping; `addCameraLightRig` = Ambient 1.2 / key 1.8 / fill 0.75; `makeGradientTexture` sRGB). Catena `feat-render-core`→`dev-three-vedere`→`dev-three-dashboard`→`feat-color-picker-vedere`→`fix-reticolo-vedere`, **mergiata no-ff** in main (`fb77cbf`), bump `b78fa8a`. **DEPLOYATO LIVE su entrambi i servizi** il 2026-06-04 (canary **LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`): LEGACY 7ac922ce deploy `2dcf031c`, BACKEND b7671e12 deploy `bfcfe7be`. **Verifica live (curl -sL):** `backend_version=8.10.0` su BACKEND + LEGACY + `app.syntesis-icp.com`; `<title> v8.10.0`; `/`, `/analizzare`, `/vedere`, `/dashboard` tutte 200; gating `/api/me/storage` → 403; `/vedere` importmap r169 + `/dashboard` `import('three')` + **zero r128 residuo** nel codebase.

- **F1**: estratto il core `ds/syn-render.js` + retrofit /analizzare a comportamento **INVARIATO** (gate pixel: diffPixels 0/262144, scanMeanLum/tint/contrast identici; il colore approvato 8.8.1 non si muove di un pixel).
- **F2** /vedere r128→r169: loader importmap+bridge `window.THREE`, init eager→differito a `three-ready`; addon jsm (TrackballControls, **TransformControls** con `scene.add(getHelper())` per il breaking r163, OBJLoader, PLYLoader); clip/stencil sezione+PiP riconciliati. Colore **Δ=0** vs /analizzare a parità di input.
- **F3** /dashboard preview STL r128→r169 (`import('three')` dinamico lazy + `applyRendererPipeline`).
- **Fix** bug `async` orfano pre-esistente /dashboard (ReferenceError a ogni load, interrompeva l'init top-level a valle: var/setInterval/keydown ora eseguono).
- **Color picker /vedere** nativo (`<input type="color" class="tree-color">` + `setSceneObjectColor` copiato; vertex-color/highlight Vedere preservati).
- **Reticolo "Entrambi" /vedere** uniformato a /analizzare (WireframeGeometry+LineSegments nero 0.35).
- Misurare ICP + Sostituire erano già r169 (workflow dentro /analizzare). Verifica visiva utente OK su /vedere. /vedere resta tag `v8.0.0-refactor` (architetturale). Bump registry/v3b/pdf_gen + MAPPA versione mappata 8.10.0.
- _Follow-up aperti: issue #2 barra vista globale (solido/reticolo/entrambi) su /vedere — rimandata. Dead code orfano da cleanup dedicato: /vedere `changeObjectColor` + handler 'color' + popup `#colorPop`; /dashboard popup `#colorPop`._

## 8.9.0 — color picker per-oggetto negli alberi scena (LIVE su entrambi i servizi + custom domain) (2026-06-03)

Feature: nei **3 alberi scena** ogni oggetto ha un selettore colore (il pallino diventa `<input type="color" class="tree-color">`), per modificare i colori assegnati on-the-fly. **DEPLOYATO LIVE su entrambi i servizi** il 2026-06-03 (merge no-ff `37a99f7`, commit feature `503d8f7`; canary LEGACY 7ac922ce deploy `cb67bb38` → BACKEND b7671e12 deploy `5ff3216d`). **Verifica live (curl -sL):** `backend_version=8.9.0` su BACKEND + LEGACY + `app.syntesis-icp.com`, `/analizzare` 200, gating `/api/me/storage` → 403.

- **Gestione UNICA** `setSceneObjectColor(target, hex)` + helper `__synApplyColor` (applica il colore a mesh/array/group THREE in modo uniforme): **stesso meccanismo per tutti gli alberi**, dispatch sul `target`. Le 4 funzioni ad-hoc iniziali (setLayerColor / misICP_setLayerColor / sostSetScanColor / sostSetTemplateColor) sono state **rimosse e consolidate**.
- **/analizzare** (`rebuildTree`): `setSceneObjectColor('scan')` → `scanMesh.material.color` + `envSettings.scanColor` (il pallino ora mostra il colore reale, prima era grigio fisso); `setSceneObjectColor('mua:'+idx)` → `m.color` + connessione `mtMesh` / analogo `anMesh` / asse `axisLine`. **Un colore per MUA**; lo **scanbody mantiene il colore-brand del tipo** (1T3 ambra / OS verde / SR blu = codice clinico, non sovrascritto).
- **Misurare ICP** (HTML statico): `setSceneObjectColor('icp:'+group)` sui **4 layer** bgA/scbA/bgB/scbB (`misICP_groupMeshes`; storage `misICP_layerColors`).
- **Sostituire** (`sostRebuildTree`): `setSceneObjectColor('sostscan')` (Multi-A) + `setSceneObjectColor('sosttype:'+key)` **per tipo marker** 1T3/SR/OS (ricolora i gruppi `sostPlaced` + `SOSTITUIRE_TEMPLATE_INFO`).
- **Verifica** (mock): /analizzare verificato a fondo (picker scansione+MUA applicano al material); ICP/Sostituire verificati in modo leggero (picker presenti, funzioni non lanciano — logica identica a /analizzare). `node --check` OK.
- **PERSISTENZA**: i colori vivono nello stato della scena ma **non sopravvivono al refresh** — il salvataggio/ripristino "nel caso" è demandato al **progetto dedicato "apri caso"** (vedi Sospesi #7): oggi il viewer NON ricarica un caso salvato (`saveCase`/`exportCase` sono export JSON, nessun load).
- Bump 8.8.1 → 8.9.0 (MINOR): `registry.BACKEND_VERSION`, v3b `<title>`+`ANALIZZA_BUILD`, `pdf_gen.py VERSION`.

## 8.8.1 — fix resa colore /analizzare: ColorManagement ON + ri-taratura luci r128 + sfondo sRGB (LIVE su entrambi i servizi + custom domain) (2026-06-03)

Fix di **resa colore** della pipeline r169 (3 cause indipendenti), su segnalazione utente "colori strani / poco tridimensionale / sfondo bruciato". **DEPLOYATO LIVE su entrambi i servizi** il 2026-06-03 (merge no-ff `236d49c`, commit feature `cf08ca7`; sequenza **canary LEGACY → BACKEND**: LEGACY 7ac922ce deploy `7b1b6642`, BACKEND b7671e12 deploy `0c37cd8d`). **Verifica live (curl -sL):** `backend_version=8.8.1` su BACKEND + LEGACY + `app.syntesis-icp.com`, `/analizzare` 200, gating `/api/me/storage` → 403.

- **Viraggio tinta verso il giallo/chiaro** → `ColorManagement.enabled = true` (era `false` da 8.7.0). Con CM off i colori sRGB del materiale **non** venivano decodificati in lineare in input, ma l'output era encodato sRGB (pipeline asimmetrica) → `scanColor #fb883c` reso con R/G 1.43 invece di 1.85. CM on = pipeline coerente (decode in input, encode in output) → **R/G 1.43 → 1.88** (= colore scelto). Vale per scanColor, MUA, sfondo.
- **Poca tridimensionalità/contrasto** → ri-taratura luci. 8.8.0 aveva gonfiato l'**ambient** (0.4→1.3) per la luminosità, appiattendo il chiaroscuro (std ~8). Ripristinato il **rapporto r128** `0.4:0.6:0.25` scalato ×3 → **Ambient 1.2 / key 1.8 / fill bluastra 0.75**. Contrasto **std ~8 → ~13**. Il rapporto direzionale:ambient = 1.5 è il limite oltre cui lo specular bianco lava la tinta (perciò non si può alzare di più la direzionale).
- **Sfondo schiarito/bruciato** → `makeGradientTexture`: aggiunto `tex.colorSpace = SRGBColorSpace` (la `CanvasTexture` sRGB era letta come lineare con CM on). Ora sfondo fedele al colore scelto (`#438DD6` reso `67,141,214`).
- **Verifica** (mock, scan SR reale 002140_Ds1, solid/clip off/camera fissa): scanMeanLum ~133, clip 0; scan + MUA 1T3 (#FFAA44, caso peggiore R=255) **non slavati** (whiteBurn 0%); tinta e sfondo fedeli; sign-off visivo utente. `NoToneMapping` + `outputColorSpace=SRGBColorSpace` invariati; pannello Taglio + fix 8.7.x non toccati.
- Bump 8.8.0 → 8.8.1 (PATCH): `registry.BACKEND_VERSION`, v3b `<title>`+`ANALIZZA_BUILD`, `pdf_gen.py VERSION`.

## 8.8.0 — pannello "Taglio" di prodotto su /analizzare + compensazione luci (LIVE su entrambi i servizi + custom domain) (2026-06-03)

Sostituisce il pannello flottante **provvisorio** `#synClipUI` (scaffolding di 8.7.0) con un **pannello di prodotto** `#panelTaglio`, integrato nel design system e aperto dal pulsante `#btnOpenTaglio` nella view-mode bar (modello Fresabilità: `openTaglio`/`closeTaglio`, swap dei pannelli destri, `tagState.isOpen`, NON tocca `analysisMode`). **Rinominato da "Sezione" a "Taglio"** per non collidere col cutview per-MUA esistente (`openCutView`/`misICP_toggleCutview`/`sostOpenCutView` + PiP `#btnSection` di /vedere). Branch **feat-pannello-taglio** (ex `dev-sezione-ui`, riallineato sopra 8.7.2 via rebase), **mergiato in main** (merge no-ff `f75d012`, commit feature `d636f74`) e **DEPLOYATO LIVE su entrambi i servizi** il 2026-06-03 (sequenza **canary LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`: LEGACY 7ac922ce deploy `b72adf77`, BACKEND b7671e12 deploy `a90f1437`). **Verifica live (curl -sL):** `backend_version=8.8.0` su BACKEND + LEGACY + `app.syntesis-icp.com`, `/analizzare` 200, gating `/api/me/storage` → 403.

- **Stile**: classi/token già usati dai pannelli analyzer (`.panel-section`, `.panel-label`, `.comp-radio` per asse X/Y/Z, `.export-checkbox` per i toggle, range stile `.tree-opacity-slider`) + `var(--*)`. **Zero hex hardcoded** (coerenza con Fresabilità).
- **Controlli** (taglio attivo / asse / posizione / inverti) pilotano i globali del **motore clip** (`synClipEnabled/Axis/Pos/Flip` + `synUpdateClipPlane`): il **motore r169 clipping/stencil/polygonOffset è INVARIATO**.
- **Default taglio OFF**: la scansione si carica intera/opaca; l'utente apre Taglio e attiva "Taglio attivo" per sezionare.
- **Convivenza "opacità comanda" — debito 8.7.0 CHIUSO**: opacità <100% o ghost (`treeUnified_setScanOpacity`/`treeUnified_ghostAll`) **disattivano** il taglio (trasparenza e clip+cap non coesistono → stencil cap mai rotto); riattivare il taglio forza la scansione opaca + slider opacità a 100% (`tagForceScanOpaque`). Lo slider opacità torna a fare solo opacità.
- **Rimossi**: `synAddProvisionalClipUI`, `window.__synClip` (scaffolding di verifica).
- **Riallineamento (rebase su main 8.7.2)**: il branch era su r169 PRE-fix; ora include i fix **8.7.1** (Posiziona in "Entrambi") e **8.7.2** (colore SRGBColorSpace). Verificato che il pannello **non** tocca `outputColorSpace`/`intersectObject`/`onViewportClick` → i fix r169 sopravvivono.
- **Compensazione colore (resa r169) — STEP 2**: la migrazione legacy→fisica lasciava lo scan a ~2/3 di r128 (scanMeanLum ~100 vs target v8.5.0 ~154), residuo lasciato aperto in 8.7.2. Alzate **Ambient 0.4→1.3** e **key bianca 0.6→1.3** (fill bluastra 0.25 **invariata** → tinta non vira); `outputColorSpace=SRGBColorSpace` e `NoToneMapping` **invariati** (leva = sole intensità luci; `toneMappingExposure` è inerte con NoToneMapping). Risultato (mock, scan isolato solid/clip off/camera fissa): **scanMeanLum 96.8→148.8** (dentro ±5% del target 154), **clip highlight 0%** (no burn), **tinta ambra preservata** (R/G 1.42 vs baseline 1.44), **MUA non slavati** (0% bianco pieno). Materiale Phong/scanColor/FOV/geometria non toccati.
- **Verifica locale** (mock server, scansione SR reale 002140_Ds1, 219k tri): pannello **Taglio** apre/chiude da `#btnOpenTaglio` (swap pannelli destri; abilitato al load da `synRebuildClip`); i 4 controlli pilotano il clip (asse X/Y/Z → normale del piano, posizione → offset, inverti → normale negata; l'overlay "Entrambi" riceve gli stessi `clippingPlanes`); convivenza "opacità comanda" OK (opacità 60% → taglio OFF + scansione trasparente; riattivazione → scansione opaca + opacità 100%). **Anti-regressione**: 8.7.2 `renderer.outputColorSpace=SRGBColorSpace` (scansione arancione, non desaturata); 8.7.1 Posiziona in "Entrambi" OK — il raycast `intersectObject(scanMesh,false)` isola la Mesh (hit con `.face`; `recursive=true` includerebbe 838 `LineSegments` dell'overlay), placement MUA 2→3, **console pulita zero errori**. Sintassi JS (`node --check` classici+ESM) e Python (`py_compile`) OK.
- Bump: `registry.BACKEND_VERSION`, v3b `<title>`+`ANALIZZA_BUILD`, `pdf_gen.py VERSION` → 8.8.0. `docs/MAPPA_FUNZIONALE.md` versione mappata 8.8.0.

## 8.7.2 — fix resa colore r169 (SRGBColorSpace) (LIVE su entrambi i servizi + custom domain) (2026-06-03)

Fix di una regressione **cromatica** r169: la scansione appariva **marrone scuro e desaturata** invece dell'**arancione caldo e luminoso** di v8.5.0 (r128). Causa: in 8.7.0 il renderer usa `outputColorSpace = **LinearSRGBColorSpace**` (output lineare crudo, nessun encoding sRGB per il display) → midtoni schiacciati (superficie scan V≈22% vs ≈63% in r128). **NON** era il toneMapping (`NoToneMapping` in entrambi) né l'input colore (`material.color` identico `(0.722,0.627,0.565)`, ColorManagement off). **Fix:** una riga, `outputColorSpace = **SRGBColorSpace**` (v3b ~2459) → V 22%→50%, S 17%→8% (verso il 6% del target), arancione ripristinato. Verificato che il cambio (globale) non rompe gli altri colori: i MUA **non** diventano fluo (l'OETF sRGB desatura leggermente, non sovrasatura), lo sfondo regge. **Residuo consapevole** (V 50% vs 63%, tinta 24° vs 11°) = modello di illuminazione THREE legacy→fisico, **NON compensato** (luci 0.4/0.6/0.25 invariate, scelta esplicita; eventuale STEP 2 futuro). Misurato su mock (scan.stl 219k tri, solid, camera home, 1400×900). Mergiato in **main** (merge no-ff `7d61d0f`, fix `37aada4`) e **DEPLOYATO LIVE su entrambi i servizi** il 2026-06-03 (LEGACY 7ac922ce deploy `4238bcf1`, BACKEND b7671e12 deploy `66b306bf`; sequenza **canary LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`, poll sulla versione live). **Verifica live (curl -sL):** `backend_version=8.7.2` su BACKEND + LEGACY + `app.syntesis-icp.com`, `/analizzare` 200 (title v8.7.2), gating `/api/me/storage` → 403. Include anche il fix 8.7.1 Posiziona (`b97323d`).

## 8.7.1 — fix Posiziona MUA in "Entrambi" (LIVE su entrambi i servizi + custom domain) (2026-06-03)

Fix di una regressione r169: "Posiziona" MUA era morto **solo in modalità "Entrambi"** (in Solid/Wireframe funzionava; bug **live** in 8.7.0, beta). Causa: `onViewportClick` [v3b ~2673] faceva `raycaster.intersectObject(scanMesh)` senza 2° arg → `recursive` default **true** → intersecava anche l'**overlay wireframe** (`LineSegments` figlio di scanMesh, presente solo in "Entrambi"), colpito per primo (più vicino, soglia linea 1mm) e senza `.face` → `placeMUA(hits[0].point, hits[0].face.normal)` lanciava TypeError → nessun MUA (errore console non notato). **Fix:** `intersectObject(scanMesh, false)` (non ricorsivo) + guardia `hits[0].face`. Non tocca il motore clip/stencil. **Verificato (mock r169):** placement OK in Solid/Wireframe/**Entrambi** + Raffina (`alignAll`), console pulita. Mergiato in **main** (merge no-ff `75f2f61`, fix `b97323d`) e **DEPLOYATO LIVE su entrambi i servizi** il 2026-06-03 (LEGACY 7ac922ce deploy `ed996f29`, BACKEND b7671e12 deploy `bc53367a`; sequenza **canary LEGACY → BACKEND**, `serviceInstanceDeploy latestCommit:true`). **Verifica live (curl -sL):** `backend_version=8.7.1` su BACKEND + LEGACY + `app.syntesis-icp.com`, `/analizzare` 200 (title `v8.7.1`), gating `/api/me/storage` → 403. **NB:** `dev-sezione-ui` (8.8.0) è costruito sulla r169 PRE-fix → al disgelo va portato dentro questo fix.

## 8.7.0 — migrazione motore rendering /analizzare: r169 + clipping/stencil (LIVE su entrambi i servizi) (2026-06-03)

Migrazione del **motore di rendering** del viewport `/analizzare` (`backend/static/syntesis-analyzer-v3b.html`): Three.js **r128 → r169** + **clipping plane + stencil cap** che **sostituisce la trasparenza** della scansione per il "vedere dentro". Risolve il sospeso "Bug rendering viewport" (prima design aperto). Mergiato in **main** (merge no-ff `b20fb00`, feature `dc4c049`) e **DEPLOYATO LIVE su entrambi i servizi** il 2026-06-03 (LEGACY 7ac922ce deploy `7bd1376b`, BACKEND b7671e12 deploy `4b1c4d2f`; sequenza canary LEGACY → BACKEND, `serviceInstanceDeploy latestCommit:true`). Verifica live: `backend_version=8.7.0` su entrambi, `/analizzare` 200 col frontend r169 servito (importmap + 0.169.0, zero r128), gate `/api/me/storage` 403, `app.syntesis-icp.com` (no-h) e `app.synthesis-icp.com` (con-h) 200.

- **Loader**: r169 non ha build globale/UMD → `<script type="importmap">` + `<script type="module">` con bridge `window.THREE = Object.assign({}, THREE)` ([1993-2010]). Il namespace ESM è immutabile: la copia estensibile permette `THREE.OrbitControls=…` (altrimenti no-op silenzioso). OrbitControls e parser STL restano custom-inline (zero dipendenze addon). OrbitControls IIFE auto-deferita su evento `three-ready`; `init()` con guardia `three-ready`.
- **Clipping + stencil cap**: pattern ufficiale `createPlaneStencilGroup` (back-face incr / front-face decr, renderOrder 1) + cap plane (`NotEqual` + `renderer.clearStencil()` in `onAfterRender`, renderOrder 1.1) + mesh visibile renderOrder 6. `renderer.localClippingEnabled=true`, `stencil:true`. Scansione ora **opaca** + `polygonOffset(1,1)` (reticolo nitido in "Entrambi"). Clip **solo sulla scansione**: MUA interi e leggibili. Blocco "CLIP ENGINE" [2528-2636]; (ri)costruito in `loadScanFile` [2641] e in `rebuildScanMeshGeometry` [11493],[11531].
- **Estetica invariata**: colori identici a r128 via `ColorManagement.enabled=false` + `outputColorSpace=LinearSRGBColorSpace`; luci 0.4/0.6/0.25 **invariate** — verificato r128 vs r169 sulla stessa scansione (002140, 219k tri): meanTop20Lum **168.4 vs 167.5**, nessuna compensazione necessaria.
- **Controllo taglio PROVVISORIO**: pannello `#synClipUI` "Sezione · provvisorio" (on/off, asse X/Y/Z, posizione, inverti) + hook console `window.__synClip(...)`. Solo per la verifica del motore; la UX definitiva del taglio è uno step successivo.
- **DEBITO CONSAPEVOLE (non è un bug)**: lo slider opacità scansione e il ghost-mode **esistenti** convivono ancora col clipping e, se usati, **rimettono la trasparenza** sulla scansione. Vanno integrati nello step UX successivo (riuso dello slider come **profondità di taglio**).
- **Verifica locale**: r169 boota l'app reale + carica scansione reale senza errori console; cap solido confermato (cap ON superficie piena `[57,52,48]` vs cap OFF interno cavo `[38,33,31]`); "Entrambi" col reticolo clippato + polygonOffset. **Sign-off visivo utente OK** (2026-06-03). Test via mock server locale (gate auth stubbata).
- **Tooling**: hook `.claude/hooks/syntax-check.sh` reso type-aware (salta importmap/JSON, controlla i `type="module"` come ESM .mjs).
- **Da ririprovare a parte**: Fix A (culling MUA `FrontSide`, revertito in 8.6.8) era corretto.
- Bump: `registry.BACKEND_VERSION`, v3b `<title>`+`ANALIZZA_BUILD`, `pdf_gen.py VERSION` → 8.7.0. `docs/MAPPA_FUNZIONALE.md` versione mappata 8.7.0.

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

**Bug rendering viewport `/analizzare` (Solid transparency)** — **RISOLTO e LIVE** in 8.7.0 su entrambi i servizi (deploy verificato 2026-06-03: LEGACY `7bd1376b`, BACKEND `4b1c4d2f`). Aperto 2026-06-02, chiuso 2026-06-03. Soluzione: upgrade Three.js **r169** + **clipping plane + stencil cap** che sostituisce la trasparenza della scansione (vedi version-trail "## 8.7.0"). Debito UX consapevole aperto (slider opacità/ghost convivono ancora col clipping → step UX: riuso slider come profondità-taglio). Sotto, la diagnosi storica per record.
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
6. **Ombre di contatto / Ambient Occlusion su /analizzare** (richiesto 2026-06-03): la resa 8.8.1 ha colore fedele + chiaroscuro r128 ma manca l'occlusione negli interstizi (look "scolpito" del riferimento dentale offline). Prototipo SSAO/GTAO fatto: import addon r169 OK + istanza THREE condivisa OK, MA integrazione = **progetto a sé** — il composer di post-processing sostituisce il render-path e interagisce col clipping/stencil cap del pannello Taglio (rischio di rottura del "vedere dentro") + costo real-time su ~2M px (primo render 459ms). Valutare alternativa **AO bakeato per-vertice al load** (un calcolo all'apertura file, niente pass real-time, zero rischio clipping). Da fare come step dedicato con validazione (taglio attivo, performance, resize, export PDF).
7. **"Apri caso" nel viewer /analizzare** (richiesto 2026-06-03; abilita la persistenza dei colori 8.9.0): oggi il viewer **NON ricarica** un caso salvato — `saveCase`/`exportCase` esportano un JSON (con MUA + colori) ma nessuna funzione lo ri-importa per ricostruire la scena 3D. **Blocco chiave**: il JSON **non** contiene la geometria STL (solo `filename`+`triangoli`) → l'apri-caso deve decidere come recuperare la mesh (ri-caricamento STL manuale + JSON sovrapposto, oppure dal backend `/api/me/analyses` se conserva l'STL). Progetto dedicato: ricostruzione scansione + MUA + colori (scan/MUA/ICP/Sostituire) + stato. I color picker 8.9.0 tengono già i colori nello stato, pronti da serializzare qui.

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
*Snapshot 2026-06-08 — 8.12.1 live su entrambi i servizi + custom domain (fix Raffina idempotente a convergenza in sostAlignAll: guard di rigidità sulla trasformazione totale ICP → marker già convergente = no-op). Aggiornare al prossimo cambio di stato.*
