#!/usr/bin/env python3
"""
extract_css_f3.py — Fase 3: CSS del monolite → backend/static/css/analyzer.css.

RILOCAZIONE VERBATIM: il contenuto dei due blocchi <style> (principale r.~60-952 e
vmBar r.~18728-18765) esce in UN file, nello STESSO ORDINE (cascata identica: nel
documento non ci sono altri fogli tra i due). Il <link> prende la posizione del blocco
principale; il blocco vmBar viene rimosso (le sue regole sono in coda al file css).
RESTA inline la riga anti-flash r.8 (html{visibility:hidden}, coppia di syn-gate:
deve applicarsi prima di qualsiasi fetch).

Il banner /* ==== §CSS-GLOBALE ==== */ viaggia col CSS nel nuovo file; nel monolite
al suo posto resta un banner HTML alla posizione del <link> (check_anchors resta 1:1).
"""
import os

MONO = "backend/static/syntesis-analyzer-v3b.html"
CSS  = "backend/static/css/analyzer.css"

def main():
    lines = open(MONO, encoding="utf-8").read().split("\n")

    # blocchi <style> escluso l'anti-flash single-line (r.8)
    opens  = [i for i, l in enumerate(lines) if l.strip() == "<style>"]
    closes = [i for i, l in enumerate(lines) if l.strip() == "</style>"]
    assert len(opens) == 2 and len(closes) == 2, f"attesi 2 blocchi style multi-riga, trovati {len(opens)}/{len(closes)}"
    (m_open, v_open), (m_close, v_close) = opens, closes
    assert m_open < m_close < v_open < v_close, "ordine blocchi inatteso"

    main_css = lines[m_open + 1:m_close]     # contenuto verbatim (senza i tag)
    vmbar_css = lines[v_open + 1:v_close]

    os.makedirs(os.path.dirname(CSS), exist_ok=True)
    with open(CSS, "w", encoding="utf-8") as f:
        f.write("/* analyzer.css — Fase 3 modularizzazione (2026-07-05): CSS estratto VERBATIM\n")
        f.write("   da syntesis-analyzer-v3b.html (blocco principale + blocco vmBar, in quest'ordine\n")
        f.write("   = cascata identica all'inline). L'anti-flash html{visibility:hidden} resta\n")
        f.write("   inline nel documento (deve applicarsi prima di ogni fetch). */\n")
        f.write("\n".join(main_css) + "\n")
        f.write("\n/* ==== §CSS-VMBAR ==== (ex blocco <style> accanto al markup vmBar) */\n")
        f.write("\n".join(vmbar_css) + "\n")

    # riscrittura monolite: PRIMA il blocco piu' in basso (vmBar), poi il principale
    lines[v_open:v_close + 1] = ["<!-- Fase 3: CSS vmBar migrato in /static/css/analyzer.css (coda, cascata invariata) -->"]
    lines[m_open:m_close + 1] = [
        "<!-- ==== §CSS-GLOBALE ==== -->",
        '<link rel="stylesheet" href="/static/css/analyzer.css">',
        "<!-- Fase 3: 892+37 righe CSS in /static/css/analyzer.css (verbatim; anti-flash resta inline r.8) -->",
    ]
    open(MONO, "w", encoding="utf-8").write("\n".join(lines))
    print(f"CSS estratto: {len(main_css)} + {len(vmbar_css)} righe -> {CSS}")
    print(f"monolite ora: {len(lines)} righe")

if __name__ == "__main__":
    main()
