#!/usr/bin/env python3
"""
make_fixtures.py — genera le fixtures STL golden-master per i gate di equivalenza.

Perche': la maturazione del monolite (docs/MODULARIZZAZIONE_STUDIO.md) richiede, per le
fasi che toccano il motore ICP (4 libreria math, 6f core Misurare), un set di STL di
riferimento con RISULTATO ATTESO NOTO, per provare che il codice estratto misura identico
all'originale. Questo script li produce SENZA dipendere da STL forniti dall'utente e senza
alcun dato paziente: decodifica i CAD scanbody GIA' embedded nel monolite (var *_B64) e
genera coppie sintetiche (A, B) dove B = trasformazione rigida NOTA di A. L'allineamento
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
# var B64 (STL binario Delcam, base64 puro) -> nome-tipo fixture
SOURCES = {
    "SCANBODY_B64":    "scanbody-1t3",
    "SCANBODY_OS_B64": "scanbody-os",
    "SCANBODY_SR_B64": "scanbody-sr",
}
# Trasformazioni rigide NOTE per tipo (asse unitario, angolo gradi, traslazione mm).
# Fisse e distinte: ogni coppia ha un ground-truth diverso ma deterministico.
TRANSFORMS = {
    "scanbody-1t3": {"axis": [0.0, 0.0, 1.0], "deg": 7.0,  "t": [0.30, -0.20, 0.10]},
    "scanbody-os":  {"axis": [0.0, 1.0, 0.0], "deg": 4.0,  "t": [-0.15, 0.25, -0.05]},
    "scanbody-sr":  {"axis": [1.0, 0.0, 0.0], "deg": 5.5,  "t": [0.10, 0.10, 0.40]},
}

def extract_b64(html, var):
    """Estrae il literal della var `X = "...";` (una riga) dal monolite."""
    m = re.search(r'var\s+' + re.escape(var) + r'\s*=\s*"([A-Za-z0-9+/=]+)"', html)
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
    html = open(MONOLITE, encoding="utf-8").read()
    manifest = {"generator": "scripts/make_fixtures.py", "source": MONOLITE, "pairs": []}
    if not check:
        os.makedirs(os.path.join(OUT_DIR, "base"), exist_ok=True)
        os.makedirs(os.path.join(OUT_DIR, "pairs"), exist_ok=True)

    ok = 0
    for var, name in SOURCES.items():
        b64 = extract_b64(html, var)
        if not b64:
            print(f"  MANCA: {var} non trovato nel monolite"); continue
        raw = base64.b64decode(b64)
        normals, tris = parse_binary_stl(raw)   # solleva se invalido
        src_md5 = hashlib.md5(b64.encode()).hexdigest()
        print(f"  {var:18s} -> {name}: {len(tris)} triangoli, md5(b64)={src_md5[:12]}")
        ok += 1
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
            "type": name, "source_var": var, "src_b64_md5": src_md5,
            "n_triangles": int(len(tris)),
            "transform": {"axis": T["axis"], "deg": T["deg"], "t": T["t"]},
            "R": R.round(9).tolist(), "t": T["t"],
            "note": "B = R@A + t. Allineamento atteso: recupero di T, deviazione ideale 0.",
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
