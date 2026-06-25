---
name: syntesis-deploy
description: Deploy Syntesis-ICP to both Railway services (LEGACY + BACKEND) with coordinated version bump, dual git push, deployment polling, and live verification on production domains. Use this skill whenever the user wants to release Syntesis-ICP - phrases like "deploya", "rilascia 8.1.x", "pubblica", "vai live", "manda in produzione", "deploy entrambi i servizi", "/syntesis-deploy", or finishing a block of substantive code changes in the syntesis-icp repo and signaling they want to ship them - even if they do not explicitly invoke the slash command. Also trigger when the user asks to bump version coordinated with a Railway release. Do NOT trigger for local dev server starts, git commit/push without deploy intent, deploy history questions, or one-off Railway operations unrelated to the standard release flow (shutting down a service, reading logs).
---

# Syntesis-deploy

Rilascio di Syntesis-ICP sui due servizi Railway paralleli (LEGACY + BACKEND). Codifica [CLAUDE.md §9 Deploy](../../../CLAUDE.md) - se questa skill diverge dal documento, vince il documento.

## Invocazione

- `/syntesis-deploy` (interattivo): chiede versione target e oggetto commit dopo aver letto lo stato repo.
- `/syntesis-deploy 8.1.9-A.5.2 "A.5.2 SOSTITUIRE_TEMPLATE_INFO + TPL_ORDER"` (espliciti): salta le domande iniziali.
- `/syntesis-deploy --redeploy`: rilancio Railway sull'ultimo commit senza tocchi al codice (no bump, no commit, va diretto a `serviceInstanceDeploy`).

## Flusso (8 passi)

