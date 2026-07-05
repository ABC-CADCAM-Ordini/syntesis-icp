#!/usr/bin/env python3
"""
dep_census.py v3 — Censimento strutturale del monolite v3b.

SOLO ANALISI: non modifica il monolite. Unica eccezione: con --write-mappa
aggiorna la sezione "Mappa strutturale" di docs/MAPPA_FUNZIONALE.md tra i
marker DEP-CENSUS:START/END (la MAPPA e' l'UNICA mappa del progetto, per
decisione utente 2026-07-05; questo script e' il suo generatore strutturale).

Regola (CLAUDE.md §4): rieseguire con --write-mappa (a) a ogni bump MINOR,
(b) SEMPRE prima di qualsiasi passo di estrazione dal monolite.

v3 (2026-07-05):
  - AUTO-RILEVAMENTO dei blocchi <script> inline (la v2 aveva range hardcoded
    2414-21684, invalidati dall'8.68.0 in poi: il file e' oggi ~41k righe).
  - Domini piu' fini (auth, workflow, scene, export, env, log... — la v2
    lasciava 171 funzioni in 'other').
  - Superficie per-dominio: globali lette/scritte cross-dominio + funzioni
    esposte a handler inline / moduli ds/*.js (cio' che un'estrazione DEVE
    preservare su window).
  - Output: stdout umano + scripts/dep_census_out.json + (--write-mappa)
    sezione markdown nella MAPPA.

Euristiche (dichiarate, panoramiche):
  - Funzione top-level = ^function NOME( oppure ^window.NOME = [async] function;
    corpo fino alla prima ^} (le graffe annidate sono indentate).
  - Dominio dal nome (tabella DOMAIN_RULES, primo match vince).
  - Write su globale = NOME seguito da = (non ==) / += / -= / *= / /= / ++ / --.
"""
import re, json, sys, glob, os
from collections import defaultdict

PATH  = "backend/static/syntesis-analyzer-v3b.html"
MAPPA = "docs/MAPPA_FUNZIONALE.md"
OUT_JSON = "scripts/dep_census_out.json"
MARK_S = "<!-- DEP-CENSUS:START (generato da scripts/dep_census.py — non editare a mano) -->"
MARK_E = "<!-- DEP-CENSUS:END -->"

# (nome dominio, regex sul nome funzione) — primo match vince, l'ordine conta
DOMAIN_RULES = [
    ("mis",      re.compile(r'^(misICP_|_mis|mis[A-Z]|MIS_)')),
    ("sost",     re.compile(r'^_?sost')),
    ("replace",  re.compile(r'^_?replace')),
    ("fres",     re.compile(r'^_?fres')),
    ("auth",     re.compile(r'^syntAuth')),
    ("workflow", re.compile(r'^(selectWorkflow|updateWorkflowUI|setMode$|_hardReset|_setAnalyza|_setSostituire|_hasUnsavedData|toggle(Workflow|File|View|Reset)Menu|close(Workflow|File|View)Menu)')),
    ("tree",     re.compile(r'^(tree|rebuildTree|toggleLayer|openLayersPanel|closeLayersPanel|toggleLayersPanel|toggleMua|setSceneObjectColor|getGroupBadgeColor|__synApplyColor)')),
    ("mua",      re.compile(r'^(placeMUA|removeMUA|clearAllMUA|newCase$|startPlacement|onViewportClick|alignAll|calc|calculate|create(Divergence|Mean)|clear(Divergence|Group)|toggle(Divergence|All|Undercut|Scanbody)|updateGroup|updateDivergence|ensureLabel|applyUndercut|removeUndercut|computeClinical|updateClinical|updateRaffina)')),
    ("find",     re.compile(r'^find')),
    ("report",   re.compile(r'^(analReport_|report|pdf|addFooter|addCornerLogo)')),
    ("cut",      re.compile(r'^(cut|openCutView|closeCutView|renderCutView|synClip)')),
    ("env",      re.compile(r'^(env|onEnv|settings|openSettings|closeSettings|miller|applyMiller|applyUiZoom|syntesisGetUiZoom)')),
    ("scene",    re.compile(r'^(animate|applyRenderMode|applyEnvToScene|initScene|resetCamera|animateTarget|hardReset$)')),
    ("export",   re.compile(r'^(export|writeBinarySTL|download|_makeTRoot)')),
    ("log",      re.compile(r'^_?synLog')),
]

def domain_of(name):
    for dom, rx in DOMAIN_RULES:
        if rx.match(name):
            return dom
    return "other"

def read_version():
    try:
        txt = open("backend/registry.py", encoding="utf-8").read()
        m = re.search(r'BACKEND_VERSION = "([^"]+)"', txt)
        return m.group(1) if m else "?"
    except OSError:
        return "?"

