> ⚠️ **NOTA CREDENZIALI:** I token e le credenziali sensibili in questo documento
> sono stati sostituiti con placeholder per sicurezza.
> Le credenziali reali sono nel backup ZIP scaricato in sessione, oppure
> chiedi a Francesco Biaggini direttamente.
>
> Token GitHub: usa il Personal Access Token del profilo ABC-CADCAM-Ordini
> Token Railway: disponibile nel dashboard Railway del progetto syntesis-icp

---

# SYNTESIS-ICP — DOCUMENTO MAESTRO DI PROGETTO
## Versione v7.2.0.012 — Ultimo aggiornamento: 2026-04-13

---

> **NOTA PER CLAUDE:** Questo documento è pensato per permetterti di capire il progetto
> Syntesis-ICP completamente, anche se non hai mai visto questo codice prima.
> Leggi tutto prima di toccare qualsiasi file.

---

## 1. CHI È IL CLIENTE

**Francesco Biaggini** — CEO di Biaggini Medical Devices S.r.l. / IPD Dental Group (Arcola, SP, Italia).
Non è un clinico: è un imprenditore del settore dental con forte sensibilità tecnica e letteraria.
Stile di scrittura: "poeticamente tecnico". Odia i trattini EM (—). Ama NASA, Zweig, Calvino.

---

## 2. COS'È SYNTESIS-ICP

**Syntesis-ICP** è uno strumento di misura di precisione per la comparazione di scansioni intraorali dentali.

**Problema clinico che risolve:**
Quando un dentista o tecnico dentale scansiona un'arcata con impianti dentali, gli scanbody
(cilindri di plastica che si inseriscono sugli impianti) devono essere misurati con precisione.
Se due scanner diversi (o la stessa scansione ripetuta) danno posizioni degli scanbody
lievemente diverse, il protesista può fare una protesi che non si adatta.

**Come funziona:**
1. L'utente carica due file STL (scansioni 3D dentali, formato binario)
2. Il motore ICP (Iterative Closest Point) allinea le due mesh
3. Il sistema trova i cilindri (scanbody) in entrambe le mesh
4. Misura le deviazioni centroide per centroide: ΔXY, ΔZ, ΔD3D
5. Calcola un punteggio globale (0-100) e genera un report PDF professionale

**URL live:** https://syntesis-icp-production.up.railway.app/

---

## 3. ARCHITETTURA DEL SISTEMA

```
[Browser] ──POST /api/analyze-public──> [Railway Backend]
              (2× file STL, max 50MB)       FastAPI + Python
                                            icp_engine.py
[Browser] <──── JSON response ──────────   (scipy, sklearn, numpy)
              pairs, cylAxes, score,        PostgreSQL (Railway)
              cyl_tris_a, cyl_tris_b,
              bg_tris_a, ...
              
[Browser] ──── jsPDF ──────────────────> [PDF locale, client-side]
              (tutto il rendering PDF      nessuna chiamata al server
               avviene nel browser)
```

### Stack tecnologico

**Frontend (347KB, tutto in un singolo HTML):**
- Vanilla JS, nessun framework
- jsPDF + jspdf-autotable per generazione PDF client-side
- Three.js via CDN per viewer 3D nell'alignment manager
- CSS custom con variabili (tema light/dark)
- Multilingua: IT, EN, ES, FR, DE

**Backend (Python/FastAPI su Railway):**
- FastAPI (Python 3.11)
- numpy, scipy, scikit-learn per il motore ICP
- PostgreSQL per classifica e analytics
- JWT per autenticazione
- Resend API per email (notifiche classifica)

---

## 4. INFRASTRUTTURA E CREDENZIALI

**⚠️ ATTENZIONE: Non condividere queste credenziali pubblicamente**

### GitHub
- Repository: `https://github.com/ABC-CADCAM-Ordini/syntesis-icp`
- Token: `ghp_XXXXXX_VEDI_NOTA_SOTTO`
- Branch principale: `main`

### Railway
- URL live: `https://syntesis-icp-production.up.railway.app/`
- Token: `RAILWAY_TOKEN_VEDI_NOTA`
- Project ID: `RAILWAY_PROJECT_ID_VEDI_NOTA`
- Environment ID: `RAILWAY_ENV_ID_VEDI_NOTA`

### Database PostgreSQL (Railway interno)
- `postgresql://syntesis:DB_PASSWORD_VEDI_NOTA@postgres.railway.internal:5432/syntesis`
- Accesso solo dall'interno di Railway (non dall'esterno)

### JWT Secret
- `JWT_SECRET_VEDI_NOTA`

### Admin credentials
- Username: `acadmin2025`
- Password: non memorizzata qui (chiedi a Francesco)

---

## 5. COME FARE IL DEPLOY

Il deploy avviene **sempre** cancellando il servizio esistente e ricreandolo (Railway non supporta
update in-place stabili con il nostro workflow).

