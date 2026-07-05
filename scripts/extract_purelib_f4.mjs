// FASE 4 modularizzazione — estrazione one-shot della libreria pura dal monolite:
//   ds/syn-math.js  (14 fn: parser STL + ICP/Kabsch/SVD + solver Method C)
//   ds/syn-geom.js  ( 8 fn: estrazione facce/sezioni/proiezioni, zero stato)
//   ds/syn-color.js ( 5 fn: classificazione colori/palette pure + escape HTML)
// Meccanismo B (panel-style): rilocazione VERBATIM, classic script non-strict,
// nomi bare globali invariati. Stesso brace-matcher del gate golden-master
// (scripts/gate/purelib/extract.mjs) -> span identici per costruzione.
// ESCLUSE (stateful, restano nel monolite): rebuildScanMeshGeometry (scanMesh),
// extractScanbodyScanFor (scene), buildUndercutColors (muaObjects).
//
//   node scripts/extract_purelib_f4.mjs        # applica (idempotente: rifiuta se gia' fatto)
import { readFileSync, writeFileSync } from "node:fs";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

// Gruppi di rimozione: funzioni contigue nel sorgente -> UN tombstone per gruppo.
// comments = righe di commento IMMEDIATAMENTE sopra la funzione, che migrano con lei.
const GROUPS = [
  { file: "syn-geom.js", names: ["b64toArrayBuffer"], comments: {} },
  { file: "syn-math.js",
    names: ["parseSTL", "centroid", "kabsch", "matMul", "transpose", "det3", "svd3x3", "samplePoints", "runICP"],
    comments: { parseSTL: 1, centroid: 1 } },   // "// STL Parser", "// ICP"
  { file: "syn-geom.js", names: ["extractScanTopFaceNear"], comments: { extractScanTopFaceNear: 1 } },
  { file: "syn-geom.js", names: ["extractTopFacePts"], comments: { extractTopFacePts: 1 } },
  { file: "syn-geom.js", names: ["getTransformedTriangles"], comments: { getTransformedTriangles: 2 } },
  { file: "syn-color.js", names: ["_escHtml"], comments: {} },
  { file: "syn-geom.js", names: ["intersectPlaneTriangle", "extractCutSegments", "projectTo2D"],
    comments: { intersectPlaneTriangle: 1, extractCutSegments: 1, projectTo2D: 1 } },
  { file: "syn-color.js", names: ["classifyDivergence"], comments: {} },
  { file: "syn-color.js", names: ["getGroupArrowColor", "getGroupArrowColorInt"],
    comments: { getGroupArrowColor: 3 } },
  { file: "syn-color.js", names: ["undercutColorForAngle"], comments: { undercutColorForAngle: 2 } },
  { file: "syn-geom.js", names: ["makeGradientTexture"], comments: { makeGradientTexture: 1 } },
  { file: "syn-math.js", names: ["_mcMedian", "_mcTukey", "_mcBasis", "_mcSolveLin", "_mcDot"], comments: {} },
];

const HEADERS = {
  "syn-math.js": `/*
 * syn-math.js — libreria numerica PURA di Syntesis-ICP (Fase 4 modularizzazione, 8.85.0).
 *
 * CONTRATTO: zero stato, zero DOM, zero window.*; input -> output deterministico.
 *   - parseSTL(buffer)                  STL binario/ASCII -> {geometry(THREE), triangles}
 *   - centroid / kabsch / matMul / transpose / det3 / svd3x3   algebra allineamento (Kabsch+SVD Jacobi)
 *   - samplePoints(geometry, count)     campionamento baricentri triangoli
 *   - runICP(fixed, moving, maxIter, w) ICP point-to-point con pesi -> {R, t, rmsd}
 *   - _mcMedian/_mcTukey/_mcBasis/_mcSolveLin/_mcDot   helper IRLS/LM del Method C
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (prima del MAIN), nomi bare
 * globali come nel monolite. THREE e' letto SOLO a call-time (mai a parse-time) ->
 * sicuro col loader r169 (importmap ESM + bridge window.THREE).
 * GATE: golden-master numerico a precisione piena (Object.is) su fixtures reali +
 * casi degeneri -> node scripts/gate/purelib/gate.mjs --from-ds --check
 * NON aggiungere qui funzioni che leggono stato applicativo: e' il confine del modulo.
 */
`,
  "syn-geom.js": `/*
 * syn-geom.js — estrattori geometrici PURI di Syntesis-ICP (Fase 4 modularizzazione, 8.85.0).
 *
 * CONTRATTO: zero stato applicativo; leggono SOLO gli argomenti (geometrie/mesh THREE).
 *   - b64toArrayBuffer(b64)                          decodifica asset embed
 *   - extractScanTopFaceNear(geo, clickPos, n, r)    flat/side attorno al click (ICP mirato)
 *   - extractTopFacePts(geometry)                    flat/side del cilindro superiore scanbody
 *   - getTransformedTriangles(mesh)                  triangoli world-space {n, v}
 *   - intersectPlaneTriangle / extractCutSegments    sezione piano-mesh (motore Taglio)
 *   - projectTo2D(pt, origin, u, w)                  proiezione su piano 2D
 *   - makeGradientTexture(c1, c2, deg)               delega a ds/syn-render.js (fonte unica)
 *
 * CARICAMENTO: <script src> classico NON-strict in testa; THREE/SynRender letti a
 * call-time. ESCLUSE dal modulo (stateful, vivono nel monolite): rebuildScanMeshGeometry,
 * extractScanbodyScanFor. GATE: scripts/gate/purelib/gate.mjs --from-ds --check
 */
`,
  "syn-color.js": `/*
 * syn-color.js — classificazione colori PURA di Syntesis-ICP (Fase 4 modularizzazione, 8.85.0).
 *
 * CONTRATTO: zero stato; mappe valore->classe/colore deterministiche + escape HTML.
 *   - _escHtml(s)                 escape &<>"' per innesti in innerHTML
 *   - classifyDivergence(deg)     good/warn/risk/bad (etichette divergenza overlay)
 *   - getGroupArrowColor(gid)     palette frecce di setup per gruppo (+ variante Int)
 *   - undercutColorForAngle(deg)  gradiente continuo tipo jet 0..90°+ per undercut
 *
 * I colori CLINICI (soglie d3/angolari, brand scanbody) NON vivono qui: stanno in
 * backend/registry.py -> window.SYN (CLAUDE.md §7/§9) e sono immutabili senza
 * autorizzazione. ESCLUSA buildUndercutColors (legge muaObjects: stateful, monolite).
 * CARICAMENTO: <script src> classico NON-strict in testa.
 * GATE: scripts/gate/purelib/gate.mjs --from-ds --check
 */
`,
};

