# Strategia di modularizzazione — analisi completa e verificata (v1)

> **Stato:** analisi esaustiva, verificata in modo avversariale — **nessun codice toccato.**
> **Data:** 2026-06-14 · **Versione di riferimento:** 8.61.2
> **Metodo:** workflow 14 agenti (9 decompose + 4 verify avversariali + 1 completeness critic),
> ~1.1M token, 402 tool-use. I numeri panoramici di `MODULARIZZAZIONE_DIPENDENZE_v1.md` sono
> qui **corretti e completati** (quel doc si fermava a riga 19982 e perdeva due domini interi).
> **Documenti compagni:** `MODULARIZZAZIONE_STUDIO.md` (fattibilità), `MODULARIZZAZIONE_DIPENDENZE_v1.md` (panoramica grezza).

---

## 0. Le 5 correzioni che cambiano la strategia

La verifica avversariale ha ribaltato quattro assunzioni del primo giro. Sono load-bearing:

1. **Il file è 21.684 righe, non ~19.982.** Esistono 7 regioni `<script>`, non una. Fermarsi
   a 19982 perdeva **due domini interi**: Replace-iT (`replace*`, 86 funzioni) e il report
   PDF MUA (`analReport_*`, righe 20566–21684). Ogni call-graph che si ferma a 19982 è cieco su di essi.

2. **"Replace-iT" è il dominio più grande, ed era invisibile.** `sost*` (40) + `replace*` (86)
   = **126 funzioni**, più del core `mis*` (106). Era nascosto in "other" per sola assenza di
   prefisso. La tassonomia-per-nome **non è una base affidabile** per tagliare i moduli: serve
   assegnazione per **call-graph + write-set**, non per prefisso.

3. **Il blocco principale è NON-strict, e ci si conta sopra.** `"use strict"` esiste solo in
   due IIFE isolati (righe 2164 e 20325). I lettori *nudi* di `fresState` (`_hardResetAnalizza`
   v3b:4754, `confirmGroup` v3b:12068) e altri stati funzionano **solo** grazie a questo.
   Estrarre uno stato in un `<script>` module-scoped → **ReferenceError a runtime in clinica,
   senza errore di build.** Precondizione hard per ogni estrazione di stato.

4. **`analysisMode` non è una variabile: è un contratto semantico cross-dominio.** Il valore
   `'fresabilita'` (scritto da `openFresability`) **gatea** `calculateAngles`/`calculateMeanAxis`
   del core (`if(analysisMode!=='misura') return`). Cioè mentre il pannello Fresabilità è
   aperto, il ricalcolo angoli del core mis è **volutamente disattivato**. Coupling `fres→mis`
   via stringa di stato, invisibile a prefissi e call-graph.

5. **Il gate non copre il punto in cui tutto si rompe.** `node --check` e i diff statici **non**
   catturano nessuno dei rischi qui sotto: si manifestano solo a runtime, sul percorso
   *carica scansione → detect → ICP → overlay → report*, che richiede una **fixture STL reale,
   assente dal repo**. Questo è **il rischio più sottostimato dell'intera campagna** (§7).

---

## 1. Mappa dei domini corretta (445 funzioni top-level, file intero)

| Dominio | # funzioni | Dove | Note |
|---|---:|---|---|
| **other** (glue) | **171** | sparse | sceso da 257; ancora la connettività trasversale |
| `mis*`/`misICP_*` (core ICP/metrologia) | 106 | 6158–10472 | cuore clinico; in realtà **due motori** (§5.4) |
| **`replace*` (Replace-iT)** | **86** | 10500–19982 | **dominio nascosto**; con `sost*` = 126 |
| `sost*` (Sostituire) | 40 | 15249–19428 | stesso macro-dominio di `replace*` |
| `fres*` (fresabilità) | 31 | 5204–6135 | contiguo; prossimo candidato analizzato |
| `analReport_*` (report PDF MUA) | 4 | 20566–21684 | **fuori dal blocco gigante**; dipende da jspdf/xlsx |
| `tree*` (albero scena) | 3 | 4112–4182 | candidato pilota |
| `render*` | 3 | sparse | falso dominio (già in `ds/syn-render.js`) |
| `find*` (detection scanbody) | 1 | 2736 | cuore clinico condiviso da 3 workflow |