```python
# Pattern standard di deploy (Python)
TOKEN = "1ff7bca5-..."
PROJECT_ID = "204e60f5-..."
ENV_ID = "f944a213-..."

def gql(q, v=None):
    r = requests.post("https://backboard.railway.app/graphql/v2",
        json={"query": q, "variables": v or {}},
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    return r.json()

# 1. Cancella servizio vecchio
gql("mutation($id:String!){serviceDelete(id:$id)}", {"id": OLD_SERVICE_ID})
time.sleep(3)

# 2. Crea nuovo da GitHub
r = gql("mutation($input:GitHubRepoDeployInput!){githubRepoDeploy(input:$input)}",
    {"input":{"projectId":PROJECT_ID,"environmentId":ENV_ID,
              "repo":"ABC-CADCAM-Ordini/syntesis-icp","branch":"main"}})
new_id = r["data"]["githubRepoDeploy"]

# 3. Configura servizio
gql("mutation...serviceInstanceUpdate", {...rootDirectory:"backend", dockerfile...})
gql("mutation...variableCollectionUpsert", {...DATABASE_URL, JWT_SECRET...})

# 4. Crea dominio pubblico
gql("mutation...serviceDomainCreate")

# 5. Aspetta 110s e verifica status
time.sleep(110)
```

**IMPORTANTE:** L'HTML finale (`index.html`) viene embeddato nel `main.py` come stringa
base64+gzip (`_HTML_B64`). Dopo ogni modifica all'HTML, bisogna:
1. Pushare `frontend/index.html` su GitHub
2. Comprimere e aggiornare `_HTML_B64` in `backend/main.py`
3. Fare il deploy

```python
import gzip, base64
html_bytes = open("index.html","rb").read()
html_b64 = base64.b64encode(gzip.compress(html_bytes)).decode('ascii')
# poi sostituisci in main.py:
# _HTML_B64 = "..."   con il nuovo valore
```

---

## 6. STRUTTURA DEL CODICE

### `backend/icp_engine.py` — Il cuore del sistema (44KB)

Funzioni principali:

```python
analyze_stl(data_a, data_b, landmarks_a=None, landmarks_b=None)
# → Ritorna dict con: pairs, score, icp_rmsd, cyl_axes, cyl_tris_a/b, ...
```

**Pipeline di analisi:**
1. `parse_stl_binary(data)` — legge file STL binario → array triangoli
2. `partition_comps(tris)` — connected components → separa scanbody da tessuti molli
3. Orientamento Z: `mean_cap_normal_z(tris)` — flip Z basato su normali delle cap
4. Pre-allineamento: centroidi + rotazione ottimale (Hungarian matching)
5. **ICP scanbody-only**: solo sui triangoli degli scanbody (non tessuti molli)
6. Misura locale per cilindro: `local_deviation(pair_a, pair_b, axis)`
7. `tris_to_list(t, max_tris=2500)` — campionamento stratificato (800 cap + 1700 pareti)

**Soglie cliniche:**
- `d3 < 50µm` → Ottimo (verde `#639922`)
- `50-100µm` → Accettabile (arancio `#D97706`)
- `100-150µm` → Rischioso (arancio scuro `#F97316`)
- `150-250µm` → Tensione (rosso `#EF4444`)
- `> 250µm` → Fuori posizione (viola `#A855F7`)

**Score formula:**
```python
# Per ogni cilindro: efficacia iperbolica
e_i = 1 / (1 + (d_i/100)^1.5 * w_xy + abs(dz_i/200) * w_z + ...)
score = mean(e_i) * 100
```

### `backend/main.py` — FastAPI server (179KB)

Endpoint principali:
- `POST /api/analyze-public` — analisi STL pubblica (no auth, rate limited 60/ora)
- `POST /api/analyze` — analisi autenticata (salva in DB)
- `GET /api/leaderboard` — classifica pubblica
- `POST /api/register` — registrazione utente
- `GET /api/admin/stats` — statistiche admin
- `GET /` — serve l'HTML frontend (da `_HTML_B64`)

### `backend/pdf_gen.py` — Report PDF server-side (15KB)

Usato per utenti registrati (report completo via API).
Usa ReportLab. Design NASA: bianco, blu `#0052A3`, testo scuro.

### `frontend/index.html` — Single-page app (347KB)

**Struttura interna:**
```
<head> CSS custom (variabili, tema, responsive)
<body>
  #siri-wrapper          ← wrapper principale con bordo colorato
    .app-header           ← logo + nav tabs + language selector
    .app-card             ← card principale
      #sec-analisi        ← sezione analisi (upload + risultati)
      #sec-distanze       ← sezione distanze inter-centroide
      #sec-classifica     ← classifica pubblica
      #sec-howto          ← come funziona
  #pdf-lab-modal          ← modal per nome studio prima del PDF

<script> <!-- globals: CLIN, scoreLabel, calcScore, clinAxis -->
<script> <!-- C: modulo principale analisi, render risultati -->
<script> <!-- pdf(): funzione generazione PDF (jsPDF, 45KB di codice) -->
<script> <!-- paintViewCyl(): renderer 3D cilindri per PDF -->
<script> <!-- _AP: animazione progress bar con frasi tecniche -->
<script> <!-- AM: Alignment Manager (viewer 3D + landmark picking) -->
```

