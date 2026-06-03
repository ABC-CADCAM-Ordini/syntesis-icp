#!/bin/bash
# syntax-check.sh
# PostToolUse su Write|Edit|MultiEdit.
# Dopo ogni modifica valida la sintassi:
#  - .py  -> python -m py_compile
#  - .html-> estrae i blocchi <script> e li passa a node --check:
#            * classici            -> CommonJS (.js)  come da sempre
#            * type="module"       -> ESM (.mjs), check separato (import/export validi)
#            * type="importmap"    -> SALTATO (e' JSON, non JS) + application/json
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
    # Estrae il contenuto dei blocchi <script> separando per tipo. Estrazione
    # semplice riga-based: i blocchi classici vanno in un .js (check CommonJS),
    # i type="module" in un .mjs (check ESM), gli importmap/json sono saltati.
    CLASSIC=$(mktemp /tmp/synt-classic-XXXXXX.js)
    MODULE=$(mktemp /tmp/synt-module-XXXXXX.mjs)
    awk -v classic="$CLASSIC" -v module="$MODULE" '
      !inscript && match($0, /<script[^>]*>/) {
        tag = substr($0, RSTART, RLENGTH);
        if (tag ~ /type="importmap"/ || tag ~ /application\/json/) { mode="skip"; }
        else if (tag ~ /type="module"/) { mode="module"; }
        else { mode="classic"; }
        inscript=1;
        sub(/.*<script[^>]*>/, "");
      }
      inscript {
        line=$0; closing=0;
        if (line ~ /<\/script>/) { sub(/<\/script>.*/, "", line); closing=1; }
        if (mode=="classic") print line >> classic;
        else if (mode=="module") print line >> module;
        if (closing) { inscript=0; mode=""; }
      }
    ' "$FILE_PATH"

    RC=0
    if [ -s "$CLASSIC" ]; then
      if ! ERR=$(node --check "$CLASSIC" 2>&1); then
        echo "SINTASSI JS ROTTA nei blocchi <script> classici di '$FILE_PATH':" >&2
        echo "$ERR" >&2
        echo "Nota: i numeri di riga si riferiscono al JS estratto, non al file HTML. Correggi prima di proseguire o committare." >&2
        RC=2
      fi
    fi
    if [ -s "$MODULE" ]; then
      if ! ERR=$(node --check "$MODULE" 2>&1); then
        echo "SINTASSI JS ROTTA nei blocchi <script type=\"module\"> di '$FILE_PATH':" >&2
        echo "$ERR" >&2
        echo "Nota: i numeri di riga si riferiscono al JS estratto, non al file HTML. Correggi prima di proseguire o committare." >&2
        RC=2
      fi
    fi
    rm -f "$CLASSIC" "$MODULE"
    if [ "$RC" -ne 0 ]; then exit "$RC"; fi
    ;;
esac

exit 0
