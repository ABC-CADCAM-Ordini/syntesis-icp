// Gate F5 — pannelli/chrome (ds/syn-env.js + syn-vmbar.js + syn-auth-ui.js).
// Prova strutturale della rilocazione (complemento Node dell'harness browser):
//   1. VERBATIM per-funzione: le 36 fn di syn-env.js byte-identiche al monolite pre-edit;
//   2. RESIDUO INTATTO: gli statement di stato che DEVONO restare nel monolite
//      (envSettings/millerSettings/controlsSettings + load, MUA_PALETTES/MILLER_PRESETS,
//      syncMuaColorsFromPalette(), if readyState) sono ancora li', invariati;
//   3. BLOCCHI IN-PLACE: syn-vmbar.js / syn-auth-ui.js byte-identici al contenuto dei
//      <script> originali (auth: modulo = blocco meno il banner §AUTH-LOGIN, che resta
//      nel monolite come commento HTML, 1 occorrenza esatta);
//   4. il monolite non definisce piu' le 36 fn; gli <script src> nuovi esistono 1 volta.
//
//   node scripts/gate/env/gate.mjs --write-golden   # PRIMA del commit (old = git HEAD)
//   node scripts/gate/env/gate.mjs --check          # dopo, e per ogni futuro edit
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractAll } from "../purelib/extract.mjs";
import { ENV_FNS } from "../../extract_env_f5.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";
const GOLDEN = "scripts/gate/env/golden.json";
const md5 = (s) => createHash("md5").update(s).digest("hex");

// statement di stato che restano nel monolite: marker di inizio + n righe attese invariate
const RESIDUE_MARKERS = [
  "var MUA_PALETTES = {",
  "var envSettings = {",
  "var envSettingsBackup = null;",
  "var savedEnv = localStorage.getItem('syntesis_env_settings');",
  "syncMuaColorsFromPalette();",
  "var MILLER_PRESETS = {",
  "var millerSettings = {",
  "var saved = localStorage.getItem('syntesis_miller_settings');",
  "MAX_MILLING_ANGLE = millerSettings.bAxis;",
  "var SYN_CONTROLS_KEY = 'syntesis_controls';",
  "var controlsSettings = { rotate: 1.0, pan: 1.0, zoom: 1.0 };",
  "var SYNTESIS_UI_ZOOM_KEY = 'syntesis_ui_zoom';",
  "document.addEventListener('DOMContentLoaded', loadUiZoom);",
];

function headSrc() { return execSync(`git show HEAD:${MONO}`, { maxBuffer: 64 * 1024 * 1024 }).toString(); }
function blockContent(src, marker) {
  const mi = src.indexOf(marker);
  const open = src.lastIndexOf("<script>", mi);
  const close = src.indexOf("</script>", mi);
  if (mi < 0 || open < 0 || close < 0) throw new Error(`blocco non trovato: ${marker}`);
  return src.slice(open + "<script>".length, close).replace(/^\n/, "");
}
function stripHeader(file) { // rimuove il commento-header /* ... */ in testa al modulo
  const t = readFileSync(file, "utf-8");
  const end = t.indexOf("*/");
  return t.slice(end + 3).replace(/^\n+/, "");
}

const mode = process.argv.includes("--write-golden") ? "golden" :
             process.argv.includes("--check") ? "check" : null;
if (!mode) { console.error("uso: gate.mjs (--write-golden|--check)"); process.exit(2); }

if (mode === "golden") {
  if (existsSync(GOLDEN) && !process.argv.includes("--force"))
    { console.error(`${GOLDEN} esiste gia' (usa --force)`); process.exit(2); }
  const old = headSrc();
  const fns = extractAll(old, ENV_FNS);
  const golden = {
    envFnMd5: Object.fromEntries(ENV_FNS.map((n) => [n, md5(fns[n])])),
    vmbarMd5: md5(blockContent(old, "var STORE_KEY = 'syntesis_viewMode'")),
    authMd5: md5(blockContent(old, "var SYNT_TOKEN_KEY = 'syntesis_token'")
                   .replace("/* ==== §AUTH-LOGIN ==== */\n", "")),
    residueMd5: Object.fromEntries(RESIDUE_MARKERS.map((m) => [m, 1])), // presenza; contenuto sotto
  };
  writeFileSync(GOLDEN, JSON.stringify(golden, null, 1));
  console.log(`golden scritto: ${GOLDEN} (${ENV_FNS.length} fn env + 2 blocchi)`);
  process.exit(0);
}

// ── check ───────────────────────────────────────────────────────────────────
const g = JSON.parse(readFileSync(GOLDEN, "utf-8"));
const work = readFileSync(MONO, "utf-8");
let fail = 0;
const bad = (m) => { fail++; console.error("  FAIL " + m); };

// 1. verbatim per-funzione (modulo vs golden)
const modFns = extractAll(readFileSync("backend/static/ds/syn-env.js", "utf-8"), ENV_FNS);
for (const n of ENV_FNS)
  if (md5(modFns[n]) !== g.envFnMd5[n]) bad(`verbatim ${n}: md5 diverso dal golden`);

// 2. residuo di stato intatto nel monolite
for (const m of RESIDUE_MARKERS)
  if (!work.includes(m)) bad(`residuo mancante nel monolite: ${m}`);

// 3. blocchi in-place byte-identici
if (md5(stripHeader("backend/static/ds/syn-vmbar.js")) !== g.vmbarMd5) bad("syn-vmbar.js: contenuto != blocco originale");
if (md5(stripHeader("backend/static/ds/syn-auth-ui.js")) !== g.authMd5) bad("syn-auth-ui.js: contenuto != blocco originale (meno banner)");

// 4. il monolite non definisce piu' le fn; src tag presenti 1 volta; banner auth 1 volta
for (const n of ENV_FNS)
  if (new RegExp(`(^|[^A-Za-z0-9_.$])function\\s+${n}\\s*\\(`).test(work)) bad(`monolite definisce ancora ${n}`);
for (const f of ["syn-env.js", "syn-vmbar.js", "syn-auth-ui.js"]) {
  const c = work.split(`src="/static/ds/${f}"`).length - 1;
  if (c !== 1) bad(`<script src ${f}>: ${c} occorrenze (attesa 1)`);
}
const banners = work.split("==== §AUTH-LOGIN ====").length - 1;
if (banners !== 1) bad(`banner §AUTH-LOGIN: ${banners} occorrenze nel monolite (attesa 1)`);

console.log(fail ? `Gate env: FALLITO (${fail} problemi)` :
  `Gate env: OK — ${ENV_FNS.length} fn verbatim, residuo stato intatto (${RESIDUE_MARKERS.length} marker), vmbar+auth byte-identici, wiring 1:1.`);
process.exit(fail ? 1 : 0);
