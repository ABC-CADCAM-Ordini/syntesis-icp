#!/bin/bash
# protect-files.sh
# PreToolUse su Write|Edit|MultiEdit.
# Blocca le modifiche a file sensibili (segreti, chiavi, migrazioni DB).
# Exit 2 = blocca l'azione; il messaggio su stderr torna a Code come feedback.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Nessun file path (es. tool che non scrive su file): non bloccare.
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Pattern di file che Code non deve mai modificare direttamente.
# Adatta questa lista alla struttura reale del repo se serve.
if echo "$FILE_PATH" | grep -qE '(^|/)\.env|(^|/)\.env\.|secrets?/|\.git/|credentials|service[_-]?account|/migrations?/|\.pem$|\.key$'; then
  echo "BLOCCATO: '$FILE_PATH' e' un file protetto (segreti, chiavi o migrazione DB). Modifica vietata dalla policy di progetto. Se serve davvero, chiedi conferma esplicita all'utente prima di procedere." >&2
  exit 2
fi

exit 0
