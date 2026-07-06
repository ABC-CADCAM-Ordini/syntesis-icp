# Strategia di modularizzazione — Syntesis-ICP (RATIFICATA)

> **Stato:** STRATEGIA UFFICIALE RATIFICATA dall'utente il **2026-07-05** ("si, ratifica").
> **Processo di ratifica:** ricognizione a 3 agenti sul codice reale (anatomia fisica,
> meccanismi collaudati, dissezione domini) → 3 piani indipendenti da architetti con lenti
> diverse (A "peso e domini", B "piattaforma", C "leggibilità umana") → giuria a 3 lenti
> (rischio clinico, valore umano, costo/beneficio). **Vince C** (2 giudici su 3),
> irrobustito con gli innesti migliori di A e B (elencati in §6).
> **Numeri correnti:** vedi MAPPA_FUNZIONALE → "Mappa strutturale del monolite" (generata).
> **Obiettivo (testuale dell'utente):** monolite "meno unico, più scalabile, più leggibile,
> più maturo per essere lavorato in un'ottica professionale, leggibile non solo da una IA
> ma anche da un umano".
> **Vincolo:** sempre INCREMENTALE col gate di equivalenza, mai riscrittura. Coerente
> con CLAUDE.md §3 (no build step, no npm frontend, no refactor big-bang).

> **AVANZAMENTO:** ✅ **Fase 0 COMPLETATA** (2026-07-05, doc/tooling only, nessun deploy):
> `docs/frontend/README.md` + `CONTRIBUTING.md`; `dep_census.py` corretto (bug one-liner,
> blob B64 escluso → JS reale 17.872 righe non 39.166, domini fini → 'other' da 92 a 3);
> `make_fixtures.py` + fixtures golden-master (3 scanbody reali, coppie A/B con T nota) +
> gate `scripts/gate/fixtures/gate.mjs` (9/9 verde).
> ✅ **Fase 1 COMPLETATA** (2026-07-05, 8.84.0 commit 8b893f1): 7 asset → `assets/` verbatim,
> monolite 41.480→20.189 righe (−51%), gate MD5 9/9, prova funzionale live ok.
> ✅ **Fase 2 COMPLETATA** (2026-07-05, 8.84.1 commit 49fa8b3): TOC 36 voci + 36 banner §anchor,
> storia→STORIA.md, gate comments_only_diff (byte-identico) + check_anchors PERMANENTI.
> ✅ **Fase 3 COMPLETATA** (2026-07-05, 8.84.2 commit 26b12f9): CSS 927 righe → css/analyzer.css
> byte-verbatim; monolite a 19.310 righe. **BLOCCO FRONT-LOADED (fasi 0-3) COMPLETO**.
> ✅ **Fase 4 COMPLETATA** (2026-07-05, 8.85.0 commit aa0ce0e): 27 fn pure → ds/syn-math (14) +
> syn-geom (8) + syn-color (5), verbatim; esclusa in corso d'opera ANCHE buildUndercutColors
> (legge muaObjects: il criterio è zero-stato, non il dominio del censimento). Gate golden-master
> permanente scripts/gate/purelib/ (78 scenari Object.is su fixtures+degeneri, md5 verbatim per fn).
> ✅ **Fase 5 COMPLETATA** (2026-07-05, 8.86.0 commit 0118e89): syn-env 36 fn functions-only
> (stato nel monolite: vincolo d'ordine MAX_MILLING_ANGLE; mecc. A→B applicando la regola di
> sicurezza di questo stesso studio) + syn-vmbar/syn-auth-ui in-place; harness browser 18/18 +
> verifica avversariale 6 lenti PASS; monolite a 18.258 righe.
> ✅ **Fase 6a COMPLETATA** (2026-07-06, 8.88.0 commit acb7a2f; prep dedup 8.87.2): 34 fn del
> workflow FRESABILITA → wf/fresabilita.js (functions-only; stato/banner/monkey-patch restano;
> group-dialog escluso perché è gestione gruppi MUA). Scouting 6-lenti + avversariale 4-lenti
> (Opus) 4/4 PASS; gate Node + harness browser; monolite a 17.393 righe.
> ✅ **Fase 6b COMPLETATA** (2026-07-06, 8.89.0 commit 472eb35): 10 fn tree-view → wf/tree.js
> (functions-only; muaExpanded resta; escluse setSceneObjectColor/__synApplyColor/getGroupBadgeColor
> = utility scena/colore condivise). Scouting 5-lenti + avversariale 4-lenti (Opus) 4/4 PASS; gate
> Node + harness browser classList/display; verifica live incl. Claude Chrome (pannello apre/chiude
> sull'app reale). Monolite a 17.138 righe.
> ✅ **Fase 6c COMPLETATA** (2026-07-06, 8.90.0 commit 8e7839d): 4 fn report PDF Analizza (analReport_*)
> → wf/report-analizza.js (functions-only; banner + report Misurare + pipeline condivisa restano). Gate
> SHIM jsPDF (proxy che registra la sequenza PDF: 1152 chiamate/6 pagine) + avversariale 3-lenti 3/3 PASS;
> verifica live incl. Claude Chrome (4/4 esposte, report Misurare intatto). Monolite a 16.023 righe.
> NB: la wf/report-comune.js (pipeline condivisa) NON è stata separata — intrecciata con mis, si farà con 6f.
> ▶ Prossimo: **Fase 6d-0 INVERSIONE DEL CENTRALINO** (release autonoma, insistenza unanime della giuria):
> ogni dominio registra window.SynWF.register(nome, {hardReset, hasUnsavedData, setArtifactsVisible});
> selectWorkflow diventa dispatcher; le 16 scritture cross-domain migrano ai proprietari. Gate: truth-table
> esaustiva 5 workflow × sporco/pulito. Poi 6d sost → 6e replace → 6f mis ULTIMO (con report-comune).

---

## 0. Sintesi esecutiva

**La scoperta che ridimensiona il problema** (ricognizione 2026-07-05): il monolite non è
41.479 righe di codice — è **~17.900 righe di JS applicativo + 4,58 MB (80% del file) di
asset B64 embedded** (5 STL single-line + `SOSTITUIRE_TEMPLATES_B64` che occupa 21.301
righe IN MEZZO al blocco motore + logo PNG). Il problema di leggibilità è per l'80% un
problema di payload, non di architettura.

**Il piano** (8 fasi, ognuna un rilascio autonomo con gate; profilo "front-loaded"):
dopo le sole fasi 0-3 (~1 settimana di lavoro effettivo, rischio quasi nullo, zero logica
toccata) il file passa da 41k a ~19k righe indicizzate con CSS separato e onboarding
scritto = **l'80% del valore umano subito**. Le estrazioni per workflow (fasi 4-6)
arrivano dopo, su terreno preparato, col core clinico `mis*` ULTIMO e solo con
golden-master. Ci si può fermare dopo qualunque fase senza debiti.

**Modello di lavoro** (ratificato con l'utente):
- si lavora **in locale** sul repo git; fasi rischiose (5, 6) su **branch dedicato**;
- la "copia" è triplice: git (rollback = revert+redeploy ~3 min), blocco vecchio salvato
  verbatim in `scripts/gate/<fase>/` come testimone, gate che prova old≡new PRIMA del commit;
- il server vede solo release provate; deploy sequenziale **LEGACY (canary) → verifica
  completa → BACKEND**; staging Railway = opzione rinviata (eventualmente solo per la 6f).

**Tempo stimato:** ~35-45 giornate di lavoro effettivo. In calendario: **2-3 mesi a ritmo
sostenibile** (il prodotto continua a vivere; ogni fase è sospendibile senza debiti) oppure
~5-6 settimane a ritmo intensivo. Collaudi utente: ~15-45 min per fase. Incognita maggiore:
la 6f (core Misurare), dimensionata apposta per ultima.

---

## 1. Fotografia quantitativa

> **SPOSTATA** (decisione utente 2026-07-05: la mappa e' UNA sola). La fotografia
> strutturale vive in **`docs/MAPPA_FUNZIONALE.md` → "Mappa strutturale del monolite"**,
> sezione GENERATA da `python3 scripts/dep_census.py --write-mappa` e tenuta fresca
> dalla regola CLAUDE.md §4 (rigenerazione a ogni bump MINOR e prima di ogni passo
> di estrazione). Dettaglio per-dominio (globali lette/scritte, API da preservare):
> `scripts/dep_census_out.json`.
>
> ⚠️ Nota dalla ricognizione 2026-07-05 (da sistemare in Fase 0): il censimento ha un bug
> di body-detection sulle funzioni one-liner (r.111-117 di dep_census.py) che sporca i
> dati di parseSTL/kabsch/runICP, e conta le 21.301 righe di `SOSTITUIRE_TEMPLATES_B64`
> come "JS" (il JS reale è ~17.900 righe, non 39.166).

---

## 2. Cosa è già fatto (non si parte da zero)

**Moduli `ds/` LIVE:**

| Modulo | Versione | Meccanismo | Note |
|---|---|---|---|
| `ds/syn-render.js` | — | classic IIFE parse-safe | rig luci + sRGB, fonte unica |
| `ds/syn-clip.js` | 8.11.0 | **A** (stato condiviso su `window`) | legge `window.fresState`, chiama `window.closeFresability` |
| `ds/syn-panel.js` | 8.12.0 | **B** (rilocazione in-place verbatim) | gate browser diff 0 |
| `ds/syn-gate.js` | — | infra gate | |
| `ds/tokens.css`, `ds/components.css` | 8.60.0+ | design system | token condivisi |

**Infrastruttura gate** (`scripts/gate/`):
- **Node A/B headless** (`clip/`): THREE reale, scenario deterministico (mesh sintetica,
  niente dati paziente), deep-diff `Object.is` a precisione piena (−0/NaN).
- **Browser reale via preview** (`panel/`): per sottosistemi DOM/localStorage senza THREE.
- `check_inline_scripts.py`: `node --check` di ogni `<script>` inline.
- ⚠️ `.claude/launch.json` config `gate-static` resta **locale/gitignored** (vincolo utente).

**Bersaglio architetturale:** `syntesis-icp-vedere.html` (430 KB, `v8.0.x-refactor`),
ricostruito sopra `ds/*`. L'unificazione va fatta portando i workflow del monolite
**verso** l'architettura di Vedere, non fondendo Vedere nel monolite.

---

## 3. Due meccanismi di estrazione (collaudati)

Si sceglie per com'è fatto il blocco:

- **(A) clip-style** — blocchi con stato condiviso / cross-coupling: IIFE `"use strict"`,
  stato come `window.synX`, funzioni ri-esposte coi **nomi bare su window** → i call-site
  esterni e gli handler inline restano INVARIATI.
- **(B) panel-style** — blocchi di funzioni globali chiamate da handler inline, senza stato
  condiviso: **rilocazione in-place VERBATIM** (`<script src>` al posto dell'inline, alla
  stessa riga, classic non-strict, ZERO modifiche al codice). Più sicuro di (A) quando
  wrappare in IIFE strict costringerebbe a ri-esporre molte funzioni per zero beneficio.

⚠️ Lezione 8.83.1 (slider mouse in Vedere): in un non-module gli handler inline risolvono
contro `window` — una funzione definita dentro una funzione contenitore (es. `initThree`)
NON è raggiungibile dagli `onclick=`. Ogni estrazione verifica l'esposizione con probe
browser (`typeof window.fn`), non solo col grep del markup.

---

## 4. Problematiche (in ordine di gravità)

**A. Scope globale piatto = accoppiamento implicito.**
Pochi `window.*` espliciti contro ~490 funzioni e ~150 globali top-level. Estrarre un blocco
richiede prima di *scoprire* cosa legge/scrive verso l'esterno. È il vero campo minato.
Esempio reale: `syn-clip.js` (LIVE) legge `window.fresState` e chiama `window.closeFresability`
→ l'estrazione di `fres*` **deve** preservare quei nomi su `window` o rompe il clip in prod.
Mitigazione: la superficie per-dominio è ora censita (`dep_census_out.json`).

**B. ~140 funzioni globali ancorate a ~270 handler inline.**
Ogni `onclick="fn()"` esige che `fn` resti raggiungibile globalmente. Vincola il meccanismo
(A o B); non si può "modulare pulito" senza riscrivere il markup → fuori scope per design.

**C. Il core `mis*` (123 funzioni) è clinico.**
ICP / Kabsch+SVD / cap-PCA / deviazioni. Va estratto **per ultimo**, con gate golden-master.
Fixtures: **risolte senza dipendenza esterna** (innesto dal piano B) — `make_fixtures.py`
genererà coppie sintetiche deterministiche dai CAD B64 GIÀ in repo (CAD + rototraslazione
nota = risultato atteso esatto, zero dati paziente); casi reali anonimizzati = opzionali e
additivi. Se il totale supera ~15 MB → decidere Git LFS con l'utente PRIMA.

**D. Deploy multi-servizio.**
Ogni release va su LEGACY + BACKEND. Ogni nuovo file statico deve arrivare a entrambi.
Innesto dal piano A: verifica post-deploy estesa con `curl -sIL` su OGNI nuovo path
`assets/ css/ ds/ wf/` (200 + Content-Length atteso) su ENTRAMBI i servizi + cache-busting
`?v=` legato ad ANALIZZA_BUILD sugli script esterni.

**E. Overhead per step.**
Branch → estrai → gate diff 0 → merge → bump → deploy duale → verifica live → MAPPA/STATO/
STORIA. Molto overhead per modulo, ma è ciò che rende sicuro il refactor su software in
produzione. Mitigazione: `run_all.sh` (un comando = tutti i gate) abbassa il costo marginale.

**F. Insidie note del dominio `fres*`** (analisi già svolta, blocco ~1.000 righe):
- `fresUpdateAllArrows` definita ×4 (dead-dup) → dedup PRIMA dell'estrazione, passo con gate;
- link cross-modulo verso `syn-clip.js` (vedi punto A);
- IIFE monkey-patch di `calculateAngles` ordine-dipendente → **lasciare nel monolite**;
- `fres*` legge `muaObjects`, scrive `analysisMode`, NON usa `MAX_MILLING_ANGLE`
  (ha DB macchine proprio in `fresState.db`); overlay scene morta (`fresOverlayRender` NO-OP).

**G. Fossili intenzionali di Replace-iT** (memorie di progetto): formula NDC clientX/rect
NON si tocca (regressione 8.59.2 revocata); dead-code auto-ICP si annota, non si pulisce
durante l'estrazione (pulizia = passo dedicato autorizzato dall'utente).

---

## 5. IL PIANO RATIFICATO — 8 fasi, ognuna un rilascio autonomo

Principio direttore: ogni fase = rilascio autonomo (gate verde → bump semver → deploy duale
→ verifica → MAPPA nello stesso commit), mai stato intermedio rotto, meccanismi solo già
collaudati. Ordine scelto per **valore-di-lettura per unità di rischio**.

### FASE 0 — Porta d'ingresso (rischio zero, effort M, ~2 gg)
- `docs/frontend/README.md` (~150 r): onboarding 15 minuti — architettura no-build come
  SCELTA, i 5 workflow, dove vive cosa, source-of-truth `window.SYN` ← `registry.py`,
  ciclo di rilascio. **Criterio di successo: lo legge l'utente; se non è chiaro, è fallito.**
- `docs/frontend/CONTRIBUTING.md` (~120 r): convenzioni vincolanti — commenti = PERCHÉ
  (il cosa lo dice il codice); commenti-storia in STORIA.md; max ~3k righe/file nuovo;
  header-contratto nei moduli; banner `/* ==== §NOME ==== */`; gate prima del merge.
- Fix `dep_census.py`: bug one-liner + domini fini (math/geom/colorclass/diag/chrome,
  'other' scende da 92 a ~5 fn) + scansione multi-file (monolite + ds/ + futuri wf/).
- `make_fixtures.py` + `tests/fixtures/stl/`: golden-master AVVIATO SUBITO (sblocca 4, 6f, 7).
**Gate**: censimento senza artefatti; fixtures caricabili da parseSTL in un run node.

### FASE 1 — Sgonfiare: 7 asset B64 → `assets/` (rischio basso, effort M, ~2-3 gg)
Da 41.479 a ~19.700 righe. Meccanismo B, rilocazione VERBATIM di soli literal:
- 5 var B64 single-line (r.1808-1810, 1853-1854) → 5 file `assets/*.b64.js`
  (`var X="...";` classic script) caricati `<script src>` **alle stesse posizioni**;
- `SOSTITUIRE_TEMPLATES_B64` (r.13095-34395, 21.301 righe / 1,75 MB in MEZZO al MAIN) →
  `assets/sost-templates.b64.js`, caricato accanto agli altri PRIMA del MAIN (literal puro,
  consumato solo a runtime da `sostDecodeTemplate`); il blocco MAIN NON si spezza;
- logo header (r.981, 74 KB data-URI) → `assets/logo.png` (tocca UI → riga MAPPA stesso commit).
**Semantica embed 8.68.0 PRESERVATA**: niente fetch, niente async — cambia solo il file
che ospita i byte. La conversione a binari fetch = DECISIONE APERTA rinviata a dopo Fase 6.
**Gate** (`scripts/gate/assets/verify_b64.mjs`): decodifica old/new in vm e confronta
**MD5 dei 7 buffer binari** (per i template anche gunzip); + check_inline + smoke Sostituire.

### FASE 2 — Navigabilità in-place: TOC + §anchor (solo commenti, effort M, ~2-3 gg)
- Indice in testa al file: TOC con **anchor grep-able** (`§MISURARE-ICP`, ...) — mai numeri
  di riga; banner canonici a ogni confine di dominio (JS, HTML, CSS);
- commenti-storia → `docs/STORIA.md` (nel sorgente resta solo il perché attuale);
- **innesto dal piano B (anti-drift strutturale)**: `dep_census.py --write-mappa` emette
  riferimenti `file + §anchor (+offset)` e la MAPPA migra sugli anchor; nuovo
  `scripts/gate/check_anchors.py` (ogni §token esiste 1 volta sola) in checklist per sempre.
**Gate**: `comments_only_diff.mjs` — codice a commenti-strippati **byte-identico** old/new.

### FASE 3 — CSS → `css/analyzer.css` (rischio basso, effort S, ~1 g)
Blocco r.17-908 (892 r) + micro-blocco #vmBar → un file, `<link>` alla stessa posizione
in cascata. RESTA inline solo l'anti-flash r.8 (coppia di syn-gate).
**Gate**: CSS byte-verbatim + preview_inspect su 6 selettori sentinella old/new.

### FASE 4 — Libreria pura: `ds/syn-math.js` + `syn-geom.js` + `syn-color.js` (effort M, ~3-4 gg)
~30 funzioni a ZERO stato (meccanismo B): math = parseSTL/centroid/kabsch/matMul/transpose/
det3/svd3x3/samplePoints/runICP + `_mc*`; geom = extract*/intersect*/project* (ESCLUSE le 2
stateful); color = classify*/undercutColor*/_escHtml (legge window.SYN, colori clinici
IMMUTABILI). Azzera il grosso del collante (api_cross 57 → "tutti usano una libreria").
**Gate** (il più forte del piano): golden-master numerico sulle fixtures a precisione piena
(`Object.is`) + **casi degeneri** (coplanari, riflessione, NaN — innesto dal piano A).

### FASE 5 — Pannelli/chrome: `ds/syn-env.js` (~700 r, mecc. A) + rilocazioni B minori
(auth r.40193-40346 → `syn-auth-ui.js`; vmBar → `syn-vmbar.js`). Micro-rilasci di fiducia
(innesto dal piano A) che rodano il rituale a costo S.
**Gate**: harness browser stile panel (tab/save/reset, snapshot localStorage+DOM).

### FASE 6 — Un file per workflow: `wf/` (il cuore del piano)
Ordine: **6a fres → 6b tree → 6c report → 6d sost → 6e replace → 6f mis ULTIMO**.
Regola: >3k righe si spezza per responsabilità (`-core`/`-ui`), mai per caso.
- **6a `wf/fresabilita.js`** (~1.000 r, A): dedup fresUpdateAllArrows PRIMA (passo con gate);
  monkey-patch calculateAngles RESTA nel monolite; preservare nomi window letti da syn-clip.
- **6b `wf/tree.js`** (~600 r, A). Gate harness browser (classList/display).
- **6c `wf/report-analizza.js`** (~1.200 r, blocco 9) + `wf/report-comune.js` (pipeline+disegni),
  mecc. B. PDF Misurare NON si separa da mis. Gate: **shim jsPDF che diffa la sequenza di
  API-call old/new** (innesto A; il PDF binario non è confrontabile) + smoke visivo.
- **6d-0 INVERSIONE DEL CENTRALINO — RELEASE AUTONOMA** (insistenza unanime della giuria):
  ogni dominio registra `window.SynWF.register(nome, {hardReset, hasUnsavedData,
  setArtifactsVisible})`; `selectWorkflow` diventa dispatcher; le 16 scritture cross-domain
  migrano nei proprietari. Il pattern esiste già (`_hardResetMisurare` → `misICP_reset`).
  **Gate: truth-table esaustiva** — 5 workflow × stato sporco/pulito, stato globale
  before/after identico per ogni transizione.
- **6d `wf/sostituire.js`** (~2.000 r, A). Gate: backbone clip su placement deterministico
  + **vincolo RMSD centroide 7,9µm** sul caso sintetico-su-sintetico (rituale del progetto).
- **6e `wf/replace-core.js` + `wf/replace-ui.js`** (~3.000 r, A): NON toccare formula NDC;
  dead-code si annota. Gate: scenario 3-punti sintetico + harness UI.
- **6f `wf/misurare-icp.js` + `wf/misurare-ui.js`** (~3.900 r) — **il core clinico, ULTIMO**:
  gate golden-master COMPLETO sulle fixtures (pipeline intera old/new: load → seed → ICP →
  ΔXY/ΔZ/ΔD3D → classi, precisione piena). **Nessuna estrazione senza fixtures in repo.**
  Rischio ALTO mitigato a medio dal golden-master. Effort L (~5-7 gg).
Prima di OGNI estrazione: rigenerare il censimento e ri-validare l'ordine sui numeri
(innesto A: l'ordine è ricontrattabile coi dati, non congelato a priori).

### FASE 7 — Rete di sicurezza dell'umano (effort M, ~2 gg)
- `scripts/gate/smoke/smoke.html`: pagina statica NON servita in produzione, carica gli
  stessi `<script src>` dell'app, esegue N scenari deterministici (uno per workflow) e
  mostra verde/rosso coi valori. Si apre con `python3 -m http.server`, zero tooling.
- `scripts/gate/run_all.sh` (~40 r, innesto B): un comando = check_inline + check_anchors +
  tutti i gate. Entra nella checklist di rilascio.
- (Opzionale, <1 g, innesto B): `SYN.modules.register()` minimale — ordine di caricamento
  come assert runtime dietro expert-mode. SENZA migrazione SYN.state (esclusa dalla giuria).

### FASE 8 — Regime permanente
Checklist estesa in CONTRIBUTING; MAPPA ancorata a `file + §anchor` (il drift-righe sparisce
per costruzione); censimento multi-file auto-rigenerante a ogni MINOR.

---

## 6. Innesti ratificati dagli altri piani (riepilogo)

Da **B (piattaforma)**: MAPPA ancorata ai marker emessa da dep_census + check_anchors (F2);
run_all.sh (F7); make_fixtures.py dai CAD in repo (F0); SYN.modules.register minimale
opzionale (F7). **ESCLUSA** la migrazione SYN.state con alias write-through (F4b di B):
rischio semantico massimo per il payoff di leggibilità minimo — il meccanismo A collaudato
la rende non necessaria.
Da **A (asset-domini)**: gate STL byte-identico per export; shim jsPDF a sequenza-di-chiamate;
vincolo RMSD 7,9µm nel gate sost; casi degeneri nel gate math; verifica post-deploy curl
sui nuovi path × 2 servizi; tabella effort/rischio e grafo dipendenze dure (fixtures→6f,
template .b64.js di F1 → fixtures del gate 6d, inversione centralino → 6d/6e); micro-rilasci
di fiducia; ordine ri-validato sul censimento prima di ogni estrazione. **ESCLUSA** la
conversione asset a fetch async (rimessa in discussione della scelta 8.68.0 per un beneficio
ottenibile verbatim a rischio zero — resta DECISIONE APERTA post-Fase 6).

---

## 7. Layout target a regime

```
backend/static/
├── syntesis-analyzer-v3b.html   ~6.500 r: TOC §anchor, markup 5 workflow, bootstrap SYN,
│                                importmap+bridge THREE, SynRegistry, init(), dispatcher,
│                                diag/expert, monkey-patch calculateAngles
├── css/analyzer.css             ~930 r
├── assets/                      ~4,6 MB fuori dal sorgente (logo.png + 6 *.b64.js)
├── ds/                          condivisi: tokens/components.css, syn-gate/render/clip/panel
│                                + syn-math (~200 r), syn-geom (~250 r), syn-color (~80 r),
│                                + syn-env (~700 r), syn-auth-ui (~160 r), syn-vmbar (~60 r)
└── wf/                          UN FILE PER WORKFLOW (≤3k r, header-contratto):
    fresabilita, tree, report-comune, report-analizza, sostituire,
    replace-core, replace-ui, misurare-icp (ULTIMO), misurare-ui
docs/frontend/{README,CONTRIBUTING}.md · tests/fixtures/stl/ · scripts/gate/{...,smoke/,run_all.sh}
```

**Resta nel monolite PER SEMPRE** (con motivazione): tutto il markup (273 handler inline),
bootstrap `window.SYN` (sincrono nel percorso critico), importmap+bridge THREE (trappola
parse-time documentata), SynRegistry, `init()` (l'ordine DEVE essere visibile in un punto),
dispatcher `selectWorkflow` post-inversione, monkey-patch `calculateAngles`, anti-flash r.8.

**Non si fa MAI**: bundler/transpiler/framework/npm frontend; big-bang; pulizia dead-code
dentro fasi funzionali; modifica costanti cliniche/colori; asset→fetch senza decisione utente.

---

## 8. Modello operativo e tempi (ratificati)

| Aspetto | Decisione |
|---|---|
| Dove si lavora | **In locale** sul repo git; branch dedicato per fasi 5-6; main diretto per 0-3 |
| La "copia" | git (revert+redeploy ~3 min) + blocco vecchio verbatim in `scripts/gate/<fase>/` + gate old≡new PRE-commit |
| Server | Solo release provate; deploy **LEGACY canary → verifica → BACKEND**; staging Railway = opzione rinviata (al più per 6f) |
| Tempo effettivo | **~35-45 giornate** di lavoro |
| Calendario | **2-3 mesi sostenibile** (fasi sospendibili senza debiti) · ~5-6 settimane intensivo |
| Collaudi utente | ~15-45 min/fase (README 15', asset 30', centralino 30', 30-45' per modulo wf) |
| Profilo valore | Dopo fasi 0-3 (~1,5 settimane): **80% del valore già in cassa** a rischio quasi nullo |
| Incognita | 6f core Misurare (5-7 gg): si muove solo a golden-master verde |

**Prossimo passo concordato**: partire con **Fase 0 + Fase 1** al via dell'utente.

---

## 9. Riferimenti

- `docs/MAPPA_FUNZIONALE.md` — L'UNICA MAPPA (funzionale + strutturale generata).
- `scripts/dep_census.py` / `dep_census_out.json` — censimento auto-rigenerante.
- `docs/MODULARIZZAZIONE_DIPENDENZE_v1.md` — censimento storico 2026-06-14.
- `scripts/gate/` — template gate riusabili (clip/panel/axis + futuri).
- `backend/static/syntesis-icp-vedere.html` — architettura bersaglio (`ds/*`).
- `CLAUDE.md` §3 (divieti), §4 (sync MAPPA + censimento), §11 (procedure).
- Memorie: `v3b-modularization`, `monolith-split-direction`, `audit-8804-debug-campaign`,
  `mouse-controls-customization` (lezione window-exposure).
- Ricognizioni e piani integrali della ratifica: workflow `monolith-strategy-design`
  (2026-07-05, 9 agenti; output archiviato nella sessione di lavoro).
