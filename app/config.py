import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MESSAGE_DIR = DATA_DIR / "messages"

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}")
DEFAULT_DOMAIN = os.getenv("DEFAULT_DOMAIN", "relay.local")
SMTP_HOST = os.getenv("SMTP_HOST", "0.0.0.0")
SMTP_PORT = int(os.getenv("SMTP_PORT", "2525"))
MX_TARGET_HOST = os.getenv("MX_TARGET_HOST", "").strip().lower().rstrip(".")
PUBLIC_SMTP_PORT = int(os.getenv("PUBLIC_SMTP_PORT", "25"))
SIGNUP_OPEN = os.getenv("SIGNUP_OPEN", "false").strip().lower() in {"1", "true", "yes", "on"}
SIGNUP_INVITE_CODE = os.getenv("SIGNUP_INVITE_CODE", "").strip()
ALLOWED_SIGNUP_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ALLOWED_SIGNUP_EMAILS", "").split(",")
    if email.strip()
}
OUTBOUND_SMTP_HOST = os.getenv("OUTBOUND_SMTP_HOST", "").strip()
OUTBOUND_SMTP_PORT = int(os.getenv("OUTBOUND_SMTP_PORT", "587"))
OUTBOUND_SMTP_USER = os.getenv("OUTBOUND_SMTP_USER", "").strip()
OUTBOUND_SMTP_PASS = os.getenv("OUTBOUND_SMTP_PASS", "").strip()
OUTBOUND_SMTP_STARTTLS = os.getenv("OUTBOUND_SMTP_STARTTLS", "true").strip().lower() in {"1", "true", "yes", "on"}
# Per-file and per-message caps for outbound attachments on replies/forwards.
MAX_ATTACHMENT_BYTES = int(os.getenv("MAX_ATTACHMENT_BYTES", str(15 * 1024 * 1024)))
MAX_TOTAL_ATTACHMENT_BYTES = int(os.getenv("MAX_TOTAL_ATTACHMENT_BYTES", str(20 * 1024 * 1024)))
OUTBOUND_ALLOWED_DOMAINS = {
    domain.strip().lower().rstrip(".")
    for domain in os.getenv("OUTBOUND_ALLOWED_DOMAINS", "").split(",")
    if domain.strip()
}
FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()

# POP3(S) gateway: lets standard mail clients (Gmail/Outlook/Apple Mail) pull
# inbound mask mail. Read-only — serves the raw .eml each message already stores.
POP3_ENABLED = os.getenv("POP3_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
POP3_HOST = os.getenv("POP3_HOST", "0.0.0.0")
POP3_PORT = int(os.getenv("POP3_PORT", "995"))
# Implicit-TLS cert/key (PEM). If unset, the server runs plaintext POP3 (port 110
# style) — only acceptable for local testing; Gmail's fetcher requires TLS.
POP3_TLS_CERT = os.getenv("POP3_TLS_CERT", "").strip()
POP3_TLS_KEY = os.getenv("POP3_TLS_KEY", "").strip()
# Cap how many recent inbound messages a session exposes, to bound STAT/LIST cost.
POP3_MAX_MESSAGES = int(os.getenv("POP3_MAX_MESSAGES", "1000"))
