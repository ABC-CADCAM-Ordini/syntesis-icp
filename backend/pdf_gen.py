"""
Generatore PDF server-side — Syntesis-ICP
"""

import io
import math
from datetime import datetime
from typing import Optional


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
    from reportlab.lib.colors import HexColor, black, white, Color
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                             leftMargin=20*mm, rightMargin=20*mm,
                             topMargin=20*mm, bottomMargin=20*mm)

    BLUE     = HexColor("#0065B3")
    BLUE_L   = HexColor("#E8F4FF")
    DARK     = HexColor("#0F1923")
    GRAY     = HexColor("#7A90A4")
    GREEN    = HexColor("#0D9E6E")
    RED      = HexColor("#DC2626")
    GOLD     = HexColor("#F59E0B")
    PEARL    = HexColor("#F0F5FA")

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", fontName="Helvetica-Bold",
                                  fontSize=18, textColor=BLUE, spaceAfter=4)
    sub_style   = ParagraphStyle("sub",   fontName="Helvetica",
                                  fontSize=9,  textColor=GRAY, spaceAfter=12)
    label_style = ParagraphStyle("lbl",   fontName="Helvetica-Bold",
                                  fontSize=8,  textColor=GRAY, spaceBefore=6)
    body_style  = ParagraphStyle("body",  fontName="Helvetica",
                                  fontSize=9,  textColor=DARK, leading=14)
    mono_style  = ParagraphStyle("mono",  fontName="Courier",
                                  fontSize=8,  textColor=DARK, leading=12)

    score       = record.get("score", 0)
    rmsd        = record.get("rmsd", 0.0)
    filename_a  = record.get("filename_a", "A.stl")
    filename_b  = record.get("filename_b", "B.stl")
    analysis_id = record.get("id", "—")
    created_at  = record.get("created_at", datetime.utcnow())
    pairs       = record.get("pairs", [])
    cyl_axes    = record.get("cyl_axes", [])
    profile     = record.get("detected_profile", "Generico")

    if score >= 90:   score_col, score_lbl = GREEN,  "Eccellente"
    elif score >= 75: score_col, score_lbl = HexColor("#639922"), "Ottimo"
    elif score >= 55: score_col, score_lbl = GOLD,   "Accettabile"
    elif score >= 35: score_col, score_lbl = HexColor("#F97316"), "Rischioso"
    else:             score_col, score_lbl = RED,    "Critico"

    story = []

    # Header
    story.append(Paragraph("Syntesis-ICP — Precision Scanner", title_style))
    story.append(Paragraph(
        f"Report di analisi · {created_at.strftime('%d/%m/%Y %H:%M') if hasattr(created_at,'strftime') else str(created_at)[:16]} · ID: {str(analysis_id)[:8].upper()}",
        sub_style))
    story.append(HRFlowable(width="100%", thickness=2, color=BLUE, spaceAfter=10))

    # Score block
    score_data = [[
        Paragraph(f"<font color='#{score_col.hexval()[2:]}' size='28'><b>{score}</b></font><font size='12' color='#7A90A4'>/100</font>", body_style),
        Paragraph(f"<font color='#{score_col.hexval()[2:]}' size='14'><b>{score_lbl}</b></font><br/>"
                  f"<font size='8' color='#7A90A4'>ICP RMSD: {rmsd:.4f} mm · Profilo: {profile}</font>", body_style),
        Paragraph(f"<font size='8' color='#7A90A4'>File A (riferimento)</font><br/><font size='8'>{filename_a}</font><br/>"
                  f"<font size='8' color='#7A90A4'>File B (confronto)</font><br/><font size='8'>{filename_b}</font>", body_style),
    ]]
    st = TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), BLUE_L),
        ("ROUNDEDCORNERS", (0,0), (-1,-1), [6]),
        ("BOX",         (0,0), (-1,-1), 0.5, BLUE),
        ("TOPPADDING",  (0,0), (-1,-1), 10),
        ("BOTTOMPADDING",(0,0),(-1,-1), 10),
        ("LEFTPADDING", (0,0), (-1,-1), 12),
        ("RIGHTPADDING",(0,0), (-1,-1), 12),
        ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
    ])
    t = Table(score_data, colWidths=[40*mm, 80*mm, 60*mm])
    t.setStyle(st)
    story.append(t)
    story.append(Spacer(1, 10*mm))

    # Tabella coppie
    story.append(Paragraph("DEVIAZIONI PER COPPIA", label_style))
    story.append(Spacer(1, 2*mm))

    headers = ["#", "dX (mm)", "dY (mm)", "dZ (mm)", "dXY (mm)", "|D| 3D (mm)", "μm", "Asse (°)"]
    rows = [headers]
    for i, pp in enumerate(pairs):
        if pp["d3"] is None:
            rows.append([f"#{i+1}", "—", "—", "—", "—", "—", "—", "—"])
            continue
        d3_um = round(pp["d3"] * 1000)
        ax = cyl_axes[i].get("angle_deg") if i < len(cyl_axes) else None
        rows.append([
            f"#{i+1}",
            f"{pp['dx']:+.4f}",
            f"{pp['dy']:+.4f}",
            f"{pp['dz']:+.4f}",
            f"{pp['dxy']:.4f}",
            f"{pp['d3']:.4f}",
            str(d3_um),
            f"{ax:.2f}" if ax is not None else "—",
        ])

    col_w = [10*mm, 22*mm, 22*mm, 22*mm, 22*mm, 24*mm, 14*mm, 18*mm]
    tbl = Table(rows, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,0), BLUE),
        ("TEXTCOLOR",     (0,0), (-1,0), white),
        ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",      (0,0), (-1,-1), 7),
        ("FONTNAME",      (0,1), (-1,-1), "Courier"),
        ("ALIGN",         (0,0), (-1,-1), "RIGHT"),
        ("ALIGN",         (0,0), (0,-1), "CENTER"),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [PEARL, white]),
        ("GRID",          (0,0), (-1,-1), 0.3, HexColor("#D6E4F0")),
        ("TOPPADDING",    (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 8*mm))

    # Footer
    story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#D6E4F0")))
    story.append(Paragraph(
        "© Francesco Biaggini — Biaggini Medical Devices S.r.l. · Documento generato automaticamente · Non modificare.",
        ParagraphStyle("footer", fontName="Helvetica", fontSize=7, textColor=GRAY, alignment=TA_CENTER, spaceBefore=6)
    ))

    doc.build(story)
    return buf.getvalue()


