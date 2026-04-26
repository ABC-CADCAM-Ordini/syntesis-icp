"""
Syntesis-ICP - Modulo email transazionali via Resend
v7.3.9.065 - Pronto per attivazione

Configurazione richiesta in env vars:
  RESEND_API_KEY        chiave API Resend (re_xxxxx...)
  RESEND_FROM_EMAIL     indirizzo mittente (es. noreply@syntesis-icp.com)
  RESEND_FROM_NAME      nome mittente (es. Synthesis ICP)

Se RESEND_API_KEY non e\' settata, il modulo non solleva eccezioni:
ritorna False da send_*. Cosi\' il sistema condivisione funziona comunque
(reconcile alla registrazione + banner inviti in-app).
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_RESEND_AVAILABLE = False
try:
    import resend  # type: ignore
    _RESEND_AVAILABLE = True
except ImportError:
    logger.warning("resend non installato (pip install resend); email disabilitate")


def is_configured() -> bool:
    """Ritorna True se Resend e\' importato e c\'e\' una API key in env."""
    return _RESEND_AVAILABLE and bool(os.getenv("RESEND_API_KEY"))


def _get_from() -> str:
    """Costruisce l\'header From: \'Nome <email>\' o solo email."""
    name = os.getenv("RESEND_FROM_NAME", "Synthesis ICP")
    email = os.getenv("RESEND_FROM_EMAIL", "noreply@syntesis-icp.com")
    return f"{name} <{email}>" if name else email


