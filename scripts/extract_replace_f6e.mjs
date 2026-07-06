// FASE 6e modularizzazione — estrazione del workflow REPLACE-IT dal monolite:
//   wf/replace.js  (92 fn: UI cascata librerie, fetch, seeding 3 punti, allineamento, raffina
//                   client/server, export STL, albero, taglio scansione adattivo, anteprima 3D)
// Meccanismo "functions-only" (pattern 6a/6b/6c/6d, LIVE): escono SOLO le function declaration,
// VERBATIM, in <script src> classico non-strict in testa (dopo wf/sostituire.js). Le fn girano solo
// su interazione: leggono lo STATO replace (replaceMesh/replacePlaced/replaceSeed/replaceCurrent*/
// replacePreviewMoveH/... che RESTA nel monolite, letto anche dal listener pointerdown e da
// selectWorkflow) e window.jspdf/THREE/assets a CALL-TIME. VINCOLO CRITICO (studio): NON toccare la
// FORMULA NDC del picking (clientX-rect.left)/rect.width — vive dentro replacePreviewPickAt e simili,
// preservata PER COSTRUZIONE (estrazione byte-identica). Dimensione 2127 righe < 3k -> file UNICO
// (niente split core/ui). replacePreviewMoveH/UpH sono var stato (10493) assegnate dentro
// replacePreviewAttachInput (si muove con lei). dead-code si annota, non si rimuove (§3.4).
//
//   node scripts/extract_replace_f6e.mjs        # applica (rifiuta se già fatto)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

// 92 function declaration top-level del dominio Replace-iT (embeddate dal grep, ordine irrilevante).
export const REPLACE_FNS = [
  "_replaceApplyView", "_replaceAuthHeaders", "_replaceAxisLabel", "_replaceCutSourceGeo",
  "_replaceDisposeDot", "_replaceDisposeGroup", "_replaceDoExportSTL", "_replaceDoRefine",
  "_replaceEvalFit", "_replaceExtractRefineSets", "_replaceFetchErrMsg", "_replaceLibId",
  "_replaceLibKey", "_replaceMadreProfile", "_replaceMakeOriginAxes", "_replaceNumSprite",
  "_replaceRecordAB", "_replaceRefineTargetNum", "_replaceRemoveCutIslands", "_replaceRotFromOmega",
  "_replaceShowAB", "_replaceSolveLin", "_replaceTrimAxisVec", "_replaceTrimThresholdFromSlider",
  "_replaceTwistAngleDeg", "replaceApplyRenderMode", "replaceBuildCascade", "replaceCascadeReset",
  "replaceClearScene", "replaceConfirmSeed", "replaceDeletePlaced", "replaceEnsureLabelElements",
  "replaceEstimateCylinderAxis", "replaceEstimateMarkerRadius", "replaceExportSTL",
  "replaceFetchLibraries", "replaceFetchMarkerGeo", "replaceFocusImplant", "replaceGeoAxialRange",
  "replaceGuideRender", "replaceICPRead", "replaceLoadLibrary", "replaceLoadScanToScene",
  "replaceMaybeAutoPlace", "replaceNextScanbody", "replaceOnDiamChange", "replaceOnMarcaChange",
  "replaceOnModelloChange", "replaceOnScanPicked", "replaceOnSourceTypeChange", "replaceOnSrcTrim",
  "replaceOnTypeChange", "replaceOnViewportClick", "replacePlaceFromSeed",
  "replacePopulateTypeOptions", "replacePreviewAttachInput", "replacePreviewDispose",
  "replacePreviewInit", "replacePreviewPickAt", "replacePreviewRender", "replacePreviewUpdateCam",
  "replaceRebuildPlacedList", "replaceRebuildScanGeometry", "replaceRebuildTree",
  "replaceRefineAll", "replaceRefineCurrent", "replaceRefineServer", "replaceRenameImplant",
  "replaceResetToSeed", "replaceSeedClear", "replaceSeedUndo", "replaceSeedUpdateUI",
  "replaceSetActiveImplant", "replaceSetMarkerCutOffset", "replaceSetMarkerMeshVis",
  "replaceSetMarkerOpacity", "replaceSetPendingMeshVis", "replaceSetScanOpacity",
  "replaceShowStatus", "replaceStartNewImplant", "replaceStartThreePoint", "replaceSwapFiglio",
  "replaceToggleAllCuts", "replaceToggleMarkerCut", "replaceToggleMarkerOrigin",
  "replaceToggleMarkersCollapse", "replaceTogglePendingOrigin", "replaceTogglePlacedVisibility",
  "replaceToggleScanVisibility", "replaceTrimGeoAlongAxis", "replaceTypeByOrd",
  "replaceUpdateLabels"
];

