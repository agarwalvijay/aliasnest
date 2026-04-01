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
