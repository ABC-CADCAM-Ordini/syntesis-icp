"""
Generatore PDF server-side - Syntesis-ICP

v7.3.9.039 - 2026-04-26
- Fix: LS usata prima di definizione (NameError bloccante)
- Fix: typo fLS["report"] -> f-string corretta con LS["report"]
- Fix: white = colors.white (colors non importato)
- Score model versioning esplicito
"""

import io
import math
from datetime import datetime
from typing import Optional

VERSION = "7.3.9.040"
SCORE_MODEL_VERSION = "Syntesis Score v1.0"


# ──────────────────────────────────────────────────────────────────────────────
# Tabelle traduzione
# ──────────────────────────────────────────────────────────────────────────────
PDF_STRINGS = {
    "it": {
        "title": "Syntesis-ICP - Precision Scanner",
        "report": "Report di analisi",
        "devs": "DEVIAZIONI PER COPPIA",
        "score": "Voto precisione",
        "dist": "DISTANZE INTER-CENTROIDE",
        "fileA": "File A (riferimento)",
        "fileB": "File B (confronto)",
        "profile": "Profilo",
        "rmsdLabel": "ICP RMSD",
        "excellent": "Eccellente",
        "good": "Ottimo",
        "acceptable": "Accettabile",
        "risky": "Rischioso",
        "critical": "Critico",
        "pair": "Coppia",
        "cylinder": "Cilindro",
        "global": "Voto globale",
        "deviation": "Deviazione",
        "axis": "Asse cilindro",
        "centA": "Centroide A",
        "centB": "Centroide B allineato",
        "meshView": "VISUALIZZAZIONE MESH 3D",
        "devCard": "ANALISI DEVIAZIONI",
        "table": "TABELLA MISURAZIONI",
        "param": "Parametro",
        "value": "Valore",
        "eval": "Valutazione",
        "d3": "D3D totale",
        "dxy": "Deviazione XY (piano)",
        "dz": "Deviazione Z",
        "dx": "Deviazione X",
        "dy": "Deviazione Y",
        "dir": "DIREZIONE SPOSTAMENTO XY",
        "distTable": "DISTANZE INTER-CENTROIDE",
        "distA": "Distanza A",
        "distB": "Distanza B",
        "diff": "Differenza",
        "note": "Note",
        "scoreModel": "Modello voto",
        "warnings": "Avvertenze",
        "notEvaluable": "Caso non valutabile",
    },
    "en": {
        "title": "Syntesis-ICP - Precision Scanner",
        "report": "Analysis report",
        "devs": "DEVIATIONS PER PAIR",
        "score": "Precision score",
        "dist": "INTER-CENTROID DISTANCES",
        "fileA": "File A (reference)",
        "fileB": "File B (comparison)",
        "profile": "Profile",
        "rmsdLabel": "ICP RMSD",
        "excellent": "Excellent",
        "good": "Good",
        "acceptable": "Acceptable",
        "risky": "Risky",
        "critical": "Critical",
        "pair": "Pair",
        "cylinder": "Cylinder",
        "global": "Global score",
        "deviation": "Deviation",
        "axis": "Cylinder axis",
        "centA": "Centroid A",
        "centB": "Aligned centroid B",
        "meshView": "3D MESH VISUALIZATION",
        "devCard": "DEVIATION ANALYSIS",
        "table": "MEASUREMENTS TABLE",
        "param": "Parameter",
        "value": "Value",
        "eval": "Evaluation",
        "d3": "Total 3D |D|",
        "dxy": "XY deviation (plane)",
        "dz": "Z deviation",
        "dx": "X deviation",
        "dy": "Y deviation",
        "dir": "XY DISPLACEMENT DIRECTION",
        "distTable": "INTER-CENTROID DISTANCES",
        "distA": "Distance A",
        "distB": "Distance B",
        "diff": "Difference",
        "note": "Notes",
        "scoreModel": "Score model",
        "warnings": "Warnings",
        "notEvaluable": "Not evaluable",
    },
    "es": {
        "title": "Syntesis-ICP - Precision Scanner",
        "report": "Informe de analisis",
        "devs": "DESVIACIONES POR PAR",
        "score": "Puntuacion de precision",
        "dist": "DISTANCIAS INTER-CENTROIDE",
        "fileA": "Archivo A (referencia)",
        "fileB": "Archivo B (comparacion)",
        "profile": "Perfil",
        "rmsdLabel": "ICP RMSD",
        "excellent": "Excelente",
        "good": "Bueno",
        "acceptable": "Aceptable",
        "risky": "Arriesgado",
        "critical": "Critico",
        "pair": "Par",
        "cylinder": "Cilindro",
        "global": "Puntuacion global",
        "deviation": "Desviacion",
        "axis": "Eje del cilindro",
        "centA": "Centroide A",
        "centB": "Centroide B alineado",
        "meshView": "VISUALIZACION MALLA 3D",
        "devCard": "ANALISIS DE DESVIACION",
        "table": "TABLA DE MEDICIONES",
        "param": "Parametro",
        "value": "Valor",
        "eval": "Evaluacion",
        "d3": "D3D total",
        "dxy": "Desviacion XY (plano)",
        "dz": "Desviacion Z",
        "dx": "Desviacion X",
        "dy": "Desviacion Y",
        "dir": "DIRECCION DESPLAZAMIENTO XY",
        "distTable": "DISTANCIAS INTER-CENTROIDE",
        "distA": "Distancia A",
        "distB": "Distancia B",
        "diff": "Diferencia",
        "note": "Notas",
        "scoreModel": "Modelo de puntuacion",
        "warnings": "Advertencias",
        "notEvaluable": "No evaluable",
    },
    "fr": {
        "title": "Syntesis-ICP - Precision Scanner",
        "report": "Rapport d'analyse",
        "devs": "DEVIATIONS PAR PAIRE",
        "score": "Score de precision",
        "dist": "DISTANCES INTER-CENTROIDE",
        "fileA": "Fichier A (reference)",
        "fileB": "Fichier B (comparaison)",
        "profile": "Profil",
        "rmsdLabel": "ICP RMSD",
        "excellent": "Excellent",
        "good": "Bon",
        "acceptable": "Acceptable",
        "risky": "Risque",
        "critical": "Critique",
        "pair": "Paire",
        "cylinder": "Cylindre",
        "global": "Score global",
        "deviation": "Deviation",
        "axis": "Axe du cylindre",
        "centA": "Centroide A",
        "centB": "Centroide B aligne",
        "meshView": "VISUALISATION MAILLAGE 3D",
        "devCard": "ANALYSE DE DEVIATION",
        "table": "TABLEAU DE MESURES",
        "param": "Parametre",
        "value": "Valeur",
        "eval": "Evaluation",
        "d3": "D3D total",
        "dxy": "Deviation XY (plan)",
        "dz": "Deviation Z",
        "dx": "Deviation X",
        "dy": "Deviation Y",
        "dir": "DIRECTION DECALAGE XY",
        "distTable": "DISTANCES INTER-CENTROIDE",
        "distA": "Distance A",
        "distB": "Distance B",
        "diff": "Difference",
        "note": "Notes",
        "scoreModel": "Modele de score",
        "warnings": "Avertissements",
        "notEvaluable": "Non evaluable",
    },
    "de": {
        "title": "Syntesis-ICP - Precision Scanner",
        "report": "Analysebericht",
        "devs": "ABWEICHUNGEN PRO PAAR",
        "score": "Prazisionsbewertung",
        "dist": "INTER-ZENTROID-ABSTANDE",
        "fileA": "Datei A (Referenz)",
        "fileB": "Datei B (Vergleich)",
        "profile": "Profil",
        "rmsdLabel": "ICP RMSD",
        "excellent": "Ausgezeichnet",
        "good": "Gut",
        "acceptable": "Akzeptabel",
        "risky": "Riskant",
        "critical": "Kritisch",
        "pair": "Paar",
        "cylinder": "Zylinder",
        "global": "Gesamtbewertung",
        "deviation": "Abweichung",
        "axis": "Zylinderachse",
        "centA": "Zentroid A",
        "centB": "Ausgerichteter Zentroid B",
        "meshView": "3D-GITTER-VISUALISIERUNG",
        "devCard": "ABWEICHUNGSANALYSE",
        "table": "MESSTABELLE",
        "param": "Parameter",
        "value": "Wert",
        "eval": "Bewertung",
        "d3": "Gesamt 3D |D|",
        "dxy": "XY-Abweichung (Ebene)",
        "dz": "Z-Abweichung",
        "dx": "X-Abweichung",
        "dy": "Y-Abweichung",
        "dir": "XY-VERSATZRICHTUNG",
        "distTable": "INTER-ZENTROID-ABSTANDE",
        "distA": "Abstand A",
        "distB": "Abstand B",
        "diff": "Differenz",
        "note": "Notizen",
        "scoreModel": "Bewertungsmodell",
        "warnings": "Warnungen",
        "notEvaluable": "Nicht bewertbar",
    },
}