const HEADER = `/*
 * wf/replace.js — workflow REPLACE-IT di Synthesis-ICP (Fase 6e modularizzazione, 8.92.0).
 * Quinto file estratto in wf/ (dopo fresabilita, tree, report-analizza, sostituire).
 *
 * CONTRATTO: 92 function declaration del dominio Replace-iT — accoppia CAD SORGENTE (brand scansionato)
 * alla scansione, il SOSTITUTO IPD eredita via origine condivisa; cascata librerie Marca/Modello/
 * Diametro, seeding 3-punti, allineamento, raffina client/server (ICP point-to-plane), export STL,
 * albero scena dedicato, taglio scansione adattivo, anteprima 3D trackball. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a-6d): lo STATO resta nel monolite (§REPLACE-IT: replaceMesh/
 * replaceOriginalGeo/replacePlacementMode/replacePickDownX/Y/Shift/replacePlaced/replaceCounter/replaceActiveNum/
 * replaceLibs/replaceCurrentLibId/Detail/Type/replaceSourceType/replaceSubstType/replaceMarkerGeoCache/replacePaletteIdx/
 * replaceSeed/replacePending/replacePreviewMoveH/UpH/replacePreviewCam) — letto anche dal listener
 * pointerdown del MAIN (replacePickDown*) e da selectWorkflow. Banner §REPLACE-IT/§REPLACE-CUT-SCAN
 * restano nel monolite (check_anchors).
 *
 * VINCOLO CRITICO: la FORMULA NDC del picking 3-punti (clientX-rect.left)/rect.width vive dentro le fn
 * (replacePreviewPickAt ecc.) ed è preservata PER COSTRUZIONE (byte-identica). NON reintrodurre mai
 * offsetX/clientWidth (regressione 8.59.2 revocata).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/sostituire.js), PRIMA del MAIN.
 * GATE: scripts/gate/replace/gate.mjs (92 md5-verbatim + esposizione + residuo stato/banner + wiring).
 */
`;

function isCommentOrBlank(line) {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}

function main() {
  let src = readFileSync(MONO, "utf-8");
  if (src.includes("§WF-REPLACE:") || src.includes("wf/replace.js")) {
    console.error("già applicato"); process.exit(2);
  }
  const spans = REPLACE_FNS.map((name) => {
    const fnSrc = extractFunction(src, name);
    const start = src.indexOf(fnSrc);
    if (start < 0 || src.indexOf(fnSrc, start + 1) >= 0) throw new Error(`span non univoco per ${name}`);
    return { name, start, end: start + fnSrc.length, fnSrc };
  }).sort((a, b) => a.start - b.start);
  const runs = [];
  let cur = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const gap = src.slice(spans[i - 1].end, spans[i].start);
    const gapCode = gap.split("\n").some((l) => !isCommentOrBlank(l));
    if (gapCode) { runs.push(cur); cur = [spans[i]]; }
    else cur.push(spans[i]);
  }
  runs.push(cur);
  const removals = [];
  const chunks = [];
  for (const run of runs) {
    let start = run[0].start;
    while (true) {
      const ls = src.lastIndexOf("\n", start - 2) + 1;
      const line = src.slice(ls, start - 1);
      if (line.trim() !== "" && line.trim().startsWith("//")) start = ls;
      else break;
    }
    const end = run[run.length - 1].end;
    const content = src.slice(start, end);
    let rest = content;
    for (const s of run) rest = rest.replace(s.fnSrc, "");
    for (const l of rest.split("\n"))
      if (!isCommentOrBlank(l)) throw new Error(`run [${run[0].name}..] contiene codice non-fn: ${l.trim().slice(0,80)}`);
    chunks.push(content);
    removals.push({ start, end,
      tombstone: `// §WF-REPLACE: ${run.map((s) => s.name).join(", ")} → /static/wf/replace.js (Fase 6e, caricato in testa)` });
  }
  removals.sort((a, b) => b.start - a.start);
  for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);
  const anchor = '<script src="/static/wf/sostituire.js"></script>';
  if (!src.includes(anchor)) throw new Error("anchor wf/sostituire.js non trovato");
  src = src.replace(anchor, anchor + '\n<script src="/static/wf/replace.js"></script>');
  mkdirSync("backend/static/wf", { recursive: true });
  writeFileSync("backend/static/wf/replace.js", HEADER + "\n" + chunks.join("\n\n") + "\n");
  writeFileSync(MONO, src);
  console.log(`fatto: wf/replace.js = ${REPLACE_FNS.length} fn in ${runs.length} run (${removals.length} tombstone §WF-REPLACE)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
