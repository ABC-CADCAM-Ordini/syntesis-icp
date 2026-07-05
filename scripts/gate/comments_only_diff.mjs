// Gate Fase 2 — prova che tra OLD (git ref) e NEW (working tree) del monolite sono
// cambiati SOLO commenti/spazi: il CODICE a commenti-strippati deve essere BYTE-IDENTICO.
//
//   node scripts/gate/comments_only_diff.mjs [ref-old]      (default HEAD)
//
// Come: il documento viene diviso in segmenti <script>...</script> e resto-HTML.
// - body degli <script> inline: stripper JS char-scanner con stati (stringhe '"`,
//   escape, // e /* */; euristica regex-literal standard). Applicato a ENTRAMBI i lati
//   in modo deterministico: anche un edge-case trattato "male" e' trattato uguale su
//   old e new, quindi il confronto resta valido.
// - resto (markup + <style>): strip di <!-- --> e dei /* */ dentro <style>.
// Spazi/righe vuote normalizzati (il gate afferma "solo commenti e whitespace").
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const REF = process.argv[2] || "HEAD";
const MONO = "backend/static/syntesis-analyzer-v3b.html";

function stripJS(src) {
  let out = "", i = 0, n = src.length;
  let mode = "code"; // code | line | block | s1 | s2 | tpl | regex
  let prevSig = "";  // ultimo char significativo emesso (per euristica regex)
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "s1"; out += c; i++; continue; }
      if (c === '"') { mode = "s2"; out += c; i++; continue; }
      if (c === "`") { mode = "tpl"; out += c; i++; continue; }
      if (c === "/") {
        // regex literal? euristica: dopo ( , = : ; ! & | ? { } [ return/typeof/... o inizio
        if (/[(,=:;!&|?{}\[\n+\-*%~^<>]/.test(prevSig) || prevSig === "" ||
            /\b(return|typeof|instanceof|in|of|new|do|else|case|void|delete)$/.test(out.slice(-10))) {
          mode = "regex"; out += c; i++; continue;
        }
        out += c; prevSig = c; i++; continue;
      }
      out += c;
      if (!/\s/.test(c)) prevSig = c;
      i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && d === "/") { mode = "code"; i += 2; } else i++; continue; }
    if (mode === "s1" || mode === "s2" || mode === "tpl") {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if ((mode === "s1" && c === "'") || (mode === "s2" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
      if (!/\s/.test(c)) prevSig = c;
      i++; continue;
    }
    if (mode === "regex") {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === "[") { // char-class: / non termina
        let j = i + 1;
        while (j < n && src[j] !== "]") { out += src[j]; if (src[j] === "\\") { j++; out += src[j] ?? ""; } j++; }
        out += src[j] ?? ""; i = j + 1; continue;
      }
      if (c === "/") { mode = "code"; prevSig = c; }
      i++; continue;
    }
  }
  return out;
}

function stripDoc(doc) {
  // segmenta per <script ...>...</script>; body inline -> stripJS; resto -> strip HTML/CSS comments
  const parts = [];
  const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
  let last = 0, m;
  while ((m = re.exec(doc))) {
    parts.push({ kind: "html", text: doc.slice(last, m.index) });
    const attrs = m[1];
    const isInlineJs = !/src=/.test(attrs) && !/importmap|application\/json/.test(attrs);
    parts.push({ kind: "tag", text: attrs });
    parts.push({ kind: isInlineJs ? "js" : "raw", text: m[2] });
    parts.push({ kind: "tag", text: m[3] });
    last = re.lastIndex;
  }
  parts.push({ kind: "html", text: doc.slice(last) });
  let out = "";
  for (const p of parts) {
    if (p.kind === "js") out += stripJS(p.text);
    else if (p.kind === "html") out += p.text.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    else out += p.text;
  }
  // normalizza whitespace: il gate afferma "solo commenti e spazi"
  return out.split("\n").map(l => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, s => s)).filter(l => l.trim() !== "").join("\n");
}

const oldDoc = execFileSync("git", ["show", `${REF}:${MONO}`], { maxBuffer: 64 * 1024 * 1024 }).toString("utf-8");
const newDoc = readFileSync(MONO, "utf-8");
const a = stripDoc(oldDoc), b = stripDoc(newDoc);
const ha = createHash("md5").update(a).digest("hex"), hb = createHash("md5").update(b).digest("hex");
if (ha === hb) {
  console.log(`GATE VERDE: codice a commenti-strippati BYTE-IDENTICO (md5 ${ha.slice(0, 12)}; old ${REF} ≡ working tree).`);
  process.exit(0);
}
// diagnostica: prima riga divergente
const A = a.split("\n"), B = b.split("\n");
for (let i = 0; i < Math.max(A.length, B.length); i++) {
  if (A[i] !== B[i]) {
    console.error(`GATE ROSSO: divergenza alla riga-strippata ${i + 1}`);
    console.error(`  OLD: ${(A[i] ?? "<EOF>").slice(0, 120)}`);
    console.error(`  NEW: ${(B[i] ?? "<EOF>").slice(0, 120)}`);
    break;
  }
}
process.exit(1);
