# Mappa funzionale — Syntesis-ICP

> **Versione software mappata:** 8.4.8 — **Data:** 2026-06-01
> **Generata dal codice reale, verificata per riga.** Ogni voce cita il file e la riga di provenienza. Dove un dettaglio non è verificabile è marcato **DA CHIARIRE**, non inventato.
> **Stato documento:** completo — tutte e 5 le viste coperte.

Sorgenti primarie:
- `backend/main.py` — route che servono le pagine.
- `backend/static/syntesis-analyzer-v3b.html` — app analyzer (4 workflow interni).
- `backend/static/syntesis-icp-vedere.html`, `syntesis-dashboard-v1.html`, `syntesis-accedi.html`, `syntesis-gestione.html` — altre viste.

---

## Indice viste/route

| Vista | Route | File servito | main.py righe | Scopo sintetico |
|---|---|---|---|---|
| (redirect root) | `/` | — (`RedirectResponse` → `/vedere`) | [145-151](../backend/main.py#L145) | Redirect 302 alla home `/vedere` (default = workflow Vedere) |
| **Vedere** (landing) | `/vedere` | `syntesis-icp-vedere.html` | [177-184](../backend/main.py#L177) | Viewer 3D multi-formato (STL/OBJ/PLY/XYZ/PCD/PTS) con strumenti di misura, forme, annotazioni. Home di default. NON è uno dei 4 workflow dell'analyzer. |
| **Analizzare** | `/analizzare` | `syntesis-analyzer-v3b.html` | [169-174](../backend/main.py#L169) | App di analisi di precisione (~3.87 MB monolite). 4 workflow interni — analizza, accoppia, misurare, sostituire — gestiti da `selectWorkflow`. |
| **Dashboard** | `/dashboard` | `syntesis-dashboard-v1.html` | [186-192](../backend/main.py#L186) | Area personale utente (mie analisi, profilo). |
| **Accedi** | `/accedi` | `syntesis-accedi.html` | [194-201](../backend/main.py#L194) | Accesso a 3 stati: login, registrazione senza licenza (utente pending), pannello attesa con polling `/auth/me` + vista autorizzato. |
| **Gestione** | `/gestione` | `syntesis-gestione.html` | [203-210](../backend/main.py#L203) | Pannello admin: lista registrati, autorizza (genera chiave) / revoca. API `/admin/*` protette da `require_admin`. |

Note di completezza:
- I 5 file `.html` in `backend/static/` (`ls`: accedi, analyzer-v3b, dashboard, gestione, icp-vedere) sono **tutti** serviti dalle route sopra — nessun HTML orfano.
- Le `RedirectResponse` a `backend/main.py` righe 1067-1126 sono i redirect del flusso OAuth Google Drive (`/auth/gdrive/connect` [1048], `/auth/gdrive/callback` [1070]), **non** viste HTML → fuori mappa.
- `auth.py` / `admin.py` non servono HTML (solo API JSON) — verificato (grep `FileResponse|HTMLResponse|.html` → vuoto).

### Workflow interni dell'analyzer `/analizzare`

Non sono route: sono stati interni di `syntesis-analyzer-v3b.html`, commutati da `selectWorkflow(wf)` ([4565](../backend/static/syntesis-analyzer-v3b.html#L4565)). `vedere` dentro `selectWorkflow` è solo un redirect a `/vedere` ([4567-4571]).

| Workflow | Ramo in `selectWorkflow` | `analysisMode` | Note |
|---|---|---|---|
| analizza | [4636](../backend/static/syntesis-analyzer-v3b.html#L4636) | `'misura'` | Default all'avvio (menu item `active`, [1278]). Analisi angolare MUA. |
| accoppia | [4658](../backend/static/syntesis-analyzer-v3b.html#L4658) | `'accoppia'` | Esporta/confronta accoppiamenti. |
| misurare | [4678](../backend/static/syntesis-analyzer-v3b.html#L4678) | `'misurare'` | Monta viewport ICP dedicato (2 STL). |
| sostituire | [4704](../backend/static/syntesis-analyzer-v3b.html#L4704) | `'sostituire'` | Posizionamento marker su scansione di partenza. |

---

## Classi di visibilità (toolbar analyzer)

Classi CSS che `selectWorkflow` usa per mostrare/nascondere i pulsanti di toolbar per-workflow. Tutte in `syntesis-analyzer-v3b.html`.

| Classe | # occorrenze | querySelector | analizza | accoppia | misurare | sostituire | Note |
|---|---|---|---|---|---|---|---|
| `.analisi-only` | 11 | [4609](../backend/static/syntesis-analyzer-v3b.html#L4609) | mostra `''` [4647] | mostra `''` [4669] | nascondi `none` [4694] | nascondi `none` [4719] | Bottoni Analizza/Accoppia (es. "+ Posiziona", "Raffina"). |
| `.misurare-only` | 2 | [4610](../backend/static/syntesis-analyzer-v3b.html#L4610) | nascondi `none` [4648] | nascondi `none` [4670] | mostra `''` [4695] | nascondi `none` [4720] | |
| `.sostituire-only` | 4 | [4721](../backend/static/syntesis-analyzer-v3b.html#L4721) inline + gestione centralizzata a fine `selectWorkflow` | nascondi `none` | nascondi `none` | nascondi `none` | mostra `''` | **Corretto in 8.4.6**: gestione centralizzata in `selectWorkflow` (`querySelectorAll('.sostituire-only')` + display per `wf === 'sostituire'`), simmetrica al fix `#panelScanbodyType` 8.4.5. Visibili solo in sostituire, nascosti altrove. |
| `.icon-only` | 26 | — | n/a | n/a | n/a | n/a | **Non** è gating per-workflow: styling per bottoni a sola icona. Citata per completezza. |

### Pannelli a visibilità per-id (non per-classe)

Oltre alle classi, `selectWorkflow` commuta `style.display` di numerosi pannelli **per id** (non per classe). Da tabellare integralmente in Fase 2 nella sezione "Stato globale e classi di visibilità". Variabili raccolte in testa alla funzione ([4598-4610](../backend/static/syntesis-analyzer-v3b.html#L4598)): `panelAngleList`, `panelAxisInfo`, `panelExport`, `panelMisurareList`, `panelMisurareCompare`, `panelMisurareICP`, `panelClinicalStatus`, `panelMuaList`, `panelScanLoad`, `layersPanel`, `misurareStage`. Più due gestiti fuori da quel blocco: `panelSostituire` (mostrato nel ramo sostituire [4716-4717], nascosto in uscita [4624-4625]) e **`panelScanbodyType`** (gestione centralizzata aggiunta in 8.4.5 [4617-4618]: visibile solo in analizza/accoppia).

---

## Vista: Analizzare (`/analizzare` → `syntesis-analyzer-v3b.html`)

App monolite (~3.87 MB). 4 workflow interni commutati da `selectWorkflow(wf)` ([4565](../backend/static/syntesis-analyzer-v3b.html#L4565)). Tutte le righe di questa sezione si riferiscono a `syntesis-analyzer-v3b.html`.

### Chrome persistente — barra menu (sempre visibile)

| Elemento (etichetta) | id / selettore | Evento | Funzione | Stato letto/scritto | Effetto a valle | Righe | Note |
|---|---|---|---|---|---|---|---|
| Menu **File** | `#fileMenu` | onclick | `toggleFileMenu` | — | apre dropdown | [1218] | |
| → Nuovo | `.file-menu-item` | onclick | `newCase` | `scanMesh`, `muaObjects` | reset caso (confirm se c'è stato) | [1222] | |
| → Importa | | onclick | `inputScan.click()` | — | apre file dialog STL | [1226] | delega a `#inputScan` |
| → Salva (JSON) | | onclick | `saveCase` | `muaObjects` | scarica `.json` | [1231] | |
| → Esporta (PNG+JSON) | | onclick | `exportCase` | `scanMesh` | screenshot PNG + json | [1236] | |
| → Impostazioni | | onclick | `openSettings` | `envSettings` | apre modal impostazioni | [1242] | |
| → Accedi/Logout | `#fmAuthItem` | onclick | `syntAuthClick` | token localStorage | login/logout | [1248] | testo dinamico `#fmAuthLabel` |
| → Area personale | `#fmDashboardItem` | onclick | `window.open('/dashboard')` | — | apre dashboard | [1255] | `display:none` di default |
| **Reset** | `.btn` | onclick | `hardReset` | `scanMesh`, `muaObjects` | ricarica app con `?_r=Date.now()` | [1262] | feat 8.4.4 |
| Menu **WorkFlow** | `#workflowMenu` | onclick | `toggleWorkflowMenu` | — | apre dropdown | [1267] | |
| → Vedere | `[data-wf="vedere"]` | onclick | `selectWorkflow('vedere')` | — | **redirect** a `/vedere` ([4567-4571]) | [1271] | |
| → Analizza | `[data-wf="analizza"]` | onclick | `selectWorkflow('analizza')` | `currentWorkflow` | switch workflow | [1278] | `.active` di default |
| → Misurare | `[data-wf="misurare"]` | onclick | `selectWorkflow('misurare')` | `currentWorkflow` | switch workflow | [1285] | |
| → Sostituire | `[data-wf="sostituire"]` | onclick | `selectWorkflow('sostituire')` | `currentWorkflow` | switch workflow | [1292] | |
| Menu **Vista** | `#viewMenu` | onclick | `toggleViewMenu` | — | apre dropdown pannelli | [1301] | |
| → toggle pannello ×5 | `[data-vmi-target]` | onclick | `toggleViewPanel(id)` | visibilità pannello | mostra/nasconde un pannello dx | [1306-1320] | targets: `panelScanLoad`, `panelClinicalStatus`, `panelMuaList`, `panelAngleList`, `panelAxisInfo` |
| → Collassa colonna dx | `#viewMenuRailToggle` | onclick | `toggleRightColumnRail` | — | collassa colonna destra | [1322] | |
| → Mostra tutti | | onclick | `resetViewPanels` | — | ripristina pannelli | [1325] | |
| Carica file STL | `#btnLoadFile` | onclick | `syntesisOpenFileDialog` | — | apre file dialog | [1331] | **senza** classe `-only` → di fatto sempre visibile |

> **Doppio sistema di visibilità dei pannelli dx**: `selectWorkflow` li commuta per-workflow (matrice sotto), **ma** il menu **Vista** (`toggleViewPanel`) e i `panel-collapsible` permettono all'utente di mostrarli/nasconderli/collassarli indipendentemente. Le due cose convivono.

### Toolbar per-workflow (classi di visibilità)

| Elemento | id / classe | Funzione | Visibile in | Effetto a valle | Righe | Note |
|---|---|---|---|---|---|---|
| Livelli | `#btnLivelli` `.analisi-only` | `toggleLayersPanel` | analizza+accoppia | toggle albero scena (`layersPanel`) | [1337] | |
| Livelli (dup) | `.sostituire-only` | `toggleLayersPanel` | solo sostituire | toggle albero scena | [1345] | `display:none` default; visibilità centralizzata in `selectWorkflow` (corretto 8.4.6) |
| **Posiziona** | `.green .analisi-only` | `startPlacement` | analizza+accoppia | `placementMode=true` → al click `placeMUA` | [1353] | |
| **Raffina** | `#btnRaffina` `.analisi-only` | `alignAll` | analizza+accoppia | ICP refine di tutti i MUA | [1363] | |
| Crea gruppo | `.analisi-only` | `openGroupDialog` | analizza+accoppia | apre dialog gruppi | [1373] | |
| Mostra assi | `#btnAxes` `.analisi-only` | `toggleAxes` | analizza+accoppia | toggle assi 3D | [1383] | |
| Sezione | `.analisi-only` | `openCutView` | analizza+accoppia | cutview MUA (overlay) | [1392] | |
| Sezione (mis) | `.misurare-only` | `misICP_toggleCutview` | solo misurare | cutview ICP | [1400] | `display:none` default |
| Sezione (sost) | `.sostituire-only` | `sostOpenCutView` | solo sostituire | cutview marker | [1408] | `display:none` default; visibilità centralizzata in `selectWorkflow` (corretto 8.4.6) |
| Annulla | (toolbar dx) | `undoLastMUA` | analizza (toolbar) | rimuove ultimo MUA | [1418] | |
| Menu reset | | `toggleResetMenu` | analizza | dropdown: `resetCamera` [1432], `resetGroups`, `clearAllMUA` | [1424] | |

> **✅ Leak gemello — CORRETTO in 8.4.6.** I 2 bottoni `.sostituire-only` ([1345], [1408]) hanno `display:none` inline; il ramo sostituire li mostra ([4722]), ma prima nessuno li rinascondeva uscendo (il blocco di uscita nascondeva solo `panelSostituire`, `_hardResetSostituire` non li toccava, e i rami analizza/accoppia/misurare non settavano mai `sostituireBtns`) → restavano visibili dopo una visita a Sostituire. **Fix 8.4.6**: gestione centralizzata a fine `selectWorkflow` (`querySelectorAll('.sostituire-only')` + `display` per `wf === 'sostituire'`) — nessun ramo può dimenticarli. La riga inline ridondante ([4722]) è lasciata invariata (innocua). Simmetrico al fix `#panelScanbodyType` 8.4.5.

### Pannelli destri — matrice di visibilità per workflow (`selectWorkflow`)

Valori = `style.display` impostato in ciascun ramo (`''` = visibile, `none` = nascosto). Variabili dichiarate a [4598-4610].

| Pannello (id) | analizza | accoppia | misurare | sostituire | Apertura su richiesta |
|---|---|---|---|---|---|
| `panelAngleList` | `''` [4638] | none [4660] | none [4682] | none [4707] | data-pview anglelist, collapsible |
| `panelAxisInfo` | `''` [4639] | none [4661] | none [4683] | none [4708] | data-pview axisinfo; contiene btn "Fresatura avanzata" [1730] |
| `panelExport` | none [4640] | `''` [4662] | none [4684] | none [4709] | — |
| `panelMisurareList` | none [4641] | `''` [4663] | none [4685] | none [4710] | — |
| `panelMisurareCompare` | none [4642] | `''` [4664] | none [4686] | none [4711] | — |
| `panelMisurareICP` | none [4643] | none [4665] | `''` [4687] | none [4712] | — |
| `panelClinicalStatus` | `''` [4644] | `''` [4666] | none [4689] | none [4713] | data-pview clinical; btn Report MUA [1687] |
| `panelMuaList` | `''` [4645] | `''` [4667] | none [4690] | none [4714] | data-pview mualist; albero MUA dinamico |
| `panelScanLoad` | `''` [4646] | `''` [4668] | none [4691] | none [4715] | data-pview scanload; dropzone `#slotScan` |
| `layersPanel` (sx) | flex [4650] | none [4671] | none [4692] | flex [4717] | albero scena |
| `panelScanbodyType` (Box A) | `''` [4617-4618] | `''` [4617-4618] | none | none | **fix 8.4.5** (ternary `analizza\|\|accoppia`) |
| `panelSostituire` | (uscita→none [4633]) | none | none | `''` [4725] | — |
| `panelFresabilita` | on-demand | — | — | — | aperto da `openFresability` [1730], chiuso da `closeFresability` [1737]; `display:none` default [1735] |
| `misurareStage` | hidden [4652] | hidden [4672] | condizionale [4697-4700] | hidden [4728] | stage caricamento ICP |

### Sotto-sezione — workflow **analizza** (`analysisMode='misura'`, ramo [4636])

Default all'avvio. Posizionamento e analisi angolare MUA. Elementi UI specifici (oltre a chrome + `.analisi-only`):

| Elemento | id | Evento | Funzione | Stato | Effetto | Righe |
|---|---|---|---|---|---|---|
| Radio Tipo scanbody 1T3/OS/SR | `#analyzeSbTypeRadio` | onchange | `setAnalyzeSbType` | `window._ANALYZE_SBTYPE` | tipo CAD (radius/searchR) per nuovi MUA | [1666-1669] |
| Report MUA (PDF) | `#btnAnalReport` | onclick | `analReport_generate` | muaObjects | genera PDF clinico | [1687] | disabled finché no MUA |
| Fresatura avanzata → | `#btnOpenFresability` | onclick | `openFresability` | — | apre `panelFresabilita` | [1730] |
| Drop scansione | `#slotScan` / `#inputScan` | onclick/onchange | `inputScan.click()` / `loadScan` | `scanMesh` | carica STL scansione | [1919-1930] |
| **Fresabilità**: macchina | `#fresMachineSelect` | onchange | `fresOnMachineChange` | fresatore sel. | aggiorna max angle | [1743] |
| **Fresabilità**: modo | `name="fresMode"` | onchange | `fresOnModeChange` | mean/minimax | strategia asse | [1752-1753] |
| Indietro (fresabilità) | | onclick | `closeFresability` | — | chiude pannello | [1737] |

Consumo stato: `placeMUA` ([2753]) legge `getAnalyzeSbType()`/`getAnalyzeSbCfg()`; `alignAll` rifà ICP per-MUA (ogni MUA ricorda `mua.sbType`, [2933]).

### Sotto-sezione — workflow **accoppia** (`analysisMode='accoppia'`, ramo [4658])

Esporta/confronta accoppiamenti. Condivide la toolbar `.analisi-only` con analizza (incluso Posiziona → quindi consuma `_ANALYZE_SBTYPE`). Pannelli propri:

| Elemento | id | Evento | Funzione | Effetto | Righe |
|---|---|---|---|---|---|
| Export: Scanbody/Matematica/Analogo | `#expSB`/`#expMT`/`#expAN` | checkbox | (lette da `exportComponents`) | selezione componenti | [1769-1771] |
| Esporta STL | `#btnExportComponents` | onclick | `exportComponents` | scarica STL componenti | [1774] |
| Aggiorna lista | `#btnMisurareRefresh` | onclick | `refreshMisurareList` | ricarica accoppiamenti | [1782] |
| Upload source/target | `#uploadMisurareSrc/Tgt` | onchange | `uploadMisurareFile(event,'src'/'tgt')` | carica STL confronto | [1810-1813] |
| Radio confronto 1T3/MT/AN | `name="compMis"` | radio | (lette da comparator) | tipo confronto | [1818-1820] |
| Apri Comparator v7 | `#btnOpenComparator` | onclick | `openComparatorV7` | apre comparator | [1822] | disabled di default |

### Sotto-sezione — workflow **misurare** (`analysisMode='misurare'`, ramo [4678])

Confronto ICP fra 2 STL, viewport dedicato (`misICP_mountViewport` [4701]). Pannello `panelMisurareICP` [1826]:

| Elemento | id | Evento | Funzione | Effetto | Righe |
|---|---|---|---|---|---|
| Carica STL A / B | `#misInputA` / `#misInputB` | onchange | `misICP_onPick(event,'A'/'B')` | carica mesh A/B | [1838-1848] |
| Esegui allineamento ICP | `#misBtnRun` | onclick | `misICP_run` | lancia ICP | [1849] | disabled finché 2 mesh |
| Ricomincia | `.mis-reset-btn` | onclick | `misICP_reset` | reset misurare | [1859] |
| Scarica report ▾ | `#misBtnReport` | onclick | `misICP_toggleReportMenu` | dropdown report | [1860] |
| → Clinico / Taratura / Analisi / Excel | | onclick | `misICP_generateReport('clinico'/'taratura'/'analisi'/'excel')` | genera report | [1863-1866] |
| Cutview ICP: select / chiudi / reset albero | `#misCutSelect` / `.mis-cut-close` / `.mis-tree-reset` | onchange/onclick | `misICP_openCutview` / `misICP_closeCutview` / `misICP_resetTreeDefaults` | gestione cutview | [1515-1530] |
| Albero ICP: visibilità / opacità layer | `#layChk*` / `#laySld*` | onchange/oninput | `misICP_applyLayerVis` / `misICP_applyLayerOp` | toggle/opacità bgA,scbA,bgB,scbB,labels | [1543-1608] |

### Sotto-sezione — workflow **sostituire** (`analysisMode='sostituire'`, ramo [4704])

Sostituzione scan body con ICP. Pannello `panelSostituire` [1876]:

| Elemento | id | Evento | Funzione | Stato | Effetto | Righe |
|---|---|---|---|---|---|---|
| Drop scansione partenza | `#sostSlotScan` / `#sostInputScan` | onclick/onchange | `sostInputScan.click()` / `sostOnScanPicked` | — | carica STL partenza | [1883-1886] |
| **Radio "Scansione di partenza" 1T3/SR/OS (Box B)** | `#sostSourceRadio` | onchange | `sostOnSourceChange` | `sostSourceTemplate`, `sostActiveTemplate` | tipo marker presente (allineamento) | [1889-1892] |
| Upload custom | `#sostInputCustom` | onchange | `sostOnCustomPicked` | — | template custom | [1895] |
| + Posiziona | `#sostBtnPlace` | onclick | `sostStartPlacement` | — | placement marker | [1899] |
| Raffina | `#sostBtnRefine` | onclick | `sostAlignAll` | — | ICP sostituzione | [1900] | disabled di default |
| Esporta STL | `#sostBtnExport` | onclick | `sostExportSTL` | `_sostExportPending` | apre **`#sostExportDialog`** (nome file precompilato) → Conferma scarica col nome scelto (sanificato, `.stl` auto); Annulla non scarica | [1907] | `display:none` default; dialog nome file (8.4.7) |

> **Box B vs Box A**: Box B (`sostSourceTemplate`) = tipo di marker **già presente** nella scansione di partenza, per la registrazione (`SOSTITUIRE_TEMPLATE_INFO`, `BBOX_LOCAL`, `T_ROOT` — [15106]/[15276]/[15286]). NON è ridondante con Box A (`_ANALYZE_SBTYPE`, che guida `placeMUA` in Analizza). Vedi fix 8.4.5 e 8.4.6 sopra.

---

## Vista: Vedere (`/vedere` → `syntesis-icp-vedere.html`)

Home di default (redirect da `/`). Viewer 3D multi-formato con misura, forme, annotazioni e sezione. ~8245 righe. **Wiring**: l'header usa `onclick` inline; la toolbar del viewer è cablata in JS (78 `addEventListener`). Gli handler reali dei bottoni toolbar sono **tracciati per-bottone** nella tabella sotto (nome funzione + riga del binding, verificati con `grep -n`). Righe = `syntesis-icp-vedere.html`.

### Header (inline)

| Elemento | Evento | Funzione | Effetto a valle | Righe |
|---|---|---|---|---|
| Home (nuova sessione) | onclick | `goHomeNewSession` | reset + home | [942] |
| Menu File | onclick | `toggleFileMenu` | dropdown | [948] |
| → Svuota scena | onclick | `clearScene` | rimuove le mesh | [953] |
| → Importa | onclick | `filePicker.click()` | file dialog | [958] |
| → Impostazioni | onclick | `openVedereSettings` | modal impostazioni | [964] |
| → Accedi/Logout | onclick | `vedereAuthClick` | login/logout | [971] |
| → Area personale | onclick | `window.open('/dashboard')` | apre dashboard | [978] |
| Menu WorkFlow → vedere/analizza/misurare/sostituire | onclick | `selectWorkflow(...)` | vedere = resta; analizza/misurare/sostituire = **redirect** a `/analizzare` | [990-1011] |

### Toolbar viewer (bottoni id, handler JS-wired via `addEventListener`)

| Elemento | id | Handler reale → riga binding | Cosa fa | Righe markup |
|---|---|---|---|---|
| Aggiungi file | `#btnPick` | `pickFiles` → [2727] | apre il file dialog (`filePicker.click()`, [2726]; input [1028]) | [1020] |
| Aggiungi (dup) | `#btnAdd` | `pickFiles` → [2728] | come btnPick: apre il file dialog | [1038] |
| Reset | `#btnReset` | arrow → [2800] | svuota scena: `clearAllMeasures`+`clearAllCircles`+`clearScene` | [1024] |
| Home camera | `#btnHome` | `fitCameraToScene` → [2807] | inquadra tutta la scena (fit camera) | [1104] |
| Sposta | `#btnMoveMode` | `setTransformMode('translate')` → [2808] | gizmo traslazione sull'oggetto selezionato | [1046] |
| Ruota | `#btnRotateMode` | `setTransformMode('rotate')` → [2809] | gizmo rotazione | [1049] |
| Deseleziona | `#btnDeselect` | `deselectLayer` → [2810] | deseleziona l'oggetto | [1052] |
| Righello | `#btnRuler` | arrow → [5732] | toggle misura distanza (`setRulerActive`; spegne cerchio) | [1056] |
| Angolo | `#btnAngle` | arrow → [5736] | toggle misura angolo (`setAngleActive`; spegne cerchio/righello) | [1059] |
| Forme Cerchio/Quadrato/Esagono/Ottagono/Torx | `#btnCircle`/`#btnSquare`/`#btnHex`/`#btnOct`/`#btnTorx` | `bindShapeButton(id,shape)` → [5811-5815] (def [5801]) | toggle annotazione forma (`setCircleActive` con la forma scelta) | [1066-1078] |
| Sezione | `#btnSection` | arrow → [7050] | se sezione attiva → `removeSection`; altrimenti `setSectionPlaceMode` | [1082] |
| Gomma | `#btnEraser` | arrow → [5746] | toggle gomma topologica (`setEraserActive`; spegne cerchio/righello/angolo) | [1085] |
| Pulisci righelli | `#btnRulerClear` | arrow → [5790] | `clearAllMeasures` + `clearAllCircles` | [1098] |
| Modalità render solid/wireframe/both | `[data-action="render-mode"][data-mode]` | **delegato**: `body.addEventListener('click')` [7376] → case `render-mode` [7975] | imposta `visual.renderMode` del layer via `SynRegistry.update` | [7694-7696] |
| Pannello sezione (PiP): chiudi/max/swap/righello/fit | `#secCloseBtn`/`#secMaxBtn`/`#secSwapBtn`/`#secRulerBtn`/`#secFitBtn` | `removeSection` [7060] / `toggleSectionPipMaxi` [7063] / `swapSectionPip` [7064] / arrow `setSectionRulerActive` [7065] / arrow `fitSectionCameraToContent` [7068] | controlli del PiP di sezione | [1129-1143] |
| Modal impostazioni Vedere | `#vsmClose` / `#vsmOk` | `close` → [8198] / [8199] | chiude il modale (creato lazy da `openVedereSettings` [8174], aperto da File→Impostazioni [964]) | [8183-8190] |

> **✅ "Primo click a vuoto" su `#btnPick` — RISOLTO in 8.4.8.** Sintomo (confermato runtime): al primo click il file dialog si apriva e si richiudeva subito; al secondo restava. Causa: `#btnPick` aveva **DUE** handler che chiamavano entrambi `filePicker.click()`:
> - `onclick` inline nel markup ([1020]: `onclick="document.getElementById('filePicker').click()"`)
> - `addEventListener('click', pickFiles)` ([2727], con `pickFiles` = `filePicker.click()` [2726])
>
> → due `.click()` sincroni sull'input file per un solo click utente → la seconda chiamata annullava il dialog appena aperto (flicker open→close). `#btnAdd` ([1038], pannello layer) non ha l'`onclick` inline (solo `addEventListener` [2728]) → single trigger, e infatti funzionava: coerente col fatto che il sintomo era **specifico di `#btnPick`**. (`filePicker.value=''` [2732] è nel handler `change`, non c'entra.) **Fix (8.4.8)**: rimosso l'`onclick` inline da [1020]; `#btnPick` ora ha il **solo** `addEventListener` [2727] → single trigger (un solo `filePicker.click()`), coerente con `#btnAdd`/`#btnReset`.

## Vista: Dashboard (`/dashboard` → `syntesis-dashboard-v1.html`)

Area personale (~3992 righe). Sidebar a tab (`switchTab` [1461]) + sezioni. Diverse azioni sono in **righe generate dinamicamente** (template string JS). Righe = `syntesis-dashboard-v1.html`.

| Elemento | Evento | Funzione | Effetto | Righe | Note |
|---|---|---|---|---|---|
| Vai all'app | onclick | `location.href='/analizzare'` | apre analyzer | [935],[964] | |
| Logout | onclick | `doLogout` | logout | [936] | |
| Tab sidebar | onclick | `switchTab('analyses'/'projects'/'files'/'contacts'/'cloud'/'profile'/'leaderboard'/casi-*/…)` | cambia sezione | [975-1043] | ~17 voci |
| Filtro analisi attive/archiviate | onclick | `switchFilter('active'/'archived')` | filtra | [1052-1053] | |
| Nuovo progetto | onclick | `openProjectCreate` | modal | [1066] | |
| Filtro progetti | onclick | `switchProjectFilter(...)` | filtra | [1068-1069] | |
| Nuova cartella condivisa | onclick | `openCreateSharedFolder` | modal | [1093] | |
| Nuovo contatto | onclick | `openContactCreate` | modal | [1113] | |
| Leaderboard filtri | onclick | `LBdash.filterBy('tipo',…,this)` | filtra classifica | [1184-1188] | |
| Ruolo PRO medico/laboratorio | onclick | `selectProRole(...)` | seleziona ruolo | [1302-1307] | |
| Conferma ruolo | onclick | `confirmProRole` | salva ruolo | [1313] | |
| Modal preview: scarica / chiudi | onclick | `downloadPreviewFile` / `closeModal('modalPreview');cleanupPreview()` | preview file | [1326-1327] | |
| Modal contatto: chiudi / salva | onclick | `closeModal('modalContact')` / `saveContact` | gestione contatto | [1365-1366] | |
| **(dinamico)** Analisi: dettaglio/modifica/PDF/archivia/elimina | onclick (injected) | `openDetail`/`openEdit`/`downloadPdf`/`setArchived`/`deleteAnalysis` | azioni per-analisi | [1701-1714] | iniettati a runtime |
| **(dinamico)** Paginazione | onclick (injected) | `changePage(-1/1)` | naviga pagine | [1726-1728] | |
| **(dinamico)** Progetti: dettaglio/modifica | onclick (injected) | `openProjectDetail`/`openProjectEdit` | azioni per-progetto | [2018-2028] | |

## Vista: Accedi (`/accedi` → `syntesis-accedi.html`)

Pannello accesso a 3 stati (login/registrazione/attesa→autorizzato), ~468 righe. **Wiring via `addEventListener`** (no onclick inline). Righe = `syntesis-accedi.html`.

| Elemento | id | Evento | Funzione (def / binding) | Effetto | Righe markup | Righe binding |
|---|---|---|---|---|---|---|
| Tab Accedi / Registrati | `#tab-login` / `#tab-register` | click | `setTab` [263] | mostra form | [142-143] | [270-271] |
| Form login: email, password | `#form-login` (`#l-email`,`#l-pass`,`#btn-login`) | submit | handler [378] | autentica → token | [149-154] | [378] |
| Form registrazione: nome,email,org,città,tel,password | `#form-register` (`#r-name`…`#r-pass`,`#btn-register`) | submit | handler [391] | crea utente pending | [161-176] | [391] |
| Pending: Controlla adesso | `#pending-check` | click | `checkStatus` [359] | polling `/auth/me` | [194] | [417] |
| Pending: Esci | `#pending-logout` | click | `logout` [421] | logout | [195] | [418] |
| Authorized: Copia chiave | `#copy-key` | click | handler [428] | copia chiave SICP | [212] | [428] |
| Authorized: Entra in Syntesis-ICP | `#enter-app` | click | handler [437] | → `/analizzare` | [217] | [437] |
| Authorized: Esci | `#auth-logout` | click | `logout` [421] | logout | [218] | [419] |

## Vista: Gestione (`/gestione` → `syntesis-gestione.html`)

Pannello admin (~390 righe). **Wiring via `addEventListener`**; righe utente generate da `render()` [262]. Righe = `syntesis-gestione.html`.

| Elemento | id / selettore | Evento | Funzione | Effetto | Righe markup | Righe binding |
|---|---|---|---|---|---|---|
| Filtro In attesa / Autorizzati / Tutti | `[data-f]` | click | handler (→ `render`) | filtra lista | [133-135] | [372] |
| Cerca | `#search` | input | `render` | filtra per nome/città | [140] | [381] |
| Ordina | `#sort` | change | `render` | riordina | [142] | [382] |
| **(per riga)** Autorizza | (injected) | click | `onAuthorize` [332] | genera chiave SICP, attiva utente | — | [325] |
| **(per riga)** Revoca | (injected) | click | `onRevoke` [343] | revoca accesso | — | [320] |
| Modal: Copia chiave / Chiudi | `#m-copy` / `#m-close` | click | handler | copia / chiudi | [173-175] | [357-359] |

---

## Funzioni chiave referenziate

| Funzione | File / Riga (def) | Cosa fa (1 frase) | Chiamata da |
|---|---|---|---|
| `selectWorkflow` | v3b [4565] | Commuta workflow analyzer e gestisce visibilità pannelli/toolbar | menu WorkFlow, `setMode` [4742] |
| `placeMUA` | v3b [2753] | Posiziona un MUA (legge `_ANALYZE_SBTYPE` → radius/searchR) | click viewport quando `placementMode` [2547] |
| `startPlacement` | v3b [2534] | Attiva `placementMode` | btn Posiziona [1353], tasto P [17176] |
| `alignAll` | v3b [2912] | Raffina con ICP tutti i MUA | btn Raffina [1363] |
| `loadScan` / `loadScanFile` | v3b [2511] / [2512] | Carica STL della scansione in `scanMesh` | `#inputScan` [1930], File→Importa |
| `hardReset` | v3b [4218] | Ricarica l'app con cache-bust `?_r=` | btn Reset [1262] |
| `newCase` | v3b [4165] | Reset del caso corrente (confirm se stato) | File→Nuovo [1222] |
| `setAnalyzeSbType` / `getAnalyzeSbType` / `getAnalyzeSbCfg` | v3b [1967] / [1986] / [1987] | Scrive/legge `_ANALYZE_SBTYPE` e cfg CAD | radio Box A [1666-1669]; `placeMUA` |
| `sostStartPlacement` / `sostAlignAll` | v3b [14960] / [15417] | Placement marker / ICP nel workflow Sostituire | btn `#sostBtnPlace` [1899] / `#sostBtnRefine` [1900] |
| `sostExportSTL` / `openSostExportNameDialog` / `closeSostExportNameDialog` / `confirmSostExport` / `_sostDoExport` | v3b [15718] / [15757] / [15765] / [15771] / [15787] | Export STL Sostituire con dialog nome file (8.4.7): valida + nome default → apre `#sostExportDialog` → Annulla / Conferma (sanifica) → `_sostDoExport` scarica | btn `#sostBtnExport` [1907]; `#sostExportDialog` |
| `sostOnSourceChange` | v3b [14812] | Scrive `sostSourceTemplate`/`sostActiveTemplate` (Box B) | radio Box B [1889-1892] |
| `_hardResetSostituire` | v3b [4503] | Reset stato Sostituire all'uscita | `selectWorkflow` [4592] |
| `misICP_run` | v3b [6264] | ICP di confronto fra 2 STL (Misurare) | btn `#misBtnRun` [1849] |
| `toggleLayersPanel` | v3b [3491] | Toggle albero scena (`layersPanel`) | btn Livelli [1337] |
| `openFresability` / `exportComponents` / `openCutView` / `openGroupDialog` / `openSettings` | v3b [5419] / [10095] / [10683] / [11501] / [12444] | Pannelli/dialog: fresabilità, export STL, cutview, gruppi, impostazioni | toolbar/pannelli Analizza/Accoppia |
| `saveCase` / `exportCase` / `undoLastMUA` / `clearAllMUA` / `toggleAxes` | v3b [3414] / [4228] / [4104] / [4111] / [3365] | Salva, esporta, annulla, reset MUA, toggle assi | menu File / toolbar |
| `syntesisOpenFileDialog` | v3b [17189] | Apre file dialog STL | btn Carica file [1331] |
| `switchTab` | dashboard [1461] | Cambia sezione della dashboard | sidebar [975-1043] |
| `render` / `onAuthorize` / `onRevoke` | gestione [262] / [332] / [343] | Render lista / autorizza (genera chiave) / revoca | filtri, righe utente |
| `setTab` / `checkStatus` / `logout` | accedi [263] / [359] / [421] | Tab login/reg / polling stato / logout | tabs, pannello pending |

> **✅ Vedere — handler toolbar: RISOLTO.** Le funzioni legate ai bottoni toolbar sono ora tracciate per-bottone (nome + riga del binding) nella tabella "Toolbar viewer" della sezione Vedere.

## Stato globale e classi di visibilità

### Global JS principali (analyzer `syntesis-analyzer-v3b.html`)

| Global | Scritto da | Letto da | Riga init/chiave |
|---|---|---|---|
| `currentWorkflow` | `selectWorkflow` [4595] | rami/guardie workflow | — |
| `analysisMode` (`'misura'`/`'accoppia'`/`'misurare'`/`'sostituire'`) | rami `selectWorkflow` [4637/4659/4679/4705] | guardie `calculateAngles`/`calculateMeanAxis` [3228/3302] | — |
| `scanMesh` | `loadScanFile`, `newCase`, `hardReset` | `placeMUA`, export, stato | — |
| `muaObjects` | `placeMUA`, `clearAllMUA`, `newCase` | analisi angolare, report | — |
| `window._ANALYZE_SBTYPE` | `setAnalyzeSbType` [1969] | `getAnalyzeSbType`/`placeMUA` | init [1966] |
| `sostSourceTemplate` / `sostActiveTemplate` | `sostOnSourceChange` [14813-14814] | pipeline Sostituire ([15106],[15276],[15286]) | decl [14688] |
| `placementMode` | `startPlacement` [2534] | click handler [2541] | — |
| `envSettings` | `openSettings`/impostazioni | render mesh, export | — |

### Classi di visibilità per-workflow (recap, `selectWorkflow`)

| Classe | analizza | accoppia | misurare | sostituire | Righe toggle |
|---|---|---|---|---|---|
| `.analisi-only` | ✅ | ✅ | ✕ | ✕ | [4647]/[4669]/[4694]/[4719] |
| `.misurare-only` | ✕ | ✕ | ✅ | ✕ | [4648]/[4670]/[4695]/[4720] |
| `.sostituire-only` | ✕ | ✕ | ✕ | ✅ | centralizzato a fine `selectWorkflow`: `''` in sostituire, `none` altrove — **corretto 8.4.6** |
| `.icon-only` | — | — | — | — | non-gating (styling) |
| `panelScanbodyType` (id) | ✅ | ✅ | ✕ | ✕ | [4617-4618] (fix 8.4.5) |

Più i pannelli per-id nella **matrice di visibilità** della sezione Analizzare.

### Note cross-vista

- `selectWorkflow('vedere')` (in `/analizzare`) e i workflow analizza/misurare/sostituire (in `/vedere`) sono **redirect** tra le due pagine: l'analyzer e il viewer sono due file/route distinti che condividono la barra WorkFlow.
- Vedere, Accedi, Gestione cablano l'interattività via `addEventListener` (non `onclick` inline); Dashboard e Analyzer usano prevalentemente `onclick` inline + righe dinamiche.

---

_Fine mappa. Stato: tutte e 5 le viste coperte; **nessuna voce DA CHIARIRE aperta**. Storico risolto: (1) handler toolbar Vedere → tracciati per-bottone; (2) "primo click a vuoto" `#btnPick` → **RISOLTO in 8.4.8** (rimosso doppio trigger: onclick inline su #btnPick, ora solo addEventListener)._
