# Frontend Synthesis-ICP — guida per chi arriva (15 minuti)

> Se sei un ingegnere nuovo su questo codice, leggi questa pagina prima di aprire un file.
> In 15 minuti sai **dov'è cosa**, **perché è fatto così** e **come si rilascia** senza
> rompere un prodotto clinico in produzione.

---

## 1. Cos'è, in una frase

SaaS B2B per l'analisi di precisione di scansioni intraorali dentali: confronta due STL,
individua gli scanbody (cilindri di riferimento), calcola deviazioni centroide-per-centroide,
posiziona i MUA e genera report clinici PDF. **Tutta la matematica CAD/ICP gira nel browser.**
Backend FastAPI su Railway; DB PostgreSQL. Live: https://app.syntesis-icp.com

## 2. La scelta di fondo: NIENTE build step (è una scelta, non un debito)

Il frontend è **HTML statico servito così com'è**. Nessun bundler, nessun transpiler,
nessun framework, nessun `npm install` per il frontend. Apri un `.html` o un `.js` in
`backend/static/` ed è **esattamente** ciò che gira nel browser dell'utente.

Perché: un laboratorio odontotecnico deve poter aprire il file, un deploy è un `COPY` di
file statici, e il debugging è "vedi la riga, è quella riga". Il prezzo è un file principale
grande (vedi sotto) — lo stiamo maturando per fasi (`docs/MODULARIZZAZIONE_STUDIO.md`), MAI
introducendo un build step. **Non proporre webpack/vite/React: è vietato da `CLAUDE.md §3`.**

## 3. Le pagine (una per file, servite da `/static/`)

| Pagina | File | Cos'è |
|---|---|---|
| **Analizzare** | `syntesis-analyzer-v3b.html` | Il cuore. 5 workflow in una pagina (vedi §4). ~41k righe (di cui **80% = asset CAD in base64**; il codice reale è ~18k righe). |
| **Vedere** | `syntesis-icp-vedere.html` | Viewer 3D leggero, misure/sezioni. Architettura più moderna (costruita sopra `ds/*`), è il **bersaglio** verso cui portare Analizzare. |
| **Dashboard** | `syntesis-dashboard-v1.html` | Area personale: storico analisi, progetti, cartelle Drive, classifica. |
| **Gestione** | `syntesis-gestione.html` | Admin: autorizzazioni utenti, librerie Replace-iT, archivio STL. |
| **Accedi / Home** | `syntesis-accedi.html`, `synthesis-home.html` | Login e splash. |

Moduli condivisi: **`backend/static/ds/`** (`syn-render` rig luci, `syn-clip` clipping,
`syn-panel` pannelli, `syn-gate` gate accesso, `tokens.css`/`components.css` design system).

## 4. Analizzare: 5 workflow in una pagina sola

Non sono pagine separate: è UN documento, e `selectWorkflow(nome)` mostra/nasconde i pannelli.

| Workflow | A cosa serve | Prefisso funzioni |
|---|---|---|
| **Analizza / Accoppia** | Posiziona MUA, calcola angoli e divergenze, fresabilità 5 assi | `placeMUA`, `calc*`, `fres*` |
| **Misurare** | Confronto ICP di due STL, deviazioni ΔXY/ΔZ/ΔD3D, report clinico | `misICP_*` (core clinico) |
| **Sostituire** | Sostituisce scanbody con ICP locale | `sost*` |
| **Replace-iT** | Sostituzione da libreria (madre→figlio), allineamento 3-punti | `replace*` |

Il core clinico (`misICP_*`, 123 funzioni: ICP, Kabsch+SVD, cap-PCA) è il pezzo più delicato:
si tocca per ultimo e solo con gate golden-master.

## 5. Da dove vengono le costanti: `window.SYN` è la fonte di verità

Le costanti cliniche (raggi scanbody, soglie di deviazione, palette colori, angoli MUA)
**non si hardcodano**. La catena è:

```
backend/registry.py  →  GET /api/registry/constants  →  window.SYN  →  codice frontend
   (canonico)              (bootstrap runtime)          (in pagina)     legge da qui
```

All'avvio, `window.SYN` parte con dei fallback sincroni e poi viene sovrascritto dalla
risposta dell'endpoint. Se ti serve una soglia o un raggio, leggi da `window.SYN.*`
(es. `window.SYN.scanbody`, `window.SYN.thresholds`, `window.SYN.palette`), MAI un numero
scritto a mano. I **colori clinici** e le **costanti IPD** sono immutabili senza
autorizzazione (`CLAUDE.md §7, §9`).

## 6. La mappa del codice (dove trovare le cose)

- **`docs/MAPPA_FUNZIONALE.md`** — L'UNICA MAPPA. Due parti: (a) *funzionale* — ogni
  elemento UI, handler, route, verificata per riga; (b) *strutturale* — composizione,
  domini, accoppiamento, sezione GENERATA da `scripts/dep_census.py --write-mappa`.
- **`scripts/dep_census.py`** — censimento auto-rigenerante: quante funzioni per dominio,
  chi legge/scrive quali globali, cosa va preservato su `window`. Rigeneralo prima di ogni
  estrazione. Output dettagliato in `scripts/dep_census_out.json`.
- Dentro il monolite: cerca i **banner di sezione** con `grep -n` (es. `grep -n 'MISURARE'`).

## 7. Come si avvia in locale

Il frontend è statico: `python3 -m http.server` dalla root serve i file, ma le API
(`/api/...`, login) richiedono il backend FastAPI. Per il grosso del lavoro sul frontend
basta aprire il file; per il flusso completo usa l'ambiente Railway (live o staging).

## 8. Il ciclo di rilascio (in breve — dettaglio in `CLAUDE.md §11`)

1. Modifica chirurgica (mai riscritture; `grep -n` per localizzare, edit stretto).
2. **Bump versione** in `backend/registry.py` (`BACKEND_VERSION`) + se tocchi il monolite
   anche `<title>` e `window.ANALIZZA_BUILD`.
3. Se tocchi un elemento UI → aggiorna `docs/MAPPA_FUNZIONALE.md` **nello stesso commit**.
4. `node --check` sui blocchi `<script>`, commit specifico per file (mai `git add .`).
5. Deploy su **entrambi** i servizi Railway (LEGACY come canary → verifica → BACKEND),
   poi verifica live (versione, route 200, gating 403 per utente non autorizzato).

## 9. Le regole che non si violano (estratto di `CLAUDE.md §3`)

- No build step / npm frontend / framework. No big-bang.
- No hardcode di segreti, costanti cliniche, colori.
- Mai `git add .` (rischio credenziali). Mai leggere il monolite per intero (usa `grep -n`).
- Non dichiarare "fatto" senza verifica (compilazione + live dove pertinente).

---

**Prossimo passo pratico:** vuoi contribuire? Leggi `CONTRIBUTING.md` (convenzioni e gate).
Vuoi capire dove sta andando il frontend? `docs/MODULARIZZAZIONE_STUDIO.md` (strategia ratificata).
