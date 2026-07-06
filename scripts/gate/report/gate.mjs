// Gate F6c — estrazione REPORT PDF Analizza (wf/report-analizza.js).
//   1. VERBATIM: le 4 fn byte-identiche al monolite PRE-estrazione (golden md5 per fn da git HEAD);
//   2. ESPOSIZIONE: il file valutato DEFINISCE tutte e 4 le fn come function (probe sandbox);
//   3. RESIDUO INTATTO: banner §REPORT-MUA-PDF + report Misurare (misICP_generateReport) +
//      addCornerLogo (annidata) restano nel monolite;
//   4. il monolite NON definisce più le 4 fn; lo <script src> esiste 1 volta.
// (Il comportamento del PDF è verificato a parte dall'harness shim jsPDF: harness.html.)
//
//   node scripts/gate/report/gate.mjs --write-golden   # PRIMA dell'edit
//   node scripts/gate/report/gate.mjs --check          # dopo
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractAll } from "../purelib/extract.mjs";
import { REPORT_FNS } from "../../extract_report_f6c.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";
const WF = "backend/static/wf/report-analizza.js";
const GOLDEN = "scripts/gate/report/golden.json";
const md5 = (s) => createHash("md5").update(s).digest("hex");

const RESIDUE = [
  "/* ==== §REPORT-MUA-PDF ==== */",       // banner (resta, check_anchors)
  "function misICP_generateReport(",        // report Misurare (resta, fase 6f)
  "function addCornerLogo(useWhite){",      // helper annidato condiviso (resta)
];

function headMono() { return execSync(`git show HEAD:${MONO}`, { maxBuffer: 64 * 1024 * 1024 }).toString(); }
function wfBody() {
  const t = readFileSync(WF, "utf-8");
  return t.slice(t.indexOf("*/") + 3).replace(/^\n+/, "");
}

const mode = process.argv.includes("--write-golden") ? "golden" :
             process.argv.includes("--check") ? "check" : null;
if (!mode) { console.error("uso: gate.mjs (--write-golden|--check)"); process.exit(2); }

if (mode === "golden") {
  if (existsSync(GOLDEN) && !process.argv.includes("--force"))
    { console.error(`${GOLDEN} esiste già (usa --force)`); process.exit(2); }
  const fns = extractAll(headMono(), REPORT_FNS);
  writeFileSync(GOLDEN, JSON.stringify({ fnMd5: Object.fromEntries(REPORT_FNS.map((n) => [n, md5(fns[n])])) }, null, 1));
  console.log(`golden scritto: ${GOLDEN} (${REPORT_FNS.length} fn)`);
  process.exit(0);
}

const g = JSON.parse(readFileSync(GOLDEN, "utf-8"));
const work = readFileSync(MONO, "utf-8");
const body = wfBody();
let fail = 0;
const bad = (m) => { fail++; console.error("  FAIL " + m); };

const modFns = extractAll(body, REPORT_FNS);
for (const n of REPORT_FNS)
  if (md5(modFns[n]) !== g.fnMd5[n]) bad(`verbatim ${n}: md5 diverso dal golden`);

try {
  const factory = new Function(body + "\n;return {" + REPORT_FNS.join(",") + "};");
  const defined = factory();
  for (const n of REPORT_FNS)
    if (typeof defined[n] !== "function") bad(`esposizione ${n}: non è function dopo eval`);
} catch (e) { bad(`eval del modulo fallito: ${e.message}`); }

for (const m of RESIDUE)
  if (!work.includes(m)) bad(`residuo mancante nel monolite: ${m}`);

for (const n of REPORT_FNS)
  if (new RegExp(`(^|[^A-Za-z0-9_.$])function\\s+${n}\\s*\\(`).test(work)) bad(`monolite definisce ancora ${n}`);
const tag = work.split('src="/static/wf/report-analizza.js"').length - 1;
if (tag !== 1) bad(`<script src wf/report-analizza.js>: ${tag} occorrenze (attesa 1)`);

console.log(fail ? `Gate report: FALLITO (${fail} problemi)` :
  `Gate report: OK — ${REPORT_FNS.length} fn verbatim + esposte, residuo banner/mis/addCornerLogo intatto, wiring 1:1.`);
process.exit(fail ? 1 : 0);
