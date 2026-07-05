// Gate F4 — golden-master numerico della libreria pura (ds/syn-math + syn-geom + syn-color).
// Il gate piu' forte del piano (MODULARIZZAZIONE_STUDIO §FASE 4): esegue le 27 funzioni
// pure su fixtures STL reali (tests/fixtures/stl) + casi degeneri (coplanari, riflessione,
// NaN) e confronta a PRECISIONE PIENA: ogni Number e' serializzato come bit Float64 in hex,
// quindi uguaglianza stringa == Object.is (inclusi -0 e NaN). In piu' registra l'md5 del
// sorgente di ogni funzione: la modalita' --check prova anche il VERBATIM della rilocazione.
//
//   node scripts/gate/purelib/gate.mjs --from-monolith --write-golden   # PRIMA dell'edit
//   node scripts/gate/purelib/gate.mjs --from-ds --check                # DOPO l'estrazione
//   node scripts/gate/purelib/gate.mjs --from-monolith --check          # autoconsistenza
//
// Prerequisiti: fixtures presenti (python3 scripts/make_fixtures.py se assenti);
// THREE r169 vendored in scripts/gate/clip/vendor/three.module.min.js.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractAll } from "./extract.mjs";

const MONOLITH = "backend/static/syntesis-analyzer-v3b.html";
const GOLDEN = "scripts/gate/purelib/golden.json";
const FIX = "tests/fixtures/stl";

const MATH = ["parseSTL","centroid","kabsch","matMul","transpose","det3","svd3x3",
              "samplePoints","runICP","_mcMedian","_mcTukey","_mcBasis","_mcSolveLin","_mcDot"];
const GEOM = ["b64toArrayBuffer","extractScanTopFaceNear","extractTopFacePts",
              "getTransformedTriangles","intersectPlaneTriangle","extractCutSegments",
              "projectTo2D","makeGradientTexture"];
const COLOR = ["_escHtml","classifyDivergence","getGroupArrowColor","getGroupArrowColorInt",
               "undercutColorForAngle"];
const ALL = [...MATH, ...GEOM, ...COLOR];
const DS_FILES = { "backend/static/ds/syn-math.js": MATH,
                   "backend/static/ds/syn-geom.js": GEOM,
                   "backend/static/ds/syn-color.js": COLOR };

const md5 = (buf) => createHash("md5").update(buf).digest("hex");

// ── serializzazione a precisione piena ─────────────────────────────────────
const _dv = new DataView(new ArrayBuffer(8));
function serNum(n) { _dv.setFloat64(0, n); return "n:" + _dv.getBigUint64(0).toString(16).padStart(16, "0"); }
function ser(v) {
  if (typeof v === "number") return serNum(v);
  if (v === null) return "null";
  if (v === undefined) return "undef";
  if (typeof v === "string") return "s:" + v;
  if (typeof v === "boolean") return "b:" + v;
  if (ArrayBuffer.isView(v))
    return v.constructor.name + "[" + v.length + "]:" + md5(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  if (v instanceof ArrayBuffer) return "ab[" + v.byteLength + "]:" + md5(Buffer.from(v));
  if (Array.isArray(v)) {
    const full = v.map(ser);
    if (v.length > 48)
      return { len: v.length, md5: md5(JSON.stringify(full)),
               head: full.slice(0, 6), tail: full.slice(-6) };
    return full;
  }
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = ser(v[k]);
    return o;
  }
  return "?:" + String(v);
}

// ── sorgenti: dal monolite (estrazione by-name) o dai 3 file ds/ ───────────
function loadSources(mode) {
  if (mode === "monolith") return extractAll(readFileSync(MONOLITH, "utf-8"), ALL);
  const out = {};
  for (const [path, names] of Object.entries(DS_FILES)) {
    if (!existsSync(path)) throw new Error(`${path} assente (estrazione non ancora fatta?)`);
    Object.assign(out, extractAll(readFileSync(path, "utf-8"), names));
  }
  return out;
}

// ── bundle eseguibile: stesso scope condiviso delle globali del browser ────
async function buildLib(sources) {
  const THREE = await import("../clip/vendor/three.module.min.js");
  const SynRenderStub = { makeGradientTexture: (T, c1, c2, angleDeg) =>
    ({ __stub: "SynRender.makeGradientTexture", c1, c2, angleDeg, threeOk: T === THREE }) };
  const windowStub = {};
  const body = ALL.map((n) => sources[n]).join("\n") +
    "\nreturn {" + ALL.join(",") + "};";
  const factory = new Function("THREE", "window", "atob", "TextDecoder", "SynRender", body);
  return { lib: factory(THREE, windowStub, atob, TextDecoder, SynRenderStub), THREE };
}

