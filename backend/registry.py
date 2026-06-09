"""Syntesis-ICP - Registry delle costanti del dominio.

Fonte di verita' UNICA per:
- Costanti CAD dei tre tipi di scanbody (1T3, OS, SR)
- Soglie cliniche (d3, MUA cone, divergenza, fresabilita')
- Palette colori (cliniche, brand)
- Configurazioni globali (ambiente, miller, algoritmo)

Questo file viene letto da:
- icp_engine.py (calcoli ICP server-side)
- pdf_gen.py (rendering report)
- /api/registry/constants (esposto ai frontend al boot)

Convenzione T_root (Fase A audit layer condivisi, 2026-05-02):
    M = T * R
    "Prima ruoto il punto rispetto all'origine canonica, poi lo traslo."
    Implementata in build_T_root_matrix() qui sotto.

Nessun frontend dovrebbe avere costanti CAD hardcodate. Se le ha, sono debito
da rimuovere nelle Fasi A.5 e A.6 dell'audit. Single source of truth: questo file.
"""

import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
# VERSION & METADATA
# ─────────────────────────────────────────────────────────────────────────────

# Versione del backend nel suo insieme. Bumpa ad ogni commit che tocca codice
# Python in backend/ (esclusi commit chore tipo CACHEBUST). Schema:
#     MAJOR.MINOR.BUILD-FASE.STEP   p.es. 8.1.5-A.4.1
# 8.x indica l'era post-v3b unificato (allineato alla serie Analizzare).
# Suffisso "-A.X" traccia la fase del refactor layer condivisi.
# Quando si promuove la Fase A in produzione, il suffisso sparisce -> 8.2.0.
#
# History:
#   8.13.0         (2026-06-09): FEAT motore asse "lateral-wall" robusto su due path (chiude il gap angolare con Exocad; root = fit dell'asse, NON l'ICP). FIX #1 (report Misurare ICP): misICP_cylAxis (v3b ~6359) con setting syntesis_axis_engine='lateralwall' raffina l'asse cap-PCA dalla parete laterale (minor eigenvector di M=Σ area·nnᵀ sui triangoli con |n·seed|<0.35, via misICP_jacobi3; fallback al seed cap se <8 laterali); default 'cap' bit-identico. Il cap-PCA aveva ~1.2° di errore strutturale su scanbody SR (tozzo, un cap + base aperta). FIX #2 (coupling Sostituire, il root): sostAlignAll/Raffina (v3b ~15741 crop loop + ~15908 apply block) — il point-ICP resta SOLO per il centraggio (R,t invariati), l'ASSE finale viene da un fit lateral-wall della PARETE della scansione e ri-orienta il marker attorno a p.position (delta-rotazione T(+pos)·Rd·T(-pos) propagata a g.matrix->export); fallback = R·seed attuale se <8 triangoli parete. Prima il Raffina sovrascriveva l'asse buono col rumore del point-ICP (~1° non-rigido). VERIFICA su click utente reali (mock, scansioni barra ID 2161): degrado angoli relativi del Raffina 0.66°->0.13° (-81%); incoerenza export scan-to-scan (prima vs seconda) 0.95°->0.14-0.31° = Exocad. node --check PASS, gate sintassi OK, design+verifica 4-lensi su entrambe le patch. Bump v3b <title>+ANALIZZA_BUILD. docs/MAPPA_FUNZIONALE.md aggiornata. Rischio residuo: guardia conta triangoli non spread angolare (stesso limite del motore di placement gia' in prod). NESSUN deploy in questo commit.
#   8.12.1         (2026-06-08): FIX Sostituire: Raffina (sostAlignAll) reso idempotente a convergenza. Guard di rigidita' sulla trasformazione TOTALE accumulata dall'ICP, dentro il forEach per-marker dopo il loop ICP e prima della matrice rigida Rm (v3b ~15750): se rotazione < 0.01 deg E traslazione < 0.001 mm (1 um) la posa e' gia' convergente -> return (no-op), il marker non si muove. Prima ogni click applicava una micro-trasformazione residua (Racc/tAcc mai esattamente identita') = drift ~um a ogni Raffina su scan rumorosi. Il return precede nRefined++ -> i marker gia' convergenti non contano in "Raffinamento completato (N/M)". ICP/pesi/crop/accumulo Racc/tAcc INVARIATI. Gate visivo su scan reali OK; node --check sul blocco script PASS. Codice gia' committato in e6b402a; questo commit = solo bump dei 3 punti canonici (registry/<title>/ANALIZZA_BUILD). MAPPA_FUNZIONALE.md NON toccata (riallineamento drift in passo dedicato). FASE 1: bump+push, NESSUN deploy.
#   8.10.1         (2026-06-04): FIX UI /accedi: logo top-left dal wordmark testuale "Syntesis ICP" al logo brand reale /static/synthesis-logo.png (lo stesso della home e degli header del software), reso bianco sul pannello scuro via filter:invert(1) brightness(1.9), height 66px. Corregge anche l'incoerenza "Syntesis" (senza-h) del testo -> branding corretto "Synthesis". Solo syntesis-accedi.html (markup .brand + CSS .brand-logo). v3b <title>/ANALIZZA_BUILD e pdf_gen NON toccati (restano 8.10.0: pattern non-v3b come 8.6.4 home-only -> backend_version 8.10.1, title v8.10.0). Branch fix-accedi-logo, merge no-ff. Verificato sul mock (logo caricato 3256x931, reso 66px, filtro bianco).
#   8.12.0         (2026-06-05): REFACTOR estrazione PANEL/UI INFRA /analizzare dal monolite -> modulo backend/static/ds/syn-panel.js (campagna modularizzazione v3b, 2° modulo). Spostato il blocco <script> inline di fine body (v3b ex 17062-17766, 703 righe: pannelli drag/resize [synMakePanelDraggable/makeDraggable/makeResizable/setupKnownPanels], persistenza view-state [applyViewState/hidePanel/showPanel/toggleViewPanel/resetViewPanels/toggleCollapsedPanel], rail colonna destra [applyRightColumnRail/toggleRightColumnRail], view-menu [toggleViewMenu/closeViewMenu/_refreshViewMenu], tooltip data-tip [3x IIFE migrateTitles dead-dup], helper carica-file [syntesisOpenFileDialog/syntesisRefreshLoadFileButton], onSyntesisViewModeChange). MECCANISMO: RELOCAZIONE IN-PLACE VERBATIM (classic non-strict, NON IIFE strict come clip): <script src> al posto dell'inline ALLA STESSA RIGA = timing identico (readyState, DOMContentLoaded/setTimeout, ordine vs script monolite); ZERO modifiche al codice; funzioni globali restano globali per gli handler inline del markup (invariati). Diff v3b: +1 (<script src>) / -705 (blocco). NESSUN link cross-modulo (clip/render/gate); localStorage chiavi proprie syntesis_panel_*/syntesis_analizza_view/_rail (non condivise). GATE di equivalenza (scripts/gate/panel, browser reale via preview): G0 byte-identita' + G1 esposizioni 16/16 + G2 view-state + G3 rail + G4 view-menu + G6 tooltip -> old(inline) == new(modulo) diff 0, zero errori console. node --check OK su tutti i blocchi. NB FRAGILITA' PRE-ESISTENTE verbatim (syntesisRefreshLoadFileButton ~riga 293: "... && scanMesh" bare ref) -> innocua in prod (scanMesh dichiarato in script #4 che gira prima), esposta dal gate browser. Bump v3b <title>+ANALIZZA_BUILD. docs/MAPPA_FUNZIONALE.md: handler panel -> ds/syn-panel.js. Branch refactor-extract-panel-ui, merge no-ff.
#   8.11.0         (2026-06-05): REFACTOR estrazione CLIP ENGINE /analizzare dal monolite -> modulo backend/static/ds/syn-clip.js (campagna modularizzazione v3b, 1° modulo). Spostato il blocco clipping plane + stencil cap + pannello "Taglio" (v3b ex 2574-2717, 144 righe: synClipArr/synMakeStencilGroup/synPositionCap/synUpdateClipPlane/synRebuildClip + openTaglio/closeTaglio/tagSyncUI/tagOn* /tagForceScanOpaque + stato synClip*/tagState) in <script src> classico (stile syn-render.js/syn-gate.js; parse-safe: legge window.THREE solo a call-time post three-ready). MECCANISMO: stato come proprieta' window.synClip* + funzioni ri-esposte coi NOMI BARE su window -> i call-site esterni del monolite (loadScanFile [2580], rebuildScanMeshGeometry [11494],[11532], "opacita' comanda" treeUnified_setScanOpacity [3867]/ghostAll [3897] che scrivono synClipEnabled, handler inline #panelTaglio) restano INVARIATI. Diff v3b: +1 (<script src>) / -144 (blocco). MOTORE INVARIATO. GATE di equivalenza (scripts/gate/clip, harness Node A/B con THREE reale headless): G1 numerico/strutturale (piano normale/const, centro/diag, stencil group, cap pos/quat/material) + G2 DOM pannello -> golden(verbatim) == after(modulo), 0 scostamenti a precisione piena (Object.is). node --check OK su tutti gli 8 <script> inline. Bump v3b <title>+ANALIZZA_BUILD. docs/MAPPA_FUNZIONALE.md: sorgente handler/motore -> ds/syn-clip.js. Branch refactor-extract-clip-engine, merge no-ff.
#   8.10.0         (2026-06-04): RELEASE allineamento motori rendering r169 su TUTTE le superfici 3D (stessa pipeline via fonte unica ds/syn-render.js: applyRendererPipeline = CM ON + SRGBColorSpace + NoToneMapping + localClipping; addCameraLightRig = Ambient 1.2 / key 1.8 / fill 0.75; makeGradientTexture sRGB). F1: estratto core ds/syn-render.js + retrofit /analizzare a comportamento INVARIATO (gate pixel diffPixels=0, scanMeanLum/tint/contrast identici). F2: /vedere r128->r169 (loader importmap+bridge window.THREE, init eager->differito a three-ready, addon jsm TrackballControls/TransformControls[scene.add getHelper(), breaking r163]/OBJLoader/PLYLoader, clip/stencil sezione+PiP riconciliati; colore Delta=0 vs /analizzare a parita' di input). F3: /dashboard preview STL r128->r169 (import('three') dinamico lazy + applyRendererPipeline); ZERO r128 residuo nel codebase (verificato grep). Inoltre: FIX bug async orfano pre-esistente /dashboard (ReferenceError a ogni load, interrompeva l'init top-level a valle - var/setInterval/keydown); color picker /vedere nativo (<input type=color class=tree-color> + setSceneObjectColor copiato, come /analizzare 8.9.0, preservando vertex-color/highlight Vedere); reticolo "Entrambi" /vedere uniformato a /analizzare (WireframeGeometry+LineSegments nero 0.35, era MeshBasicMaterial blu density-scaled). Misurare ICP + Sostituire erano gia' r169 (workflow dentro /analizzare). Verifica visiva utente OK su /vedere. Bump registry/v3b/pdf_gen 8.9.0->8.10.0; /vedere resta v8.0.0-refactor (tag architetturale, non discriminatore). Catena F1->F2->F3->fix-async->color-picker->reticolo mergiata no-ff.
#   8.9.0          (2026-06-03): FEAT color picker per-oggetto negli alberi scena (/analizzare, Misurare ICP, Sostituire). Il pallino colore di ogni oggetto diventa <input type="color"> (classe .tree-color). GESTIONE UNICA per tutti gli alberi: funzione setSceneObjectColor(target, hex) + helper __synApplyColor (applica a mesh/array/group THREE in modo uniforme); le 4 funzioni ad-hoc iniziali (setLayerColor/misICP_setLayerColor/sostSetScanColor/sostSetTemplateColor) sono state rimosse e consolidate. Target: 'scan' (scanMesh + envSettings.scanColor); 'mua:'+idx (m.color + connessione mtMesh/analogo anMesh/asse axisLine; lo scanbody mantiene il colore-brand per tipo 1T3/OS/SR = codice clinico, NON sovrascritto, scelta utente: un colore per MUA); 'icp:'+group (4 layer bgA/scbA/bgB/scbB via misICP_groupMeshes; storage misICP_layerColors); 'sostscan' (scansione Multi-A); 'sosttype:'+key (marker per TIPO 1T3/SR/OS: gruppi sostPlaced + SOSTITUIRE_TEMPLATE_INFO, scelta utente per-tipo). Verificato su mock: dispatch unico applica al material per scan/icp/sosttype/sostscan; vecchie funzioni rimosse (undefined). PERSISTENZA: i colori vivono nello stato scena; salvataggio/ripristino "nel caso" demandato al progetto dedicato "apri caso" (il viewer oggi NON ricarica un caso salvato: saveCase/exportCase sono export JSON, nessun load). Bump v3b <title>+ANALIZZA_BUILD, pdf_gen.py VERSION. Branch feat-colori-albero, NON deployato. docs/MAPPA_FUNZIONALE.md aggiornata.
#   8.8.1          (2026-06-03): FIX resa colore /analizzare (3 fix pipeline colore r169). (1) ColorManagement.enabled = true (era false 8.7.0-8.8.0): pipeline coerente, i colori materiale (scanColor, MUA, sfondo) decodificati sRGB->lineare in input e ri-encodati in output -> sparisce il viraggio verso il giallo/chiaro (scanColor reso R/G 1.43->1.88 = colore scelto). (2) Ri-taratura luci col RAPPORTO r128 0.4:0.6:0.25 scalato x3 -> Ambient 1.2 / key bianca 1.8 / fill bluastra 0.75 (8.8.0 era 1.3/1.3, ambient-gonfiato -> piatto): recupera chiaroscuro/tridimensionalita' (contrasto std ~8->~13); il rapporto direzionale:ambient=1.5 e' il limite oltre cui lo specular bianco lava la tinta. (3) makeGradientTexture: tex.colorSpace=SRGBColorSpace (la CanvasTexture sRGB era letta come lineare -> sfondo schiarito/bruciato; ora fedele al colore scelto, es. #438DD6 reso 67,141,214). Misurato su mock (scan SR 002140_Ds1, solid/clip off/camera fissa): scanMeanLum ~133, clip 0, scan + MUA 1T3 #FFAA44 non slavati (whiteBurn 0%). NoToneMapping + outputColorSpace=SRGBColorSpace invariati. Bump v3b <title>+ANALIZZA_BUILD, pdf_gen.py VERSION. Branch feat-colore-cm, NON ancora deployato/mergiato.
#   8.8.0          (2026-06-03): UI PRODOTTO pannello "Taglio" su /analizzare. Sostituisce il pannello provvisorio #synClipUI (rimossi synAddProvisionalClipUI + window.__synClip) con pannello dedicato #panelTaglio, aperto dal pulsante #btnOpenTaglio nella view-mode bar, sul modello Fresabilita' (openTaglio/closeTaglio, tagState.isOpen, NON tocca analysisMode). Rinominato da "Sezione" a "Taglio" per non collidere col cutview per-MUA esistente (openCutView/misICP_toggleCutview/sostOpenCutView). Stile: classi/token gia' usati dai pannelli analyzer (.panel-section/.panel-label/.comp-radio/.export-checkbox + var(--*)), zero hex hardcoded. I 4 controlli (taglio attivo / asse X-Y-Z / posizione / inverti) pilotano i globali del motore clip (synClipEnabled/Axis/Pos/Flip + synUpdateClipPlane): MOTORE r169 clipping/stencil/polygonOffset INVARIATO. Default taglio OFF (scansione carica intera/opaca). CONVIVENZA "opacita' comanda" (chiude il debito 8.7.0): opacita' <100% o ghost disattivano il taglio (treeUnified_setScanOpacity/treeUnified_ghostAll); riattivare il taglio forza la scansione opaca + slider opacita' a 100% (tagForceScanOpaque) -> il cap stencil non viene mai rotto dalla trasparenza. Riallineato sopra 8.7.2 (rebase su main: fix 8.7.1 Posiziona Entrambi + 8.7.2 colore SRGBColorSpace inclusi, verificato che il pannello non tocca outputColorSpace/intersectObject/onViewportClick). COLORE (compensazione luminosita' r169): la migrazione legacy->fisica lasciava lo scan a ~2/3 della resa r128 (scanMeanLum ~100 vs target v8.5.0 ~154); alzate le luci Ambient 0.4->1.3 e key bianca 0.6->1.3 (fill bluastra 0.25 INVARIATA per non virare la tinta) -> scanMeanLum ~100->~150 (dentro +-5% del target), clip highlight 0% (no burn), tinta ambra preservata (R/G 1.42), MUA non slavati (0% bianco pieno). Leva = sole intensita' luci; SRGBColorSpace + NoToneMapping INVARIATI (toneMappingExposure inerte con NoToneMapping). Misurato su mock (scan SR 002140_Ds1, solid/clip off/camera fissa). Bump v3b <title>+ANALIZZA_BUILD, pdf_gen.py VERSION. docs/MAPPA_FUNZIONALE.md mappa il pannello "Taglio" (versione mappata 8.8.0). Branch feat-pannello-taglio, NON ancora deployato/mergiato.
#   8.7.2          (2026-06-03): FIX resa colore r169 (regressione cromatica): scansione marrone scuro/desaturata vs arancione caldo di v8.5.0 (r128). Causa: renderer.outputColorSpace = LinearSRGBColorSpace (8.7.0) -> output lineare crudo, niente encoding sRGB per il display -> midtoni schiacciati (superficie scan V~22% vs ~63% in r128). NON era toneMapping (NoToneMapping in entrambi) ne' input colore (material.color identico (0.722,0.627,0.565), CM off). FIX: outputColorSpace = SRGBColorSpace (1 riga, v3b ~2459) -> V 22->50%, S 17->8% (verso target), arancione ripristinato; MUA non vanno fluo (OETF sRGB desatura, non sovrasatura), sfondo regge. Residuo (V 50 vs 63, tinta 24 vs 11 deg) = modello luci legacy->fisico THREE, NON compensato (luci 0.4/0.6/0.25 invariate). Misurato su mock (scan.stl 219k, solid, camera home, 1400x900). Bump v3b <title>+ANALIZZA_BUILD, pdf_gen VERSION; docs. Branch fix-colore-r169, NON deployato/mergiato.
#   8.7.1          (2026-06-03): FIX "Posiziona" MUA morto in modalita' "Entrambi" su r169 (bug live 8.7.0, beta). onViewportClick [v3b ~2673] faceva raycaster.intersectObject(scanMesh) senza 2o arg -> recursive default TRUE -> intersecava anche l'overlay wireframe (LineSegments figlio di scanMesh, presente solo in "Entrambi"); l'overlay veniva colpito per primo (piu' vicino, soglia linea 1mm) e non ha .face -> placeMUA(hits[0].point, hits[0].face.normal) lanciava TypeError -> nessun MUA (errore console non notato). FIX: intersectObject(scanMesh, FALSE) (non ricorsivo, esclude i figli) + guardia hits[0].face. In Solid/Wireframe l'overlay non esiste (infatti li' funzionava). Verificato mock r169: placement OK Solid/Wireframe/Entrambi + Raffina, console pulita. NON tocca motore clip/stencil. Branch fix-posiziona-r169, NON deployato/mergiato. NB: dev-sezione-ui (8.8.0) e' sulla r169 pre-fix -> al disgelo va portato dentro questo fix. Bump v3b <title>+ANALIZZA_BUILD, pdf_gen VERSION; docs aggiornate.
#   8.7.0          (2026-06-03): MOTORE RENDERING /analizzare: upgrade Three.js r128->r169 (ES module + bridge window.THREE via Object.assign copia estensibile; OrbitControls e parser STL custom-inline invariati) + CLIPPING PLANE + STENCIL CAP (pattern ufficiale createPlaneStencilGroup + renderer.clearStencil() in onAfterRender; renderOrder stencil group 1 / cap plane 1.1 / mesh visibile 6) che SOSTITUISCE la trasparenza della scansione per il "vedere dentro". Scansione ora OPACA + polygonOffset(1,1) (reticolo nitido in "Entrambi"). Clip solo sulla scansione: MUA interi e leggibili. Colori identici a r128 (ColorManagement.enabled=false + outputColorSpace=LinearSRGBColorSpace); luci 0.4/0.6/0.25 INVARIATE (verificato r128 vs r169 sulla stessa scansione: meanTop20Lum 168.4 vs 167.5, nessuna compensazione necessaria). Pannello "Sezione" PROVVISORIO (solo verifica motore; UX taglio definitiva = step successivo). DEBITO CONSAPEVOLE: slider opacita'/ghost esistenti convivono ancora col clipping e rimettono la trasparenza -> da integrare (riuso slider come profondita'-taglio), NON e' un bug. Chiude il sospeso "Bug rendering viewport /analizzare" (era design aperto). Branch dev-three-upgrade, NON ancora deployato/mergiato. Bump v3b <title>+ANALIZZA_BUILD, pdf_gen.py VERSION. docs/MAPPA_FUNZIONALE.md versione mappata 8.7.0. Hook syntax-check.sh reso type-aware (importmap/module). Fix A culling MUA FrontSide (revertito in 8.6.8) era corretto, da ririprovare a parte.
#   8.6.8          (2026-06-02): REVERT stack rendering viewport /analizzare 8.6.5-8.6.7 -> ritorno allo stato rendering 8.6.4. I tre fix (8.6.5 culling MUA FrontSide, 8.6.6 depthWrite accoppiato all'opacita', 8.6.7 scanMesh.renderOrder=1) hanno peggiorato l'usabilita' in Solid (risultato cumulativo meno leggibile dell'originale). git revert dei 3 commit (ab4b2c4, b8a54f2, 99ef34e) in ordine inverso -> codice viewport byte-identico a 8.6.4 (verificato: diff netto 0; MUA di nuovo side:THREE.DoubleSide, depthWrite coupling rimosso dai 3 punti load/setScanOpacity/ghostAll, scanMesh.renderOrder rimosso; camera/renderer invariati). Solo i marker di versione cambiano (8.6.4->8.6.8, monotono, niente secondo 8.6.4). Il difetto rendering (scansione grande/avvolgente/concava + trasparenza order-dependent Three.js r128) e' un limite di tecnica, non un flag mancante: ripensato in sessione dedicata (clipping/sezione invece di trasparenza dell'intera mesh). Il Fix A culling era di per se' corretto, riprovabile a parte. Vedi Sospesi STATO_SISTEMA. Bump v3b <title>+ANALIZZA_BUILD 8.5.0->8.6.8 (revert tocca v3b). docs/MAPPA_FUNZIONALE.md versione mappata 8.6.8.
#   8.6.4          (2026-06-01): RIFINITURA allineamento home su desktop ampio (synthesis-home.html). Su schermi medi/grandi il logo stava in una topbar separata sopra l'hero -> piu' in alto e scollegato dall'immagine, e piccolo. Modifiche: logo spostato DENTRO .hero-left come primo elemento (ordine logo->headline->lead, stesso bordo sinistro) + .hero align-items center->start -> top del logo = top dell'immagine (misurato a 1920x1080: scarto 166px -> 0). Logo piu' grande: height clamp(48px,8vh,84px)->clamp(70px,12vh,124px) (+48%). Eyebrow "Synthesis-ICP" RIMOSSO dall'HTML (assente nel riferimento utente; il logo ne fa le veci) -> la regola CSS .eyebrow resta orfana (follow-up cleanup, §3.4). Layout piu' ampio: .page max-width 1340->1600px + justify-content:center -> margini simmetrici (a 1920x1080: sx=dx=192px, alto=basso=105px). .hero flex 1 1 auto->0 0 auto (niente vuoto sotto l'immagine). Immagine a filo del bordo destro = ultima card (1706=1706). Desktop basso (<=900px h) e mobile (<=900px w) protetti con justify-content:flex-start + logo ridimensionato -> "una schermata" e responsive verticale invariati (overflow scroll = 0). Verificato via JS getBoundingClientRect a 1920x1080. Solo synthesis-home.html. v3b NON toccato. docs/MAPPA_FUNZIONALE.md aggiornata (regola §4). Niente CACHEBUST.
#   8.6.3          (2026-06-01): FIT home 16:9 anche su schermi bassi (synthesis-home.html). 8.6.2 stava in una schermata sui monitor ampi/alti, ma su desktop bassi (~13", viewport <=~880px d'altezza) il contenuto sforava ~39px (misurato live; causa: .hero-img max-height:min(58vh,100%) col 100% indefinito -> non rimpiccioliva). Fix ADDITIVO (base 8.6.2 invariata -> look generoso intatto sugli schermi ampi): @media (min-width:901px) and (max-height:900px) comprime logo/headline/lead/immagine(max-height:44vh)/card/padding/gap SOLO sui desktop bassi -> stessa composizione, niente scroll. @media (min-width:901px){.viewport{overflow:hidden}} azzera la barra per il residuo sub-pixel del flex (clippa solo padding di fondo, mai contenuto). Mobile invariato (verticale, overflow-y:auto dentro la cornice). Solo synthesis-home.html. v3b NON toccato. docs/MAPPA_FUNZIONALE.md aggiornata (regola §4). Niente CACHEBUST.
#   8.6.2          (2026-06-01): LAYOUT home "una schermata" + fix definitivo contenuto-sotto-cornice (synthesis-home.html). Architettura: .viewport position:fixed inset:22px (= cornice 18 + bordo 4) con overflow-y:auto -> lo scroll vive DENTRO la cornice, niente piu' contenuto sotto l'anello. Desktop 16:9: .page flex-column con misure in vh/clamp (logo, headline, lead, immagine max-height min(58vh,100%), card padding/icone/testi) -> logo+hero+4 card stanno tutti in 100vh, niente scroll verticale. Mobile <=900px: .viewport torna block (scroll naturale, ma dentro la cornice), layout verticale (logo->testo->immagine->card, 2 col <=900 / 1 col <=560). Mantenuti: cornice cava animata, tema scuro, logo invert bianco, hover card, link workflow. Immagine invariata (crop su Desktop non ancora committato, vedi STORIA). Solo synthesis-home.html. v3b NON toccato. docs/MAPPA_FUNZIONALE.md aggiornata (regola §4). Niente CACHEBUST.
#   8.6.1          (2026-06-01): FIX home dark invisibile (synthesis-home.html): la cornice .synt-frame riempiva il proprio interno con linear-gradient(--dark) clippato a padding-box e, a z-index:9999 sopra .page, faceva da coperchio -> tutto il contenuto invisibile (visibile solo il bordo). Fix: cornice CAVA via mask (conic-gradient su tutto l'elemento + -webkit-mask/mask-composite:exclude che esclude il content-box -> interno trasparente, contenuto sotto visibile); mantenuti spin (@property + @keyframes syntSpin), position:fixed, pointer-events:none, glow. Robustezza: animazioni d'ingresso (fadeUp/Down/In) spostate sotto @media prefers-reduced-motion:no-preference -> contenuto opacity:1 di default, animazione solo enhancement (non puo' piu' lasciare invisibile). Solo synthesis-home.html. v3b NON toccato. docs/MAPPA_FUNZIONALE.md aggiornata (regola §4). Niente CACHEBUST.
#   8.6.0          (2026-06-01): MINOR redesign DARK della home (synthesis-home.html): tema scuro (--dark #0F1923) + bordo perimetrale animato (.synt-frame: div position:fixed in overlay, inset 18px, conic-gradient #FF8C42/#FF4D8D/#FFD166/#C84BFF/#FF6B35/#FF9FC8 con angolo --synt-sa animato via @property + @keyframes syntSpin 4s linear infinite; pointer-events:none -> non blocca i click, fermo allo scroll). Layout: header con logo (filter invert(1) brightness(1.9) -> il PNG nero diventa bianco), hero eyebrow + headline con accent blu + lead, immagine /static/assets/padova-17_001.jpeg dentro card chiara .hero-img-wrap (ombra/glow) che la stacca dal fondo scuro, 4 tool-card scure con hover-lift e SVG inline. Link card invariati. Solo synthesis-home.html (i 2 segnaposto del template sostituiti coi file reali; rimossi CSS/commenti orfani). main.py invariato (/ serve gia' synthesis-home.html). v3b NON toccato (ANALIZZA_BUILD/<title> restano 8.5.0). docs/MAPPA_FUNZIONALE.md aggiornata (regola §4). Niente CACHEBUST.
#   8.5.1          (2026-06-01): UI redesign testata+hero della home (synthesis-home.html): logo topbar 42px->84px (PNG 3256x931@300dpi -> niente sgranatura) + rimosso suffisso "ICP"; hero -> rimosso l'H1 "Synthesis-ICP" (ridondante col logo), tagline promossa a headline (blu 30px), immagine /static/assets/padova-17_001.jpeg ingrandita (grid 1fr 1.25fr) e fusa nel fondo (rimossa card/bordo/ombra). Sfondo PAGINA unificato a #F0F1F5 (= colore reale campionato dal fondo del JPEG; sostituisce --pearl #F0F5FA sul body) -> fondo continuo dall'alto in basso, l'immagine si fonde senza fascia ne' bordo; le card bianche restano staccate. Responsive stack testo-sopra-immagine. Solo synthesis-home.html. v3b NON toccato (ANALIZZA_BUILD/<title> restano 8.5.0); registry.BACKEND_VERSION = versione canonica. docs/MAPPA_FUNZIONALE.md aggiornata (regola §4). Niente CACHEBUST.
#   8.5.0          (2026-06-01): FEAT splash/home pubblica su / (backend/static/synthesis-home.html). Sostituisce il redirect 302 a /vedere: logo synthesis-logo.png + nome "Synthesis-ICP" + tagline + immagine hero (/static/assets/padova-17_001.jpeg) + griglia 4 card workflow (Vedere/Analizzare/Misurare/Sostituire) con le 4 SVG del menu WorkFlow, link a /vedere, /analizzare, /analizzare?wf=misurare, /analizzare?wf=sostituire. Statica/vanilla, CSS inline, design token riusati da vedere.html (:root). main.py: GET / ora FileResponse(synthesis-home.html), PUBBLICA (nessun gate; fallback /vedere se il file manca). v3b.html: reader ?wf= al DOMContentLoaded che apre il workflow richiesto (valida analizza|accoppia|misurare|sostituire, default analizza; mirror del pattern ?file_id= di Vedere); setTimeout(0) per girare dopo l'init. syn-gate.js preserva gia' la query string (rememberDeepLink, pathname+search) -> il deep-link ?wf= sopravvive al redirect /accedi e torna dopo login. MINOR (feature nuova): bump <title>/ANALIZZA_BUILD v3b -> 8.5.0 (v3b toccato). docs/MAPPA_FUNZIONALE.md aggiornata (regola §4). Niente CACHEBUST.
#   8.4.8          (2026-06-01): FIX primo-click "a vuoto" su #btnPick in syntesis-icp-vedere.html (Vedere): il file dialog si apriva e si richiudeva subito al primo click, al secondo restava. Causa: doppio trigger — #btnPick aveva sia onclick inline (document.getElementById('filePicker').click(), markup ~1020) sia addEventListener('click', pickFiles) (~2727, con pickFiles = filePicker.click()), quindi DUE .click() sincroni per un click utente → la seconda chiamata annullava il dialog appena aperto. Fix: rimosso l'onclick inline (~1020), lasciato il solo addEventListener (~2727) → single trigger, coerente con #btnAdd/#btnReset. Solo Vedere: v3b/analyzer NON toccato (ANALIZZA_BUILD/<title> invariati); tag Vedere v8.0.0-refactor invariato (architetturale). registry.BACKEND_VERSION resta la versione canonica del rilascio. docs/MAPPA_FUNZIONALE.md aggiornata nello stesso commit (regola §4). Niente CACHEBUST.
#   8.4.7          (2026-06-01): FEAT export STL Sostituire chiede il nome file con un modale in-app prima del download (opzione A, niente API di sistema → funziona su tutti i browser). sostExportSTL refattorizzato: valida + calcola il nome di default (base scan + componenti attivi) + apre #sostExportDialog precompilato (focus+select); confirmSostExport sanifica (toglie .stl digitato, caratteri illegali → _, niente spazi/punti ai bordi, fallback al default se vuoto) e lancia l'export via helper _sostDoExport (pipeline build+serialize+download invariata, nome iniettato in a.download); Annulla non scarica. Invio=Conferma, Esc=Annulla sull'input; niente click-fuori (coerente con #groupDialog/#settingsDialog). #sostExportDialog ricalca #groupDialog. Solo frontend. docs/MAPPA_FUNZIONALE.md aggiornata nello stesso commit (regola §4). Niente CACHEBUST.
#   8.4.6          (2026-06-01): FIX leak gemello visibilità bottoni .sostituire-only (Livelli ~1345, Sezione/cutview ~1408) in syntesis-analyzer-v3b.html. Avevano display:none inline (sicuri al load) ma, una volta mostrati nel ramo sostituire di selectWorkflow, nessuno li rinascondeva uscendo (il blocco di uscita nasconde solo panelSostituire; i rami analizza/accoppia/misurare settano analisiBtns/misurareBtns ma mai sostituireBtns) → restavano visibili altrove dopo una visita a Sostituire. Simmetrico al fix #panelScanbodyType 8.4.5. Fix: gestione centralizzata a fine selectWorkflow (querySelectorAll('.sostituire-only') + display in base a wf==='sostituire'), nessun ramo può dimenticarli. Riga inline ridondante (ex 4721-4722) lasciata invariata. Solo frontend, nessun backend/API. Aggiornata docs/MAPPA_FUNZIONALE.md nello stesso commit (regola §4). Niente CACHEBUST.
#   8.4.5          (2026-06-01): FIX leak visibilità pannello #panelScanbodyType ("Tipo scanbody", Box A del workflow Analizza). selectWorkflow non lo nascondeva mai (zero referenze JS nel file, nessun display:none di default), così restava visibile anche in Sostituire e Misurare, creando ambiguità con Box B (#sostSourceRadio / sostSourceTemplate). Fix additivo: gestione centralizzata della visibilità in selectWorkflow (~riga 4611), dopo le dichiarazioni dei pannelli — #panelScanbodyType visibile solo in analizza/accoppia (unici workflow dove placeMUA consuma window._ANALYZE_SBTYPE: bottone "+ Posiziona" è .analisi-only, mostrato in entrambi), nascosto in misurare/sostituire/futuri. Box B e placeMUA intoccati. Solo frontend, niente backend/API. Niente CACHEBUST.
#   8.4.4          (2026-06-01): FEAT pulsante Reset persistente nell'header, tra blocco File e WorkFlow. hardReset() ricarica l'app con cache-bust querystring (?_r=Date.now()) per ripartire con una nuova analisi da zero; confirm() solo se c'è stato corrente (scanMesh o muaObjects.length>0). Markup ~riga 1262 (button.btn + SVG freccia circolare blu #0065B3), funzione ~riga 4213 subito dopo newCase(). Solo frontend: nessun endpoint/API toccato. Bump <title> + window.ANALIZZA_BUILD. Niente CACHEBUST (deploy via serviceInstanceDeploy latestCommit:true).
#   8.4.3          (2026-05-29): FIX gate accesso reveal() — su /analizzare la pagina restava nera permanente anche per utenti authorized/admin dopo deploy 8.4.2 sul principale. Causa: reveal() faceva style.visibility = "" (stringa vuota) che rimuove l'inline style ma lascia attivo il CSS rule backup <style>html{visibility:hidden}</style> introdotto in 8.4.2; per specificity (inline 1,0,0,0 batte tag-selector 0,0,0,1 solo con valore non vuoto) la rule CSS torna a vincere e la pagina resta hidden. Sintomo confermato in DevTools: console mostrava boot v3b 8.4.2 ma <html> aveva visibility:hidden risolto. Fix: visibility = "visible" (inline non vuoto = override del backup CSS). syn-gate.js, 1 riga modificata. Bug latente anche sul LEGACY: deterministico nel codice, identico tra i due deploy.
#   8.4.2          (2026-05-29): FEAT gate accesso /analizzare — canary su LEGACY. Aggiunto backend/static/ds/syn-gate.js: nasconde la pagina via visibility:hidden, chiama /auth/me col token, redirige a /accedi (pending/anonimo/errore/rete giù), rivela il body solo per authorized o admin; preserva il deep link in sessionStorage.syn_after_login. Agganciato a syntesis-analyzer-v3b.html nel <head>: backup CSS anti-flash + <script src="/static/ds/syn-gate.js">. /vedere e /dashboard NON ancora agganciati (canary, ci si aggancia nel deploy successivo dopo conferma utente sul comportamento legacy). Server-side require_authorized intoccato (resta la sicurezza vera; il gate JS è solo UX-layer).
#   8.4.1          (2026-05-29): FIX layout pannello admin /gestione — overflow tabella "Richieste di accesso" clippato da .tablecard{overflow:hidden}, colonna Licenza e bottone Revoca tagliati a destra ("Revoc..."). 3 modifiche CSS: .wrap max-width 1080→1200px; padding celle thead/tbody 18→12px; .tablecard overflow:hidden → overflow-x:auto (safety net, border-radius preservato). Solo CSS, nessuna logica/HTML/JS toccato.
#   8.4.0          (2026-05-28): MINOR bump — nuovo modello di accesso (registrazione senza licenza → utente pending → autorizzazione admin che genera la chiave SICP). Passo 4: gate servizi — 36 endpoint che erogano servizi (analisi, progetti, gdrive, contatti, shared folders, leaderboard, place-mua) passano da Depends(verify_token) a Depends(require_authorized): gli utenti pending (active=FALSE o license_key=NULL) ricevono 403, admin e licenziati attivi passano. Restano su verify_token (accessibili ai pending): /api/me/profile GET+PATCH, /api/me/change-password, /api/me/pro-role GET. Invariati: /auth/me (polling pannello attesa), endpoint /admin/* (require_admin), /api/analyze-public e endpoint pubblici. Passo 5: nuovi pannelli statici syntesis-accedi.html (route /accedi: login + registrazione senza chiave + pannello attesa con polling /auth/me 15s + vista autorizzato che mostra la chiave) e syntesis-gestione.html (route /gestione: pannello admin autorizza/revoca, legge token da localStorage('syntesis_token'), API /admin/* con 403 ai non-admin). Redirect post-login allineato al contratto condiviso localStorage('syntesis_token')+('syntesis_user') usato da /vedere, /analizzare, dashboard (prima il pannello passava il token via hash fragment, che /vedere non legge). Tab "Registrati" del modal v3b (/analizzare) neutralizzato: rimanda a /accedi, rimosso il campo chiave inline. Deployato su backend principale + legacy.
#   8.3.6          (2026-05-08): DOC patch — chiusura ticket cutview /vedere. Verifica utente a freddo con hard refresh esplicito (cache busting) ha confermato che il fix 8.3.3 (`material.transparent = true` forzato nello slider opacità di /vedere) risolve davvero il bug. Mesh arancione + cap arancione (default ereditato da firstLayer.color) + opacità 100% + sezione attiva = cap distinta dalla mesh grazie alla differenza di shading MeshPhongMaterial fra superficie curva e piano. Le diagnosi 8.3.4 (angolo camera-piano) e 8.3.5 (collisione cromatica) erano entrambe artefatti di test su browser cache stale che continuava a servire 8.3.1. Le 3 opzioni di fix cromatico in §B.8 (cap neutro fisso / contrasto HSL / complementare HSL) erano per un problema inesistente. Ticket §B.8 marcato CHIUSO con storia onesta delle ipotesi sbagliate. §A.8 ridotto a breadcrumb verso §B.8. STATO_SISTEMA aggiornato (sospeso #6 chiuso). Aggiunta regola di processo in MASTER_DOC §A.6.2 ("Cache busting durante verifica visiva post-deploy"): dopo deploy frontend, hard refresh esplicito (Cmd+Shift+R) o querystring `?v=$(date +%s)` prima di valutare il fix nel browser. Senza questo, una verifica visiva può smentire un fix che in realtà funziona — successo in questa sessione dove 4 commit consecutivi (8.3.4-5-6) sono stati spesi su cause inesistenti. Lezione salvata in feedback_cache_busting.md. Nessun cambio di codice, niente CACHEBUST, niente deploy. Live resta 8.3.3.
#   8.3.5          (2026-05-08): DOC patch — correzione diagnosi bug cutview /vedere. Screenshot utente 2026-05-08 hanno smentito sia l'ipotesi 8.3.3 (queue switch su transparent flip) che l'ipotesi 8.3.4 (angolo camera-piano). Causa reale: collisione cromatica tra colore mesh scelto dall'utente e colore fisso della cap del taglio. Mesh arancione + cap arancione (default) = piatta monocromatica, "sembra rotta" ma è solo perdita di gerarchia visiva; mesh blu + cap arancione = cap leggibile, niente bug. Il bug non era mai pipeline rendering. Patch 8.3.3 resta in produzione perché non rompe niente, ma è inutile: risolveva un problema inesistente. Ticket spostato da §A.8 a §B.8 con 3 opzioni di fix candidate (cap neutro fisso / contrasto automatico HSL / complementare HSL), decisione utente prossima sessione. Lezione di processo aggiornata in feedback_bug_variability.md: oltre a sondare la variabilità, **richiedere screenshot/evidenza visiva prima di greppare il rendering pipeline** — un bug "rendering corrotto" può essere percettivo (collisione colori) anziché computazionale. Nessun cambio di codice, niente CACHEBUST, niente deploy.
#   8.3.4          (2026-05-08): DOC patch — apertura ticket bug cutview /vedere in MASTER_DOC §A.8 con diagnostica raffinata. Dopo deploy 8.3.3, verifica visiva utente: il bug NON dipende dall'opacità mesh come ipotizzato, ma dall'ANGOLO camera-piano di taglio. In certe rotazioni (probabilmente camera quasi parallela al piano) la mesh appare piatta arancione anche con la patch 8.3.3 attiva. La patch 8.3.3 (forzare material.transparent=true nello slider) resta in produzione perché non rompe niente, ma l'ipotesi era incompleta. Filoni da investigare a freddo prossima sessione: (1) PlaneGeometry della cap (riga 6537) troppo grande, può "avvolgere" la camera in viste grazing; (2) stencil compromesso quando camera è tangente al piano; (3) z-fighting cap-vs-mesh con offset fisso 0.001 mm (riga 6561) insufficiente. Nessun cambio di codice in 8.3.4 — solo MASTER_DOC + version trail. Niente CACHEBUST, niente deploy associato.
#   8.3.3          (2026-05-08): FIX cutview Vedere — corruzione rendering della metà tagliata a opacità mesh = 100%. Causa: lo slider opacità in syntesis-icp-vedere.html (riga 7917-7928) flippava `material.transparent` a false a v=1.0, spostando la mesh dalla transparent queue alla opaque queue. In opaque queue Three.js r128 ordina ascendente per renderOrder: layer mesh (renderOrder 0, depthWrite true) → cap stencil meshes (renderOrder 1, depthTest true). Risultato: la mesh del layer scriveva il depth buffer prima delle stencil meshes, che poi fallivano il depth test e non incrementavano lo stencil → cap renderizzata male o assente. A opacità < 100% la mesh restava transparent → disegnata DOPO la pipeline cap → niente interferenza, tutto funzionava. Fix: forzare `layer.material.transparent = true` incondizionatamente (1 riga, 7923). Il materiale base nasceva già transparent: true (riga 2456), il fix riporta semplicemente al default. depthWrite resta conditional `(v >= 1.0)` per evitare z-fighting su layer multipli. `layer.transparent` (flag UI, NON materiale) resta conditional sullo slider. Coerente con `toggleTransparent` (riga 2567-2575) che già forza transparent: true incondizionatamente.
#   8.3.2          (2026-05-08): DOC patch — MASTER_DOC §A.6.2 esteso con la regola "Pre-asserzione versione corrente". Lezione di processo dalla sessione di stasera: il modello aveva inferito "siamo a 8.2.5" leggendo il commento di history alla riga 39 di registry.py (entry del cleanup landed in 8.2.5) invece di greppare la costante BACKEND_VERSION o curlare /api/registry/constants. Conseguenza: piano di lavoro proposto su baseline di 4 release più vecchia (live era 8.3.1). La regola sta accanto alla checklist pre-cleanup di §A.6.3: entrambe sono safeguard di processo. Nessun cambio di codice in questo bump — solo MASTER_DOC + version trail. Niente CACHEBUST: nessun layer Docker da rebuildare, nessun deploy associato.
#   8.3.1          (2026-05-08): FIX urgente regressione introdotta in 8.2.4 (cancellazione Hub legacy backend/static/index.html). Il mount StaticFiles era condizionato a `if _INDEX.exists()` con `_INDEX = _STATIC_DIR / "index.html"`. Cancellando index.html, il mount si e' disattivato silenziosamente: tutti gli URL /static/* tornavano 404 da 2 commit fa. Effetto reale rilevato: PDF clinico v3b usa /static/assets/scarico_cono_mua_v4.png (riga 7992) -> immagine 404 nel report dal 8.2.4. Fix: condizione cambiata a `if _STATIC_DIR.is_dir()` (mount sempre se la dir esiste). Confermato in 8.3.0 perche' i 2 link DS al pilota /vedere (`/static/ds/tokens.css`, `/static/ds/components.css`) restituivano anch'essi 404 -> DS non attivo in produzione anche se commitato. Il pilota DS 8.3.0 e' codice corretto ma non era visibilmente funzionante in prod. Con 8.3.1 il pilota DS torna attivo e gli asset esistenti tornano serviti.
#   8.3.0          (2026-05-08): MINOR bump — introduzione del Syntesis Design System. Aggiunti backend/static/ds/tokens.css (namespace --syn-* con 16 colori, 3 livelli radius, 5 livelli spacing, 2 famiglie font) e backend/static/ds/components.css (classi additive .syn-* con .syn-app-header per il pattern header bar canonico + .syn-btn / --primary / --outline / --ghost). Pilota su /vedere: 2 <link> aggiunti nel <head> prima dello <style> embedded (cascade-friendly), proprieta' header bar (background, border-bottom 3px blu, padding 14/20, gap 12) migrate da .header embedded a .syn-app-header del DS, bottone btnPick "Aggiungi file" trasformato da .btn outline a .syn-btn .syn-btn--primary (gradient blu, icona SVG via currentColor). Markup HTML conservativo: <div class="header syn-app-header"> mantiene .header come prima classe (zero JS hooks la usano comunque). Pilota validato visivamente con screenshot prima/dopo: zero regressione layout sull'header, gerarchia visiva migliorata sul bottone primario. Replica DS su /dashboard e /analizzare a tappe nelle release successive.
#   8.2.5          (2026-05-08): CLEANUP definitivo dead code (7 file). Cancellati: /lab (syntesis-analyzer-lab.html ~3.7MB, sandbox dev mai linkato), /statistiche (syntesis-statistiche-v7.4.0.002.html, modulo orfano percorso evolutivo abbandonato — token --c-ottimo/--c-buono ecc. spariscono col file, zero hit altrove), 5 JS in backend/static/js/ (splash.js, controller.js, stl-engine.js, pdf-gen.js, supabase-ui.js, ~265KB totali, orfani per dipendenza dopo cancellazione Hub legacy in 8.2.4). Verificato: stl-engine.js (parseSTL legacy) sostituito da parseSTL inline in v3b basato su THREE.BufferGeometry; pdf-gen.js (PDF v7 vecchio Comparator) sostituito da jsPDF inline in v3b + /api/report server-side via backend/pdf_gen.py; supabase-ui.js orfano nonostante Supabase sia vivo in dashboard.html (fetch diretto, niente import). Rimosse anche le route /lab e /statistiche da main.py. Chiuso sospeso #6 in STATO_SISTEMA. Mappa Synthesis viva ridotta ai 4 endpoint reali: /vedere, /analizzare, /dashboard, /api/* (+ redirect / -> /vedere).
#   8.2.4          (2026-05-08): CLEANUP step 2 — cancellato Hub legacy backend/static/index.html (servito su /static/index.html come asset ma mai linkato da nessun modulo vivo, ultimo commit attivo 2026-04-27 v7.3.9.083). Idee design archiviate in MASTER_DOC §C.1 prima della cancellazione (splash a 2 card numerate). Auto-load STL via ?file_id= NON perso: gia' vivo in /vedere "Blocco 5r" (linee 2728-2740). Conseguenza non eseguita in questo commit: i 5 file in backend/static/js/ (splash.js, controller.js, pdf-gen.js, stl-engine.js, supabase-ui.js, ~265KB) erano importati solo da questo Hub e ora sono orfani per dipendenza — decisione separata.
#   8.2.3          (2026-05-08): CLEANUP dead code ad alta confidenza (5 file). Cancellati: backend/static/syntesis-calibrator-v1.html (reliquia pre-v4 del modulo Calibrator dismesso ufficialmente in v7.3.9.001 — vedi MASTER_DOC §B.2), frontend/index.html (Hub vecchio v7.3.9.045 mai servito perche' Railway usa backend/Dockerfile, non il Dockerfile root), Dockerfile (root, mai usato da Railway), Dockerfile.frontend (mai referenziato), Dockerfile.root (mai referenziato). Bumpato CACHEBUST nel backend/Dockerfile (quello vero) per forzare rebuild del layer COPY su Railway. NOTA: il cleanup chiude anche un effetto collaterale dei deploy 8.2.1 e 8.2.2, dove il CACHEBUST era stato bumpato nel Dockerfile root sbagliato.
#   8.2.2          (2026-05-08): UI alignment Calibrator font a Source Sans 3 (era Plus Jakarta Sans + DM Mono, ultimo modulo outlier sul font). Allineato anche il <link> Google Fonts. Pulizia preparatoria all'introduzione di syntesis-ds.css (#1 piano UI). NOTA: post-deploy emerso che syntesis-calibrator-v1.html era dead code (zero route, dismesso da v7.3.9.001), quindi la modifica e' stata su file orfano. File cancellato in 8.2.3.
#   8.2.1          (2026-05-08): UI alignment Vedere header al canone .app-header (border-bottom 3px var(--blue), padding 14/20, gap 12). Cleanup dead code: rimosso syntesis-statistiche-v7.4.0.001.html (146KB, zero referenze nel repo, sostituito da v7.4.0.002 servito su /statistiche).
#   8.2.0          (2026-05-06): PROMOTION chiusura Fase A. Refactor "registry come single source of truth" completato. Suffisso -A.x.y rimosso (regola 3 schema versioning). Step chiusi: A.1, A.2, A.3, A.4, A.4.1, A.5.0, A.5.1, A.5.2 + debito CLIN_LEVELS/CLIN_AXIS chiuso. A.6 cancellata: index.html e' hub navigazionale puro, syntesis-icp-replacer.html non esisteva.
#   8.1.13-A.5.2 (2026-05-06): FIX quick win cleanup (audit C3 C12 C15): /api/me/projects/{id}/files restored happy path (sposta gdrive.list_folder dentro funzione, rimuove dead code orfano), MAX_DRIVE_PROXY_BYTES cap 100MB su /api/me/gdrive/file/.../content (pre-check via gdrive.get_file_metadata), CLIN_LEVELS+CLIN_AXIS importate da registry.THRESHOLDS+PALETTE (single source of truth, fallback canonico), allineato angular_classes_it[-1] "Fuori" -> "Fuori posizione" per coerenza con d3
#   8.1.12-A.5.2 (2026-05-06): FIX code health batch (audit C2 C6 C7 C8 C13): JWT error generic, CORS PATCH/DELETE/OPTIONS, MAX_PLACE_MUA_TRIS cap + run_in_executor su /api/place-mua{,-lab}, X-Content-Type-Options nosniff + force attachment per Drive proxy, cleanup 5x dead def fresClear/BuildAllArrows in v3b.html
#   8.1.11-A.5.2 (2026-05-06): FIX run_icp ritorna rmsd corretto (era prev_rmsd, audit C9); aggiunto init rmsd=inf per edge case max_iter=0
#   8.1.10-A.5.2 (2026-05-06): FIX typo bbox OS in SCANBODY (5.56 -> 3.56, cilindro x=y); valore corretto verificato sul file STL reale
#   8.1.9-A.5.2 (2026-05-06): SOSTITUIRE_TEMPLATE_INFO + TPL_ORDER allineati a window.SYN; SR a 0x0052A3 ovunque (incluso swatch UI sostSource e CSS --syn-marker-sr)
#   8.1.8-A.5.1 (2026-05-06): pagina "Lettura dei valori" nel report clinico jsPDF (schema scarico cono MUA)
#   8.1.7-A.5.1 (2026-05-03): bootstrap window.SYN nel frontend (SCANBODY_CFG, MUA, MIS_CLIN, MIS_CLIN_AX)
#   8.1.6-A.5.0 (2026-05-02): aggiunte soglie angolari (angular_deg, angular_classes_it)
#   8.1.5-A.4.1 (2026-05-02): introduzione BACKEND_VERSION nel registry
#   8.1.4-A.4   (2026-05-02): pdf_gen.py legge palette brand dal registry
#   8.1.3-A.3   (2026-05-02): icp_engine.py legge max_tris dal registry
#   8.1.2-A.2   (2026-05-02): aggiunto backend/registry.py + endpoint
#   8.1.1-A.0   (2026-05-02): rimosso icp_engine_lab.py (copia 1:1)
#   8.1.0       (2026-05-02): stato pre-Fase A (Analizzare promosso ieri)
BACKEND_VERSION = "8.13.0"

