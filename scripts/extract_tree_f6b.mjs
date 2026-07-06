// FASE 6b modularizzazione — estrazione del workflow ALBERO SCENA (tree) dal monolite:
//   wf/tree.js  (10 fn tree-view: pannello Livelli, rebuildTree, opacità globale, toggle layer/mua)
// Meccanismo "functions-only" (pattern F5/6a, LIVE): escono SOLO le function declaration, VERBATIM,
// in <script src> classico non-strict in testa (dopo wf/fresabilita.js). Il dominio tree è PURA
// VISTA: nessuno stato proprio salvo muaExpanded (resta nel MAIN, riga ~1419), zero monkey-patch.
// ESCLUSE di proposito (scouting 5-lenti): setSceneObjectColor + __synApplyColor (utility di
// scena/colore CONDIVISE da 6 workflow — restano nel monolite) e getGroupBadgeColor (colore puro,
// candidata a ds/syn-color.js in un passo colorclass dedicato — resta per ora). toggleAllSB era
// dead-code adiacente (0 caller): lasciata nel monolite da F6b (§3.4), rimossa in 8.95.3.
// I RUN sono rilevati AUTOMATICAMENTE (si spezzano dove c'è codice non-estratto tra due funzioni:
// __synApplyColor/setSceneObjectColor fra rebuildTree e treeUnified; toggleAllSB dopo toggleMuaLayer).
//
//   node scripts/extract_tree_f6b.mjs        # applica (rifiuta se già fatto)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

// 10 function declaration del dominio tree-view (Albero Scena di Analizza).
export const TREE_FNS = [
  "openLayersPanel", "closeLayersPanel", "toggleLayersPanel",
  "rebuildTree",
  "treeUnified_setScanOpacity", "treeUnified_ghostAll", "treeUnified_restoreAll",
  "toggleLayer", "toggleMuaLayer",
  "toggleMuaExpand",
];

const HEADER = `/*
 * wf/tree.js — workflow ALBERO SCENA (tree) di Synthesis-ICP (Fase 6b modularizzazione, 8.89.0).
 * Secondo file estratto in wf/ (dopo fresabilita.js).
 *
 * CONTRATTO: 10 function declaration del dominio tree-view di Analizza (pannello "Livelli"/Albero
 * Scena, rebuildTree che rigenera il DOM dell'albero, opacità globale scan+mua, ghost/restore,
 * toggle visibilità layer/mua, espansione nodi). Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern 6a): il dominio tree è PURA VISTA — non possiede stato
 * proprio salvo muaExpanded (mappa expand/collapse per-MUA) che resta nel MAIN alla posizione
 * originale, come tutto lo stato foreign che le fn leggono (scanMesh/muaObjects/meanAxisLine/
 * analysisMode/envSettings/scanbodiesVisible/divergenceLabelsVisible). Zero monkey-patch.
 *
 * ESCLUSE dal modulo (scouting): setSceneObjectColor + __synApplyColor (utility di scena/colore
 * CONDIVISE da scan/mua/icp/sost/replace — restano nel monolite, non sono tree) e getGroupBadgeColor
 * (colore puro, gemella di getGroupArrowColor già in ds/syn-color.js — resta, candidata a un passo
 * colorclass dedicato). toggleAllSB era dead-code adiacente: rimossa dal monolite in 8.95.3.
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo wf/fresabilita.js), PRIMA del MAIN.
 * Le fn si limitano a essere DEFINITE a parse-time; leggono stato/THREE/scene/DOM solo a CALL-TIME
 * (post-init, tutte invocate da handler inline / shortcut 'L' / rebuild dopo interazione).
 * VINCOLO HARD: rebuildTree è chiamata da ds/syn-clip.js (root.rebuildTree) e ds/syn-env.js e da
 * ~23 siti nel monolite (typeof-guardati) → deve restare bare-global. Idem toggleLayersPanel
 * (shortcut tastiera 'L' + toolbar), i toggle e treeUnified_* (handler inline generati da rebuildTree).
 * GATE: scripts/gate/tree/gate.mjs (md5 verbatim per fn + esposizione + residuo) + harness browser
 * (open/close pannello classList/display, toggle, opacità, ghost/restore, rebuild innerHTML).
 */
`;

function isCommentOrBlank(line) {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}

function main() {
  let src = readFileSync(MONO, "utf-8");
  if (src.includes("§WF-TREE:") || src.includes("wf/tree.js")) {
    console.error("già applicato"); process.exit(2);
  }

  // 1) span verbatim per nome (brace-matcher condiviso col gate)
  const spans = TREE_FNS.map((name) => {
    const fnSrc = extractFunction(src, name);
    const start = src.indexOf(fnSrc);
    if (start < 0 || src.indexOf(fnSrc, start + 1) >= 0) throw new Error(`span non univoco per ${name}`);
    return { name, start, end: start + fnSrc.length, fnSrc };
  }).sort((a, b) => a.start - b.start);

  // 2) RUN: si spezza quando fra due funzioni estratte c'è codice non-commento (fn da lasciare)
  const runs = [];
  let cur = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const gap = src.slice(spans[i - 1].end, spans[i].start);
    const gapCode = gap.split("\n").some((l) => !isCommentOrBlank(l));
    if (gapCode) { runs.push(cur); cur = [spans[i]]; }
    else cur.push(spans[i]);
  }
  runs.push(cur);

  // 3) estende start sui commenti contigui; verifica il run pulito (solo fn+commenti+spazi)
  const removals = [];
  const chunks = [];
  for (const run of runs) {
    let start = run[0].start;
    while (true) {
      const ls = src.lastIndexOf("\n", start - 2) + 1;
      const line = src.slice(ls, start - 1);
      if (line.trim() !== "" && line.trim().startsWith("//")) start = ls;
      else break;
    }
    const end = run[run.length - 1].end;
    const content = src.slice(start, end);
    let rest = content;
    for (const s of run) rest = rest.replace(s.fnSrc, "");
    for (const l of rest.split("\n"))
      if (!isCommentOrBlank(l)) throw new Error(`run [${run[0].name}..] contiene codice non-fn: ${l.trim().slice(0,80)}`);
    chunks.push(content);
    removals.push({ start, end,
      tombstone: `// §WF-TREE: ${run.map((s) => s.name).join(", ")} → /static/wf/tree.js (Fase 6b, caricato in testa)` });
  }

  // 4) applica dal fondo
  removals.sort((a, b) => b.start - a.start);
  for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);

  // 5) <script src> subito dopo wf/fresabilita.js
  const anchor = '<script src="/static/wf/fresabilita.js"></script>';
  if (!src.includes(anchor)) throw new Error("anchor wf/fresabilita.js non trovato");
  src = src.replace(anchor, anchor + '\n<script src="/static/wf/tree.js"></script>');

  mkdirSync("backend/static/wf", { recursive: true });
  writeFileSync("backend/static/wf/tree.js", HEADER + "\n" + chunks.join("\n\n") + "\n");
  writeFileSync(MONO, src);
  console.log(`fatto: wf/tree.js = ${TREE_FNS.length} fn in ${runs.length} run (${removals.length} tombstone §WF-TREE)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
