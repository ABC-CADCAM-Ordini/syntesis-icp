# Convenzioni frontend Synthesis-ICP

> Regole vincolanti per chi tocca il frontend. Nascono dalla realtà di questo progetto:
> monolite grande, software clinico in produzione, niente build step. Rispettarle è ciò
> che tiene il codice leggibile da un umano e sicuro da rilasciare.
> Fonte primaria delle regole di progetto: `CLAUDE.md`. Qui c'è il "come si scrive".

---

## 1. I commenti spiegano il PERCHÉ, non il cosa

Il *cosa* lo dice il codice. Un commento serve quando la ragione non è ovvia: un vincolo
clinico, una trappola nota, il motivo di una scelta contro-intuitiva.

```js
// NO:  incrementa i, poi disegna
// SÌ:  8.66.7: l'asse pulito PRIMA della Kasa, altrimenti il centro slitta ~18µm sul
//      marker più dritto (piano ⊥ inclinato). Diagnosi gate-validata foglio Diagnostica.
```

## 2. La storia va in `docs/STORIA.md`, non nel sorgente

I commenti che raccontano il *passato* ("prima faceva X, poi in 8.x abbiamo cambiato…")
appesantiscono la lettura. Il changelog vive in `backend/registry.py` (History) e in
`docs/STORIA.md`. Nel sorgente resta solo il **perché ancora attuale**. Quando aggiungi un
fix, la spiegazione lunga va nel commit + registry; nel codice una riga essenziale.

## 3. Localizza con `grep -n`, mai a memoria; edit chirurgici

Il monolite (`syntesis-analyzer-v3b.html`) **non si legge mai per intero** (è enorme, e
l'80% è asset base64). Si localizza con `grep -n 'nomeFunzione'` o coi banner di sezione,
si legge un range stretto, si fa un edit circoscritto. **Niente riscritture**, niente
"pulizie" collaterali dentro un task funzionale (vedi §7).

## 4. File nuovi: max ~2-3k righe, con header-contratto

Ogni nuovo modulo (`ds/*.js`, `wf/*.js`) apre con un header che dice il contratto:

```js
/* ============================================================================
 * wf/fresabilita.js — dominio FRESABILITÀ (estratto dal monolite in 8.x, mecc. A)
 * PROVENIENZA: v3b righe ~5051-6403 (copia verbatim testimone in scripts/gate/fres/)
 * STATO CONDIVISO (su window, guardato): legge fresState, muaObjects; scrive analysisMode
 * ESPONE su window (handler inline / chiamanti esterni): openFresability, closeFresability
 * CARICAMENTO: <script src> classico, dopo syn-clip (che legge window.fresState)
 * ========================================================================== */
```

Se un file supera ~3k righe, si spezza **per responsabilità** (`-core` / `-ui`), mai a caso.

## 5. Sezioni navigabili: banner `§anchor`, non numeri di riga

I numeri di riga driftano a ogni edit. Ogni sezione ha un banner canonico grep-able:

```js
/* ==== §MISURARE-ICP ==== */
```

I riferimenti (nella MAPPA, nei commenti) puntano a `§token`, non a `r.1234`. Chi cerca fa
`grep -n '§MISURARE-ICP'` e atterra. `scripts/gate/check_anchors.py` (dalla Fase 2) verifica
che ogni token esista una e una sola volta.

## 6. Le costanti si leggono da `window.SYN`

Mai un numero clinico hardcodato. Raggi, soglie, colori, angoli MUA vengono da
`window.SYN.*` (catena `registry.py → /api/registry/constants → window.SYN`). I colori
clinici e le costanti IPD sono **immutabili senza autorizzazione** (`CLAUDE.md §7, §9`).

## 7. Un tipo di cambiamento per commit

- **Funzionale** (fix/feature): non ci mescoli pulizie estetiche o rimozione dead-code.
- **Pulizia** (dead-code, rinomine, storia→STORIA): passo DEDICATO, mai a ridosso di un
  deploy funzionale, e ogni rimozione con doppia verifica (zero call-site + gate).
- **Estrazione** (spostare un dominio in un file): vedi §8.

Questo tiene i diff piccoli, i bisect utili e i rollback puliti.

## 8. Estrazioni: si prova l'EQUIVALENZA prima del commit (gate)

Estrarre un blocco dal monolite non si fa "a occhio". Il rituale (già collaudato per
`syn-clip`, `syn-panel`):

1. Salva il blocco vecchio **verbatim** in `scripts/gate/<dominio>/<dominio>-old.js` (testimone).
2. Estrai nel nuovo file col meccanismo giusto:
   - **(A) clip-style** se c'è stato condiviso: IIFE `"use strict"`, stato su `window`,
     funzioni ri-esposte coi **nomi bare** → call-site e handler inline INVARIATI.
   - **(B) panel-style** se sono funzioni globali senza stato: **rilocazione VERBATIM**
     (`<script src>` alla stessa posizione, zero modifiche al codice).
3. Scrivi un **gate** che esegue vecchio e nuovo fianco a fianco e prova che l'output è
   identico (`Object.is` a precisione piena / MD5 dei buffer / RMSD centroide per il core).
4. Gate verde → commit → deploy duale → verifica → MAPPA nello stesso commit.

⚠️ **Trappola da conoscere (lezione 8.83.1):** in una pagina non-module gli handler inline
(`onclick="fn()"`) risolvono contro `window`. Una funzione definita DENTRO un'altra funzione
(es. `initThree`) **non** è raggiungibile dagli handler, anche se il file non è un modulo.
Verifica sempre l'esposizione con un probe browser (`typeof window.fn`), non solo col grep
del markup — il markup può esserci e la feature essere morta.

## 9. Prima del merge / commit — checklist

- `node --check` su ogni blocco `<script>` toccato (i numeri di riga del JS estratto ≠ HTML).
- ID markup ↔ JS coerenti (le funzioni chiamate dagli handler esistono e sono globali).
- Se hai estratto o toccato la struttura: `python3 scripts/dep_census.py --write-mappa`.
- `python3 scripts/gate/check_inline_scripts.py` (e, dalla Fase 2, `check_anchors.py`);
  dalla Fase 7 esiste `scripts/gate/run_all.sh` = un comando per tutti i gate.
- Se hai toccato un elemento UI: riga corrispondente di `docs/MAPPA_FUNZIONALE.md` **nello
  stesso commit**.
- Bump versione in `registry.py` (+ `<title>`/`ANALIZZA_BUILD` se tocchi il monolite).

## 10. Git

- `git add <file specifici>` — **MAI** `git add .` / `git add -A` (rischio di committare
  `scripts/.env.local` o file sporchi).
- Prima riga commit: max ~60 char, schema `VERSIONE: cosa cambia`. Body a bullet coi
  file/righe rilevanti per i bisect futuri. **Niente** trailer `Co-Authored-By` o "Generated with".
- Non forzare un push non-fast-forward: fermati e chiedi.

---

Domande che non trovano risposta qui → `CLAUDE.md` (regole di progetto) o `README.md`
(orientamento). Dove sta andando il frontend → `docs/MODULARIZZAZIONE_STUDIO.md`.
