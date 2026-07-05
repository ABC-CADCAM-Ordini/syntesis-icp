// Builder dell'harness browser F5 (gate dello studio: tab/save/reset, snapshot localStorage+DOM).
// Genera in scripts/gate/env/build/ due pagine gemelle:
//   run-old.html  -> funzioni/blocchi estratti da git HEAD (monolite pre-estrazione)
//   run-new.html  -> i 3 moduli reali ds/syn-env.js / syn-vmbar.js / syn-auth-ui.js
// Markup (dialog Impostazioni + #vmBar) e STATO (sezione §IMPOSTAZIONI-RUNTIME residua)
// sono ESTRATTI dal sorgente reale, identici per entrambe le varianti.
// harness.html carica le due pagine in iframe, esegue la stessa suite di scenari
// (scenarios.js) e confronta gli snapshot: differenze = ROSSO.
//   node scripts/gate/env/build_harness.mjs && python3 -m http.server 8765
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { extractAll } from "../purelib/extract.mjs";
import { ENV_FNS } from "../../extract_env_f5.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";
const OUT = "scripts/gate/env/build";
mkdirSync(OUT, { recursive: true });

const head = execSync(`git show HEAD:${MONO}`, { maxBuffer: 64 * 1024 * 1024 }).toString();
const work = readFileSync(MONO, "utf-8");

// ── markup reale: elemento bilanciato da un'apertura <div id="..."> ─────────
function balancedDiv(src, opener) {
  const s = src.indexOf(opener);
  if (s < 0) throw new Error(`markup non trovato: ${opener}`);
  let i = s, depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = s;
  let m;
  while ((m = re.exec(src))) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return src.slice(s, m.index + "</div>".length);
  }
  throw new Error(`div non bilanciato per ${opener}`);
}
const settingsMarkup = balancedDiv(work, '<div id="settingsDialog"');
const vmbarMarkup = balancedDiv(work, '<div id="vmBar"');

// ── stato residuo: sezione §IMPOSTAZIONI-RUNTIME del monolite POST-estrazione ──
const sStart = work.indexOf("/* ==== §IMPOSTAZIONI-RUNTIME ==== */");
const sEnd = work.indexOf("/* ==== §SOSTITUIRE ==== */");
if (sStart < 0 || sEnd < 0) throw new Error("banner sezione non trovati");
let state = work.slice(sStart, sEnd)
  .split("\n").filter((l) => !l.trim().startsWith("// ╔") && !l.trim().startsWith("// ║") && !l.trim().startsWith("// ╚"))
  .join("\n");
writeFileSync(`${OUT}/_state.js`, state);

// ── varianti OLD da HEAD ────────────────────────────────────────────────────
const oldFns = extractAll(head, ENV_FNS);
writeFileSync(`${OUT}/_old-env.js`, ENV_FNS.map((n) => oldFns[n]).join("\n\n"));
function headBlock(marker) {
  const mi = head.indexOf(marker);
  const open = head.lastIndexOf("<script>", mi);
  const close = head.indexOf("</script>", mi);
  return head.slice(open + "<script>".length, close);
}
writeFileSync(`${OUT}/_old-vmbar.js`, headBlock("var STORE_KEY = 'syntesis_viewMode'"));
writeFileSync(`${OUT}/_old-auth.js`, headBlock("var SYNT_TOKEN_KEY = 'syntesis_token'"));

// ── pagina variante ─────────────────────────────────────────────────────────
function page(envSrc, vmbarSrc, authSrc) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>run</title></head><body>
${vmbarMarkup}
${settingsMarkup}
<!-- stub DOM auth (id reali toccati da syntAuthRefreshUI/syntAuthShow) -->
<div id="fmAuthLabel"></div><div id="fmAuthKey"></div><div id="fmDashboardItem" style="display:none"></div>
<div id="syntAuthOverlay" style="display:none">
  <div id="syntAuthTabLogin"></div><div id="syntAuthTabRegister"></div>
  <form id="syntAuthLoginForm"><input id="syntAuthLoginEmail"><input id="syntAuthLoginPass" type="password"><div id="syntAuthLoginErr"></div></form>
  <form id="syntAuthRegisterForm" style="display:none"><input id="syntAuthRegEmail"><div id="syntAuthRegErr"></div></form>
</div>
<div id="viewport"></div>
<script src="${envSrc}"></script>
<script>
// globali del MAIN dichiarate PRIMA della sezione stato (ordine reale del monolite)
var MAX_MILLING_ANGLE = 30.0;
var MUA_COLORS = [0x0065B3,0xF59E0B,0x0D9E6E,0xDC2626,0x8B5CF6,0xEC4899,0x06B6D4,0x84CC16];
// i due run condividono l'origin: si parte SEMPRE da storage vuoto, PRIMA che
// _state.js legga syntesis_env_settings/miller/controls (determinismo old==new)
localStorage.clear();
// stub delle fn del monolite FUORI sezione richiamate dai flussi env (coverage completa
// di saveSettings; il log registra le chiamate e finisce nello snapshot confrontato)
var __calls = [];
function showStatus(msg){ __calls.push('showStatus:' + msg); }
function applyMillingLimits(){ __calls.push('applyMillingLimits'); }
</script>
<script src="_state.js"></script>
<script src="${vmbarSrc}"></script>
<script src="${authSrc}"></script>
<script src="../scenarios.js"></script>
</body></html>`;
}
writeFileSync(`${OUT}/run-old.html`, page("_old-env.js", "_old-vmbar.js", "_old-auth.js"));
writeFileSync(`${OUT}/run-new.html`, page(
  "/backend/static/ds/syn-env.js", "/backend/static/ds/syn-vmbar.js", "/backend/static/ds/syn-auth-ui.js"));
console.log(`harness costruito in ${OUT}/ (run-old.html vs run-new.html)`);