REGISTRY_VERSION = "1.1.0"   # versione dello schema del registry (cambia se si aggiungono/rimuovono campi)
REGISTRY_SOURCE = "backend/registry.py"
LAST_UPDATED = "2026-06-09"

# ─────────────────────────────────────────────────────────────────────────────
# SCANBODY: geometrie CAD dei tre tipi di marker
# ─────────────────────────────────────────────────────────────────────────────
# Valori validati clinicamente con v8.1.0 (16 MUA reali, 2026-05-02).
# Ogni voce documenta il template CAD e i parametri di Sostituire (triade canonica).

SCANBODY = {
    "1T3": {
        "label": "1T3",
        "radius_mm": 2.515,           # raggio cap CAD (cilindro superiore)
        "cap_z_mm": 10,               # quota Z del disco superiore
        "bbox_xyz_mm": [5.03, 5.03, 1.90],
        "cap_area_ratio": 0.40,       # cap ~40% area totale del template
        "color_hex": 0xFFAA44,
        "flip_x_180": False,
        "sostituire": {
            "T_root": {
                "translation": [0, 0, -8.5],
            },
            # cull_cyl: TBD (estrarre da client al refactor A.5)
        },
    },
    "OS": {
        "label": "OS",
        "radius_mm": 1.78,
        "cap_z_mm": 6,
        "bbox_xyz_mm": [3.56, 3.56, 1.10],
        "cap_area_ratio": 0.03,       # cap ~3% area (piccolo e basso)
        "color_hex": 0x639922,
        "flip_x_180": False,
        "sostituire": {
            "T_root": {
                "translation": [0, 0, -10],
            },
        },
    },
    "SR": {
        "label": "SR",
        "radius_mm": 2.03,
        "cap_z_mm": 5,                # dopo flip 180 X (CAD nativo ha disco a Zmin=-5)
        "bbox_xyz_mm": [4.06, 4.06, 3.00],
        "cap_area_ratio": 0.06,
        "color_hex": 0x0052A3,
        "flip_x_180": True,           # CAD ha convenzione Z invertita, va flippato al parsing
        "sostituire": {
            "T_root": {
                "translation": [0, 0, -10],
                "rotation": {"axis": "X", "deg": 180},
            },
            "cull_cyl": {
                "z_min_mm": 2,
                "z_max_mm": 5,
                "margin_mm": 1.5,
            },
        },
    },
}

