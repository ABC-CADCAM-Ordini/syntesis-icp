// Gate GOLDEN-MASTER numerico F6f (complementare al verbatim) — prova che la SPINA ICP di Misurare
// "misura identico" dopo l'estrazione. Esegue headless (senza THREE/DOM) la pipeline numerica di
// misICP_run (parse STL -> componenti -> partizione -> cluster -> pre-align -> ICP -> deviazioni
// ΔXY/ΔZ/ΔD3D -> asse -> connessione datum -> classi cliniche) sulle fixtures sintetiche A/B (T rigida
// nota -> deviazione ideale 0), poi confronta il vettore numerico old(HEAD) vs new(wf/misurare-icp.js).
//
//   node scripts/gate/mis/gate-golden.mjs --write-golden   # cattura da HEAD (git show), PRIMA dell'estrazione
//   node scripts/gate/mis/gate-golden.mjs --check          # riesegue sul file estratto e confronta
//   node scripts/gate/mis/gate-golden.mjs --self           # esegue su HEAD e stampa (sanity/determinismo)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractAll } from "../purelib/extract.mjs";

const ROOT = process.cwd();
const MONO = "backend/static/syntesis-analyzer-v3b.html";
const WF_ICP = "backend/static/wf/misurare-icp.js";
const GOLDEN = "scripts/gate/mis/golden-master.json";
const FIX = "tests/fixtures/stl/pairs";
const md5 = (s) => createHash("md5").update(s).digest("hex");

// 33 fn PURE della spina ICP (nessun DOM/THREE) — sottoinsieme di MIS_ICP_FNS.
const PURE = [
  "misICP_pBin", "misICP_pAsc", "misICP_pSTL", "misICP_comps", "misICP_cen", "misICP_compBbox",
  "misICP_isScanbody", "misICP_partition", "misICP_autoThresh", "misICP_clusterComps",
  "misICP_clusterCentroid", "misICP_clusterTris", "misICP_eye3", "misICP_mul3", "misICP_tr3",
  "misICP_det3", "misICP_mv3", "misICP_jacobi3", "misICP_svd3", "misICP_kabsch", "misICP_runICP",
  "misICP_bruteForcePreAlign", "misICP_applyTform", "misICP_cylAxis", "misICP_axisAngleDeg",
  "misICP_detectSbType", "misICP_orientCapward", "misICP_orientCapwardSolid", "misICP_capDelta",
  "misICP_connectionPoint", "misICP_clinLevel", "misICP_clinAx", "misICP_matchPairs",
];
const TYPES = ["scanbody-1t3", "scanbody-os", "scanbody-sr", "multi-1t3-5x"];

// Residuo del monolite necessario alla spina (costanti + helper cross-dominio), verbatim/dal registry.
const MIS_ORIGIN_OFFSET = { SR: 3.786, OS: 5.574, "1T3": 8.146 };
const win = { SYN: { scanbody: {
  "1T3": { radius_mm: 2.515, cap_z_mm: 10 }, OS: { radius_mm: 1.78, cap_z_mm: 6 }, SR: { radius_mm: 2.03, cap_z_mm: 5 } },
  thresholds: { d3_um: [50, 100, 150, 250], angular_deg: [0.5, 1.5, 3, 6] },
  palette: { d3_hex: ["#639922", "#D97706", "#F97316", "#EF4444", "#A855F7"] } } };
const MIS_CLIN = (function () { var labels = ["Ottimo", "Accettabile", "Rischioso", "Tensione", "Fuori posizione"]; var thr = win.SYN.thresholds.d3_um; var pal = win.SYN.palette.d3_hex; var maxs = thr.concat([9999]); return labels.map(function (lbl, i) { return { max: maxs[i], label: lbl, col: pal[i] }; }); })();
const MIS_CLIN_AX = (function () { var labels = ["Ottimo", "Accettabile", "Rischioso", "Tensione", "Fuori"]; var thr = win.SYN.thresholds.angular_deg; var pal = win.SYN.palette.d3_hex; var maxs = thr.concat([9999]); return labels.map(function (lbl, i) { return { max: maxs[i], label: lbl, col: pal[i] }; }); })();
function synAxisEngineRead(onThrow) { try { return globalThis.localStorage.getItem("syntesis_axis_engine") || "auto"; } catch (e) { return onThrow; } }
function synAxisUseLateral(isSR, onThrow) { var e = synAxisEngineRead(onThrow); return (e === "lateralwall") || (e === "auto" && isSR); }