**Variabili globali importanti:**
- `window._LR` — Last Result: tutti i dati dell'ultima analisi
- `window.FILES` — {A: File, B: File} — file STL caricati
- `window.C_pdf` — funzione pdf() esposta globalmente
- `window.LOGO_DATA` — logo in base64 per il PDF
- `SYNTESIS_VERSION = "7.2.0.012"` — versione corrente
- `SYNTESIS_BUILD_DATE = "2026-04-13"` — data build

---

## 7. IL PDF REPORT — STRUTTURA

Il PDF è generato completamente **client-side** con jsPDF.
Non viene mai inviato al server.

**Flusso:**
1. Utente clicca "📄 PDF"
2. Appare `#pdf-lab-modal` (modal con campi Nome Studio + Operatore)
3. Utente inserisce dati e clicca "Genera PDF →"
4. I dati vengono salvati in `window._LR.labName` e `window._LR.operatorName`
5. Viene chiamata `window.C_pdf()` → `function pdf()`

**Struttura del PDF (A4, 210×297mm):**

```
Pagina 1 — COPERTINA
  - Barra blu 3px in testa
  - Logo Syntesis-ICP (sinistra) + "Precision Scanner Report" + data (destra)
  - Regola grigia
  - Badge circolare (canvas 500×500px): anello colorato + score + label
    - File A (sinistra del badge): nome file, N cilindri
    - File B (destra del badge): nome file, RMSD
  - Nome Studio / Laboratorio (se inserito) in blu 13pt
  - Regola
  - MAPPA COLORIMETRICA con label blu + regola
  - Legenda scale cliniche (5 colori)
  - Footer: versione + barra blu

Pagine 2..N+1 — UNA PER CILINDRO
  - Running header: "Syntesis-ICP | Cilindro #N di N | Pag. X"
  - Barra blu 3px
  - Titolo grande + pill colorata + µm |D3D|
  - Score globale (destra)
  - Regola separatrice
  - [VISUALIZZAZIONE MESH 3D] — 3 viste (XY, XZ, YZ), 64×64mm × 8x = 512px
  - [ANALISI DEVIAZIONE] — gauge + compass + barre dX/dY/dZ
  - [TABELLA MISURAZIONI] — autoTable con header dark
  - [DIREZIONE SCOSTAMENTO XY] — compass 40×40mm
  - Footer NASA: regola grigia + versione + barra blu

Pagine N+2..M — UNA PER COPPIA DI DISTANZE
  - Running header NASA
  - Titolo "Distanza Inter-Centroide #I-#J" 18pt
  - Badge Δ a destra (colorato per livello clinico)
  - Mappa 2D proiezione PCA con linee distanza A e B
  - Scheda numerica: DISTANZA A | DISTANZA B | DIFFERENZA | VALUTAZIONE
  - Tabella riassuntiva tutte le coppie
  - Footer NASA
```

**Funzione `paintViewCyl()`:**
Renderizza un cilindro scanbody in una vista 2D (XY/XZ/YZ).
- Usa Painter's Algorithm (depth sort back-to-front)
- Shading Phong: ambient 0.30 + diffuse 0.55 + rim 0.25 + specular 0.18
- Luce: [0.35, 0.65, 0.65] (normalizzata)
- NO edge rendering (era causa di texture pixellata)
- Centroidi A (blu) e B (arancio) con linea tratteggiata

---

## 8. VERSIONING

Schema: `V7.MAJOR.MINOR.BUILD`
- **7** = versione maggiore (STL Cylinder Comparator v7 heritage)
- **2** = pipeline ICP completa con normali cap + alignment manager
- **0** = minor release corrente
- **012** = numero build di questa sessione

La versione appare in:
- `<title>` HTML: `Syntesis-ICP v7.2.0.012 — Precision Scanner`
- Footer app: `Syntesis-ICP v7.2.0.012 · Biaggini Medical Devices S.r.l.`
- Footer PDF: `Syntesis-ICP v7.2.0.012 (2026-04-13)`
- JS globale: `SYNTESIS_VERSION = "7.2.0.012"`
- `pdf_gen.py` footer server-side

**Prossima versione:** v7.2.1.xxx (bugfix) o v7.3.0.xxx (feature maggiore)

---

## 9. FUNZIONALITÀ DELL'ALIGNMENT MANAGER

Il pannello di allineamento manuale (toggle "Allineamento automatico") permette
di definire 3 punti di riferimento (landmark) su ciascun file STL per un
allineamento Kabsch più preciso quando l'auto-align fallisce.

**Come funziona:**
1. Toggle disattiva l'allineamento automatico
2. Si aprono 2 viewer 3D (uno per file A, uno per file B)
3. L'utente clicca 3 punti corrispondenti su ciascuna mesh
4. Il sistema fa Kabsch alignment sui landmark pairs
5. Poi ICP fine-tuning sui soli scanbody