// ── input deterministici ───────────────────────────────────────────────────
function rotAA(axis, deg) { // Rodrigues, solo Math.* deterministici
  const L = Math.hypot(axis[0], axis[1], axis[2]);
  const [x, y, z] = [axis[0] / L, axis[1] / L, axis[2] / L];
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
          [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
          [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
const applyRT = (R, t, p) => [
  R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0],
  R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1],
  R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2]];

const ASCII_STL = `solid probe
facet normal 0 0 1
outer loop
vertex 0.0 0.0 0.5
vertex 1.25 0.0 0.5
vertex 0.0 2.5 0.5
endloop
endfacet
facet normal 0 1 0
outer loop
vertex 0.1 -0.2 0.3
vertex 1.0 -0.2 0.75
vertex 0.5 -0.2 1.5
endloop
endfacet
endsolid probe
`;

function geoDigest(res) {
  const pos = res.geometry.attributes.position.array;
  const norm = res.geometry.attributes.normal.array;
  return { triangles: res.triangles,
           pos: ser(pos), norm: ser(norm),
           posHead: Array.from(pos.slice(0, 9)).map(serNum),
           posTail: Array.from(pos.slice(-9)).map(serNum) };
}

// ── scenari ────────────────────────────────────────────────────────────────
async function runScenarios({ lib, THREE }) {
  const S = {};
  const types = ["scanbody-1t3", "scanbody-os", "scanbody-sr"];
  const parsed = {}; // BufferGeometry per type (base)

  // MATH — parseSTL su tutte le fixtures (binario) + ramo ASCII
  for (const t of types) {
    for (const which of ["base", "A", "B"]) {
      const path = which === "base" ? `${FIX}/base/${t}.stl` : `${FIX}/pairs/${t}_${which}.stl`;
      const buf = readFileSync(path);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const res = lib.parseSTL(ab);
      if (which === "base") parsed[t] = res.geometry;
      S[`parseSTL_${t}_${which}`] = geoDigest(res);
    }
  }
  S.parseSTL_ascii = geoDigest(lib.parseSTL(new TextEncoder().encode(ASCII_STL).buffer));

  // samplePoints + centroid per type
  const samples = {};
  for (const t of types) {
    samples[t] = lib.samplePoints(parsed[t], 300);
    S[`samplePoints_${t}`] = ser(samples[t]);
    S[`centroid_${t}`] = ser(lib.centroid(samples[t]));
  }

  // kabsch: rigido, pesato, coplanare, riflessione, n<3, NaN
  const A200 = samples["scanbody-1t3"].slice(0, 200);
  const R0 = rotAA([1, 2, 3], 17), t0 = [0.3, -0.2, 0.15];
  const B200 = A200.map((p) => applyRT(R0, t0, p));
  S.kabsch_rigid = ser(lib.kabsch(A200, B200));
  S.kabsch_weighted = ser(lib.kabsch(A200, B200, A200.map((_, i) => (i % 2 ? 1 : 0.25))));
  const grid = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) grid.push([i * 0.8, j * 0.6, 0]);
  const Rz = rotAA([0, 0, 1], 30);
  S.kabsch_coplanar = ser(lib.kabsch(grid, grid.map((p) => applyRT(Rz, [1, -0.5, 0], p))));
  S.kabsch_reflection = ser(lib.kabsch(grid.map((p) => [p[0], p[1], p[0] * 0.3 + p[1] * 0.2]),
                                       grid.map((p) => [-p[0], p[1], p[0] * 0.3 + p[1] * 0.2])));
  S.kabsch_n2 = ser(lib.kabsch([[0, 0, 0], [1, 1, 1]], [[0, 0, 1], [1, 1, 2]]));
  const Anan = A200.slice(0, 10).map((p) => p.slice()); Anan[3][1] = NaN;
  S.kabsch_nan = ser(lib.kabsch(Anan, Anan.map((p) => applyRT(R0, t0, p))));

  // runICP per type (fixed=base, moving=perturbato deterministico)
  for (const t of types) {
    const fixed = samples[t].slice(0, 150);
    const Rp = rotAA([0.2, -1, 0.5], 2), tp = [0.05, -0.03, 0.04];
    S[`runICP_${t}`] = ser(lib.runICP(fixed, fixed.map((p) => applyRT(Rp, tp, p)), 6));
  }

  // algebra 3x3: generica, singolare, riflessione, identita', NaN
  const Mg = [[0.9, -0.1, 0.3], [0.2, 1.1, -0.4], [-0.3, 0.25, 0.85]];
  const Ms = [[1, 2, 3], [2, 4, 6], [3, 6, 9]];
  const Mr = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];
  const Mi = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const Mn = [[NaN, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const [k, M] of [["gen", Mg], ["sing", Ms], ["refl", Mr], ["id", Mi], ["nan", Mn]]) {
    S[`det3_${k}`] = ser(lib.det3(M));
    S[`transpose_${k}`] = ser(lib.transpose(M));
    S[`svd3x3_${k}`] = ser(lib.svd3x3(M));
  }
  S.matMul_gen = ser(lib.matMul(Mg, Mr));

  // _mc*
  S._mcMedian_odd = ser(lib._mcMedian([3, 1, 2, 9, 5]));
  S._mcMedian_even = ser(lib._mcMedian([4, 1, 3, 2]));
  S._mcTukey = ser(lib._mcTukey([0.1, -0.2, 0.15, 8, -0.05, 0.02], 4.685));
  S._mcBasis_z = ser(lib._mcBasis([0, 0, 1]));
  S._mcBasis_x = ser(lib._mcBasis([1, 0, 0]));
  S._mcBasis_diag = ser(lib._mcBasis([0.6, 0.8, 0]));
  S._mcBasis_nearX = ser(lib._mcBasis([0.9, 0, 0.1]));
  S._mcSolveLin_3x3 = ser(lib._mcSolveLin([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]));
  S._mcSolveLin_5x5 = ser(lib._mcSolveLin(
    [[4, 1, 0, 0, 1], [1, 5, 1, 0, 0], [0, 1, 6, 1, 0], [0, 0, 1, 7, 1], [1, 0, 0, 1, 8]],
    [1, 2, 3, 4, 5]));
  S._mcSolveLin_sing = ser(lib._mcSolveLin([[1, 2, 3], [2, 4, 6], [0, 0, 1]], [1, 2, 3]));
  S._mcDot = ser(lib._mcDot([1.5, -2, 0.25], [4, 0.5, -8]));

  // GEOM — b64
  S.b64_small = ser(lib.b64toArrayBuffer("AAECAwT/"));
  S.b64_fixture = ser(lib.b64toArrayBuffer(readFileSync(`${FIX}/base/scanbody-os.stl`).subarray(0, 120).toString("base64")));

  // extractTopFacePts + extractScanTopFaceNear per type
  for (const t of types) {
    const tf = lib.extractTopFacePts(parsed[t]);
    S[`extractTopFacePts_${t}`] = ser(tf);
    const c = lib.centroid(tf.flat.length >= 3 ? tf.flat : tf.side);
    S[`extractScanTopFaceNear_${t}`] = ser(lib.extractScanTopFaceNear(
      parsed[t], { x: c[0], y: c[1], z: c[2] }, { x: 0, y: 0, z: 1 }, 3.0));
  }

  // getTransformedTriangles: piccolo non-indicizzato, indicizzato, slice fixture
  const mk = (arr) => { const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3)); return g; };
  const small = mk([0,0,0, 1,0,0, 0,1,0,  1,0,0, 1,1,0, 0,1,0,
                    0,0,1, 1,0,1, 0,1,1,  0,0,0, 0,0,1, 0,1,0]);
  const meshS = new THREE.Mesh(small);
  meshS.position.set(0.5, -0.25, 1); meshS.rotation.set(0.1, 0.2, 0.3);
  S.getTransformedTriangles_small = ser(lib.getTransformedTriangles(meshS));
  const gi = new THREE.BufferGeometry();
  gi.setAttribute("position", new THREE.BufferAttribute(new Float32Array(
    [0,0,0, 2,0,0, 0,2,0, 0,0,2]), 3));
  gi.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 1]);
  const meshI = new THREE.Mesh(gi); meshI.position.set(-1, 0.5, 0.25);
  S.getTransformedTriangles_indexed = ser(lib.getTransformedTriangles(meshI));
  const posArr = parsed["scanbody-1t3"].attributes.position.array;
  const meshF = new THREE.Mesh(mk(Array.from(posArr.slice(0, 60 * 9))));
  meshF.rotation.set(0.05, -0.1, 0.15); meshF.position.set(0.2, 0.3, -0.4);
  S.getTransformedTriangles_fixture = ser(lib.getTransformedTriangles(meshF));
  S.getTransformedTriangles_null = ser(lib.getTransformedTriangles(null));

  // intersectPlaneTriangle: attraversa, sopra, nel piano, vertice esattamente a 0
  const P = [0, 0, 0], N = [0, 0, 1];
  S.intersect_cross = ser(lib.intersectPlaneTriangle([[0, 0, -1], [1, 0, 1], [0, 1, 1]], P, N));
  S.intersect_above = ser(lib.intersectPlaneTriangle([[0, 0, 1], [1, 0, 2], [0, 1, 1]], P, N));
  S.intersect_inplane = ser(lib.intersectPlaneTriangle([[0, 0, 0], [1, 0, 0], [0, 1, 0]], P, N));
  S.intersect_vertex0 = ser(lib.intersectPlaneTriangle([[0, 0, 0], [1, 0, 1], [0, 1, -1]], P, N));
  S.intersect_eps = ser(lib.intersectPlaneTriangle([[0, 0, 5e-7], [1, 0, 1], [0, 1, -1]], P, N));

  // extractCutSegments su slice fixture (200 tri), con e senza matrixWorld
  const zs = [];
  for (let i = 2; i < 200 * 9; i += 3) zs.push(posArr[i]);
  const zmid = (Math.min(...zs) + Math.max(...zs)) / 2;
  const gCut = mk(Array.from(posArr.slice(0, 200 * 9)));
  const mw = new THREE.Matrix4().makeRotationY(0.3).setPosition(0.2, -0.1, 0.5);
  S.extractCutSegments_mw = ser(lib.extractCutSegments(gCut, mw, [0.2, -0.1, 0.5 + zmid], [0, 0, 1]));
  S.extractCutSegments_id = ser(lib.extractCutSegments(gCut, null, [0, 0, zmid], [0, 0, 1]));

  // projectTo2D
  S.projectTo2D = ser(lib.projectTo2D([1.5, -2, 3], [0.5, 0.5, 0.5], [1, 0, 0], [0, 0.6, 0.8]));

  // makeGradientTexture: delega a SynRender (stub registratore — prova il verbatim della delega)
  S.makeGradientTexture = ser(lib.makeGradientTexture(0xff0000, 0x0000ff, 35));

  // COLOR
  S.classifyDivergence = ser([0, 14.999, 15, 15.5, 25, 25.1, 44.9, 45, 45.0001, 90, -5, NaN]
    .map((a) => lib.classifyDivergence(a)));
  S.getGroupArrowColor = ser([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8].map((g) => lib.getGroupArrowColor(g)));
  S.getGroupArrowColorInt = ser([0, 1, 5, 6, 11].map((g) => lib.getGroupArrowColorInt(g)));
  const sweep = [-3, 0, 0.1];
  for (let a = 2.5; a <= 92.5; a += 2.5) sweep.push(a);
  sweep.push(90.0001, 120, NaN);
  S.undercutColorForAngle = ser(sweep.map((a) => lib.undercutColorForAngle(a)));
  S._escHtml = ser(['<b a="x">&\'</b>', "plain", "", "a&b<c>d\"e'f"].map((s) => lib._escHtml(s)) +
    "|" + lib._escHtml(null) + "|" + lib._escHtml(undefined) + "|" + lib._escHtml(123));

  return S;
}

