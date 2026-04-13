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
