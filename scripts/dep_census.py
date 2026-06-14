#!/usr/bin/env python3
"""
dep_census.py — Censimento panoramico delle dipendenze del monolite v3b.

Studio di modularizzazione (docs/MODULARIZZAZIONE_STUDIO.md). SOLO ANALISI: non
modifica nulla. Costruisce due grafi sul blocco <script> gigante:

  1) CALL GRAPH    funzione -> funzione  (aggregato dominio -> dominio)
  2) STATE GRAPH   funzione -> variabile globale top-level (read / write)

Più la "export surface": funzioni richiamate da handler inline (onX="fn()") nel
markup HTML e da moduli ds/*.js (window.fn) — cioè i nomi che un'estrazione DEVE
preservare su window per non rompere la produzione.

Euristiche (panoramiche, dichiarate):
  - Funzione top-level = riga ^function NOME(... ; il corpo finisce alla prima
    riga ^} (graffa in colonna 0). Robusto perché le graffe annidate sono indentate.
  - Dominio per prefisso del nome (mis/fres/sost/tree/find/anal/report/render);
    il resto = 'other'.
  - Write su una globale = NOME =|+=|-=|++|-- (escluso ==); altrimenti read.
"""
import re, json, sys
from collections import defaultdict

PATH = "backend/static/syntesis-analyzer-v3b.html"
# v2: copre TUTTO il file dal primo blocco JS applicativo alla fine (il critic del
# workflow ha rilevato che fermarsi a 19982 perdeva replace*/_replace* (Replace-iT) e
# analReport_* (report PDF MUA), che vivono nei blocchi <script> finali fino a 21684.
SCRIPT_START, SCRIPT_END = 2414, 21684   # (1-based, incl.)

PREFIXES = ["misICP_", "mis", "fres", "_replace", "replace", "sost", "tree",
            "findScanbody", "find", "analReport_", "anal", "report", "render", "rit", "mua"]

def domain_of(name):
    for p in PREFIXES:
        if name.startswith(p):
            # normalizza alcuni alias
            if p in ("misICP_", "mis"): return "mis"
            if p in ("findScanbody", "find"): return "find"
            if p in ("_replace", "replace"): return "replace"
            if p in ("analReport_", "anal", "report"): return "report"
            return p
    return "other"

