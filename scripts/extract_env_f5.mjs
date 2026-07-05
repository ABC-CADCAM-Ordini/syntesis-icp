// FASE 5 modularizzazione — estrazione one-shot pannelli/chrome dal monolite:
//   ds/syn-env.js     (36 fn Impostazioni: ambiente/render/palette/fresatore/controlli/zoom/dialog)
//   ds/syn-vmbar.js   (blocco <script> IIFE barra viewMode #vmBar, rilocazione in-place)
//   ds/syn-auth-ui.js (blocco <script> IIFE login/registrazione, rilocazione in-place)
//
// syn-env = "functions-only" (pattern F4): escono SOLO le 36 function declaration; TUTTO lo
// stato top-level resta nel monolite alla posizione originale (envSettings/millerSettings/
// controlsSettings + load localStorage, MUA_PALETTES/MILLER_PRESETS, la chiamata
// syncMuaColorsFromPalette() r.~11363 e l'if readyState->loadUiZoom). Motivo: il try di
// millerSettings scrive MAX_MILLING_ANGLE (dichiarato PRIMA nel MAIN, r.~1426) — spostare
// gli statement eseguibili in testa invertirebbe l'ordine e il var del MAIN cancellerebbe
// l'override da localStorage. Lo studio prescriveva mecc. A; si applica la sua stessa regola
// di sicurezza ("B quando A costringe a ri-esporre molte fn per zero beneficio": qui 25).
// vmBar/auth: blocchi gia' IIFE autocontenute -> <script src> ALLA STESSA POSIZIONE
// (stessa semantica DOM/ordine; pattern syn-panel 8.12.0). Il banner §AUTH-LOGIN resta nel
// monolite come commento HTML (check_anchors: 1 occorrenza esatta).
//
//   node scripts/extract_env_f5.mjs        # applica (rifiuta se gia' fatto)
import { readFileSync, writeFileSync } from "node:fs";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

// Gruppi contigui -> 1 tombstone. comments = n righe di commento sopra la 1a occorrenza, migrano.
const GROUPS = [
  { names: ["syncMuaColorsFromPalette"], comments: { syncMuaColorsFromPalette: 1 } },
  { names: ["applyRenderModeToMesh", "applyRenderModeToScene"], comments: { applyRenderModeToMesh: 2 } },
  { names: ["envBgCss"], comments: { envBgCss: 1 } },
  { names: ["applyEnvToScene"], comments: { applyEnvToScene: 1 } },
  { names: ["onEnvBgPickerChange", "onEnvBgChange", "onEnvBgCustomOpen", "onEnvCustomModeChange",
            "updateCustomModeUI", "onEnvBgCustomPrimary", "onEnvBgCustomSecondary", "onEnvBgAngleChange",
            "updateCustomPreview", "onEnvScanColorChange", "onEnvPaletteChange", "onEnvRenderModeChange",
            "updateRenderModeUI", "updateEnvSwatchBorders", "buildPaletteGrid", "switchSettingsTab"],
    comments: {} },
  { names: ["applyControlsSettings", "onControlsSettingChange", "resetControlsSettings", "syncControlsSettingsUI"],
    comments: { applyControlsSettings: 2, onControlsSettingChange: 1, resetControlsSettings: 1, syncControlsSettingsUI: 1 } },
  { names: ["syntesisGetUiZoom", "applyUiZoom", "loadUiZoom", "refreshUiZoomButtons"],
    comments: { syntesisGetUiZoom: 2 } },
  { names: ["openSettings", "closeSettings", "cancelSettings", "applyMillerPreset",
            "updateMillerSettings", "updateSettingsUIState", "saveSettings"], comments: {} },
];
export const ENV_FNS = GROUPS.flatMap((g) => g.names);