let src = readFileSync(MONO, "utf-8");
if (src.includes("§PURELIB:")) { console.error("gia' applicato (tombstone §PURELIB presente)"); process.exit(2); }

// 1) individua gli span (funzione + commenti attaccati) e compone i moduli
const perFile = { "syn-math.js": [], "syn-geom.js": [], "syn-color.js": [] };
const removals = []; // {start, end, tombstone}
for (const g of GROUPS) {
  let gStart = Infinity, gEnd = -1;
  const memberBlocks = [];
  for (const name of g.names) {
    const fnSrc = extractFunction(src, name);
    const fStart = src.indexOf(fnSrc);
    if (fStart < 0 || src.indexOf(fnSrc, fStart + 1) >= 0)
      throw new Error(`span non univoco per ${name}`);
    let start = fStart;
    const nComm = g.comments[name] || 0; // n righe di commento sopra, migrano con la funzione
    for (let k = 0; k < nComm; k++) {
      const lineStart = src.lastIndexOf("\n", start - 2) + 1;
      const line = src.slice(lineStart, start - 1);
      if (!line.trim().startsWith("//"))
        throw new Error(`sopra ${name} attesa riga commento, trovato: ${line}`);
      start = lineStart;
    }
    gStart = Math.min(gStart, start);
    gEnd = Math.max(gEnd, fStart + fnSrc.length);
    const block = src.slice(start, fStart) + fnSrc; // commenti attaccati + funzione, verbatim
    perFile[g.file].push(block);
    memberBlocks.push(block);
  }
  // lo span del gruppo deve contenere SOLO membri+commenti attaccati+spazi bianchi
  let rest = src.slice(gStart, gEnd);
  for (const b of memberBlocks) rest = rest.replace(b, "");
  if (rest.trim() !== "")
    throw new Error(`nel gruppo [${g.names}] lo span contiene altro codice:\n${rest.trim().slice(0, 200)}`);
  const tomb = `// §PURELIB: ${g.names.join(", ")} → /static/ds/${g.file} (Fase 4, caricato in testa)`;
  removals.push({ start: gStart, end: gEnd, tombstone: tomb });
}

// 2) applica le rimozioni dal fondo (offset stabili)
removals.sort((a, b) => b.start - a.start);
for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);

// 3) inserisce i 3 <script src> dopo ds/syn-clip.js (testa del file)
const anchor = '<script src="/static/ds/syn-clip.js"></script>';
if (!src.includes(anchor)) throw new Error("anchor syn-clip.js non trovato");
src = src.replace(anchor, anchor +
  '\n<script src="/static/ds/syn-math.js"></script>' +
  '\n<script src="/static/ds/syn-geom.js"></script>' +
  '\n<script src="/static/ds/syn-color.js"></script>');

// 4) scrive moduli e monolite
for (const [file, blocks] of Object.entries(perFile))
  writeFileSync(`backend/static/ds/${file}`, HEADERS[file] + "\n" + blocks.join("\n\n") + "\n");
writeFileSync(MONO, src);
console.log(`fatto: ${removals.length} tombstone, moduli: ` +
  Object.entries(perFile).map(([f, b]) => `${f}=${b.length}fn`).join(", "));
