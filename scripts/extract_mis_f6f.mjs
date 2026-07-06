// FASE 6f modularizzazione — estrazione del workflow MISURARE (core clinico ICP) dal monolite,
// in TRE file allineati ai banner dell'autore (rilasci incrementali icp -> pdf -> viz):
//   wf/misurare-icp.js  (59 fn: parse STL, componenti, Kabsch/SVD/ICP, seed, run, mount/render)
//   wf/misurare-pdf.js  (41 fn: report PDF 6 pagine, calibrazione, excel)
//   wf/misurare-viz.js  (23 fn: label 3D, cutview, albero CATIA)
//
// Meccanismo "functions-only" (pattern 6a-6e, LIVE): escono SOLO le function declaration VERBATIM,
// in <script src> classico non-strict in testa, PRIMA del MAIN. Le fn girano a CALL-TIME e leggono
// lo STATO misICP_* + costanti MIS_* (che RESTANO nel monolite come residuo) via scope globale.
//
// DIFFERENZA da 6a-6e (motivo dell'estrattore dedicato): la regione mis contiene 3 BANNER INTERNI
// tra funzioni (§ASSE-CILINDRO-CONN, §REPORT-PIPELINE, §CERTIFICATO-TARATURA) elencati nel TOC. La
// macchina 6e li assorbirebbe in un run e li sposterebbe nel file wf -> check_anchors rosso. Qui i
// BANNER BOX (righe con ═║╔╗╚╝╠╣ o "==== §") sono barriere DURE: restano nel monolite, spezzano i
// run e fermano l'assorbimento dei commenti. Solo i doc // per-funzione migrano con la loro funzione.
//
//   node scripts/extract_mis_f6f.mjs icp    # applica la regione ICP (rifiuta se già fatto)
//   node scripts/extract_mis_f6f.mjs pdf
//   node scripts/extract_mis_f6f.mjs viz
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

export const MIS_ICP_FNS = [
  "misICP_pBin", "misICP_pAsc", "misICP_pSTL",
  "misICP_comps", "misICP_cen", "misICP_compBbox",
  "misICP_isScanbody", "misICP_partition", "misICP_autoThresh",
  "misICP_clusterComps", "misICP_clusterCentroid", "misICP_clusterTris",
  "misICP_eye3", "misICP_mul3", "misICP_tr3",
  "misICP_det3", "misICP_mv3", "misICP_jacobi3",
  "misICP_svd3", "misICP_kabsch", "misICP_runICP",
  "misICP_bruteForcePreAlign", "misICP_applyTform", "misICP_cylAxis",
  "misICP_axisAngleDeg", "misICP_detectSbType", "misICP_orientCapward",
  "misICP_orientCapwardSolid", "misICP_capDelta", "misICP_connectionPoint",
  "misICP_onDrop", "misICP_onPick", "misICP_setFile",
  "misICP_updateRunBtn", "misICP_showError", "misICP_clearError",
  "misICP_clinLevel", "misICP_clinAx", "misICP_matchPairs",
  "misICP_run", "misICP_buildMesh", "misICP_renderMeshes",
  "misICP_seedToggle", "misICP_seedSetType", "misICP_seedEnter",
  "misICP_seedPick", "misICP_seedUndo", "misICP_seedUpdatePanel",
  "misICP_seedExit", "misICP_seedAlign", "_misLoadConnGeo",
  "_misDisposeConnObj", "misICP_renderConnections", "misICP_renderPerCylinder",
  "misICP_renderScanbodyList", "misICP_highlightCylinder", "misICP_mountViewport",
  "misICP_unmountViewport", "misICP_reset",
]; // 59 fn

