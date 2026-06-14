# Gate Tier 1 — invarianti statiche (progettazione)

> **Stato:** PIANO di progettazione — **nessun harness costruito, nessun codice software toccato.**
> **Data:** 2026-06-14 · **Versione di riferimento:** 8.61.2
> **Decisione utente (2026-06-14):** partire dal **Tier 1 statico** (no browser/WebGL); **Tier 3
> WebGL differito**; le fixture del Tier 3 saranno **STL reali anonimizzate fornite dall'utente**
> (geometria pura = intrinsecamente anonima), non sintetiche.
> **Fonte invarianti:** `MODULARIZZAZIONE_STRATEGIA_v1.md` §2–§3. **Estende:** `scripts/gate/check_inline_scripts.py`.

---

## 0. Cosa è e cosa NON è il Tier 1

Il gate Tier 1 è un **linter di invarianti**: legge l'albero di lavoro (HTML + `ds/*.js`) e
verifica STATICAMENTE che le invarianti di accoppiamento non siano state rotte da un'estrazione.
**Non** carica il browser, **non** usa WebGL, **non** esegue il percorso clinico.

- **Cattura** (a costo basso, rischio nullo): nome `must_preserve` sparito, `"use strict"` aggiunto
  al blocco non-strict, id/classe DOM rimossa, chiave localStorage sdoppiata, `import 'three'` ESM
  in un modulo, errore di sintassi.
- **NON cattura** (serve Tier 3): correttezza numerica ICP, detection scanbody, ordine d'esecuzione
  a runtime, output PDF, rendering. Per quelli vale la regola: *un riferimento presente staticamente
  può comunque rompersi a runtime*. Il Tier 1 riduce la superficie di rischio, non la azzera.

**Modello d'uso**: `baseline` (snapshot pre-estrazione) → estrazione → `check` (asserisce le
invarianti assolute + confronta col baseline le invarianti differenziali). Si aggancia alla
checklist §11 di CLAUDE.md (passo 5 "validare sintassi" diventa "validare sintassi + invarianti").

---

## 1. I 7 gruppi di check

### Check 1 — Lista di sicurezza `must_preserve` (il più importante)
**Invariante**: ogni nome che un modulo `ds/*.js` consuma dal monolite resta **risolvibile come
global nudo** (`X` / `root.X` / `window.X`) in `v3b.html`. È soddisfatta da (a) una **dichiarazione
top-level** `function X` / `var|let|const X` nel blocco principale, **oppure** (b) un **accessor
configurato sul global object** — `Object.defineProperty(window/root, 'X', {get/set})` o il pattern
accessor `SYN`. Non si pretende quindi la dichiarazione: il fix del passo 2 **rimuove** il `var` di
`scanMesh` per installare l'accessor, perciò una regex `^var X` darebbe rosso **sul fix corretto** —
il gate boccerebbe il suo primo cliente reale.
- **Sorgente A (automatica)**: parsa `ds/*.js` ed estrai ogni riferimento esterno —
  `root.X`, `window.X`, `globalThis.X`, `typeof X` bare. Per ciascun `X`:
  - **nome NON marcato accessor** (default): asserisci che esista `^function X(` **oppure**
    `^var|let|const X` top-level nel blocco principale di `v3b.html`.
  - **nome marcato `accessor_backed` nel manifest** (`scanMesh`, `analysisMode`, `currentWorkflow`):
    asserisci invece la presenza dell'**installazione dell'accessor** — `Object.defineProperty` su
    `window`/`root` per quel nome, oppure il pattern accessor `SYN` — **non** `^var X`.
- **Sorgente B (manifest)**: la lista consolidata di STRATEGIA §3 come elenco atteso → asserisci
  che la Sorgente A non introduca nomi **non** previsti né perda nomi previsti (drift bidirezionale).
- **Fallisce se**: un'estrazione sposta `X` dentro un IIFE/modulo senza ri-esporlo bare su window
  (né come dichiarazione top-level né come accessor installato).
- **Esempio reale che prenderebbe**: estrarre `fres*` rendendo `fresState`/`closeFresability`
  module-scoped → `syn-clip.js:121` (`root.fresState`/`root.closeFresability`) si romperebbe.

