#!/usr/bin/env python3
"""
make_fixtures.py — genera le fixtures STL golden-master per i gate di equivalenza.

Perche': la maturazione del monolite (docs/MODULARIZZAZIONE_STUDIO.md) richiede, per le
fasi che toccano il motore ICP (4 libreria math, 6f core Misurare), un set di STL di
riferimento con RISULTATO ATTESO NOTO, per provare che il codice estratto misura identico
all'originale. Questo script li produce SENZA dipendere da STL forniti dall'utente e senza
alcun dato paziente: decodifica i CAD scanbody GIA' presenti nel progetto (var *_B64 nei file
asset /static/assets/scanbody-*.b64.js, estratti dal monolite in Fase 1) e genera coppie
sintetiche (A, B) dove B = trasformazione rigida NOTA di A. L'allineamento
atteso e' quindi esatto per costruzione (deviazione ideale = 0 dopo il recupero di T).

Uso:
    python3 scripts/make_fixtures.py            # genera in tests/fixtures/stl/
    python3 scripts/make_fixtures.py --check    # non scrive: verifica solo che i sorgenti
                                                #   B64 siano estraibili e parsabili

Output (tutti gitignored tranne il MANIFEST):
    tests/fixtures/stl/base/<tipo>.stl          # scanbody decodificato dal monolite
    tests/fixtures/stl/pairs/<tipo>_A.stl       # = base (riferimento)
    tests/fixtures/stl/pairs/<tipo>_B.stl       # = R@A + t (trasformato con T nota)
    tests/fixtures/stl/MANIFEST.json            # ground-truth: per ogni coppia, T e conteggi
                                                #   + MD5 del sorgente B64 (riproducibilita')

Deterministico: nessun Date.now()/random. Le trasformazioni T sono fisse e diverse per tipo.
"""
import re, os, sys, json, base64, struct, hashlib
import numpy as np

MONOLITE = "backend/static/syntesis-analyzer-v3b.html"
OUT_DIR  = "tests/fixtures/stl"
# var B64 (STL binario Delcam, base64 puro) -> (nome-tipo fixture, file asset che la ospita).
# Fase 1 modularizzazione (8.68.0) ha estratto i tre B64 dal monolite ai file
# /static/assets/scanbody-*.b64.js: la dichiarazione `var X = "...";` e' identica (verbatim),
# cambia solo il file sorgente. Il monolite ora contiene solo i commenti §ASSETS-B64.
SOURCES = {
    "SCANBODY_B64":    ("scanbody-1t3", "backend/static/assets/scanbody-1t3.b64.js"),
    "SCANBODY_OS_B64": ("scanbody-os",  "backend/static/assets/scanbody-os.b64.js"),
    "SCANBODY_SR_B64": ("scanbody-sr",  "backend/static/assets/scanbody-sr.b64.js"),
}
# Trasformazioni rigide NOTE per tipo (asse unitario, angolo gradi, traslazione mm).
# Fisse e distinte: ogni coppia ha un ground-truth diverso ma deterministico.
TRANSFORMS = {
    "scanbody-1t3": {"axis": [0.0, 0.0, 1.0], "deg": 7.0,  "t": [0.30, -0.20, 0.10]},
    "scanbody-os":  {"axis": [0.0, 1.0, 0.0], "deg": 4.0,  "t": [-0.15, 0.25, -0.05]},
    "scanbody-sr":  {"axis": [1.0, 0.0, 0.0], "deg": 5.5,  "t": [0.10, 0.10, 0.40]},
}
# Fixture MULTI-scanbody (Fase 6f): stressa il ramo n>=3 del motore ICP (bruteForcePreAlign
# permutazioni, matchPairs greedy, autoThresh/clusterComps multi-cluster) che le coppie a 1
# scanbody NON esercitano numericamente. Costruzione: N copie del CAD 1T3 traslate a posizioni
# NOTE (arco asimmetrico, spaziatura >> bbox scanbody ~5mm -> componenti connessi distinti),
# poi scena B = Rg@(scena A) + tg con trasformazione rigida GLOBALE nota. Poiche' l'arco e'
# asimmetrico e la rotazione modesta, la permutazione identita' e' l'unico fit valido: l'ICP
# recupera T e le deviazioni per-centroide -> 0 (ground-truth esatto), esercitando il ramo multi.
MULTI = {
    "type": "multi-1t3-5x", "from": "scanbody-1t3",
    "positions": [[0.0, 0.0, 0.0], [12.0, 3.0, 0.0], [24.0, 4.0, 0.0],
                  [36.0, 3.0, 0.0], [48.0, 0.0, 0.0]],   # mm, arco asimmetrico a 5 scanbody
    "axis": [0.2, 0.3, 1.0], "deg": 8.0, "t": [0.50, -0.30, 0.20],
}