# searchR: raggio di ricerca cluster scanbody. Approssimativamente 1.7-2.0x
# il raggio CAD. Validato clinicamente in v8.1.0 (commit 3ca03dd, 16 MUA reali).
# Rapporti reali: 1T3=1.99x, OS=1.69x, SR=1.72x. Non uniforme: 1T3 ha tolleranza
# leggermente maggiore (probabilmente per la geometria piu' larga del cap).
SEARCH_R_MM = {
    "1T3": 5.0,
    "OS": 3.0,
    "SR": 3.5,
}

# ─────────────────────────────────────────────────────────────────────────────
# THRESHOLDS: soglie cliniche e tecniche
# ─────────────────────────────────────────────────────────────────────────────

THRESHOLDS = {
    # Soglie d3 (deviazione locale punto-superficie) in micrometri.
    # Ottimo < 50 < Accettabile < 100 < Rischioso < 150 < Tensione < 250 < Fuori posizione
    "d3_um": [50, 100, 150, 250],
    "d3_classes_it": [
        "Ottimo",
        "Accettabile",
        "Rischioso",
        "Tensione",
        "Fuori posizione",
    ],

    # Soglie angolari (deviazione asse) in gradi.
    # Riusano la palette d3 per coerenza visiva delle classi cliniche.
    "angular_deg": [0.5, 1.5, 3, 6],
    "angular_classes_it": [
        "Ottimo",
        "Accettabile",
        "Rischioso",
        "Tensione",
        "Fuori posizione",
    ],

    # MUA: parametri geometrici del cono di accoppiamento.
    # Conservativi rispetto al datasheet IPD Standard Europeo (21° / 42°).
    "mua_cone_half_angle_deg": 20,
    "max_couple_divergence_deg": 40,

    # Fresabilita': solo 5-axis (4-axis non gestisce undercut MUA).
    "max_milling_angle_deg": 30,

    # OOM Railway: limite triangoli per scanbody nel ICP server-side.
    "max_tris_oom": 2500,
}

