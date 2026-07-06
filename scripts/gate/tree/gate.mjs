// Gate F6b — estrazione workflow ALBERO SCENA (wf/tree.js).
// Prova strutturale della rilocazione functions-only (complemento dell'harness browser):
//   1. VERBATIM: le 10 fn di wf/tree.js byte-identiche al monolite PRE-estrazione (golden = md5
//      per funzione, catturato da git HEAD prima dell'edit);
//   2. ESPOSIZIONE: il file, valutato, DEFINISCE tutte e 10 le fn come function (probe sandbox);
//   3. RESIDUO INTATTO: il monolite conserva ancora lo stato tree (muaExpanded) e le fn CONDIVISE
//      lasciate di proposito (setSceneObjectColor/__synApplyColor/getGroupBadgeColor);
//   4. il monolite NON definisce più le 10 fn; lo <script src> wf/tree.js esiste 1 volta.
//
//   node scripts/gate/tree/gate.mjs --write-golden   # PRIMA dell'edit (old = git HEAD)
//   node scripts/gate/tree/gate.mjs --check          # dopo, e per ogni futuro edit
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractAll } from "../purelib/extract.mjs";
import { TREE_FNS } from "../../extract_tree_f6b.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";
const WF = "backend/static/wf/tree.js";
const GOLDEN = "scripts/gate/tree/golden.json";
const md5 = (s) => createHash("md5").update(s).digest("hex");

// residuo che DEVE restare nel monolite (stato tree + fn condivise lasciate di proposito)
const RESIDUE = [
  "muaExpanded={}",                          // stato espansione nodi (dichiarazione nel MAIN)
  "function setSceneObjectColor(target, hex){",  // utility scena condivisa (non tree)
  "function __synApplyColor(x, col){",           // helper di setSceneObjectColor
  "function getGroupBadgeColor(gid){",           // colore puro condiviso (candidato syn-color)
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
  const fns = extractAll(headMono(), TREE_FNS);
  writeFileSync(GOLDEN, JSON.stringify({
    fnMd5: Object.fromEntries(TREE_FNS.map((n) => [n, md5(fns[n])])),
  }, null, 1));
  console.log(`golden scritto: ${GOLDEN} (${TREE_FNS.length} fn)`);
  process.exit(0);
}

// ── check ───────────────────────────────────────────────────────────────────
const g = JSON.parse(readFileSync(GOLDEN, "utf-8"));
const work = readFileSync(MONO, "utf-8");
const body = wfBody();
let fail = 0;
const bad = (m) => { fail++; console.error("  FAIL " + m); };

// 1. verbatim per-funzione
const modFns = extractAll(body, TREE_FNS);
for (const n of TREE_FNS)
  if (md5(modFns[n]) !== g.fnMd5[n]) bad(`verbatim ${n}: md5 diverso dal golden`);

// 2. esposizione: il body valutato definisce tutte le 10 fn come function
try {
  const factory = new Function(body + "\n;return {" + TREE_FNS.join(",") + "};");
  const defined = factory();
  for (const n of TREE_FNS)
    if (typeof defined[n] !== "function") bad(`esposizione ${n}: non è function dopo eval`);
} catch (e) { bad(`eval del modulo fallito: ${e.message}`); }

// 3. residuo intatto nel monolite
for (const m of RESIDUE)
  if (!work.includes(m)) bad(`residuo mancante nel monolite: ${m}`);

// 4. il monolite non definisce più le fn; script tag 1 volta
for (const n of TREE_FNS)
  if (new RegExp(`(^|[^A-Za-z0-9_.$])function\\s+${n}\\s*\\(`).test(work)) bad(`monolite definisce ancora ${n}`);
const tag = work.split('src="/static/wf/tree.js"').length - 1;
if (tag !== 1) bad(`<script src wf/tree.js>: ${tag} occorrenze (attesa 1)`);

console.log(fail ? `Gate tree: FALLITO (${fail} problemi)` :
  `Gate tree: OK — ${TREE_FNS.length} fn verbatim + esposte, residuo stato/condivise intatto, wiring 1:1.`);
process.exit(fail ? 1 : 0);
