---
name: qa-release-check
description: Use before considering a feature complete, before commit, before push, before any Railway deploy, or after a major edit to a large file. Manual checklist for Syntesis-ICP releases.
disable-model-invocation: true
---

# QA Release Check — Syntesis-ICP

Checklist da eseguire prima di dichiarare un task completo e prima di ogni
deploy. Lanciala con `/qa-release-check`. NON auto-invocata: la lancia
l'utente.

Esegui i punti in ordine. Se un punto fallisce, FERMATI, riferisci, non
proseguire ai successivi.

## 1. Pre-commit (codice)
- [ ] `python -m py_compile` passa su tutti i file Python modificati.
- [ ] Sintassi JS valida: blocchi `<script>` dei file HTML modificati estratti e
      passati a `node --check`. Vale in particolare per
      `syntesis-analyzer-v3b.html`.
- [ ] Nessun residuo di codice demo / placeholder / token hardcodato a `null` o
      a valori di prova (es. `DEMO`, `genDemoKey`, `ADMIN_TOKEN = null`).
- [ ] Nessun segreto, token, API key, nome bucket o credenziale committato.
- [ ] Nessuna `console.log` di debug lasciata nel codice di produzione.
- [ ] Nessun servizio o componente duplicato introdotto.
- [ ] Nessun edit collaterale non richiesto (refactor, pulizie, dead code
      removal) mescolato a un cambiamento funzionale.

## 2. Versioning
- [ ] `registry.py` bumpato secondo semver: feature retrocompatibile = MINOR,
      bugfix = PATCH.
- [ ] Il bump di versione e' incluso nello stesso commit della feature.

## 3. Stati di autorizzazione
- [ ] Endpoint operativi / di prodotto: protetti lato server.
- [ ] Gestione account e lettura del proprio stato (profilo, cambio password,
      lettura ruolo): accessibili ai pending.
- [ ] I pannelli e i flussi usati dai pending chiamano solo endpoint NON
      protetti; un pending resta confinato alla vista "in attesa" senza errori.
- [ ] Il gating e' lato server, non solo lato client.

## 4. Stati della UI (sui file toccati)
- [ ] Stati di errore gestiti (incluso 401/403 senza rompere la UI).
- [ ] Stati di caricamento gestiti.
- [ ] Stati vuoti gestiti.
- [ ] Azioni distruttive (elimina, sovrascrivi, revoca) richiedono conferma.

## 5. Diff prima del deploy
- [ ] Diff completo mostrato all'utente e confermato.
- [ ] Conferma esplicita dell'utente a procedere con commit + push + deploy.

## 6. Deploy (Railway)
- [ ] ID dei servizi VERIFICATI su Railway adesso, non presi dalla memoria o da
      un handoff. Elencati e mostrati all'utente prima del deploy.
- [ ] Tutti i servizi che servono il backend identificati (principale + legacy +
      eventuali altri). Non assumere un numero fisso.
- [ ] Commit unico + push su `main` completati; il commit e' effettivamente su
      `main`.
- [ ] Deploy con `serviceInstanceDeploy latestCommit: true`. MAI
      `serviceInstanceRedeploy` per cambi di codice.
- [ ] Header `User-Agent: Mozilla/5.0` presente sulle chiamate GraphQL Railway.

## 7. Verifica live (per OGNI servizio deployato)
Esegui dopo il deploy del primo servizio. Solo se TUTTO passa, procedi al
servizio successivo.

- [ ] `curl -sL` (flag `-L` obbligatorio) sull'endpoint di versione: risponde il
      numero di versione atteso. `SUCCESS` su Railway non basta, serve la
      risposta HTTP reale.
- [ ] Le route attese (es. `/accedi`, `/gestione`) rispondono 200.
- [ ] Comportamento di gating: un utente pending riceve 403 su un endpoint
      protetto.

Se il primo servizio fallisce un check: FERMATI, riferisci, non deployare gli
altri.

## 8. Casi CAD/mesh (se la feature tocca STL/ICP/misura)
- [ ] Testata con file piccolo, file grande, file non valido, formato sbagliato.
- [ ] Nessuna trasformazione visiva applicata silenziosamente al dato di misura:
      geometria importata, trasformata, visualizzata, misurata ed esportata
      restano distinte.
- [ ] Unita' di misura coerenti (default mm salvo metadata che provi altro).