**Implementazione:**
- `AM` module in `arcball_am.js` (integrato nell'HTML)
- Parser STL: `_parseBinary()` / `_parseASCII()`
- Campionamento stratificato: cap al 100% + pareti max 8000
- Raycasting Möller-Trumbore per click preciso sulla mesh
- PIP zoom viewer (2×) che appare al click, 3s poi fade

---

## 10. PROBLEMI NOTI E SOLUZIONI

### OOM (Out of Memory) su Railway
**Causa:** triangoli troppi in risposta JSON (175k×2 file×6 cilindri)
**Soluzione:** `tris_to_list(max_tris=2500)` con campionamento stratificato
(800 cap + 1700 pareti per cilindro). Il container Railway ha ~512MB RAM.

### ICP che converge su minimo locale sbagliato
**Causa:** tessuti molli diversi tra scanner diversi
**Soluzione:** ICP solo sui triangoli degli scanbody, skip se landmark manuali

### Flip Z instabile
**Causa:** il segno del centroide globale non è affidabile
**Soluzione:** `mean_cap_normal_z()` — usa la normale media delle facce cap (|nz/nl|>0.5)

### Edge rendering nel PDF che crea texture pixellata
**Causa:** edge rendering 0.4px su triangoli piccoli crea pattern a scacchi
**Soluzione:** rimosso completamente il `ctx.stroke()` in `paintViewCyl()`

### Codice esposto nel browser
**Causa:** sostituzione stringa malformata durante aggiunta modal PDF —
il vecchio `</html` era troncato, lasciando 95KB di JS esposto come testo
**Soluzione:** identificare il secondo `</body></html>` autentico e troncare lì

---

## 11. QUALITÀ DEL CODICE E STILE

- Tutto il frontend è in **Vanilla JS** (no framework, per massima portabilità)
- Il backend è Python standard con FastAPI
- **Niente em-dash** (`—`) nel testo italiano (Francesco li odia)
- Palette CSS: `--blue: #0052A3`, `--dark: #0D1B2A`, `--gray: #64748B`
- Design NASA: sfondo bianco, UN solo colore accento, numeri protagonisti
- Le frasi di attesa ("Reticulating splines...") sono in 5 lingue

---

## 12. FILE DI LAVORO LOCALI (Claude session)

Quando lavori in questa sessione:
- **HTML principale:** `/tmp/index_with_align.html`
- **Backend ICP:** leggi da GitHub, modifica lì direttamente
- **Backup ZIP:** `/mnt/user-data/outputs/syntesis_icp_backup_v7.2.0.012.zip`

---

## 13. CHECKLIST PRIMA DI OGNI DEPLOY

```
□ Valida JS: node --check su tutti i <script> blocks
□ Controlla </body></html> — deve apparire UNA sola volta
□ Aggiorna _HTML_B64 in main.py con il nuovo HTML compresso
□ Verifica che la versione sia aggiornata (SYNTESIS_VERSION, title, footer)
□ Test POST /api/analyze-public con file STL reali
□ Controlla OOM: se N cilindri > 8, ridurre max_tris
□ Hard refresh nel browser dopo deploy (cache aggressiva)
```

---

## 14. CONTESTO AZIENDALE

- **Azienda:** Biaggini Medical Devices S.r.l. / IPD Dental Group
- **Gruppo:** LifeDental Group (IPD, NewAncorvis, Zarc, altri)
- **Sito correlato:** AbutmentCompatibili.com (Magento 2)
- **Pubblicazione scientifica:** JIPD (Journal of Intelligent Prosthetic Dentistry)
  editato da Francesco — articoli in italiano su protesica digitale
- **Prodotto correlato:** ScanLogiQ (sistema di validazione scanner IOS)

---

*Fine documento — Syntesis-ICP v7.2.0.012 — 2026-04-13*

---
---

# APPENDICE 2026-04-25 — v7.3.8.001 FRESATURA AVANZATA

> Questa appendice consolida le evoluzioni dalla v7.2.0.012 alla v7.3.8.001.
> Documento principale invariato sopra; tutto ciò che è stato aggiunto nelle ultime
> due settimane di lavoro è descritto qui, in forma compatta.

## A.1 Stato del sistema al 2026-04-25

**Versione live:** v7.3.8.001
**URL produzione:** https://syntesis-icp-production.up.railway.app/, alias https://app.syntesis-icp.com/
**Commit corrente main:** `92df1543` (deploy SUCCESS Railway 2026-04-25 10:44 UTC)
**File principale:** `backend/static/syntesis-analyzer-v3b.html` (11.521 righe, 2.46 MB dopo l'integrazione fresabilità)

## A.2 Roadmap di versioning v7.3.x

Da v7.2.0.012 a v7.3.8.001 il prodotto ha attraversato due fasi distinte: una di consolidamento del motore ICP (v7.3.0–v7.3.7), una di estensione clinica (v7.3.8).

| Versione | Data | Contenuto sintetico |
|----------|------|---------------------|
| v7.3.6.003 | 2026-04-25 notte | Hotfix template mode 1T3 (singolo scanbody multi-isole) |
| v7.3.6.004 | 2026-04-25 notte | Flip CAD SR 180°X, ricalibrazione SOSTITUIRE_CULL_CYL[SR] |
| v7.3.7.001 | 2026-04-25 notte | Raffina ICP reale (sostituisce no-op precedente) |
| v7.3.7.002 | 2026-04-25 notte | Filtro Upper falsi positivi via n_cap≥30 |
| v7.3.7.003 | 2026-04-25 notte | Raffina ICP robusto: outlier rejection Tukey-like, convergenza ΔRMSD<1e-4 |
| v7.3.7.004 | 2026-04-25 notte | Weighted ICP: peso 5x cap, 1x cilindro (cap guida planarità, cilindro centra assi) |
| **v7.3.8.001** | **2026-04-25 mattina** | **Fresatura avanzata + fix z-index legenda sottosquadri** |

## A.3 La nuova feature v7.3.8.001 — Fresatura avanzata

### A.3.1 Cosa fa

Dopo l'analisi di Misura, l'utente clicca un nuovo bottone "**Fresatura avanzata →**" in fondo al pannello "Asse medio e divergenze". Il pannello Misura viene sostituito dal pannello Fresabilità, che risponde a una domanda clinica precisa: *gli angoli dei MUA sono compatibili con la macchina di fresatura su cui il cliente IPD lavorerà?*

### A.3.2 Modello matematico

Specifica completa: `FRESABILITY_MODEL_v0.5.md` (consegnato in sessione 2026-04-25, fonte di verità).

Per ogni MUA con asse $\vec{n}_i$ e un asse di setup della macchina $\vec{n}_\text{setup}$:

$$\theta_i = \arccos(|\vec{n}_i \cdot \vec{n}_\text{setup}|)$$

Il MUA è fresabile se $\theta_i \leq \alpha_\text{max}$ della macchina scelta. Tre modalità per scegliere $\vec{n}_\text{setup}$:

- **Modalità A — Asse medio**: media normalizzata degli assi MUA (formula chiusa, già esistente in Misura)
- **Modalità B — Minimax**: ottimizzazione che minimizza il massimo $\theta_i$ del gruppo. Algoritmo: Nelder-Mead 2D in coordinate sferiche, partenza dall'asse medio. Convergenza in ~20-30 iterazioni
- **Modalità C — Custom**: l'utente afferra l'asse di setup nello spazio 3D e lo trascina liberamente tramite trackball virtuale (Shoemake arcball, 1985). A ogni frame i $\theta_i$ si ricalcolano e i colori dei MUA si aggiornano live

Classificazione clinica a tre classi per MUA:
- **Ottimo** (verde): $\theta_i \leq 0.5 \alpha_\text{max}$
- **Accettabile** (giallo): $0.5 \alpha_\text{max} < \theta_i \leq \alpha_\text{max}$
- **Non fresabile** (rosso): $\theta_i > \alpha_\text{max}$

Verdetto gruppo: fresabile se tutti i singoli MUA sono fresabili.

### A.3.3 Database macchine

Persistente in `localStorage` con chiave `syntesisIcp.fresability.v1`. Contiene 5 macchine builtin (VHF S5 30°, VHF R5 35°, Jiny F5T Pro 30°, Dental Plus X1.8 33°, SK-5A 30°) più macchine custom create dall'utente.

Le builtin non sono eliminabili. L'utente può aggiungerne, modificarne, eliminarle.

### A.3.4 Vincolo: solo 5 assi

Decisione clinica di Francesco (2026-04-25): "i 4 assi fresano quasi solo denti naturali e no connessioni MUA dato che i canali vite sono cilindrici e impossibile trovare 3, 4 o 6 MUA perfettamente paralleli".

Conseguenza nel modello: nessun selettore "4 vs 5 assi" nell'UI. Tutti i fresatori del database sono 5 assi. Argomento matematico in §2.3 di `FRESABILITY_MODEL_v0.5.md`: il canale vite cilindrico richiede 2 DOF rotazionali per allineamento fresa/asse-MUA, e 1 DOF (i 4 assi) non basta nelle arcate reali.

### A.3.5 Architettura di integrazione

L'analisi di fresabilità è un'**estensione opzionale di Misura**, non un modulo separato.

- Sorgente unica degli assi MUA: `muaObjects[].axisDir`. Niente ricalcolo, niente disallineamento numerico tra Misura e Fresabilità
- Pannello sostitutivo: `openFresability()` nasconde i 3 pannelli Misura (`panelMuaList`, `panelAngleList`, `panelAxisInfo`) e mostra `panelFresabilita`. `closeFresability()` fa il contrario
- Stato `analysisMode = 'fresabilita'` durante la sessione (5° valore dopo `misura`, `accoppia`, `misurare`, `sostituire`)
- Hook non invasivo su `calculateAngles()`: wrapping che richiama `fresRecompute()` quando il pannello è aperto. Il codice originale di Misura è invariato
- Persistenza completa: macchina selezionata, modalità, asse custom, database custom — tutto in localStorage

### A.3.6 File modificati

Solo `backend/static/syntesis-analyzer-v3b.html`. Aggiunte 558 righe (25 KB):
- DOM: bottone "Fresatura avanzata" + pannello `panelFresabilita`
- JS: blocco "FRESABILITA' AVANZATA" prima di `function setMode()` (database, calcoli, trackball, open/close, hook)

Nessuna modifica a `main.py`, `icp_engine.py`, `pdf_gen.py`, `requirements.txt`, infrastruttura Railway.

### A.3.7 Bugfix collaterale (incluso nello stesso commit)

Z-index dello stacking dei layer fluttuanti correttto:
- `undercutLegend`: 5 → 9
- `clinicalBanner`: 6 → 10
- `layersPanel`: 8 (invariato)

Causa: `layersPanel` (z=8) copriva la legenda sottosquadri (z=5) e il banner clinico (z=6) quando entrambi attivi in alto a sinistra dello stesso layout. Segnalato da Francesco con screenshot 2026-04-25 12:36.

## A.4 Documenti di specifica prodotti in sessione 2026-04-25

Tutti consegnati in `/mnt/user-data/outputs/`:

1. `FRESABILITY_MODEL_v0.5.md` — specifica matematica completa della fresabilità (290 righe)
2. `IMPLEMENTATION_PLAN_v0.md` — architettura software, algoritmi, struttura dati, tappe di sviluppo
3. `fresability_module.js` — modulo JS autonomo con i calcoli (test Node.js: 26/26 passed)
4. `test_fresability.js` — suite di test della matematica
5. `fresabilita_standalone.html` — pagina di test interattivo standalone (file unico, no dipendenze esterne)
6. `syntesis-analyzer-v3b_v7.3.8.001-dev.html` — file completo modificato (copia di backup)
7. `syntesis-analyzer-v3b.PATCH.diff` — diff -u della patch applicata
8. `sezione_cono_MUA.png` — quote del CAD MUA misurato (16°, h=4.75mm)

## A.5 Lezioni apprese in questa sessione

**1. Disciplina specifica → codice.** La sessione 2026-04-25 ha consolidato il principio "documento prima del codice". Cinque iterazioni del modello (v0.1 → v0.5) hanno chiuso le ambiguità progettuali prima della scrittura dei 558 righe finali. Nessuna riscrittura, nessuna regressione.

**2. Standalone come passaggio intermedio.** Aver costruito `fresabilita_standalone.html` come pagina autonoma prima di toccare il file live ha permesso a Francesco di validare il design (trackball, modalità, palette) in 5 minuti, evitando il rischio di scoprire problemi UX dentro il modulo da 11k righe.

**3. Trappola del Railway redeploy.** `serviceInstanceRedeploy` ridipliogia l'**ultima build buildata**, non l'ultimo commit. Per deploy di un commit nuovo serve `serviceInstanceDeploy` con `commitSha` esplicito. Documentato in §A.6.

**4. Architettura additiva vs sostitutiva.** Francesco ha guidato la decisione cruciale di tenere Misura e Fresabilità separate logicamente (non fonderle), ma con sorgente dati unica. Ha protetto un modulo live (Misura) usato dai clienti senza rallentare l'aggiunta della nuova feature.

## A.6 Procedure operative aggiornate

### A.6.1 Deploy di un commit nuovo su Railway

`serviceInstanceRedeploy` non basta se Railway non ha rilevato il push. Procedura corretta:

```python
# 1. Push del commit (via GitHub API)
PUT /repos/{owner}/{repo}/contents/{path}
# → ottieni commit_sha dalla risposta

# 2. Deploy esplicito del commit specifico
mutation {
  serviceInstanceDeploy(
    serviceId: "b7671e12-545a-428e-9c2b-542916e8eff6",
    environmentId: "f944a213-371c-4377-9d4f-9c3eb2da3fb2",
    commitSha: "{commit_sha}"
  )
}
```

Verificare poi che `meta.commitHash` del nuovo deployment corrisponda al commit pushato.

### A.6.2 Verifica integrazione su file servito

Dopo deploy, fare hard refresh e controllare:

```bash
URL="https://syntesis-icp-production.up.railway.app/analizzare?nocache=$(date +%s)"
curl -s "$URL" > /tmp/served.html
grep -c "{stringa_chiave_della_feature}" /tmp/served.html  # deve essere ≥ 1
```

Se la dimensione del file servito non è cambiata o il marker non è presente, il deploy non ha pubblicato il commit giusto.

## A.7 Catalogo file di sessione (locali)

Working directory del lavoro intercorso:

```
/home/claude/icp_tests/fixtures/    # STL di test (1T3, OS, SR, Ds3_Reverse, ...)
/home/claude/deploy/repo/           # snapshot canonico post v7.3.7.004
/home/claude/repo_live/              # snapshot post v7.3.8.001 (fresabilità)
/home/claude/standalone/             # standalone fresabilità HTML autonomo
/mnt/user-data/outputs/              # consegne ufficiali a Francesco
```

## A.8 Pendenze tecniche identificate (non bloccanti)

Da `FRESABILITY_MODEL_v0.5` §7, caselle aperte ma non bloccanti per il rilascio:

1. Catalogo iniziale macchine: i 5 modelli proposti vanno bene o IPD raccomanda macchine diverse?
2. Nomenclatura classi: "ottimo / accettabile / non fresabile" coerente con stile IPD?
3. Soglia diagnostica di coppia: 2$\alpha_\text{max}$ adattiva o fissa?

Pendenze su altri moduli:

- DS1 cap-clustering DBSCAN: prototipo validato (6/6 e 5/5 sui casi di test), integrazione invasiva rimandata a v7.3.9 o successiva
- DNS register.it: CNAME app.syntesis-icp.com da bdxfubdr a tqxxdh7s.up.railway.app (Francesco: "importa poco ora")
- Master-doc principale (sezioni 1-14): aggiornato dalla v7.2.0.012; questa appendice ne è la continuazione

---

*Fine appendice 2026-04-25 — v7.3.8.001 deploy SUCCESS commit 92df1543 — Sezione redatta da Claude in sessione lunga con Francesco Biaggini, dalla notte del 2026-04-25 alla mattina dello stesso giorno*


# Appendice B — v7.3.9.001 (2026-04-25 pomeriggio)

## B.1 Sintesi del rilascio

Versione `v7.3.9.001`. Commit di chiusura: `5111c84e` (cancellazione legacy). Deploy Railway SUCCESS alle 12:09 UTC. Live su `https://syntesis-icp-production.up.railway.app/` e su `https://app.syntesis-icp.com/`.

Lo scopo del rilascio è duplice: pulire l'architettura della splash e dei moduli, ripristinare la parità del PDF Clinico con la versione del Comparator del 22/04 (16+ pagine inclusi i confronti inter-centroide).

## B.2 Pulizia architetturale

Il vecchio modello a tre tessere (Misurare, Sostituire, Analizzare) era una stratificazione storica: i primi due erano moduli standalone (`syntesis-calibrator-v4.html` e `syntesis-icp-replacer.html`), mentre Analizzare conteneva una versione integrata di entrambi i workflow oltre alla nuova analisi MUA. La duplicazione era diventata onere di manutenzione: ogni fix andava replicato.

Il rilascio v7.3.9.001 dismette i due file standalone e consolida tutto in `syntesis-analyzer-v3b.html`, che ora è l'unica destinazione operativa. La splash ridotta a tessera unica esprime questa scelta: una sola porta d'ingresso, l'ambiente unificato.

Endpoint Python rimossi da `backend/main.py`:

```python
@app.get("/replacer")    # rimosso
@app.get("/calibrare")   # rimosso (con il suo fallback raw GitHub di 16 righe)
```

Il file `main.py` passa da 366 a 341 righe. Gli endpoint dismessi rispondono ora `404 Not Found`. L'endpoint `/` continua a servire `index.html`, `/analizzare` continua a servire l'analyzer.

File legacy cancellati dal repo:

- `backend/static/syntesis-calibrator-v4.html` — il Comparator standalone (~3300 righe)
- `backend/static/syntesis-icp-replacer.html` — il Replacer standalone

## B.3 Splash a tessera unica

`backend/static/index.html`. La grid CSS a tre colonne (`#splash .sp-cards{display:grid; grid-template-columns:1fr 1fr 1fr}`) è stata sostituita da un layout flex centrato con larghezza massima 560 px. Le tre classi cromatiche `.measure`, `.replace`, `.analyze` (azzurro, verde, ambra) sono state rimosse: la tessera unica usa solo la palette blu (`#0052A3`).

La nuova tessera ha dimensioni più generose (padding 42×38, titolo 26 px, numero 78 px in opacità 0.06) e descrive sinteticamente i quattro workflow integrati:

> Workflow integrati: Analizza · Accoppia · Misura · Sostituisci  
> Mappa sottosquadri · Asse medio · Divergenze  
> Report PDF e Excel multi-tipo · Fresatura avanzata

Il bottone esegue direttamente `window.location='/analizzare'`. Etichetta della versione: `v7.3.9.001`.

## B.4 Multi-report PDF e Excel: cosa è già attivo

Il refactor del sistema di generazione report era stato sviluppato in working copy locale durante una sessione precedente ma non era stato pushato su `main`. Questo rilascio lo pubblica. Il sistema espone quattro voci nel menu "Scarica report" del modulo Misurare di Analizzare:

| Voce | Funzione | Output |
|---|---|---|
| Clinico (PDF) | `misICP_renderClinicalPDF(data)` | Cover + N pagine cilindro + N(N-1)/2 pagine coppie inter-centroide |
| Taratura (PDF) | `misICP_renderCalibrationPDF(data)` | Cover + sintesi metrologica + RMSD + anisotropia XY/Z |
| Analisi (PDF) | `misICP_renderAnalysisPDF(data)` | Versione estesa con coppie e raw data (~20 pagine) |
| Tabella dati (Excel) | `misICP_renderExcel(data)` | Quattro fogli `.xlsx` italiani |

Punto di ingresso unificato: `misICP_generateReport(kind)` con `kind ∈ {'clinico','taratura','analisi','excel'}`. La funzione legacy `misICP_generatePDF()` resta come alias retro-compatibile e mappa internamente su `'clinico'`.

I dati comuni a tutti i report sono prodotti da una sola funzione, `misICP_buildReportData()`, che restituisce l'oggetto canonico con `pairs`, `nCyl`, `rmsdUm`, `interCentroidPairs`, e così via. Ogni renderer riceve questo oggetto e produce il proprio output: la struttura mantiene una single source of truth e separa il calcolo dal layout.

I fogli Excel hanno intestazioni in italiano (`Cilindri`, `Coppie`, `Parametri`, `Metadati`) per coerenza con la lingua dell'interfaccia. Il Report Taratura include nomi file, data e orario in cover, come il Clinico.

## B.5 Ripristino delle pagine coppie inter-centroide

Il PDF Clinico del 22/04 prodotto dal Comparator originale aveva 16 pagine: cover, 5 pagine cilindro, 10 pagine coppie inter-centroide (combinazioni $C(5,2) = 10$). Il PDF prodotto dal modulo Misurare di Analizzare aveva invece solo 6 pagine (cover + 5 cilindri): le 10 pagine coppie erano scomparse nel passaggio dalla versione esterna `pdf-gen.js` alla funzione interna semplificata.

Il refactor ora pubblicato ripristina la parità. La funzione `misICP_renderClinicalPDF` aggiunge esplicitamente il loop sulle coppie inter-centroide:

```javascript
data.interCentroidPairs.forEach(function(ic, pi){
  doc.addPage();
  misICP_pdfDrawInterCentroidPage(doc, data, pi);
  misICP_pdfFooter(doc,
    'Syntesis-ICP - Distanza inter-centroide #'+ic.i+'-#'+ic.j,
    'Pag. '+(1+data.nCyl+pi+1)+' / '+totPages,
    false);
});
```

La funzione `misICP_pdfDrawInterCentroidPage` (riga ~4642 del file analyzer) costruisce ogni pagina coppia con: header con badge cromatico classificato per soglia `Δ` (verde <50 µm, ambra <100 µm, arancio <200 µm, rosso oltre), mappa di proiezione PCA globale dei centroidi (proiezione condivisa tra tutte le pagine per avere stessa scala), tabella distanza A vs distanza B post-ICP, riga "Δ" con valore in micrometri.

Per cinque scanbody il PDF Clinico ora ha 16 pagine; per quattro ne avrebbe 11 (cover + 4 cilindri + 6 coppie); per sei ne avrebbe 22 (cover + 6 cilindri + 15 coppie). La formula `1 + N + N·(N-1)/2` cresce in modo quadratico col numero di scanbody.

## B.6 Lezione operativa: working copy non pushata

Il sintomo iniziale era che il PDF prodotto dall'Analyzer fosse parziale (6 pagine invece di 16). L'ipotesi naturale era un bug nella funzione di generazione. La verifica ha mostrato invece che il codice corretto era già scritto nel file locale ma non pushato su `main`: il file su GitHub aveva 2.467 MB e 0 occorrenze del pattern `interCentroidPairs`, mentre la copia locale aveva 2.498 MB e 30 occorrenze. La differenza, 31 KB, è esattamente l'intera implementazione multi-report.

La lezione è prosaica ma utile: prima di sviluppare di nuovo qualcosa che sembra mancare, confrontare la working copy locale con il branch remoto. In sessioni lunghe distribuite su più giorni, è facile che codice già scritto non sia mai uscito dalla sandbox di sviluppo. Il diff tra `wc -c file_locale.html` e il valore restituito da GitHub raw è il primo controllo da fare.

## B.7 Stato del sistema

Live URLs attivi: `https://syntesis-icp-production.up.railway.app/`, `https://app.syntesis-icp.com/` (CNAME register.it). Endpoint Python: `/`, `/analizzare`, `/api/analyze`, `/api/report/{id}`, `/api/leaderboard`, `/api/analyze-public`, `/api/health`. Modulo unificato in `backend/static/syntesis-analyzer-v3b.html` (12 249 righe, 2.499 MB).

Il file `syntesis-analyzer-v3b.html` ora coincide tra working copy e produzione: nessuna divergenza pendente.

## B.8 Pendenze rimandate

- Affinamento dei tre nuovi report (Taratura, Analisi, Excel) sulla base del feedback reale di Francesco dopo i primi utilizzi clinici. Una v7.3.9.002 può intervenire su layout, contenuti, ordinamento dei fogli Excel.
- DS1 cap-clustering DBSCAN: prototipo validato 6/6 e 5/5 sui casi di test, integrazione invasiva rimandata.
- Filtro Upper passo 2 (5→4 candidati): rimandato.
- DNS register.it CNAME `app.syntesis-icp.com`: rimandato (Francesco "importa poco ora").

---

*Fine appendice B — v7.3.9.001 deploy SUCCESS commit 5111c84e — Sezione redatta da Claude il pomeriggio del 2026-04-25*
