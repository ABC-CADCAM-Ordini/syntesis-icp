# Handover — fix Posiziona r169 (Entrambi)

## Branch / HEAD
- **fix-posiziona-r169** (corrente) = `54d58d6` — solo DIAGNOSI, **fix NON applicato** (nessuna modifica a file tracciati; HEAD == main).
- **main** = `54d58d6` (intatto, su origin). Live Railway = 8.7.0 = commit `b20fb00` (il doc-only `54d58d6` NON è deployato).
- **dev-sezione-ui** = `ab0cca9` — 8.8.0 pannello "Sezione" di prodotto, **CONGELATO** (no merge/deploy; costruito su main con la r169 da fixare).
- **dev-three-upgrade** = `dc4c049` — migrazione 8.7.0 r169, già mergiato in main via `b20fb00` (storico).

## BUG Posiziona — diagnosi CONFERMATA
Sul LIVE 8.7.0 (beta, nessun rollback) "Posiziona" MUA è morto **solo in modalità "Entrambi"** (in Solid/Wireframe funziona).
- `onViewportClick` [v3b **riga 2673**] = `var hits=raycaster.intersectObject(scanMesh);` → 2° arg assente → **recursive default = true** → interseca scanMesh **+ figli**.
- In "Entrambi" `applyRenderModeToMesh` aggiunge l'**overlay wireframe** (`LineSegments`, figlio di scanMesh).
- Il raycast torna ~557 hit, **il primo è l'overlay** (linea, `face` undefined, più vicino del solido per soglia linea 1mm).
- [riga **2674**] `placeMUA(hits[0].point, hits[0].face.normal)` → `hits[0].face` undefined → **TypeError** → niente MUA (errore in console non notato).
- NON è il clipping 8.7.0 (il raycaster ignora `clippingPlanes`). Solo `onViewportClick` è colpito: pivot [2516] e AltClickPivot [3742] escludono già l'overlay (recursive=false / filtro `isMesh`).

## FIX (da applicare su fix-posiziona-r169 — NON ancora fatto)
Riga **2673**: `intersectObject(scanMesh)` → `intersectObject(scanMesh, false)`
Riga **2674**: guardia → `if(hits.length>0 && hits[0].face){ placeMUA(hits[0].point, hits[0].face.normal); placementMode=false; renderer.domElement.style.cursor='default'; }`
Verificato in-browser: in "Entrambi" `intersectObject(scanMesh,false)` → 1 hit solido con `.face`. ✓ (anche il filtro `hits.filter(h=>h.face)` funziona; il `,false` è il fix vero.)

## Verifica post-fix (DA FARE)
Placement in **Entrambi** (deve piazzare), **Solid**, **Wireframe** (zero regressioni), **Raffina** (ICP/accoppiamento). Console pulita. Poi: bump versione + commit §15 → (gated, su OK) merge in main → deploy LEGACY canary → BACKEND → verifica `curl -sL`.

## Setup mock per la verifica
`/tmp/synt_mock_server.py` (config `synth-mock` in `.claude/launch.json`, untracked) serve `backend/` su :8771 + stub `/static/ds/syn-gate.js`(reveal) `/auth/me`(admin) `/api/registry/constants`. Scansione reale `~/Downloads/scan.stl` (002140, 219.175 tri, con scanbody) → copiare in `backend/static/_testscan_TEMP.stl` (TEMP, **non committare**) e caricare via `loadScanFile`. **preview_click NON genera click reali in questo ambiente** → testare il raycast via `intersectObject` in `preview_eval`.

## Da riprendere (prossima sessione)
1. Applicare + verificare + committare il fix Posiziona; poi merge in main + deploy (gated da Francesco).
2. **dev-sezione-ui**: COLLISIONE DI NOME — esiste GIÀ un pannello "SEZIONE" in 8.7.0 (mini-viewer cross-section per-MUA: combobox MUA + canvas + zoom). Il pannello 8.8.0 si chiama anch'esso "Sezione" → rinominarlo (es. "Taglio"/"Piano di sezione") prima di scongelare il branch.
3. (opzionale) Prova formale r128 vs r169 del raycast delle linee (regressione di libreria) — il fix è valido a prescindere.
4. Scaffolding (`backend/static/_testscan_TEMP.stl`, config mock) = NON committare.
