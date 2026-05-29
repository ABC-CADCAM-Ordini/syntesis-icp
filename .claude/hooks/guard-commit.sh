#!/bin/bash
# guard-commit.sh
# PreToolUse su Bash.
# Due controlli:
#  1) blocca comandi git distruttivi (push forzato, reset hard su remoto, ecc.)
#  2) prima di un commit, blocca se sono in stage file pesanti o STL/binari grossi
# Exit 2 = blocca; messaggio su stderr torna a Code.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# --- 1) comandi git pericolosi ---
if echo "$COMMAND" | grep -qE 'git +push.*(--force|-f)\b|git +reset +--hard|git +clean +-[a-z]*f'; then
  echo "BLOCCATO: comando git potenzialmente distruttivo ('$COMMAND'). Force push / reset hard / clean forzato non sono consentiti senza conferma esplicita dell'utente." >&2
  exit 2
fi

# --- 2) commit con file pesanti in stage ---
# Scatta solo se il comando e' un git commit.
if echo "$COMMAND" | grep -qE 'git +commit'; then
  # Soglia in byte (qui 5 MB). Il monolite HTML legittimo puo' essere grande,
  # quindi NON blocchiamo .html; blocchiamo binari/STL pesanti finiti per sbaglio.
  THRESHOLD=$((5 * 1024 * 1024))
  BIG_FILES=""
  # File in stage (added/modified/copied)
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    # Salta gli HTML: il monolite e' una scelta legittima.
    case "$f" in
      *.html) continue ;;
    esac
    if [ -f "$f" ]; then
      SIZE=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
      if [ -n "$SIZE" ] && [ "$SIZE" -gt "$THRESHOLD" ]; then
        BIG_FILES="$BIG_FILES\n  - $f ($((SIZE / 1024 / 1024)) MB)"
      fi
    fi
  done < <(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)

  if [ -n "$BIG_FILES" ]; then
    echo -e "BLOCCATO: il commit include file non-HTML oltre 5 MB:$BIG_FILES\nProbabile STL pesante o binario finito in stage per sbaglio. Rimuovili dallo stage (git restore --staged <file>) o aggiungili a .gitignore prima di committare." >&2
    exit 2
  fi
fi

exit 0