# ─────────────────────────────────────────────────────────────────────────────
# PALETTE: colori clinici e brand
# ─────────────────────────────────────────────────────────────────────────────

PALETTE = {
    # Classi d3 (5 colori, in ordine da Ottimo a Fuori posizione).
    "d3_hex": [
        "#639922",   # Ottimo (verde)
        "#D97706",   # Accettabile (ambra)
        "#F97316",   # Rischioso (arancio)
        "#EF4444",   # Tensione (rosso)
        "#A855F7",   # Fuori posizione (viola)
    ],
    # Brand (palette NASA-inspired: bianco, blu, scuro, grigio).
    "brand": {
        "blue": "#0052A3",
        "dark": "#0D1B2A",
        "gray": "#64748B",
    },
    "background": "#FFFFFF",
}

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG: configurazioni runtime
# ─────────────────────────────────────────────────────────────────────────────

CONFIG = {
    "env": {
        "background_hex": "#FFFFFF",
        "ambient_light": 0.4,
    },
    "miller": {
        "axes": 5,
        "max_angle_deg": 30,
    },
    "algorithm": {
        "mua_default": "client_v8.1.0",
        "allow_server_opt_in": True,
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def build_T_root_matrix(spec: dict) -> np.ndarray:
    """Compila un T_root strutturato in matrice 4x4 omogenea.

    Convenzione: M = T * R (prima ruoto rispetto all'origine, poi traslo).

    Args:
        spec: dizionario con almeno una di queste chiavi:
            - "translation": [tx, ty, tz]
            - "rotation": {"axis": "X"|"Y"|"Z", "deg": float}

    Returns:
        Matrice 4x4 numpy.float64.

    Examples:
        >>> build_T_root_matrix({"translation": [0, 0, -8.5]})
        # M_1T3: traslazione pura
        >>> build_T_root_matrix({
        ...     "translation": [0, 0, -10],
        ...     "rotation": {"axis": "X", "deg": 180}
        ... })
        # M_SR: ribaltamento + traslazione
    """
    M = np.eye(4, dtype=np.float64)

    rot = spec.get("rotation")
    if rot is not None:
        ax = rot["axis"].upper()
        rad = np.deg2rad(rot["deg"])
        c, s = np.cos(rad), np.sin(rad)
        if ax == "X":
            R = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
        elif ax == "Y":
            R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        elif ax == "Z":
            R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
        else:
            raise ValueError(f"Asse rotazione sconosciuto: {ax!r} (atteso X/Y/Z)")
        M[:3, :3] = R

    tr = spec.get("translation")
    if tr is not None:
        if len(tr) != 3:
            raise ValueError(f"translation deve avere 3 componenti, ricevuto {tr!r}")
        M[:3, 3] = tr

    return M


def get_scanbody(scanbody_id: str) -> dict:
    """Ritorna la voce SCANBODY per il tipo richiesto (1T3, OS, SR).

    Raises:
        KeyError: se scanbody_id non e' tra i tipi supportati.
    """
    if scanbody_id not in SCANBODY:
        raise KeyError(
            f"Scanbody {scanbody_id!r} non riconosciuto. "
            f"Supportati: {list(SCANBODY.keys())}"
        )
    return SCANBODY[scanbody_id]


def to_dict() -> dict:
    """Ritorna l'intero registry come dizionario JSON-serializzabile.

    Usato dall'endpoint /api/registry/constants per esporlo ai frontend.
    """
    return {
        "backend_version": BACKEND_VERSION,
        "version": REGISTRY_VERSION,
        "source": REGISTRY_SOURCE,
        "last_updated": LAST_UPDATED,
        "scanbody": SCANBODY,
        "search_r_mm": SEARCH_R_MM,
        "thresholds": THRESHOLDS,
        "palette": PALETTE,
        "config": CONFIG,
    }


# ─────────────────────────────────────────────────────────────────────────────
# SELF-TEST: invariate chiave
# ─────────────────────────────────────────────────────────────────────────────
# Questi check girano all'import del modulo e fanno fallire il deploy se le
# costanti diventano incoerenti. Cintura di sicurezza per refactor futuri.

def _self_test() -> None:
    # 1. searchR rapporto al raggio CAD entro un range plausibile.
    # Range allargato perche' il rapporto NON e' uniforme: 1T3=1.99x, OS=1.69x,
    # SR=1.72x. Vedi commento in cima a SEARCH_R_MM.
    for sb_id, expected_search in SEARCH_R_MM.items():
        radius = SCANBODY[sb_id]["radius_mm"]
        ratio = expected_search / radius
        assert 1.5 < ratio < 2.1, (
            f"searchR/radius fuori range per {sb_id}: ratio={ratio:.2f} (atteso 1.5-2.1)"
        )

    # 2. d3_classes ha esattamente d3_um + 1 elementi (n soglie -> n+1 classi)
    n_thr = len(THRESHOLDS["d3_um"])
    n_cls = len(THRESHOLDS["d3_classes_it"])
    assert n_cls == n_thr + 1, f"d3_classes={n_cls}, atteso d3_um+1={n_thr+1}"

    # 2b. angular_classes ha esattamente angular_deg + 1 elementi
    n_ang_thr = len(THRESHOLDS["angular_deg"])
    n_ang_cls = len(THRESHOLDS["angular_classes_it"])
    assert n_ang_cls == n_ang_thr + 1, (
        f"angular_classes={n_ang_cls}, atteso angular_deg+1={n_ang_thr+1}"
    )

    # 3. palette d3 ha lo stesso numero di colori delle classi
    assert len(PALETTE["d3_hex"]) == n_cls, (
        f"PALETTE.d3_hex={len(PALETTE['d3_hex'])} != d3_classes={n_cls}"
    )

    # 4. T_root SR ha rotazione X 180 (sanity check sulla flip convention)
    sr_rot = SCANBODY["SR"]["sostituire"]["T_root"].get("rotation")
    assert sr_rot is not None, "SR T_root deve avere rotation"
    assert sr_rot["axis"] == "X" and abs(sr_rot["deg"]) == 180, (
        f"SR rotation deve essere X 180, trovato {sr_rot}"
    )

    # 5. build_T_root_matrix produce matrici 4x4 valide
    for sb_id, sb in SCANBODY.items():
        spec = sb["sostituire"]["T_root"]
        M = build_T_root_matrix(spec)
        assert M.shape == (4, 4), f"T_root {sb_id}: shape {M.shape}"
        # ultima riga deve essere [0,0,0,1]
        assert np.allclose(M[3], [0, 0, 0, 1]), f"T_root {sb_id}: riga 3 non omogenea"
        # rotazione deve essere ortogonale (R @ R.T = I)
        R = M[:3, :3]
        assert np.allclose(R @ R.T, np.eye(3), atol=1e-9), (
            f"T_root {sb_id}: rotazione non ortogonale"
        )


_self_test()