1. **Stato repo**: rileva `clean` / `uncommitted` / `committed-not-pushed` e adatta i passi successivi.
2. **Versione**: applica le 5 regole (sezione sotto) oppure usa l'argomento esplicito. Doc-only -> niente bump.
3. **Bump 4 punti**: `<title>` + `ANALIZZA_BUILD` (v3b.html), `BACKEND_VERSION`/`LAST_UPDATED`/voce History (registry.py), `ARG CACHEBUST` con timestamp nuovo (Dockerfile). Localizza SEMPRE le righe con `grep -n`, mai numeri fissi: il file v3b.html cambia di taglia a ogni modifica e i numeri di riga shiftano.
4. **Sanity**: i 3 marker versione devono coincidere fra loro; `CACHEBUST` strettamente crescente rispetto al precedente.
5. **Doc**: aggiorna `STATO_SISTEMA.md` (tabella versioni live + snapshot date) + appende entry a `docs/STORIA.md`. Salta in modalita' doc-only (la modifica E' la doc).
6. **Git**: `git add` selettivo dei file modificati + commit con stile (`FASE: cosa cambia`, <=60 char, body bullet, no `Co-Authored-By`) + `git push origin main`.
7. **Railway**: `serviceInstanceDeploy(serviceId, environmentId, latestCommit:true)` su entrambi i servizi via curl GraphQL. **Subito dopo, verifica anti-race**: `meta.commitHash` del deployment == `git rev-parse HEAD` (Railway puo' avere ancora il commit vecchio se il deploy parte troppo presto dopo il push → ri-triggera). Poi polling `deployments(first:1){status}` ogni 30s su entrambi finche' `SUCCESS` (timeout 5 min; stop&ask se >3 min in `BUILDING`/`DEPLOYING`). Skip in modalita' doc-only.
8. **Verifica live**: curl `/api/registry/constants` (`backend_version`) + `/analizzare` (grep `<title>` + `ANALIZZA_BUILD`) su entrambi i domini Railway diretti, escluso `app.syntesis-icp.com` (cert SSL pre-esistente, tracciato in STATO_SISTEMA).

## Regole versionamento

Schema canonico: `MAJOR.MINOR.BUILD-FASE.STEP` (es. `8.1.7-A.5.1`). `MAJOR.MINOR` = era prodotto (8.x = post-v3b unificato). `-FASE.STEP` = sospeso del refactor in corso, sparisce alla promozione della Fase intera.

Cinque regole per scegliere la nuova versione:

1. **Build bump nello stesso step** (modifica DENTRO lo step in corso): `8.1.7-A.5.1` -> `8.1.8-A.5.1`. Esempio: fix piccolo dentro A.5.1.
2. **Build + step bump** (chiusura step + apertura nuovo step nella stessa Fase): `8.1.8-A.5.1` -> `8.1.9-A.5.2`. Esempio: A.5.1 chiuso, parte A.5.2.
3. **Promozione fase** (chiusura Fase intera): `8.1.x-A.X.Y` -> `8.2.0`. Il suffisso sparisce, MINOR bump. Esempio: Fase A chiusa interamente -> 8.2.0.
4. **Build bump per feature non-refactor durante Fase aperta**: stesso comportamento della regola 1 (build bump, suffisso rimane). Esempio: la pagina "Lettura dei valori" aggiunta durante Fase A aperta -> bumped da `8.1.7-A.5.1` a `8.1.8-A.5.1` (commit `99573c3`).
5. **Doc-only -> NIENTE bump**: se la modifica tocca SOLO `STATO_SISTEMA.md`, `docs/`, `README.md`, commenti puri, niente codice funzionale -> commit + push, ma SALTA il deploy Railway. La versione live resta invariata.

In modalita' interattiva, presenta il diff o un riassunto delle modifiche, proponi la regola applicabile e la versione candidata, poi aspetta conferma prima di applicare i bump.

## Stato repo

Tre modalita', rilevate da `git status --porcelain` + `git log origin/main..HEAD --oneline`:

- **`clean`** (working tree pulito + nessun commit pending oltre origin): se l'utente ha invocato senza modifiche reali, rifiuta cortesemente. Suggerisci `--redeploy` se davvero vuole rilanciare Railway sull'ultimo commit.
- **`uncommitted`** (modifiche non committate): bumpa, aggiorna doc, committa, pusha, deploya.
- **`committed-not-pushed`** (commit gia' fatto ma non pushato): salta il bump (assumi sia gia' stato fatto in fase di commit), opzionalmente verifica i 3 marker versione, pusha, deploya.

In modalita' `--redeploy`: ignora completamente lo stato (non bumpa, non committa), va diretto a `serviceInstanceDeploy` sul commit corrente di `origin/main`.

## Bump 4 punti - comandi

Localizza SEMPRE le righe target con `grep -n`. Non usare numeri fissi. Il file `backend/static/syntesis-analyzer-v3b.html` cambia di taglia a ogni modifica (~3.87 MB, 19000+ righe) e i numeri shiftano.

### v3b.html - title

```bash
grep -n "<title>Syntesis-ICP - Analizzare" backend/static/syntesis-analyzer-v3b.html
```

Tipicamente verso le prime 10 righe (`<head>`). Edit sull'unica occorrenza, sostituendo la stringa `vX.Y.Z-A.B.C`.

### v3b.html - ANALIZZA_BUILD

```bash
grep -n "window.ANALIZZA_BUILD = " backend/static/syntesis-analyzer-v3b.html
grep -n "window.ANALIZZA_BUILD_DATE = " backend/static/syntesis-analyzer-v3b.html
```

Due occorrenze separate (versione e data). La riga shiftera' man mano che si aggiungono blocchi al file. Edit di entrambe.

### registry.py - BACKEND_VERSION + LAST_UPDATED + History

```bash
grep -n "^BACKEND_VERSION = " backend/registry.py
grep -n "^LAST_UPDATED = " backend/registry.py
grep -n "^# History:" backend/registry.py
```

History e' un commento in blocco sopra `BACKEND_VERSION`: appendi una nuova riga in cima alla lista (ordine cronologico inverso) con formato `#   X.Y.Z-A.B.C (YYYY-MM-DD): descrizione breve`.

### Dockerfile - CACHEBUST

```bash
grep -n "ARG CACHEBUST=" Dockerfile
```

Sostituisci il timestamp con `date +%Y%m%d%H%M%S`. Deve essere strettamente crescente rispetto al precedente.

## Sanity check coerenza

Dopo aver applicato i 4 bump, prima di committare, verifica che i 3 marker versione frontend/backend siano allineati:

```bash
NEW_VER="8.1.9-A.5.2"  # esempio
TITLE=$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+-A\.[0-9]+\.[0-9]+' backend/static/syntesis-analyzer-v3b.html | head -1)
BUILD=$(grep -oE "ANALIZZA_BUILD = '[^']+'" backend/static/syntesis-analyzer-v3b.html | head -1 | sed "s/.*= '\(.*\)'/\1/")
BACK=$(grep -oE 'BACKEND_VERSION = "[^"]+"' backend/registry.py | sed 's/.*"\(.*\)"/\1/')
echo "title=$TITLE  build=$BUILD  registry=$BACK  expected=$NEW_VER"
```

Tutti devono coincidere con `NEW_VER` (il title ha il prefisso `v`, gli altri due no). Se mismatch -> stop&ask, non proseguire al commit.

CACHEBUST: confronta con il valore del commit precedente:

```bash
OLD_CB=$(git show HEAD:Dockerfile | grep -oE 'ARG CACHEBUST=[0-9]+' | sed 's/ARG CACHEBUST=//')
NEW_CB=$(grep -oE 'ARG CACHEBUST=[0-9]+' Dockerfile | sed 's/ARG CACHEBUST=//')
[ "$NEW_CB" -gt "$OLD_CB" ] && echo "OK $OLD_CB -> $NEW_CB" || echo "FAIL: $NEW_CB non > $OLD_CB"
```

## Aggiornamento doc

### STATO_SISTEMA.md

- Riga `## Versione live (YYYY-MM-DD)` -> data odierna.
- Tabella versioni live: `Backend (registry)` e `/analizzare` con la nuova `vX.Y.Z-A.B.C`.
- Aggiungi una breve nota descrittiva della feature/fix solo se l'utente lo richiede esplicitamente (in caso contrario non sporcare il file di sospesi).
- Footer `*Snapshot YYYY-MM-DD. Aggiornare al prossimo cambio di stato.*`.

### docs/STORIA.md

Appendi una entry in cima (cronologia inversa, sotto il titolo `# Storia delle modifiche`):

```markdown
## YYYY-MM-DD — X.Y.Z-A.B.C: <oggetto del commit>

<descrizione 1-3 paragrafi: cosa fa, perche', file/righe rilevanti per future bisect>

Implementazione:
- <bullet>
- <bullet>
```

In modalita' doc-only entrambi i file restano invariati (la modifica E' la doc).