export const MIS_PDF_FNS = [
  "misICP_hexRGB", "misICP_getScaleUm", "misICP_calcScore",
  "misICP_scoreLabel", "misICP_drawCard", "misICP_drawColorMap",
  "misICP_paintView", "misICP_buildReportData", "misICP_fmtDateTime",
  "misICP_fmtDate", "misICP_pdfFooter", "misICP_shadeHex",
  "misICP_pdfDrawCover", "misICP_drawTechCylinder", "misICP_drawTechArrow",
  "misICP_drawTechCentroidDot", "misICP_pdfDrawMethodologyPage", "misICP_pdfDrawValuesGuidePage",
  "misICP_pdfDrawGlossaryPage", "misICP_pdfDrawCylinderPage", "misICP_pdfDrawInterCentroidPage",
  "misICP_drawCentroidGraph", "misICP_renderClinicalPDF", "misICP_calibClassifyUm",
  "misICP_calibClassifyDeg", "misICP_calibWorst", "misICP_openCalibrationModal",
  "misICP_closeCalibrationModal", "misICP_submitCalibration", "misICP_renderCalibrationPDF",
  "misICP_pdfDrawCalibrationCover", "misICP_pdfDrawCalibrationIdPage", "misICP_pdfDrawCalibrationSignaturesPage",
  "misICP_renderAnalysisPDF", "misICP_renderExcel", "misICP_slugifyFilename",
  "misICP_dateTimeSlug", "misICP_toggleReportMenu", "misICP_closeReportMenu",
  "misICP_generateReport", "misICP_generatePDF",
]; // 41 fn

export const MIS_VIZ_FNS = [
  "misICP_createLabels", "misICP_destroyLabels", "misICP_startLabelTracker",
  "misICP_stopLabelTracker", "misICP_updateLabels", "misICP_openCutview",
  "misICP_populateCutSelect", "misICP_toggleCutview", "misICP_showTree",
  "misICP_hideTree", "misICP_toggleTreeGroup", "misICP_groupMeshes",
  "misICP_applyLayerVis", "misICP_applyLayerOp", "misICP_setConnColor",
  "misICP_updateTreeBadges", "misICP_resetTreeDefaults", "misICP_closeCutview",
  "misICP_perpVectors", "misICP_sliceByPlane", "misICP_projectTo2D",
  "misICP_drawCutview", "misICP_bindCutviewWheel",
]; // 23 fn

