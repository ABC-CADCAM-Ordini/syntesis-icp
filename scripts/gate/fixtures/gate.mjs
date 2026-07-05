// Gate F0.4 — verifica che le fixtures golden-master siano STL binari validi, caricabili
// da un parser JS (come parseSTL del monolite), e coerenti col MANIFEST (conteggio triangoli).
// Non dipende da THREE: legge header + count dello STL binario, come fa parseSTL prima di
// costruire la geometria. Esegue: (base + coppie A/B) x tipo.
//
//   node scripts/gate/fixtures/gate.mjs
//
// Prerequisito: le fixtures devono esistere -> `python3 scripts/make_fixtures.py` (i binari
// sono gitignored e rigenerabili; il MANIFEST e' committato = ground-truth).
import { readFileSync, existsSync } from "node:fs";

const DIR = "tests/fixtures/stl";
const MAN = `${DIR}/MANIFEST.json`;

if (!existsSync(MAN)) {
  console.error(`ERRORE: ${MAN} assente. Esegui: python3 scripts/make_fixtures.py`);
  process.exit(2);
}

// Conteggio triangoli come parseSTL: header 80 byte + uint32 count; valida 84 + 50*n == len.
function stlTriangleCount(path) {
  const buf = readFileSync(path);
  if (buf.length < 84) throw new Error(`STL troppo corto (${buf.length} byte)`);
  const n = buf.readUInt32LE(80);
  if (84 + n * 50 !== buf.length)
    throw new Error(`STL incoerente: count=${n} ma len=${buf.length} (atteso ${84 + n * 50})`);
  return n;
}

const man = JSON.parse(readFileSync(MAN, "utf-8"));
let checked = 0, fail = 0;
for (const p of man.pairs) {
  const targets = [
    [`${DIR}/base/${p.type}.stl`, p.n_triangles],
    [`${DIR}/pairs/${p.type}_A.stl`, p.n_triangles],
    [`${DIR}/pairs/${p.type}_B.stl`, p.n_triangles],
  ];
  for (const [path, expected] of targets) {
    checked++;
    try {
      if (!existsSync(path)) throw new Error("file assente (rigenera con make_fixtures.py)");
      const n = stlTriangleCount(path);
      if (n !== expected) throw new Error(`triangoli ${n} != atteso ${expected}`);
    } catch (e) {
      fail++;
      console.error(`  FAIL ${path}: ${e.message}`);
    }
  }
}
console.log(`Gate fixtures: ${checked - fail}/${checked} STL validi e coerenti col MANIFEST` +
            ` (${man.pairs.length} tipi × base+A+B).`);
process.exit(fail ? 1 : 0);
