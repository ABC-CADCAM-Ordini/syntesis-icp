// FASE 6a modularizzazione — estrazione del workflow FRESABILITA dal monolite:
//   wf/fresabilita.js  (34 fn: analisi angolare fresatura 5 assi, overlay frecce 3D, pannello)
// Meccanismo "functions-only" (pattern F5, LIVE su syn-env): escono SOLO le function
// declaration, VERBATIM, in un <script src> classico non-strict caricato in testa. Restano
// nel monolite alla posizione originale (validato dallo scouting 6-lenti):
//   - il banner §FRESABILITA (check_anchors lo traccia)
//   - lo STATO: FRES_BUILTIN_MACHINES / FRES_STORAGE_KEY / FRES_PROXIMITY_DEG / fresState /
//     fresOverlayScene / fresOverlayLights (letti/scritti da syn-clip, reset, group-dialog)
//   - il MONKEY-PATCH di calculateAngles (vincolo d'ordine parse-time) e calculateAngles stessa
//   - il cluster group-dialog (openGroupDialog/.../getMuaByGroup: gestione gruppi MUA, non fres)
// Nomi bare globali invariati -> syn-clip (fresState/closeFresability), 8 handler inline,
// monkey-patch, reset restano intatti a costo zero.
// I RUN di funzioni contigue sono rilevati AUTOMATICAMENTE (si spezzano dove lo stato/altro
// codice interrompe): NIENTE numeri di riga hardcoded (immune allo shift del dedup 8.87.2).
//
//   node scripts/extract_fres_f6a.mjs        # applica (rifiuta se gia' fatto)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractFunction } from "./gate/purelib/extract.mjs";

const MONO = "backend/static/syntesis-analyzer-v3b.html";

// 34 function declaration del dominio fresabilita puro (post-dedup fresUpdateAllArrows).
// openFresability/closeFresability incluse (il pattern del censimento 'fres[A-Z]' le mancava).
export const FRES_FNS = [
  "fresLoadDB", "fresDefaultDB", "fresSaveDB",
  "fresAngleAxesDeg", "fresClassify", "fresComputeMeanAxis", "fresSphericalToVec",
  "fresVecToSpherical", "fresMaxDivergence", "fresComputeMinimaxAxis",
  "fresInitOverlayScene", "fresOverlayRender", "fresBuildArrow", "fresClearAllArrows",
  "fresBuildAllArrows", "fresUpdateArrow", "fresUpdateAllArrows", "fresRecompute",
  "renderFresGroupSingle", "fresRebuildMachineSelect", "fresOnMachineChange", "fresOnModeChange",
  "fresAddCustom", "fresRemoveCustom", "fresUpdateOpenButton", "openFresability", "closeFresability",
  "fresScreenToSphere", "fresIsClickOnPicker", "fresOnMouseDown", "fresOnMouseMove", "fresOnMouseUp",
  "fresAttachMouseHandlers", "fresDetachMouseHandlers",
];

const HEADER = `/*
 * wf/fresabilita.js — workflow FRESABILITA di Synthesis-ICP (Fase 6a modularizzazione, 8.88.0).
 * PRIMO file estratto in wf/ (un file per workflow).
 *
 * CONTRATTO: 34 function declaration del dominio fresabilita (analisi angolare fresatura
 * 5 assi: catalogo macchine, classificazione angoli, asse medio/minimax/custom, overlay
 * frecce 3D per-gruppo, pannello "Fresatura avanzata"). Nomi bare globali invariati.
 * Estrazione "functions-only" (pattern F5/syn-env): lo STATO resta nel monolite alla
 * posizione originale (§FRESABILITA: FRES_BUILTIN_MACHINES/FRES_STORAGE_KEY/FRES_PROXIMITY_DEG/
 * fresState/fresOverlayScene/fresOverlayLights) e il MONKEY-PATCH di calculateAngles pure
 * (vincolo d'ordine parse-time). Il cluster group-dialog (openGroupDialog...getMuaByGroup)
 * NON e' fres (gestione gruppi MUA) e resta nel monolite.
 *
 * CARICAMENTO: <script src> classico NON-strict in testa (dopo ds/syn-env.js), PRIMA del
 * MAIN. Le fn si limitano a essere DEFINITE a parse-time; leggono stato (fresState),
 * THREE/scene/muaObjects e altre globali del MAIN solo a CALL-TIME (post-interazione utente),
 * quando il MAIN ha gia' inizializzato tutto. VINCOLO HARD (syn-clip.js LIVE legge
 * window.fresState e chiama window.closeFresability): questi nomi devono restare bare-global.
 * GATE: scripts/gate/fres/gate.mjs (md5 verbatim per fn vs monolite pre-estrazione + probe
 * esposizione) + harness browser (pannello open/close/mode/machine).
 */
`;