## Commit & push

### Stile commit

- **Prima riga**: `FASE: cosa cambia`, max 60 char. Esempi reali dalla history:
  - `A.5.1 bootstrap window.SYN`
  - `FEATURE: pagina Lettura dei valori nel report clinico (8.1.8-A.5.1)`
  - `[A.5.0] registry.py: aggiunta soglie angolari`
- **Body**: bullet list di cosa fa, con dettaglio righe/file rilevanti per future bisect (range di righe trovate via grep, non numeri inventati).
- **No** `Co-Authored-By`, **no** "Generated with Claude Code".
- Author: `Francesco Biaggini <biaggini.francesco@gmail.com>` (config globale, gia' impostato).

### Stage selettivo

```bash
git add backend/static/syntesis-analyzer-v3b.html backend/registry.py Dockerfile STATO_SISTEMA.md docs/STORIA.md
# + altri file specifici della feature
```

Mai `git add .` o `git add -A`: rischio di committare credenziali (`scripts/.env.local`) o file sporchi.

### Push

```bash
git push origin main
```

Se il push fallisce per `non-fast-forward` (HEAD divergente da origin): NON forzare. Fermati e mostra l'errore all'utente. Probabilmente c'e' un commit upstream non ancora pulled. La risoluzione (rebase, merge, abort) richiede decisione umana.

## Railway deploy

### Caricamento token

```bash
set -a; . scripts/.env.local; set +a
```

Il file e' gitignored (verifica con `git check-ignore -v scripts/.env.local`). Contiene `RW_TOKEN`, `RW_PROJECT_ID`, `RW_ENV_ID`, `RW_SVC_LEGACY`, `RW_SVC_BACKEND`, `RW_GQL`. Se non esiste, chiedi all'utente i token e crea il file (chmod 600), aggiorna il pattern senza loggare il valore.

### Mutation per entrambi i servizi

> **Nota shell compat (caso noto, primo emerso nel deploy di A.5.2 il 2026-05-06)**: lo shell di default su macOS e' `zsh`, non `bash`. La sintassi `${!var}` (bash indirect expansion) **non funziona in zsh** e fallisce con `bad substitution`. Per iterare sui due service ID o leggere variabili indirettamente, usare uno di questi pattern compatibili: (a) due blocchi espliciti (preferito, piu' leggibile - vedi sotto); (b) `eval "echo \$$var"` per dereferenziare in modo cross-shell; (c) leggere direttamente i valori da `scripts/.env.local` via `grep -E '^RW_SVC_' scripts/.env.local | sed 's/.*=//'`. Stessa avvertenza vale per qualunque altro pattern bash-only nei loop di polling/verify.