def _generate_minimal_pdf(record: dict) -> bytes:
    """PDF minimalista senza dipendenze esterne."""
    score = record.get("score", 0)
    rmsd  = record.get("rmsd", 0.0)
    fn_a  = record.get("filename_a", "A.stl")
    fn_b  = record.get("filename_b", "B.stl")
    pairs = record.get("pairs", [])
    now   = datetime.utcnow().strftime("%d/%m/%Y %H:%M UTC")

    lines = [
        f"Syntesis-ICP Precision Scanner",
        f"Report: {now}",
        f"",
        f"Score: {score}/100   ICP RMSD: {rmsd:.4f} mm",
        f"File A: {fn_a}",
        f"File B: {fn_b}",
        f"",
        f"Deviazioni per coppia:",
    ]
    for i, pp in enumerate(pairs):
        if pp["d3"] is not None:
            lines.append(f"  #{i+1}: dX={pp['dx']:+.4f} dY={pp['dy']:+.4f} dZ={pp['dz']:+.4f} |D|={pp['d3']:.4f} mm ({round(pp['d3']*1000)} um)")

    lines += ["", "(C) Francesco Biaggini - Biaggini Medical Devices S.r.l."]
    text = "\n".join(lines)

    # Costruzione PDF manuale minimale
    objects = []

    def add_obj(content):
        objects.append(content)
        return len(objects)

    catalog_id = 1
    pages_id   = 2
    page_id    = 3
    font_id    = 4
    content_id = 5

    page_text = "BT\n/F1 10 Tf\n50 750 Td\n14 TL\n"
    for line in lines:
        safe = line.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")
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
