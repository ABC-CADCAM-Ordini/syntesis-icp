# Mappa delle dipendenze — censimento panoramico (v1)

> ⚠️ **SUPERATO da `MODULARIZZAZIONE_STRATEGIA_v1.md` (2026-06-14).** Questo censimento si
> fermava a riga 19982 e classificava per prefisso: ha quindi (a) contato 257 'other' includendo
> **86 funzioni `replace*` di Replace-iT** (dominio nascosto) e (b) perso `analReport_*` (report PDF,
> 20566–21684). I numeri corretti (file intero, 445 funzioni, other=171) e la strategia completa
> verificata in modo avversariale sono nel documento STRATEGIA. Tenuto come traccia del primo giro.

> **Stato:** analisi panoramica — **nessun codice toccato.**
> **Data:** 2026-06-14 · **Versione di riferimento:** 8.61.2
> **Sorgente dati:** `scripts/dep_census.py` (rieseguibile) → `scripts/dep_census_out.json`.
> **Oggetto:** blocco `<script>` gigante di `syntesis-analyzer-v3b.html`, righe **2414–19982**.
> **Scopo:** "sbrogliare la matassa" — capire DOVE i fili sono annodati prima di tagliarli.
> Compagno di `docs/MODULARIZZAZIONE_STUDIO.md` (§6 raccomandava proprio questo passo).

> ⚠️ **Natura euristica.** I corpi-funzione sono delimitati da `^function NOME(` fino alla
> prima `}` in colonna 0 (robusto perché le graffe annidate sono indentate). Dominio per
> prefisso del nome. Write = `NOME =|+=|-=|++` (escluso `==`). Numeri da prendere come
> ordini di grandezza, non al singolo riferimento. Il passo *mirato* (per-funzione) raffinerà.

---

## 0. I tre risultati che contano

1. **Più della metà delle funzioni non ha un dominio.** Su 441 funzioni top-level,
   **257 (58%) sono "other"** — nomi senza prefisso (dialog, menu file, env settings,
   view-mode, export…). La matassa non è solo "i domini si parlano"; è che **i domini in
   gran parte non sono nemmeno separati per nome.** Sbrogliare = prima *dare un nome* ai blocchi.

2. **C'è una spina dorsale di stato condivisa: `scanMesh`.** Una sola variabile globale
   toccata da **4 domini** con **115 riferimenti** in tutto il file. È il perno a cui tutto
   è appeso. Finché vive come globale nuda, nessun dominio è davvero isolabile.

3. **L'accoppiamento cross-modulo verso la produzione è reale e nascosto.** `ds/syn-clip.js`
   (LIVE) chiama dentro il monolite via alias `root.` (= `window`), non via `window.` esplicito —
   quindi invisibile a una ricerca ingenua. Estrarre `fres*` senza preservare quei nomi
   **rompe il clip in produzione.**

---

## 1. Funzioni per dominio (441 top-level)

| Dominio | # funzioni | Range righe | Clustering |
|---|---:|---|---|
| **other** (senza prefisso) | **257** | sparse | glue trasversale — il vero nodo |
| `mis*` (core metrologico/ICP) | 106 | 6158–10472 | clusterizzato |
| `sost*` (Replace-iT) | 40 | 15249–19428 | clusterizzato (ma vedi §3) |
| `fres*` (fresabilità) | 31 | 5234–6113 | **contiguo, ~880 righe** |
| `render*` | 3 | 5767–11288 | sparso (gran parte già in `ds/syn-render.js`) |
| `tree*` (albero scena) | 3 | 4112–4182 | contiguo, piccolo |
| `find*` (detection scanbody) | 1 | 2736 | isolato |

> Le funzioni `anal*`/`report*` (~4) stanno **fuori** dal blocco gigante, nei blocchi
> `<script>` finali (20126/20324) — vanno censite a parte nel passo mirato.

---

## 2. Stato condiviso = 125 variabili globali top-level

22 sono toccate da ≥2 domini. Le più intrecciate (W=scrive, R=legge):

| Variabile | # domini | Scrive (W) | Legge (R) | Lettura |
|---|---:|---|---|---|
| **`scanMesh`** | **4** | other | mis, render, tree, other | **la spina dorsale** (115 ref) |
| `SOSTITUIRE_TEMPLATE_INFO` | 3 | — | find, sost, other | template scanbody condiviso |
| `envSettings` | 2 | other | mis, other | ambiente/render |
| `currentWorkflow` | 2 | other | mis, other | stato di navigazione |
| `analysisMode` | 2 | other | sost, other | modo attivo |
| `cutState` / `misurareState` | 2 | — | render, other | viste taglio/misura |
| `fresState` | 2 | — | **fres, other** | + `ds/syn-clip.js` via `root.` (§4) |
| `misICP_meshA/meshesA/result/labels` | 2 | mis, other | mis, other | **core mis non incapsulato** |
| `sostMesh/sostPlaced/sostStl/sostOriginalGeo/sostCounter/sostScanUI/_sostExportPending/sostCustomStlBuffer/sostPlacementMode/replacePickDownX` | 2 | **sost, other** | sost, other | **sost spaccato fra prefisso e glue** |

