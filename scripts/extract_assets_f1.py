#!/usr/bin/env python3
"""
extract_assets_f1.py — Fase 1 modularizzazione: sgonfiaggio asset B64 dal monolite.

RILOCAZIONE VERBATIM (meccanismo B): sposta i 7 asset embedded in backend/static/assets/
senza toccare una riga di logica. I nomi delle var globali restano identici; i file .b64.js
sono <script src> sincroni caricati PRIMA del codice che li consuma (stesso ordine del
documento). La semantica embed 8.68.0 e' preservata: niente fetch, niente async.

Idempotente NO: va eseguito una sola volta su un working tree pulito. Il gate
scripts/gate/assets/verify_b64.mjs confronta gli MD5 dei buffer decodificati old (git HEAD)
vs new (asset estratti): 7/7 identici o fallisce.
"""
import os, re, base64, sys

MONO = "backend/static/syntesis-analyzer-v3b.html"
ASSETS = "backend/static/assets"

# (var, file asset) nell'ordine di dichiarazione originale
SINGLE = [
    ("SCANBODY_B64",    "scanbody-1t3.b64.js"),
    ("SCANBODY_OS_B64", "scanbody-os.b64.js"),
    ("SCANBODY_SR_B64", "scanbody-sr.b64.js"),
    ("MATEMATICA_B64",  "matematica.b64.js"),
    ("ANALOGO_B64",     "analogo.b64.js"),
]
BLOB_VAR, BLOB_FILE = "SOSTITUIRE_TEMPLATES_B64", "sost-templates.b64.js"

def main():
    src = open(MONO, encoding="utf-8").read()
    lines = src.split("\n")
    os.makedirs(ASSETS, exist_ok=True)

    # ── 1. cinque var single-line → un file ciascuna (riga verbatim) ────────
    line_of = {}
    for i, l in enumerate(lines):
        for var, _ in SINGLE:
            if l.startswith(f"var {var} ="):
                assert var not in line_of, f"{var} dichiarata due volte?"
                line_of[var] = i
    assert len(line_of) == 5, f"attese 5 var, trovate {list(line_of)}"
    for var, fname in SINGLE:
        i = line_of[var]
        with open(f"{ASSETS}/{fname}", "w", encoding="utf-8") as f:
            f.write("// Fase 1 modularizzazione: estratto VERBATIM da syntesis-analyzer-v3b.html\n")
            f.write("// (asset CAD embedded; var globale identica, caricamento sincrono in-order).\n")
            f.write(lines[i] + "\n")

    # ── 2. blob multiriga → file verbatim ───────────────────────────────────
    bs = next(i for i, l in enumerate(lines) if l.startswith(f"var {BLOB_VAR}"))
    be = next(i for i in range(bs + 1, len(lines)) if lines[i].rstrip() in ("};", "}"))
    with open(f"{ASSETS}/{BLOB_FILE}", "w", encoding="utf-8") as f:
        f.write("// Fase 1 modularizzazione: estratto VERBATIM da syntesis-analyzer-v3b.html\n")
        f.write("// (template scanbody HD gz+b64 di Sostituire, 8.68.0; var globale identica.\n")
        f.write("//  Consumato a runtime da sostDecodeTemplate, che ha guard typeof -> fail-soft).\n")
        f.write("\n".join(lines[bs:be + 1]) + "\n")
    blob_n = be - bs + 1

    # ── 3. logo data-URI → assets/logo.png ─────────────────────────────────
    li = next(i for i, l in enumerate(lines) if "data:image/png;base64," in l)
    m = re.search(r'src="data:image/png;base64,([^"]+)"', lines[li])
    assert m, "data-URI logo non trovato nella riga attesa"
    with open(f"{ASSETS}/logo.png", "wb") as f:
        f.write(base64.b64decode(m.group(1)))
    lines[li] = lines[li].replace(
        f'src="data:image/png;base64,{m.group(1)}"',
        'src="/static/assets/logo.png"')

    # ── 4. riscrittura monolite ─────────────────────────────────────────────
    # 4a. rimuovi il blob (indici piu' alti prima, per non spostare gli altri)
    lines[bs:be + 1] = [
        "// ==== §ASSETS-B64: SOSTITUIRE_TEMPLATES_B64 estratto in /static/assets/sost-templates.b64.js",
        "// (Fase 1 modularizzazione: 21.301 righe di gz+b64 fuori dal sorgente; caricato <script src>",
        "//  sincrono in testa al documento, stessa var globale, consumo runtime invariato). ===="]
    # 4b. rimuovi le 5 single-line (ricalcola indici dopo lo splice del blob: tutte < bs, invariati)
    for var, fname in sorted(SINGLE, key=lambda x: -line_of[x[0]]):
        i = line_of[var]
        lines[i] = f"// §ASSETS-B64: {var} estratto in /static/assets/{fname} (Fase 1, caricato in testa)"
    # 4c. inserisci i 6 <script src> prima del blocco <script> che li ospitava (r.1807 area).
    ins = next(i for i, l in enumerate(lines)
               if l.strip() == "<script>" and i > 1700 and i < line_of["SCANBODY_B64"])
    tags = ["<!-- ==== §ASSETS-B64 (Fase 1 modularizzazione): asset CAD estratti VERBATIM. -->",
            "<!-- Script CLASSICI SINCRONI in-order: le var globali esistono prima di ogni consumer -->"]
    for _, fname in SINGLE:
        tags.append(f'<script src="/static/assets/{fname}"></script>')
    tags.append(f'<script src="/static/assets/{BLOB_FILE}"></script>')
    lines[ins:ins] = tags

    open(MONO, "w", encoding="utf-8").write("\n".join(lines))
    sizes = {f: os.path.getsize(f"{ASSETS}/{f}") for f in os.listdir(ASSETS)}
    print(f"OK. blob: {blob_n} righe estratte. Monolite ora: {len(lines)} righe.")
    for f, s in sorted(sizes.items()):
        print(f"  assets/{f}: {s/1024:.0f} KB")

if __name__ == "__main__":
    main()
