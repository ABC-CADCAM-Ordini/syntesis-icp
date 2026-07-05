# Studio di modularizzazione — Syntesis-ICP

> **Stato:** studio preliminare di fattibilità — **nessun codice toccato.**
> **Data studio:** 2026-06-14 (strategia) · **Numeri correnti:** vedi MAPPA_FUNZIONALE (generati, sempre aggiornati)
> **Scopo:** valutare come ridurre il monolite `backend/static/syntesis-analyzer-v3b.html`
> rendendolo gestibile e scalabile nel tempo, a compartimenti, senza big-bang.
> **Vincolo:** sempre INCREMENTALE col gate di equivalenza, mai riscrittura. Coerente
> con CLAUDE.md §3 (no build step, no npm frontend, no refactor architetturali big-bang).

---

## 0. Sintesi esecutiva

La modularizzazione è **fattibile ma solo per via incrementale**, ed è **già avviata**
(2 moduli in produzione + infrastruttura di gate). Non si parte da zero. La strada
è giusta; ciò che manca per renderla *gestibile nel tempo* è una **mappa del grafo
di dipendenze** (quali globali ogni dominio legge/scrive) e la **cattura delle fixtures
STL** necessarie a validare il core metrologico. Il big-bang è escluso: lo scope globale
piatto (526 funzioni) e i 150 handler inline rendono qualsiasi split in un colpo un
rischio inaccettabile su software clinico in produzione.

---

## 1. Fotografia quantitativa

> **SPOSTATA** (decisione utente 2026-07-05: la mappa e' UNA sola). La fotografia
> strutturale vive in **`docs/MAPPA_FUNZIONALE.md` → "Mappa strutturale del monolite"**,
> sezione GENERATA da `python3 scripts/dep_census.py --write-mappa` e tenuta fresca
> dalla regola CLAUDE.md §4 (rigenerazione a ogni bump MINOR e prima di ogni passo
> di estrazione). Dettaglio per-dominio (globali lette/scritte, API da preservare):
> `scripts/dep_census_out.json`.
>
> Questo documento resta la STRATEGIA (meccanismi di estrazione, ordine, rischi):
> non contiene piu' numeri che possano invecchiare.

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

**Bersaglio architetturale:** `syntesis-icp-vedere.html` (430 KB, `v8.0.0-refactor`),
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

---

## 4. Problematiche (in ordine di gravità)

**A. Scope globale piatto = accoppiamento implicito.**
Solo 9 `window.*` espliciti contro 526 funzioni e 1.505 globali. Estrarre un blocco
richiede prima di *scoprire* cosa legge/scrive verso l'esterno. È il vero campo minato.
Esempio reale: `syn-clip.js` (LIVE) legge `window.fresState` e chiama `window.closeFresability`
→ l'estrazione di `fres*` **deve** preservare quei nomi su `window` o rompe il clip in prod.

**B. 150 funzioni globali ancorate a 257 handler inline.**
Ogni `onclick="fn()"` esige che `fn` resti raggiungibile globalmente. Vincola il meccanismo
(A o B); non si può "modulare pulito" senza riscrivere 257 punti di markup → fuori scope.

**C. Il core `mis*` (106 funzioni) è clinico.**
ICP / Kabsch+SVD / cap-PCA / deviazioni. Va estratto **per ultimo**, con gate golden-master.
⚠️ **Le fixtures STL non sono nel repo** → vanno catturate PRIMA di poter validare
l'equivalenza numerica. Collo di bottiglia da risolvere presto.

**D. Deploy multi-servizio.**
Ogni release va su LEGACY + BACKEND. Ogni nuovo `ds/*.js` deve arrivare a entrambi;
disallineamento = due URL con versioni diverse. Aumenta il costo di verifica per micro-step.

**E. Overhead per step.**
Branch → estrai → gate diff 0 → merge → bump versione → deploy duale → verifica live →
aggiorna MAPPA/STATO/STORIA. Molto overhead per modulo, ma è ciò che rende sicuro il
refactor su software in produzione.

**F. Insidie note del dominio `fres*`** (analisi già svolta, blocco ~915 righe):
- `fresUpdateAllArrows` definita ×4 (dead-dup);
- link cross-modulo verso `syn-clip.js` (vedi punto A);
- IIFE monkey-patch di `calculateAngles` ordine-dipendente → **lasciare nel monolite**;
- `fres*` legge `muaObjects`, scrive `analysisMode`, NON usa `MAX_MILLING_ANGLE`
  (ha DB macchine proprio in `fresState.db`); overlay scene morta (`fresOverlayRender` NO-OP).

---

## 5. Ordine di estrazione consigliato

Dai meno intrecciati al core, metrologia ultima:

```
clip ✅  →  panel ✅  →  fres*  →  tree*/colori  →  report/PDF
        →  sost*  →  MUA placement  →  findScanbodyCenter
        →  CORE mis* (ULTIMO, golden-master su MUA reali)
```

Prossimo candidato: **`fres*`** (analisi pronta) oppure **`tree*`/colori** (più isolato).

---

## 6. Raccomandazione operativa

Prima di toccare altro codice, eseguire **un passo di mappatura del grafo di dipendenze**:
per ogni dominio (`fres*`, `tree*`, `sost*`, `mis*`) censire quali globali legge e scrive,
così ogni estrazione parte da una superficie di accoppiamento **nota** invece che scoperta
a mano. È documentazione, non codice.

In parallelo, pianificare la **cattura delle fixtures STL** (MUA reali, anonime) per
abilitare il gate golden-master sul core — senza, l'ultimo e più importante passo resta
non validabile.

---

## 7. Rischi residui da monitorare

1. **Drift dei numeri di riga**: ogni estrazione shifta i riferimenti in `MAPPA_FUNZIONALE.md`
   (vincolo CLAUDE.md §4). Costo di manutenzione reale, da mettere in conto a ogni step.
2. **Fixtures cliniche mancanti**: vedi §4.C — collo di bottiglia per il core.
3. **Codice non estraibile pulitamente** (`calculateAngles` monkey-patch): alcuni blocchi
   restano nel monolite per design.
4. **Performance / numero moduli**: 17 `<script>` su HTTP/2 vanno bene; oltre un certo
   numero valutare il caricamento — **senza build step** (vincolo §3).

---

## 8. Riferimenti

- **`docs/MODULARIZZAZIONE_DIPENDENZE_v1.md`** — censimento panoramico delle dipendenze
  (call graph + stato condiviso + export surface), il passo raccomandato in §6. Eseguito 2026-06-14.
- `scripts/dep_census.py` — strumento di censimento rieseguibile.
- Memoria di sessione: campagna `v3b-modularization`, `three-r169-migration`,
  `ui-consistency-cheerful-palette`.
- `CLAUDE.md` §3 (divieti), §4 (sincronizzazione MAPPA), §11 (procedure patch/deploy).
- `docs/MAPPA_FUNZIONALE.md` — mappa UI verificata per riga.
- `scripts/gate/` — template gate riusabili.
- `backend/static/syntesis-icp-vedere.html` — architettura bersaglio (`ds/*`).