**Due pattern leggibili dalla tabella:**
- I gruppi `misICP_*` e `sost*` sono scritti **sia** dal dominio omonimo **sia** da "other":
  significa che la logica di quei domini è **divisa** tra funzioni con prefisso e funzioni
  glue senza prefisso. Prima di estrarre vanno *consolidati per nome* (vale soprattutto per
  `sost*` → coerente con la roadmap Replace-iT).
- `scanMesh`, `envSettings`, `currentWorkflow`, `analysisMode` sono **stato di piattaforma**
  (non di un dominio): candidati naturali a diventare stato *esplicito e posseduto*
  (es. namespace `window.SYN.scene.*`) come prerequisito all'isolamento dei domini.

---

## 3. Call graph dominio → dominio

Riferimenti incrociati a funzioni di un altro dominio (intensità di accoppiamento):

```
other  -> sost     15      render -> other    10      fres   -> other     3
mis    -> other    13      other  -> find      5      tree   -> other     2
sost   -> other    13      other  -> render    5      (edge minori ~1)
other  -> fres     11      other  -> mis       5
```

- **`other` è un hub**: quasi ogni dominio passa per la glue non-prefissata. È la conferma
  strutturale del punto §0.1 — non si isola un dominio senza prima ritagliare la glue che lo serve.
- **`other ↔ sost` è l'edge più pesante** (15+13=28): Replace-iT è il dominio più
  cablato con la glue → estrazione tardiva, dopo consolidamento naming.
- **`mis → other` (13)** e **`other → mis` (5)**: il core chiama molta glue ma è poco
  chiamato in modo incrociato → coerente con "core ultimo, ma relativamente auto-contenuto
  una volta isolata la spina `scanMesh` + i suoi `misICP_*`".
- **`fres`** ha edge bassi (fres→other 3, other→fres 11): **buon candidato precoce**, ma
  attenzione al filo nascosto §4.

---

## 4. Export surface — i nomi che NON si possono nascondere

**(a) Handler inline nel markup**: **130 funzioni** richiamate da `onclick/onchange/oninput`.
Ognuna deve restare raggiungibile globalmente dopo l'estrazione.

| Dominio | # funzioni esposte inline |
|---|---:|
| other | 94 |
| sost | 16 |
| mis | 14 |
| tree | 3 |
| fres | 2 |
| render | 1 |

**(b) Cross-modulo verso `ds/*.js` LIVE** (verificato a mano, NON visibile con `grep window.`):

| Modulo LIVE | Riferimento nel monolite | Forma |
|---|---|---|
| `ds/syn-clip.js` | `fresState`, `closeFresability` | `root.fresState` / `root.closeFresability` (alias `root`=window) |
| `ds/syn-panel.js` ← monolite | `onSyntesisViewModeChange` | il monolite usa la callback del panel |

→ **Regola operativa**: prima di estrarre `fres*`, censire ogni `root.X` / `window.X` nei
moduli `ds/` già live e garantire che `X` resti esposto. Un'estrazione che li rompe non dà
errore di build (non c'è build): rompe **a runtime, in clinica.**

---

## 5. Implicazioni per "sbrogliare la matassa" (ordine rivisto)

Il dato cambia leggermente l'ordine ingenuo. Sequenza consigliata:

1. **Prerequisito — dare casa allo stato di piattaforma.** Spostare la spina dorsale
   (`scanMesh`, `envSettings`, `currentWorkflow`, `analysisMode`) in uno stato *esplicito e
   posseduto* (es. `window.SYN.scene.*`), mantenendo gli alias bare per non rompere i 115
   call-site. Senza questo, ogni dominio resta legato alla globale nuda.
2. **`tree*`** (3 funzioni, edge bassissimi) — estrazione-pilota a basso rischio per
   rodare il gate sul prossimo dominio.
3. **`fres*`** (contiguo, 31 funzioni) — analisi già pronta; **preservare `fresState` +
   `closeFresability`** per `syn-clip.js` (§4).
4. **Sub-classificare "other"** — i 257 senza prefisso vanno divisi (file menu, dialog,
   env, view-mode, export…). È il lavoro che abilita tutto il resto; va fatto a tappe.
5. **`sost*`** — prima consolidare il naming (sost split, §2), poi estrarre.
6. **`mis*` core** — ULTIMO, gate golden-master. **Bloccante: fixtures STL non in repo**
   (vedi STUDIO §4.C) → catturarle prima.

---

## 6. Limiti di questo censimento (da chiudere nel passo mirato)

- "other" è un'unica scatola: serve sotto-tassonomia per nome/funzione.
- Edge `~1` non elencati singolarmente; il dettaglio è in `dep_census_out.json`.
- `anal*`/`report*` fuori dal blocco gigante: non coperti qui.
- Riferimenti dentro stringhe/template-literal possono gonfiare i conteggi: ordini di
  grandezza, non valori esatti.
- Lo stato scritto via `obj.prop =` (non `var =`) non è classificato come write del top-level.

---

## 7. Riproducibilità

```bash
python3 scripts/dep_census.py        # rigenera tabelle + scripts/dep_census_out.json
```

`scripts/dep_census_out.json` è un artefatto generato (candidato a `.gitignore`).
Vedi anche: `docs/MODULARIZZAZIONE_STUDIO.md`, `docs/MAPPA_FUNZIONALE.md`, `scripts/gate/`.