def extract_b64(text, var):
    """Estrae il literal della var `X = "...";` (una riga) dal testo dato (file asset)."""
    m = re.search(r'var\s+' + re.escape(var) + r'\s*=\s*"([A-Za-z0-9+/=]+)"', text)
    return m.group(1) if m else None

def parse_binary_stl(buf):
    """Ritorna (normals[N,3], tris[N,3,3]) da uno STL binario. Solleva su formato non valido."""
    if len(buf) < 84:
        raise ValueError("STL troppo corto (%d byte)" % len(buf))
    n = struct.unpack_from("<I", buf, 80)[0]
    if 84 + n * 50 != len(buf):
        raise ValueError("STL binario incoerente: header dice %d triangoli, ma %d byte" % (n, len(buf)))
    data = np.frombuffer(buf, dtype="<f4", count=n * 12, offset=84 if False else 84)
    # ogni triangolo: 12 float (normal 3 + v1 3 + v2 3 + v3 3) + 2 byte attr -> serve stride
    rec = np.frombuffer(buf[84:84 + n * 50], dtype=np.dtype([
        ("normal", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")]))
    return rec["normal"].copy(), rec["v"].copy()

def write_binary_stl(path, normals, tris):
    n = len(tris)
    out = bytearray(84 + n * 50)
    struct.pack_into("<80sI", out, 0, b"synthesis-icp golden-master fixture", n)
    rec = np.zeros(n, dtype=np.dtype([("normal", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")]))
    rec["normal"] = normals
    rec["v"] = tris
    out[84:] = rec.tobytes()
    with open(path, "wb") as f:
        f.write(out)

def rot_matrix(axis, deg):
    a = np.asarray(axis, float); a = a / np.linalg.norm(a)
    th = np.radians(deg); c, s = np.cos(th), np.sin(th)
    x, y, z = a
    return np.array([
        [c + x*x*(1-c),   x*y*(1-c)-z*s, x*z*(1-c)+y*s],
        [y*x*(1-c)+z*s,   c + y*y*(1-c), y*z*(1-c)-x*s],
        [z*x*(1-c)-y*s,   z*y*(1-c)+x*s, c + z*z*(1-c)],
    ])

def main():
    check = "--check" in sys.argv
    asset_files = sorted({p for _, p in SOURCES.values()})
    manifest = {"generator": "scripts/make_fixtures.py", "source": asset_files, "pairs": []}
    if not check:
        os.makedirs(os.path.join(OUT_DIR, "base"), exist_ok=True)
        os.makedirs(os.path.join(OUT_DIR, "pairs"), exist_ok=True)

    ok = 0
    bases = {}   # name -> (normals, tris) per il montaggio della fixture multi-scanbody
    src_md5_by_name = {}
    for var, (name, asset_path) in SOURCES.items():
        if not os.path.exists(asset_path):
            print(f"  MANCA: file asset {asset_path} assente"); continue
        text = open(asset_path, encoding="utf-8").read()
        b64 = extract_b64(text, var)
        if not b64:
            print(f"  MANCA: {var} non trovato in {asset_path}"); continue
        raw = base64.b64decode(b64)
        normals, tris = parse_binary_stl(raw)   # solleva se invalido
        src_md5 = hashlib.md5(b64.encode()).hexdigest()
        print(f"  {var:18s} -> {name}: {len(tris)} triangoli, md5(b64)={src_md5[:12]}")
        ok += 1
        bases[name] = (normals, tris); src_md5_by_name[name] = src_md5
        if check:
            continue
        # base
        write_binary_stl(os.path.join(OUT_DIR, "base", name + ".stl"), normals, tris)
        # coppia A/B con trasformazione nota
        T = TRANSFORMS[name]
        R = rot_matrix(T["axis"], T["deg"]); t = np.asarray(T["t"], float)
        trisB = (tris.reshape(-1, 3) @ R.T + t).reshape(tris.shape).astype("<f4")
        normB = (normals @ R.T).astype("<f4")
        write_binary_stl(os.path.join(OUT_DIR, "pairs", name + "_A.stl"), normals, tris)
        write_binary_stl(os.path.join(OUT_DIR, "pairs", name + "_B.stl"), normB, trisB)
        manifest["pairs"].append({
            "type": name, "source_var": var, "source_file": asset_path, "src_b64_md5": src_md5,
            "n_triangles": int(len(tris)),
            "transform": {"axis": T["axis"], "deg": T["deg"], "t": T["t"]},
            "R": R.round(9).tolist(), "t": T["t"],
            "note": "B = R@A + t. Allineamento atteso: recupero di T, deviazione ideale 0.",
        })

    # ── Fixture MULTI-scanbody (montata dalla base 1T3) ─────────────────────
    if not check and MULTI["from"] in bases:
        nrm0, tris0 = bases[MULTI["from"]]
        pos = np.asarray(MULTI["positions"], float)
        trisA = np.concatenate([tris0 + p.reshape(1, 1, 3) for p in pos], axis=0).astype("<f4")
        nrmA  = np.concatenate([nrm0.copy() for _ in pos], axis=0).astype("<f4")
        Rg = rot_matrix(MULTI["axis"], MULTI["deg"]); tg = np.asarray(MULTI["t"], float)
        trisB = (trisA.reshape(-1, 3) @ Rg.T + tg).reshape(trisA.shape).astype("<f4")
        nrmB  = (nrmA @ Rg.T).astype("<f4")
        name = MULTI["type"]
        write_binary_stl(os.path.join(OUT_DIR, "base", name + ".stl"), nrmA, trisA)
        write_binary_stl(os.path.join(OUT_DIR, "pairs", name + "_A.stl"), nrmA, trisA)
        write_binary_stl(os.path.join(OUT_DIR, "pairs", name + "_B.stl"), nrmB, trisB)
        print(f"  {'MULTI':18s} -> {name}: {len(trisA)} triangoli ({len(pos)} x {MULTI['from']})")
        manifest["pairs"].append({
            "type": name, "source_var": "(montaggio da SCANBODY_B64)",
            "source_file": bases and SOURCES["SCANBODY_B64"][1],
            "src_b64_md5": src_md5_by_name.get(MULTI["from"]),
            "n_triangles": int(len(trisA)),
            "n_scanbody": len(pos),
            "positions": MULTI["positions"],
            "transform": {"axis": MULTI["axis"], "deg": MULTI["deg"], "t": MULTI["t"]},
            "R": Rg.round(9).tolist(), "t": MULTI["t"],
            "note": ("Scena A = %d copie di %s traslate; B = R@A + t (T rigida GLOBALE nota). "
                     "Allineamento atteso: recupero di T, deviazione per-centroide 0. Esercita il "
                     "ramo n>=3 (bruteForcePreAlign/matchPairs/clusterComps).") % (len(pos), MULTI["from"]),
        })

    if not ok:
        print("ERRORE: nessun sorgente estratto."); sys.exit(1)
    if check:
        print(f"CHECK OK: {ok}/{len(SOURCES)} sorgenti B64 estraibili e parsabili."); return
    with open(os.path.join(OUT_DIR, "MANIFEST.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f"OK: {ok} basi + {len(manifest['pairs'])} coppie A/B -> {OUT_DIR}/ (MANIFEST.json committato)")

if __name__ == "__main__":
    main()
