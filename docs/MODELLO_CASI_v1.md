# Synthesis-ICP — Modello "Casi"
## Piano di pianificazione del prodotto

> **Versione**: v1.0 — pianificazione iniziale
> **Data**: 29 aprile 2026
> **Autore**: Francesco Biaggini (decisioni strategiche) + Claude (struttura tecnica)
> **Stato**: Approvato per fase implementativa
> **Scope**: questo documento definisce la trasformazione di Synthesis-ICP da "cloud con STL" a piattaforma di tracciabilità del dialogo medico-tecnico.

---

## 0. Visione strategica

> Synthesis non conserva semplicemente file.
> Conserva **decisioni**, **versioni**, **responsabilità** e **qualità del dato**.

Questa è la frase guida del prodotto. Tutte le decisioni tecniche di questo documento devono essere coerenti con essa. Non costruiamo un'altra Dropbox per dentisti. Costruiamo l'unico sistema che capisce la **struttura del dialogo clinico** tra medico e tecnico, e ne tiene traccia.

### Differenziatore vs concorrenza

| Concorrenza | Synthesis (con modello Casi) |
|---|---|
| File piatti in cartelle | File ancorati a un Caso clinico |
| Chat separata dai file | Conversazione e file nella stessa timeline |
| "Chi ha fatto cosa?" non si sa | Ogni evento ha autore + timestamp + contesto |
| Versioning git-style (complesso) | Timeline immutabile (semplice e leggibile) |
| Modello generalista | Modello clinico (paziente, scadenza, partecipanti) |

---

## 1. Attori del sistema

### Utenti individuali
- **Medico**: dentista che invia casi clinici.
- **Tecnico di laboratorio**: persona che riceve, lavora e consegna casi.
- **Admin di organizzazione**: titolare o responsabile di Studio/Lab che ha visibilità sui casi del proprio team.

### Organizzazioni
Il modello prevede il concetto di **organizzazione** sin dal MVP. Un utente appartiene a un'organizzazione (Studio dentistico o Laboratorio). Le organizzazioni sono di due tipi:
- `studio` (organizzazione lato medico)
- `laboratorio` (organizzazione lato tecnico)

L'admin dell'organizzazione vede tutti i casi del proprio team (read-only o con permessi più ampi a seconda del ruolo).

### Decisione registrata
- Stato: **Approvato il 29 apr 2026**
- Implicazione tecnica: serve una nuova tabella `organizations` e una tabella `organization_members` con ruolo.

---

## 2. Modello "Caso"

### Definizione

Un **Caso** è l'unità minima di lavoro tra medico e laboratorio. Rappresenta un singolo intervento clinico (es. "corona dente 24, paziente Rossi"). Contiene tutti gli artefatti, i messaggi e le decisioni associate a quel lavoro.

### Campi essenziali (MVP)

| Campo | Tipo | Note |
|---|---|---|
| `id` | UUID | Identificatore unico |
| `code` | string | Codice paziente anonimo (es. "PZ-Rossi", "#247"). **Nessun nome reale**. |
| `description` | text | Descrizione testuale libera del lavoro (es. "corona dente 24, devitalizzato 6 mesi fa") |
| `status` | enum | Vedi sezione 3 |
| `due_date` | date \| null | Scadenza desiderata, informativa. Nessun alert. |
| `sender_org_id` | UUID | Organizzazione mittente |
| `sender_user_id` | UUID | Utente mittente (creatore del caso) |
| `is_imported` | boolean | True se importato (non inviato tramite Synthesis) |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `closed_at` | timestamp \| null | Quando è stato chiuso |

### Decisioni registrate
- **Identificazione paziente**: codice anonimo. Niente nome. Niente GDPR. (29 apr 2026)
- **Tipo di lavoro**: testo libero, niente lista predefinita. Si valuta strutturazione in fase 2 con dati reali. (29 apr 2026)
- **Scadenza**: data informativa, niente alert/SLA. (29 apr 2026)

---

## 3. Stati del caso

