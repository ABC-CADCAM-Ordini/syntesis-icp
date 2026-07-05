// Gate Fase 1 — prova che gli asset estratti sono IDENTICI agli embedded originali.
// OLD = monolite a git HEAD~ o ref passato (default: HEAD se il working tree e' gia'
//       estratto e il commit non e' ancora stato fatto -> usa HEAD).
// NEW = backend/static/assets/*.b64.js + logo.png del working tree.
// Confronto: MD5 dei BUFFER DECODIFICATI (b64 -> binario; per i template anche gunzip)
// per 5 STL + 3 chiavi template + logo = 9 verifiche. Qualsiasi mismatch -> exit 1.
//
//   node scripts/gate/assets/verify_b64.mjs [ref-old]     (default HEAD)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";

const REF = process.argv[2] || "HEAD";
const MONO = "backend/static/syntesis-analyzer-v3b.html";
const md5 = (b) => createHash("md5").update(b).digest("hex");

const old = execFileSync("git", ["show", `${REF}:${MONO}`],
                         { maxBuffer: 64 * 1024 * 1024 }).toString("utf-8");

// ── OLD: estrai i literal dal monolite storico ──────────────────────────────
function oldVar(name) {
  const m = old.match(new RegExp(`^var ${name} = "([A-Za-z0-9+/=]+)";?`, "m"));
  if (!m) throw new Error(`OLD: var ${name} non trovata in ${REF}`);
  return Buffer.from(m[1], "base64");
}
function oldTemplates() {
  const s = old.indexOf("var SOSTITUIRE_TEMPLATES_B64");
  if (s < 0) throw new Error("OLD: blob templates non trovato");
  const e = old.indexOf("\n};", s);
  const code = old.slice(s, e + 3);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.SOSTITUIRE_TEMPLATES_B64;
}
function oldLogo() {
  const m = old.match(/src="data:image\/png;base64,([^"]+)"/);
  if (!m) throw new Error("OLD: logo data-URI non trovato");
  return Buffer.from(m[1], "base64");
}

// ── NEW: carica gli asset estratti (i .b64.js si ESEGUONO in vm = prova anche il parse) ──
function newVar(file, name) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(`backend/static/assets/${file}`, "utf-8"), ctx);
  if (typeof ctx[name] === "undefined") throw new Error(`NEW: ${file} non definisce ${name}`);
  return ctx[name];
}

let fail = 0;
const check = (label, a, b) => {
  const ok = md5(a) === md5(b);
  console.log(`  ${ok ? "OK " : "FAIL"} ${label}  md5=${md5(a).slice(0, 12)}${ok ? "" : "  vs  " + md5(b).slice(0, 12)}`);
  if (!ok) fail++;
};

// 5 STL single-line (decodifica b64 -> binario)
for (const [v, f] of [["SCANBODY_B64", "scanbody-1t3.b64.js"], ["SCANBODY_OS_B64", "scanbody-os.b64.js"],
                      ["SCANBODY_SR_B64", "scanbody-sr.b64.js"], ["MATEMATICA_B64", "matematica.b64.js"],
                      ["ANALOGO_B64", "analogo.b64.js"]]) {
  check(`${v} (binario STL)`, oldVar(v), Buffer.from(newVar(f, v), "base64"));
}
// 3 chiavi template (b64 -> gunzip -> STL binario)
const oT = oldTemplates(), nT = newVar("sost-templates.b64.js", "SOSTITUIRE_TEMPLATES_B64");
for (const k of ["1T3", "SR", "OS"]) {
  if (!oT[k] || !nT[k]) { console.log(`  FAIL template ${k} assente`); fail++; continue; }
  check(`SOSTITUIRE_TEMPLATES_B64.${k} (gunzip STL)`,
        gunzipSync(Buffer.from(oT[k], "base64")), gunzipSync(Buffer.from(nT[k], "base64")));
}
// logo
check("logo.png", oldLogo(), readFileSync("backend/static/assets/logo.png"));

console.log(fail ? `\nGATE ROSSO: ${fail} mismatch` : "\nGATE VERDE: 9/9 buffer identici (old " + REF + " ≡ new assets)");
process.exit(fail ? 1 : 0);
