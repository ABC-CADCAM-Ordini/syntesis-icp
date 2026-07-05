#!/usr/bin/env python3
"""
apply_anchors_f2.py — Fase 2: TOC + banner §anchor + migrazione commenti-storia.

SOLO COMMENTI: aggiunge righe di commento (TOC + banner) e rimuove righe di commento
(blocchi-storia, migrati in docs/STORIA.md). Nessuno statement toccato: il gate
scripts/gate/comments_only_diff.mjs DEVE restare verde (codice strippato byte-identico).

Landmark verificati unici dal workflow f2-recon-anchors (35/35). Rimozione storia
DIFENSIVA: parte dalla prima riga esatta e prosegue SOLO finche' le righe sono
commenti puri (//...), fermandosi comunque al limite dichiarato.
"""
import sys, re

MONO = "backend/static/syntesis-analyzer-v3b.html"
STORIA = "docs/STORIA.md"

# (token, landmark-prefisso-esatto, descrizione, kind) — ordine irrilevante: il TOC
# viene ordinato per posizione reale nel file.
SECTIONS = [
    ("§CSS-GLOBALE", "/* v7.3.9.082 - Cornice colorata sul body", "foglio stile unico: layout, toolbar, pannelli, temi", "css"),
    ("§BOOTSTRAP-SYN", "// ── A.5.1 BOOTSTRAP window.SYN", "fallback sincrono window.SYN prima di ogni lettore", "js"),
    ("§MARKUP-HEADER-TOOLBAR", '<body><div class="header">', "header, logo, drop overlay, toolbar workflow", "html"),
    ("§MARKUP-MAIN-VIEWPORT", '<div class="main">', "viewport 3D, overlay fissi, layersPanel, albero Misurare", "html"),
    ("§MARKUP-PANNELLO-DESTRO", '  <div class="panel" id="rightPanel">', "rightPanel: rail e sezioni dei 5 workflow", "html"),
    ("§SCANBODY-SELECTOR-LAB", "// ── /lab v8.0.0-fase4: Scanbody type selector", "selettore tipo scanbody 1T3/OS/SR, decode b64", "js"),
    ("§IMPORTMAP-THREE", '<script type="importmap">', "importmap three r169, bridge ESM, CDN jsPDF/xlsx", "html"),
    ("§SYNREGISTRY-CORE", "<!-- ================================================================", "Synthesis Core Fase 1: SynRegistry, SynIcons, theme", "html"),
    ("§MAIN-CORE-3D", "// ║  SYNTESIS-ICP ANALYZER MUA", "core: OrbitControls, parseSTL, kabsch/ICP, init, loadScan, placeMUA", "js"),
    ("§FILE-MENU-ALBERO", "// ── FILE MENU ────", "menu file, salva caso JSON, layer tree, opacita", "js"),
    ("§ASSE-MEDIO-CONI", "// ── EXTRACT TOP FACE ──", "extract top face, asse medio, coni divergenza", "js"),
    ("§MUA-MANAGEMENT", "// ── MUA MANAGEMENT (delete, undo, reset)", "delete/undo/reset MUA, nuovo caso, esporta caso", "js"),
    ("§WORKFLOW-SWITCH", "// ║  WORKFLOW SWITCH: Analizza / Accoppia / Misurare", "selectWorkflow, toggle toolbar, reset totale sessione", "js"),
    ("§FRESABILITA", "// ║  FRESABILITA' AVANZATA", "modulo fresabilita 5 assi, frecce, overlay scene", "js"),
    ("§MISURARE-ICP", "// ║  MISURARE ICP: Kabsch+SVD+ICP", "motore Misurare: pSTL, componenti, Kabsch+SVD+ICP", "js"),
    ("§ASSE-CILINDRO-CONN", "// ║  ASSE DEL CILINDRO: metodo cap-based", "asse cap-based, connessione clinica 8.64.x, disegno origine", "js"),
    ("§MISURARE-PDF", "// ║  MISURARE PDF: report 6 pagine", "report PDF Misurare 6 pagine dal Comparator", "js"),
    ("§REPORT-PIPELINE", "// ║  PIPELINE REPORT MULTI-FORMATO", "pipeline report multi-formato, disegni tecnici, note/glossario", "js"),
    ("§CERTIFICATO-TARATURA", "// ── CERTIFICATO DI TARATURA v7.3.9.082", "certificato taratura: modal, pagine PDF, appendici", "js"),
    ("§MISURARE-VIZ", "// ║  MISURARE LABELS 3D", "label 3D, cutview, albero CATIA di Misurare", "js"),
    ("§EXPORT-STL", "// ║  EXPORT STL (binary)", "export STL binario scanbody/matematica/analogo", "js"),
    ("§CUTVIEW-POPUP", "// ── CUT VIEW POPUP ──", "cut view popup Analizza, divergence labels overlay", "js"),
    ("§ANALISI-CLINICA", "// ── ANALISI CLINICA: INSERIBILITA'", "banner clinico, visibilita scansione, gruppi MUA", "js"),
    ("§SPLINE-UNDERCUT", "// ║  SPLINE DI GRUPPO", "spline di gruppo, undercut map connessione IPD", "js"),
    ("§IMPOSTAZIONI-RUNTIME", "// ── IMPOSTAZIONI AMBIENTE ──", "ambiente, render mode, fresatore, controlli 3D, UI zoom", "js"),
    ("§SOSTITUIRE", "// ║  SOSTITUIRE: sostituzione scan body", "Sostituire: template b64, click placement, findScanbodyCenter", "js"),
    ("§REPLACE-IT", "// REPLACE-iT (workflow 'replace')", "Replace-iT: UI, fetch librerie, seeding 3 punti, allineamento", "js"),
    ("§REPLACE-CUT-SCAN", "// 2b-3d: TAGLIA SCANSIONE", "taglio scansione adattivo attorno ai marker Replace-iT", "js"),
    ("§SOST-CENTRAGGIO-ROBUSTO", "// ── Centraggio robusto click-invariante", "centraggio robusto asse lateral-wall, diagnostica click", "js"),
    ("§SOST-RAFFINA-FINALE", "// ── Raffina (pipeline Analizza alignAll)", "Raffina ICP, lista marker, pulizia scena, visibilita artefatti", "js"),
    ("§MARKUP-MODALI", "<!-- Dialog crea gruppo -->", "modali: crea gruppo, export sost/replace, settingsDialog", "html"),
    ("§VMBAR", "<!-- ═══ VIEW MODE BAR (v7.3.5.002) ═══ -->", "view mode bar: CSS, markup e logica solid/wireframe", "html"),
    ("§MARKUP-CALIBRAZIONE", '<script src="/static/ds/syn-panel.js">', "include syn-panel e modal certificato taratura", "html"),
    ("§AUTH-LOGIN", "// v7.3.9.082 - Sistema login/registrazione FastAPI backend", "auth: token localStorage, login, gating UI", "js"),
    ("§REPORT-MUA-PDF", "// ║  REPORT MUA PDF - Blocco 6a", "report MUA PDF 6 pagine: copertina, angolare, criticita", "js"),
]
# §ASSETS-B64 esiste gia' dalla Fase 1 (r.~1807): riceve il banner canonico qui sotto.
ASSETS_LANDMARK = "<!-- ==== §ASSETS-B64 (Fase 1 modularizzazione)"

