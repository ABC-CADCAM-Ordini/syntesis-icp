#!/usr/bin/env bash
# run_all.sh — Fase 7: UN comando = tutti i gate di equivalenza + i check strutturali.
# Verde = niente si e' rotto, sicuro deployare. Rosso = qualcosa e' cambiato, guarda l'output.
# Entra nella checklist di rilascio (CLAUDE.md §11) al posto di lanciare i gate a mano.
#
#   bash scripts/gate/run_all.sh
#
# Zero tooling oltre python3 + node. Rigenera prima le fixtures STL (binari gitignored,
# necessari a fixtures/gate e al golden-master ICP). NON tocca il codice, non fa deploy.
# NB: il gate storico scripts/gate/clip/ e' escluso: e' un harness A/B pre-estrazione
# (node gate.mjs <old|new>) che confronta il monolite PRIMA dell'estrazione, non piu' eseguibile.
set -uo pipefail
cd "$(dirname "$0")/../.."   # -> repo root

FAIL=0
GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
OUT=$(mktemp)
pass(){ printf "  ${GREEN}OK${RST}  %s\n" "$1"; }
failx(){ printf "  ${RED}FAIL  %s${RST}\n" "$1"; FAIL=$((FAIL+1)); sed 's/^/        /' "$OUT" | tail -6; }
run(){ local label="$1"; shift; if "$@" >"$OUT" 2>&1; then pass "$label"; else failx "$label"; fi; }

echo "== Fase 7 · run_all — gate di equivalenza + check =="

echo "-- prep fixtures (rigenera i binari STL gitignored) --"
run "make_fixtures (sorgenti B64 parsabili)" python3 scripts/make_fixtures.py --check
python3 scripts/make_fixtures.py >/dev/null 2>&1 || true

echo "-- check strutturali --"
run "check_anchors (TOC <-> banner 1:1)" python3 scripts/gate/check_anchors.py
run "check_inline (node --check di ogni <script> inline)" python3 scripts/gate/check_inline_scripts.py
run "fixtures STL (validi + coerenti col MANIFEST)" node scripts/gate/fixtures/gate.mjs

echo "-- gate moduli ds/ (Fasi 4-5) --"
run "purelib (math/geom/color, 78 scenari golden)" node scripts/gate/purelib/gate.mjs --from-ds --check
run "env (impostazioni/vmbar/auth)" node scripts/gate/env/gate.mjs --check

echo "-- gate workflow wf/ (Fase 6) --"
run "fres (fresabilita)" node scripts/gate/fres/gate.mjs --check
run "tree (albero scena)" node scripts/gate/tree/gate.mjs --check
run "report (PDF Analizza)" node scripts/gate/report/gate.mjs --check
run "sost (Sostituire)" node scripts/gate/sost/gate.mjs --check
run "replace (Replace-iT)" node scripts/gate/replace/gate.mjs --check
run "mis-icp (motore ICP)" node scripts/gate/mis/gate.mjs icp --check
run "mis-pdf (report Misurare)" node scripts/gate/mis/gate.mjs pdf --check
run "mis-viz (label/cutview/albero)" node scripts/gate/mis/gate.mjs viz --check
run "mis golden-master (spina ICP numerica su fixtures)" node scripts/gate/mis/gate-golden.mjs --check

echo "-- sintassi JS di wf/*.js + ds/*.js --"
SYN_OK=1; N=0
for f in backend/static/wf/*.js backend/static/ds/*.js; do
  N=$((N+1))
  node --check "$f" 2>"$OUT" || { SYN_OK=0; failx "node --check $f"; }
done
[ "$SYN_OK" = 1 ] && pass "node --check ($N file wf/ + ds/)"

rm -f "$OUT"
echo ""
if [ "$FAIL" = 0 ]; then
  printf "${GREEN}== TUTTO VERDE — nessuna regressione rilevata ==${RST}\n"; exit 0
else
  printf "${RED}== %d CHECK FALLITI — NON deployare finche' non risolti ==${RST}\n" "$FAIL"; exit 1
fi