def main():
    with open(PATH, encoding="utf-8") as f:
        all_lines = f.readlines()
    lines = all_lines[SCRIPT_START-1:SCRIPT_END]  # 0-based slice

    # --- 1. funzioni top-level: nome, range righe ---
    funcs = []  # (name, start_idx, end_idx)  idx relativi a 'lines'
    def_re = re.compile(r'^function\s+([A-Za-z_$][\w$]*)\s*\(')
    starts = [(i, m.group(1)) for i, l in enumerate(lines)
              for m in [def_re.match(l)] if m]
    for k, (i, name) in enumerate(starts):
        end = len(lines) - 1
        for j in range(i+1, len(lines)):
            if lines[j].startswith("}"):
                end = j
                break
        funcs.append((name, i, end))

    func_names = {name for name, _, _ in funcs}

    # --- 2. variabili globali top-level (indent 0) ---
    var_re = re.compile(r'^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=')
    gvars = set()
    for l in lines:
        m = var_re.match(l)
        if m:
            gvars.add(m.group(1))
    # rimuovi nomi che sono anche funzioni
    gvars -= func_names

    # tabella simbolo -> dominio proprietario (per funzioni)
    func_domain = {name: domain_of(name) for name, _, _ in funcs}

    # --- 3. analizza ogni corpo funzione ---
    word_re = re.compile(r'[A-Za-z_$][\w$]*')
    call_edges = defaultdict(int)        # (src_dom, dst_dom) -> count
    state_touch = defaultdict(lambda: {"r": set(), "w": set()})  # gvar -> domini r/w
    func_calls_detail = defaultdict(lambda: defaultdict(int))    # src_dom -> dst_func -> n

    for name, s, e in funcs:
        src_dom = func_domain[name]
        body = "".join(lines[s:e+1])
        # token sequence
        toks = set(word_re.findall(body))
        # call edges: token è una funzione di un ALTRO dominio (o stesso, lo contiamo a parte)
        for t in toks:
            if t in func_names and t != name:
                dst_dom = func_domain[t]
                if dst_dom != src_dom:
                    call_edges[(src_dom, dst_dom)] += 1
                    func_calls_detail[src_dom][t] += 1
        # state: globali toccate
        for g in gvars:
            if g not in toks:
                continue
            # write?
            wpat = re.compile(r'\b' + re.escape(g) + r'\s*(=[^=]|\+\+|--|\+=|-=|\*=|/=)')
            if wpat.search(body):
                state_touch[g]["w"].add(src_dom)
            else:
                state_touch[g]["r"].add(src_dom)

    # --- 4. export surface: funzioni richiamate da handler inline + da ds/*.js ---
    full = "".join(all_lines)
    inline_called = set(re.findall(r'on(?:click|change|input|load|submit)\s*=\s*"([A-Za-z_$][\w$]*)', full))
    inline_called &= func_names
    # ds modules
    import glob, os
    ds_refs = set()
    for mod in glob.glob("backend/static/ds/*.js"):
        with open(mod, encoding="utf-8") as fh:
            txt = fh.read()
        for fn in func_names:
            if re.search(r'window\.' + re.escape(fn) + r'\b', txt):
                ds_refs.add((os.path.basename(mod), fn))

    # --- OUTPUT ---
    print("="*70)
    print("CENSIMENTO DIPENDENZE — blocco script %d-%d" % (SCRIPT_START, SCRIPT_END))
    print("="*70)

    # conteggio funzioni per dominio
    dom_count = defaultdict(int)
    for name in func_names:
        dom_count[func_domain[name]] += 1
    print("\n[A] Funzioni top-level per dominio (%d totali):" % len(func_names))
    for d, n in sorted(dom_count.items(), key=lambda x: -x[1]):
        print("    %-8s %3d" % (d, n))

    print("\n[B] Variabili globali top-level (stato condiviso): %d" % len(gvars))

    print("\n[C] CALL GRAPH dominio->dominio (n. funzioni cross richiamate):")
    for (sd, dd), c in sorted(call_edges.items(), key=lambda x: -x[1]):
        print("    %-8s -> %-8s  %3d" % (sd, dd, c))

    print("\n[D] STATO CONDIVISO PIÙ INTRECCIATO")
    print("    (globali toccate da >=2 domini; W=scrive R=legge):")
    rows = []
    for g, rw in state_touch.items():
        doms = rw["r"] | rw["w"]
        if len(doms) >= 2:
            rows.append((len(doms), g, sorted(rw["w"]), sorted(rw["r"])))
    rows.sort(key=lambda x: -x[0])
    for ndoms, g, w, r in rows[:40]:
        print("    %-26s #dom=%d  W=%s  R=%s" % (g, ndoms, ",".join(w) or "-", ",".join(r) or "-"))
    print("    ... (%d globali multi-dominio totali)" % len(rows))

    print("\n[E] EXPORT SURFACE — funzioni richiamate da handler inline: %d" % len(inline_called))
    print("    (questi nomi devono restare globali/su window dopo l'estrazione)")
    by_dom = defaultdict(list)
    for fn in inline_called:
        by_dom[func_domain[fn]].append(fn)
    for d in sorted(by_dom, key=lambda d: -len(by_dom[d])):
        print("    %-8s %3d" % (d, len(by_dom[d])))

    print("\n[F] EXPORT SURFACE — funzioni richiamate da moduli ds/*.js LIVE:")
    if ds_refs:
        for mod, fn in sorted(ds_refs):
            print("    %s  ->  %s  [%s]" % (mod, fn, func_domain[fn]))
    else:
        print("    (nessuna window.fn diretta trovata)")

    # dump json per il targeted pass
    out = {
        "func_count_by_domain": dict(dom_count),
        "global_vars_count": len(gvars),
        "call_edges": {f"{sd}->{dd}": c for (sd, dd), c in call_edges.items()},
        "shared_state_multi_domain": [
            {"var": g, "write": sorted(rw["w"]), "read": sorted(rw["r"])}
            for g, rw in state_touch.items() if len(rw["r"] | rw["w"]) >= 2
        ],
        "inline_export_by_domain": {d: sorted(v) for d, v in by_dom.items()},
        "ds_module_refs": [{"module": m, "fn": fn} for m, fn in sorted(ds_refs)],
    }
    with open("scripts/dep_census_out.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    print("\n[json] scripts/dep_census_out.json scritto.")

if __name__ == "__main__":
    main()
