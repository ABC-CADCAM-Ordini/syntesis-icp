// FASE 6c modularizzazione — estrazione del REPORT PDF di Analizza dal monolite:
//   wf/report-analizza.js  (4 fn: report MUA PDF 6 pagine, §REPORT-MUA-PDF)
// Meccanismo "functions-only" (pattern 6a/6b, LIVE): escono SOLO le function declaration, VERBATIM,
// in <script src> classico non-strict in testa (dopo wf/tree.js). Le 4 fn girano SOLO al click su
// #btnAnalReport (post-analisi): leggono muaObjects/stato/THREE e window.jspdf.jsPDF a CALL-TIME.
// RESTANO nel monolite: il banner §REPORT-MUA-PDF (check_anchors), addCornerLogo (ANNIDATA in altra
// fn), e TUTTO il report MISURARE (misICP_generateReport, §MISURARE-PDF/§CERTIFICATO-TARATURA) +
// la §REPORT-PIPELINE condivisa (mis = fase 6f). addFooter/box/text/placeView sono ANNIDATE dentro
// analReport_generate -> si muovono con lei.
//
//   node scripts/extract_report_f6c.mjs        # applica (rifiuta se già fatto)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

// 4 function declaration del report PDF di Analizza (cluster contiguo §REPORT-MUA-PDF).
export const REPORT_FNS = [
  "analReport_captureViews",
  "analReport_generate",
  "analReport_collectData",
  "analReport_buildRecommendations",
];

const HEADER = `/*
 * wf/report-analizza.js — REPORT PDF del workflow Analizza (Fase 6c modularizzazione, 8.90.0).
 * Terzo file estratto in wf/ (dopo fresabilita.js e tree.js).
 *
 * CONTRATTO: 4 function declaration del report MUA PDF 6 pagine (§REPORT-MUA-PDF): cattura viste 3D
 * multi-angolo, generazione PDF con jsPDF (copertina, analisi angolare, criticità, disegni tecnici,
 * firma), raccolta dati da muaObjects, raccomandazioni testuali. Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a/6b): nessuno stato proprio; leggono muaObjects/scanMesh/
 * renderer/scene/camera/window.SYN/costanti cliniche (MAX_COUPLE_DIVERGENCE/MAX_MILLING_ANGLE/
 * MUA_CONE_HALF_ANGLE) e window.jspdf.jsPDF SOLO a CALL-TIME (click su #btnAnalReport, post-analisi).
 *
 * RESTANO nel monolite (per scelta): il banner §REPORT-MUA-PDF (check_anchors), addCornerLogo
 * (annidata in altra fn), e l'INTERO report MISURARE (misICP_generateReport, §MISURARE-PDF /
 * §CERTIFICATO-TARATURA) + la §REPORT-PIPELINE condivisa — separati da mis, che è fase 6f.
 * addFooter/box/text/placeView sono ANNIDATE dentro analReport_generate e si muovono con lei.
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/tree.js), PRIMA del MAIN. Le fn
 * si limitano a essere DEFINITE a parse-time. VINCOLO: analReport_generate è chiamata dall'handler
 * inline onclick="analReport_generate()" su #btnAnalReport -> deve restare bare-global.
 * GATE: scripts/gate/report/gate.mjs (md5 verbatim per fn + esposizione + residuo) + HARNESS
 * SHIM jsPDF (scripts/gate/report/harness.html): stubba window.jspdf.jsPDF con un proxy che REGISTRA
 * la sequenza di chiamate PDF, stubba captureViews + muaObjects, esegue analReport_generate e verifica
 * che la pipeline giri e produca una sequenza stabile (il PDF binario non è confrontabile; la
 * sequenza di API-call sì — essendo l'estrazione VERBATIM, old==new per costruzione).
 */
`;

function isCommentOrBlank(line) {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}

function main() {
  let src = readFileSync(MONO, "utf-8");
  if (src.includes("§WF-REPORT:") || src.includes("wf/report-analizza.js")) {
    console.error("già applicato"); process.exit(2);
  }

  const spans = REPORT_FNS.map((name) => {
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
      tombstone: `// §WF-REPORT: ${run.map((s) => s.name).join(", ")} → /static/wf/report-analizza.js (Fase 6c, caricato in testa)` });
  }

  removals.sort((a, b) => b.start - a.start);
  for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);

  const anchor = '<script src="/static/wf/tree.js"></script>';
  if (!src.includes(anchor)) throw new Error("anchor wf/tree.js non trovato");
  src = src.replace(anchor, anchor + '\n<script src="/static/wf/report-analizza.js"></script>');

  mkdirSync("backend/static/wf", { recursive: true });
  writeFileSync("backend/static/wf/report-analizza.js", HEADER + "\n" + chunks.join("\n\n") + "\n");
  writeFileSync(MONO, src);
  console.log(`fatto: wf/report-analizza.js = ${REPORT_FNS.length} fn in ${runs.length} run (${removals.length} tombstone §WF-REPORT)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
