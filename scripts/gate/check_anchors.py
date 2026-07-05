#!/usr/bin/env python3
"""
check_anchors.py — Gate permanente (Fase 2): coerenza TOC ↔ §anchor nel monolite.

Regole verificate:
  1. ogni §TOKEN elencato nel TOC (blocco '==== INDICE ====' in testa al file)
     esiste nel documento ESATTAMENTE una volta come banner;
  2. ogni banner §TOKEN presente nel documento e' elencato nel TOC (niente orfani);
  3. i token sono unici nel TOC.

Uso:  python3 scripts/gate/check_anchors.py     -> exit 0 verde / 1 rosso
"""
import re, sys

MONO = "backend/static/syntesis-analyzer-v3b.html"

def main():
    src = open(MONO, encoding="utf-8").read()
    lines = src.split("\n")

    # TOC = righe del blocco indice: '  §TOKEN — descrizione'
    toc_tokens = []
    in_toc = False
    for l in lines[:200]:
        if "==== INDICE" in l:
            in_toc = True
            continue
        if in_toc and "====" in l and "INDICE" not in l:
            break
        if in_toc:
            m = re.search(r'(§[A-Z0-9\-]+)', l)
            if m:
                toc_tokens.append(m.group(1))
    if not toc_tokens:
        print("ROSSO: TOC non trovato (blocco '==== INDICE ====' assente in testa al file)")
        sys.exit(1)

    dup_toc = {t for t in toc_tokens if toc_tokens.count(t) > 1}

    # banner nel documento: righe '==== §TOKEN ====' FUORI dal TOC
    toc_end = 0
    in_toc = False
    for i, l in enumerate(lines[:200]):
        if "==== INDICE" in l:
            in_toc = True
        elif in_toc and "====" in l and "INDICE" not in l:
            toc_end = i
            break
    body = "\n".join(lines[toc_end + 1:])
    banners = re.findall(r'====\s*(§[A-Z0-9\-]+)\s*====', body)

    fail = []
    for t in sorted(set(toc_tokens)):
        n = banners.count(t)
        if n == 0:
            fail.append(f"{t}: nel TOC ma NESSUN banner nel documento")
        elif n > 1:
            fail.append(f"{t}: banner duplicato ({n} occorrenze)")
    for t in sorted(set(banners)):
        if t not in toc_tokens:
            fail.append(f"{t}: banner nel documento ma ASSENTE dal TOC")
    for t in sorted(dup_toc):
        fail.append(f"{t}: duplicato nel TOC")

    if fail:
        print("GATE ROSSO — %d problemi:" % len(fail))
        for f in fail:
            print("  -", f)
        sys.exit(1)
    print(f"GATE VERDE: {len(set(toc_tokens))} anchor, TOC ↔ banner coerenti 1:1.")

if __name__ == "__main__":
    main()
