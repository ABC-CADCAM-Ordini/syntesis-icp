// Gate F6f — estrazione workflow MISURARE (wf/misurare-{icp,pdf,viz}.js), parametrizzato per regione.
//   1. VERBATIM: le fn della regione byte-identiche al monolite PRE-estrazione (golden md5 per fn da git HEAD);
//   2. ESPOSIZIONE: il file estratto DEFINISCE tutte le fn come function (probe sandbox);
//   3. RESIDUO INTATTO: lo STATO misICP_*/costanti MIS_* e i banner §MISURARE-*/§ASSE-CILINDRO-CONN/
//      §REPORT-PIPELINE/§CERTIFICATO-TARATURA restano nel monolite;
//   4. il monolite NON definisce più le fn della regione; lo <script src> esiste 1 volta.
//
//   node scripts/gate/mis/gate.mjs <icp|pdf|viz> --write-golden   # PRIMA dell'edit (cattura da HEAD)
//   node scripts/gate/mis/gate.mjs <icp|pdf|viz> --check          # dopo l'estrazione
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractAll } from "../purelib/extract.mjs";
import { MIS_ICP_FNS, MIS_PDF_FNS, MIS_VIZ_FNS } from "../../extract_mis_f6f.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";
const md5 = (s) => createHash("md5").update(s).digest("hex");

const REGIONS = {
  icp: {
    fns: MIS_ICP_FNS, wf: "backend/static/wf/misurare-icp.js", basename: "misurare-icp.js",
    golden: "scripts/gate/mis/golden-icp.json",
    residue: [
      "/* ==== §MISURARE-ICP ==== */", "/* ==== §ASSE-CILINDRO-CONN ==== */",
      "var misICP_stlA", "var misICP_result", "var misICP_seedMode", "var misICP_meshesA",
      "var misICP_connMeshes", "var MIS_ORIGIN_OFFSET", "var MIS_CLIN", "var MIS_SEED_RADIUS",
    ],
  },
  pdf: {
    fns: MIS_PDF_FNS, wf: "backend/static/wf/misurare-pdf.js", basename: "misurare-pdf.js",
    golden: "scripts/gate/mis/golden-pdf.json",
    residue: [
      "/* ==== §MISURARE-PDF ==== */", "/* ==== §REPORT-PIPELINE ==== */",
      "/* ==== §CERTIFICATO-TARATURA ==== */", "var _synScaricoConoImg",
    ],
  },
  viz: {
    fns: MIS_VIZ_FNS, wf: "backend/static/wf/misurare-viz.js", basename: "misurare-viz.js",
    golden: "scripts/gate/mis/golden-viz.json",
    residue: [
      "/* ==== §MISURARE-VIZ ==== */", "var misICP_labels", "var misICP_layerColors",
      "var misICP_cutZoom",
    ],
  },
};

const region = process.argv[2];
const cfg = REGIONS[region];
if (!cfg) { console.error("uso: gate.mjs <icp|pdf|viz> (--write-golden|--check)"); process.exit(2); }
const mode = process.argv.includes("--write-golden") ? "golden" :
             process.argv.includes("--check") ? "check" : null;
if (!mode) { console.error("uso: gate.mjs <icp|pdf|viz> (--write-golden|--check)"); process.exit(2); }

function headMono() { return execSync(`git show HEAD:${MONO}`, { maxBuffer: 128 * 1024 * 1024 }).toString(); }
function wfBody() {
  const t = readFileSync(cfg.wf, "utf-8");
  return t.slice(t.indexOf("*/") + 3).replace(/^\n+/, "");
}

if (mode === "golden") {
  if (existsSync(cfg.golden) && !process.argv.includes("--force"))
    { console.error(`${cfg.golden} esiste già (usa --force)`); process.exit(2); }
  const fns = extractAll(headMono(), cfg.fns);
  writeFileSync(cfg.golden, JSON.stringify({ region, fnMd5: Object.fromEntries(cfg.fns.map((n) => [n, md5(fns[n])])) }, null, 1));
  console.log(`golden scritto: ${cfg.golden} (${cfg.fns.length} fn della regione ${region})`);
  process.exit(0);
}

// mode === "check"
const g = JSON.parse(readFileSync(cfg.golden, "utf-8"));
const work = readFileSync(MONO, "utf-8");
const body = wfBody();
let fail = 0;
const bad = (m) => { fail++; console.error("  FAIL " + m); };

const modFns = extractAll(body, cfg.fns);
for (const n of cfg.fns)
  if (md5(modFns[n]) !== g.fnMd5[n]) bad(`verbatim ${n}: md5 diverso dal golden`);

try {
  const factory = new Function(body + "\n;return {" + cfg.fns.join(",") + "};");
  const defined = factory();
  for (const n of cfg.fns)
    if (typeof defined[n] !== "function") bad(`esposizione ${n}: non è function dopo eval`);
} catch (e) { bad(`eval del modulo fallito: ${e.message}`); }

for (const m of cfg.residue)
  if (!work.includes(m)) bad(`residuo mancante nel monolite: ${m}`);

for (const n of cfg.fns)
  if (new RegExp(`(^|[^A-Za-z0-9_.$])function\\s+${n}\\s*\\(`).test(work)) bad(`monolite definisce ancora ${n}`);
const tag = work.split(`src="/static/wf/${cfg.basename}"`).length - 1;
if (tag !== 1) bad(`<script src wf/${cfg.basename}>: ${tag} occorrenze (attesa 1)`);

console.log(fail ? `Gate mis-${region}: FALLITO (${fail} problemi)` :
  `Gate mis-${region}: OK — ${cfg.fns.length} fn verbatim + esposte, residuo stato/banner intatto, wiring 1:1.`);
process.exit(fail ? 1 : 0);