const REGIONS = {
  icp: {
    fns: MIS_ICP_FNS, wf: "backend/static/wf/misurare-icp.js", tag: "WF-MIS-ICP",
    anchor: '<script src="/static/wf/replace.js"></script>',
    script: '<script src="/static/wf/misurare-icp.js"></script>',
    header: `/*
 * wf/misurare-icp.js — MISURARE motore ICP di Synthesis-ICP (Fase 6f modularizzazione, core clinico).
 * Sesto file estratto in wf/ (dopo fresabilita, tree, report-analizza, sostituire, replace); 1/3 di Misurare.
 *
 * CONTRATTO: 59 function declaration del dominio §MISURARE-ICP — parsing STL bin/ascii, componenti
 * connessi, partizione scanbody/arcata, clustering, Kabsch+SVD3(Jacobi)+ICP nearest-neighbor,
 * brute-force pre-align (permutazioni n<=8), asse cilindro cap-based, tipo scanbody, connessione
 * clinica datum, seeding click-to-seed, orchestratore misICP_run, mount/render viewport. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a-6e): lo STATO resta nel monolite (misICP_stlA/B, trisA/B,
 * meshA/B, result, seed*, meshesA/B, connMeshes, viewportMounted, savedState) + costanti MIS_* (MIS_CLIN,
 * MIS_CLIN_AX, MIS_SEED_RADIUS, MIS_ORIGIN_OFFSET, MIS_COL_* e MIS_OP_*) e i banner §MISURARE-ICP/
 * §ASSE-CILINDRO-CONN (check_anchors). Le fn le leggono/mutano via scope globale a call-time.
 *
 * DIPENDENZE a call-time (tutte hoisted/head-loaded PRIMA del MAIN, verificate dall'audit 6f):
 *  synLog, findScanbodyCenter, showStatus, synAxisEngineRead/synAxisUseLateral (MAIN, hoisted);
 *  parseSTL (ds/syn-math.js), applyRenderModeToScene/syntesisGetUiZoom (ds/syn-env.js, guardate);
 *  scene/camera/renderer/controls/scanMesh/currentWorkflow (var MAIN); THREE (ES-module deferred),
 *  window.SYN. NESSUN accesso a parse-time (0 statement top-level fuori dalle 59 function-decl).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/replace.js), PRIMA del MAIN.
 * GATE: scripts/gate/mis-icp/gate.mjs (59 md5-verbatim + esposizione + residuo + wiring) +
 *       scripts/gate/mis-icp/gate-golden.mjs (spina numerica ICP headless sulle fixtures).
 */
`,
  },
  pdf: {
    fns: MIS_PDF_FNS, wf: "backend/static/wf/misurare-pdf.js", tag: "WF-MIS-PDF",
    anchor: '<script src="/static/wf/misurare-icp.js"></script>',
    script: '<script src="/static/wf/misurare-pdf.js"></script>',
    header: `/*
 * wf/misurare-pdf.js — MISURARE report PDF/Excel di Synthesis-ICP (Fase 6f modularizzazione). 2/3 di Misurare.
 *
 * CONTRATTO: 41 function declaration del dominio §MISURARE-PDF/§REPORT-PIPELINE/§CERTIFICATO-TARATURA —
 * report clinico PDF 6 pagine (jsPDF), disegni tecnici (cilindro/freccia/centroide), grafico centroidi,
 * metodologia/glossario, certificato di taratura (modal + pagine + firme), export Excel (XLSX). Nomi bare globali invariati.
 * Estrazione "functions-only": lo STATO e le costanti restano nel monolite; RESIDUO CRITICO che RESTA:
 * il blocco preload immagine _synScaricoConoImg=new Image(); .src=... (statement parse-time, NON una fn,
 * escluso dall'estrazione) e i banner §MISURARE-PDF/§REPORT-PIPELINE/§CERTIFICATO-TARATURA (check_anchors).
 * DIPENDENZE call-time: window.jspdf (CDN head), XLSX (CDN head), synLog, window.SYN, misICP_result (stato).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/misurare-icp.js), PRIMA del MAIN.
 * GATE: scripts/gate/mis-pdf/gate.mjs (41 md5-verbatim + esposizione + residuo + wiring).
 */
`,
  },
  viz: {
    fns: MIS_VIZ_FNS, wf: "backend/static/wf/misurare-viz.js", tag: "WF-MIS-VIZ",
    anchor: '<script src="/static/wf/misurare-pdf.js"></script>',
    script: '<script src="/static/wf/misurare-viz.js"></script>',
    header: `/*
 * wf/misurare-viz.js — MISURARE viz 3D/albero di Synthesis-ICP (Fase 6f modularizzazione). 3/3 di Misurare.
 *
 * CONTRATTO: 23 function declaration del dominio §MISURARE-VIZ — label 3D HTML tracker (create/update/
 * destroy/start/stop), vista di taglio 2D (cutview: perpVectors/sliceByPlane/projectTo2D/drawCutview/
 * bindCutviewWheel), albero scena CATIA-style (show/hide/toggle/group/layer vis/op, badge, reset). Nomi bare globali invariati.
 * Estrazione "functions-only": lo STATO resta nel monolite (misICP_labels/labelsVisible, labelTrackerOn,
 * layerColors, cutZoom/cutCurrentPair/cutWheelBound) + banner §MISURARE-VIZ (check_anchors).
 * DIPENDENZE call-time: scene/camera/renderer/controls (var MAIN), misICP_result, THREE, syntesisGetUiZoom.
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/misurare-pdf.js), PRIMA del MAIN.
 * GATE: scripts/gate/mis-viz/gate.mjs (23 md5-verbatim + esposizione + residuo + wiring).
 */
`,
  },
};