```
┌────────┐   ┌─────────┐   ┌──────────────┐   ┌───────────────────┐   ┌───────────┐   ┌───────┐
│ Bozza  │──>│ Inviato │──>│ In lavoraz. │──>│ In attesa di       │──>│ Consegnato│──>│ Chiuso│
└────────┘   └─────────┘   └──────────────┘   │ approvazione       │   └───────────┘   └───────┘
                                              └───────────────────┘
```

| Stato | Codice | Significato | Tipico autore |
|---|---|---|---|
| **Bozza** | `draft` | Sto preparando il caso, non ancora inviato. Visibile solo al mittente. | Mittente |
| **Inviato** | `sent` | Inviato al destinatario, da prendere in carico | Sistema (al click "Invia") |
| **In lavorazione** | `in_progress` | Il destinatario ha preso in carico e lavora | Destinatario |
| **In attesa di approvazione** | `pending_approval` | Lavoro pronto, attende OK del medico | Destinatario |
| **Consegnato** | `delivered` | Medico ha approvato, lavoro confermato | Mittente (medico) |
| **Chiuso** | `closed` | Caso archiviato, niente più modifiche | Chiunque dei due |

### Workflow

- **Cambio stato libero**: chiunque dei partecipanti può forzare un cambio di stato, in qualsiasi direzione.
- **Tracciamento immutabile**: ogni cambio di stato genera un evento timeline con autore, timestamp, stato precedente, stato nuovo.
- **No transizioni rigide**: il sistema non blocca transizioni "strane" (es. da `delivered` a `draft`). Lo registra. La responsabilità è dell'utente.

### Decisioni registrate
- 6 stati con `pending_approval` esplicito tra `in_progress` e `delivered`. (29 apr 2026)
- Workflow libero, sistema registra. (29 apr 2026)

---

## 4. Mittenti, destinatari e branch

### Modello "1 mittente + N destinatari"

Un caso ha **un solo mittente** (utente + organizzazione che lo ha creato). Ma può avere **N destinatari**, ciascuno con il suo stato indipendente.

#### Esempio reale

> Il Dott. Bianchi vuole un preventivo. Crea il caso `#247` e lo manda a 3 laboratori (LDP, NewAncorvis, ABC Lab). Ogni laboratorio vede il caso nei suoi "Casi ricevuti". Ognuno fa la sua proposta nella propria timeline. Il Dott. Bianchi vede 3 timeline parallele. Sceglie LDP, e il caso prosegue solo con loro. Gli altri vedono uno stato "Non assegnato".

### Schema dati

| Campo | Tipo | Note |
|---|---|---|
| `case_id` | UUID | FK al caso |
| `dest_org_id` | UUID | Organizzazione destinataria |
| `dest_user_id` | UUID \| null | Utente specifico (se nominato) |
| `branch_status` | enum | Stato di questo branch indipendente |
| `accepted_at` | timestamp \| null | Quando il destinatario ha aperto |
| `assigned` | boolean | True se il mittente ha assegnato definitivamente questo branch |

### Casi limite

- Se un solo destinatario, il branch è quello e basta. UI non mostra il concetto di "branch".
- Se più destinatari, la UI mostra un selector ("Branch: LDP / NewAncorvis / ABC").
- L'`assigned` decide quale branch è "il vero" caso quando il mittente sceglie.

### Decisione registrata
- 1 mittente, N destinatari, branch indipendenti per stato. (29 apr 2026)

---

## 5. Chi crea il caso

### Due flussi previsti

**A) Caso emesso (flusso standard)**:
1. Medico crea caso (`is_imported = false`)
2. Carica file, scrive descrizione
3. Sceglie destinatario/i e clicca "Invia"
4. Stato passa da `draft` a `sent`
5. Destinatario lo vede in "Casi ricevuti"

**B) Caso importato (flusso alternativo)**:
1. Lab riceve scan via WeTransfer/Drive/email
2. Crea caso in Synthesis (`is_imported = true`)
3. Imposta sé stesso come destinatario, mittente "esterno" (no organizzazione collegata)
4. Carica i file ricevuti, traccia il dialogo internamente
5. Il caso vive solo lato lab (il medico esterno non vede nulla)

Il flag `is_imported = true` distingue questo scenario. La UI mostrerà un badge "Importato" sul caso.

