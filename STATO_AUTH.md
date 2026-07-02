# STATO_AUTH — Flusso registrazione → autorizzazione (handoff per Claude Code)

Data: 28 maggio 2026
Sessione precedente: Claude chat (web). Questo file passa il lavoro a Claude Code.

Repo: `ABC-CADCAM-Ordini/syntesis-icp`, branch `main`, cartella `backend/`.
Backend live: https://app.syntesis-icp.com (Railway, versione attuale 8.3.x, health 200).

---

## CONTESTO: cosa stiamo costruendo

Nuovo modello di accesso a Syntesis-ICP, che sostituisce il vecchio "registrazione con
chiave di licenza obbligatoria fornita dall'utente". Il nuovo flusso:

1. Chiunque si registra liberamente (nome, email, password, CITTÀ e CELLULARE obbligatori,
   organizzazione opzionale). NESSUNA chiave richiesta in registrazione.
2. L'utente nasce in stato PENDING (`active = FALSE`, `license_key = NULL`) e accede solo
   a un pannello provvisorio di attesa.
3. Un AMMINISTRATORE vede i registrati in un pannello admin e li autorizza. L'autorizzazione
   GENERA una chiave `SICP-XXXX-XXXX-XXXX`, la associa all'utente e mette `active = TRUE`.
4. La chiave viene mostrata all'utente nel suo pannello provvisorio (polling). SOLO a schermo,
   nessuna email automatica (decisione presa).
5. Con la chiave attiva l'utente accede ai servizi (`/vedere` e analisi). Senza, no.

La colonna "utilizzo" nel pannello admin = NUMERO DI ANALISI svolte (dato reale già in DB),
NON ore d'uso (le ore d'uso non sono tracciate e non si è voluto inventarle).

---

## FATTO E VERIFICATO IN PRODUZIONE (passi 1-3 + bootstrap admin)