function isCommentOrBlank(line) {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}

function main() {
  let src = readFileSync(MONO, "utf-8");
  if (src.includes("§WF-FRES:") || src.includes("wf/fresabilita.js")) {
    console.error("gia' applicato"); process.exit(2);
  }

  // 1) span verbatim di ogni funzione (per nome, brace-matcher condiviso col gate)
  const spans = FRES_FNS.map((name) => {
    const fnSrc = extractFunction(src, name);
    const start = src.indexOf(fnSrc);
    if (start < 0 || src.indexOf(fnSrc, start + 1) >= 0)
      throw new Error(`span non univoco per ${name}`);
    return { name, start, end: start + fnSrc.length, fnSrc };
  }).sort((a, b) => a.start - b.start);

  // 2) rileva i RUN: si spezza quando fra due funzioni consecutive c'e' codice non-commento
  //    (una var di stato). I commenti di sezione fra funzioni restano DENTRO il run.
  const runs = [];
  let cur = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const gap = src.slice(spans[i - 1].end, spans[i].start);
    const gapCode = gap.split("\n").some((l) => !isCommentOrBlank(l));
    if (gapCode) { runs.push(cur); cur = [spans[i]]; }
    else cur.push(spans[i]);
  }
  runs.push(cur);

  // 3) per ogni run: estende lo start verso l'alto sui commenti contigui (fino a riga vuota o
  //    codice) per portarsi dietro l'header di sezione; verifica che il run contenga SOLO
  //    funzioni membro + commenti + spazi (nessuna var di stato inghiottita).
  const removals = [];
  const chunks = [];
  for (const run of runs) {
    let start = run[0].start;
    // risali sui commenti immediatamente sopra (stop a riga vuota o codice)
    while (true) {
      const ls = src.lastIndexOf("\n", start - 2) + 1;
      const line = src.slice(ls, start - 1);
      if (line.trim() !== "" && line.trim().startsWith("//")) start = ls;
      else break;
    }
    const end = run[run.length - 1].end;
    const content = src.slice(start, end);
    // safety: rimuovendo i corpi funzione + commenti, non deve restare codice
    let rest = content;
    for (const s of run) rest = rest.replace(s.fnSrc, "");
    for (const l of rest.split("\n"))
      if (!isCommentOrBlank(l)) throw new Error(`run [${run[0].name}..] contiene codice non-fn: ${l.trim().slice(0,80)}`);
    chunks.push(content);
    removals.push({ start, end,
      tombstone: `// §WF-FRES: ${run.map((s) => s.name).join(", ")} → /static/wf/fresabilita.js (Fase 6a, caricato in testa)` });
  }

  // 4) applica rimozioni dal fondo
  removals.sort((a, b) => b.start - a.start);
  for (const r of removals) src = src.slice(0, r.start) + r.tombstone + src.slice(r.end);

  // 5) <script src> in testa dopo syn-env.js
  const anchor = '<script src="/static/ds/syn-env.js"></script>';
  if (!src.includes(anchor)) throw new Error("anchor syn-env.js non trovato");
  src = src.replace(anchor, anchor + '\n<script src="/static/wf/fresabilita.js"></script>');

  mkdirSync("backend/static/wf", { recursive: true });
  writeFileSync("backend/static/wf/fresabilita.js", HEADER + "\n" + chunks.join("\n\n") + "\n");
  writeFileSync(MONO, src);
  console.log(`fatto: wf/fresabilita.js = ${FRES_FNS.length} fn in ${runs.length} run ` +
              `(${removals.length} tombstone §WF-FRES)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