**Le 7 regioni `<script>`** (mappa da rifare sull'intero file): (1) head 1143–1212; (2) import-map
THREE 2079–2128; (3) bridge ESM `window.THREE=Object.assign` 2133–2151 (module deferred);
(4) IIFE strict 2163–2412; (5) **blocco principale non-strict 2414–~20311**; (6) gate-auth IIFE
20126–20311; (7) `SynLayerPanel` + `analReport_*` (IIFE strict) 20324–21684.

---

## 2. L'infrastruttura condivisa che OGNI estrazione deve rispettare

Prima di ogni dominio, queste sono le invarianti trasversali. Romperne una = regressione runtime silenziosa.

### 2.1 Modalità strict (precondizione hard)
Il blocco principale (2414–20311) e quello `analReport_*` (20566–21684) devono **restare non-strict**,
e i lettori bare nel monolite devono risolvere a `window`. Qualsiasi stato estratto deve esporre un
**alias bare via accessor** sul global object (non un semplice riferimento copiato), perché le
riassegnazioni di primitive (`analysisMode`, `currentWorkflow`) devono propagarsi ai lettori.

### 2.2 Bridge THREE / guardia `three-ready`
`window.THREE` è creato via `Object.assign` (copia, **non** live binding) a v3b:2148, da un module
**deferred** → **non pronto a parse-time** dei classic script. Regole:
- Ogni modulo che tocca THREE deve leggere `window.THREE` **dietro la guardia** `three-ready`
  (`if(!window.THREE){window.addEventListener('three-ready',fn,{once:true});return;}`, già usata a 2449/2593).
- **Mai re-importare `three` come ESM** in un modulo estratto: otterrebbe un namespace **senza
  OrbitControls** e senza le estensioni attaccate alla copia del monolite → due THREE divergenti
  (rischio già in memoria `three-r169-migration`).

### 2.3 Spina dorsale di stato (`window.SYN.*` + alias accessor)
Stato di piattaforma da dotare di casa esplicita, in ordine di priorità:

| Variabile | refs~ | writes | domini | Casa proposta | Trappola |
|---|---:|---:|---|---|---|
| **`scanMesh`** | 115 | 8(+1) | mis,render,tree,other,**clip,panel,report** | `SYN.scene.scanMesh` | **`var` a 2435 → proprietà window non-configurable → `defineProperty` lancia TypeError**: il sito di dichiarazione va convertito, NON "lasciato invariato". 9° write a 2692 (`._synId`), doppia fonte di verità con `SynRegistry` (2692/4135). |
| `fresState` | 133 | 41 | fres,other,**clip** | `SYN.state.fres` | priorità bassa (già quasi-modulo); letta bare in non-strict |
| `envSettings` | 87 | 17 | mis,other,**clip** | `SYN.state.env` | `.scanColor` letto da syn-clip |
| `misurareState` | 41 | 14 | render,other | `SYN.state.misurare` | quasi mono-modulo |
| `cutState` | 23 | 14 | render,other | `SYN.scene.cut` | |
| `analysisMode` | 23 | 8 | sost,other,**fres→mis,replace** | `SYN.state.mode` | **contratto semantico** (§0.4): accessor obbligatorio |
| `SOSTITUIRE_TEMPLATE_INFO` | 17 | 0 | find,sost,tree,other | `SYN.scanbodyTemplates` (costante, `Object.freeze`) | non è stato |
| `currentWorkflow` | 6 | 2 | mis,other,**panel** | `SYN.state.workflow` | accessor (primitiva riassegnata a 4974) |

### 2.4 Contratto DOM (id + classi che i moduli `ds/` pilotano)
Il markup del monolite **deve** continuare a fornire questi nodi (estratti i moduli, il markup resta):
- **id**: `#panelTaglio #tagToggle #tagFlip #tagPos #tagPosVal #tagAxisRadio #btnOpenTaglio
  #panelMuaList #panelAngleList #panelAxisInfo #panelFresabilita #panelScanLoad #panelClinicalStatus
  #viewMenu #rightPanel #layersPanel #cutViewOverlay #misTree #misCutPanel` **+ (mancavano in v1)**
  `#btnRaffina #btnLoadFile #viewMenuRailToggle`
- **classi**: `.panel-collapsible-head .panel-close-btn[data-pclose] .panel-rail-icon[data-rail-target]
  .view-menu-item[data-vmi-target] .syn-drag-handle .syn-resize-handle` **+ (mancavano)**
  `.view-menu-wrapper .panel-collapsible .panel-hidden .panel-rail-collapsed .tree-head .layers-head
  .mis-tree-head .mis-cut-head .mis-cut-title .attention .disabled .keyboard-pulse`
- **dipendenza dinamica**: `synRebuildClip` (syn-clip:111-113) **riscrive** min/max di `#tagPos`
  e `#btnOpenTaglio.disabled` — non solo lettura, mutazione del nodo che il markup definisce inline.

### 2.5 `localStorage` — 16 chiavi, da assegnare a un owner unico
Owner proposto fra parentesi; ⚠ = letta da più domini (write/read si sdoppiano se non centralizzata):
`syntesis_mua_algorithm`⚠ (mis+sost+impostazioni), `syntesis_axis_engine` (mis),
`syntesis_sost_center` (sost), `syntesis_replace_icp` (replace), `syntesis_layers_open` (layer-panel),
`syntesis_env_settings` (platform/env), `syntesis_miller_settings` (fres/impostazioni),
`syntesis_viewMode` (render), `syntesis_ui_zoom`(+reset/migration) (ui), `FRES_STORAGE_KEY`
=`syntesisIcp.fresability.v1` (fres); più le già-owned da syn-panel (`syntesis_panel_*`,
`syntesis_analizza_view/rail`) e syn-gate (`syntesis_token/user`, sessionStorage `syn_after_login`).
`sessionStorage` nel monolite: **zero** occorrenze (verificato).

### 2.6 Listener globali `keydown` (3 coesistenti, nessun dispatcher)
- v3b:11150 — `Ctrl+Z` (workflow-aware, dipende da `analysisMode`/`replaceSeed`/`replacePlaced`/`undoLastMUA`) + `L` (livelli)
- v3b:20299 — `Escape` → `syntAuthClose` (dentro il gate IIFE)
- `syn-panel.js:250` — `P`/`Space` → Raffina/Posiziona (via `#btnRaffina`)

Ogni dominio estratto porta con sé il proprio `addEventListener('keydown')`; i guard sui tasti
devono restare **mutuamente esclusivi** (niente doppio-trigger quando i domini si separano).

### 2.7 CSS condiviso
`ds/components.css` + `ds/tokens.css` definiscono classi (`.panel-*`, `.syn-*`, `.attention`,
`.keyboard-pulse`, palette d3/angolari) consumate da più domini e dal markup inline. Estrarre un
dominio JS **senza migrare/preservare le sue regole CSS** (o cambiare un token) propaga regressioni
visive cross-workflow. Confine invariabile: i **colori clinici** (d3/angolari/brand) restano immutati.

---

## 3. Lista di sicurezza anti-regressione (must_preserve consolidata)

Nomi del monolite che i moduli `ds/*.js` **già LIVE** consumano → **mai** rendere module-scoped:

**Letti da `syn-clip.js`** (via `root.`/typeof-guard): `THREE`, `scanMesh`, `scene`, `envSettings`
(`.scanColor`), `fresState`, `closeFresability`, `showStatus`, `rebuildTree`.
**Letti da `syn-panel.js`** (bare/typeof-guard): `onEnvRenderModeChange`, `updateRenderModeUI`,
`alignAll`, `startPlacement`, `currentWorkflow`, `scanMesh`, `misICP_geomA`, `misICP_geomB`,
`closeFileMenu`, `closeWorkflowMenu`.
**Esposti dai moduli e consumati dal monolite** (direzione opposta): `SynRender.{applyRendererPipeline,
addCameraLightRig,makeGradientTexture}`; clip su window `synRebuildClip synUpdateClipPlane tagSyncUI
synClipArr openTaglio closeTaglio tagOnToggle tagOnAxis tagOnPos tagOnFlip synClipEnabled`;
panel `onSyntesisViewModeChange syntesisOpenFileDialog toggleViewMenu toggleViewPanel
toggleRightColumnRail resetViewPanels`.
**Stato clip su window** scritto dall'esterno (monolite): `synClipEnabled synClipPlane synClipAxis
synClipPos synClipFlip synStencilGroup synCapMesh synClipCenter synClipDiag tagState`.

`syn-render.js` e `syn-gate.js`: **zero** reach verso il monolite (accoppiamento minimo by-design →
modello da imitare per i futuri moduli).

---

## 4. Export surface inline (156 funzioni, per dominio)

156 funzioni distinte richiamate da handler `on*` nel markup → devono restare globali:

| Dominio | # | | Dominio | # |
|---|---:|---|---|---:|
| other (glue) | 50 | | onEnv (ambiente) | 10 |
| replace | 31 | | tag (clip) | 4 |
| toggle (menu/layer) | 21 | | syntAuth | 4 |
| sost | 16 | | tree | 3 |
| mis | 14 | | fres | 2 |
| | | | render | 1 |

---

## 5. Dossier per dominio (rischio · meccanismo · trappole)

### 5.1 `tree*` — rischio BASSO · meccanismo A · **candidato pilota**
3 funzioni (`treeUnified_setScanOpacity/ghostAll/restoreAll`). **Trappole**: invocate **solo** da
stringhe HTML inline costruite in `rebuildTree` (3976/4049/4050) → devono restare raggiungibili;
riassegnano `synClipEnabled` (=false) → la scrittura deve colpire la stessa cella su window; mutano
material THREE condivisi e bufferizzano `_origOpacity/_origTransparent` (`restoreAll` dipende dall'aver
scritto `ghostAll/setScanOpacity`). Buon banco di prova del gate sul prossimo dominio.

### 5.2 `fres*` — rischio ALTO · meccanismo mixed · analisi pronta
31 funzioni (5204–6135). **must_preserve**: `fresState closeFresability openFresability
fresOnMachineChange fresOnModeChange fresClearAllArrows fresRecompute fresUpdateOpenButton fresOverlayRender`.
**Non estraibile**: (a) IIFE monkey-patch di `calculateAngles` (6127–6135, parse-time, order-dependent —
**lasciare nel monolite**); (b) `fresUpdateOpenButton` tocca `btnAnalReport` (dominio report — side-channel
UI); (c) `root.fresState`/`root.closeFresability` da syn-clip; (d) scrive `analysisMode='fresabilita'`
che **gatea** `calculateAngles`/`calculateMeanAxis` del core (§0.4); (e) lettori bare di `fresState` in
non-strict (§2.1). **Dead code** (annotare, NON rimuovere ora — §8): `fresUpdateAllArrows` ×4 identiche
+ zero call; `fresOverlayScene`/`fresInitOverlayScene` (mai chiamata); `fresAddCustom`/`fresRemoveCustom`
(orfane, UI rimossa in v8). `fresOverlayRender` è NO-OP ma chiamata ogni frame da `animate` (2677).

### 5.3 `sost*` + `replace*` (Replace-iT) — rischio MEDIO · meccanismo A · 126 funzioni
Macro-dominio più grande del core. **I 28 edge other↔sost NON sono logica spaccata**: l'unico writer
'other' rilevante è `_hardResetSostituire` (4874–4912, scrive 7 var sost) + `_hardResetMisurare`; il
resto è singleton THREE/`analysisMode`/handler inline. **Non estraibile/attenzione**: accoppiamento
**DOM per-stringa** con Analizza (riusa `cutViewOverlay`, `cutMuaSelect`, `cutCanvas`, `labelLayer`,
`emptyState` — invisibile al call-graph); `replacePickDownX/Y/Shift` scritti dal listener `pointerdown`
(2631, 'other') e letti da `sostOnViewportClick`. **Costanti tarate da preservare bit-per-bit**:
`SOST_MIN_COVERAGE_DEG=140` (17938), `SOSTITUIRE_Z_OFFSET_UNIVERSAL=-0.40` (15305), `SOSTITUIRE_CULL_CYL`.
**Dead code**: `_setSostituireArtifactsVisible` (19112, mai invocata). Prerequisito: **consolidare il
naming** `replace*`/`sost*` sotto un'unica identità di modulo prima del taglio.

### 5.4 `mis*` core — rischio ALTO · meccanismo mixed · ULTIMO · 106 funzioni
**È in realtà DUE motori**: (1) **nucleo numerico puro** 6158–6957 (`misICP_pSTL`, `comps`, `partition`,
`clusterComps`, `kabsch`, `svd3`, `jacobi3`…) — quasi senza dipendenze DOM/scena, il pezzo più
isolabile e testabile; (2) **sotto-motore viewport** 6957–7335 + 9971–10472 (`mountViewport`,
`renderMeshes`, `renderPerCylinder`, label, cutview, tree) — fuso al grafo di scena condiviso.
**Stato spaccato fuori prefisso**: `misICP_meshA/meshesA/result/labels/bgMeshA/B` scritti da
`_hardResetMisurare` ('other', 4805–4860) e `_setAnalyzaArtifactsVisible` ('other', annidato a 7200
**dentro** il range mis). **Dipendenza clinica**: `misICP_cylAxis` → `synAxisUseLateral` ('other',
3404) → localStorage. **Export implicito**: nessun `window.misICP_*` esiste oggi; i 14 handler inline
si appoggiano alle funzioni globali. **Gate golden-master** su `misICP_result {rmsd,R,t,pairs[].{dx/dy/dz/d3um,axDeg},score}`
→ **richiede STL reali NON in repo** (§7).

### 5.5 `analReport_*` (report PDF MUA) — fuori dal blocco gigante
4 funzioni 20566–21684, IIFE strict. Dipende da **jspdf + jspdf-autotable + xlsx** (caricate
2152–2154) e legge `misICP_result` + `scanMesh` (`analReport_captureViews` a 20566 legge la spina
dorsale **fuori** dal range assunto in v1). Da censire come dominio a sé col suo contratto-libreria.

### 5.6 `find*` / `render*` — piccoli ma non isolabili come sembrano
`findScanbodyCenter` (2736): quasi-puro (input via parametri) **ma cuore clinico condiviso** da
Analizza+Misurare+Sostituire → estrazione tardiva, gate golden-master. `render*` è un **falso dominio**:
`renderFresGroupSingle`/`renderMisurareList` appartengono a fres/mis; `renderCutView` resta **per-file**
per scelta esplicita (commento in `ds/syn-render.js` 9–11). La consolidazione rendering è già fatta.

---

## 6. Roadmap di estrazione rivista

Prima i prerequisiti trasversali, poi i domini dal meno al più intrecciato, core e clinico ultimi.

| # | Passo | Tipo | Rischio | Pre-condizione |
|---|---|---|---|---|
| **0a** | **Gate Tier 1 — invarianti statiche** (no browser) | infra test | basso | scelto come primo passo (§7; piano in GATE_TIER1) |
| **0c** | Fixture STL reale anonimizzata + harness WebGL (Tier 3) | infra test | — | **differito al passo 7**; fixture dall'utente (§7) |
| **0b** | Rifare mappa 7 blocchi `<script>` + dep_census su file intero | analisi | — | fatto in parte (`scripts/dep_census.py` v2) |
| **1** | Spina di piattaforma → `window.SYN.scene/state` + alias accessor (`scanMesh` first) | refactor stato | medio | strict-mode invariata; defineProperty caveat |
| **2** | `tree*` — estrazione pilota | modulo A | basso | passo 1 (scanMesh con casa) |
| **3** | `fres*` — preservando i 9 nomi + non toccando il monkey-patch | modulo mixed | alto | passi 1–2; lettori bare risolti a window |
| **4** | Consolidare naming `replace*`/`sost*`, poi estrarre Replace-iT | modulo A | medio | DOM per-stringa preservato |
| **5** | `analReport_*` — modulo report con contratto jspdf/xlsx | modulo B | medio | — |
| **6** | Sotto-classificare i 171 'other' per call-graph+write-set (non per nome) | analisi+refactor | medio | iterativo |
| **7** | `mis*` core — prima il **nucleo numerico puro**, poi il viewport | modulo mixed | alto | passo 0 (gate golden-master) |
| **8** | `findScanbodyCenter` — cuore clinico condiviso | modulo | alto | passo 0 |

**Differenza chiave rispetto a v1**: il passo 0 (fixture+harness) sale a **prerequisito assoluto**,
non "da fare prima del core". Senza, i passi 1/3/4 hanno gate solo statico = cieco sui loro veri rischi.

---

## 7. Il problema del gate (rischio #1 sottostimato)

`node --check` e i diff byte/struttura **non catturano nessuno** dei fallimenti reali (stato bare in
non-strict, THREE non pronto, id DOM mancante, libreria assente, chiave localStorage sdoppiata): sono
**runtime-only**, e si manifestano sul percorso *carica scansione → detect → ICP → overlay → report*,
che oggi è attivabile **solo con una scansione reale**. `jsdom` non basta (serve WebGL).

**Precondizione bloccante (Fase 0 stabilizzazione)**: costruire (a) una **fixture STL minima** —
scan + reference; (b) un **harness headless** (Playwright/Puppeteer con WebGL software/SwiftShader) che
esegua il percorso completo. È ciò che trasforma il gate da "verifica di presenza simboli" a "verifica
di contratto runtime".

**DECISIONE 2026-06-14 — gate a livelli (non scommettere tutto sul Tier 3):**
- **Tier 1 — invarianti statiche** (no browser/WebGL): linter che asserisce §2–§3 (must_preserve,
  no `"use strict"` aggiunto, contratto DOM, ownership localStorage, guardia `three-ready`, sintassi).
  **Scelto come primo passo**, rischio nullo. Progettazione completa: `MODULARIZZAZIONE_GATE_TIER1_v1.md`.
- **Tier 2 — DOM/no-scena** via harness browser-via-preview già provato (panel): differito.
- **Tier 3 — golden-master WebGL completo**: **differito** al passo 7 (core `mis*`). Fixture =
  **STL reale anonimizzata fornita dall'utente** (decisione 2026-06-14; geometria pura = anonima;
  una sintetica non attiva la detection click-seedata). Confronto **numerico** su `misICP_result`, mai pixel.

---

## 8. Inventario dead code (annotare, NON rimuovere ora — CLAUDE.md §3.4)

Confermati, da rimuovere in un **passo dedicato** (mai durante un'estrazione funzionale), e da **non
esporre** su window nel frattempo:
- `fres`: `fresUpdateAllArrows` ×4 identiche (5587/5593/5599/5605, sopravvive solo l'ultima per hoisting,
  zero call); `fresOverlayScene`/`fresOverlayLights`/`fresInitOverlayScene` (mai chiamata);
  `fresAddCustom`/`fresRemoveCustom` (orfane). `fresOverlayRender` = NO-OP ancora chiamata (guscio compat).
- `sost`: `_setSostituireArtifactsVisible` (19112, mai invocata).
- Commenti/log fuorvianti che citano la `fresOverlayScene` morta (es. `fresIsClickOnPicker` 5945).

---

## 9. Tabella problemi anticipati (sintesi)

| Problema | Dove si rompe | Sintomo | Mitigazione |
|---|---|---|---|
| Stato bare in non-strict | reset/crea-gruppo/apri fresabilità | ReferenceError silenzioso | alias accessor su window + blocco principale non-strict |
| THREE non pronto a parse-time | qualsiasi modulo scena caricato presto | crash/no-op | guardia `three-ready`, mai re-import ESM |
| `analysisMode` contratto | ricalcolo angoli core | angoli non si aggiornano | trattare il valore come contratto fres↔mis↔replace |
| id/classe DOM mancante | toggle pannelli/rail/raffina | UI inerte | contratto DOM §2.4 nel markup |
| chiave localStorage sdoppiata | impostazioni/algoritmi | preferenze incoerenti | un owner per chiave §2.5 |
| keydown doppio-trigger | scorciatoie tastiera | azione doppia | guard mutuamente esclusivi §2.6 |
| `scanMesh._synId`/SynRegistry | albero scena/layer | albero desincronizzato | migrare ._synId insieme alla mesh |
| CSS/token condiviso | tutti i workflow | regressione visiva | migrare CSS col dominio; clinici immutati |
| gate cieco | ovunque, in clinica | fallimento silenzioso post-deploy | fixture STL + harness WebGL (§7) |

---

## 10. Riproducibilità e fonti

```bash
python3 scripts/dep_census.py     # v2: file intero 2414-21684, prefisso replace/report
```
Output: `scripts/dep_census_out.json`. Analisi profonda: workflow `modularization-deep-analysis`
(14 agenti). Vedi `MODULARIZZAZIONE_STUDIO.md`, `MODULARIZZAZIONE_DIPENDENZE_v1.md`, `MAPPA_FUNZIONALE.md`,
`scripts/gate/`, memoria `v3b-modularization` / `three-r169-migration` / `bcd-consolidation-replaceit`.