def _send(to: str, subject: str, html: str, text: str) -> bool:
    """Invia un\'email via Resend. Ritorna True se accettata, False altrimenti.
    Non solleva eccezioni: il chiamante non deve dipendere dalla riuscita."""
    if not is_configured():
        logger.info(f"[email] not configured, skipping send to={to}")
        return False
    try:
        resend.api_key = os.getenv("RESEND_API_KEY")
        params = {
            "from":    _get_from(),
            "to":      [to],
            "subject": subject,
            "html":    html,
            "text":    text,
        }
        result = resend.Emails.send(params)
        logger.info(f"[email] sent to={to} id={result.get('id') if isinstance(result, dict) else '?'}")
        return True
    except Exception as e:
        logger.warning(f"[email] send failed to={to}: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Template specifici
# ─────────────────────────────────────────────────────────────────────────────

_BASE_FOOTER_HTML = """
<hr style="border:none;border-top:1px solid #D6E4F0;margin:30px 0 20px 0">
<div style="font-size:11px;color:#7A90A4;line-height:1.6;font-family:Helvetica,Arial,sans-serif">
  Hai ricevuto questa email perche\u0301 sei stato invitato a una cartella condivisa su Synthesis-ICP.<br>
  Synthesis-ICP e\u0301 di proprieta\u0300 di Francesco Biaggini, in licenza a Biaggini Medical Devices S.r.l.<br>
  Sede legale: Via Provinciale 1, Arcola (SP), Italia.<br>
  Per non ricevere piu\u0300 inviti da questo mittente, rispondi a questa email con oggetto "UNSUBSCRIBE".
</div>
"""

_BASE_FOOTER_TEXT = """

---
Hai ricevuto questa email perche\u0301 sei stato invitato a una cartella condivisa su Synthesis-ICP.
Synthesis-ICP e\u0301 di proprieta\u0300 di Francesco Biaggini, in licenza a Biaggini Medical Devices S.r.l.
Sede legale: Via Provinciale 1, Arcola (SP), Italia.
Per non ricevere piu\u0300 inviti da questo mittente, rispondi a questa email con oggetto "UNSUBSCRIBE".
"""


def send_share_invite_to_existing_user(
    to_email: str,
    to_name: Optional[str],
    owner_name: str,
    owner_email: str,
    folder_name: str,
    description: Optional[str],
    accept_url: str,
) -> bool:
    """Email per utenti gia\' registrati su Synthesis: link diretto al dashboard
    dove vedranno il banner "Hai 1 invito" e potranno accettare."""
    greeting = f"Ciao {to_name}," if to_name else "Ciao,"
    desc_block_html = ""
    desc_block_text = ""
    if description:
        desc_block_html = f'''<p style="font-size:14px;color:#3D5166;background:#F0F5FA;padding:12px 14px;border-radius:8px;border-left:3px solid #0065B3;font-style:italic">"{description}"</p>'''
        desc_block_text = f"\n  Descrizione: {description}\n"

    html = f"""<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:0;background:#F0F5FA;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F5FA;padding:40px 0">
<tr><td align="center">
<table role="presentation" width="540" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;padding:36px 40px;max-width:540px">
  <tr><td>
    <div style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#0065B3;font-weight:800;margin-bottom:18px">
      Synthesis-ICP &middot; Invito a cartella condivisa
    </div>
    <h1 style="font-size:22px;color:#0F1923;margin:0 0 18px 0;font-weight:800;line-height:1.3">
      {greeting}<br>
      {owner_name} ti vuole condividere una cartella di lavoro
    </h1>
    <p style="font-size:15px;color:#3D5166;line-height:1.6;margin:0 0 12px 0">
      Hai ricevuto un invito a collaborare sulla cartella
      <b style="color:#0F1923">{folder_name}</b>.
    </p>
    {desc_block_html}
    <p style="font-size:14px;color:#7A90A4;line-height:1.6;margin:18px 0 24px 0;font-family:monospace">
      Da: {owner_name} &lt;{owner_email}&gt;
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#0065B3;border-radius:8px">
          <a href="{accept_url}" style="display:inline-block;padding:13px 28px;color:#fff;text-decoration:none;font-weight:800;font-size:14px">
            Apri Synthesis e rispondi
          </a>
        </td>
      </tr>
    </table>
    <p style="font-size:12px;color:#7A90A4;line-height:1.6;margin:24px 0 0 0;font-family:monospace">
      Accettando l\'invito, Synthesis creera\' una cartella mirror nel tuo Google Drive
      e copiera\' i file esistenti dal Drive di {owner_name}. I file vengono trasferiti
      attraverso il nostro server senza essere conservati. Puoi sempre rifiutare l\'invito.
    </p>
    {_BASE_FOOTER_HTML}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

    text = f"""{greeting}

{owner_name} ti vuole condividere una cartella di lavoro su Synthesis-ICP.

  Cartella: {folder_name}
  Da: {owner_name} <{owner_email}>{desc_block_text}

Accedi a Synthesis per rispondere:
  {accept_url}

Accettando l\'invito, Synthesis creera\' una cartella mirror nel tuo Google Drive
e copiera\' i file esistenti dal Drive di {owner_name}. Puoi sempre rifiutare l\'invito.
{_BASE_FOOTER_TEXT}"""

    subject = f"{owner_name} ti vuole condividere \"{folder_name}\" su Synthesis-ICP"
    return _send(to_email, subject, html, text)


def send_share_invite_to_unregistered(
    to_email: str,
    owner_name: str,
    owner_email: str,
    folder_name: str,
    description: Optional[str],
    register_url: str,
) -> bool:
    """Email per contatti pending: non hanno ancora un account Synthesis.
    Linka alla pagina di registrazione."""
    desc_block_html = ""
    desc_block_text = ""
    if description:
        desc_block_html = f'''<p style="font-size:14px;color:#3D5166;background:#F0F5FA;padding:12px 14px;border-radius:8px;border-left:3px solid #0065B3;font-style:italic">"{description}"</p>'''
        desc_block_text = f"\n  Descrizione: {description}\n"

    html = f"""<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:0;background:#F0F5FA;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F5FA;padding:40px 0">
<tr><td align="center">
<table role="presentation" width="540" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;padding:36px 40px;max-width:540px">
  <tr><td>
    <div style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#0065B3;font-weight:800;margin-bottom:18px">
      Synthesis-ICP &middot; Sei stato invitato
    </div>
    <h1 style="font-size:22px;color:#0F1923;margin:0 0 18px 0;font-weight:800;line-height:1.3">
      {owner_name} ti ha invitato a Synthesis
    </h1>
    <p style="font-size:15px;color:#3D5166;line-height:1.6;margin:0 0 12px 0">
      {owner_name} ({owner_email}) vuole condividere con te la cartella di lavoro
      <b style="color:#0F1923">{folder_name}</b> su Synthesis-ICP, una piattaforma per
      lo scambio sicuro di scansioni dentali e file di lavorazione clinica.
    </p>
    {desc_block_html}
    <p style="font-size:15px;color:#3D5166;line-height:1.6;margin:18px 0">
      Per accedere ai file devi prima creare un account Synthesis con questa email.
      Una volta registrato, l\'invito verra\' attivato automaticamente.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#0065B3;border-radius:8px">
          <a href="{register_url}" style="display:inline-block;padding:13px 28px;color:#fff;text-decoration:none;font-weight:800;font-size:14px">
            Registrati e accedi alla cartella
          </a>
        </td>
      </tr>
    </table>
    <p style="font-size:12px;color:#7A90A4;line-height:1.6;margin:24px 0 0 0;font-family:monospace">
      Synthesis-ICP utilizza il permesso minimo Google Drive (drive.file): vede solo
      i file creati dall\'app stessa, mai il resto del tuo Drive personale.
    </p>
    {_BASE_FOOTER_HTML}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

    text = f"""Sei stato invitato a Synthesis-ICP

{owner_name} ({owner_email}) vuole condividere con te la cartella di lavoro
\"{folder_name}\" su Synthesis-ICP.{desc_block_text}

Per accedere ai file devi prima creare un account Synthesis con questa email.
Una volta registrato, l\'invito verra\' attivato automaticamente.

Registrati qui:
  {register_url}

Synthesis-ICP utilizza il permesso minimo Google Drive (drive.file): vede solo
i file creati dall\'app stessa, mai il resto del tuo Drive personale.
{_BASE_FOOTER_TEXT}"""

    subject = f"{owner_name} ti ha invitato a Synthesis-ICP"
    return _send(to_email, subject, html, text)