# blocchi-storia: (prima riga ESATTA, max righe totali dichiarate dal recon)
HISTORY = [
    ("// 8.81.0 CLEANUP (audit 8.80.4): rimossi sostOnTemplateChange (il container", 10),
    ("  // La versione precedente duplicava una PARTE della pulizia e lasciava buchi:", 9),
    ("// 8.81.0 CLEANUP (audit 8.80.4): rimossi sostOnZOffsetChange + sostApplyOffsetDelta", 7),
    ("// Audit C8 (cleanup 2026-05-06): rimosse 5 ridefinizioni morte di", 6),
]

def banner(token, kind):
    if kind == "html":
        return f"<!-- ==== {token} ==== -->"
    return f"/* ==== {token} ==== */"

def main():
    lines = open(MONO, encoding="utf-8").read().split("\n")

    # ── 1. migrazione storia (prima, per non spostare i landmark banner sotto) ──
    migrated = []
    for first, maxn in HISTORY:
        idx = [i for i, l in enumerate(lines) if l == first]
        assert len(idx) == 1, f"prima riga storia non univoca ({len(idx)}): {first[:50]}"
        i = idx[0]
        # difensivo: prosegui SOLO su righe di puro commento, entro il massimo
        j = i
        while j < i + maxn and j < len(lines) and lines[j].lstrip().startswith("//"):
            j += 1
        block = lines[i:j]
        migrated.append((first, block))
        del lines[i:j]
        # se resta una riga vuota orfana (sopra e sotto vuote), rimuovine una
        if 0 < i < len(lines) and lines[i].strip() == "" and lines[i - 1].strip() == "":
            del lines[i]
    print(f"storia: migrati {len(migrated)} blocchi ({sum(len(b) for _, b in migrated)} righe)")

    # ── 2. banner canonici (inserimento bottom-up per non invalidare gli indici) ──
    placements = []
    for token, landmark, desc, kind in SECTIONS:
        idx = [i for i, l in enumerate(lines) if l.startswith(landmark)]
        assert len(idx) == 1, f"landmark non univoco ({len(idx)}) per {token}: {landmark[:50]}"
        placements.append((idx[0], token, desc, kind))
    # §ASSETS-B64: banner canonico sopra il commento F1 esistente
    ai = [i for i, l in enumerate(lines) if l.startswith(ASSETS_LANDMARK)]
    assert len(ai) == 1, "landmark ASSETS-B64 non trovato"
    placements.append((ai[0], "§ASSETS-B64", "asset CAD B64 esterni (Fase 1): 6 script + logo", "html"))

    placements.sort(key=lambda x: -x[0])
    for i, token, desc, kind in placements:
        lines[i:i] = [banner(token, kind)]
    placements.sort(key=lambda x: x[0])
    print(f"banner: inseriti {len(placements)}")

    # ── 3. TOC dopo <title> ──
    ti = next(i for i, l in enumerate(lines) if l.startswith("<title>"))
    toc = ["<!--", "==== INDICE (§anchor grep-able) ============================================",
           "Navigazione: grep -n '§TOKEN' su questo file. I banner sono UNICI (gate:",
           "scripts/gate/check_anchors.py). NON usare numeri di riga nei riferimenti:",
           "driftano a ogni edit; gli anchor no. Convenzioni: docs/frontend/CONTRIBUTING.md."]
    for i, token, desc, kind in placements:
        toc.append(f"  {token:26s} {desc}")
    toc += ["=============================================================================", "-->"]
    lines[ti + 1:ti + 1] = toc
    print(f"TOC: {len(placements)} voci dopo <title>")

    open(MONO, "w", encoding="utf-8").write("\n".join(lines))

    # ── 4. append storia in docs/STORIA.md ──
    st = open(STORIA, encoding="utf-8").read()
    ann = ["\n---\n\n## Commenti-storia migrati dal sorgente (Fase 2 modularizzazione, 2026-07-05)\n",
           "Blocchi rimossi da `syntesis-analyzer-v3b.html` perché raccontavano solo il passato",
           "(le spiegazioni ATTUALI restano nel codice; il changelog canonico è registry.py History).\n"]
    for first, block in migrated:
        ann.append("```")
        ann.extend(block)
        ann.append("```\n")
    open(STORIA, "w", encoding="utf-8").write(st + "\n".join(ann))
    print(f"STORIA.md: appesi {len(migrated)} blocchi")
    print(f"monolite ora: {len(lines)} righe")

if __name__ == "__main__":
    main()