def main():
    write_mappa = "--write-mappa" in sys.argv
    src = open(PATH, encoding="utf-8").read()
    all_lines = src.split("\n")
    version = read_version()

    # ── blocchi <script> inline (AUTO) ──────────────────────────────────────
    blocks = []
    for m in re.finditer(r'<script([^>]*)>(.*?)</script>', src, re.S):
        attrs, body = m.group(1), m.group(2)
        if "src=" in attrs or "importmap" in attrs or not body.strip():
            continue
        blocks.append(body)
    js = "\n".join(blocks)
    js_lines = js.split("\n")

    # ── composizione grezza del file ────────────────────────────────────────
    b64_lines = [l for l in all_lines if len(l) > 5000]
    style = re.search(r'<style>(.*?)</style>', src, re.S)
    comp = {
        "version": version,
        "file_lines": len(all_lines),
        "file_mb": round(len(src.encode("utf-8")) / 1e6, 2),
        "js_lines": len(js_lines),
        "js_blocks": len(blocks),
        "css_lines": style.group(1).count("\n") if style else 0,
        "b64_asset_lines": len(b64_lines),
        "b64_asset_mb": round(sum(len(l) for l in b64_lines) / 1e6, 2),
    }

    # ── funzioni top-level ──────────────────────────────────────────────────
    funcs = []
    rx_fn  = re.compile(r'^function\s+([A-Za-z_$][\w$]*)\s*\(')
    rx_wfn = re.compile(r'^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function')
    starts = []
    for i, l in enumerate(js_lines):
        m = rx_fn.match(l) or rx_wfn.match(l)
        if m:
            starts.append((i, m.group(1)))
    for i, name in starts:
        end = len(js_lines) - 1
        for j in range(i + 1, len(js_lines)):
            if js_lines[j].startswith("}"):
                end = j
                break
        funcs.append((name, i, end))
    func_names  = {n for n, _, _ in funcs}
    func_domain = {n: domain_of(n) for n in func_names}

    # ── globali top-level ───────────────────────────────────────────────────
    gvars = set()
    rx_var = re.compile(r'^(?:const|let|var)\s+([A-Za-z_$][\w$]*)')
    for l in js_lines:
        m = rx_var.match(l)
        if m:
            gvars.add(m.group(1))
    gvars -= func_names

    # ── grafi ───────────────────────────────────────────────────────────────
    word_re = re.compile(r'[A-Za-z_$][\w$]*')
    call_edges = defaultdict(int)
    state = defaultdict(lambda: {"r": set(), "w": set()})
    cross_called = set()   # funzioni chiamate da un dominio DIVERSO dal proprio
    for name, s, e in funcs:
        sd = func_domain[name]
        body = "\n".join(js_lines[s:e + 1])
        toks = set(word_re.findall(body))
        for t in toks & func_names:
            if t != name and func_domain[t] != sd:
                call_edges[(sd, func_domain[t])] += 1
                cross_called.add(t)
        for g in toks & gvars:
            wpat = re.compile(r'\b' + re.escape(g) + r'\s*(=[^=]|\+\+|--|\+=|-=|\*=|/=)')
            (state[g]["w"] if wpat.search(body) else state[g]["r"]).add(sd)

    # ── export surface: handler inline + ds/*.js ────────────────────────────
    inline_called = set(re.findall(
        r'on(?:click|change|input|load|submit|dblclick|mouseover|mouseout|keyup|keydown)\s*=\s*\\?["\']([A-Za-z_$][\w$]*)\s*\(', src))
    inline_called &= func_names
    ds_refs = defaultdict(set)
    for mod in glob.glob("backend/static/ds/*.js"):
        txt = open(mod, encoding="utf-8").read()
        for fn in func_names:
            if re.search(r'\b' + re.escape(fn) + r'\b', txt):
                ds_refs[func_domain[fn]].add((os.path.basename(mod), fn))

    # ── superficie per dominio ──────────────────────────────────────────────
    dom_count = defaultdict(int)
    for n in func_names:
        dom_count[func_domain[n]] += 1
    shared = [(g, d) for g, d in state.items() if len(d["r"] | d["w"]) > 1]
    surface = {}
    for dom in sorted(dom_count):
        surface[dom] = {
            "funcs": dom_count[dom],
            # globali che il dominio scrive e che altri domini toccano
            "state_out": sorted(g for g, d in state.items()
                                if dom in d["w"] and ((d["r"] | d["w"]) - {dom})),
            # globali che il dominio legge ma che scrive qualcun altro
            "state_in": sorted(g for g, d in state.items()
                               if dom in d["r"] and (d["w"] - {dom})),
            # da preservare su window (handler HTML/stringhe)
            "api_inline": sorted(f for f in inline_called if func_domain[f] == dom),
            # funzioni del dominio chiamate da ALTRI domini
            "api_cross": sorted(f for f in cross_called if func_domain[f] == dom),
            "ds_refs": sorted(f for _, f in ds_refs.get(dom, [])),
        }

    out = {
        "composizione": comp,
        "func_count_by_domain": dict(sorted(dom_count.items(), key=lambda x: -x[1])),
        "global_vars_count": len(gvars),
        "call_edges": {f"{a}->{b}": c for (a, b), c in sorted(call_edges.items(), key=lambda x: -x[1])},
        "shared_state_multi_domain": [
            {"var": g, "write": sorted(d["w"]), "read": sorted(d["r"])}
            for g, d in sorted(shared, key=lambda x: -len(x[1]["r"] | x[1]["w"]))],
        "surface_by_domain": surface,
        "inline_export_count": len(inline_called),
    }
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ── stdout ──────────────────────────────────────────────────────────────
    print(f"CENSIMENTO v3 — {PATH} @ {version}")
    print(f"  {comp['file_lines']} righe / {comp['file_mb']} MB | JS {comp['js_lines']} righe in {comp['js_blocks']} blocchi | asset B64 {comp['b64_asset_mb']} MB ({round(comp['b64_asset_mb']/comp['file_mb']*100)}%)")
    print(f"  funzioni {len(func_names)} | globali {len(gvars)} | handler-export {len(inline_called)} | globali multi-dominio {len(shared)}")
    for d, n in sorted(dom_count.items(), key=lambda x: -x[1]):
        s = surface[d]
        print(f"    {d:9s} {n:4d} fn | stato out/in {len(s['state_out']):3d}/{len(s['state_in']):3d} | api inline/cross {len(s['api_inline']):3d}/{len(s['api_cross']):3d}")
    print(f"[json] {OUT_JSON}")

    # ── sezione markdown nella MAPPA ────────────────────────────────────────
    if write_mappa:
        md = [MARK_S, ""]
        md.append(f"### Fotografia ({version} — rigenerare con `python3 scripts/dep_census.py --write-mappa`)")
        md.append("")
        md.append("| Metrica | Valore |")
        md.append("|---|---|")
        md.append(f"| Righe / peso | **{comp['file_lines']}** / **{comp['file_mb']} MB** |")
        md.append(f"| JS applicativo | {comp['js_lines']} righe in {comp['js_blocks']} blocchi `<script>` |")
        md.append(f"| Asset B64 embedded | **{comp['b64_asset_mb']} MB** in {comp['b64_asset_lines']} righe (**{round(comp['b64_asset_mb']/comp['file_mb']*100)}%** del file) |")
        md.append(f"| Funzioni top-level | {len(func_names)} |")
        md.append(f"| Globali condivise | {len(gvars)} (di cui **{len(shared)}** toccate da 2+ domini) |")
        md.append(f"| Export surface (handler inline) | {len(inline_called)} funzioni da preservare su `window` |")
        md.append("")
        md.append("### Domini: dimensione e superficie di accoppiamento")
        md.append("")
        md.append("| Dominio | # fn | stato scritto→altri | stato letto←altri | API inline | API cross-dominio |")
        md.append("|---|---|---|---|---|---|")
        for d, n in sorted(dom_count.items(), key=lambda x: -x[1]):
            s = surface[d]
            md.append(f"| `{d}` | {n} | {len(s['state_out'])} | {len(s['state_in'])} | {len(s['api_inline'])} | {len(s['api_cross'])} |")
        md.append("")
        md.append("### Accoppiamenti call-graph più pesanti (dominio→dominio: # funzioni)")
        md.append("")
        top_edges = sorted(call_edges.items(), key=lambda x: -x[1])[:12]
        md.append("`" + "` · `".join(f"{a}→{b}:{c}" for (a, b), c in top_edges) + "`")
        md.append("")
        md.append("> Elenchi completi per-dominio (globali, API) in `scripts/dep_census_out.json`.")
        md.append("> Ordine di estrazione e meccanismi: `docs/MODULARIZZAZIONE_STUDIO.md` (strategia).")
        md.append("> Regola §4: rigenerare questa sezione a ogni bump MINOR e prima di ogni estrazione.")
        md.append("")
        md.append(MARK_E)
        block = "\n".join(md)

        mp = open(MAPPA, encoding="utf-8").read()
        if MARK_S in mp and MARK_E in mp:
            mp = re.sub(re.escape(MARK_S) + r'.*?' + re.escape(MARK_E), block, mp, flags=re.S)
        else:
            mp = mp.rstrip() + "\n\n---\n\n## Mappa strutturale del monolite (generata)\n\n" + block + "\n"
        open(MAPPA, "w", encoding="utf-8").write(mp)
        print(f"[mappa] sezione DEP-CENSUS aggiornata in {MAPPA}")

if __name__ == "__main__":
    main()
