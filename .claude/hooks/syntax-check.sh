#!/bin/bash
# syntax-check.sh
# PostToolUse su Write|Edit|MultiEdit.
# Dopo ogni modifica valida la sintassi:
#  - .py  -> python -m py_compile
#  - .html-> estrae i blocchi <script> e li passa a node --check
# PostToolUse NON puo' annullare l'edit (e' gia' avvenuto), ma se qualcosa e'
# rotto scrive su stderr e Code lo riceve come feedback per correggere subito.
# Usiamo exit 2 per dare il segnale piu' forte possibile a Code.

PY=$(command -v python3 || command -v python)

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  *.py)
    # Serve python(3). Se non c'e', non bloccare (avvisa soltanto), coerente col ramo HTML/node.
    if [ -z "$PY" ]; then
      echo "Nota: python/python3 non disponibili, salto il check Python di '$FILE_PATH'." >&2
      exit 0
    fi
    if ! ERR=$("$PY" -m py_compile "$FILE_PATH" 2>&1); then
      echo "SINTASSI PYTHON ROTTA in '$FILE_PATH':" >&2
      echo "$ERR" >&2
      echo "Correggi prima di proseguire o committare." >&2
      exit 2
    fi
    ;;
  *.html)
    # Serve node. Se non c'e', non bloccare (avvisa soltanto).
    if ! command -v node >/dev/null 2>&1; then
      echo "Nota: node non disponibile, salto il check JS di '$FILE_PATH'." >&2
      exit 0
    fi
    # Estrae il contenuto di tutti i blocchi <script> ... </script> in un file
    # temporaneo e lo passa a node --check. Estrazione semplice riga-based.
    TMP=$(mktemp /tmp/synt-script-XXXXXX.js)
    awk '
      /<script[^>]*>/ { inscript=1; sub(/.*<script[^>]*>/, ""); }
      inscript {
        if ($0 ~ /<\/script>/) { sub(/<\/script>.*/, ""); print; inscript=0; }
        else { print }
      }
    ' "$FILE_PATH" > "$TMP"

    if [ -s "$TMP" ]; then
      if ! ERR=$(node --check "$TMP" 2>&1); then
        echo "SINTASSI JS ROTTA nei blocchi <script> di '$FILE_PATH':" >&2
        echo "$ERR" >&2
        echo "Nota: i numeri di riga si riferiscono al JS estratto, non al file HTML. Correggi prima di proseguire o committare." >&2
        rm -f "$TMP"
        exit 2
      fi
    fi
    rm -f "$TMP"
    ;;
esac

exit 0
