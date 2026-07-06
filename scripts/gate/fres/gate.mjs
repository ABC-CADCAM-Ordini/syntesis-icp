// Gate F6a — estrazione workflow fresabilita (wf/fresabilita.js).
// Prova strutturale della rilocazione functions-only (complemento dell'harness browser):
//   1. VERBATIM: le 34 fn di wf/fresabilita.js byte-identiche al monolite PRE-estrazione
//      (golden = md5 per funzione, catturato da git HEAD prima dell'edit);
//   2. ESPOSIZIONE: il file, valutato, DEFINISCE tutte e 34 le fn come function (probe
//      sandbox: le globali referenziate nei corpi non servono, sono lette a call-time);
//   3. RESIDUO INTATTO: il monolite conserva ancora stato + banner + monkey-patch
//      (FRES_BUILTIN_MACHINES/fresState/fresOverlayScene, §FRESABILITA, calculateAngles wrap);
//   4. il monolite NON definisce piu' le 34 fn; lo <script src> wf/ esiste 1 volta.
//
//   node scripts/gate/fres/gate.mjs --write-golden   # PRIMA dell'edit (old = git HEAD)
//   node scripts/gate/fres/gate.mjs --check          # dopo, e per ogni futuro edit
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractAll, extractFunction } from "../purelib/extract.mjs";
import { FRES_FNS } from "../../extract_fres_f6a.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";
const WF = "backend/static/wf/fresabilita.js";
const GOLDEN = "scripts/gate/fres/golden.json";
const md5 = (s) => createHash("md5").update(s).digest("hex");

// residuo che DEVE restare nel monolite (stato + banner + monkey-patch)
const RESIDUE = [
  "/* ==== §FRESABILITA ==== */",
  "var FRES_BUILTIN_MACHINES = [",
  "var FRES_STORAGE_KEY = 'syntesisIcp.fresability.v1';",
  "var FRES_PROXIMITY_DEG = 2.0;",
  "var fresState = {",
  "var fresOverlayScene = null;",
  "var fresOverlayLights = null;",
  "var _origCalc = calculateAngles;",       // monkey-patch
  "if(fresState.isOpen) fresRecompute();",   // corpo del wrap
];

function headMono() { return execSync(`git show HEAD:${MONO}`, { maxBuffer: 64 * 1024 * 1024 }).toString(); }

// modulo estratto: contenuto al netto dell'header /* ... */
function wfBody() {
  const t = readFileSync(WF, "utf-8");
  return t.slice(t.indexOf("*/") + 3).replace(/^\n+/, "");
}

const mode = process.argv.includes("--write-golden") ? "golden" :
             process.argv.includes("--check") ? "check" : null;
if (!mode) { console.error("uso: gate.mjs (--write-golden|--check)"); process.exit(2); }

if (mode === "golden") {
  if (existsSync(GOLDEN) && !process.argv.includes("--force"))
    { console.error(`${GOLDEN} esiste gia' (usa --force)`); process.exit(2); }
  const fns = extractAll(headMono(), FRES_FNS);
  writeFileSync(GOLDEN, JSON.stringify({
    fnMd5: Object.fromEntries(FRES_FNS.map((n) => [n, md5(fns[n])])),
  }, null, 1));
  console.log(`golden scritto: ${GOLDEN} (${FRES_FNS.length} fn)`);
  process.exit(0);
}

// ── check ───────────────────────────────────────────────────────────────────
const g = JSON.parse(readFileSync(GOLDEN, "utf-8"));
const work = readFileSync(MONO, "utf-8");
const body = wfBody();
let fail = 0;
const bad = (m) => { fail++; console.error("  FAIL " + m); };

// 1. verbatim per-funzione (modulo vs golden)
const modFns = extractAll(body, FRES_FNS);
for (const n of FRES_FNS)
  if (md5(modFns[n]) !== g.fnMd5[n]) bad(`verbatim ${n}: md5 diverso dal golden`);

// 2. esposizione: il body valutato definisce tutte le 34 fn come function
try {
  const factory = new Function(body + "\n;return {" + FRES_FNS.join(",") + "};");
  const defined = factory();
  for (const n of FRES_FNS)
    if (typeof defined[n] !== "function") bad(`esposizione ${n}: non e' function dopo eval`);
} catch (e) { bad(`eval del modulo fallito: ${e.message}`); }

// 3. residuo intatto nel monolite
for (const m of RESIDUE)
  if (!work.includes(m)) bad(`residuo mancante nel monolite: ${m}`);

// 4. il monolite non definisce piu' le fn; script tag 1 volta; banner 1 volta
for (const n of FRES_FNS)
  if (new RegExp(`(^|[^A-Za-z0-9_.$])function\\s+${n}\\s*\\(`).test(work)) bad(`monolite definisce ancora ${n}`);
const tag = work.split('src="/static/wf/fresabilita.js"').length - 1;
if (tag !== 1) bad(`<script src wf/fresabilita.js>: ${tag} occorrenze (attesa 1)`);
const banner = work.split("==== §FRESABILITA ====").length - 1;
if (banner !== 1) bad(`banner §FRESABILITA: ${banner} occorrenze (attesa 1)`);

console.log(fail ? `Gate fres: FALLITO (${fail} problemi)` :
  `Gate fres: OK — ${FRES_FNS.length} fn verbatim + esposte, residuo stato/banner/patch intatto, wiring 1:1.`);
process.exit(fail ? 1 : 0);