// ── confronto ricorsivo con path del primo scostamento ─────────────────────
function diff(a, b, path = "") {
  if (typeof a !== typeof b) return `${path}: tipo ${typeof a} != ${typeof b}`;
  if (typeof a !== "object" || a === null || b === null)
    return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return `${path}: ${ka.length} chiavi != ${kb.length}`;
  for (const k of ka) {
    if (!(k in b)) return `${path}.${k}: chiave assente nel confronto`;
    const d = diff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

// ── main ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const mode = argv.includes("--from-ds") ? "ds" : argv.includes("--from-monolith") ? "monolith" : null;
if (!mode || (!argv.includes("--write-golden") && !argv.includes("--check"))) {
  console.error("uso: gate.mjs (--from-monolith|--from-ds) (--write-golden|--check)");
  process.exit(2);
}

const sources = loadSources(mode);
const sourceMd5 = Object.fromEntries(ALL.map((n) => [n, md5(sources[n])]));
const scenarios = await runScenarios(await buildLib(sources));

if (argv.includes("--write-golden")) {
  if (existsSync(GOLDEN) && !argv.includes("--force"))
    { console.error(`${GOLDEN} esiste gia' (usa --force per sovrascrivere)`); process.exit(2); }
  writeFileSync(GOLDEN, JSON.stringify({ from: mode, functions: ALL.length, sourceMd5, scenarios }, null, 1));
  console.log(`golden scritto: ${GOLDEN} (${ALL.length} funzioni, ${Object.keys(scenarios).length} scenari, from=${mode})`);
} else {
  const g = JSON.parse(readFileSync(GOLDEN, "utf-8"));
  let fail = 0;
  for (const n of ALL)
    if (g.sourceMd5[n] !== sourceMd5[n]) { fail++; console.error(`  FAIL verbatim ${n}: md5 sorgente diverso dal golden`); }
  for (const k of new Set([...Object.keys(g.scenarios), ...Object.keys(scenarios)])) {
    const d = diff(g.scenarios[k], scenarios[k], k);
    if (d) { fail++; console.error(`  FAIL scenario ${d}`); }
  }
  const nS = Object.keys(g.scenarios).length;
  console.log(`Gate purelib (${mode} vs golden): ${nS - Math.min(fail, nS)}/${nS} scenari OK, ` +
              `${ALL.length} sorgenti verbatim ${fail ? "— FALLITO" : "— tutto Object.is-identico"}`);
  process.exit(fail ? 1 : 0);
}
