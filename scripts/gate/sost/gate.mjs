// Gate F6d — estrazione workflow SOSTITUIRE (wf/sostituire.js).
//   1. VERBATIM: le 45 fn byte-identiche al monolite PRE-estrazione (golden md5 per fn da git HEAD);
//   2. ESPOSIZIONE: il file valutato DEFINISCE tutte e 45 le fn come function (probe sandbox);
//   3. RESIDUO INTATTO: lo STATO sost (sostMesh/sostPlaced/sostStl/...) e il banner §SOSTITUIRE
//      restano nel monolite;
//   4. il monolite NON definisce più le 45 fn; lo <script src> esiste 1 volta.
//
//   node scripts/gate/sost/gate.mjs --write-golden   # PRIMA dell'edit
//   node scripts/gate/sost/gate.mjs --check          # dopo
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractAll } from "../purelib/extract.mjs";
import { SOST_FNS } from "../../extract_sost_f6d.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";
const WF = "backend/static/wf/sostituire.js";
const GOLDEN = "scripts/gate/sost/golden.json";
const md5 = (s) => createHash("md5").update(s).digest("hex");

const RESIDUE = [
  "/* ==== §SOSTITUIRE ==== */",
  "var sostStl = null;",
  "var sostMesh = null;",
  "var sostPlaced = [];",
  "var sostPlacementMode = false;",
  "var sostCounter = 0;",
  "var sostOriginalGeo = null;",
  "var _sostExportPending = null;",
  "var sostCutState = {",
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
  const fns = extractAll(headMono(), SOST_FNS);
  writeFileSync(GOLDEN, JSON.stringify({ fnMd5: Object.fromEntries(SOST_FNS.map((n) => [n, md5(fns[n])])) }, null, 1));
  console.log(`golden scritto: ${GOLDEN} (${SOST_FNS.length} fn)`);
  process.exit(0);
}

const g = JSON.parse(readFileSync(GOLDEN, "utf-8"));
const work = readFileSync(MONO, "utf-8");
const body = wfBody();
let fail = 0;
const bad = (m) => { fail++; console.error("  FAIL " + m); };

const modFns = extractAll(body, SOST_FNS);
for (const n of SOST_FNS)
  if (md5(modFns[n]) !== g.fnMd5[n]) bad(`verbatim ${n}: md5 diverso dal golden`);

try {
  const factory = new Function(body + "\n;return {" + SOST_FNS.join(",") + "};");
  const defined = factory();
  for (const n of SOST_FNS)
    if (typeof defined[n] !== "function") bad(`esposizione ${n}: non è function dopo eval`);
} catch (e) { bad(`eval del modulo fallito: ${e.message}`); }

for (const m of RESIDUE)
  if (!work.includes(m)) bad(`residuo mancante nel monolite: ${m}`);

for (const n of SOST_FNS)
  if (new RegExp(`(^|[^A-Za-z0-9_.$])function\\s+${n}\\s*\\(`).test(work)) bad(`monolite definisce ancora ${n}`);
const tag = work.split('src="/static/wf/sostituire.js"').length - 1;
if (tag !== 1) bad(`<script src wf/sostituire.js>: ${tag} occorrenze (attesa 1)`);

console.log(fail ? `Gate sost: FALLITO (${fail} problemi)` :
  `Gate sost: OK — ${SOST_FNS.length} fn verbatim + esposte, residuo stato/banner intatto, wiring 1:1.`);
process.exit(fail ? 1 : 0);