const ENV_HEADER = `/*
 * syn-env.js — pannello Impostazioni di Syntesis-ICP (Fase 5 modularizzazione, 8.86.0).
 *
 * CONTRATTO: SOLO function declaration (36), nomi bare globali invariati (18 handler inline
 * + chiamate cross-dominio + ds_refs). Lo STATO del dominio resta nel monolite alla
 * posizione originale (§IMPOSTAZIONI-RUNTIME): envSettings / millerSettings /
 * controlsSettings + load localStorage, MUA_PALETTES / MILLER_PRESETS, la chiamata
 * top-level syncMuaColorsFromPalette() e l'hook DOMContentLoaded->loadUiZoom.
 * NON spostare qui quegli statement: il try di millerSettings scrive MAX_MILLING_ANGLE
 * (dichiarato prima nel MAIN) e l'ordine di esecuzione e' semanticamente vincolante.
 *
 * Aree: ambiente (bg/gradiente/palette/scan color), render mode (solid/wireframe/both),
 * fresatore (preset -> MAX_MILLING_ANGLE), controlli 3D (moltiplicatori camera),
 * UI zoom, dialog (open/close/cancel/save, tab).
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo syn-color); THREE/scene/
 * DOM letti SOLO a call-time. GATE: scripts/gate/env/gate.mjs (verbatim md5 per fn +
 * harness browser old/new: tab/save/reset, snapshot localStorage+DOM).
 */
`;
const VMBAR_HEADER = `/* syn-vmbar.js — barra viewMode #vmBar (Fase 5, 8.86.0). Blocco IIFE rilocato
 * VERBATIM dalla posizione originale (dopo il markup #vmBar: l'ordine DOM e' vincolante,
 * detachToBody sposta la barra sotto <body>). Espone window.setViewMode/updateViewModeBar.
 * GATE: scripts/gate/env/gate.mjs (byte-verbatim vs HEAD + probe browser). */
`;
const AUTH_HEADER = `/* syn-auth-ui.js — login/registrazione in-app (Fase 5, 8.86.0). Blocco IIFE §AUTH-LOGIN
 * rilocato VERBATIM dalla posizione originale (fine body, dopo il markup syntAuth*).
 * Espone window.syntAuthRefreshUI/syntAuthShow/syntAuthClose/syntAuthSwitchTab/syntAuthDoLogin/...
 * Il banner §AUTH-LOGIN resta nel monolite (commento HTML alla posizione del blocco).
 * GATE: scripts/gate/env/gate.mjs (byte-verbatim vs HEAD + probe browser). */
`;

// eseguibile solo come main: l'import (es. dal gate, per ENV_FNS) non deve applicare nulla
import { pathToFileURL } from "node:url";
if (import.meta.url !== pathToFileURL(process.argv[1]).href) {
  // importato come modulo: esporta solo ENV_FNS
} else {
  main();
}

function main() {
let src = readFileSync(MONO, "utf-8");
if (src.includes("§PURELIB-ENV:") || src.includes("ds/syn-env.js")) {
  console.error("gia' applicato"); process.exit(2);
}

// ── 1) syn-env.js: functions-only, stile F4 ─────────────────────────────────
const perGroup = [];
const removals = [];
for (const g of GROUPS) {
  let gStart = Infinity, gEnd = -1;
  const memberBlocks = [];
  for (const name of g.names) {
    const fnSrc = extractFunction(src, name);
    const fStart = src.indexOf(fnSrc);
    if (fStart < 0 || src.indexOf(fnSrc, fStart + 1) >= 0) throw new Error(`span non univoco per ${name}`);
    let start = fStart;
    const nComm = g.comments[name] || 0;
    for (let k = 0; k < nComm; k++) {
      const lineStart = src.lastIndexOf("\n", start - 2) + 1;
      const line = src.slice(lineStart, start - 1);
      if (!line.trim().startsWith("//"))
        throw new Error(`sopra ${name} attesa riga commento, trovato: ${line}`);
      start = lineStart;
    }
    gStart = Math.min(gStart, start);
    gEnd = Math.max(gEnd, fStart + fnSrc.length);
    const block = src.slice(start, fStart) + fnSrc;
    memberBlocks.push(block);
  }
  let rest = src.slice(gStart, gEnd);
  for (const b of memberBlocks) rest = rest.replace(b, "");
  if (rest.trim() !== "")
    throw new Error(`nel gruppo [${g.names}] lo span contiene altro codice:\n${rest.trim().slice(0, 200)}`);
  perGroup.push(memberBlocks.join("\n\n"));
  removals.push({ start: gStart, end: gEnd,
    tombstone: `// §PURELIB-ENV: ${g.names.join(", ")} → /static/ds/syn-env.js (Fase 5, caricato in testa)` });
}
removals.sort((a, b) => b.start - a.start);
for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);