function buildModule(src) {
  const fns = extractAll(src, PURE);
  const body = PURE.map((n) => fns[n]).join("\n");
  return new Function("window", "MIS_ORIGIN_OFFSET", "MIS_CLIN", "MIS_CLIN_AX", "synAxisUseLateral", "synAxisEngineRead",
    body + "\n;return {" + PURE.join(",") + "};")(win, MIS_ORIGIN_OFFSET, MIS_CLIN, MIS_CLIN_AX, synAxisUseLateral, synAxisEngineRead);
}
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const f6 = (x) => (x == null || !isFinite(x)) ? String(x) : x.toFixed(6);

// Spina numerica FEDELE a misICP_run (r.4751-4918) senza DOM/THREE/render.
function runSpine(M, type) {
  const A = toAB(readFileSync(`${ROOT}/${FIX}/${type}_A.stl`));
  const B = toAB(readFileSync(`${ROOT}/${FIX}/${type}_B.stl`));
  const triA = M.misICP_pSTL(A), triB = M.misICP_pSTL(B);
  const compsA = M.misICP_comps(triA), compsB = M.misICP_comps(triB);
  const partA = M.misICP_partition(triA, compsA), partB = M.misICP_partition(triB, compsB);
  const rawA = partA.scan.map((ci) => M.misICP_cen(triA, compsA[ci]));
  const rawB = partB.scan.map((ci) => M.misICP_cen(triB, compsB[ci]));
  const thresh = Math.max(M.misICP_autoThresh(rawA), M.misICP_autoThresh(rawB));
  const clA = M.misICP_clusterComps(rawA, thresh), clB = M.misICP_clusterComps(rawB, thresh);
  const centsA = clA.map((cl) => M.misICP_clusterCentroid(triA, compsA, partA.scan, cl));
  const centsB = clB.map((cl) => M.misICP_clusterCentroid(triB, compsB, partB.scan, cl));
  const pre = M.misICP_bruteForcePreAlign(centsA, centsB);
  const preUsable = (pre.n >= 3 && pre.n <= 8 && isFinite(pre.rmsd));
  const centsBpre = preUsable ? centsB.map((p) => { const rp = M.misICP_mv3(pre.R, p); return [rp[0] + pre.t[0], rp[1] + pre.t[1], rp[2] + pre.t[2]]; }) : centsB;
  let icp = M.misICP_runICP(centsA, centsBpre, 60);
  if (preUsable && icp.rmsd > pre.rmsd) icp = { R: M.misICP_eye3(), t: [0, 0, 0], rmsd: pre.rmsd };
  if (preUsable) { const Rc = M.misICP_mul3(icp.R, pre.R); const Rtp = M.misICP_mv3(icp.R, pre.t); icp = { R: Rc, t: [Rtp[0] + icp.t[0], Rtp[1] + icp.t[1], Rtp[2] + icp.t[2]], rmsd: icp.rmsd }; }
  const triBt = M.misICP_applyTform(triB, icp.R, icp.t);
  const centsBt = centsB.map((p) => { const rp = M.misICP_mv3(icp.R, p); return [rp[0] + icp.t[0], rp[1] + icp.t[1], rp[2] + icp.t[2]]; });
  const pairs = M.misICP_matchPairs(centsA, centsBt);
  const rows = [];
  for (const p of pairs) {
    if (p.iB < 0) { rows.push([p.iA, -1]); continue; }
    const trisA = M.misICP_clusterTris(triA, compsA, partA.scan, clA[p.iA]);
    const trisBt = M.misICP_clusterTris(triBt, compsB, partB.scan, clB[p.iB]);
    const axA = M.misICP_cylAxis(trisA), axBt = M.misICP_cylAxis(trisBt);
    const axDeg = M.misICP_axisAngleDeg(axA, axBt);
    // ramo connessione datum (misICP_run r.4886-4918)
    const sb = M.misICP_detectSbType(trisA);
    let connD3 = null, connLbl = null, sbType = null, lvl = M.misICP_clinLevel(Math.round(p.d3 * 1000)).label;
    if (sb) {
      sbType = sb.type;
      const cenA = centsA[p.iA], cenB = centsBt[p.iB];
      const solid = (sb.type === "SR");
      const axAc = solid ? M.misICP_orientCapwardSolid(trisA, cenA, axA) : M.misICP_orientCapward(trisA, cenA, axA);
      let axBc = trisBt ? (solid ? M.misICP_orientCapwardSolid(trisBt, cenB, axBt) : M.misICP_orientCapward(trisBt, cenB, axBt)) : axBt.slice();
      if (axBc[0] * axAc[0] + axBc[1] * axAc[1] + axBc[2] * axAc[2] < 0) axBc = [-axBc[0], -axBc[1], -axBc[2]];
      const L = (MIS_ORIGIN_OFFSET[sb.type] != null) ? MIS_ORIGIN_OFFSET[sb.type] : (sb.capZ - M.misICP_capDelta(trisA, cenA, axAc));
      const cA = [cenA[0] - L * axAc[0], cenA[1] - L * axAc[1], cenA[2] - L * axAc[2]];
      const cB = [cenB[0] - L * axBc[0], cenB[1] - L * axBc[1], cenB[2] - L * axBc[2]];
      const cdx = (cB[0] - cA[0]) * 1000, cdy = (cB[1] - cA[1]) * 1000, cdz = (cB[2] - cA[2]) * 1000;
      connD3 = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
      lvl = M.misICP_clinLevel(Math.round(connD3)).label;
      connLbl = lvl;
    }
    rows.push([p.iA, p.iB, f6(p.d3 * 1000), f6(p.dxy * 1000), f6(p.dx * 1000), f6(p.dy * 1000), f6(p.dz * 1000),
               f6(axDeg), f6(connD3), sbType, lvl, M.misICP_clinAx(axDeg).label]);
  }
  return { n: centsA.length, thresh: f6(thresh), rmsdUm: f6(icp.rmsd * 1000), preUsable, rows };
}