### Passo 1 — database.py (commit ~30cd8fb1)
Aggiunte alla tabella `users` (idempotenti, IF NOT EXISTS, NON distruttive):
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS city        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0;
```
Nuove funzioni in database.py:
- `create_user_pending(email, name, password_hash, salt, organization, city, phone)` → user_id
  (crea utente active=FALSE, license_key=NULL)
- `touch_login(user_id)` (aggiorna last_login, incrementa login_count)
- `list_all_users()` → lista dict con metriche, include `analyses_count` via LEFT JOIN
  (NB: NON usare la vecchia `count_user_analyses` in loop, già fa N+1)
- `authorize_user(user_id)` → genera+associa chiave SICP, active=TRUE, ritorna la chiave
  (idempotente: se ha già licenza la restituisce)
- `revoke_user(user_id)` → disattiva licenza, scollega, active=FALSE
ATTENZIONE: esisteva già `count_user_analyses(user_id, archived=False)`. Era stato creato
un duplicato per errore, poi RIMOSSO. Resta solo l'originale. Non re-introdurre duplicati.

### Passo 2 — admin.py NUOVO + main.py (commit ~fd4e4aa8)
Nuovo file `backend/admin.py` con router montato in main.py:
```python
from admin import router as admin_router
app.include_router(admin_router, prefix="/admin")
```
Endpoint (protetti da `require_admin`, role == 'admin'):
- `GET  /admin/users`               → {users:[...]} con created_at/last_login in ISO
- `POST /admin/users/{id}/authorize`→ {user_id, license_key}
- `POST /admin/users/{id}/revoke`   → {user_id, revoked:true}
Verificato: senza token danno 403. Con token admin funzionano.
NB: l'endpoint temporaneo `/admin/bootstrap-admin` è stato AGGIUNTO e poi RIMOSSO
(commit 439fc90e). Non deve esistere più. La var Railway BOOTSTRAP_ADMIN_SECRET è stata
cancellata. Se ricompare, è un errore: va tolto.

### Passo 3 — auth.py (commit ~0dc5e3ad)
- `RegisterRequest`: rimosso `license_key`, aggiunti `city` e `phone` (obbligatori).
- `register`: crea utente pending via `create_user_pending`. Niente verifica licenza.
  Validazioni: password >= 8, city e phone non vuoti, email non duplicata.
  Risolto anche un bug preesistente (riferimento a `new_user_id`/`email` non definiti
  nel blocco reconcile_pending_shared_invites).
- `login`: RIMOSSO il 403 "account disabilitato" sui non-attivi (i pending devono entrare).
  Aggiunto `touch_login`. Risposta arricchita con active, license_key, city, phone.
- `/auth/me`: ora RILEGGE l'utente dal DB e ritorna {user:{...active, license_key...}}.
  Serve al polling del pannello di attesa per rilevare l'autorizzazione.
- Aggiunta dipendenza `require_authorized` (admin o licenza attiva) — DEFINITA ma NON
  ancora applicata a nessun endpoint. Serve per il passo 4.
Verificato in produzione: registrazione senza licenza OK (utente pending),
login pending = 200 (non 403), /auth/me ritorna stato aggiornato.

### Account admin
`biaggini.francesco@gmail.com` è `role=admin`, `active=TRUE`. Promozione permanente in DB.
NB DI SICUREZZA: la password usata in fase di setup è transitata in chat. Va CAMBIATA.

### Utente di test da rimuovere
`claude-test-1780000812@syntesis-test.invalid` — pending, innocuo. Da cancellare quando
ci sarà un endpoint admin di delete utente (oggi non esiste; cancellazione = operazione
delicata, valutare cascata su analyses/projects con ON DELETE).

---

## DA FARE (passi 4-5)

### Passo 4 — Gate sui servizi (NON ancora fatto)
Applicare `require_authorized` (già definita in auth.py) agli endpoint che erogano servizi,
sostituendo `Depends(verify_token)` con `Depends(require_authorized)` dove appropriato.
Endpoint candidati (verificare in main.py/auth.py): `/api/analyze`, `/api/me/analyses`,
`/api/me/projects`, ecc. ATTENZIONE: NON bloccare gli endpoint che servono il pannello di
attesa (es. `/auth/me`) né quelli admin. `/api/analyze-public` valutare se lasciare aperto.
Per la PAGINA `/vedere` (HTML): gate forte lato server è complesso (una GET di pagina non
porta il token). Decisione presa: il gate forte sta sugli endpoint DATI; la pagina può
caricarsi ma senza token autorizzato non ottiene dati. Rivalutare se serve di più.

### Passo 5 — Frontend (NON ancora fatto)
Il form di registrazione live è ANCORA il vecchio: chiede la chiave di licenza (vedi
screenshot utente). Va sostituito col nuovo pannello a 3 stati. I file pronti (prodotti
nella sessione chat, da recuperare e portare nel repo):
- `syntesis-auth-3states.html` — login + registrazione SENZA licenza + pannello attesa
  (polling /auth/me ogni 15s) + pannello autorizzato (mostra chiave, bottone entra /vedere).
  Ha una devbar DEMO in basso a sinistra DA RIMUOVERE in produzione.
- `syntesis-admin.html` — pannello admin: tabella registrati, ricerca per nome/città,
  ordina per cognome/città/utilizzo/data, colonne accessi/ultimo accesso/utilizzo(=analisi),
  azioni Autorizza (mostra chiave generata) e Revoca. Anche qui devbar DEMO da rimuovere.
  Punta agli endpoint reali /admin/users, /authorize, /revoke.
Il frontend dell'app è EMBEDDED in main.py come gzip+base64 (`_HTML_B64`). Ogni modifica al
frontend richiede: aggiornare l'HTML → gzip → base64 → sostituire `_HTML_B64`. Verificare
nel repo come è gestito oggi (il file vero potrebbe essere in backend/static/ o nel bundle).
Allineare il redirect post-login: il pannello manda a `/vedere#access_token=...`; verificare
come la pagina Vedere legge il token e adeguare.

---

## NOTE INFRASTRUTTURA (Railway)

- Project ID: 204e60f5-2f71-4138-ac94-cf4f8a4dff5b
- Environment (production): f944a213-371c-4377-9d4f-9c3eb2da3fb2
- Service BACKEND: b7671e12-545a-428e-9c2b-542916e8eff6
- Service postgres: d29be03b-2691-446e-b4ff-d69548ecce49
- Domini: app.syntesis-icp.com (custom, OK), syntesis-icp-production.up.railway.app (BACKEND),
  syntesis-icp-production-40e1.up.railway.app (LEGACY/staticUrl del service 'syntesis-icp')