// Barriera DURA: banner box (bordi ═║╔╗╚╝╠╣ o marker "==== §"). Resta nel monolite.
function isBannerBox(line) { return /[═║╔╗╚╝╠╣]/.test(line) || line.includes("==== §"); }
function isPlainLineComment(line) { const t = line.trim(); return t.startsWith("//") && !isBannerBox(line); }
function isCommentOrBlank(line) {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}
// Gap "assorbibile" = solo commenti/blank E nessuna barriera banner.
function gapIsAbsorbable(gap) {
  return gap.split("\n").every((l) => isCommentOrBlank(l) && !isBannerBox(l));
}

export function extractRegion(region) {
  const cfg = REGIONS[region];
  if (!cfg) throw new Error(`regione sconosciuta: ${region} (icp|pdf|viz)`);
  let src = readFileSync(MONO, "utf-8");
  if (src.includes(`§${cfg.tag}:`) || src.includes(cfg.script)) {
    console.error(`già applicato (${region})`); process.exit(2);
  }
  // 1. span esatto di ogni fn (univoco)
  const spans = cfg.fns.map((name) => {
    const fnSrc = extractFunction(src, name);
    const start = src.indexOf(fnSrc);
    if (start < 0 || src.indexOf(fnSrc, start + 1) >= 0) throw new Error(`span non univoco per ${name}`);
    return { name, start, end: start + fnSrc.length, fnSrc };
  }).sort((a, b) => a.start - b.start);
  // 2. raggruppa in run: due fn adiacenti stanno nello stesso run SOLO se il gap è
  //    interamente commenti/blank SENZA barriere banner (altrimenti il banner spezza).
  const runs = [];
  let cur = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const gap = src.slice(spans[i - 1].end, spans[i].start);
    if (gapIsAbsorbable(gap)) cur.push(spans[i]);
    else { runs.push(cur); cur = [spans[i]]; }
  }
  runs.push(cur);
  // 3. per ogni run: estende start verso l'alto sui SOLI doc // per-funzione (mai su banner box),
  //    verifica che il contenuto sia solo fn + commenti/blank, costruisce il tombstone.
  const removals = [], chunks = [];
  for (const run of runs) {
    let start = run[0].start;
    while (true) {
      const ls = src.lastIndexOf("\n", start - 2) + 1;
      const line = src.slice(ls, start - 1);
      if (line.trim() !== "" && isPlainLineComment(line)) start = ls;
      else break;
    }
    const end = run[run.length - 1].end;
    const content = src.slice(start, end);
    let rest = content;
    for (const s of run) rest = rest.replace(s.fnSrc, "");
    for (const l of rest.split("\n")) {
      if (isCommentOrBlank(l) && !isBannerBox(l)) continue;
      throw new Error(`run [${run[0].name}..] contiene codice/banner non estraibile: ${l.trim().slice(0, 80)}`);
    }
    chunks.push(content);
    removals.push({ start, end,
      tombstone: `// §${cfg.tag}: ${run.map((s) => s.name).join(", ")} → /static/wf/${cfg.wf.split("/").pop()} (Fase 6f, caricato in testa)` });
  }
  // 4. rimozione bottom-up + tombstone
  removals.sort((a, b) => b.start - a.start);
  for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);
  // 5. inserisci lo <script src> dopo l'anchor
  if (!src.includes(cfg.anchor)) throw new Error(`anchor ${cfg.anchor} non trovato`);
  src = src.replace(cfg.anchor, cfg.anchor + "\n" + cfg.script);
  // 6. scrivi wf + monolite
  mkdirSync("backend/static/wf", { recursive: true });
  writeFileSync(cfg.wf, cfg.header + "\n" + chunks.join("\n\n") + "\n");
  writeFileSync(MONO, src);
  console.log(`fatto: ${cfg.wf.split("/").pop()} = ${cfg.fns.length} fn in ${runs.length} run (${removals.length} tombstone §${cfg.tag})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const region = process.argv[2];
  if (!REGIONS[region]) { console.error("uso: node scripts/extract_mis_f6f.mjs <icp|pdf|viz>"); process.exit(2); }
  extractRegion(region);
}