### Decisione registrata
- Entrambi i flussi previsti. (29 apr 2026)

---

## 6. Timeline immutabile (cuore del sistema)

### Principio

Ogni azione su un caso genera un **evento** registrato in modo immutabile. Niente è mai cancellato. Niente è mai modificato. La timeline è append-only.

### Tipi di evento

| `event_type` | Descrizione | Payload (jsonb) |
|---|---|---|
| `case_created` | Caso creato | `{title, code, description}` |
| `case_updated_meta` | Modificati metadata caso (descrizione, scadenza...) | `{changes: {field: [old, new]}}` |
| `file_uploaded` | File caricato | `{file_id, filename, size, mime}` |
| `file_replaced` | File sostituito da una versione più recente | `{file_id, old_drive_id, new_drive_id, motivation}` |
| `file_deleted` | File rimosso (logicamente, resta in DB) | `{file_id, filename}` |
| `case_destination_added` | Aggiunto destinatario | `{org_id, user_id}` |
| `case_destination_removed` | Rimosso destinatario | `{org_id, user_id}` |
| `case_assigned` | Mittente ha scelto un branch | `{branch_id}` |
| `status_changed` | Cambio di stato | `{from, to, reason?}` |
| `comment_added` | Commento aggiunto | `{text, mentions: [user_ids], target: "case" \| "file:UUID"}` |
| `comment_replied` | Risposta a un commento | `{parent_event_id, text, mentions}` |
| `case_opened` | Utente ha aperto il caso (primo accesso) | `{}` |
| `mention_received` | Generato quando un utente è menzionato | `{by_user_id, in_event_id}` |

### Schema dati `case_events`

| Campo | Tipo | Note |
|---|---|---|
| `id` | UUID | |
| `case_id` | UUID | FK |
| `actor_user_id` | UUID | Chi ha generato l'evento |
| `actor_org_id` | UUID | Organizzazione di appartenenza al momento |
| `event_type` | enum | Vedi tabella sopra |
| `payload` | jsonb | Dettagli specifici dell'evento |
| `parent_event_id` | UUID \| null | Per le risposte ai commenti |
| `created_at` | timestamp | Append-only, mai modificato |

### Versioning dei file

Non c'è versioning Git-style. C'è un meccanismo più semplice:

- Ogni file ha un `current_drive_id` (l'ultima versione su Drive).
- Quando un utente "carica una nuova versione" di un file con stesso nome (o esplicitamente "sostituisci"), si genera un evento `file_replaced`.
- Il `current_drive_id` punta al nuovo file.
- Il `case_events` storico mostra il vecchio `drive_id` linkato all'evento `file_uploaded` originario, **scaricabile** anche se non è più "il corrente".

Risultato: vedere "v1, v2, v3" è un'astrazione sull'UI. In DB c'è una sequenza di eventi che mostra: ho caricato file X, poi l'ho sostituito, poi ancora.

### Decisione registrata
- Timeline immutabile come cuore del modello. (29 apr 2026)

---

## 7. Commenti e menzioni

### Commenti a 2 livelli

Il MVP supporta commenti a 2 livelli:

1. **Commento al caso** (`target: "case"`): commento generale sul caso.
2. **Commento a file** (`target: "file:UUID"`): commento specifico su un file (es. "questo scan ha margini poco definiti").

I commenti **al punto 3D** (es. "qui c'è un problema, dente 24") sono **rinviati alla fase 2**. Richiedono integrazione cross-modulo con Vedere v8 e salvataggio coordinate 3D.

### Menzioni @utente

- Nel campo "scrivi commento" è possibile digitare `@` e ricevere un autocomplete dei **partecipanti del caso** (mittente, destinatari, eventuali admin di organizzazione coinvolti).
- Selezionando un utente, viene inserita la menzione sotto forma di token visivo.
- Nel payload del commento le menzioni sono salvate come array di `user_id`.
- L'utente menzionato riceve un evento `mention_received` che genera **badge nella sidebar** (no email per MVP).

### Notifiche

- **Solo badge in app**, nessuna email per MVP.
- Pallino rosso sulla sidebar accanto a "Casi ricevuti" / "Casi inviati" / ecc. quando c'è attività non letta nei casi dell'utente.
- Contatore numerico (es. "3" per 3 casi con attività nuova).
- All'apertura del caso, il pallino si svuota per quel caso.

### Decisioni registrate
- Commenti a livello caso + file (no 3D in MVP). (29 apr 2026)
- Menzioni con autocomplete partecipanti caso. (29 apr 2026)
- Notifiche solo via badge, no email per MVP. (29 apr 2026)

---

## 8. File del caso

### Tipi accettati

**Tutti i formati**. STL, OBJ, PLY, PDF, PNG, JPG, DICOM, video, qualsiasi cosa.

### Visualizzazione in-app

| Formato | In-app | Esterno |
|---|---|---|
| STL, OBJ, PLY | ✓ Vedere v8 | |
| PDF | ✓ Browser native | |
| PNG, JPG | ✓ Browser native | |
| DICOM | ✗ Solo download | App esterna (es. RadiAnt, Horos) |
| Video | ✗ Solo download | App esterna |
| Altri | ✗ Solo download | |

### Limite dimensione

**Nessun limite hard.**

> ⚠️ **Nota di trasparenza**: la mia raccomandazione tecnica era di mettere un limite (almeno warning a 100MB e 500MB). Francesco ha scelto consapevolmente di non porre limiti, "vediamo come va", assumendosi il rischio di:
> - Crash silenziosi del browser su upload molto grossi
> - Esaurimento quota Drive senza preavviso
> - Possibili costi futuri se serve elaborazione server-side
>
> La scelta è registrata qui per chiarezza retrospettiva. Decisione: **29 apr 2026**, Francesco.

In fase 2 raccomando di tracciare in DB la dimensione media/massima dei file caricati, per decidere su dati reali.

### Decisioni registrate
- Tutti i formati accettati. (29 apr 2026)
- Nessun limite, rischio assunto da Francesco. (29 apr 2026)

---

## 9. Modello dati completo (riepilogo schema)

```
table organizations
  id UUID PK, name text, type enum('studio','laboratorio'),
  created_at timestamp

table organization_members
  organization_id UUID FK, user_id UUID FK,
  role enum('owner','admin','member'),
  joined_at timestamp,
  PK (organization_id, user_id)

table cases
  id UUID PK,
  code text NOT NULL,                 -- codice paziente anonimo
  description text,                   -- testo libero
  status enum('draft','sent','in_progress','pending_approval','delivered','closed'),
  due_date date NULL,
  sender_org_id UUID FK,
  sender_user_id UUID FK,
  is_imported boolean DEFAULT false,
  created_at timestamp, updated_at timestamp, closed_at timestamp NULL

table case_destinations
  id UUID PK,
  case_id UUID FK,
  dest_org_id UUID FK,
  dest_user_id UUID FK NULL,
  branch_status enum (uguale a cases.status),
  accepted_at timestamp NULL,
  assigned boolean DEFAULT false,
  created_at timestamp

table case_files
  id UUID PK,
  case_id UUID FK,
  filename text,
  size bigint,
  mime_type text,
  drive_file_id text,                 -- ID Drive corrente
  uploaded_event_id UUID FK,          -- evento di upload originario
  superseded_at timestamp NULL,       -- se sostituito da nuova versione
  created_at timestamp

table case_events                     -- ⭐ CUORE DEL SISTEMA
  id UUID PK,
  case_id UUID FK,
  actor_user_id UUID FK,
  actor_org_id UUID FK,
  event_type text NOT NULL,           -- 'case_created', 'file_uploaded', ecc.
  payload jsonb,
  parent_event_id UUID FK NULL,       -- per risposte ai commenti
  created_at timestamp NOT NULL,
  -- INDICE: (case_id, created_at) per timeline veloce

table case_read_receipts              -- per il badge "non letto"
  user_id UUID FK,
  case_id UUID FK,
  last_seen_event_id UUID FK,
  last_seen_at timestamp,
  PK (user_id, case_id)
```

**Sintesi tabelle nuove**: 6 (organizations, organization_members, cases, case_destinations, case_files, case_events, case_read_receipts).

---

## 10. UX e sidebar definitiva

La sidebar attuale (Blocco 5s) ha 10 voci. Con il modello Casi diventa la struttura definitiva (con piccolo ritocco per allineare con i 6 stati):

```
┌─────────────────────────┐
│ WORKFLOW                │
├─────────────────────────┤
│ 📥 Casi ricevuti        │  → casi dove sei destinatario
│ 📤 Casi inviati         │  → casi dove sei mittente
│ 📝 Bozze                │  → tuoi casi in draft (non ancora inviati)
│ ⏱  In lavorazione      │  → casi attivi (in_progress)
│ ⌛ In attesa di approvaz.│  → casi in pending_approval
│ ✓  Consegnati           │  → casi in delivered
│ 🗄  Archivio (chiusi)   │  → casi in closed
├─────────────────────────┤
│ DATI                    │
├─────────────────────────┤
│ 👥 Contatti             │
│ 📈 Analisi              │
├─────────────────────────┤
│ SISTEMA                 │
├─────────────────────────┤
│ ⚙  Impostazioni         │
└─────────────────────────┘
```

> **Modifica vs Blocco 5s**: la voce "Da completare" (placeholder attuale) **diventa "Bozze"**, e l'attuale "Archivio" si sdoppia (vecchio Drive raw → diventa file dei casi; "Archivio" diventa "Casi chiusi").

### Pagina del caso

La struttura della singola pagina caso (vedi mockup nella conversazione precedente):

```
┌──────────────────────────────────────────────────────────────────┐
│ [breadcrumb] Casi inviati / #247 PZ-Rossi                        │
├──────────────────────────────────────────────────────────────────┤
│ HEADER                                                           │
│  Codice: PZ-Rossi | Stato: ⚙ In lavorazione | da: 2g            │
│  Destinatari: Lucia Verdi (LDP) ▼                                │
│  [Cambia stato] [Aggiungi messaggio] [Carica file]              │
├──────────────────────────────────┬───────────────────────────────┤
│ TIMELINE (60% width)             │ FILE CORRENTI (40% width)     │
│                                  │                               │
│ 17 apr 2026                      │ 📎 scan_arc_sup.stl    v2     │
│   ├ 14:32 Mario ha creato caso  │ 📎 scan_arc_inf.stl    v1     │
│   ├ 14:33 Mario ha caricato 3   │ 📎 note_paz.pdf        v1     │
│   │       file                   │ 📎 corona_finale.stl   v1     │
│   ├ 14:35 Mario ha aggiunto note│                               │
│   └ 14:36 Mario → Inviato       │ [+ Carica nuovo file]         │
│                                  │                               │
│ 18 apr 2026                      │                               │
│   ├ 09:18 Lucia ha commentato   │                               │
│   │       su scan_arc_sup.stl   │                               │
│   ├ 11:42 Mario ha sostituito   │                               │
│   │       scan_arc_sup (v2)     │                               │
│   └ 13:20 Lucia → In lavoraz.  │                               │
│                                  │                               │
│ 22 apr 2026                      │                               │
│   ├ 16:50 Lucia ha caricato     │                               │
│   │       corona_finale.stl     │                               │
│   └ 16:53 Lucia → Pending appr. │                               │
│                                  │                               │
│ [Scrivi un messaggio @...]       │                               │
└──────────────────────────────────┴───────────────────────────────┘
```

---

## 11. API necessarie (alto livello)

```
# Casi
POST   /api/cases                   crea nuovo caso (draft)
GET    /api/cases?filter=...        lista casi (filtrabile per stato, ruolo, ecc.)
GET    /api/cases/:id               dettaglio caso
PATCH  /api/cases/:id               modifica metadata caso
POST   /api/cases/:id/send          passa da draft a sent
POST   /api/cases/:id/status        cambia stato (libero)

# Destinazioni
POST   /api/cases/:id/destinations  aggiungi destinatario (medico → lab)
DELETE /api/cases/:id/destinations/:dest_id   rimuovi destinatario
POST   /api/cases/:id/destinations/:dest_id/assign   assegna definitivamente

# Eventi (timeline)
GET    /api/cases/:id/events        timeline (paginata, ordine cronologico)
POST   /api/cases/:id/events        aggiungi evento (commento, ecc.)
                                     server gestisce mention extraction

# File
POST   /api/cases/:id/files         carica file (multipart, va su Drive)
GET    /api/cases/:id/files         lista file correnti
GET    /api/cases/:id/files/:fid    metadata file
PUT    /api/cases/:id/files/:fid    carica nuova versione (sostituisce)
DELETE /api/cases/:id/files/:fid    elimina (logicamente)

# Read receipts (badge sidebar)
POST   /api/cases/:id/seen          marca caso come visto
GET    /api/me/unread-summary       conteggio "non letto" per ogni voce sidebar

# Organizzazioni
GET    /api/me/organizations        organizzazioni a cui appartengo
GET    /api/organizations/:id/members  membri (se admin)
POST   /api/organizations/:id/invite   invita nuovo membro
```

Stima: **circa 18-22 endpoint nuovi**.

---

## 12. Milestone implementative

### M0 — Pre-implementation (questa sessione)
- [x] Documento di pianificazione approvato
- [ ] **Decisione finale: leggere e approvare/correggere questo doc**

### M1 — Modello dati base (3-4 giorni)
- Migrazioni DB: `organizations`, `organization_members`, `cases`, `case_destinations`, `case_events`, `case_files`, `case_read_receipts`
- API CRUD base per casi (create, list, get, patch)
- API stati (cambio libero, registra evento)
- Test unitari schema

### M2 — Timeline base (3-4 giorni)
- API `case_events` (POST/GET)
- Logica append-only (mai update/delete eventi)
- Trigger automatici per `status_changed`, `case_created`
- Frontend: pagina caso con timeline read-only (lista cronologica eventi)

### M3 — File del caso (2-3 giorni)
- API upload file con generazione evento `file_uploaded`
- API sostituzione file (`file_replaced`)
- Integrazione Google Drive (cartella per caso)
- Frontend: upload, lista file correnti, link a Vedere v8 per STL

### M4 — Commenti e menzioni (3-4 giorni)
- API commenti (POST a `/api/cases/:id/events` con type `comment_added`)
- Parser menzioni server-side (estrai @ → user_id)
- Eventi `mention_received` generati automaticamente
- Frontend: campo commento con autocomplete @ partecipanti
- Frontend: rendering commenti in timeline (con menzioni evidenziate)
- Frontend: replies (commenti annidati 1 livello)

### M5 — Sidebar attiva e badge (2-3 giorni)
- API `/api/me/unread-summary` con conteggio per stato/voce sidebar
- Frontend: pallino rosso + contatore su voci sidebar
- Frontend: marca caso come "visto" all'apertura
- Filtri sidebar funzionanti (clicco "In lavorazione" → vedo solo `in_progress`)

### M6 — Organizzazioni e ruoli (3-4 giorni)
- API gestione team (invita, rimuovi, cambia ruolo)
- Permessi admin (admin di Studio vede tutti i casi del Studio)
- Frontend: pagina "Il mio team" in Impostazioni
- Onboarding "Crea o entra in organizzazione"

### M7 — Polish e testing (3-5 giorni)
- Test E2E sui flussi principali
- Edge cases (caso con 0 destinatari, branch multipli, ecc.)
- Migrazione dati esistenti (progetti attuali → diventano casi importati?)
- Documentazione utente

### Stima totale MVP
**19-27 giorni di lavoro pieno**, distribuiti su 4-6 settimane calendario considerando review, iterazioni, vacanze, imprevisti.

---

## 13. Cosa NON è in MVP (rinviato a fase 2+)

Per chiarezza, questi temi sono **esplicitamente fuori MVP**:

- ❌ **Email notifications**: solo badge in app per MVP.
- ❌ **Commenti ancorati a punti 3D**: cross-modulo Vedere↔dashboard.
- ❌ **Versioning Git-style sui file**: solo il modello "current + history" della timeline.
- ❌ **DICOM viewer in-app**: solo download.
- ❌ **Strutturazione tipo lavoro** (lista predefinita, denti FDI, materiali, colori): testo libero in MVP.
- ❌ **Alert scadenza** (mail "manca 1 giorno"): scadenza solo informativa.
- ❌ **SLA per organizzazione**: nessun calcolo automatico tempi medi.
- ❌ **Limiti dimensione file**: nessun limite (registrato come scelta consapevole, vedi §8).
- ❌ **Dati paziente reali (GDPR)**: solo codice anonimo.
- ❌ **Audit log avanzato**: la timeline copre il caso d'uso base.
- ❌ **Permessi granulari** (es. "solo questo utente vede questo file"): MVP ha permessi a livello caso, tutti i partecipanti vedono tutto.
- ❌ **Mobile-specific UX**: MVP responsive base, non app nativa.
- ❌ **Pazienti come attori**: solo medici + tecnici + admin.

---

## 14. Trade-off espliciti (chiarezza retrospettiva)

Per ogni scelta importante, registriamo qui il trade-off accettato:

| Scelta | Vantaggio | Trade-off | Mitigazione |
|---|---|---|---|
| Codice anonimo paziente | Zero GDPR | Medico deve mantenere mappa esterna codice ↔ paziente | È pratica clinica comune |
| Testo libero tipo lavoro | Veloce da implementare | No filtri/statistiche per tipo | Aggiungiamo struttura in fase 2 con dati reali |
| Stato libero (no validazione) | Massima flessibilità | Possibili stati "incoerenti" forzati | Timeline registra tutto, è auto-correttiva |
| Timeline immutabile | Tracciabilità completa | DB cresce nel tempo | Indice (case_id, created_at), partition se serve |
| 1-mittente N-destinatari | Scenario "preventivo" supportato | Modello più complesso, branch separati | Costa solo 1 tabella in più, vale lo scenario |
| Niente email | Zero costi notifiche | Utenti devono aprire dashboard per vedere | Aggiungiamo email in fase 2 (SendGrid) |
| Niente limite file | Massima libertà | Rischi di crash/quota | Decisione consapevole di Francesco (29 apr 2026) |
| No commenti 3D in MVP | Implementazione pulita | UX meno ricca | Fase 2 cross-modulo Vedere↔caso |

---

## 15. Glossario

- **Caso**: unità di lavoro clinico tra medico e tecnico.
- **Branch**: ramo di un caso verso un destinatario specifico (un caso può avere N branch).
- **Mittente**: utente/organizzazione che ha creato il caso.
- **Destinatario**: utente/organizzazione cui il caso è inviato.
- **Evento**: registrazione immutabile di un'azione sul caso (creato, file caricato, commento, ecc.).
- **Timeline**: lista cronologica degli eventi di un caso. Append-only.
- **Organizzazione**: Studio o Laboratorio (entità giuridica del team).
- **Caso importato**: caso creato lato lab senza un mittente Synthesis (es. ricevuto via WeTransfer e archiviato per tracciabilità).
- **Pending approval**: stato dove il lab consegna e attende OK del medico.
- **Closed**: stato finale di archiviazione, niente più modifiche.

---

## 16. Cronologia decisioni

Tutte le decisioni di questo documento sono state prese il **29 aprile 2026** in una sessione di pianificazione tra Francesco Biaggini (decisioni strategiche) e Claude (struttura tecnica).

Modifiche successive a questo documento devono essere annotate qui sotto con data e autore.

```
2026-04-29 v1.0 - Documento iniziale, tutte le decisioni di Blocco 1-4
```

---

## 17. Prossimi passi

1. **Francesco**: legge questo documento. Approva, corregge o respinge sezione per sezione.
2. **Claude**: implementa M1 (modello dati base) in una sessione dedicata, dopo approvazione del doc.
3. **Francesco**: testa M1 con scenari reali prima di passare a M2.
4. **Iterazione**: avanziamo per milestone, una sessione per milestone.

> **Frase di chiusura**:
> Il valore di Synthesis non è la quantità di file che conserva, ma la qualità della tracciabilità che garantisce. La timeline immutabile è l'oggetto tecnico che rende vera questa promessa.