### Check 2 — Nessun `"use strict"` aggiunto al blocco non-strict
**Invariante**: il blocco principale (`<script>` ~2414–20311) e il blocco `analReport_*`
(20566–21684) restano **non-strict**.
- **Check**: scansiona l'inizio di quei blocchi; fallisci se compare `"use strict"`/`'use strict'`.
  (I due IIFE strict legittimi a 2164 e 20325 sono allow-listed per riga d'apertura.)
- **Perché**: i lettori bare di stato (`fresState` in `_hardResetAnalizza` 4754, `confirmGroup` 12068)
  lanciano `ReferenceError` in strict se la var diventa module-scoped (STRATEGIA §0.3, §2.1).

### Check 3 — Contratto DOM presente
**Invariante**: ogni id/classe che i moduli `ds/*` pilotano esiste nel markup (STRATEGIA §2.4).
- **Sorgente A (automatica)**: estrai da `ds/*.js` ogni `getElementById('X')`,
  `querySelector('…')`, `closest('.Y')`, `classList.*('Z')` → set di id/classi richiesti.
- **Check**: per ogni id asserisci `id="X"` nel markup; per ogni classe asserisci che compaia
  in `class="…"` o come `data-*` selector previsto.
- **Manifest atteso**: la lista §2.4 (inclusi i mancanti scoperti: `#btnRaffina #btnLoadFile
  #viewMenuRailToggle .view-menu-wrapper .panel-collapsible .panel-hidden .panel-rail-collapsed`…).
- **Avvertenza**: `#tagPos` ha dipendenza **dinamica** (syn-clip riscrive min/max) — il check statico
  verifica solo la presenza del nodo, non il range (quello è Tier 2/3).

### Check 4 — Ownership chiavi `localStorage` (differenziale)
**Invariante**: l'insieme delle chiavi e dei loro scrittori non deriva. Le 16 chiavi note
(STRATEGIA §2.5) hanno un owner; nessuna nuova chiave compare senza essere dichiarata.
- **Check**: estrai `localStorage.{get,set,removeItem}('K')` da tutti i file; confronta col
  manifest (16 chiavi + owner). Fallisci se: chiave nuova non dichiarata; chiave single-owner ora
  scritta da un secondo file; chiave persa.
- **`sessionStorage`**: atteso solo in `syn-gate.js`; fallisci se compare nel monolite.

### Check 5 — Guardia THREE nei moduli
**Invariante**: ogni modulo `ds/*.js` che usa THREE legge `window.THREE`/`root.THREE` **dietro la
guardia `three-ready`** e **mai** re-importa `three` come ESM (STRATEGIA §2.2).
- **Check**: in ogni `ds/*.js` che cita `THREE`: fallisci se trovi `import ... from 'three'` o
  `import('three')`; verifica presenza del pattern guardia (`three-ready` listener o lettura di
  `window.THREE`/`root.THREE`). Per i NUOVI moduli estratti che toccano scena/camera/renderer.

### Check 6 — Sintassi JS (esistente, esteso)
- `node --check` di ogni `<script>` inline (già `scripts/gate/check_inline_scripts.py`) **+** di
  ogni `ds/*.js`. Nessuna regressione di sintassi prima del commit (CLAUDE.md §11.5).

### Check 7 — Dead-code: non esporre, non rimuovere (advisory)
**Invariante**: i nomi dead-code noti (STRATEGIA §8: `fresUpdateAllArrows`×4, `fresInitOverlayScene`,
`fresAddCustom/RemoveCustom`, `_setSostituireArtifactsVisible`) **non** vengono aggiunti alla
superficie window, e — durante un'estrazione funzionale — **non** vengono rimossi (CLAUDE.md §3.4).
- **Check**: warning (non hard-fail) se uno di questi nomi appare in un `window.X=`/export nuovo,
  o se sparisce in un commit marcato "estrazione" (la rimozione va in un commit dedicato).

---

## 2. Forma dell'implementazione (quando si deciderà di costruirlo)

- **Un solo script** `scripts/gate/static/invariants.py` (Python 3, stdlib only — coerente con
  `dep_census.py`/`check_inline_scripts.py`; nessuna dipendenza nuova).
- **Un manifest** `scripts/gate/static/invariants_manifest.json` con: lista `must_preserve`,
  **set dei nomi `accessor_backed`** (oggi `scanMesh`, `analysisMode`, `currentWorkflow` — per cui il
  Check 1 verifica l'accessor installato, non la dichiarazione `var`), contratto DOM (id+classi),
  chiavi localStorage+owner, allow-list righe IIFE strict, dead-code names. Derivato a mano da
  STRATEGIA §2–§3, versionato, aggiornato quando un'estrazione cambia il contratto.
- **CLI**: `invariants.py baseline` (snapshot in `scripts/gate/static/baseline.json`, gitignored)
  e `invariants.py check` (asserisce assolute + diff col baseline; exit≠0 su violazione, report `+/-`).
- **Aggancio**: passo aggiuntivo nella checklist patch §11 (dopo `node --check`, prima del commit).
- **Costo**: basso. Niente browser, niente rete, niente WebGL, niente fixture.

---

## 3. Copertura: cosa resta scoperto (mappa onesta verso Tier 2/3)

| Rischio (STRATEGIA §9) | Tier 1 statico | Serve |
|---|---|---|
| Nome `must_preserve` sparito | ✅ Check 1 | — |
| Accessor-backed **installato** (`scanMesh`/`analysisMode`/`currentWorkflow`) | ✅ Check 1 | — |
| Accessor-backed **vivo** (riassegnazione propaga ai lettori bare) | ⚠️ no — verifica solo che sia *installato* | **Tier 1.5** (gate del passo 2, §4) |
| `"use strict"` aggiunto | ✅ Check 2 | — |
| id/classe DOM rimossa | ✅ Check 3 | — |
| chiave localStorage sdoppiata | ✅ Check 4 | — |
| `import 'three'` ESM in modulo | ✅ Check 5 | — |
| sintassi JS | ✅ Check 6 | — |
| `analysisMode` contratto semantico | ⚠️ parziale (presenza valori) | Tier 3 (comportamento) |
| keydown doppio-trigger | ⚠️ advisory (enumera listener) | Tier 2/3 (esecuzione) |
| `scanMesh._synId`/SynRegistry desync | ❌ | Tier 3 (runtime) |
| correttezza numerica ICP / detection | ❌ | **Tier 3 golden-master + fixture STL reale** |
| ordine d'esecuzione a runtime | ❌ | Tier 3 |
| output PDF / rendering | ❌ | Tier 3 |

---

## 4. Tier 1.5 — propagazione accessor (jsdom, no browser/WebGL, nessuna fixture)

Gate **del passo 2** (spina `window.SYN` + alias accessor), distinto dal **Tier 1** (presenza simboli,
statico) e dal **Tier 3** (golden-master WebGL). Verifica ciò che il linter statico non può: che
l'accessor sia **vivo**, cioè che la riassegnazione via setter sia **vista dai lettori bare** non-strict.

Per ogni nome `accessor_backed` (`scanMesh` come oggetto; `analysisMode`/`currentWorkflow` come
primitive), in **jsdom** (zero browser, zero WebGL, zero STL — solo `global`/`window`):
1. installa l'accessor come da STRATEGIA §2.3 (`Object.defineProperty(window, NAME, {get/set})`
   appoggiato a `SYN.scene`/`SYN.state`);
2. definisci una funzione **non-strict** che legge il nome **nudo** (es. `function r(){ return NAME }`);
3. riassegna via setter (`window.NAME = nuovoValore`; per gli oggetti, muta una proprietà tramite il getter);
4. **asserisci** che la funzione veda il nuovo valore (propagazione effettiva ai lettori bare).

- **Costo**: basso — `jsdom` è una dipendenza di **test** (non del frontend, vincolo §3 salvo);
  nessun WebGL, nessuna fixture, nessun server stub.
- **Copre**: il fallimento tipico del passo 2 sulle primitive riassegnate — accessor *installato ma
  morto* (riferimento copiato invece di get/set, così la riassegnazione non propaga ai lettori bare).
- **NON copre**: il percorso clinico (detection→ICP→report) — resta Tier 3.

---

## 5. Tier 3 (differito) — promemoria fixture

Quando si arriverà al core `mis*` (roadmap passo 7) servirà il golden-master runtime. Precondizioni
già note (STRATEGIA §7), da affrontare allora:
- **Fixture**: 1 coppia STL **reale anonimizzata** (scan + reference) **fornita dall'utente** —
  decisione presa il 2026-06-14. La STL è geometria pura (triangoli), nessun metadato paziente.
  Serve perché la detection è **click-seedata** (`findScanbodyCenter(scanGeo, clickPos, clickNormal)`):
  una STL sintetica non la attiva in modo clinicamente significativo.
- **Harness**: headless Chrome + SwiftShader (Playwright/Puppeteer); stub `/auth/me` e `/api/*`;
  vendoring locale di THREE/jspdf/xlsx (oggi da CDN cloudflare a parse-time).
- **Confronto**: **numerico** su `misICP_result {rmsd, R, t, pairs[].{dx/dy/dz/d3um, axDeg}, score}`,
  **mai** pixel (il render WebGL varia per driver).

---

## 6. Riferimenti
`MODULARIZZAZIONE_STRATEGIA_v1.md` (§2–§3 invarianti, §7 gate, §9 problemi), `scripts/gate/`
(`check_inline_scripts.py`, template clip/panel), memoria `v3b-modularization`.