- Deploy: `serviceInstanceDeploy(serviceId, environmentId, latestCommit:true)`.
  MAI `serviceInstanceRedeploy` per modifiche al codice. GraphQL richiede header
  `User-Agent: Mozilla/5.0`.
- GitHub: update file = GET per SHA poi PUT. File > 1MB richiedono Git Blobs API.

## DOMINIO custom (risolto oggi)
app.syntesis-icp.com dava 503: era il custom domain bloccato in stato "issuing".
Risolto ricreando il binding sul service BACKEND. Ora 200, cert valido.
NB: la ricreazione ha cambiato il CNAME target da `tqxxdh7s` a `ojl727lw.up.railway.app`.
Il DNS su Register.it punta ancora al vecchio target ma funziona (cert wildcard). Per
robustezza, aggiornare il CNAME su Register.it al nuovo valore quando possibile.

## APEX syntesis-icp.com (da fare, deciso ma non eseguito)
Far rispondere syntesis-icp.com (dominio nudo) con la pagina di login. Strada scelta:
REDIRECT 301 da pannello Register.it (Dominio & DNS → Redirect e sottodomini) verso
https://app.syntesis-icp.com. NON praticabile servire l'app sull'apex via CNAME (apex +
MX della posta lo vietano). Azione manuale di Francesco sul pannello Register.it.

## Login Google
NON operativo: il backend risponde "Google login non configurato sul server."
(`GOOGLE_CLIENT_ID` vuoto o flusso non cablato). I bottoni Google sono stati TOLTI dal
pannello. Riattivare solo se/quando si configura il client OAuth. Bassa priorità.

---

## 8.78.0 (2026-07-02) — Pacchetto sicurezza pre-lancio: rollout gate COMPLETO + audit C1/C4

1. **Gate client completo**: `syn-gate.js` ora incluso anche in `/vedere` e `/dashboard`
   (prima solo `/analizzare`). Chiuso il sospeso "Gate accesso — completamento rollout"
   del 2026-05-29. `/accedi` pubblica, `/gestione` protetta in pagina. La sicurezza vera
   resta server-side (`auth.py:require_authorized`).
2. **`/api/analyze-public` RIMOSSO** (bypassava il gate 8.4.0; zero chiamanti frontend).
   Con lui: apparato SlowAPI (rate-limit per-IP, serviva solo lì) + `backend/rate_limit.py`.
   Il rate-limit per-utente (`check_rate_limit`) resta. NB: dipendenza `slowapi` ancora in
   requirements.txt (rimozione = build change, rinviata a un passo dedicato).
3. **Audit C1 CHIUSO — JWT fuori dalla query string**: `/auth/gdrive/connect?token=<JWT>`
   (finiva in access log/history/Referer) sostituito da codice one-time: il frontend fa
   `POST /auth/gdrive/connect-init` (Bearer) → `{code}` (TTL 120s, single-use, store
   in-memory per-processo) → naviga `/auth/gdrive/connect?c=<code>`. Su restart tra init
   e redirect il codice si perde → 401 con messaggio, l'utente riprova (fail-closed).
4. **Audit C4 CHIUSO — access-token Google mai al browser**: rimosso
   `GET /api/me/gdrive/access-token` (v7.3.9.079); `fetchDriveFile` della dashboard passa
   dal proxy `GET /api/me/gdrive/file/{id}/content` (Bearer nostro, cap anti-DoS
   `MAX_DRIVE_PROXY_BYTES` 100MB — audit C3). Trade-off accettato: i bytes Drive tornano
   a passare dal server (sicurezza > banda).
5. Bonus: rimosso commento stantio "/lab endpoint PUBBLICO" in main.py (l'endpoint reale
   `/api/place-mua-lab` è `require_authorized` da 8.4.0 — il commento fuorviava gli audit).

**Da collaudare live dopo il deploy**: login → /vedere e /dashboard raggiungibili;
anonimo → redirect /accedi con ritorno deep-link; pannello Cloud → "Connetti Drive"
(flusso one-time) e un'anteprima file (proxy).
