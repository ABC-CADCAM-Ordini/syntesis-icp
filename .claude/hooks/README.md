# Hooks Syntesis-ICP

Tre gate automatici per Claude Code. Configurati in `.claude/settings.json`.

## Cosa fanno
- **protect-files.sh** (PreToolUse): blocca edit su .env, chiavi, migrazioni DB, service account.
- **guard-commit.sh** (PreToolUse/Bash): blocca git push --force / reset --hard, e commit con file non-HTML oltre 5 MB (STL/binari per sbaglio).
- **syntax-check.sh** (PostToolUse): dopo ogni edit, py_compile sui .py e node --check sui blocchi <script> degli .html. Se rotto, lo segnala a Code.

## Requisiti
- `jq` installato (verifica: `jq --version`; su macOS: `brew install jq`).
- `node` nel PATH per il check JS degli HTML (altrimenti quel check viene saltato, non blocca).
- Gli script devono essere eseguibili: `chmod +x .claude/hooks/*.sh`.

## Note
- Exit 2 = azione bloccata, il messaggio torna a Code come feedback.
- protect-files NON blocca gli .html: il monolite e' una scelta legittima.
- guard-commit salta gli .html dal controllo dimensione per lo stesso motivo.
- Le soglie e i pattern sono adattabili: apri lo script e modifica regex/THRESHOLD.
- Provali con calma: un pattern troppo largo puo' bloccare edit legittimi.