Lancia in successione (non in parallelo, per leggibilita' degli output):

```bash
echo ">>> deploying LEGACY"
curl -sS -H "Authorization: Bearer $RW_TOKEN" -H "Content-Type: application/json" \
  -X POST "$RW_GQL" \
  -d "{\"query\":\"mutation{serviceInstanceDeploy(serviceId:\\\"$RW_SVC_LEGACY\\\",environmentId:\\\"$RW_ENV_ID\\\",latestCommit:true)}\"}"
echo
echo ">>> deploying BACKEND"
curl -sS -H "Authorization: Bearer $RW_TOKEN" -H "Content-Type: application/json" \
  -X POST "$RW_GQL" \
  -d "{\"query\":\"mutation{serviceInstanceDeploy(serviceId:\\\"$RW_SVC_BACKEND\\\",environmentId:\\\"$RW_ENV_ID\\\",latestCommit:true)}\"}"
echo
```

Risposta attesa per ogni servizio: `{"data":{"serviceInstanceDeploy":true}}`.

### Verifica commit (anti-race) — OBBLIGATORIO prima del polling

> **Gotcha (rilascio 8.70.0, 2026-06-25)**: `serviceInstanceDeploy(latestCommit:true)` lanciato
> SUBITO dopo `git push` puo' prendere il commit **PRECEDENTE** — Railway impiega qualche secondo a
> sincronizzare il nuovo commit da GitHub, e `latestCommit:true` risolve al commit che Railway conosce
> in quel momento. Sintomo: il deploy va a `SUCCESS` ma la **verifica live mostra la versione VECCHIA**
> (e NON e' cache: resta vecchia anche dopo minuti). Vedi memoria [[railway-deploy-build-hang]].

Dopo OGNI `serviceInstanceDeploy`, **prima del polling status**, verifica che il deployment punti al
commit appena pushato (`meta.commitHash` == `git rev-parse HEAD`):

```bash
sleep 8   # lascia sincronizzare il deployment appena creato
HEAD=$(git rev-parse HEAD)
check_commit(){
  curl -sS -H "Authorization: Bearer $RW_TOKEN" -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" \
    -X POST "$RW_GQL" \
    -d "{\"query\":\"query{deployments(first:1,input:{serviceId:\\\"$1\\\",environmentId:\\\"$RW_ENV_ID\\\"}){edges{node{status meta}}}}\"}" \
    | python3 -c "import sys,json; n=json.load(sys.stdin)['data']['deployments']['edges'][0]['node']; m=n.get('meta') or {}; print(n['status'], (m.get('commitHash') or '')[:40])"
}
for SVC in "$RW_SVC_LEGACY" "$RW_SVC_BACKEND"; do
  read ST CH <<< "$(check_commit "$SVC")"
  if [ "$CH" = "$HEAD" ]; then echo "OK $SVC -> $ST commit=$CH"; \
  else echo "MISMATCH $SVC: deployment su $CH ma HEAD=$HEAD -> RI-TRIGGERA serviceInstanceDeploy(latestCommit:true) e ri-verifica"; fi
done
```

Se MISMATCH: ri-lancia `serviceInstanceDeploy(latestCommit:true)` su quel servizio (ora il commit e'
sincronizzato), aspetta `sleep 8`, ri-verifica il commit. Procedi al polling SOLO quando
`meta.commitHash == HEAD` su entrambi. Lo status `SUCCESS` da solo NON basta: deve essere SUCCESS **del
commit giusto**.

### Polling

Polling ogni 30s su entrambi i servizi. Status terminali: `SUCCESS` (ok) / `FAILED` / `CRASHED` (fail). Stati intermedi: `INITIALIZING`, `BUILDING`, `DEPLOYING`. Timeout 5 minuti totali. Stop&ask se >3 minuti in `BUILDING`/`DEPLOYING`.

```bash
poll_status(){
  curl -sS -H "Authorization: Bearer $RW_TOKEN" -H "Content-Type: application/json" \
    -X POST "$RW_GQL" \
    -d "{\"query\":\"query{deployments(first:1,input:{serviceId:\\\"$1\\\",environmentId:\\\"$RW_ENV_ID\\\"}){edges{node{status}}}}\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['deployments']['edges'][0]['node']['status'])"
}
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 30
  L=$(poll_status "$RW_SVC_LEGACY")
  B=$(poll_status "$RW_SVC_BACKEND")
  echo "[${i}x30s] LEGACY=$L  BACKEND=$B"
  [ "$L" = "SUCCESS" ] && [ "$B" = "SUCCESS" ] && { echo "BOTH SUCCESS"; break; }
  case "$L$B" in *FAILED*|*CRASHED*) echo "FAILURE - stop&ask"; break;; esac
done
```

## Verifica live

Tre target: due domini Railway diretti + `app.syntesis-icp.com`. Quest'ultimo ha cert SSL pre-esistente non legato al deploy (cfr. STATO_SISTEMA, sospesi alta priorita'): se fallisce con `SSL: no alternative certificate subject name`, non e' una regressione del deploy - segnala soltanto, non bloccare.

```bash
NEW_VER="8.1.9-A.5.2"  # esempio, sostituire con la versione effettivamente deployata
DOMAINS=(
  "syntesis-icp-production.up.railway.app"
  "syntesis-icp-production-40e1.up.railway.app"
)
for D in "${DOMAINS[@]}"; do
  echo "===== $D ====="
  V=$(curl -sS --max-time 15 "https://$D/api/registry/constants" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('backend_version'))" 2>/dev/null)
  T=$(curl -sS --max-time 15 "https://$D/analizzare" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+-A\.[0-9]+\.[0-9]+' | head -1)
  echo "  backend_version: $V"
  echo "  title build:     $T"
  if [ "$V" = "$NEW_VER" ] && [ "$T" = "v$NEW_VER" ]; then
    echo "  OK"
  else
    echo "  MISMATCH (expected $NEW_VER) - retry tra 30s"
  fi
done
```

Su mismatch: aspetta 30s e ritenta una volta (probabile cache CDN/edge). Se ancora mismatch dopo il retry -> stop&ask.

## Modalita' --redeploy

Salta tutto fino al passo 7. Va diretto a `serviceInstanceDeploy(latestCommit:true)` su entrambi, polling, verifica live (con la versione attuale gia' presente in registry, non con `NEW_VER`). Caso d'uso: Railway e' tornato online dopo un incident, vuoi rilanciare il deploy sull'ultimo commit senza modifiche di codice.

```bash
NEW_VER=$(grep -oE 'BACKEND_VERSION = "[^"]+"' backend/registry.py | sed 's/.*"\(.*\)"/\1/')
echo "Re-deploying current main on Railway: $NEW_VER"
# poi: load env -> mutation x2 -> polling -> verify live
```

## Failure handling

| Caso | Azione |
|---|---|
| `git push` fallisce (non-fast-forward) | Stop&ask. Mostra l'errore. NON forzare con `--force`/`--force-with-lease` salvo richiesta esplicita. |
| 1 servizio Railway `SUCCESS`, l'altro `FAILED`/`CRASHED` | Stop. Mostra logs deploy via GraphQL `deployments(){node{...}}` se disponibile. NON tentare auto-rollback. Suggerisci CLAUDE.md §9 Rollback. |
| Polling >3 min in `BUILDING`/`DEPLOYING` | Stop&ask. L'utente sceglie: continua il polling, cancella il deploy, fa rollback git. |
| Deployment `SUCCESS` ma `meta.commitHash` != `git rev-parse HEAD` (RACE post-push) | Il deploy ha preso il commit precedente (sync GitHub non pronta). **Ri-triggera** `serviceInstanceDeploy(latestCommit:true)` su quel servizio, `sleep 8`, ri-verifica il commit; procedi solo quando combacia. Vedi sezione "Verifica commit (anti-race)". |
| `verify_live` mismatch versione | PRIMA distingui: se persiste dopo 1-2 min NON e' cache -> e' la RACE commit (verifica `meta.commitHash`, vedi sopra). Se transitorio (combacia dopo 30s) era CDN/cache. Wait 30s + retry una volta; se ancora mismatch e commit giusto -> stop&ask. |
| `app.syntesis-icp.com` SSL cert error | Segnala soltanto, non bloccare. Sospeso pre-esistente, non legato al deploy. |
| `RW_TOKEN` mancante (no `scripts/.env.local`) | Chiedi all'utente, crea il file con `chmod 600`, prosegui. Non loggare il valore. |
| Sanity check versioni mismatch | Stop&ask prima del commit. Probabile bump incompleto, va sistemato. |
| `bad substitution` su `${!var}` o pattern simili | Caso noto zsh vs bash: lo shell di default su macOS e' zsh. Riscrivere con due blocchi espliciti, oppure `eval "echo \$$var"`, oppure leggere il valore via `grep`/`sed` direttamente da `scripts/.env.local`. Vedi nota a inizio sezione "Mutation per entrambi i servizi". |

## Rollback

La skill non auto-rollback. Per ripristinare una versione precedente:

1. Identifica il commit della versione validata: `git log --oneline -- backend/static/syntesis-analyzer-v3b.html`.
2. Scegli il flusso preferito: `git revert <sha>` per history pulita, oppure `git reset --hard <sha>` + `--force-with-lease` solo se l'ultimo commit non e' stato deployato.
3. Ridelpoyera con `/syntesis-deploy --redeploy`.

Vedi [CLAUDE.md §9 Rollback](../../../CLAUDE.md) per i dettagli completi.

---

## Note di mantenimento

- Quando atterreranno `scripts/deploy_railway.py` e `scripts/verify_live.py` (Sessione 0.2 della Fase 0 stabilizzazione), sostituire le sezioni Railway/Verifica con chiamate a quegli script. La logica curl GraphQL inline qui resta come riferimento.
- Se cambia lo schema versioning (promozione Fase A o introduzione Fase B), aggiornare la sezione "Regole versionamento" prima del primo deploy del nuovo schema.
- Se `app.syntesis-icp.com` viene sistemato (cert SSL risolto), aggiungerlo come terzo target nella verifica live e rimuovere la nota.
