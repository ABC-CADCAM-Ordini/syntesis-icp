# Storia delle modifiche

Cronologia delle feature e fix significativi. Stile: una entry per modifica, in ordine cronologico inverso (piu' recente in alto).

---

## 2026-06-16 — 8.64.1: fix orientamento connessione (Misurare)

Subito dopo il deploy di 8.64.0, l'utente ha visto nel workflow Misurare che la **geometria di connessione (matematica viola) + i marker erano disegnati verso il top occlusale**, sopra gli scanbody, invece che verso l'impianto. Correzione: *"su OS RS e 1T3 la connessione va opposta al top, guarda come è orientata nel workflow Analizza."*

Causa: in `misICP_orientCapward` la regola di orientamento era invertita — assumevo che il disco-base 122-tri fosse la base/connessione e usavo "cap = estremo con **meno** area di facce piatte". In realtà il **cap occlusale è la faccia piatta** che lo scanner legge (il disco del template), quindi cap = estremo con **più** area piatta; la connessione, a `capZ` sotto il cap lungo l'asse, cade all'estremo **opposto = verso l'impianto** (opposta al top, come `placeMUA` in Analizza che pone la connessione a `click − capZ·normale_occlusale`).

Fix: una sola riga in `misICP_orientCapward` (`aPos<=aNeg` → `aPos>=aNeg`) + commento. La **magnitudine** della deviazione alla connessione (~44µm su 2770) resta **invariata** — la leva è simmetrica, cambia solo il **lato** su cui cadono connessione, marker e matematica. Vale per OS/1T3/SR. `node --check` OK; flip confermato offline col vero JS (la connessione passa al lato opposto). Verifica visiva live a carico utente. Deploy 8.64.1 su entrambi i servizi, verificato.

## 2026-06-16 — 8.64.0: Misurare — misura clinica alla connessione (beta, accanto al centroide)

Il report di accoppiamento misura le deviazioni al **centroide di volume** dello scanbody. L'utente ha proposto di misurarle alla **connessione** (l'interfaccia con l'impianto, dove la protesi si siede): geometricamente è a `capZ` sotto il cap occlusale lungo l'asse del cilindro — lo stesso schema canonico che Replace-iT usa per piazzare i MUA (`placeMUA`: cap al click, connessione a `click − capZ`).

Validazione su file reali (id 2770, OS×6 — export Sostituire) eseguendo il **vero codice JS** sui cluster: tipo OS auto-rilevato dal raggio (1.78), `Lconn` = 5.33mm coerente su tutti e 6, deviazione alla connessione **RMS 44µm vs 8µm al centroide**. Prova decisiva: forzando l'asse perfetto (`axis_B = axis_A`) la connessione torna **8µm identica al centroide** → tutto il divario è errore d'asse × leva 5.33mm. Conclusione: la connessione è il datum clinicamente vero (rivela l'errore di seating che il centroide nasconde) ma è **lever-dominata** finché l'asse OS resta mal osservabile. Decisione di prodotto: mostrare **entrambe** (centroide + connessione), decidere più avanti cosa spegnere.

Implementazione:
- **INC-1 (calcolo)**: 3 helper dopo `misICP_axisAngleDeg` — `misICP_detectSbType` (raggio→tipo→capZ da `window.SYN.scanbody`), `misICP_orientCapward` (cap = estremo con meno area di facce piatte, lontano dal disco/base; validato su OS), `misICP_connectionPoint` (`centroide − (capZ−δ)·asse`). Wiring nel loop pairs (`p.connA/connB`, `p.connD3um`…, `p.connAxA/connAxB/connCapZ`). Blocco **CONNESSIONE** sotto il centroide nella tabella per-cilindro del PDF (`misICP_pdfDrawCylinderPage`).
- **INC-2 (scena + albero)**: `misICP_renderConnections` — marker-origine sfera A (arancio)/B (blu) + linea-leva cap→connessione + geometria **matematica** (connessione IPD da Analizza) sul lato A orientata sull'asse (logica `placeMUA`). Raccolta in `misICP_connMeshes`, gruppo albero `conn` (riga Overlay `#layChkConn`, toggle via `misICP_applyLayerVis`/`groupMeshes`), cleanup in `misICP_renderPerCylinder`/`misICP_reset`/dispose-workflow. Render **additivo in try/catch**: un fallimento non rompe il display dell'analisi.
- Auto-rilevamento tipo da geometria (scelta utente). `node --check` 8/8. Calcolo verificato col vero JS sui dati reali; render 3D da verificare visivamente live (pagina gated da auth, non ispezionabile in preview locale). Deploy 8.64.0 su entrambi i servizi, verificato (`backend_version` + title su entrambi i domini).
- **LIMITI**: orientamento "meno area piatta" validato su **OS** (export Sostituire con disco-base); **1T3/SR** (cap occlusale ampio può competere col disco) e **raw-scan** (senza disco-base) da verificare live.

## 2026-06-15 — 8.63.4: detection click-invariante 1T3/OS (fit cap+parete a punto fisso)

L'utente ha corretto un mio errore concettuale: i file confrontati sono **sintetici, senza rumore** (sostituti CAD identici sullo stesso scan), quindi due pose dello stesso scanbody **devono dare 0** — gli 8.6µm misurati (OS-10 vs OS-13, due pose nuove) sono **puro non-determinismo software**, non un pavimento da rumore scanner.

Indagine (workflow determinismo, alta confidenza, verificata avversarialmente): la **Raffina è deterministica** (zero RNG nel percorso geometrico — `kabsch`, NN brute-force, stride costanti). Gli 8.6µm sono **click-dependence del SEME**: l'asse cap-media di `findScanbodyCenter` balla ~0.5° tra due click (cap OS piccolo, crop centrato sul click), e — siccome il riferimento di misura è il **centroide di volume** del sostituto, ~1mm sotto il disco lungo l'asse — la **leva** lo amplifica: `0.5°·1mm ≈ 8.7µm`. La serie [3,4,5,8,10,15] è **bimodale**: marker dove il robust ingaggia (~3-5µm) vs dove fa **fail-soft** a legacy (~10-15µm, copertura parete <140°). Conferma empirica: per-scanbody la differenza OS-10/OS-13 è traslazione 8-30µm + un **clocking enormemente non-deterministico** (fino a 177°, il DOF debole su cilindro quasi-simmetrico, che però non sposta il centroide).

Fix (solo blocco `sost*` v3b, branch robust; beta opt-in, default legacy; SR invariato): nuovo motore `_sostCylFitInvariant` — **fit cilindro a PUNTO FISSO** (max 25 iter). Ogni iter croppa attorno a (centro,asse) corrente con filtro radiale che esclude il tessuto, separa il **CAP occlusale** (faccia piatta all'estremo +asse) dalla parete; nuovo centro = baricentro del CAP, nuovo asse = min-eigenvector della parete (se sufficiente) altrimenti normale media del cap; itera finché (centro,asse) non si muovono più. Due click qualsiasi → stesso punto fisso → **indipendente dal click**. Il CAP è **sempre catturato** (anche dove la parete è poca) → elimina il fail-soft del robust-Kasa (la coda 10-15µm). Per la ripetibilità (=0) conta il punto fisso, non l'accuratezza assoluta (un eventuale notch off-axis è identico nei due run → 0).

Hardening da verifica avversariale (Explore, 2 critici chiusi): (1) asse **normalizzato** all'ingresso (le soglie dot lo assumono unitario); (2) verso dell'asse **pinnato** al verso iniziale (verso il cap, da `findScanbodyCenter` outward) → `axMax` è sempre il cap occlusale, mai il fondo/connessione, anche se l'asse oscilla durante l'iterazione. `node --check` 8/8. Deploy 2026-06-15 (commit `7b5fb5c`, deploy LEGACY `adc5a6c1`/BACKEND `38e46a70`). **PENDING**: collaudo A/B utente — OS-su-OS **due pose nuove** (Robust + autoloop), atteso il crollo degli 8.6µm verso ~0; se confermato → promozione di robust a default.

---

## 2026-06-15 — 8.63.3: Raffina Sostituire auto-loop fino a convergenza

Richiesta utente: *"per stabilizzare l'accoppiamento devo cliccare Raffina tante volte, puoi farlo in automatico?"*. `sostAlignAll` faceva **un solo round ICP per click**; siccome ogni round ri-croppa il template attorno alla posa corrente (coordinate descent), per stabilizzarsi servivano molti click manuali.

Ora **un click → auto-loop fino a convergenza**, come Replace-iT `replaceRefineAll` (8.25.0). La pipeline decode-template resta una volta sola nel `then`; poi due funzioni interne: `_sostRefineRound(round)` esegue il forEach per-marker (corpo sample/crop/ICP/apply **invariato**), traccia il max spostamento (`_posB = p.position` pre-round, `_mv = distanza` post-round) e — se `maxMove < SOST_REFINE_EPS_MM` (1µm) o `round >= SOST_REFINE_MAX_ROUNDS` (12) — chiama `_sostFinishRefine` (render + status + rebuildTree + cut + rilascio lock); altrimenti `setTimeout(0)` → round successivo (UI reattiva + progresso live "round N… spostamento X µm").

Robustezza (verifica avversariale Explore, 1 difetto reale chiuso): il loop ricorre via `setTimeout` **fuori dalla catena Promise**, quindi un'eccezione in un round non sarebbe catturata dal `.catch` → aggiunto **try/catch per-round** (status + rilascio lock). E la scena può cambiare nel gap tra round (scansione scaricata/ricreata → `sostMesh` nullo o `scanPos` stantio; marker eliminati) mentre la re-guard 8.62.2 è solo a inizio `then` → aggiunta **re-guard PER-ROUND**: `scanPos` riletto fresco ad ogni round + guardia `p` valido nel forEach + check `sostMesh`/`sostPlaced`. Lock `sostAlignInProgress` rilasciato su **tutte** le vie (convergenza/cap/eccezione/re-guard). Terminazione garantita (coordinate descent + cap 12). `node --check` 8/8. Deploy 2026-06-15 (commit `a461b7e`, deploy LEGACY `cd9f4240`/BACKEND `1d06c587`).

---

## 2026-06-15 — 8.63.2: centraggio robust 1T3/OS = fit cilindro congiunto centro+asse

L'utente, testando **OS sostituito-con-se-stesso** (file uguale → dovrebbe dare 0 errore), ha insistito che i ~12µm vanno azzerati. A/B sui dati reali: robust+point-to-plane = RMSD **12.5µm** (assi 0.04-0.52°) vs legacy+point-to-point = **12.8µm** (assi 0.12-0.76°) → **equivalenti**. Ma il log (`[sostRobustCenter] type=OS applied=true cov=358°`) mostra che il **centro robust era già click-invariante**. Quindi il residuo **non è il centro**.

Diagnosi (lever-arm): il residuo è l'**ASSE**, ancora click-dipendente (motore cap-media per OS, ~0.5° run-to-run). Il centroide del sostituto — riferimento di Misurare — è sfalsato ~1mm lungo l'asse rispetto al centro di posa; un tilt di 0.5° lo pivota di `1mm·sin(0.5°) ≈ ~10µm`, esattamente i 12µm misurati. Robustificare solo il centro (8.63.0) non bastava perché l'asse restava l'ultimo input legato al click.

Fix (solo blocco `sost*` v3b, branch robust di `sostPlaceTemplate`; beta opt-in, default `legacy` invariato; SR invariato): per 1T3/OS, **fit cilindro congiunto iterato** — un loop (max 5, break a convergenza sub-µm) che alterna `_sostLocalWallAxis` (asse = min-eigenvector della parete attorno al centro corrente) e `sostRobustCenter` (centro kasa attorno all'asse corrente). Dopo poche iterazioni **centro e asse** diventano entrambi **click-invarianti** → la posa è **deterministica** → lo stesso file su sé stesso, con la Raffina deterministica a parità di seme, converge identico → atteso **~0**. Triplo fail-soft preservato (parete<12 tri → asse precedente; `applied=false` in un'iterazione → esce e resta il centro legacy; flag default legacy).

Verifica avversariale del diff (Explore): codice robusto, fail-soft corretto, convergenza coordinate-descent sound, nessun crash/NaN (2 note minori non-bug). `node --check` 8/8. Deploy 2026-06-15 (commit `93992fe`, deploy LEGACY `0b9bff71`/BACKEND `643349a7`). **PENDING**: collaudo A/B utente — rifare OS-su-OS col fit congiunto (Robust ON), atteso il crollo dei 12µm verso ~0; se confermato → promozione di robust a default.

---

## 2026-06-15 — 8.63.1: fix finestra "Sezione" enorme

Segnalazione utente con screenshot: la finestra **Sezione** (`#cutViewOverlay`, usata da Analizza e Sostituire) era enorme — il canvas nero riempiva metà del viewport. Causa: `#cutCanvas` ha il buffer a `width=260 height=260` ma **nessuna dimensione CSS**; dentro l'overlay `display:flex; flex-direction:column` veniva **stirato dal flex** (`align-items:stretch` di default) e, essendo un *replaced element* con aspect-ratio 1:1, cresceva ~quadrato fino a ~1000px. Nessun resize JS, nessuna CSS specifica per il canvas. Fix deterministico: dimensioni CSS esplicite sul canvas — `width:240px;height:240px;flex:none;align-self:center` — che vincono sullo stretch → box fisso 240×240 (il buffer 260 resta, il render è scalato a 240, nitido). Solo markup `#cutCanvas` v3b. `node --check` 8/8. Deploy 2026-06-15 (commit `7039daa`, deploy LEGACY `4804b881`/BACKEND `52f919a7`): verifica visiva live (lo stato richiede STL + marker + sezione aperta, non riproducibile in preview locale).

---

## 2026-06-15 — 8.63.0: centraggio robust Sostituire esteso a 1T3/OS (beta opt-in)

Su richiesta dell'utente di attaccare *"il vero soffitto di precisione di Sostituire (~37µm, click-seedato, robusto solo per SR)"*. Il soffitto è il centraggio legacy `findScanbodyCenter`: il **search-crop segue il punto di click** (`searchR` attorno a `clickPos`) → su copertura asimmetrica (tessuto, click decentrato) il centro è biased. `sostRobustCenter` (8.15.0) lo annulla (ri-crop iterato della parete **attorno all'asse** + circle-fit Kasa a raggio libero → click-invariant, ~µm), ma era ristretto a SR (validazione 8.15.0 SR-only).

Approccio disciplinato (come per Misurare): **capire e misurare prima di scrivere**.
- **Workflow understand (4 lenti)**: fonte del 37µm = solo il centro legacy (il raggio fisso non c'entra, aiuta); ma `sostRobustCenter` ancora il centro al piano ⊥ asse → per 1T3/OS l'asse globale è **cap-media** (lateral-wall è SR-only nel motore `synAxisUseLateral 'auto'`) → estendere SOLO il centro sarebbe un **fix illusorio** (eredita il tilt). Inoltre cambiare il motore asse globale propagherebbe ad Analizza e al report PDF (regressione cross-workflow). Raccomandazione: **misura-prima**.
- **Harness offline Fase 0+1** (`/tmp/centering_harness.py`, marker HD 1T3/OS/SR + rumore 15µm + occlusione + gengiva sintetica): **feasibility GREEN** per 1T3/OS — asse lateral-wall **osservabile** (err ≤0.4°, anche OS a 1.10mm parete), robust **applied 100%** (zero fail-soft, nemmeno OS), centro click-invariant. I timori "OS vicolo cieco / asse non osservabile" del workflow **non si materializzano** sulla geometria reale. CAVEAT onesto: il sintetico **non riproduce** il 37µm in-vivo (driver = topologia di una scansione reale, gengiva irregolare) → il **gain reale su 1T3/OS resta da validare A/B su scansioni vere** (per questo è opt-in, non default).

Implementazione (solo blocco `sost*` v3b):
- Nuovo helper `_sostLocalWallAxis(scanGeo, roughCenter, roughAxis, R)`: asse lateral-wall **LOCALE** = min-eigenvector di Σ area·n·nᵀ sui triangoli di parete (|n·axis|<0.35, banda ±3.5, anello [R−0.8, R+0.6]) via `misICP_jacobi3`; verso concorde al cap-media; fail-soft `nWall<12 → null`. Calcolato SOLO nel branch robust → **non** tocca `synAxisUseLateral`/Analizza/report PDF (evita la regressione cross-workflow).
- Branch in `sostPlaceTemplate`: guard da `sostSourceTemplate === 'SR'` a tutti i tipi quando `flag === 'robust' && sourceRadius`; per non-SR ricava l'asse locale (`_ax = _wa || axis`); centro robusto + asse raffinato applicati SOLO se `_rc.applied` (copertura ≥140°). **Triplo fail-soft**: parete<12 tri → cap-media; copertura<140° → centro legacy; flag default `legacy` → tutto invariato. **SR INVARIATO** (`_ax = axis`, riassegnazione no-op).
- UI radio tab Algoritmo: "beta, SR" → "beta, 1T3/OS/SR" + descrizione doppio fail-soft.

Verifica avversariale del diff (Explore): **PULITO** (matematica asse corretta e coerente con `sostAlignAll`, SR invariato no-op, fail-soft completo, nessun NaN/crash — S-zero gateato da `nWall<12`). `node --check` 8/8. Le costanti banda/anello (tarate su SR) lasciate as-is: la rete fail-soft protegge; ri-taratura per-tipo = follow-up con dati reali. Deploy 2026-06-15 (commit `cbe52ed`): cache calda, nessun hang — LEGACY deploy `fcf7ad0a`, BACKEND `15b855a5`, SUCCESS in 30-60s; live 8.63.0 su entrambi + custom domain.

**PENDING**: collaudo A/B utente del robust su scansioni reali 1T3/OS (abilitare flag dal tab Algoritmo, confrontare vs legacy) prima di valutare la promozione a default — decisione di prodotto.

---

## 2026-06-15 — 8.62.2: fix robustezza accoppiamento Sostituire (crash async + leak GPU)

Su richiesta dell'utente (*"in Sostituire ci sono bug durante l'accoppiamento? siamo sicuri che funzioni al meglio?"*) è stato condotto un **audit avversariale** del codice di accoppiamento (30 agenti, 5 lenti di review → verifica per refutazione di ogni finding → sintesi). Esito: il **cuore è sano** — motore ICP, posa (`sostPlaceTemplate`), flip SR, delta della triade **confermati corretti** (14 falsi allarmi sul core, gli scettici non sono riusciti a romperlo). Coerente con i ~17µm misurati su id 2770. **2 bug reali di robustezza** (non di accuratezza dell'accoppiamento), fixati qui; i limiti di precisione noti lasciati come track separato.

Implementazione (solo blocco `sost*` v3b; motore di accoppiamento INVARIATO):
- **Crash async nella Raffina.** `sostAlignAll` esegue in `setTimeout` → `Promise.all(decode).then()`. La `then` dereferenziava `sostMesh.geometry` (~18541) **senza re-guard né `catch`**: se l'utente scaricava la scansione o cambiava workflow nei ~30ms del decode async, crash + unhandled rejection. Fix: re-guard a inizio `then` (`sostMesh`/`geometry`/`attributes`/`sostPlaced.length`), `.catch` sulla catena (stato chiaro, niente eccezione silenziosa) e **lock anti-rientranza** `sostAlignInProgress` (da review avversariale del diff: il bottone Raffina restava cliccabile durante l'ICP async → doppio-click = doppia esecuzione concorrente; ora il 2° click è ignorato finché il 1° non chiude, rilascio in successo/errore/re-guard).
- **Leak GPU su reset/reload.** `_hardResetSostituire` faceva solo `scene.remove(p.group)` e `sostClearScene` disponeva solo `p.group` → i **2 variant inattivi** (`p.groups` 1T3/SR/OS) + `axisLine` restavano allocati in VRAM a ogni cambio-workflow/reload. Fix: nuovo helper `_sostDisposePlaced(p)` (dispose completo dei variant via `p.groups` + `axisLine`, stesso pattern di `sostRemovePlaced`) usato da entrambi; l'orphan-sweep di `sostClearScene` ora fa `dispose` prima di `scene.remove`.

Verificato avversarialmente (review del diff con Explore: 3 fix robusti, doppio-dispose impossibile perché `scene.remove` stacca prima del traverse, geometrie non condivise; il 4° punto — re-entrancy — chiuso col lock). `node --check` 8/8. Deploy 2026-06-15 (commit `78d47ae`): cache calda, nessun hang — LEGACY deploy `58c473f0`, BACKEND `f8370ec9`, SUCCESS in 30-90s; live 8.62.2 su entrambi + custom domain.

Limiti noti lasciati come track separato (non bug): centraggio click-seedato ~37µm (`sostRobustCenter` SR-only opt-in, 8.15.0); template 1T3 troncato Z=1.07 vs 1.90 (innocuo per la posa, `BBOX_LOCAL` coerente con `T_root` −8.5); dead code `SOSTITUIRE_Z_OFFSET_UNIVERSAL`.

---

## 2026-06-15 — 8.62.1: fix clinico Misurare — centroide scanbody area-pesato (artefatto di densità)

Segnalazione utente sul workflow **Misurare** (Confronto ICP): sovrapponendo due STL "che dovrebbero essere quasi identici", *"tutti gli scanbody tirano dalla stessa parte"*; ipotesi dell'utente *"ICP che scivola di lato"*. Diagnosi condotta sui file reali (id 2770: File A = export **exocad** 31.344 tri; File B = `_SR-2` = export **Synthesis Sostituire** decimato 11.994 tri) e **riprodotta offline al micron**.

**Cosa NON era.** (1) Non è slittamento ICP: Misurare allinea i **6 centroidi** dei cluster scanbody con Kabsch+ICP (`misICP_run`), e Kabsch forza la **media-residuo = 0** per costruzione → una traslazione netta laterale è impossibile (bias coerente misurato `[0,0,0]` esatto). (2) Non è un errore di piazzamento di Sostituire: la deviazione reale è ~17µm, ottima (il gap ~37µm temuto non c'è su questo caso). (3) Non è la decimazione dell'export: i template che Sostituire piazza sono decimati **a monte** da IPD a 1999 tri (`SOSTITUIRE_TEMPLATES_B64`), l'export li scrive 1:1.

**Causa vera.** Il riferimento scanbody di Misurare — `misICP_clusterCentroid` (~6303), come `misICP_cen` (~6210) — era la **media NON pesata dei vertici** (`x/n`), quindi pesata per **densità di triangolazione**. Confrontando una mesh densa (exocad 31k) con una decimata (Synthesis 12k), la diversa densità sposta il centroide → **deviazione spuria**. La replica offline con media non pesata dà RMSD **74.5µm** e deviazioni **64/43/31/135/51/75µm** — IDENTICHE allo screenshot utente, fino alle componenti (#1 X−12 Y−62 Z+5). Area-pesando (centroide di superficie, density-independent) scende a RMSD **17.3µm** (14/2/8/17/26/24µm).

Implementazione:
- `misICP_clusterCentroid` ora calcola il **centroide AREA-PESATO**: per ogni triangolo, baricentro × area, sommati e normalizzati per l'area totale. È il punto unico: alimenta sia l'allineamento (`scanCentsA/B` 6793-6794) sia la deviazione (`matchPairs`) → corregge entrambi. `misICP_cen` (solo euristiche di clustering/autoThresh) lasciato intatto. Guard `W>0` con fallback alla media non pesata storica su cluster di soli triangoli degeneri.
- **Blast-radius = 1 funzione, 2 chiamanti.** Verificato avversarialmente (3 lenti): allineamento safe (simmetrico su A/B, clustering invariante, scala-safe — anzi *riduce* il residuo Kabsch), nessun chiamante rotto, swap template HD non necessario.
- **FE/BE:** il backend `/api/analyze` (leaderboard) usa già `icp_engine.cap_centroid` (riferimento robusto, cap-based) → il fix **avvicina** client e server; nessuna modifica al backend.

**Impatto clinico (voluto, non silenzioso):** le deviazioni refertate, la classe clinica per-scanbody e il Syntesis Score cambiano verso i **valori reali** (più piccoli/migliori); un export PDF/Excel fatto prima del fix non è bit-identico a uno fatto dopo. `node --check` 8/8. Deploy 2026-06-15 (commit `8b4d970`): cache calda, nessun hang — LEGACY deploy `ef1845d8`, BACKEND `8a2d0d98`, SUCCESS in 30-60s; live 8.62.1 su entrambi + custom domain.

Nota aperta (separata): il template **1T3** embedded è troncato in altezza (Z=1.07mm vs 1.90mm di datasheet/HD) — da chiarire se voluto (solo parte esposta) o difetto; innocuo allo stato attuale (`BBOX_LOCAL['1T3']` intatto).

---

## 2026-06-15 — 8.62.0: righello A/B per il collaudo di Raffina+ (Replace-iT)

Strumentazione per rendere **conclusivo** il collaudo A/B di **Raffina+** (raffinamento posa madre via ICP point-to-plane SERVER full-res, 8.59.x) contro la **Raffina** client. Il collaudo era *pending da 8.59.1*: la feature era live ma i due path mostravano metriche **non comparabili** — la Raffina client riporta `RMSD medio mm` (point-to-point, su ~400/1500 campioni sottocampionati), Raffina+ riporta `residuo fit µm` (point-to-plane, full-res). Il residuo point-to-plane è sempre più piccolo del point-to-point a parità di posa → un A/B live sarebbe stato **falsato a favore del server per costruzione**.

Solo frontend `v3b` (blocco `replace*`); l'endpoint `POST /api/rit/refine-icp` e il motore `icp_engine.refine_point_to_plane` (hardenizzato dalla revisione 18-agenti del 8.59.1) restano **invariati** — la modifica è puramente additiva.

Implementazione:
- `_replaceExtractRefineSets(p, maxSrc, maxTgt)`: estrae madre full-res (mondo) + crop cilindrico scansione. Clona la logica crop inline di `replaceRefineServer` (quella resta intatta; de-dup annotata come passo dedicato, CLAUDE.md §3.4).
- `_replaceEvalFit(p)`: **righello comune** = RMSD point-to-point in µm, calcolato con la **stessa funzione** per entrambe le pose finali, cap `REPLACE_EVAL_MAX_SRC=1500`/`REPLACE_EVAL_MAX_TGT=4000` (one-shot, no freeze), trim mediana×2.5.
- `_replaceTwistAngleDeg(qCur, qSeed, axis)`: **delta-clocking** firmato (°) della posa corrente vs il seed 3-punti grezzo, via swing-twist attorno all'asse impianto (il DOF debole = vero oggetto del dubbio sul clocking). Seed catturato in `replacePlaceFromSeed` (`p.seedPos`/`seedQuat`/`seedAxis`).
- `_replaceRecordAB`/`_replaceShowAB`: memorizza `p.abClient`/`p.abServer` e stampa la riga-verdetto (`A/B #N (righello comune) — Raffina: Xµm, clock +A° · Raffina+: Yµm, clock +B° → Δfit, Δclock`). Aggancio: `finish()` di `replaceRefineAll` single-target → record `'client'` (al Conferma la `onDone` sovrascrive → no spam; sul Raffina manuale resta); fine `replaceRefineServer` → record `'server'`.
- NUOVO pulsante **"↺ Seed"** (`#replaceBtnResetSeed`, `replaceResetToSeed`) accanto a Raffina+: riporta l'impianto attivo alla posa seed → A/B **indipendente** (reset→Raffina→reset→Raffina+ dallo stesso seed). Abilitato/disabilitato come Raffina+ in `replaceRebuildPlacedList`.
- `node --check` 8/8; `py_compile` registry OK. Bump `<title>`/`ANALIZZA_BUILD` 8.62.0; `MAPPA_FUNZIONALE` riga `.replace-only` (8 bottoni) + versione mappata 8.62.0.

Deploy 2026-06-15 (commit `d833bf0`): entrambi i servizi hanno avuto un **hang Railway post-build** — lo status è rimasto in `BUILDING` ~15 min nonostante i build log mostrassero lo step `[7/7]` e l'export immagine **completati senza errori**. Risolti con **ri-trigger** (`serviceInstanceDeploy latestCommit:true`): con la cache calda il nuovo build è andato a `SUCCESS` in ~90-120s (LEGACY deploy `27ae6f1c`, BACKEND deploy `cfed79a4`). Verifica live: 8.62.0 su entrambi i domini + custom domain, `/analizzare` 200, gating `403`. **PENDING: collaudo A/B in live dall'utente** (protocollo: posiziona impianto → ↺ Seed → Raffina → ↺ Seed → Raffina+ → leggi Δfit/Δclock; ripeti sui 3 scanbody di forma diversa).

---

## 2026-06-14 — 8.61.2: menù WorkFlow di Vedere allineato (+ Replace-iT, deep-link) — coerenza cross-superficie

Feedback utente: *"perché quando sono su vedere i workflow in elenco sono di meno?? sembra che vedere sia un software a parte… vedere dovrebbe essere una parte dello stesso software, un workflow; separarlo così rischia di creare differenze di stile e comportamento."*

**Diagnosi:** Vedere è **letteralmente un file separato** (`syntesis-icp-vedere.html`, `v8.0.0-refactor` — ricostruito sul design system `ds/*`, più moderno del monolite legacy). Il suo menù WorkFlow fu scritto **prima** che Replace-iT esistesse (~8.18.0) e mai aggiornato → elencava 4 workflow invece di 5. Inoltre la whitelist deep-link `?wf=` del monolite (`DOMContentLoaded`, ~L5183) accettava solo `['analizza','accoppia','misurare','sostituire']`, e `selectWorkflow` di Vedere navigava a `/analizzare` **senza** parametro → da Vedere ogni voce atterrava su Analizza (default), non sul workflow scelto.

**Discussione architetturale + decisione utente (Opzione A):** l'utente ha ragione che concettualmente Vedere è un workflow come gli altri, e la separazione fisica crea deriva. Ma la direzione giusta NON è fondere Vedere (il file pulito) nel monolite legacy (3.87 MB) — sarebbe il verso sbagliato e un refactor enorme — bensì portare i workflow del monolite **verso** l'architettura pulita di Vedere (campagna di modularizzazione, lungo termine). Per ora: **Opzione A pragmatica** = 2 file separati ma **deriva azzerata** (menù identico + stesso design system + comportamenti uniformi). La direttiva strategica (*"rendere meno monolitico il software, lavorare a compartimenti per gestire la crescita"*) è registrata in memoria [[v3b-modularization]].

**Fix (3 punti, passo 1 di Opzione A):**
- monolite v3b: `'replace'` aggiunto alla whitelist deep-link `?wf=` (~L5183);
- Vedere: aggiunta la voce **Replace-iT** al menù WorkFlow (markup + icona SVG clonati dal monolite);
- Vedere `selectWorkflow`: naviga a `/analizzare?wf=<wf>` (parametro passato) e gestisce `replace` → ogni voce atterra sul **suo** workflow (sistemato anche il bug "tutto su Analizza").

`node --check` v3b 8/8 + Vedere 3/3. Label Vedere `v8.0.0-refactor → v8.0.1-refactor`. Deploy commit `db157a0` (LEGACY `b495551c`, BACKEND `5e85b8d5`); live 8.61.2 su entrambi + alias, Vedere a 5 workflow, gating 403. **Prossime tappe coerenza (Opzione A):** Vedere allineato al pastello (`--fill-*`) + fix drag-camera replicato nel controller di Vedere.

---

## 2026-06-14 — 8.61.1: il drag della camera continua oltre il canvas del viewport

Feedback utente: ruotando/spostando i file 3D, il movimento si **interrompe** appena il puntatore esce dal viewport o passa sopra l'albero scena.

**Causa**: l'`OrbitControls` custom inline del monolite (`~L2449`) in `onMD` (mousedown sul canvas) agganciava `mousemove`/`mouseup` a `el` (= `renderer.domElement`, il canvas). Uscendo dal canvas quegli eventi non arrivano più → la rotazione/pan si ferma; rilasciando fuori dal canvas il `mouseup` non scatta (drag potenzialmente "appiccicato").

**Fix**: durante il drag attivo i listener `mousemove`/`mouseup` vanno su **`window`** invece che su `el` (`onMD` addEventListener + `onMU` removeEventListener) → il drag continua **ovunque** (sopra `#layersPanel`, fuori dal viewport) finché il tasto è premuto. Il drag continua a **partire** solo dal canvas (`onMD` resta agganciato a `el`). In più, guardia self-heal in `onMM`: se `e.buttons === 0` (tasto rilasciato fuori dalla finestra, `mouseup` perso) → `onMU()` chiude il drag. Touch (`onTM` su `el`) invariato (il touch ha capture implicito sul target). `node --check` 8/8. Deploy commit `05fd453` (LEGACY `97bb4180`, BACKEND `11cb7391`); live 8.61.1 su entrambi + alias.

---

## 2026-06-14 — 8.61.0: Design system, Fase pastello — commit 2/2 (chrome pastello)

Seconda metà dell'iniziativa pastello: gli **sfondi dei pulsanti/CTA** diventano pastello con **testo scuro**, come nella preview approvata dall'utente.

**Architettura (decisa dopo aver scoperto il rischio):** ripuntare i token condivisi `--blue/--green/--red/--gold` a pastello avrebbe rotto **molte letture cliniche** (non solo le etichette: anche `.angle-val.good/.warn/.bad` = valori d'angolo colorati per severità, gli avvisi sottosquadro/fresabilità, i bordi `.clinical-section`). Quindi **NON si ripuntano i token condivisi** (restano saturi per testo, accenti e clinica); si aggiungono **token FILL pastello dedicati** e si migrano **solo gli sfondi dei pulsanti**:
- nuovi `--fill-primary:#4FA3E3 / --fill-confirm:#8ADFB2 / --fill-warn:#FFE08A / --fill-error:#FF8D85 / --fill-sel:#7DBDF2` (in `:root` v3b + `ds/tokens.css`);
- i ~26 sfondi-pulsante: `background:var(--blue|green|red|gold)` → `var(--fill-*)` e `color:#fff/var(--white)` → `var(--dark)` (testo scuro). Contrasto AA verificato 6.5–13.8:1.

**Metodo "non sbagliare":** applicato con **script Python deterministico** (assert di unicità su ogni sostituzione: 27 totali) + **verifica avversariale del diff** (agente general-purpose) che ha colto **2 problemi reali**, poi corretti: (A) le icone SVG dei pulsanti `.btn.active/.green.primary/.blue.primary` restavano **bianche** (regole `svg [stroke]{stroke:var(--white)}`) → quasi invisibili sul fill pastello accanto al testo scuro → portate a `var(--dark)`; (B) `.calmodal-btn.primary:hover` cambiava lo sfondo a `#004F8A` scuro lasciando il testo scuro ereditato (2.10:1) → aggiunto `color:var(--white)`.

**NON toccati:** i valori dei token condivisi, i colori clinici/brand/d3, `.divergence-label`/`.angle-val`. `node --check` 8/8; grep di completezza contrasto = 0 residui (nessuno sfondo saturo con testo bianco, nessun fill con testo chiaro). MAPPA: nota design system in testa + versione mappata 8.61.0. Deploy commit `b8c2dd3` (LEGACY `1671dc1f`, BACKEND `e27183a7`); live 8.61.0 su entrambi + alias, con fill pastello serviti + clinici d3 intatti + token condivisi ancora saturi + gating 403.

**Resta il commit 3:** mesh scansione → freddo `#DCE6EC` (16 hit eterogenei: materiale Three.js, default `envSettings.scanColor`, default dei color-picker, swatch "Marroncino", slider accent, token — da classificare uno a uno).

---

## 2026-06-14 — 8.60.0: Design system, Fase pastello — commit 1/2 (fondamenta + unificazione clinica)

Avvio dell'iniziativa di coerenza UI richiesta dall'utente: *"se usiamo qualche colore più allegro non è male; se decidiamo un colore per una funzione o un tasto usiamolo sempre in tutti i workflow; verifichiamo che tutti i workflow siano coerenti tra loro come grafica, testi (pochi ed essenziali), alberi scena (completi e coerenti)."* L'utente ha fornito una palette pastello (separata per "funzioni" e "viewport 3D") e ha scelto: **UI tutta verso il pastello**, **partendo da token + fix incoerenze**.

**Metodo** (le decisioni in [[ui-consistency-cheerful-palette]]): audit read-only multi-agente su TUTTO il prodotto (token DS esistenti, colori per funzione, alberi scena, testi, superfici non-v3b) → un workflow ha prodotto un **piano edit verificato avversarialmente**. La verifica (3 agenti) ha **BOCCIATO il ripunto pastello in-un-colpo**, scoprendo due rischi reali: (1) i token `--green/--red/--gold` sono usati **sia** dai pulsanti UI **sia** dalle etichette di deviazione cliniche → pastellizzarli avrebbe cambiato in silenzio la scala di severità clinica; (2) ~13 pulsanti inline sarebbero rimasti con testo bianco illeggibile su pastello. Da qui lo **staging in 2 commit atomici**.

**Commit 1** (questo; solo blocco `replace*`/CSS del monolite `v3b`, sicuro e additivo):
- nel `:root` statico: nuovi token `--primary-strong:#0065B3` e `--confirm-strong:#0D9E6E` (sfondi contrast-safe per i CTA bianco-su-colore del commit 2) + token **clinici** `--clin-good:#639922 / --clin-warn:#D97706 / --clin-risk:#F97316 / --clin-bad:#EF4444` = palette **d3 canonica**.
- **etichette di deviazione** (`.divergence-label.good/.warn/.risk/.bad`, classi da `classifyDivergence` con soglie 15/25/45) ri-puntate dai token UI `--green/--gold/--red` (+`#F97316` hardcoded) ai nuovi `--clin-*`: così sono **disaccoppiate** dalla UI (il ripunto pastello del commit 2 non le tocca) e **unificate** alla palette clinica d3 (scelta utente esplicita — era un mix legacy non coincidente con la d3).
- **fix incoerenze**: `sostBtnPlace` (#0D9E6E hardcoded) e `replaceBtnRefineSrv`/"Raffina+" (one-off #0E8C6A) → `var(--confirm-strong)`; `REPLACE_SEED_COLORS` (i 3 punti-seme rosso/verde/blu "da sistema operativo" `[0xFF3B30,0x00C853,0x2979FF]`, fuori-brand) → trio pastello `[0xFF8D85,0x8ADFB2,0x4FA3E3]`.
- **NON toccati**: `--blue/--green/--red/--gold` (restano saturi fino al commit 2), i colori clinici di `registry.py`/`SCANBODY`/`d3_hex`, la mesh neutra (→ #DCE6EC nel commit 2).

`node --check` 8/8. `docs/MAPPA_FUNZIONALE.md`: riga Label 2D (nota 8.60.0 sull'unificazione clinica) + versione mappata 8.60.0. Deploy commit `e22c4e5` (LEGACY `93b157a9`, BACKEND `4a9ef743`, build BACKEND lento ~11 min ma a buon fine); live 8.60.0 + token `--clin-good` serviti + gating 403 su entrambi i domini + alias. **Commit 2 in corso**: ripunto pastello del chrome (pulsanti pastello + testo scuro su ~24 CTA, token in 3 punti di definizione) + mesh a freddo #DCE6EC.

---

## 2026-06-13 — 8.59.9: Replace-iT "Taglia scansione" — tetto al profilo radiale (via le strisce nella mucosa)

Follow-up dell'8.59.7. Feedback utente (screenshot prima/dopo): *"il taglia scansione è un po' impreciso sulla parte di mucosa, ha creato due strisce di taglio parallele che non dovrebbero esserci in questo caso."*

**Causa**: il profilo radiale per-angolo del Madre (`_replaceMadreProfile`, 48 settori, 85° percentile) è **una sola silhouette 2D** che viene estrusa lungo **tutta l'altezza assiale** del taglio. Dal 8.59.7 il profilo si calcola sul **CAD Madre intero**, che include la **feature anti-rotazione sub-gengivale** (lo *square engaging*, il blocchetto quadrato visibile alla base del figlio). Quella feature è più larga del corpo cilindrico nelle direzioni dei suoi lati: estrusa giù fino al livello della mucosa, il taglio si allarga lì → **due prolungamenti paralleli** che incidono la gengiva. Ma a quel livello lo scanbody reale è **round** e nella scansione del paziente c'è **solo mucosa** (la feature è sepolta nell'impianto, lo scanner non la vede).

**Fix** (solo blocco `replace*` del monolite `v3b`):
- nuova costante `REPLACE_PROFILE_CAP_K = 1.2`. Dopo aver calcolato il profilo e la mediana dei settori `fb` (≈ raggio del corpo cilindrico), si applica un **tetto robusto** `rcap = fb · K`: per ogni settore `prof[bin] = min(prof[bin], rcap)`.
- i settori del corpo round (≈ `fb`) restano **invariati**; solo i settori gonfiati dalle feature non-round (square engaging, scan-flag) vengono **clampati** → le strisce spariscono.
- l'**altezza assiale piena** (8.59.7) e il taglio del **corpo round** restano pieni; l'offset utente è invariato (sommato dopo, nel loop di taglio). Trade-off: gli angoli della feature **sopra gengiva** (in aria) non sono tagliati al 100% — innocuo, non c'è mucosa da preservare lì.

`node --check` 8/8. `docs/MAPPA_FUNZIONALE.md`: riga "Taglia scansione" aggiornata (con recupero delle note 8.59.6 bound assiale e 8.59.7 CAD intero, prima mancanti) + versione mappata → 8.59.9. Deploy canary **LEGACY → BACKEND** commit `bf3c4f0` (LEGACY deploy `fd47ffd1`, BACKEND `cde5ad86`); verifica live 8.59.9 + `<title>`/`ANALIZZA_BUILD` 8.59.9 + gating `/api/leaderboard` no-token → 403 su entrambi i domini + alias `app.syntesis-icp.com`. **PENDING collaudo utente** (`K=1.2` tunable se le strisce non spariscono del tutto / se il corpo viene tagliato troppo stretto).

---

## 2026-06-13 — 8.59.8: Replace-iT label impianto ancorata al cap del figlio + lift in alto

Feedback utente: *"loro su altri workflow sono differenti, hanno una linea che si sposta e porta il label più alto; lui qui dovrebbe partire dal file figlio e spostarsi in alto per essere visto senza dare noia."* Confermato in chat: **cap del figlio** + **verso l'alto del figlio**.

**Causa**: `replaceUpdateLabels` (8.53.1) ancorava il dot e la linea guida a `p.position` = l'**origine/connessione** dell'impianto (CAD locale 0,0,0, la base vicino alla gengiva, spesso coperta). La pillola, sollevata di `OFF_PX=54` px da lì, finiva **sopra il corpo del figlio** → "dava noia".

**Fix** (solo blocco `replace*` del monolite `v3b`):
- **anchor = cap del figlio**: calcolo la bounding box mondo di `meshSub` (`new THREE.Box3().setFromObject`), prendo i due estremi lungo l'asse (`center ± axisDir·halfExtent`) e scelgo come cap quello **più lontano dalla connessione** (`p.position`). La bbox usa gli 8 corner cache della geometria → economico per-frame; segue `matrixWorld`, quindi resta corretto dopo Raffina e cambio-figlio.
- **lift verso l'alto del figlio**: la pillola si stacca di `OFF_PX=54` px lungo l'asse **verso il cap** (la direzione "su" del figlio), proiettato in schermo. Se il cap punta verso la camera (asse proiettato collassato, `len<0.5`px) → fallback all'alto-schermo, robusto allo scorcio come il 8.53.1.
- linea SVG, dot, testo (`#N Marca Modello Ømm`), colore impianto e compensazione `body.zoom` invariati.

`node --check` 8/8. `docs/MAPPA_FUNZIONALE.md`: riga "Label 2D" aggiornata + versione mappata → 8.59.8 (modifica di funzione legata a UI, sincronizzazione obbligatoria). Deploy canary **LEGACY → BACKEND** commit `927adef` (LEGACY deploy `92e00bb0`, BACKEND `309b2e12`); verifica live 8.59.8 + `<title>`/`ANALIZZA_BUILD` 8.59.8 + gating `/api/leaderboard` no-token → 403 su entrambi i domini + alias `app.syntesis-icp.com`. **PENDING collaudo utente.**

---

## 2026-06-13 — 8.59.7: Replace-iT "Taglia scansione" usa il CAD madre INTERO, non il trim dell'anteprima

Follow-up immediato dell'8.59.6. Feedback utente: *"solo un accorgimento: non tagliare con il file ridotto come da anteprima ma taglia con il file intero che hai in memoria."*

**Causa**: dal **8.43.0** lo slider verticale "taglio dall'origine" accanto all'anteprima marker accorcia il CAD sorgente lungo l'asse (`replaceTrimGeoAlongAxis`, tiene il cap esposto) per concentrare il **fit** sulla parte realmente scansionata. Risultato: `meshSrc` (Madre visibile) e `p.srcGeo` (usato dalla Raffina) diventano il CAD **trimmato**. Il "Taglia scansione" 8.59.6 calcolava `axMin/axMax` e il profilo radiale per-angolo da `meshSrc` → se l'utente aveva accorciato il sorgente, il taglio risultava **più corto del reale** e lasciava non tagliata la parte bassa dello scanbody scansionato.

**Fix** (solo blocco `replace*` del monolite `v3b`):
- alla posa salvo il CAD sorgente **intero** su `p.srcGeoFull = geos[0]` — la geometria piena restituita da `replaceFetchMarkerGeo` **prima** del trim. Il trim crea una nuova geometria (non muta `geos[0]`), quindi il riferimento pieno resta valido.
- nuovo helper `_replaceCutSourceGeo(p)`: ritorna `p.srcGeoFull` se presente, altrimenti `meshSrc.geometry` (fallback per impianti senza full / single-mesh). Lo usano `_replaceMadreProfile` e `replaceEstimateMarkerRadius` (le due funzioni che definiscono la geometria del taglio).
- **frame coerente**: `replaceTrimGeoAlongAxis` rimuove solo triangoli, non ricentra → il CAD pieno e il trimmato condividono lo stesso frame locale, quindi `p.group.matrixWorld` (anche dopo la Raffina, che muove solo il group) li trasforma identicamente in mondo.
- **niente leak / niente dispose errato**: `geos[0]` è una geometria **cache condivisa** (`replaceMarkerGeoCache[sha]`) e **non-owned** (nessun `userData.replaceOwned`, settato solo sui trim) → `_replaceDisposeGroup` non la dispone mai. `p.srcGeoFull` è solo una referenza.
- il **FIT resta sul cap trimmato** (`p.srcGeo`, design 8.43.0 deliberato): si cambia *solo* la geometria del taglio, non quella dell'accoppiamento.

`node --check` 8/8. Deploy canary **LEGACY → BACKEND** commit `47e4efc` (LEGACY deploy `b3e7e74f`, BACKEND `33808a8a`); verifica live 8.59.7 + `<title>`/`ANALIZZA_BUILD` 8.59.7 + gating `/api/leaderboard` no-token → 403 su entrambi i domini + alias `app.syntesis-icp.com`. **PENDING collaudo utente.**

---

## 2026-06-13 — 8.59.6: Replace-iT "Taglia scansione" segue la FORMA del Madre (bound assiale)

Feedback utente: *"la funzione taglia scansione taglia la scansione del marker madre correttamente e toglie pure le isole, bene. Ma taglia anche la parte di scansione che non è il marker, verso i tessuti e i denti adiacenti. Quella parte non dovrebbe essere interessata: il taglio da parte di Madre deve essere solo esclusivamente la forma del marker più offset impostato dall'albero scena."*

**Causa**: il "Taglia scansione" non tagliava la *forma* del marker ma un **tubo passante ±30mm lungo l'asse** (`REPLACE_CUT_HALFH = 30.0`). Radialmente era già corretto (la sezione segue la silhouette per-angolo del Madre via `_replaceMadreProfile` + offset). Ma assialmente il taglio era un carotaggio di **60mm** centrato sul marker: lo scanbody è alto pochi mm, quindi i restanti ~28mm/lato attraversavano la scansione lungo l'asse e — soprattutto con scanbody/impianti **inclinati** — il tubo "spazzava" lateralmente, mangiando gengiva e denti adiacenti che capitavano in quella colonna.

**Fix** (solo blocco `replace*` del monolite `v3b`, richiesta utente esplicita "esclusivamente la forma del marker + offset"):
- `_replaceMadreProfile` (già itera tutti i vertici del Madre in mondo) traccia ora `axMin/axMax` = estensione assiale reale del Madre rispetto al centroide marker, ed espone i due valori nel return.
- `replaceRebuildScanGeometry` calcola per ogni cilindro di taglio la banda assiale `[axLo, axHi] = [axMin - off, axMax + off]`, **clampata** a `±REPLACE_CUT_HALFH` (così non è MAI più larga di prima). Il loop di taglio usa la banda invece di `Math.abs(axial) > halfH`; `_replaceRemoveCutIslands` (8.59.4) usa lo stesso bound (+ margine isole) per restare coerente.
- Radiale, fallback (profilo `null` → vecchio comportamento ±30mm) e UI invariati. Il buco diventa un "tappo" della forma dello scanbody + offset; gengiva e denti adiacenti restano. Trade-off: con un taglio così aderente, se la posa 3-punti è leggermente fuori in altezza può restare un sottile anello → si compensa alzando lo slider offset (default 0.5mm).

`node --check` 8/8; harness Node sintetico 7/7 (scanbody corpo+cap tagliati; dente adiacente a +18mm e tessuto profondo a −15mm, prima rimossi dal tubo, ora preservati; confine offset 3.4 sì / 3.6 no). Deploy canary **LEGACY → BACKEND** commit `1a4157a` (LEGACY deploy `bf0b344d`, BACKEND `e23b859a`); verifica live 8.59.6 + `<title>`/`ANALIZZA_BUILD` 8.59.6 + gating `/api/leaderboard` no-token → 403 su entrambi i domini + alias `app.syntesis-icp.com`. **PENDING collaudo utente.**

---

## 2026-06-13 — 8.59.5: Replace-iT fix picking 3-punti — causa reale (raycast .point fuori dal raggio)

Chiusura del problema "pallino spostato dal cursore" sulla scansione, dopo due ipotesi sbagliate (8.59.2 = mio falso fix sull'NDC/zoom, revocato in 8.59.3; inerzia camera = non era quello). Stavolta **diagnosi con misure reali nel browser dell'utente** (Chrome), via snippet console A/B non distruttivi, escludendo una per una tutte le cause:

- NDC/zoom: `clientX/rect` corretto (su quel canvas `rect`=`client`, zoom non scala); camera coerente.
- `projectionMatrixInverse` stantia: `projInv-dev`=0; round-trip `unproject→project` = identità.
- deriva camera (inerzia): `dopo-400ms` = `offset-ora` (vista ferma).
- viewport sotto-regione: `viewport`=0,0,canvas pieno.
- disallineamento aspect/size: `camAspect`=`rectAspect`=`clientAspect`=1.1235, `rendererSize`=`client`.

**Causa**: `raycaster.intersectObject(replaceMesh)` restituisce `hits[0].point` **fuori dal raggio di ~0.5-1mm** (`distToRay` misurato 0.4-1.0mm) → ~20-40px di offset proiettato. `replaceMesh.updateWorldMatrix(true,false)` prima del raycast non cambia il `distToRay` (non è una matrice-mondo stantia); nessun three-mesh-bvh nel file → è il raycast **nativo** del bridge THREE r169 che calcola male il `.point` su mesh grandi (240k triangoli). Il `.distance` è invece corretto.

**Fix**: in `replaceOnViewportClick` (fase `pickScan`), il dot e il punto del seme (`scanPts`) usano `raycaster.ray.at(hits[0].distance, new THREE.Vector3())` — il punto **sul raggio** alla distanza del colpo, che è esattamente "dove hai cliccato sulla superficie". Misurato nel browser dell'utente: `onray-offNDC`=**0.0000** su ogni clic (offset azzerato). L'anteprima marker usa un'altra mesh/canvas → era già precisa (l'utente confermava preciso il pick anteprima e storto solo quello scansione). `onViewportClick` (MUA) e `sostOnViewportClick` invariati (snap al centro). `node --check` 7/7.

**Lezione**: tre diagnosi, due sbagliate finché non ho misurato nel browser reale. Per i bug di picking 3D: misurare `distToRay` e il round-trip, non assumere.

## 2026-06-13 — 8.59.4: Replace-iT "Taglia scansione" rimuove le isole sospese

Feedback utente (con screenshot): il "Taglia scansione" lasciava nella zona del marker dei frammenti di STL vaganti — piccole isole di triangoli staccate dal corpo principale — che vanno incluse nel taglio. Causa: `replaceRebuildScanGeometry` rimuoveva solo i triangoli **dentro** il profilo della madre; i triangoli appena fuori ma ormai disconnessi restavano fluttuanti.

**Fix** (solo blocco `replace*`): nuova `_replaceRemoveCutIslands(kept, cyls)` dopo la costruzione di `kept`. Connected-components sui triangoli sopravvissuti: saldatura vertici su griglia 1µm (`Map` posizione→id) + union-find sui vertici saldati → ogni triangolo ha una componente. Rimuove le componenti che soddisfano TUTTE e tre le condizioni:
1. non sono la più grande (il corpo della scansione è sempre preservato);
2. sono piccole (< 5% del totale dei triangoli);
3. cadono in maggioranza (> 60% dei triangoli) nell'intorno del cilindro di taglio (raggio `profMax`+offset+2mm; assiale ±`halfH`+2mm).

Le tre condizioni insieme rendono il taglio conservativo: corpo principale, "metà" grandi da taglio passante e anatomia lontana dal marker non vengono toccati. **Verifica offline** (harness Node sulla funzione reale estratta dal file): 3/3 — isola vicina rimossa, isola lontana + corpo principale preservati, componente grande near-cut non rimossa. La passata gira nel rebuild già **debounced 120ms** → nessun lag sul drag dello slider offset. `node --check` 7/7.

## 2026-06-13 — 8.59.3: REVERT del fix picking 8.59.2 (era una regressione)

Lo screenshot dell'utente (su Chrome) ha mostrato che l'8.59.2 non aveva risolto il pallino spostato. Ho **riprodotto in Chromium** (Blink, stesso motore del Chrome dell'utente) il comportamento di `body.style.zoom = 1.30` con una misura diretta: un `div` `left:100px;width:600px` riporta `getBoundingClientRect()` = `{left:130, width:780}` (**visual**, cioè zoomato ×1.3), ma `clientWidth/offsetWidth` = `600` (**unzoomed**); un click a `clientX:200` produce `offsetX:70` = `clientX − rect.left` (**offsetX è in spazio visual**).

Quindi `clientX`, `getBoundingClientRect` e `offsetX` stanno tutti nello spazio **visual/zoomato**, mentre `clientWidth/clientHeight` stanno nello spazio **layout/unzoomed**. La "correzione" 8.59.2 `offsetX / clientWidth` mischiava i due → sbagliava di **1.30×**. Era una **regressione** introdotta da me: ha **peggiorato** il picking (lo screenshot mostrava in gran parte questo bug). La formula **storica** `((clientX − rect.left) / rect.width)` è **corretta** (numeratore e denominatore entrambi visual → il rapporto è la frazione giusta del canvas, invariante allo zoom).

**Fix**: ripristinata la formula storica in `replaceOnViewportClick`; mantenuto solo `camera.updateMatrixWorld()` prima di `raycaster.setFromCamera()` (difensivo, innocuo). `onViewportClick` (MUA) e `sostOnViewportClick` invariati. `node --check` 7/7.

**Lezione**: la diagnosi precedente assumeva (senza misurare) che `offsetX/clientWidth` fosse zoom-invariante; non lo è in Blink. Va misurato, non assunto. **L'offset originale** segnalato dall'utente prima dell'8.59.2 NON è la formula NDC (ora provata corretta) → da diagnosticare con dati reali dal browser dell'utente (camera/timing).

## 2026-06-13 — 8.59.2: Replace-iT fix picking 3-punti sulla scansione (pallino spostato dal cursore)

Feedback utente: il clic sulla scansione (i 3 punti del seme di Replace-iT) posiziona il pallino **spostato** dal cursore — "sempre, senza una direzione precisa" — nonostante il fix dell'inerzia camera (8.56.1). Indagine multi-agente (pipeline del pick / zoom-DPR confronto col pick MUA / inerzia-timing).

**Intuizione che sblocca la diagnosi**: il picking MUA di Analizza "funziona" non perché il calcolo NDC sia corretto, ma perché **aggancia al centro scanbody** (`findScanbodyCenter`), che assorbe l'errore del pick grezzo. La conclusione dell'8.56.1 ("non è lo zoom, è l'inerzia") si basava sulla prova "il MUA con la stessa formula funziona al 130%" — prova **invalida**, perché il MUA maschera l'errore con lo snap. Il pick a 3 punti usa il **punto grezzo** del raycast → è il primo (e unico) posto dove un errore latente di NDC diventa visibile.

**Causa**: l'NDC è calcolato come `(clientX - rect.left)/rect.width` con `rect = getBoundingClientRect()`, mentre `document.body.style.zoom = 1.30` (default di `applyUiZoom`). `clientX` è in spazio viewport e `getBoundingClientRect()` può essere in spazio zoomato: su **Safari** (default su Mac) e **Chrome < 128** i due divergono → il ray parte spostato. (Chromium ≥ 128 li ha resi coerenti; Firefox usa `transform: scale` ed è già coerente.)

**Fix** in `replaceOnViewportClick` (fase `pickScan`):
- NDC calcolato con `event.offsetX/offsetY` relativi al canvas, divisi per `clientWidth/clientHeight`. offset e clientWidth sono entrambi nello spazio **locale** dell'elemento → il rapporto è la frazione vera, **invariante allo zoom** su qualsiasi browser. Fallback al calcolo `clientX`-`rect` se `event.target` non è il canvas (zero regressione).
- `camera.updateMatrixWorld()` prima di `raycaster.setFromCamera()` → il ray parte da una camera con matrice mondo aggiornata (difesa contro una proiezione da camera stantia tra due frame).

**Localizzato al solo pick scansione**: `onViewportClick` (MUA) e `sostOnViewportClick` restano **invariati** — lo snap-al-centro li maschera comunque, quindi nessun motivo di toccarli e blast radius ridotto. `node --check` 7/7. **Non riproducibile in locale** (dipende da browser/zoom dell'utente) → collaudo A/B utente.

## 2026-06-13 — 8.59.1: Replace-iT "Raffina+" hardening (da revisione avversariale)

Revisione avversariale multi-agente del 8.59.0 (18 agenti, 6 dimensioni, ogni finding verificato in modo indipendente sul codice). **Esito**: nessun blocker; la correttezza matematica del motore, la **direzione di R,t end-to-end** (il rischio principale), l'apply 4×4, il gating di sicurezza e la validazione input sono stati **confermati corretti** (anche con test numerici). Chiusi 4 finding reali emersi:

- **Race [major]**: la "Raffina" client non era disabilitata durante la chiamata server → due raffinamenti concorrenti su pose diverse potevano sovrapporsi. Fix: `replaceRefineServer` ora disabilita anche `#replaceBtnRefine` e cattura uno **snapshot della posa** (`_poseSnap`, gli elementi di `matrixWorld`) all'estrazione; se alla risposta la posa è cambiata (soglia 1e-6) la risposta viene **scartata** ("ripremi").
- **Guardia anti-delta [major]**: una convergenza a posa sbagliata (init 3-punti scadente, crop che cattura la gengiva, minimo locale sul clocking) si applicava in silenzio. Fix: prima dell'apply si misurano rotazione e traslazione del delta ritornato; se **>8°** o **>1.5mm** la posa **non si applica** e si avvisa.
- **Comunicazione [minor]**: il ~1µm della validazione offline era su un test mesh 1:1 (corrispondenza esatta) e non rappresenta l'accuratezza reale CAD-vs-scan (~10-20µm di noise floor della scansione). Fix onestà: tooltip del pulsante riscritto senza claim µm assoluto; lo status mostra "**residuo fit**" invece di "RMSD" (un residuo di fit non è un'accuratezza di posa).
- **Endpoint [minor]**: `rit_refine_icp` non interpola più l'eccezione raw `{e}` nei `detail` 400/500 (messaggio generico al client) e logga lato server (`logger.warning`/`logger.exception`).

Il motore `refine_point_to_plane` e l'intero path client (`_replaceDoRefine`/`replaceRefineAll`) restano **invariati**: l'hardening tocca solo `replaceRefineServer`, il tooltip del pulsante e i rami d'errore dell'endpoint. `py_compile` OK; `node --check` 7/7. Refutati in verifica: NaN-guard (axisDir normalizzato), "basta alzare il cap del client" (il server è l'unico posto dove fare il nearest-neighbor full-res senza freezare il browser), rifiuto-normali `abs` (identico al client già validato).

## 2026-06-13 — 8.59.0: Replace-iT "Raffina+" — ICP point-to-plane SERVER full-res (opzione parallela)

Richiesta utente: gli scanbody (figli) hanno forme e geometrie molto diverse e a volte la posa della **madre** sulla scansione non è precisa; *"creiamo un'opzione parallela da provare in live, togliamo incertezza a questo passaggio definitivamente"*.

**Diagnosi.** Il raffinamento client esistente (`_replaceDoRefine`, beta point-to-plane dal 8.48.0) per restare reattivo nel browser **sottocampiona** a ~400 punti madre / ≤1500 scan (nearest-neighbor brute-force O(N·M)). Su uno scanbody quasi-cilindrico il **clocking** (rotazione attorno all'asse) è il DOF più debole — vincolato dal solo flat anti-rotazione, una frazione piccola dell'area — quindi è il primo a risentire del rumore quando si butta via risoluzione.

**Soluzione (opzione PARALLELA, additiva).** Nuovo pulsante **"Raffina+"** (`#replaceBtnRefineSrv`, verde, accanto a "Raffina") → `replaceRefineServer`: estrae la madre a piena risoluzione + il crop cilindrico della scansione (stessa logica di `_replaceDoRefine`, che **non viene toccato**) e chiama `POST /api/rit/refine-icp`. Il backend (`icp_engine.refine_point_to_plane`) esegue un ICP **point-to-plane** a **piena risoluzione** con `scipy.spatial.cKDTree` (O(N·logM) → niente cap), restituendo il delta rigido (R,t) che il frontend applica come matrice 4×4 al group (riuso del blocco di apply del client). In barra di stato: RMSD / coppie / iterazioni / ms per il confronto A/B col client.

Implementazione:
- Backend: `icp_engine.refine_point_to_plane()` (solve 6×6 linearizzato + fallback Kabsch, trimming mediana×2.5, rifiuto-normali, peso 5× sul cap, Rodrigues `_rot_from_omega`); endpoint `POST /api/rit/refine-icp` in `main.py` (`require_authorized`, Pydantic `RefineICPRequest`, executor + timeout `ICP_TIMEOUT_SECONDS`, cap 8000/20000 punti).
- Frontend (solo blocco `replace*` v3b): `replaceRefineServer` + abilitazione pulsante in `replaceRebuildPlacedList`; self-contained, il path client resta intatto.
- Validazione offline sui 3 scanbody reali utente (perturbazione 2° tilt + 1.5° clocking + 0.25mm, rumore 15µm): **server ~0.9-1.9µm** vs **client ~5-9µm** (~5-10× più preciso, err.rot ~10× più basso). `py_compile` OK; `node --check` 7/7.

## 2026-06-12 — 8.58.0: SHIFT+CLIC esteso ad Analizza (posa MUA) e Sostituisci

Richiesta utente (roadmap #1 da `replaceit-coupling-roadmap`): estendere a **tutti** i workflow di accoppiamento il gesto Shift+clic introdotto in 8.54.0 per Replace-iT. Solo `v3b`. Analizza è il workflow principale → review avversariale dedicata.

**Causa comune** (come Replace pre-8.54.0): la posa (clic singolo sullo scanbody) era agganciata all'evento `click` grezzo, che scatta **anche dopo un trascinamento** → ruotando si posava un MUA / marker fuori posizione.

**Fix**: il listener `pointerdown` (già presente per Replace) ora cattura pos+Shift (`replacePickDownX/Y/Shift`, **condivisi**) per **qualsiasi** modalità di posa (`placementMode || sostPlacementMode || replacePlacementMode`). Il **fallback Analizza** in `onViewportClick` e **`sostOnViewportClick`** posano SOLO con **Shift+clic pulito**: guardia movimento >6px = trascinamento → niente posa; clic senza Shift → hint (`showStatus` / `sostShowStatus`). Testi-guida `startPlacement` + `sostStartPlacement` → "SHIFT+CLIC … trascina per ruotare". Trascinare (senza Shift) ruota e non posa mai. *(La posa MUA aggancia comunque al centro scanbody via `findScanbodyCenter`; il gate uniforma il gesto ed evita pose accidentali in rotazione.)*

**Review avversariale dedicata** (2 lenti su Analizza + Sost/stato condiviso): Analizza gate **corretto** (Shift+clic posa, drag/no-shift no-op, nessun altro click rotto, lab-place non toccato), sost gate corretto, `sostShowStatus` ok, stato condiviso ok (modi mutuamente esclusivi, no doppio-dispatch). Unico finding reale = **guardia `.face` mancante** in `sostOnViewportClick` (preesistente, latente: oggi non crasha perché a `sostMesh` non sono attaccati figli wireframe, ma incoerente col pattern Analizza/Replace) → **aggiunta** `&& hits[0].face` come Analizza. (Il "render mode su sostMesh" segnalato = preesistente, fuori scope.)

Validazione: `node --check` 7/7 OK; marker versione allineati 8.58.0. `docs/MAPPA_FUNZIONALE.md` aggiornata (righe Posiziona Analizza + Sost). Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.57.0: Auto-config albero dopo Raffina (Madre nascosta + offset taglio +0.5mm di default)

Richiesta utente (con screenshot): *"una volta cliccato raffina e accoppiato, i parametri da usare e gli oggetti da visualizzare dovrebbero essere così settati e fleggati."* Solo blocco `replace*` del monolite `v3b`.

Due default per la vista-risultato dopo il ✓ Conferma+Raffina:
1. **Madre nascosta.** Nella callback `onDone` di `replaceConfirmSeed` (dove dal 8.47.0 si attiva `cutScan`), ora `_m.showSrc = false` + `_replaceApplyView(_m)` → resti con **Figlio + taglio scansione** = vista pulita del risultato. La Madre (scanbody di riferimento) resta **ri-attivabile** dall'albero per ispezionare l'accoppiamento. Prima (8.33.0) restava visibile (grigio-blu translucida sopra il Figlio).
2. **Offset taglio +0.5mm di default.** L'oggetto impianto alla posa nasce con `cutOffset: 0.5` (era 0) → il "Taglia scansione" parte con +0.5mm di margine attorno alla silhouette del madre, regolabile dallo slider 0-5 (l'utente, dopo collaudo, preferisce +0.5 al precedente 0 "aderente").

Confermati via `AskUserQuestion` (Madre nascosta = sì; offset = +0.5mm). `node --check` 7/7 OK; marker versione allineati 8.57.0. `docs/MAPPA_FUNZIONALE.md` aggiornata. Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.56.1: Picking 3 punti preciso — stop inerzia camera durante la posa (fix "punto lontano dal clic")

Feedback utente: *"i 3 punti sulla scansione per accoppiare la madre è sempre molto incerto, clicco ma il punto spesso si posiziona lontano dal mio clic"* (a volte spostato sullo schermo, a volte sotto il cursore ma nel punto sbagliato). Solo blocco `replace*` + controls camera condivisi (`v3b`).

**Diagnosi (indagine multi-agente con sintesi avversariale)** — due esiti importanti:
1. **NON è lo zoom.** Prima ipotesi (mismatch `clientX`/`getBoundingClientRect` sotto `body.zoom` 130%) **smontata**: il picking MUA di Analizza usa la formula NDC **byte-identica e non compensata** e funziona al 130% di zoom. Applicare `×zoomF` avrebbe **rotto** il picking (e su Firefox `syntesisGetUiZoom` ritorna 1.0 → no-op lì, danno su Chrome). La compensazione zoom serve solo per `style.left` (riscritto×zoom dal browser), non per il rapporto read-only del raycast.
2. **È l'inerzia di rotazione.** I controls hanno `enableDamping`/`dampingFactor=0.12`: dopo aver ruotato per vedere lo scanbody, la vista **deriva ~0.5s**; un Shift+clic durante la deriva colpisce la vista spostata → "punto lontano". Intermittente perché dipende se clicchi a vista ferma o ancora in deriva. Il MUA non lo mostra (`findScanbodyCenter` aggancia al centro, assorbe l'errore); il 3-punti usa il punto **grezzo** → lo espone.

**Fix**: flag `controls.noInertia` (default off → comportamento invariato). In `controls.update()` la velocità di rotazione residua viene azzerata se `noInertia` (invece del decadimento per inerzia). `replaceSeedUpdateUI` imposta `controls.noInertia = _placing` (dentro la guardia `analysisMode==='replace'`); reset a `false` su `selectWorkflow` (cambio workflow a metà posa) e all'uscita dalla posa (idle). Risultato: durante i 3-punti la vista si ferma di colpo al rilascio → il clic cade dove miri. Fuori dalla posa resta l'inerzia attuale.

**Review avversariale** (Explore mirato sui controls condivisi): fix **corretto e senza leak** — `scope`=istanza controls; il drag continuo funziona (onMM aggiunge velocità ogni frame, applicata poi azzerata); tutti gli exit ripristinano il flag; `else` byte-identico all'originale → zero impatto su Analizza/Sostituisci/Vedere.

Validazione: `node --check` 7/7 OK; marker versione allineati 8.56.1. `docs/MAPPA_FUNZIONALE.md` aggiornata. **Non riproducibile in locale** (serve il flusso reale STL + 3 clic) → collaudo utente post-deploy. Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.56.0: Raffina solo sul marker corrente, non su tutti

Richiesta utente: *"Raffina non puo' tutte le volte interessare tutti gli oggetti presenti ma solo quello che stiamo posizionando."* Solo blocco `replace*` del monolite `v3b`.

**Cosa fa**: la Raffina (ICP) ora agisce SOLO sull'impianto **attivo**, senza perturbare quelli già confermati. Marker attivo (`replaceActiveNum`): **default = ultimo piazzato**; **selezionabile** cliccando il nome dell'impianto nell'albero scena (highlight `▸` + colore blu; doppio-clic resta = focus camera). Il **✓ Conferma** raffina solo l'impianto appena confermato.

Implementazione:
- `replaceRefineAll(onDone, targetNum)`: se `targetNum != null` costruisce `targets` con quel solo marker, altrimenti tutti (legacy retrocompat). Le due iterazioni (round ICP + somma RMSD) ora usano `targets`.
- `_replaceRefineTargetNum()` (attivo se esiste, altrimenti ultimo), `replaceSetActiveImplant(num)` (valida l'esistenza + highlight), `replaceRefineCurrent()` (pulsante Raffina → risolve e imposta l'attivo per coerenza).
- `replaceConfirmSeed`: imposta `replaceActiveNum = P.num` e chiama `replaceRefineAll(cb, P.num)`; eliminazione dell'attivo → `replaceActiveNum = null` (resolver torna all'ultimo).

**Review avversariale** (2 lenti + verify) — ha colto una **regressione reale** che ho introdotto e ho corretto: lo snapshot `targets` (filter/slice) cattura i riferimenti una volta sola, mentre il vecchio codice iterava `replacePlaced` fresco a ogni round; un marker eliminato durante la raffina async (`setTimeout` round-dopo-round) sarebbe rimasto "zombie". Fix: `doRound` **ri-filtra `targets`** contro `replacePlaced` ad ogni round (stesso pattern già usato dal flusso swap, ~riga 15760). Altri fix dalla review: `replaceRefineCurrent` imposta l'attivo (highlight coerente); `replaceSetActiveImplant` valida il num; la callback del Conferma ri-lookup il marker per `num` (P può essere eliminato durante la raffina); grammatica "convergiuta"→"a convergenza".

Validazione: `node --check` 7/7 `<script>` OK; marker versione allineati 8.56.0. `docs/MAPPA_FUNZIONALE.md` aggiornata (riga Raffina + riga Albero). Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.55.0: "Taglia scansione" segue la silhouette del madre (profilo per-angolo)

Feedback utente sul 8.54.0: *"il taglia scansione dipende dalla forma del figlio mentre dovrebbe dipendere dalla forma della madre che si accoppia alla scansione."* Solo blocco `replace*` del monolite `v3b`.

**Diagnosi**: in 8.54.0 il *raggio* del buco veniva già dal madre (`p.meshSrc`), ma il taglio restava un **cilindro circolare capato a 3mm** → (a) un cerchio non cattura la *forma* della sezione; (b) madre e figlio finivano spesso entrambi contro il cap di 3mm → stesso buco → "sembra ancora il figlio".

**Fix**: nuovo `_replaceMadreProfile(p)` costruisce il **profilo radiale per-angolo** del madre — 48 settori attorno a `p.axisDir`, per ogni settore l'**85° percentile** del raggio dei vertici del madre (in mondo, ⊥ all'asse): ignora il flare del cap e gli outlier, i settori vuoti ereditano la mediana globale, guardia anti-runaway 8mm. `replaceRebuildScanGeometry` usa la soglia **per-settore** `prof[settore] + offset` (confronto su raggio², niente `sqrt`; un `atan2` per il settore) invece del raggio² unico → il buco segue la **sezione reale** dello scanbody, senza cap fisso. Fallback al cerchio (`replaceEstimateMarkerRadius`, che include l'offset) per i marker single-mesh "Allinea a 3 punti" o se il profilo non si costruisce. Lo slider OFFSET (8.54.0) continua ad allargare uniformemente.

**Review avversariale** (3 lenti + verify): **0 blocker/major**, 2 minor cosmetici corretti (vettore di riferimento allineato alla convenzione `ax.z` del codebase; documentata l'asimmetria 85°/90° tra profilo e fallback). Base/uso `(u,w)` coerenti build↔taglio, transform mondo come `replaceEstimateMarkerRadius`, offset applicato una volta sola per ramo, nessun NaN/div-zero.

Validazione: `node --check` 7/7 `<script>` OK; marker versione allineati 8.55.0. `docs/MAPPA_FUNZIONALE.md` aggiornata (riga Taglia scansione). Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.54.0: Taglio "Taglia scansione" guidato dal madre + offset slider + picking 3 punti con Shift+clic

Tre interventi Replace-iT dal collaudo live (solo blocco `replace*` del monolite `v3b`).

**1. Taglio guidato dal madre + offset regolabile** (*"il taglio deve togliere tutto attorno al file… deve essere guidato dal file madre… devo poter aumentare l'offset di taglio dall'albero scena"*). Il buco di "Taglia scansione" prendeva il raggio dal **figlio**; ora lo prende dal **MADRE** (`p.meshSrc` = scanbody scansionato, ciò che occupa davvero lo spazio nella scansione). Aggiunto un **offset per-marker** regolabile da uno **slider** sulla riga "Taglia scansione" dell'albero (`replaceSetMarkerCutOffset`, 0-5mm step **0.1**, label `+X.Xmm`), sommato DOPO il cap di 3mm → può superarlo per rimuovere la gengiva attorno quanto serve. Default 0 (parte aderente, +0.3mm di margine già esistente). Ricostruzione geometria **debounce 120ms** (review perf: la rebuild ~240k triangoli scattava a ogni tick dello slider); timer azzerato su toggle/elimina marker.

**2. Picking 3 punti con SHIFT+CLIC** (*"i 3 punti sulla scansione non sono mai precisi… ruotando il file il sistema registra un clic fuori posizione… ruotare e cliccare dovrebbero essere più distinti"*). **Causa**: lo scan-pick era agganciato all'evento `click`, che il browser emette **anche dopo un trascinamento** → ruotare posava un punto al rilascio. **Fix**: marker (anteprima) e scansione posano SOLO con **Shift+clic pulito** — Shift catturato al **pointerDOWN** (`replacePickDownShift` / `shiftAtDown`, non al rilascio, su raccomandazione della review) + guardia movimento **>6px** = trascinamento → nessuna posa. Listener `pointerdown` scopato a `replacePlacementMode` + solo tasto sinistro (no contaminazione cross-workflow). Testi-guida aggiornati a "SHIFT+CLIC"; hint se si clicca senza Shift. Trascinare (senza Shift) ruota e non posa mai un punto fuori posizione — risolve anche la precisione (al momento del tap la vista è ferma).

**Review avversariali** (Workflow, 3 lenti + verify, due campagne):
- *Cut*: 1 major confermato (rebuild per-tick) → **debounce** applicato. Nit (title slider per single-mesh) → corretto.
- *Picking*: 6 "major" segnalati ma **nessuno confermato dalla verifica** (edge case: Shift catturato a mouseup, coord stale cross-workflow, mouseup fuori canvas, ecc.). Applicati comunque i miglioramenti a basso costo: **Shift catturato al press**, **scoping del listener**, **clear del timer debounce** su toggle/delete.

Validazione: `node --check` 7/7 blocchi `<script>` OK; marker versione allineati 8.54.0. `docs/MAPPA_FUNZIONALE.md` aggiornata (riga Taglia scansione + prosa picking + versione mappata). Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.53.1: Etichetta impianto staccata dal marker con linea guida (fix scorcio)

Feedback utente sul 8.53.0: *"il label è attaccato sul riferimento mentre dovrebbe avere una linea che lo allontana e lo posiziona più alto, come su Analizza"*. Solo blocco `replace*` del monolite `v3b` → bump `<title>`/`ANALIZZA_BUILD` 8.53.1.

**Root cause**: in 8.53.0 l'etichetta era un clone esatto dei MUA — offset 3D `posizione + asse×10mm`. Ma nel Replace-iT la vista è spesso quasi-occlusale (camera che guarda lungo l'asse dell'impianto): per **scorcio prospettico** i 10 mm 3D si proiettano a ~2 px sullo schermo → la pillola resta sul marker e la linea guida è lunga ~2 px (invisibile). Gli stessi MUA soffrirebbero lo stesso problema, ma in Analizza si guarda di solito più di lato.

**Fix** (`replaceUpdateLabels`): offset non più 3D ma in **coordinate schermo**. La pillola sta a `OFF_PX = 54` px **fissi** dal marker, lungo la **direzione dell'asse proiettata** in schermo, sempre orientata verso l'**alto** (se la proiezione dell'asse punta in basso si inverte; caso degenere asse ⊥ schermo → verticale). Distacco e linea guida sempre visibili in qualsiasi inquadratura — più robusto degli stessi MUA. Grafica invariata (`.divergence-label`, colore impianto, linea + ancora su `#labelLines`).

Validazione: `node --check` 7/7 v3b OK; marker versione allineati 8.53.1. `docs/MAPPA_FUNZIONALE.md` aggiornata (riga Label 2D). Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.53.0: Etichetta impianto = "#N Marca Modello Ømm" (3D come i MUA in Analizza)

Richiesta utente: *"il label deve indicare anche marca, connessione e diametro. Esempio #1 Megagen Anyridge 4mm"* + *"posizionali come in Analizza, stessa grafica e posizione"*. Solo blocco `replace*` del monolite `v3b`; additivo, altri workflow invariati → bump `<title>`/`ANALIZZA_BUILD` 8.53.0.

**Cosa fa:** ogni etichetta dell'impianto Replace-iT mostra l'identità della libreria (`#1 Megagen AnyRidge 4mm`) invece del solo numero / codice figlio, e l'etichetta 3D in scena ha la stessa grafica e posizione delle label MUA del flusso Analizzare.

Implementazione:
- **Helper `_replaceLibId(rec)`** (dopo `_replaceLibKey`): ritorna `"Marca Modello Ømm"` dai campi dell'impianto; diametro normalizzato (strip `Ø` e trailing `.0` → `"4.0"`→`"4mm"`). Stringa vuota se mancano marca/modello/diametro → i chiamanti ricadono sul vecchio `typeLabel`/"impianto" (retrocompat librerie LITE non assegnate).
- **Congelamento alla posa**: alla creazione dell'oggetto impianto `p` (prima del `var p = {…}`) si risolve `replaceLibs` per `replaceCurrentLibId` (fallback `replaceCurrentDetail`) e si scrivono `p.marca/modello/diametro`. Così le etichette restano immutabili anche se l'utente cambia poi la cascata.
- **3 siti testuali**: voce lista pannello (`replaceRebuildPlacedList` → `#1 Megagen AnyRidge 4mm · 0.228mm`) + nodo albero principale (`replaceRebuildTree` ~16989) + ramo single-mesh legacy (~17049). Priorità conservata al nome-dente FDI (rinomina 8.49.0).
- **Etichetta 3D allineata ai MUA**: `replaceUpdateLabels` riscritta come clone di `updateDivergenceLabels` — pillola `.divergence-label` del colore dell'impianto (`p.color`), offset `posizione + asse×10mm` (già identico), **linea guida SVG** (line + circle ancora) su `#labelLines`, compensazione `body.zoom` (`syntesisGetUiZoom`) prima assente, testo = identità. Rimosso lo sfondo scuro forzato `#0D1B2A` in `replaceEnsureLabelElements` (classe `replace-label` conservata: serve solo alla pulizia DOM).
- **Backend (coerenza)**: il dettaglio `GET /api/rit/libraries/{id}` (`main.py`) ora espone `marca/modello/diametro` — erano già letti da `rit_get_library_detail` ma omessi dalla response, mentre il list endpoint li espone. Allinea il fallback `replaceCurrentDetail` al percorso primario (`replaceLibs`).

**Review avversariale** (Workflow, 3 lenti correttezza/render-loop/integrità-dati + verify) → fix integrati: (a) `_replaceLibId` ritorna `''` se il diametro è solo-simbolo (`Ø`/`ø`/`⌀`) dopo lo strip → niente "marca modello mm" senza numero; (b) ramo albero single-mesh riusa `_libNm` (rimossa la doppia chiamata a `_replaceLibId`); (c) commento sull'invariante `#labelLines` (svuotato ogni frame da `updateDivergenceLabels`, stessi guard → qui solo append). I due "blocker" segnalati (leak SVG, API che non espone i campi) **verificati come NON reali**: il path primario usa `replaceLibs` (che espone già i campi) e lo svuotamento di `#labelLines` è garantito dagli stessi guard `camera/renderer/vp` che gateano `replaceUpdateLabels`.

Validazione: `node --check` 7/7 blocchi `<script>` OK; `py_compile main.py/registry.py` OK; marker versione allineati (title v8.53.0 / ANALIZZA_BUILD / BACKEND_VERSION 8.53.0). `docs/MAPPA_FUNZIONALE.md` aggiornata (righe Label 2D / albero / lista marker + versione mappata). Deploy canary su entrambi i servizi.

---

## 2026-06-12 — 8.52.0: Cascata Marca→Modello→Diametro + Madre/Figlio per ruolo (runtime)

Richiesta utente: *"il front mostra scegli marca, modello, diametro… poi scegli il figlio"*. Chiude il flusso end-to-end (pannello admin → runtime). Tocca il monolite `v3b` (solo blocco `replace*`) → bump `<title>`/`ANALIZZA_BUILD` 8.52.0.

**Backend** (additivo, retrocompatibile):
- 3 colonne `rit_library.marca/modello/diametro` (`ALTER ADD COLUMN IF NOT EXISTS`).
- CSV/editor le scrive **esatte** (`_rit_build_libraries_from_rows`); LITE Exocad le ricava dal `display` via `database.rit_parse_display_mmd` (`'(IPD Lite) Megagen AnyRidge Ø4.0' → Megagen/AnyRidge/4.0`; robusto a parentesi annidate).
- Backfill idempotente in `init_db` (UPDATE solo righe con `marca` NULL → le librerie già importate prendono i 3 livelli).
- `/api/rit/libraries` e il detail le espongono.

**Runtime `v3b`** (blocco `replace*`):
- Il menù unico `#replaceLibSelect` (+ `replaceOnLibChange`/`replacePopulateLibSelect`, rimossi) è sostituito da **3 tendine dipendenti** `#replaceMarcaSelect`/`#replaceModelloSelect`/`#replaceDiamSelect` (`replaceBuildCascade`, `replaceOnMarca/Modello/DiamChange`, `replaceCascadeReset`): raggruppano `replaceLibs` per marca/modello/diametro; il Ø atterra sulla libreria → nuova `replaceLoadLibrary(id)`.
- Le tendine **Madre** (= ex SORGENTE) e **Figlio** (= ex SOSTITUTO) sono **filtrate per ruolo** in `replacePopulateTypeOptions(selId, placeholder, want)`: `madre`→role madre|entrambi, `figlio`→role figlio|entrambi. **Fallback a tutti i type SOLO se la libreria non ha proprio ruoli** (LITE non assegnata → retrocompatibile); con ruoli parziali il dropdown senza match resta vuoto (niente madri sotto "figlio").
- Liste disable-durante-piazzamento (2 siti) e hard-reset aggiornati ai nuovi id; relabel UI SORGENTE→Madre, SOSTITUTO→Figlio; ENG tag a 3 stati.
- Sblocca le LITE importate via i ruoli assegnabili dal pannello admin (8.51.0).

Robustezza (2 review avversariali, fix integrati): parser display gestisce parentesi annidate; `replaceOnDiamChange` **avvisa** se due librerie condividono la stessa terna marca/modello/Ø (niente selezione silente); fallback ruolo distingue "nessun ruolo" (LITE) da "ruoli parziali". `py_compile` + `node --check` **8/8** su `v3b` OK; smoke-test parser; **0 riferimenti orfani** ai simboli rimossi. `registry.BACKEND_VERSION` 8.52.0; `docs/MAPPA_FUNZIONALE.md` aggiornata.

## 2026-06-12 — 8.51.0: Admin Librerie Replace-iT — 4 tab, ruolo "entrambi", componenti editabili

Richieste utente sul pannello admin `/gestione`. Solo admin + backend rit; **runtime `v3b` NON toccato**.

**4 tab** (`.admin-tabs` + `<section class=tabpane>` + `switchAdminTab`): Richieste di accesso / Librerie Replace-iT / Archivio STL / Crea libreria.

**Crea libreria** — editor a griglia + **Scarica template** (ora si scarica già come `libreria.csv`) + **Carica ZIP (CSV+STL)** nello stesso posto. `ritUpload` refactorizzato con target parametrici (`ritSrcEl`/`ritBtnEl`/`ritMsgEl` + `ritUploadFrom`) così i due upload — import Exocad/manuale (tab Librerie) e ZIP CSV (tab Crea) — condividono il flusso di conferma. Parser `_rit_csv_from_zip` tollerante: usa `libreria.csv` se c'è, altrimenti l'unico `.csv` dello ZIP (se niente `config.xml`).

**Ruolo a 3 stati** madre / figlio / **entrambi** (un file "entrambi" conta sia come madre sia come figlio nella validazione). Rimossa la colonna *Asse occl.* dalla griglia (default `0,0,1` lato server; opzionale nel CSV).

**Dettaglio libreria EDITABILE** (importate **e** create): ogni componente (`rit_scanbody_type`) modificabile in **ruolo/nome/ENG**, **disattivabile** (nuovo flag `active`, default TRUE; i disattivati spariscono dalla superficie clinica `/api/rit`) ed **eliminabile**. Nuovi endpoint `require_admin`: `PATCH`/`DELETE /admin/rit/libraries/{lib}/types/{type}`. Serve soprattutto per assegnare i ruoli alle LITE importate (che li hanno NULL) → prerequisito della futura cascata Marca→Modello→Ø nel runtime.

Implementazione e robustezza (da due review avversariali):
- DB additivo retrocompatibile: `ALTER ... ADD COLUMN IF NOT EXISTS active`.
- Overwrite di una libreria **preserva** `active`/`role` per-componente (snapshot prima del cascade DELETE, ri-applicati per chiave `marker_filename`+`display`; per CSV/editor il ruolo dell'import vince, per le LITE il ruolo assegnato a mano sopravvive).
- Conteggio `n_type` della superficie clinica filtra i type attivi (coerente col detail `active_only`).
- PATCH **parziale** vero (aggiorna solo i campi inviati via `model_fields_set`).
- Disattiva/elimina **rifiutati (409)** se lascerebbero una libreria ATTIVA senza madre o senza figlio (guardia in transazione; non penalizza librerie con ruoli ancora NULL).
- QA: `py_compile` + `node --check` OK; smoke-test (ruolo entrambi, tolleranza CSV, predicato invariante) + 2 review avversariali. `registry.BACKEND_VERSION` 8.51.0; `docs/MAPPA_FUNZIONALE.md` aggiornata.

## 2026-06-12 — 8.50.1: Font unico Synthesis (Helvetica), via Google Fonts

Richiesta utente: *"un unico font meno identificabile con Claude, tipo Helvetica"*. Cambio puramente tipografico, nessuna modifica funzionale.

Sostituiti **tutti** i font del prodotto con lo stack di sistema **Helvetica** (`'Helvetica Neue',Helvetica,Arial,sans-serif`) e rimosse **tutte** le dipendenze Google Fonts (niente più `<link>` a `fonts.googleapis`/`fonts.gstatic`). Il prodotto aveva due sistemi font, entrambi eliminati perché "Claude-like" (serif+sans):
- **admin** (`accedi`, `gestione`): Fraunces (serif) + IBM Plex Sans + IBM Plex Mono;
- **app principale** (`v3b`, `dashboard`, `vedere`, `home`, `ds/tokens.css`): Source Sans 3.

Principio *"cambio identità, preservo il ruolo"*: ogni testo sans (compresi i titoli che erano in Fraunces serif) → Helvetica; il **solo** monospace reale (IBM Plex Mono, usato nelle pagine admin per dati tabellari/chiavi) → system-mono (`ui-monospace,Menlo,Consolas,monospace`); le variabili `--mono` dell'app principale (che già puntavano a un sans, non a un mono reale) → Helvetica, senza introdurre nuovi monospace.

Implementazione:
- App principale: cambiate solo le **definizioni** delle variabili CSS `--font`/`--mono` nei `:root` (v3b riga 41, dashboard, vedere, home) e `--syn-font`/`--syn-mono` in `ds/tokens.css`.
- Admin: sostituzione delle `font-family` esplicite (accedi 17×, gestione 26×).
- Rimossi i `<link>` Google Fonts + preconnect in tutti i 6 HTML.
- v3b toccato → bump `<title>`/`ANALIZZA_BUILD` **8.50.1** (era 8.49.0, non toccato in 8.50.0); `registry.BACKEND_VERSION` 8.50.1; MAPPA "Versione software mappata" 8.50.1 (nessun UI-element aggiunto/rimosso).
- QA: `node --check` 8/8 sui blocchi script di v3b OK (cambi solo CSS + 3 stringhe versione); verifica automatica zero residui Fraunces/IBM Plex/Source Sans/`fonts.googleapis`.
- Deploy canary LEGACY→BACKEND commit `3cd1a3b` (LEGACY `d9f0f9c4`, BACKEND `60cdaff7`); verifica live 8.50.1 + **Helvetica servito** (home/accedi/analizzare) + **zero Google Fonts** su entrambi i domini + alias `app.syntesis-icp.com`.

## 2026-06-12 — 8.50.0: Crea librerie Replace-iT dal pannello admin + Archivio STL unificato

Richiesta utente: *"un flusso semplice per creare librerie nuove dal pannello di Synthesis"*. Backend + pannello `/gestione`; **runtime `v3b` NON toccato** (`ANALIZZA_BUILD`/`<title>` invariati).

**Tre porte sullo stesso `POST /admin/rit/libraries`, tutte verso un archivio unico:**
1. ZIP Exocad (`config.xml`) — il flusso storico;
2. ZIP manuale (`libreria.csv` + STL);
3. **editor in-pannello** — griglia a righe (marca/modello/diametro/asse/ruolo/file/nome/ENG), `+`/`×`/Salva, file per riga dall'archivio o caricato al momento.

Schema CSV (separatore `,`/`;` auto, BOM Excel): `marca,modello,diametro,asse_occlusale,ruolo,file,nome,eng`; ogni `(marca,modello,diametro)` → una `rit_library` (`source` csv|editor), con ≥1 madre e ≥1 figlio; `role` su `rit_scanbody_type`.

**Archivio STL unificato** (`rit_stl_asset`, chiave = nome → `sha256`): la "cartella unica" del sistema. **Anche l'import Exocad passa di qui** → i marker condivisi (0T3/1T3/2T3 = scanbody IPD usato su più marche) vivono una sola volta. Collisione per nome con contenuto diverso → 409, conferma per-file sovrascrivi/salta. **"Live per nome" globale**: sovrascrivere un asset ripunta `marker_sha256` di tutte le librerie che lo usano. **Lucchetto** (`locked`) + **codice di sicurezza** unico (`rit_lock_secret`, hash pbkdf2 via `auth.hash_password`, gating SEMPRE server-side): blocca delete/overwrite dei master validati. **Anteprima 3D** in modale (Three r169 importmap come `/vedere`, parser STL inline) con terna assi + sfera bianca sull'origine (0,0,0). **Scarica template CSV** (Blob client-side).

Implementazione:
- `database.py`: tabelle `rit_stl_asset`, `rit_lock_secret`; colonne additive `rit_scanbody_type.role`, `rit_library.source`; backfill idempotente in `init_db` (normalizza i `marker_filename` storici a basename + popola l'archivio dai type esistenti, **guard anti-collisione**: i nomi storici con contenuti divergenti restano fuori dall'archivio e vengono loggati).
- `admin.py`: helper condivisi `_rit_resolve_files` (fase pura) + `_rit_write_resolved`; parser CSV/righe; 8 endpoint archivio/lucchetto/codice; import Exocad a due gate (STL poi keyword, nessuna scrittura finché entrambi non sono decisi).
- `syntesis-gestione.html`: sezioni "Archivio STL" e "Crea libreria", anteprima 3D, modale conferma, accumulatore decisioni client (`ritAcc`).
- Versione: `registry.BACKEND_VERSION` 8.50.0; `docs/MAPPA_FUNZIONALE.md` aggiornata.
- QA: `py_compile` + `node --check` OK; smoke-test resolver 5/5 + builder; **due review avversariali** (≈30 agenti), tutti i finding reali chiusi (MAJOR backfill collision-safe; dedup upload diretto; pre-check `import_name` Exocad prima delle scritture).

## 2026-06-11 — 8.49.0: Replace-iT — focus camera (doppio-clic) + nome dente (FDI)

Item audit minore (multi-impianto). Solo blocco `replace*`; additivo, altri workflow INVARIATI.

Due interazioni nuove sull'albero scena per ogni impianto piazzato. **(1) Focus camera** (`replaceFocusImplant`): doppio-clic sul nome dell'impianto → la camera lo inquadra. Bbox del figlio in mondo (`THREE.Box3().setFromObject`, su `p.meshSub`/`p.meshSrc`/`p.group` — non il group, per non includere la terna AxesHelper); `controls.target` sul centro + camera avvicinata mantenendo la direzione di vista corrente; animazione ease-out ~280ms (lerp, pattern di `installAltClickPivot`). **(2) Nome dente** (`replaceRenameImplant`): pulsante ✎ → `prompt()` numero dente FDI (es. "26") → `p.toothLabel` (vuoto = ripristina "#N impianto"); input ≤6 char escapato via `_escHtml`; etichetta "#N · 26". Modificate le righe header di entrambi i rami albero (madre+figlio e single-mesh legacy). NB: non persistito (saveCase non salva ancora replace).

Review avversariale (Workflow, 3 lenti correttezza/sicurezza/isolamento + sintesi) → CLEAN: i "major" delle lenti erano falsi positivi verificati sul sorgente (la race focus-durante-delete non esiste — la closure cattura snapshot Vector3; l'XSS non esiste — `replaceShowStatus` usa textContent). 2 migliorie opzionali applicate (init `toothLabel`; fallback focus su mesh). `node --check` tutti i blocchi OK; harness Node sulle funzioni reali estratte 19/19. Deploy canary LEGACY→BACKEND commit `9de1c06` (LEGACY `2d5404db`, BACKEND `29ad0269`); verifica live 8.49.0 + funzioni nel servito + gating 403 + alias.

---

## 2026-06-11 — 8.48.0: Replace-iT — ICP point-to-plane (beta, dietro toggle)

Item 3 del feedback ICP ("possiamo migliorare il best fit madre↔scansione?"), dopo la scelta utente "implementa ora, validi tu su reale". Solo blocco `replace*`; DEFAULT = point-to-point (= produzione, identico).

Toggle Impostazioni>Algoritmo "Motore ICP Replace-iT" (`syntesis_replace_icp`: p2point default | p2plane beta). In beta, `_replaceDoRefine` usa point-to-plane (6×6 `_replaceSolveLin` + Rodrigues, normali scansione) + rifiuto-normali (gengiva/back-face). Reti: guardia anti-passo + fallback Kabsch + gate RMSD.

Validazione sintetica: su mesh grossolana point-to-plane nettamente migliore (rmsd 0.322→0.021); su mesh fine il point-to-point è leggermente meglio in posizione (0.049 vs 0.148) → cilindro liscio = test debole → default point-to-point, beta da validare su scan reale. Default identico alla produzione. Review avversariale 2 lenti → 0 finding. `node --check` 8/8 OK. Deploy canary LEGACY→BACKEND commit `e72dc7f` (LEGACY `6a3219e2`, BACKEND `b3a7389c`).

## 2026-06-11 — 8.47.0: Replace-iT — Conferma = conferma + raffina + auto-taglio scansione

Feedback utente: il pulsante Conferma deve attivare conferma e raffina; una volta raffinato deve attivarsi il taglia scansione sull'albero. Solo blocco `replace*`; altri workflow invariati.

`replaceConfirmSeed`, dopo aver finalizzato l'impianto, lancia `replaceRefineAll` (ICP auto-loop) e — a raffina conclusa, via callback `onDone` — imposta `p.cutScan=true` + `replaceRebuildScanGeometry` + `replaceRebuildTree` (auto-taglio scansione, raggio adattivo 8.45.0). Il bottone "Raffina" separato resta. Verifica browser (mock, `_replaceDoRefine` stubbato): conferma → push immediato, cutScan true dopo onDone. `node --check` 8/8 OK. Deploy canary LEGACY→BACKEND commit `c2b7b70` (LEGACY `a2979ffd`, BACKEND `79e89ebe`).

Item 3 del feedback (migliorare l'ICP) investigato ma NON rilasciato: l'ICP è point-to-point; il rifiuto-normali prototipato è no-op sul sintetico; la leva reale è point-to-plane. Non si spedisce una modifica di precisione clinica validata solo su sintetico — serve validazione su scan reale (prototipo revertato).

## 2026-06-11 — 8.46.0: Replace-iT — Concludi / export STL dei sostituti

Feedback utente: "arriva il pulsante concludi e esporta file". Chiude il gap più grosso: il risultato non usciva dall'app. Solo blocco `replace*`; altri workflow invariati.

`#replaceBtnFinish` "Concludi · Esporta" (era scaffolding disabilitato) → `replaceExportSTL` apre dialog nome `#replaceExportDialog`; `confirmReplaceExport` sanifica; `_replaceDoExportSTL` costruisce un unico STL binario dei sostituti (figli `p.meshSub`) di tutti gli impianti, vertici in mondo via `group.matrixWorld` (normali `getNormalMatrix` + fallback cross-product), scaricato con `writeBinarySTL`. Madre non esportata; niente flip extra (mesh già posata).

Verifica browser (mock): dialog ok; 2 impianti → 260 triangoli, span x[−2,22]; normali trasformate (90°X: +Z→(0,−1,0)). Review agente: 1 "blocker" = falso positivo (getNormalMatrix muta in-place, verificato). `node --check` 8/8 OK. Deploy canary LEGACY→BACKEND commit `f44bd94` (LEGACY `bcd462a2`, BACKEND `fdf2892a`); verifica live 8.46.0 + gating 403 su entrambi + alias.

## 2026-06-11 — 8.45.0: Replace-iT — "taglia scansione" a raggio adattivo

Feedback utente: la "taglia scansione" tagliava troppo in orizzontale (x e y); dovrebbe tagliare le interferenze e poco altro. Solo blocco `replace*`; altri workflow invariati.

Prima `replaceRebuildScanGeometry` bucava con cilindro a raggio fisso 3.0mm attorno a ogni marker (buco 6mm, oltre lo scanbody ~4mm). Ora `replaceEstimateMarkerRadius(p)`: raggio = 90° percentile dell'estensione radiale del figlio piazzato attorno all'asse (vertici in mondo) + 0.3mm, cap al vecchio 3.0 (mai più largo), fallback fisso. Scanbody ~2mm → raggio ~2.3mm (era 3.0). Profondità ±30mm invariata.

Verifica browser (mock): R2.0→2.3, R2.9→cap 3.0, fallback 3.0. `node --check` 8/8 OK. Deploy canary LEGACY→BACKEND commit `4ce6234` (LEGACY `6cbdd5bf`, BACKEND `120092bc`); verifica live 8.45.0 + gating 403 su entrambi + alias.

## 2026-06-11 — 8.44.0: Replace-iT — pulizia testi pannello + finestra guida tema Albero Scena

Feedback utente: ripulire i testi spiegazione nella colonna destra + finestra anteprima coi colori della finestra Albero Scena. Solo markup/CSS `replace*`; logica e altri workflow invariati.

- (A) Rimossi da `#panelReplace` i 3 testi esplicativi lunghi: intro "Carica la scansione...", callout "Flusso: ...", `#replaceGuide` "Modello sorgente→sostituto..." (non referenziato da JS). Restano i label dei campi e i controlli.
- (B) Finestra guida `#replacePreviewBox` ri-tematizzata come l'Albero Scena `#layersPanel`: fondo bianco translucido `rgba(255,255,255,0.82)` + `var(--border)` + shadow leggera + blur; testi scuri (`var(--dark)`/`var(--gray)`/`var(--blue)`); bottoni Annulla/Ricomincia chiari; badge inattivo `var(--pearl)`/`var(--gray)`; canvas 3D resta scuro. Supera la scelta "tema scuro mantenuto" di 8.41.0 su richiesta esplicita.

Verifica browser (mock): boxBg chiaro, 3 testi assenti. `node --check` 8/8 OK. Deploy canary LEGACY→BACKEND commit `fc6dd6a` (LEGACY `582ccabe`, BACKEND `6b6817c9`); verifica live 8.44.0 + gating 403 su entrambi + alias.

## 2026-06-11 — 8.43.0: Replace-iT — taglio del CAD sorgente dall'origine (slider, tieni il cap)

Feedback utente live (stile Exocad): la scansione spesso non presenta tutta la superficie dello scanbody → accorciare il CAD sorgente alla sola parte esposta concentra l'accoppiamento sulla zona realmente scansionata. Solo blocco `replace*`; altri workflow invariati.

- UI: slider verticale `#replaceTrimSlider` (in `#replaceTrimCol`, `writing-mode:vertical-lr`) accanto all'anteprima marker, label `#replaceTrimLbl`.
- Motore (frame CAD): `replaceTrimGeoAlongAxis(geo, axis_occlusal, soglia)` tiene i triangoli col centroide-assiale ≥ soglia (cap), rimuove l'apicale vicino all'origine; soglia 0..95% sul range assiale (`replaceGeoAxialRange`); asse dalla libreria con flip robusto verso il baricentro.
- Anteprima live (`replaceOnSrcTrim`): swap di `replacePreviewMesh.geometry`, marker fermo; stato `replaceSrcTrim`.
- Integrazione fit: in `replacePlaceFromSeed` il taglio si applica a `geoSrc` → MADRE visibile + `p.srcGeo` (Raffina ICP campiona il cap); FIGLIO intero.

Review avversariale (3 lenti) → 5 finding confermati, tutti fixati: flip asse verso il baricentro (axis_occlusal invertito non tiene più l'apicale), guardia non-indexed/normal, dispose geometria tagliata OWNED (flag `userData.replaceOwned`) in `_replaceDisposeGroup` (no leak su delete/abbandono pending), reset markerPts su ri-taglio. Verifiche browser (mock): range/trim corretti, asse −Z→+Z tiene il cap, owned flag, markerPts 2→0. `node --check` 8/8 OK. Deploy canary LEGACY→BACKEND commit `9798838` (LEGACY `a11f5d8b`, BACKEND `7eea2ab8`); verifica live 8.43.0 + trim function nel servito + gating 403 su entrambi + alias.

## 2026-06-11 — 8.42.0: Replace-iT — rimossa la "calamita" sui 3 clic scansione

Feedback utente live: durante `pickScan` un dot rosso semi-trasparente (0.45mm r, opacity 0.55) seguiva il cursore su `replaceMesh` per mostrare dove sarebbe caduto il clic (nessuno snap) → "scomoda e grossolana, o migliora o la togliamo" → scelta: TOGLI. Solo blocco `replace*`; flusso 3-punti e altri workflow invariati.

Rimossi (−63 righe): `replaceOnViewportHover` + listener `mousemove`, stato `replaceHoverDot`, funzione `replaceHideHoverDot` (+ 2 chiamate vive), dispose in `_hardResetReplace`; orfani `replaceMakeDot` + `REPLACE_DOT_COLOR` (l'altro caller `sourceDot` era sparito in 8.40.0). Conservato `REPLACE_DOT_R`. Ora i 3 clic si fanno liberamente (cursore a croce).

`node --check` 8/8 OK; smoke test browser (mock): funzioni hover undefined, flusso intatto. Deploy canary LEGACY→BACKEND commit `69ea254` (LEGACY `cbf18b5a`, BACKEND `dbc17881`); verifica live 8.42.0 + hover assente nel servito + gating 403 su entrambi + alias.

## 2026-06-11 — 8.41.0: Replace-iT — design system finestra guida + colore Madre

6° intervento dall'audit (autonomo). Solo blocco `replace*`/markup; logica e altri workflow invariati (gemello Sostituire intatto).

- Colore **Madre** (CAD sorgente, overlay di riferimento) da verde `#2DBE8B` (conflitto col verde clinico "Ottimo" `#639922`) a grigio-blu ghost `#8090A8` (scelta utente). Token `--ghost:#8090A8`; 4 siti (materiale 3D, label `#replaceViewRow`, default albero, accent slider) + testi "verde"→"grigio-blu".
- Box "Flusso" del `#panelReplace` da oliva off-palette a callout tokenizzato (`var(--dark)`/`var(--pearl)`/`var(--border)`).
- Verde `#0D9E6E` di `#replaceBtnConfirm`/`#replaceBtnPlace`/badge passo → `var(--green)`.
- Tema scuro della finestra guida mantenuto (gemello `#cutViewOverlay` anch'esso scuro).

Verifica browser (mock): Madre rgb(128,144,168), Conferma `var(--green)`, Flusso tokenizzato (screenshot). `node --check` 8/8 OK. Deploy canary LEGACY→BACKEND commit `bb05ed5` (LEGACY `750aeb32`, BACKEND `787c2a21`); verifica live 8.41.0 + gating 403 su entrambi + alias.

## 2026-06-11 — 8.40.0: Replace-iT — cleanup dead-code auto-ICP

5° intervento dall'audit (autonomo). Passo dedicato (CLAUDE.md §3.4): rimozione fisica del binario auto-ICP, disattivato dal 8.35.0 (flusso unico a 3 punti scelto dall'utente) e annotato. Solo blocco `replace*`; flusso 3-punti live e ogni altro workflow invariati. **Net −241 righe.**

Rimossi: `replaceAutoPlaceFromSource` (~126 righe) con `REPLACE_AUTO_RMSD_GATE`; `_replaceEstimateCadRadius`; `replaceStartPlacement`; ramo `pickSource` in `replaceOnViewportClick`; fasi morte `pickSource`/`chooseType`/`posed` in `replaceSeedUpdateUI`/`replaceGuideRender`; stati `replaceSeed.sourceCenter`/`sourceAxis`/`sourceDot` + rami `hasSource`/`hasSourceLib` negli handler dropdown (sempre falsi nel live: scritti solo dal ramo pickSource); markup pulsanti `#replaceBtnAlign`/`#replaceBtn3pt`; commenti storici falsi.

Conservati (whitelist condivisi/vivi): `replacePlacementMode`, `findScanbodyCenter`, `replaceEstimateCylinderAxis`, `_replaceDoRefine`, `sostRobustCenter`, `replaceStartThreePoint` (caller live = `replaceStartNewImplant`), `replaceMaybeAutoPlace` (no-op vestigiale, solo commento aggiornato).

Metodo: audit multi-agente (5 lenti map + sintesi piano line-cited) → verifica manuale riga-per-riga (risolta l'ambiguità `chooseType` = fase morta) → rimozione bottom-to-top via script con assert sul contenuto → smoke test browser (mock): funzioni vive presenti, morte undefined, FSM senza throw, pulsanti assenti dal DOM → review avversariale (3 lenti) → 0 finding. `node --check` 8/8 OK. Bump 8.40.0, MAPPA aggiornata. Deploy canary LEGACY→BACKEND commit `bfa6e2d` (LEGACY `1c4ea9c0`, BACKEND `02322ab1`); verifica live 8.40.0 + dead-code assente nell'HTML servito + gating anon→403 su entrambi + alias.

## 2026-06-11 — 8.39.0: Replace-iT — visualizzazione (render mode + trasparenza per-oggetto)

4° intervento dall'audit (autonomo). Richiesta utente: solido/reticolo/entrambi + trasparenza, "stesso metodo di Analizza". Solo blocco `replace*`; altri workflow invariati.

- **Modalità render globale estesa al workflow replace**: `applyRenderModeToScene` (invocata dalla barra `#vmBar` via `onSyntesisViewModeChange`→`onEnvRenderModeChange`, e dal tab Impostazioni) ora chiama il nuovo `replaceApplyRenderMode()` → `solid|wireframe|both` raggiunge `replaceMesh` + `meshSub`/`meshSrc` di ogni impianto + anteprima `replacePending` (prima enumerava solo `scanMesh`/MUA/Misurare). `replaceApplyRenderMode` richiamato anche in coda a `replaceRebuildTree` → mesh nuove o ri-geometrizzate (load, conferma, swap figlio, taglio scansione) prendono subito la modalità.
- **Trasparenza per-oggetto Madre/Figlio** nell'albero: due slider sub-riga (`replaceSetMarkerOpacity(num,'src'|'sub',pct)` → `mesh.material.opacity`/`transparent`; label % live `#replaceOpLbl_{src|sub}_{num}`), gemelli dello slider Scansione.
- **Fix leak**: `_replaceDisposeGroup` dispone anche l'overlay wireframe (`userData.wireframeOverlay`) figlio della mesh in modalità "both" (geometria marker = cache condivisa, non disposta).

`node --check` TUTTI OK; smoke test browser (mock): build 8.39.0, slider renderizzati, opacità+label aggiornate, wireframe su madre/figlio, overlay "both" creato e disposto senza leak. Review avversariale (2 lenti isolamento+lifecycle) → 0 finding. Bump 8.39.0, MAPPA aggiornata. Deploy canary LEGACY→BACKEND commit `89a6198` (LEGACY `3faf8ed1`, BACKEND `39f2c611`); verifica live 8.39.0 + gating anon→403 su entrambi + alias.

## 2026-06-10 — 8.38.0: Replace-iT — cambia FIGLIO dall'albero

3° intervento dall'audit (autonomo). Richiesta utente: dall'albero richiamare figli differenti della stessa madre senza ri-accoppiare (condividono l'origine). Solo blocco `replace*`; altri workflow invariati.

- La sotto-voce **Figlio** nell'albero (`replaceRebuildTree`) è un `<select>` dei type della stessa libreria/connessione (snapshot `p.libTypes` sul record in `replacePlaceFromSeed`).
- `replaceSwapFiglio(num, ord)`: fetch nuovo STL + swap della sola `p.meshSub.geometry` alla stessa posa (madre+terna+posa invariati; origine condivisa); aggiorna typeOrd/markerSha/typeLabel; vecchia geo in cache non disposta. Niente ri-accoppiamento.

Review avversariale pre-deploy (2 dim, 0 blocker, 0 major, 2 minor) → 2 fix: token anti-stale `p._swapGen` + re-check `indexOf` (race swap rapidi/durante-delete), rebuild su rami d'errore (re-sync del select). Bump 8.38.0, MAPPA aggiornata, `node --check` TUTTI OK. Deploy commit `5872931` (LEGACY `570d61f0`, BACKEND `fcc3d6fa`).

## 2026-06-10 — 8.37.0: Replace-iT — robustezza (Raffina feedback + gate + protezioni)

2° intervento dall'audit (autonomo). Solo blocco `replace*`; altri workflow invariati.

- Raffina con feedback: posa 3-punti mostrata subito, Raffina ICP in tick separato (`setTimeout 0`) con status "Raffino…" + cursor wait (prima freeze muto); gate rafforzato — accettata solo se `p.rmsd` ≤0.15mm & drift ≤0.3mm & rot ≤3°, altrimenti torna alla posa 3-punti. Guardia `replacePending!==p` nel timeout (+ ripristino cursore su uscita, da review).
- Protezione seme: dropdown libreria/type disabilitati durante il piazzamento (cambiarli azzererebbe i punti); riabilitati a idle e all'ingresso in replace (da review).
- Ctrl+Z workflow-aware in replace (seeding→`replaceSeedUndo`, idle→elimina ultimo impianto).
- Errori fetch `/api/rit/*` leggibili (`_replaceFetchErrMsg`: 401/403→login, 404, rete) nei 4 catch + catch anteprima sorgente.

Review avversariale pre-deploy (2 dim, 0 blocker, 0 major, 2 minor) → 2 fix. Bump 8.37.0, MAPPA aggiornata, `node --check` TUTTI OK. Deploy commit `8cd4c58` (LEGACY `b544a437`, BACKEND `5da6973f`).

## 2026-06-10 — 8.36.1: Replace-iT — fix sovrapposizione finestra guida ↔ Albero scena

1° intervento dall'audit Replace-iT. Fix UI segnalato dall'utente: la finestra "Accoppiamento guidato" (`#replacePreviewBox`, fixed bottom-left z25) e l'"Albero scena" (`#layersPanel`, absolute top-left z8), entrambe sulla colonna sinistra del viewport, si sovrapponevano e si bloccavano a vicenda. Causa: l'albero è cresciuto dal 8.33.0 (ogni impianto = 5 righe: #N impianto + Madre + Figlio + origine + Taglia) → finisce sotto la guida che lo copre (z25>z8).

Fix (`replaceSeedUpdateUI`, gated `analysisMode==='replace'`): la finestra guida vive solo durante il piazzamento attivo (`pickMarker`/`pickScan`/`pendingConfirm`) → quando `idle` si nasconde e l'albero torna pienamente cliccabile; durante il piazzamento l'albero è limitato al top (`max-height` riserva in basso lo spazio della guida) → reset altezza piena a idle e all'uscita da replace (`selectWorkflow`). Solo blocco `replace*`; altri workflow invariati.

Bump v3b `<title>`+`ANALIZZA_BUILD` 8.36.1, `registry.BACKEND_VERSION` + History, `docs/MAPPA_FUNZIONALE.md`. `node --check` TUTTI OK. Deploy commit `ee629d3` (LEGACY `6b2c8b09`, BACKEND `3c4deea5`), verifica live 8.36.1 su entrambi + alias.

## 2026-06-10 — 8.36.0: Replace-iT — miglioramento flusso a 3 punti (diretto + guida + correzione + Raffina)

Scelta utente: "andiamo diretti sui 3 punti, lavoriamo sul migliorare il flusso" (priorità: guida + correzione + Raffina). Solo blocco `replace*`; altri workflow invariati.

- INGRESSO DIRETTO (`replaceStartNewImplant`): "+ Nuovo impianto" e "Avanti/nuovo" vanno subito ai 3 punti (saltano click-scanbody/`pickSource` + pulsante ▶ Allinea). `replaceStartPlacement` disattivata (dead annotato).
- GUIDA (`replaceGuideRender`): step 1 Marker / 2 Scansione / 3 Conferma + testi per-punto (N di 3, superficie, ordine 1·2·3) + counter coerente.
- CORREZIONE: rifiuto gemelli scansione troppo vicini (<0.6mm) nel collector `pickScan` + "Annulla punto".
- RAFFINA ICP bounded AUTO dopo i 3 punti (`replacePlaceFromSeed`): ≤3 iter `_replaceDoRefine` per stringere; se deriva >0.8mm/>8° dal seed o RMSD non valido → torna alla posa 3-punti (niente flottante).
- I 3 PUNTI disposti dopo ✓ Conferma (scelta utente: non più visualizzati sul 3D).

Review avversariale pre-deploy (3 dim, 0 blocker, 0 major, 1 minor) → 1 fix: Raffina cap 5→3 (meno freeze su scan densi).

Bump v3b `<title>`+`ANALIZZA_BUILD` 8.36.0, `registry.BACKEND_VERSION` + History, `docs/MAPPA_FUNZIONALE.md`. `node --check` TUTTI OK. Deploy commit `bab681d` (deploy LEGACY `00af8cfd`, BACKEND `c407fb04`), verifica live 8.36.0 su entrambi + alias.

## 2026-06-10 — 8.35.0: Replace-iT — flusso unico a 3 punti (rimossa auto-ICP)

Scelta utente in collaudo dopo che l'auto-ICP restava imprecisa e cadeva di continuo ai 3-punti: "togliamo l'auto e lasciamo solo i 3 punti, gestiamo solo una cosa". Additivo, solo blocco `replace*`; Sostituisci/altri workflow invariati.

(A) Il ramo a 3 punti ora costruisce MADRE+FIGLIO+origine come l'auto (prima il marker 3-punti era a singola mesh → la madre/sorgente spariva — "dove è il file madre??"). `replacePlaceFromSeed` fa `Promise.all([fetch SORGENTE, fetch SOSTITUTO])` e crea il group con FIGLIO=SOSTITUTO (`geoSub`, children[0]) + MADRE=SORGENTE (`geoSrc` verde translucida, children[1]) + terna ORIGINE (children[2]) + `showSrc`/`showSub`/`showOrigin`/`srcTypeLabel`. La posa (3 click sul preview sorgente) allinea il sorgente; il sostituto eredita via origine condivisa (placement sostituto invariato). `#replaceViewRow` visibile anche a `pendingConfirm`. Review avversariale: 0 finding.

(B) Rimosso il binario auto-ICP: `#replaceBtnAlign` rietichettato "▶ Allinea (3 punti)" + `onclick` → `replaceStartThreePoint` (era `replaceAutoPlaceFromSource`); testi pannello/guida/stato riscritti sul solo flusso a 3 punti. `replaceAutoPlaceFromSource` + `_replaceEstimateCadRadius` + gate RMSD (8.34.0) disattivati (dead code annotato, NON cancellati — rimozione in passo dedicato §3.4; ri-abilitabili ricablando il pulsante).

Flusso: + Nuovo impianto → clicca scanbody → ▶ Allinea (3 punti) → 3 punti sul marker + 3 sulla scansione → ✓ Conferma. Madre+figlio in scena (pending) e nell'albero (confermati).

Bump v3b `<title>`+`ANALIZZA_BUILD` 8.35.0, `registry.BACKEND_VERSION` + History, `docs/MAPPA_FUNZIONALE.md`. `node --check` TUTTI OK. Deploy commit `d722b73` (deploy LEGACY `645bc781`, BACKEND `b11e4bf7`), verifica live 8.35.0 su entrambi + alias.

## 2026-06-10 — 8.34.0: Replace-iT — fix precisione accoppiamento ICP auto (centro robusto + gate)

Fix della precisione dell'accoppiamento ICP auto, segnalato in collaudo: "con icp non si accoppia bene, si accoppia solo con i 3 punti" — CAD madre/figlio flottanti accanto allo scanbody, RMSD ~0.655mm. Additivo, solo blocco `replace*`; Sostituisci/altri workflow, ICP `_replaceDoRefine`, multi-start roll invariati.

Root cause (analisi multi-agente ultracode, 4 lettori + sintesi): il centro-seed era stimato con `findScanbodyCenter` al click SENZA il raggio del type sorgente → usava il raggio default 1T3 (2.515mm) a prescindere; `findScanbodyCenter` è un fit a 1 parametro che sfrutta il raggio nominale → con raggio sbagliato il centro esce decentrato 0.2-0.5mm (es. sorgente SR r=2.03) → il crop di `_replaceDoRefine` ritaglia la zona sbagliata → l'ICP point-to-point aggancia la parete del CAD alla gengiva (minimo flottante). I 3-punti funzionano perché il centro nasce dal baricentro dei 3 click reali (immune all'errore di raggio).

Fix (riusa machinery validata ~µm):
- `_replaceEstimateCadRadius`: stima il raggio del cilindro dal CAD sorgente (mediana distanza radiale dei triangoli di parete dall'asse `axis_occlusal`).
- `replaceAutoPlaceFromSource`: dentro la Promise (geoSrc disponibile), prima del multi-start, ricentra il seed con `sostRobustCenter(replaceOriginalGeo, posV, N, Rcad)` (centro full-surface click-invariante: re-crop iterato parete + circle-fit kasa a raggio libero; gate copertura 140° + fail-soft) → tutti gli 8 roll partono dal centro corretto.
- Gate RMSD: se `p.rmsd > 0.15mm` o non valido (fail-closed) → auto-fallback a `replaceStartThreePoint` (scelta utente) invece di mostrare una posa flottante.

Review avversariale pre-deploy (workflow ultracode, 4 dimensioni, 0 blocker, 0 major) → 1 fix: gate fail-closed su `p.rmsd` null/non-finito. Migliorie incrementali deferite (crop più stretto, point-to-plane).

Bump v3b `<title>`+`ANALIZZA_BUILD` 8.34.0, `registry.BACKEND_VERSION` + History, `docs/MAPPA_FUNZIONALE.md`. `node --check` TUTTI OK. Deploy commit `b20bbcb` (deploy LEGACY `7b242348`, BACKEND `5c3b7511`), verifica live 8.34.0 + markup nuovo + gating 403 su entrambi + alias.

## 2026-06-10 — 8.33.0: Replace-iT — MADRE + FIGLIO entrambi visibili + entrambi nell'albero

Revisione del modello vista 8.32.0 da feedback collaudo: "voglio vedere il file MADRE (megagen=sorgente) E il file FIGLIO (IPD=sostituto); la madre si accoppia alla scansione e richiama a sé il figlio; madre e figlio dipendono dall'origine xyz 0,0,0 sempre sovrapponibile e non modificabile; nell'albero devono comparire sia madre che figlio". Additivo, solo blocco `replace*`; Sostituisci/altri workflow e ICP/multi-start roll invariati.

Da toggle ESCLUSIVO (`p.viewMode` 'src'|'sub', una mesh alla volta) a visibilità INDIPENDENTE (`p.showSrc`/`p.showSub`/`p.showOrigin`, default ENTRAMBI true):
- `replaceAutoPlaceFromSource`: madre (`meshSrc`, children[1]) resa verde TRANSLUCIDA (opacity 0.5, depthWrite false, renderOrder 1) come overlay del fit sopra il figlio (`meshSub`, children[0] = marker finale); record con `showSrc`/`showSub`/`srcTypeLabel` (rimosso `viewMode`).
- `_replaceApplyView`: visibilità indipendente delle due mesh + terna.
- Finestra guida `#replaceViewRow`: da 2 bottoni Sorgente/Sostituto a 2 checkbox Madre + Figlio (default on) + origine; `replaceSetPendingMeshVis`; `replaceSeedUpdateUI` sincronizza.
- Albero `replaceRebuildTree`: marker auto-posa = "#N impianto" (header on/off gruppo + RMSD + elimina) con due sotto-voci indipendenti Madre/Figlio (visibilità `replaceSetMarkerMeshVis` + colore) + origine + Taglia scansione; marker 3-punti su riga classica (gate `if(p.meshSrc)`).
- `replaceConfirmSeed`: confermato = madre+figlio visibili, origine off. `setSceneObjectColor` nuovo kind `'replacesrc'` → `meshSrc`.

Review avversariale pre-deploy (workflow ultracode, 4 dimensioni, 0 blocker, 0 bug codice; unico finding = refuso doc handler-list MAPPA, corretto). Invariati: `children[0]`=meshSub, dispose `_replaceDisposeGroup` (6 siti).

Bump v3b `<title>`+`ANALIZZA_BUILD` 8.33.0, `registry.BACKEND_VERSION` + History, `docs/MAPPA_FUNZIONALE.md`. `node --check` TUTTI OK. Deploy canary LEGACY→BACKEND (commit `a9ff83a`; deploy LEGACY `5c75b19a`, BACKEND `e0623946`), verifica live 8.33.0 + markup nuovo + gating 403 su entrambi + alias.

## 2026-06-10 — 8.32.0: Replace-iT — ispezione accoppiamento (vedi SORGENTE + origine x0/y0/z0)

Feature di ispezione richiesta in collaudo: durante l'accoppiamento ICP l'utente deve vedere di **default il CAD SORGENTE** allineato+raffinato (cio' che la matematica fitta sulla scansione, verde), poter passare al **SOSTITUTO**, e vedere la **terna ORIGINE x0/y0/z0** del frame CAD condiviso. Gli aiuti restano togglabili sui marker confermati dall'albero scena. Additivo, solo blocco `replace*`; Sostituisci/altri workflow e ICP/multi-start roll invariati.

Implementazione:
- `replaceAutoPlaceFromSource`: il group della posa contiene **2 mesh stesso frame** — SOSTITUTO (`geoSub`, `children[0]` = marker finale; confirm/refine/dispose/colore lavorano su `children[0]`) + SORGENTE (`geoSrc`, `children[1]`, verde) — + **terna ORIGINE** (`children[2]`, `_replaceMakeOriginAxes`: 3 assi X/Y/Z dall'origine locale 0,0,0 + sferetta + label X0/Y0/Z0). Stato `p.viewMode`/`p.showOrigin` + `_replaceApplyView`.
- Pending: default SORGENTE + origine ON, toggle finestra guida (`#replaceViewRow`; `replaceSetPendingView`/`replaceTogglePendingOrigin`; gating/sync in `replaceSeedUpdateUI` a fase posed). Confermato: default SOSTITUTO + origine OFF, sub-riga albero per-marker (`replaceSetMarkerView`/`replaceToggleMarkerOrigin`).
- `setSceneObjectColor('replace:'+num)` colora solo `pp.meshSub` (non piu' tutto il group). Dispose unificato `_replaceDisposeGroup` ai 6 siti.

Review avversariale pre-deploy (workflow ultracode, 4 dimensioni, 7 finding, 0 blocker) → 2 fix applicati prima del commit: (1) MAJOR `replaceClearScene` era il 6° sito dispose non migrato (leak `meshSrc`+terna a ogni reload con marker auto-posa) → `_replaceDisposeGroup`; (2) MINOR sub-riga albero "Vista" emessa anche per i marker 3-punti (toggle morti) → gate `if(p.meshSrc)`.

Bump v3b `<title>`+`ANALIZZA_BUILD` 8.32.0, `registry.BACKEND_VERSION` + History, `docs/MAPPA_FUNZIONALE.md`. `node --check` TUTTI OK. Deploy canary LEGACY→BACKEND (commit `abd4646`; deploy LEGACY `f6965b84`, BACKEND `2c6fc397`), verifica live 8.32.0 + markup nuovo + gating 403 su entrambi + alias.

## 2026-06-10 — 8.31.2: Replace-iT — pulsante esplicito ▶ Allinea (ICP) (fix dead-end "② Marker")

Fix del vicolo cieco del piazzamento sorgente→sostituto, emerso in collaudo live: l'utente restava bloccato al passo "② Marker" senza modo di avanzare ("non c'è un conferma, non c'è nulla"). Additivo, solo blocco `replace*`; Sostituisci/altri workflow invariati; ICP multi-start 8.31.1 e ramo "Allinea a 3 punti" invariati.

Root cause (diagnosi dai log `[CylFit]` = N click a vuoto + lettura codice): l'auto-posa `replaceAutoPlaceFromSource` era agganciata SOLO all'`onchange` dei dropdown type (`replaceMaybeAutoPlace`). Scegliendo i type prima (come istruiva il pannello) e poi cliccando lo scanbody non cambiava nessun menu → nessun trigger, nessun pulsante.

Fix (UX richiesta dall'utente: "pulsante esplicito è meglio"):
- Pulsante UNICO esplicito ▶ Allinea (ICP) (`#replaceBtnAlign`, finestra guida ~1487; onclick → `replaceAutoPlaceFromSource`) = solo trigger dell'allineamento.
- `replaceSeedUpdateUI` (~15846): gating visibilità a fase `chooseType` con scanbody individuato + entrambi i type.
- `replaceMaybeAutoPlace` (~15955): non lancia più l'ICP da sola (solo refresh UI) → niente freeze a sorpresa al cambio menu.
- `replaceOnViewportClick` ramo pickSource (~16130) + testo guida ② (`replaceGuideRender` ~15884): dinamici, indirizzano al pulsante.
- Testi pannello destro (`#panelReplace`) riscritti dal vecchio "3 punti di repere" a sorgente→sostituto.

Bump v3b `<title>`+`ANALIZZA_BUILD` 8.31.2, `registry.BACKEND_VERSION` + History, `docs/MAPPA_FUNZIONALE.md`. `node --check` (check_inline_scripts) TUTTI OK. Deploy canary LEGACY→BACKEND (commit `24b1b97`; deploy LEGACY `0877cd4a`, BACKEND `58fefa1c`), verifica live 8.31.2 + `id="replaceBtnAlign"` + gating 403 su entrambi + alias.

## 2026-06-09 — 8.19.0: Replace-iT Passo 2b-1.1 — UX di guida del piazzamento (dot + hover + guida)

Guida visiva del piazzamento Replace-iT (Slice 1): l'utente capisce dove cliccare e vede il punto di riferimento sul modello. Additivo, solo blocco `replace*` del monolite + 1 listener mousemove gated; Sostituisci, controller camera, `onViewportClick` e gli altri workflow invariati. NO match, NO anteprima-3D-nel-pannello (Slice 2).

- **Punto rosso del riferimento** per ogni marker piazzato (`replaceMakeDot`, clone di `ensurePivotMarker`), a `replacePlaced[i].position` (= dove cade il `click_center`), rimosso+disposto coi marker.
- **Hover dot live**: `replaceOnViewportHover` come listener **unico e passivo** a init, gated a `currentWorkflow==='replace' && replacePlacementMode && replaceMesh` → un punto rosso segue il cursore sulla scansione durante il placement (vedi dove cadrà il riferimento prima di cliccare). Isolamento totale: nessun `preventDefault`/`stopPropagation`.
- **Guida**: `#replaceGuide` nel pannello + messaggio di stato in fase di placement.
- Review avversariale multi-agente (3 lenti) → GO, 0 blocker; applicato 1 nit isolato (`replaceHideHoverDot()` in `replaceClearScene`).

Deploy: commit `0aaa37b`, canary LEGACY `37f82aa9` → BACKEND `0aff4a66`; verificato 8.19.0 live su LEGACY + BACKEND + `app.synthesis-icp.com` (con-H) con tutti i marker monolite (`<title>` v8.19.0, `ANALIZZA_BUILD`, `replaceMakeDot`/`replaceOnViewportHover`/`#replaceGuide`) presenti + gating 403. **Collaudo visivo confermato dall'utente.** Prossima: slice 2b-1.2 (seeding a 3 punti via Kabsch, sostituisce il `click_center`); ICP/accoppiamento = 2b-2.

---

## 2026-06-09 — 8.18.0: Replace-iT Passo 2b-1 — quinto workflow `replace` (UI + fetch marker + piazzamento)

Il workflow vero di **Replace-iT** entra nel monolite `/analizzare`: un **quinto workflow `replace`**, NUOVO e SEPARATO, che consuma la superficie di lettura 2a. Sostituisci resta **bit-identico** (clone dei mattoni, nessun `if(replace)` nelle sue funzioni). Questa slice = **UI + fetch marker + piazzamento**; il match/Raffina (allineamento fine) è la slice **2b-2**.

- **Gesto utente**: menu → Replace-iT → carica scansione → scegli **libreria attiva** (`GET /api/rit/libraries`) → scegli **type** (`GET /api/rit/libraries/{id}`) → **+ Posiziona** → click sullo scanbody → il marker compare. Multi-marker (fino a ~6). Pannello con riga di avviso esplicita che l'allineamento è grezzo (così non si scambia per un bug).
- **Riconciliazione CAD↔click (il nodo, senza match)**: il click dà l'àncora-mondo `P` (e l'asse `A` dalla media-normali di `findScanbodyCenter`, radius-independent), il CAD dà *dove* quell'àncora cade sul marker (`click_center` locale). Transform: `q` allinea l'asse di inserzione locale (+Z) ad `A`; `t = P − q·click_center` → il `click_center` del CAD cade esattamente sul click. Roll attorno ad `A` **libero** (lo risolverà il match); `axis_asymmetric` **memorizzato** per 2b-2, non applicato. Segno dell'asse in `REPLACE_AXIS_SIGN` (isolato/invertibile a mano se i marker risultano capovolti).
- **Clone vs riuso**: clonati `replace*` (stato, `replacePlaceTemplate`, `replaceStartPlacement`, `replaceOnViewportClick`, scan loader, fetch, label, `_hardResetReplace`); riusati i **mattoni puri** `parseSTL`, `sostParseSTLToGeometry`, `findScanbodyCenter` (solo l'asse). Albero scena nascosto in replace (dedicato rimandato a 2b-2; marker in `#replacePlacedList`).
- **Review avversariale multi-agente** (5 lenti: bit-identità sost, matematica piazzamento, wiring workflow, fetch/DOM/cache, versioning) → **GO, 0 blocker**. Applicati 2 fix in-scope: `typeLabel` catturato al piazzamento (lista multi-marker cross-libreria corretta); `layersPanel` nascosto in replace + rimosse 3 `rebuildTree()` morte. Residui annotati per 2b-2: asse `+Z` hardcoded vs `axis_occlusal`, `dispose` material, error-UX fetch.

Bump 8.17.0→8.18.0 (registry + v3b `<title>` v8.18.0 + `ANALIZZA_BUILD` 8.18.0). `node --check` 8/8 blocchi JS PASS, `py_compile` OK. Deploy: commit `d1e34ab`, canary LEGACY `e0096fa5` → BACKEND `1b8eff8b`; verificato 8.18.0 live su LEGACY + BACKEND + `app.synthesis-icp.com` (con-H) con tutti i marker monolite (`<title>`/`ANALIZZA_BUILD`/`selectWorkflow('replace')`/`#panelReplace`) presenti nell'HTML servito (monolite nuovo, non cache) + gating `/api/rit/libraries` 403 non-404. **Collaudo visivo confermato dall'utente** (chiude anche il check 200 clinico pending dal 2a: la libreria attiva compare nel dropdown col login reale). Slice 2b-2 (match/Raffina) separata.

---

## 2026-06-09 — 8.17.0: Replace-iT Passo 2a — API pubblica di lettura librerie scanbody

Superficie di **sola lettura** delle librerie scanbody per il workflow clinico (il Passo 1 era il magazzino lato admin). **Solo backend**: nessuna modifica a v3b, nessun endpoint di scrittura (restano in `/admin/rit/*`, `require_admin`).

- **4 endpoint** in `main.py`, prefix `/api/rit/*`, dietro `require_authorized` (admin passa; utente serve `active`+`license_key`; pending → 403): lista librerie **attive** (campi clinici, niente metadati admin), dettaglio (404 se non attiva; root-params + `types[]` per-type; omette uploaded_by/at/logo), bytes STL marker per sha256 (`octet-stream`, `ETag=sha256` + `If-None-Match`→304, 404 se sha non valido/assente, servito per sha puro), preview PNG. Espone **solo** `active=TRUE` — le librerie in verifica non escono mai da questa superficie.
- Helper `database.py` (riuso Passo 1): NEW `rit_list_active_libraries`, `rit_get_marker_bytes`; EXTEND `rit_get_library_detail`/`rit_get_library_image` con `active_only` (default False → chiamanti admin invariati). Niente tabelle nuove.
- Review avversariale multi-agente sul diff (4 lenti: SQL/correttezza, isolamento-leak `active`, HTTP/gating, regressione chiamanti Passo 1; ogni finding verificato in refutazione) → **0 finding, GO**. `py_compile` OK.

Sequenza commit: A `4da210e` (8.16.1 empty-state, verbatim) → B `56d84e1` (8.17.0 sopra). Deploy: canary LEGACY `120a6504` → BACKEND `749845f0`, commit `56d84e1` (porta live in un colpo 8.16.1 + 8.17.0); verificato 8.17.0 live su LEGACY + BACKEND + `app.synthesis-icp.com` (con-H) con **5/5 check obbligatori** (commit 56d84e1, `/analizzare` 200, `/api/rit/libraries` e marker no-token → 403 non-404). **Check funzionale 200 con token clinico PENDING** → coperto dal collaudo visivo del Passo 2b (login reale utente, la libreria comparirà nella UI). Passo 2b (workflow nel monolite che consuma `/api/rit/*`) separato.

---

## 2026-06-09 — 8.16.1: fix empty-state #rit-empty in /gestione

Fix cosmetico (follow-up minore di 8.16.0). L'empty-state "Nessuna libreria importata" (`#rit-empty`) restava visibile sotto la tabella Librerie Replace-iT a lista popolata: la classe `.hidden` — usata nei toggle JS (`ritRender`, tabella utenti `#empty`, pannello `#rit-detail`) — non aveva regola CSS, quindi il toggle non aveva effetto visivo. Fix minimo: `.hidden{display:none}` nel `<style>` (dopo `.empty`) → sistema in un colpo `#rit-empty`, `#empty` (latente, mascherato da tabella sempre popolata) e l'init di `#rit-detail`. Solo CSS, nessuna modifica JS. v3b non toccato. Commit `4da210e`, deployato live insieme a 8.17.0 (canary `56d84e1`).

---

## 2026-06-09 — 8.16.0: Replace-iT Passo 1 — modello dati + ingest librerie scanbody Exocad

Fondamenta di **Replace-iT**: sostituzione industriale degli scanbody attingendo a librerie **Exocad** caricate da backend. Questo passo è **solo modello dati + ingest** — NON tocca il runtime Sostituisci, il monolite v3b, né il flusso di analisi. Nessun runtime Replace-iT, nessun uso dei `.sdfa`, nessuna verifica firme RSA, nessun subtype (`ImplantSubtypeConfig` ignorati).

- **DB** (`database.py`, blocco idempotente in `init_db`): 3 tabelle `rit_*`. `rit_marker_stl` (sha256 PK, `content` BYTEA) deduplica gli STL **per contenuto, globale cross-libreria** — su Postgres come bytea, scelta che mantiene la **simmetria dei due servizi** (niente volume). `rit_library` (import_name UNIQUE, keyword non-unique, root-params Exocad + preview/logo PNG + `active` default FALSE + `uploaded_by`). `rit_scanbody_type` tiene `click_center`/`axis_asymmetric`/`is_eng`/`ord` **per TYPE**: lo stesso file marker è condiviso tra type ENG e Non-ENG con parametri diversi → l'unità è il *type*, non il file.
- **Endpoint** (`admin.py`, `/admin/rit/*`, dietro `require_admin`): ingest ZIP (parse `config.xml`, salta `__MACOSX/._*`), lista, dettaglio read-only, preview/logo PNG, toggle `active`. **Validazione bloccante**: ogni `MarkerFilename` referenziato deve esistere come STL nello ZIP, altrimenti l'import è rifiutato in toto (rollback in transazione). **Conflitto keyword**: senza scelta esplicita l'endpoint **non decide da solo** → 409 con la lista delle librerie esistenti; l'utente sceglie sovrascrivi-in-place (DELETE+reinsert in transazione, STL deduplicati sopravvivono) o importa-come-nuova con `import_name` diverso. `active=FALSE` di default: la libreria si attiva a mano dopo la verifica. `uploaded_by` = email admin dal JWT (`require_admin` espone l'identità).
- **UI** `/gestione`: sezione "Librerie Replace-iT" — upload, tabella, pannello read-only parametri/type + preview 3D, toggle active, dialog di conflitto che mostra **esplicitamente** cosa si sta per sovrascrivere (import_name/stato/display/n.type/data/uploaded_by per ogni libreria esistente). Stile coerente col pannello admin esistente, wiring `addEventListener`.
- Parser validato pre-implementazione e in produzione sullo ZIP reale `IPD-Lite-ZIM-TSV-35` (17 type, 10 marker unici, ENG 9/Non-ENG 8, preview+logo letti; negative test marker mancante = rifiuto). `py_compile` OK, `node --check` OK sul JS della pagina.

Deploy: commit `f948bf6`, canary LEGACY `e44c6d35` → BACKEND `1f4bcbbe`; verificato 8.16.0 live su BACKEND + LEGACY + `app.syntesis-icp.com` (commitHash `f948bf6`, `/analizzare` 200, gating `/admin/users` 403, route nuova `/admin/rit/libraries` → **403 non-404** = montata e gated). Startup pulito su entrambi (`init_db` con le `CREATE TABLE rit_*` completato → runbook Postgres-first non necessario). **Verifica visiva di Francesco passata** (IPD-Lite-ZIM-TSV-35: 17 type/10 STL, root-params, type ENG/Non-ENG con click center distinti tenuti separati — es. `nt-FA-N-SCAN` z=7.941 vs 7.873 —, preview, toggle, dialog conflitto). **Passo 1 chiuso.**

Follow-up minore annotato (NON ora): empty-state "Nessuna libreria importata" (`#rit-empty`) resta visibile a lista popolata → nascondere quando ci sono righe.

---

## 2026-06-09 — 8.15.1: fix modale Impostazioni scrollabile + chiusura cantiere full-CAD

**Fix UI** (segnalato dall'utente): col toggle "Motore centraggio Sostituire" (8.15.0) il modale Impostazioni (tab Algoritmo) superava il viewport e il bottone **"Salva" finiva fuori schermo**. Card `#settingsDialog` → `max-height:90vh` + `overflow-y:auto` + `box-sizing:border-box` (v3b ~17057), scrolla internamente. Solo CSS.

**Chiusura cantiere "Replace-iT full-CAD Exocad-grade".** Obiettivo: eguagliare l'accuratezza Exocad (~1µm) con registrazione rigida dell'intero CAD scanbody sulla superficie scansionata. Validato in Python PRIMA del monolite (lezione di robust): **5 tentativi falliti** — point-to-point/point-to-plane hand-rolled (40µm–2mm, init dal robust), poi **Open3D** (libreria collaudata) con fitness≈0. Il blocco non è l'ICP ma la **data-prep**: localizzazione + segmentazione (scanbody vs gengiva) + registrazione tech↔base, che nel mio ambiente non è affidabile (nell'app i *click* utente la risolverebbero). A/B reale dell'utente (SR placement legacy vs robust, inter-centroide vs Exocad): robust ≈ legacy (~35–39µm; floor Exocad 0.8µm) → robust dà **ripetibilità** (click-invarianza), non accuratezza assoluta Exocad. **Interop Exocad impossibile** lato utente. **Decisione: restare sul `robust`** (beta opt-in, default legacy); reimplemento full-CAD non giustificato dall'evidenza; altre vie valutate in futuro.

Deploy: commit `52b47a0`, canary LEGACY `69e8d8f2` → BACKEND; verificato 8.15.1 live su BACKEND + LEGACY + `app.syntesis-icp.com` (fix modale servito, route 200, gating 403). Nota: primo script verifica fallito per trappola jq su `meta` (riconfermata regola: query status pulita, commitHash via python).

---

## 2026-06-09 — 8.15.0: centraggio Sostituire "robust" click-invariante (beta, dietro flag)

Primo passo di **Replace-iT**. Diagnosi (dati reali + benchmark Exocad): il piazzamento scanbody di **Sostituire** aveva ripetibilità di posizione **~37µm (max 58)** ri-piazzando lo stesso SR sulla stessa scansione, contro **~1µm di Exocad** sullo stesso file (tech3 vs tech2 = 0.9µm via Misurare). Misurare è preciso (~1µm), l'asse lateral-wall è ripetibile (0.01–0.08°): il collo di bottiglia è il **centraggio**, che derivava da un fit cilindro sul **crop del CLICK** (`findScanbodyCenter`) → sensibile a dove si clicca.

Il design panel (4 approcci + giudizio + avversariale) + un esperimento decisivo hanno **scartato** il point-to-plane 6-DOF: l'osservabilità del centro XY crolla sotto ~135° d'arco di parete visibile (muro geometrico, non risolvibile col solver). La cura è un **centro ancorato all'asse** + un **gate di copertura**.

- **`sostRobustCenter`** (v3b ~15415): ri-crop cilindrico **iterato** della parete attorno all'asse lateral-wall (robusto) + fit cerchio **algebrico** (kasa, raggio libero) → centro che converge a un **punto fisso indipendente dal click**. Mantiene asse e livello assiale del disco, rifinisce solo il centro XY. Gate `SOST_MIN_COVERAGE_DEG`=140° con **fail-soft** al centro di `findScanbodyCenter`. Dietro flag `syntesis_sost_center` (`legacy` default | `robust`), **SR-only**, innesto in `sostPlaceTemplate` con try/catch. **NON** tocca `findScanbodyCenter` (condivisa con Analizza/placeMUA).
- Helper `synSostCenterRead` (~3300) + **toggle UI** "Motore centraggio Sostituire" (tab Algoritmo) + `onSostCenterChange` + restore. **Fix z-index** modale `#settingsDialog` (100→9500): il toggle allungava il modale e la barra `vm-bar` (z-index 9000) spuntava sopra.
- **Validazione**: harness su geometria SR reale (template Exocad tech3 + rumore 15µm/occlusione) → spread centro **0.0µm** (click-invariante) fino a ~150° d'arco vs ~37µm legacy, accuratezza ~µm (= Exocad); confermato ri-eseguendo la funzione **estratta dal file**. Verifica avversariale 3-lensi (2 SOLID + 1 RISKY) → applicati 3 hardening: normalizzazione di `v`, soglia determinante 1e-12→1e-6, guardia `axis` NaN/normali. `node --check` + gate sintassi + preview pulito (0 errori console).
- **Ramo `legacy` (default) bit-identico** a 8.14.0 (additivo). Bump 8.14.0→8.15.0. `docs/MAPPA_FUNZIONALE.md` aggiornata.
- Branch `feat-sost-robust-center` (commit `8b89836`) → merge no-ff `0a87aed` su main. **Deploy canary LEGACY `b01bde2b` → BACKEND `d916a7ec`**; verificato 8.15.0 live su BACKEND + LEGACY + `app.syntesis-icp.com` (commitHash `0a87aed`, `value="robust"` + `z-index:9500` serviti, route 200, gating 403). **Flag default `legacy` = nessun impatto utente.**

**PENDING**: conferma **A/B su scan reale rumoroso** (ripetibilità `robust` vs `legacy`) prima di promuovere `robust` a default; se il rumore reale tira il fit kasa → trimming MAD. Warning avversariale non-bloccante: a spaziatura SR ravvicinata+inclinata (~3-4mm) il ri-crop *potrebbe* catturare un vicino (irrilevante a spaziatura impianti tipica >5mm).

---

## 2026-06-09 — 8.14.0: motore asse "auto" (nuovo default)

Il setting `syntesis_axis_engine` passa da binario (`cap`|`lateralwall`) a **3 stati** con `auto` come nuovo default. `auto` sceglie il motore d'asse **per tipo di scanbody**: lateral-wall per **SR** (validato clinicamente in 8.13.0 + sessione barra ID 2161), cap-media per **1T3/OS** (geometria a cap dominante — 1T3 ha cap 40% area — dove lateral-wall non è ancora validato). Evita di applicare globalmente una modifica non validata ai tipi diversi da SR, con un percorso chiaro per estendere `auto` quando saranno confermati.

`auto` è risolto in modo indipendente nei 3 path dove vive il motore, ognuno con un discriminatore già in scope (nessuna nuova dipendenza): placement `findScanbodyCenter` (SR via `opts.radius`~2.03), report `misICP_cylAxis` (SR via altezza cilindro `H = pmax-pmin` > 2.4mm; SR≈3.0 vs 1T3≈1.9/OS≈1.1), Raffina `sostAlignAll` (SR via `sostSourceTemplate`). Pattern uniforme `useLateral = (setting==='lateralwall') || (setting==='auto' && <SR>)`, così i rami espliciti `cap`/`lateralwall` restano bit-identici a 8.13.0.

Smoke test su codice vero (mock, scansione barra): `auto`+SR(r2.03) ≡ `lateralwall` (0.0°), `auto`+1T3(r2.515) ≡ `cap` (0.0°) → la risoluzione per-tipo funziona.

Implementazione:
- v3b: radio "Auto (consigliato)" (3ª opzione, default checked, ~17136); `onAxisEngineChange` accetta `'auto'` + stila 3 box (~3281); restore default `'auto'` (~12546); 3 gate motore (placement ~2729, report ~6373, Raffina ~15966) col booleano `useLateral`; default `|| 'auto'` ovunque.
- Design + verifica avversariale 4-lensi (workflow **sola-lettura**: no-regressione cap/lateral, risoluzione auto, UI/setting, sintassi) — allSound; `node --check` PASS, gate sintassi OK.
- bump 8.13.0→8.14.0 (registry + v3b `<title>`/`ANALIZZA_BUILD`). docs/MAPPA_FUNZIONALE.md: 3 stati radio + 3 gate; **corretta** la riga Raffina che in 8.13.0 descriveva il motore come "gated" mentre il codice era incondizionato.
- Cambio default: il Raffina (incondizionato-lateral in 8.13.0) sotto `auto` diventa SR-only → 1T3/OS tornano al point-ICP (conservativo). Rischio residuo invariato (guardia `wallN` conta triangoli non spread angolare).
- Commit `00a72df` su main. Deploy canary LEGACY `cc0cf86e` + BACKEND `673bbce0`; verificato 8.14.0 live su BACKEND + LEGACY + `app.syntesis-icp.com` (radio `auto` presente, route 200, gating 403).

---

## 2026-06-09 — 8.13.0: motore asse "lateral-wall" robusto (Sostituire + Misurare)

Chiude il gap angolare con Exocad sul fit dell'asse cilindro dello scanbody. Diagnosi dimostrata sui dati reali (barra inferiore ID 2161, tre scansioni della stessa barra): l'errore NON è nell'allineamento ICP (centroidi/RMSD ottimi, |D|3D 10-29 µm) ma nella STIMA DELL'ASSE. Il metodo cap-PCA (`misICP_cylAxis`) ha ~1.2° di errore strutturale sullo scanbody SR — tozzo (~3×4 mm), un solo cap pieno + base aperta — perché media due "fette" assiali contaminate; misurato **1.194° anche sul marker ideale** (zero rumore, zero ICP). Lo stimatore corretto è il fit della parete laterale (minor eigenvector di Σ area·nnᵀ sulle normali radiali), che coincide con la normale del disco a 0.015° e con Exocad (~0.14°).

Due fix complementari, entrambi gateati dal setting esistente `syntesis_axis_engine` (`'cap'`|`'lateralwall'`):

- **FIX #1 — report Misurare ICP** (`misICP_cylAxis`, v3b ~6303): con `'lateralwall'` l'asse cap-PCA diventa solo SEED e viene raffinato dalla parete (banda |n·seed|<0.35, peso area, `misICP_jacobi3`); default `'cap'` bit-identico, fallback al seed se <8 laterali.
- **FIX #2 — coupling Sostituire** (`sostAlignAll`/Raffina, v3b ~15741 crop + ~15908 apply), il **root**: il Raffina è un ICP punto-punto che ri-fittava il marker e SOVRASCRIVEVA l'asse di placement con la rotazione del point-ICP (~1° di rumore non-rigido — misurato: cambiava gli angoli relativi tra marker di 0.99° medi). Ora il point-ICP resta SOLO per il centraggio (R,t invariati) e l'asse finale viene da un fit lateral-wall della parete scansionata (croppata stretta dal Raffina), ri-orientando il marker attorno a `p.position` e propagando a `g.matrix`→export.

Verifica end-to-end su **click utente reali** (mock, codice vero via preview): degrado angoli relativi del Raffina **0.66°→0.13° (−81%)**; incoerenza export **scan-to-scan** (prima vs seconda) **0.95°→0.14-0.31° = Exocad**. Centraggio invariato (RMSD 0.11-0.14 mm).

Implementazione:
- v3b `misICP_cylAxis` (~6359): blocco lateral-wall additivo, fallback cap-PCA. v3b `sostAlignAll` (~15741 crop loop accumula `wallM`/`wallN`; ~15908 apply block refit + ri-orientamento), fallback `R·seed` se <8 parete.
- Design + verifica avversariale 4-lensi (numerica / riorientazione / no-regressione / forma-dati) su entrambe le patch; `node --check` PASS, gate sintassi inline OK.
- bump 8.12.1→8.13.0: registry.py (BACKEND_VERSION/LAST_UPDATED/History) + v3b `<title>`/`ANALIZZA_BUILD`. docs/MAPPA_FUNZIONALE.md: `sostAlignAll`/`onAxisEngineChange`/`misICP_cylAxis`.
- Commit `38cda88` su main. Deploy canary LEGACY `ce9ace7a` + BACKEND `5ce821a7`; verificato 8.13.0 live su BACKEND + LEGACY + `app.syntesis-icp.com` (route 200, gating 403).
- Rischio residuo: la guardia `wallN≥8` conta i triangoli, non lo spread angolare delle normali (stesso limite del motore di placement già in prod) — monitorare su pareti quasi-planari.

---

## 2026-06-05 — 8.12.0: estrai panel/UI infra in ds/syn-panel.js

2° modulo della campagna di modularizzazione del monolite `syntesis-analyzer-v3b.html`. La panel/UI infra di /analizzare (pannelli drag/resize, persistenza view-state, rail colonna destra, view-menu, tooltip `data-tip`, helper carica-file) estratta dal blocco `<script>` inline di fine body (ex righe 17062-17766, 703 righe) nel modulo `backend/static/ds/syn-panel.js`.

Meccanismo DIVERSO da clip (8.11.0): relocazione IN-PLACE VERBATIM (classic non-strict, non IIFE strict) — `<script src>` al posto dell'inline alla stessa riga → timing identico (readyState, DOMContentLoaded/setTimeout, ordine vs script monolite); zero modifiche al codice; le funzioni globali restano globali per gli handler inline del markup (invariato). Scelta motivata: il blocco è funzioni globali chiamate da handler inline + IIFE con setup deferito; avvolgerlo in IIFE strict avrebbe richiesto di ri-esporre ~25 funzioni → più rischio, zero beneficio.

Validazione: gate di equivalenza `scripts/gate/panel` in BROWSER REALE (preview), harness DOM A/B — G0 byte-identità + G1 esposizioni (16/16) + G2 view-state + G3 rail + G4 view-menu + G6 tooltip → old(inline) ≡ new(modulo), diff 0, zero errori console. `node --check` OK su tutti i blocchi. Il gate browser ha esposto una fragilità PRE-ESISTENTE verbatim (`syntesisRefreshLoadFileButton`, `… && scanMesh` bare ref): innocua in produzione (scanMesh dichiarato in script #4 che gira prima del blocco), non introdotta dall'estrazione — un gate G0-only non l'avrebbe vista.

Implementazione:
- estratto `backend/static/ds/syn-panel.js` (header + 703 righe verbatim); inline block → `<script src>` in-place (v3b −705 / +1).
- bump 8.12.0: registry.py (BACKEND_VERSION/LAST_UPDATED/History) + v3b `<title>`/`ANALIZZA_BUILD`.
- docs/MAPPA_FUNZIONALE.md: handler view-menu/pannelli/rail → ds/syn-panel.js (righe reali).
- infra: harness gate browser `scripts/gate/panel/panel-harness.html`; .gitignore pattern gate generici + `.claude/launch.json` (locale, mai committato — vincolo utente).
- Branch `refactor-extract-panel-ui`, merge no-ff `4599fa3`. Deploy canary LEGACY `3460aa19` + BACKEND `d782e8fa`; verificato 8.12.0 live su BACKEND + LEGACY + `app.syntesis-icp.com` (syn-panel.js 200 27038B, gating 403).

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
