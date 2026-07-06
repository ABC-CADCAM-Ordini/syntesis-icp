// FASE 6d modularizzazione — estrazione del workflow SOSTITUIRE dal monolite:
//   wf/sostituire.js  (45 fn: placement scanbody via click, motore robusto centro+asse, export STL,
//                      albero, cutview; §SOSTITUIRE + funzioni sparse fino a ~15400)
// Meccanismo "functions-only" (pattern 6a/6b/6c, LIVE): escono SOLO le function declaration,
// VERBATIM, in <script src> classico non-strict in testa (dopo wf/report-analizza.js). Le fn girano
// solo su interazione (post-caricamento): leggono lo STATO sost (sostMesh/sostPlaced/sostStl/... che
// RESTA nel monolite, letto anche da tree/selectWorkflow) e SOSTITUIRE_TEMPLATES_B64 (assets, F1) a
// CALL-TIME. Le fn sono SPARSE (3 zone: §SOSTITUIRE ~10432-10622, sostApplyRenderMode ~11944, motore
// ~13161-15356), interlacciate con funzioni replace e con le var di stato -> l'estrattore per-nome
// con run-detection produce piu' run/tombstone. _sostFinishRefine/_sostRefineRound sono ANNIDATE
// dentro sostAlignAll (si muovono con lei). VERBATIM: la precisione del placement (rituale RMSD
// centroide 7,9µm sul sintetico-su-sintetico) e' preservata per costruzione (byte-identica).
//
//   node scripts/extract_sost_f6d.mjs        # applica (rifiuta se già fatto)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

// 45 function declaration top-level del dominio Sostituire (ordine irrilevante: estrazione per-nome).
// (F6d ne estrasse 47; _sostLocalWallAxis + sostTogglePlacedVisibility rimosse come dead-code in 8.95.3)
export const SOST_FNS = [
  "sostDecodeTemplate", "sostParseSTLToGeometry", "sostShowStatus", "sostOnSourceChange",
  "sostOnScanPicked", "sostLoadScanToScene", "sostStartPlacement", "sostOnViewportClick",
  "sostEnsureLabelElements", "sostUpdateLabels", "sostApplyRenderMode", "sostBuildTemplateGroup",
  "sostRobustCenter", "_sostCylFitInvariant", "_sostGeomWallAxis",
  "_sostCapPlaneOn", "_sostCapPlaneFit", "_sostCapAnchoredPose", "_sostMCOn", "_sostMethodCFit",
  "_sostMethodCPose", "sostPlaceTemplate", "sostAlignAll", "sostRenderPlacedList", "sostDownloadDiagLog",
  "sostExportSTL", "_sostDoExport", "sostBuildExportTriangles", "sostSerializeBinarySTL", "sostRemovePlaced",
  "sostUpdateRefineButtonState", "_sostDisposePlaced", "sostClearScene", "sostRebuildTree",
  "sostToggleGroupCollapse", "sostOnGroupOpacityChange", "sostToggleScanVisibility", "sostToggleLabelsVisibility",
  "sostToggleScanCut", "sostRebuildScanGeometry", "sostOnScanOpacityChange", "sostTogglePlacedTplVisibility",
  "sostToggleGroupVisibility", "sostOpenCutView", "sostRenderCutView",
];

const HEADER = `/*
 * wf/sostituire.js — workflow SOSTITUIRE di Synthesis-ICP (Fase 6d modularizzazione, 8.91.0).
 * Quarto file estratto in wf/ (dopo fresabilita, tree, report-analizza).
 *
 * CONTRATTO: 47 function declaration del dominio Sostituire — carica una scansione Multi-A, l'utente
 * clicca il marker, il sistema piazza il template scanbody con findScanbodyCenter (centro+asse
 * deterministici), motore robusto centro+asse (Kasa/wall/cap-plane/Method C), raffina, esporta STL,
 * albero scena dedicato, cutview. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a/6b/6c): lo STATO resta nel monolite alla posizione
 * originale (§SOSTITUIRE: sostStl/sostMesh/sostActiveTemplate/sostTemplateBuffers/sostPlacementMode/
 * sostPlaced/sostScanUI/sostLabelsUI/sostOriginalGeo/sostGroupUI/sostCounter/sostSourceTemplate +
 * _sostInvLastReason/sostAlignInProgress/_sostExportPending/sostCutState) — letto anche da
 * wf/tree.js (rebuildTree legge sostMesh/sostPlaced) e da selectWorkflow. Il banner §SOSTITUIRE
 * resta nel monolite (check_anchors). SOSTITUIRE_TEMPLATES_B64 è già in assets/ (F1).
 * _sostFinishRefine/_sostRefineRound sono ANNIDATE dentro sostAlignAll (si muovono con lei).
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/report-analizza.js), PRIMA del
 * MAIN. Le fn si limitano a essere DEFINITE a parse-time; leggono stato/THREE/scene/DOM/assets solo
 * a CALL-TIME. VINCOLO: molte fn sono handler inline (16) + call-site da selectWorkflow/tree/ds ->
 * bare-global. RMSD centroide 7,9µm (sintetico-su-sintetico) preservato per verbatim.
 * GATE: scripts/gate/sost/gate.mjs (47 md5-verbatim per fn + esposizione + residuo stato/banner +
 * wiring) + harness browser (smoke funzioni pure/UI dove stubbabile).
 */
`;

function isCommentOrBlank(line) {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}

function main() {
  let src = readFileSync(MONO, "utf-8");
  if (src.includes("§WF-SOST:") || src.includes("wf/sostituire.js")) {
    console.error("già applicato"); process.exit(2);
  }

  const spans = SOST_FNS.map((name) => {
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
      tombstone: `// §WF-SOST: ${run.map((s) => s.name).join(", ")} → /static/wf/sostituire.js (Fase 6d, caricato in testa)` });
  }

  removals.sort((a, b) => b.start - a.start);
  for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);

  const anchor = '<script src="/static/wf/report-analizza.js"></script>';
  if (!src.includes(anchor)) throw new Error("anchor wf/report-analizza.js non trovato");
  src = src.replace(anchor, anchor + '\n<script src="/static/wf/sostituire.js"></script>');

  mkdirSync("backend/static/wf", { recursive: true });
  writeFileSync("backend/static/wf/sostituire.js", HEADER + "\n" + chunks.join("\n\n") + "\n");
  writeFileSync(MONO, src);
  console.log(`fatto: wf/sostituire.js = ${SOST_FNS.length} fn in ${runs.length} run (${removals.length} tombstone §WF-SOST)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