def generate_pdf(record: dict) -> bytes:
    """
    Genera un PDF firmato con i risultati dell'analisi.
    Usa reportlab se disponibile, altrimenti genera un PDF minimale.
    """
    try:
        return _generate_reportlab(record)
    except ImportError:
        return _generate_minimal_pdf(record)


def _generate_reportlab(record: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor, black, Color
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

    lang = record.get("lang", "it")
    LS = PDF_STRINGS.get(lang, PDF_STRINGS["en"])

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                             leftMargin=20*mm, rightMargin=20*mm,
                             topMargin=20*mm, bottomMargin=20*mm)

    # Palette
    BLUE     = HexColor("#0052A3")
    BLUE_L   = HexColor("#EBF4FF")
    BLUE_MID = HexColor("#1A6DC8")
    DARK     = HexColor("#0D1B2A")
    SLATE    = HexColor("#334155")
    GRAY     = HexColor("#64748B")
    GRAY_L   = HexColor("#F8FAFC")
    GREEN    = HexColor("#059669")
    AMBER    = HexColor("#D97706")
    RED      = HexColor("#DC2626")
    GOLD     = HexColor("#F59E0B")
    PEARL    = HexColor("#F1F5F9")
    TEAL     = HexColor("#0E7490")
    WHITE    = colors.white

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", fontName="Helvetica-Bold",
                                  fontSize=20, textColor=BLUE,
                                  spaceAfter=2, spaceBefore=0)
    sub_style   = ParagraphStyle("sub", fontName="Helvetica",
                                  fontSize=8.5, textColor=GRAY,
                                  spaceAfter=10)
    label_style = ParagraphStyle("lbl", fontName="Helvetica-Bold",
                                  fontSize=8, textColor=GRAY, spaceBefore=6)
    body_style  = ParagraphStyle("body", fontName="Helvetica",
                                  fontSize=9, textColor=DARK, leading=14)
    mono_style  = ParagraphStyle("mono", fontName="Courier",
                                  fontSize=8, textColor=DARK, leading=12)

    score        = record.get("score", 0)
    rmsd         = record.get("rmsd", 0.0)
    filename_a   = record.get("filename_a", "A.stl")
    filename_b   = record.get("filename_b", "B.stl")
    analysis_id  = record.get("id", "-")
    created_at   = record.get("created_at", datetime.utcnow())
    pairs        = record.get("pairs", [])
    cyl_axes     = record.get("cyl_axes", [])
    profile      = record.get("detected_profile", "Generico")
    score_model  = record.get("score_model_version", SCORE_MODEL_VERSION)
    warnings     = record.get("warnings", [])
    analysis_mode = record.get("analysis_mode", "pairwise")

    # Modalita' template -> non valutabile metrologicamente
    is_template_mode = analysis_mode == "template"

    # v7.3.9.040: soglie ALLINEATE a icp_engine.score_label() (modello canonico)
    # Sorgente unica: backend/icp_engine.py - score_label()
    # Range: >=85 Eccellente, >=70 Buono, >=50 Sufficiente, >=33 Scarso, <33 Critico
    if is_template_mode:
        score_col = GRAY
        score_lbl = LS["notEvaluable"]
    elif score >= 85:
        score_col, score_lbl = HexColor("#639922"), LS["excellent"]
    elif score >= 70:
        score_col, score_lbl = AMBER, LS["good"]
    elif score >= 50:
        score_col, score_lbl = HexColor("#F97316"), LS["acceptable"]
    elif score >= 33:
        score_col, score_lbl = RED, LS["risky"]
    else:
        score_col, score_lbl = HexColor("#A855F7"), LS["critical"]

    story = []

    # Header
    story.append(Paragraph(LS["title"], title_style))
    if hasattr(created_at, "strftime"):
        ts_str = created_at.strftime("%d/%m/%Y %H:%M")
    else:
        ts_str = str(created_at)[:16]
    aid_short = str(analysis_id)[:8].upper() if analysis_id else "-"
    story.append(Paragraph(
        f"{LS['report']} - {ts_str} - ID: {aid_short}",
        sub_style))
    story.append(HRFlowable(width="100%", thickness=2, color=BLUE, spaceAfter=10))

    # Score block
    score_display = "-" if is_template_mode else str(score)
    score_data = [[
        Paragraph(
            f"<font color='#{score_col.hexval()[2:]}' size='28'><b>{score_display}</b></font>"
            f"<font size='12' color='#7A90A4'>/100</font>",
            body_style
        ),
        Paragraph(
            f"<font color='#{score_col.hexval()[2:]}' size='14'><b>{score_lbl}</b></font><br/>"
            f"<font size='8' color='#7A90A4'>{LS['rmsdLabel']}: {rmsd:.4f} mm - {LS['profile']}: {profile}</font><br/>"
            f"<font size='7' color='#94A3B8'>{LS['scoreModel']}: {score_model}</font>",
            body_style
        ),
        Paragraph(
            f"<font size='8' color='#7A90A4'>{LS['fileA']}</font><br/>"
            f"<font size='8'>{filename_a}</font><br/>"
            f"<font size='8' color='#7A90A4'>{LS['fileB']}</font><br/>"
            f"<font size='8'>{filename_b}</font>",
            body_style
        ),
    ]]
    st = TableStyle([
        ("BACKGROUND",   (0,0), (-1,-1), BLUE_L),
        ("BACKGROUND",   (0,0), (0,-1), HexColor("#F0F7FF")),
        ("BOX",          (0,0), (-1,-1), 1.0, BLUE),
        ("LINEAFTER",    (0,0), (0,-1), 0.5, HexColor("#CBD5E1")),
        ("LINEAFTER",    (1,0), (1,-1), 0.5, HexColor("#CBD5E1")),
        ("TOPPADDING",   (0,0), (-1,-1), 12),
        ("BOTTOMPADDING",(0,0), (-1,-1), 12),
        ("LEFTPADDING",  (0,0), (-1,-1), 14),
        ("RIGHTPADDING", (0,0), (-1,-1), 14),
        ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
    ])
    t = Table(score_data, colWidths=[40*mm, 80*mm, 60*mm])
    t.setStyle(st)
    story.append(t)
    story.append(Spacer(1, 10*mm))

    # Avvertenze (se presenti)
    if warnings:
        story.append(Paragraph(LS["warnings"], label_style))
        story.append(Spacer(1, 2*mm))
        for w in warnings:
            msg = w.get("message", str(w)) if isinstance(w, dict) else str(w)
            sev = w.get("severity", "info") if isinstance(w, dict) else "info"
            sev_col = AMBER if sev == "warning" else (RED if sev == "error" else GRAY)
            story.append(Paragraph(
                f"<font color='#{sev_col.hexval()[2:]}' size='8'>- {msg}</font>",
                body_style
            ))
        story.append(Spacer(1, 6*mm))

    # Tabella coppie
    story.append(Paragraph(LS["devs"], label_style))
    story.append(Spacer(1, 2*mm))

    headers = ["#", "dX (mm)", "dY (mm)", "dZ (mm)", "dXY (mm)", "|D| 3D (mm)", "um", LS["axis"] + " (deg)"]
    rows = [headers]
    for i, pp in enumerate(pairs):
        if pp.get("d3") is None:
            rows.append([f"#{i+1}", "-", "-", "-", "-", "-", "-", "-"])
            continue
        d3_um = round(pp["d3"] * 1000)
        ax = cyl_axes[i].get("angle_deg") if i < len(cyl_axes) and cyl_axes[i] else None
        rows.append([
            f"#{i+1}",
            f"{pp['dx']:+.4f}",
            f"{pp['dy']:+.4f}",
            f"{pp['dz']:+.4f}",
            f"{pp['dxy']:.4f}",
            f"{pp['d3']:.4f}",
            str(d3_um),
            f"{ax:.2f}" if ax is not None else "-",
        ])

    if len(rows) == 1:
        rows.append(["-"] * 8)

    col_w = [10*mm, 22*mm, 22*mm, 22*mm, 22*mm, 24*mm, 14*mm, 18*mm]
    tbl = Table(rows, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,0), DARK),
        ("TEXTCOLOR",     (0,0), (-1,0), WHITE),
        ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",      (0,0), (-1,0), 7),
        ("FONTSIZE",      (0,1), (-1,-1), 7.5),
        ("FONTNAME",      (0,1), (-1,-1), "Courier"),
        ("ALIGN",         (0,0), (-1,-1), "RIGHT"),
        ("ALIGN",         (0,0), (0,-1), "CENTER"),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [GRAY_L, WHITE]),
        ("LINEBELOW",     (0,0), (-1,0), 0, BLUE_MID),
        ("LINEBELOW",     (0,1), (-1,-2), 0.2, HexColor("#E2E8F0")),
        ("BOX",           (0,0), (-1,-1), 0.5, HexColor("#CBD5E1")),
        ("TOPPADDING",    (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 8*mm))

    # Footer
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#D6E4F0")))
    story.append(Paragraph(
        f"Syntesis-ICP v{VERSION} - (C) Francesco Biaggini - Biaggini Medical Devices S.r.l. - "
        f"Documento generato automaticamente.",
        ParagraphStyle("footer", fontName="Helvetica", fontSize=7, textColor=GRAY, alignment=TA_CENTER, spaceBefore=6)
    ))

    doc.build(story)
    return buf.getvalue()