// ── 2) vmBar + auth: rilocazione in-place del blocco <script> intero ───────
function relocateBlock(marker, file, header, replaceElement) {
  const mi = src.indexOf(marker);
  if (mi < 0) throw new Error(`marker non trovato: ${marker}`);
  const open = src.lastIndexOf("<script>", mi);
  const close = src.indexOf("</script>", mi);
  if (open < 0 || close < 0) throw new Error(`confini <script> non trovati per ${file}`);
  const content = src.slice(open + "<script>".length, close); // \n...\n verbatim
  writeFileSync(`backend/static/ds/${file}`, header + content.replace(/^\n/, "") );
  src = src.slice(0, open) + replaceElement + src.slice(close + "</script>".length);
  return content.split("\n").length - 1;
}

const vmLines = relocateBlock("var STORE_KEY = 'syntesis_viewMode'", "syn-vmbar.js", VMBAR_HEADER,
  '<!-- §PURELIB-ENV: blocco vmBar → /static/ds/syn-vmbar.js (Fase 5, stessa posizione: ordine DOM vincolante) -->\n' +
  '<script src="/static/ds/syn-vmbar.js"></script>');

// auth: il banner §AUTH-LOGIN esce dal blocco e resta nel monolite come commento HTML
const AUTH_BANNER_JS = "/* ==== §AUTH-LOGIN ==== */\n";
const authMarker = "var SYNT_TOKEN_KEY = 'syntesis_token'";
{
  const mi = src.indexOf(authMarker);
  const open = src.lastIndexOf("<script>", mi);
  const close = src.indexOf("</script>", mi);
  if (mi < 0 || open < 0 || close < 0) throw new Error("blocco auth non trovato");
  let content = src.slice(open + "<script>".length, close);
  if (!content.includes(AUTH_BANNER_JS)) throw new Error("banner §AUTH-LOGIN non trovato nel blocco auth");
  content = content.replace(AUTH_BANNER_JS, "");
  writeFileSync("backend/static/ds/syn-auth-ui.js", AUTH_HEADER + content.replace(/^\n/, ""));
  src = src.slice(0, open) +
    '<!-- ==== §AUTH-LOGIN ==== -->\n' +
    '<!-- §PURELIB-ENV: blocco login/registrazione → /static/ds/syn-auth-ui.js (Fase 5, stessa posizione) -->\n' +
    '<script src="/static/ds/syn-auth-ui.js"></script>' +
    src.slice(close + "</script>".length);
}

// ── 3) syn-env.js in testa (dopo syn-color) + scrittura ────────────────────
const anchor = '<script src="/static/ds/syn-color.js"></script>';
if (!src.includes(anchor)) throw new Error("anchor syn-color.js non trovato");
src = src.replace(anchor, anchor + '\n<script src="/static/ds/syn-env.js"></script>');

writeFileSync("backend/static/ds/syn-env.js", ENV_HEADER + "\n" + perGroup.join("\n\n") + "\n");
writeFileSync(MONO, src);
console.log(`fatto: syn-env=${ENV_FNS.length}fn (${removals.length} tombstone), ` +
            `syn-vmbar=${vmLines} righe, syn-auth-ui rilocato`);
}