function computeAll(src) {
  const M = buildModule(src);
  const out = {};
  for (const t of TYPES) out[t] = runSpine(M, t);
  return out;
}
function headMono() { return execSync(`git show HEAD:${MONO}`, { maxBuffer: 128 * 1024 * 1024 }).toString(); }

const mode = process.argv.includes("--write-golden") ? "golden" :
             process.argv.includes("--check") ? "check" :
             process.argv.includes("--self") ? "self" : null;
if (!mode) { console.error("uso: gate-golden.mjs (--write-golden|--check|--self)"); process.exit(2); }

if (mode === "self" || mode === "golden") {
  const res = computeAll(headMono());
  if (mode === "self") {
    for (const t of TYPES) {
      const r = res[t];
      console.log(`\n${t}: n=${r.n} preUsable=${r.preUsable} thr=${r.thresh} rmsdUm=${r.rmsdUm}`);
      for (const row of r.rows) console.log("  " + JSON.stringify(row));
    }
    // sanity ground-truth: deviazioni centroide ~0 su tutte le coppie matchate
    let sane = true;
    for (const t of TYPES) for (const row of res[t].rows)
      if (row[1] >= 0 && Math.abs(parseFloat(row[2])) > 0.01) { sane = false; console.error(`  SANITY FAIL ${t} pair ${row[0]}: d3=${row[2]}um (atteso ~0)`); }
    console.log(sane ? "\nSANITY OK: deviazione per-centroide ~0 su tutte le coppie (ground-truth recuperato)." : "\nSANITY FAIL");
    process.exit(sane ? 0 : 1);
  }
  if (existsSync(GOLDEN) && !process.argv.includes("--force")) { console.error(`${GOLDEN} esiste già (usa --force)`); process.exit(2); }
  const payload = JSON.stringify(res, null, 1);
  writeFileSync(GOLDEN, payload);
  console.log(`golden-master scritto: ${GOLDEN} (${TYPES.length} tipi, md5=${md5(payload).slice(0, 12)})`);
  process.exit(0);
}

// mode === "check": riesegui la spina sulle fn ESTRATTE e confronta col golden
if (!existsSync(WF_ICP)) { console.error(`${WF_ICP} assente: estrai prima wf/misurare-icp.js`); process.exit(2); }
if (!existsSync(GOLDEN)) { console.error(`${GOLDEN} assente: esegui --write-golden a HEAD`); process.exit(2); }
const wfSrc = readFileSync(WF_ICP, "utf-8");
const golden = readFileSync(GOLDEN, "utf-8");
const now = JSON.stringify(computeAll(wfSrc), null, 1);
if (md5(now) === md5(golden)) {
  console.log(`Gate golden-master mis-icp: OK — spina ICP numericamente IDENTICA a HEAD (${TYPES.length} tipi, md5=${md5(now).slice(0, 12)}).`);
  process.exit(0);
}
// diff dettagliato
const gj = JSON.parse(golden), nj = JSON.parse(now);
for (const t of TYPES) if (JSON.stringify(gj[t]) !== JSON.stringify(nj[t])) console.error(`  DIVERGE ${t}:\n    golden=${JSON.stringify(gj[t])}\n    new   =${JSON.stringify(nj[t])}`);
console.error("Gate golden-master mis-icp: FALLITO — la spina estratta NON misura identico a HEAD.");
process.exit(1);