def _generate_minimal_pdf(record: dict) -> bytes:
    """PDF minimalista senza dipendenze esterne (fallback se reportlab manca)."""
    score = record.get("score", 0)
    rmsd  = record.get("rmsd", 0.0)
    fn_a  = record.get("filename_a", "A.stl")
    fn_b  = record.get("filename_b", "B.stl")
    pairs = record.get("pairs", [])
    score_model = record.get("score_model_version", SCORE_MODEL_VERSION)
    now   = datetime.utcnow().strftime("%d/%m/%Y %H:%M UTC")

    lines = [
        f"Syntesis-ICP Precision Scanner",
        f"Report: {now}",
        f"",
        f"Score: {score}/100   ICP RMSD: {rmsd:.4f} mm",
        f"Score model: {score_model}",
        f"File A: {fn_a}",
        f"File B: {fn_b}",
        f"",
        f"Deviazioni per coppia:",
    ]
    for i, pp in enumerate(pairs):
        if pp.get("d3") is not None:
            lines.append(
                f"  #{i+1}: dX={pp['dx']:+.4f} dY={pp['dy']:+.4f} "
                f"dZ={pp['dz']:+.4f} |D|={pp['d3']:.4f} mm "
                f"({round(pp['d3']*1000)} um)"
            )

    lines += ["", "(C) Francesco Biaggini - Biaggini Medical Devices S.r.l."]

    page_text = "BT\n/F1 10 Tf\n50 750 Td\n14 TL\n"
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        page_text += f"({safe}) Tj T*\n"
    page_text += "ET"
    page_bytes = page_text.encode("latin-1", errors="replace")

    body = (
        f"%PDF-1.4\n"
        f"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        f"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        f"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]"
        f" /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>\nendobj\n"
        f"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n"
        f"5 0 obj\n<< /Length {len(page_bytes)} >>\nstream\n"
    ).encode()

    body += page_bytes
    body += b"\nendstream\nendobj\n"

    xref_pos = len(body)
    body += (
        f"xref\n0 6\n"
        f"0000000000 65535 f \n"
        f"0000000009 00000 n \n"
        f"0000000058 00000 n \n"
        f"0000000115 00000 n \n"
        f"0000000266 00000 n \n"
        f"0000000340 00000 n \n"
        f"trailer\n<< /Size 6 /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode()

    return body
