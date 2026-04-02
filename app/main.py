from datetime import datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parseaddr
import logging
import hashlib
from pathlib import Path
import re
import secrets
import smtplib
from typing import Optional
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from .auth import hash_password, verify_password
from .config import (
    ALLOWED_SIGNUP_EMAILS,
    DEFAULT_DOMAIN,
    MESSAGE_DIR,
    MX_TARGET_HOST,
    OUTBOUND_ALLOWED_DOMAINS,
    OUTBOUND_FROM_NAME,
    OUTBOUND_SMTP_HOST,
    OUTBOUND_SMTP_PASS,
    OUTBOUND_SMTP_PORT,
    OUTBOUND_SMTP_STARTTLS,
    OUTBOUND_SMTP_USER,
    PUBLIC_SMTP_PORT,
    SECRET_KEY,
    SIGNUP_INVITE_CODE,
    SIGNUP_OPEN,
    SMTP_HOST,
    SMTP_PORT,
)
from .database import Base, SessionLocal, engine, get_db
from .models import ApiToken, Domain, Mask, Message, PushToken, User
from .smtp_receiver import SMTPServerRuntime

try:
    import dns.resolver
    from dns.exception import DNSException

    DNS_AVAILABLE = True
except ImportError:
    DNS_AVAILABLE = False

    class DNSException(Exception):
        pass


app = FastAPI(title="Home Email Relay MVP")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY)
logger = logging.getLogger(__name__)

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")

smtp_runtime = SMTPServerRuntime(SMTP_HOST, SMTP_PORT)


def _normalize_domain(domain: str) -> str:
    return domain.strip().lower().rstrip(".")


def _is_valid_local_part(local_part: str) -> bool:
    return bool(re.fullmatch(r"[a-zA-Z0-9._+-]{2,64}", local_part))


def _is_valid_domain(domain: str) -> bool:
    return bool(
        re.fullmatch(
            r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",
            domain,
        )
    )


def _generate_domain_token() -> str:
    return f"relay-verify-{secrets.token_urlsafe(18)}"


def _extract_txt_values(txt_answers) -> set[str]:
    values = set()
    for answer in txt_answers:
        if hasattr(answer, "strings"):
            value = b"".join(answer.strings).decode("utf-8", errors="ignore")
        else:
            value = str(answer).replace('"', "")
        values.add(value.strip())
    return values


def _extract_mx_hosts(mx_answers) -> set[str]:
    hosts = set()
    for answer in mx_answers:
        exchange = getattr(answer, "exchange", None)
        value = str(exchange or answer).strip().lower().rstrip(".")
        if value:
            hosts.add(value)
    return hosts


def _can_send_from_domain(domain: str) -> bool:
    if not OUTBOUND_SMTP_HOST or not OUTBOUND_SMTP_USER or not OUTBOUND_SMTP_PASS:
        return False
    if "*" in OUTBOUND_ALLOWED_DOMAINS:
        return True
    return domain.strip().lower().rstrip(".") in OUTBOUND_ALLOWED_DOMAINS


def _reply_metadata(message: Message) -> tuple[str, str, str, str, list[str]]:
    reply_to = ""
    message_id = ""
    references = ""
    subject = message.subject or "(No Subject)"
    to_cc_addresses: list[str] = []
    try:
        raw_path = Path(message.raw_path)
        if raw_path.exists():
            parsed = BytesParser(policy=policy.default).parsebytes(raw_path.read_bytes())
            reply_to = parsed.get("Reply-To", "") or parsed.get("From", "")
            message_id = parsed.get("Message-ID", "") or ""
            references = parsed.get("References", "") or ""
            subject = parsed.get("Subject", "") or subject
            to_cc_addresses = [addr.strip().lower() for _, addr in getaddresses([parsed.get("To", ""), parsed.get("Cc", "")]) if addr]
    except Exception:
        reply_to = ""

    if not reply_to:
        reply_to = message.from_addr
    _, reply_address = parseaddr(reply_to)
    if not reply_address:
        _, reply_address = parseaddr(message.from_addr)
    return reply_address.strip().lower(), message_id.strip(), references.strip(), subject, to_cc_addresses


def _compute_reply_targets(mask: Mask, target_email: str, to_cc_addresses: list[str], reply_all: bool) -> list[str]:
    if not target_email:
        return []
    if not reply_all:
        return [target_email]

    mask_sender = f"{mask.local_part}@{mask.domain}".strip().lower()
    recipients = {target_email}
    recipients.update(to_cc_addresses)
    recipients.discard(mask_sender)
    recipients.discard("")
    return sorted(recipients)


def _extract_message_body(message: Message) -> str:
    try:
        raw_path = Path(message.raw_path)
        if not raw_path.exists():
            return message.text_preview or ""
        parsed = BytesParser(policy=policy.default).parsebytes(raw_path.read_bytes())
        if parsed.is_multipart():
            for part in parsed.walk():
                if part.get_content_type() == "text/plain":
                    content = part.get_content()
                    if content:
                        return str(content).strip()
        elif parsed.get_content_type() == "text/plain":
            content = parsed.get_content()
            if content:
                return str(content).strip()
    except Exception:
        pass
    return message.text_preview or ""


def _send_reply_email(mask: Mask, target_emails: list[str], reply_body: str, in_reply_to: str, references: str, original_subject: str):
    subject = original_subject.strip() if original_subject else "(No Subject)"
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    sender = f"{mask.local_part}@{mask.domain}"
    msg = EmailMessage()
    msg["From"] = f"{OUTBOUND_FROM_NAME} <{sender}>"
    msg["To"] = ", ".join(target_emails)
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references and in_reply_to:
        msg["References"] = f"{references} {in_reply_to}".strip()
    elif in_reply_to:
        msg["References"] = in_reply_to
    elif references:
        msg["References"] = references
    msg.set_content(reply_body)

    with smtplib.SMTP(OUTBOUND_SMTP_HOST, OUTBOUND_SMTP_PORT, timeout=20) as smtp:
        if OUTBOUND_SMTP_STARTTLS:
            smtp.starttls()
        smtp.login(OUTBOUND_SMTP_USER, OUTBOUND_SMTP_PASS)
        smtp.send_message(msg)
    return msg, sender, subject


def _ensure_default_domain():
    db = SessionLocal()
    try:
        normalized_default = _normalize_domain(DEFAULT_DOMAIN)
        # Keep exactly one shared default domain.
        existing_defaults = db.scalars(select(Domain).where(Domain.is_default.is_(True))).all()
        for default_domain in existing_defaults:
            if default_domain.name != normalized_default:
                default_domain.is_default = False

        existing = db.scalar(select(Domain).where(Domain.name == normalized_default))
        if existing:
            existing.is_default = True
            existing.is_verified = True
            existing.user_id = None
            if not existing.verified_at:
                existing.verified_at = datetime.utcnow()
            if not existing.verification_token:
                existing.verification_token = _generate_domain_token()
            db.commit()
            return

        domain = Domain(
            user_id=None,
            name=normalized_default,
            verification_token=_generate_domain_token(),
            is_default=True,
            is_verified=True,
            verified_at=datetime.utcnow(),
        )
        db.add(domain)
        db.commit()
    finally:
        db.close()


def _ensure_mask_uniqueness_index():
    db = SessionLocal()
    try:
        db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_mask_local_domain_idx ON masks(local_part, domain)"))
        db.commit()
    finally:
        db.close()


def _ensure_message_is_outbound_column():
    db = SessionLocal()
    try:
        table_info = db.execute(text("PRAGMA table_info(messages)")).fetchall()
        existing_columns = {row[1] for row in table_info}
        if "is_outbound" not in existing_columns:
            db.execute(text("ALTER TABLE messages ADD COLUMN is_outbound INTEGER NOT NULL DEFAULT 0"))
            db.commit()
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_messages_is_outbound ON messages(is_outbound)"))
        db.commit()
    finally:
        db.close()


def _ensure_message_read_column():
    db = SessionLocal()
    try:
        table_info = db.execute(text("PRAGMA table_info(messages)")).fetchall()
        existing_columns = {row[1] for row in table_info}
        if "is_read" not in existing_columns:
            db.execute(text("ALTER TABLE messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0"))
            db.commit()
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_messages_is_read ON messages(is_read)"))
        db.commit()
    finally:
        db.close()


def _ensure_user_timezone_column():
    db = SessionLocal()
    try:
        table_info = db.execute(text("PRAGMA table_info(users)")).fetchall()
        existing_columns = {row[1] for row in table_info}
        if "timezone" not in existing_columns:
            db.execute(text("ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'"))
            db.commit()
    finally:
        db.close()


def _safe_tz_name(tz_name: str) -> str:
    candidate = (tz_name or "").strip()
    if not candidate:
        return "UTC"
    try:
        ZoneInfo(candidate)
        return candidate
    except ZoneInfoNotFoundError:
        return "UTC"


def _format_dt_for_user(dt: datetime, tz_name: str, fmt: str) -> str:
    timezone_name = _safe_tz_name(tz_name)
    localized = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(timezone_name))
    return localized.strftime(fmt)


TIMEZONE_OPTIONS = [
    "UTC",
    "America/Chicago",
    "America/New_York",
    "America/Los_Angeles",
    "America/Denver",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "Europe/Amsterdam",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
]


class ApiLoginRequest(BaseModel):
    email: str
    password: str


class ApiTimezoneRequest(BaseModel):
    timezone: str


class ApiCreateMaskRequest(BaseModel):
    local_part: str
    domain_name: str


class ApiAddDomainRequest(BaseModel):
    domain_name: str


class ApiReplyRequest(BaseModel):
    body: str
    reply_all: bool = False


class ApiRegisterRequest(BaseModel):
    email: str
    password: str
    invite_code: str = ""


class ApiToggleMaskRequest(BaseModel):
    is_active: bool


class ApiPushTokenRequest(BaseModel):
    token: str
    platform: str = "fcm"


def _hash_api_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _mint_api_token(user_id: int, db: Session) -> str:
    plain = secrets.token_urlsafe(40)
    db.add(ApiToken(user_id=user_id, token_hash=_hash_api_token(plain), is_revoked=False))
    db.commit()
    return plain


def _message_to_api_payload(message: Message, tz_name: str) -> dict:
    return {
        "id": message.id,
        "mask_id": message.mask_id,
        "from": message.from_addr,
        "to": message.to_addr,
        "subject": message.subject,
        "preview": message.text_preview,
        "is_outbound": bool(message.is_outbound),
        "is_read": bool(message.is_read),
        "received_at_utc": message.received_at.isoformat() + "Z",
        "received_at_local": _format_dt_for_user(message.received_at, tz_name, "%Y-%m-%d %H:%M:%S"),
        "timezone": _safe_tz_name(tz_name),
    }


def _domain_to_api_payload(domain: Domain) -> dict:
    return {
        "id": domain.id,
        "name": domain.name,
        "is_default": bool(domain.is_default),
        "is_verified": bool(domain.is_verified),
        "can_use_for_mask": bool(domain.is_default or domain.is_verified),
        "verification_token": None if domain.is_default else domain.verification_token,
        "verify_host": None if domain.is_default else f"_relay-verify.{domain.name}",
        "mx_host": None if domain.is_default else domain.name,
        "mx_type": None if domain.is_default else "MX",
        "mx_value": None if domain.is_default else (MX_TARGET_HOST or "your inbound mail host"),
        "mx_target_host": MX_TARGET_HOST or None,
        "public_smtp_port": int(PUBLIC_SMTP_PORT),
    }


def _parse_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", maxsplit=1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def require_api_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    token = _parse_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token_hash = _hash_api_token(token)
    token_row = db.scalar(select(ApiToken).where(ApiToken.token_hash == token_hash, ApiToken.is_revoked.is_(False)))
    if not token_row:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get(User, token_row.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token user")
    token_row.last_used_at = datetime.utcnow()
    db.commit()
    return user


def _ensure_mask_is_active_column():
    db = SessionLocal()
    try:
        table_info = db.execute(text("PRAGMA table_info(masks)")).fetchall()
        existing_columns = {row[1] for row in table_info}
        if "is_active" not in existing_columns:
            db.execute(text("ALTER TABLE masks ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"))
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
def startup_event():
    Base.metadata.create_all(bind=engine)
    _ensure_mask_uniqueness_index()
    _ensure_message_is_outbound_column()
    _ensure_message_read_column()
    _ensure_user_timezone_column()
    _ensure_mask_is_active_column()
    _ensure_default_domain()
    smtp_runtime.start()


@app.on_event("shutdown")
def shutdown_event():
    smtp_runtime.stop()


def current_user(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    return db.get(User, user_id)


def require_user(user: Optional[User] = Depends(current_user)) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _can_register(email: str, invite_code: str) -> Optional[str]:
    if SIGNUP_OPEN:
        return None

    normalized_email = email.strip().lower()
    if ALLOWED_SIGNUP_EMAILS and normalized_email in ALLOWED_SIGNUP_EMAILS:
        return None

    if SIGNUP_INVITE_CODE:
        if invite_code.strip() == SIGNUP_INVITE_CODE:
            return None
        return "Registration requires a valid invite code."

    if ALLOWED_SIGNUP_EMAILS:
        return "Registration is restricted. Your email is not approved."

    return "Registration is currently closed."


@app.get("/")
def root(request: Request, user: Optional[User] = Depends(current_user)):
    if user:
        return RedirectResponse(url="/dashboard", status_code=302)
    return RedirectResponse(url="/login", status_code=302)


@app.get("/register")
def register_page(request: Request):
    return templates.TemplateResponse(
        "register.html",
        {
            "request": request,
            "error": None,
            "signup_open": SIGNUP_OPEN,
            "invite_required": bool(SIGNUP_INVITE_CODE),
            "allowlist_enabled": bool(ALLOWED_SIGNUP_EMAILS),
        },
    )


@app.post("/register")
def register_action(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    invite_code: str = Form(""),
    db: Session = Depends(get_db),
):
    email = email.strip().lower()
    registration_error = _can_register(email, invite_code)
    if registration_error:
        return templates.TemplateResponse(
            "register.html",
            {
                "request": request,
                "error": registration_error,
                "signup_open": SIGNUP_OPEN,
                "invite_required": bool(SIGNUP_INVITE_CODE),
                "allowlist_enabled": bool(ALLOWED_SIGNUP_EMAILS),
            },
            status_code=403,
        )

    if len(password) < 8:
        return templates.TemplateResponse(
            "register.html",
            {
                "request": request,
                "error": "Password must be at least 8 characters.",
                "signup_open": SIGNUP_OPEN,
                "invite_required": bool(SIGNUP_INVITE_CODE),
                "allowlist_enabled": bool(ALLOWED_SIGNUP_EMAILS),
            },
            status_code=400,
        )

    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        return templates.TemplateResponse(
            "register.html",
            {
                "request": request,
                "error": "Email already registered.",
                "signup_open": SIGNUP_OPEN,
                "invite_required": bool(SIGNUP_INVITE_CODE),
                "allowlist_enabled": bool(ALLOWED_SIGNUP_EMAILS),
            },
            status_code=400,
        )

    user = User(email=email, password_hash=hash_password(password), timezone="UTC")
    db.add(user)
    db.commit()
    db.refresh(user)
    request.session["user_id"] = user.id
    return RedirectResponse(url="/dashboard", status_code=302)


@app.get("/login")
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@app.post("/login")
def login_action(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(password, user.password_hash):
        return templates.TemplateResponse("login.html", {"request": request, "error": "Invalid credentials."}, status_code=400)

    request.session["user_id"] = user.id
    return RedirectResponse(url="/dashboard", status_code=302)


@app.post("/logout")
def logout_action(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=302)


@app.post("/api/auth/login")
def api_login(payload: ApiLoginRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _mint_api_token(user.id, db)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "timezone": _safe_tz_name(user.timezone),
        },
    }


@app.post("/api/auth/register")
def api_register(payload: ApiRegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    registration_error = _can_register(email, payload.invite_code)
    if registration_error:
        raise HTTPException(status_code=403, detail=registration_error)

    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered.")

    user = User(email=email, password_hash=hash_password(payload.password), timezone="UTC")
    db.add(user)
    db.commit()
    db.refresh(user)
    token = _mint_api_token(user.id, db)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "timezone": "UTC",
        },
    }


@app.post("/api/auth/logout")
def api_logout(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    token = _parse_bearer_token(authorization)
    if token:
        token_hash = _hash_api_token(token)
        token_row = db.scalar(select(ApiToken).where(ApiToken.token_hash == token_hash, ApiToken.is_revoked.is_(False)))
        if token_row:
            token_row.is_revoked = True
            db.commit()
    return {"ok": True}


@app.get("/api/me")
def api_me(user: User = Depends(require_api_user)):
    return {
        "id": user.id,
        "email": user.email,
        "timezone": _safe_tz_name(user.timezone),
    }


@app.patch("/api/me/timezone")
def api_update_timezone(
    payload: ApiTimezoneRequest,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    db_user = db.get(User, user.id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db_user.timezone = _safe_tz_name(payload.timezone)
    db.commit()
    return {"timezone": db_user.timezone}


@app.get("/api/masks")
def api_list_masks(user: User = Depends(require_api_user), db: Session = Depends(get_db)):
    masks = db.scalars(select(Mask).where(Mask.user_id == user.id).order_by(Mask.created_at.desc())).all()
    unread_rows = db.execute(
        select(Message.mask_id, func.count(Message.id))
        .join(Mask, Message.mask_id == Mask.id)
        .where(
            Mask.user_id == user.id,
            Message.is_outbound.is_(False),
            Message.is_read.is_(False),
        )
        .group_by(Message.mask_id)
    ).all()
    unread_counts = {mask_id: count for mask_id, count in unread_rows}
    return {
        "items": [
            {
                "id": mask.id,
                "address": f"{mask.local_part}@{mask.domain}",
                "local_part": mask.local_part,
                "domain": mask.domain,
                "is_active": bool(mask.is_active),
                "unread_count": int(unread_counts.get(mask.id, 0)),
            }
            for mask in masks
        ]
    }


@app.patch("/api/masks/{mask_id}")
def api_toggle_mask(
    mask_id: int,
    payload: ApiToggleMaskRequest,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    mask = db.scalar(select(Mask).where(Mask.id == mask_id, Mask.user_id == user.id))
    if not mask:
        raise HTTPException(status_code=404, detail="Mask not found")
    mask.is_active = payload.is_active
    db.commit()
    return {
        "id": mask.id,
        "address": f"{mask.local_part}@{mask.domain}",
        "local_part": mask.local_part,
        "domain": mask.domain,
        "is_active": bool(mask.is_active),
    }


@app.post("/api/push-token")
def api_register_push_token(
    payload: ApiPushTokenRequest,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")
    platform = payload.platform.strip() or "fcm"
    existing = db.scalar(select(PushToken).where(PushToken.token == token))
    if existing:
        existing.user_id = user.id
        existing.platform = platform
    else:
        db.add(PushToken(user_id=user.id, token=token, platform=platform))
    db.commit()
    return {"ok": True}


@app.get("/api/domains")
def api_list_domains(user: User = Depends(require_api_user), db: Session = Depends(get_db)):
    domains = db.scalars(
        select(Domain)
        .where(or_(Domain.is_default.is_(True), Domain.user_id == user.id))
        .order_by(Domain.is_default.desc(), Domain.created_at.desc())
    ).all()
    return {"items": [_domain_to_api_payload(domain) for domain in domains]}


@app.post("/api/domains")
def api_add_domain(
    payload: ApiAddDomainRequest,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    clean_domain = _normalize_domain(payload.domain_name)
    if not _is_valid_domain(clean_domain):
        raise HTTPException(status_code=400, detail="Invalid domain format")

    existing = db.scalar(select(Domain).where(Domain.name == clean_domain))
    if existing:
        if existing.user_id == user.id or existing.is_default:
            return _domain_to_api_payload(existing)
        raise HTTPException(status_code=409, detail="Domain is already claimed by another user")

    domain = Domain(
        user_id=user.id,
        name=clean_domain,
        verification_token=_generate_domain_token(),
        is_default=False,
        is_verified=False,
    )
    db.add(domain)
    db.commit()
    db.refresh(domain)
    return _domain_to_api_payload(domain)


@app.post("/api/domains/{domain_id}/verify")
def api_verify_domain(
    domain_id: int,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    domain = db.scalar(select(Domain).where(Domain.id == domain_id, Domain.user_id == user.id))
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain.is_verified:
        return _domain_to_api_payload(domain)
    if not DNS_AVAILABLE:
        raise HTTPException(status_code=400, detail="DNS verification requires dnspython")

    verify_host = f"_relay-verify.{domain.name}"
    try:
        txt_answers = dns.resolver.resolve(verify_host, "TXT")
        txt_values = _extract_txt_values(txt_answers)
    except DNSException:
        raise HTTPException(status_code=400, detail="TXT record not found yet")

    if domain.verification_token not in txt_values:
        raise HTTPException(status_code=400, detail="TXT token mismatch")

    try:
        mx_answers = dns.resolver.resolve(domain.name, "MX")
        mx_hosts = _extract_mx_hosts(mx_answers)
    except DNSException:
        raise HTTPException(status_code=400, detail="MX record not found yet")

    if MX_TARGET_HOST and MX_TARGET_HOST not in mx_hosts:
        raise HTTPException(status_code=400, detail=f"MX must include {MX_TARGET_HOST}")

    domain.is_verified = True
    domain.verified_at = datetime.utcnow()
    db.commit()
    db.refresh(domain)
    return _domain_to_api_payload(domain)


@app.delete("/api/domains/{domain_id}")
def api_delete_domain(
    domain_id: int,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    domain = db.scalar(select(Domain).where(Domain.id == domain_id, Domain.user_id == user.id))
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain.is_default:
        raise HTTPException(status_code=400, detail="Default domain cannot be deleted")

    mask_exists = db.scalar(select(Mask).where(Mask.domain == domain.name))
    if mask_exists:
        raise HTTPException(status_code=400, detail="Delete masks on this domain first")

    db.delete(domain)
    db.commit()
    return {"ok": True}


@app.post("/api/masks")
def api_create_mask(
    payload: ApiCreateMaskRequest,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    clean_local = payload.local_part.strip().lower()
    clean_domain = _normalize_domain(payload.domain_name)
    if not _is_valid_local_part(clean_local):
        raise HTTPException(status_code=400, detail="Invalid mask name")

    selected_domain = db.scalar(
        select(Domain).where(
            Domain.name == clean_domain,
            Domain.is_verified.is_(True),
            or_(Domain.is_default.is_(True), Domain.user_id == user.id),
        )
    )
    if not selected_domain:
        raise HTTPException(status_code=400, detail="Domain not verified or unavailable")

    existing = db.scalar(select(Mask).where(Mask.local_part == clean_local, Mask.domain == clean_domain))
    if existing:
        if existing.user_id == user.id:
            return {
                "id": existing.id,
                "address": f"{existing.local_part}@{existing.domain}",
                "local_part": existing.local_part,
                "domain": existing.domain,
                "is_active": bool(existing.is_active),
            }
        raise HTTPException(status_code=409, detail="Mask already exists")

    mask = Mask(user_id=user.id, local_part=clean_local, domain=clean_domain)
    db.add(mask)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Mask already exists")
    db.refresh(mask)
    return {
        "id": mask.id,
        "address": f"{mask.local_part}@{mask.domain}",
        "local_part": mask.local_part,
        "domain": mask.domain,
        "is_active": bool(mask.is_active),
    }


@app.delete("/api/masks/{mask_id}")
def api_delete_mask(mask_id: int, user: User = Depends(require_api_user), db: Session = Depends(get_db)):
    mask = db.scalar(select(Mask).where(Mask.id == mask_id, Mask.user_id == user.id))
    if not mask:
        raise HTTPException(status_code=404, detail="Mask not found")

    messages = db.scalars(select(Message).where(Message.mask_id == mask.id)).all()
    for message in messages:
        try:
            raw_file = Path(message.raw_path)
            if raw_file.exists():
                raw_file.unlink()
        except OSError:
            pass
        db.delete(message)
    db.delete(mask)
    db.commit()
    return {"ok": True}


@app.get("/api/masks/{mask_id}/messages")
def api_list_mask_messages(
    mask_id: int,
    limit: int = 100,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    mask = db.scalar(select(Mask).where(Mask.id == mask_id, Mask.user_id == user.id))
    if not mask:
        raise HTTPException(status_code=404, detail="Mask not found")
    safe_limit = max(1, min(limit, 200))
    messages = db.scalars(
        select(Message)
        .where(Message.mask_id == mask.id)
        .order_by(Message.received_at.desc())
        .limit(safe_limit)
    ).all()
    tz_name = _safe_tz_name(user.timezone)
    return {
        "mask": {
            "id": mask.id,
            "address": f"{mask.local_part}@{mask.domain}",
            "domain": mask.domain,
            "local_part": mask.local_part,
        },
        "items": [_message_to_api_payload(message, tz_name) for message in messages],
    }


def _api_get_message_for_user(message_id: int, user_id: int, db: Session) -> Message:
    message = db.scalar(
        select(Message)
        .join(Mask, Message.mask_id == Mask.id)
        .where(Message.id == message_id, Mask.user_id == user_id)
    )
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


@app.get("/api/messages/{message_id}")
def api_get_message(message_id: int, user: User = Depends(require_api_user), db: Session = Depends(get_db)):
    message = _api_get_message_for_user(message_id, user.id, db)
    data = _message_to_api_payload(message, _safe_tz_name(user.timezone))
    data["body"] = _extract_message_body(message)
    return data


@app.post("/api/messages/{message_id}/mark-read")
def api_mark_message_read(message_id: int, user: User = Depends(require_api_user), db: Session = Depends(get_db)):
    message = _api_get_message_for_user(message_id, user.id, db)
    message.is_read = True
    db.commit()
    return {"ok": True, "is_read": True}


@app.post("/api/messages/{message_id}/mark-unread")
def api_mark_message_unread(message_id: int, user: User = Depends(require_api_user), db: Session = Depends(get_db)):
    message = _api_get_message_for_user(message_id, user.id, db)
    if not message.is_outbound:
        message.is_read = False
        db.commit()
    return {"ok": True, "is_read": bool(message.is_read)}


@app.delete("/api/messages/{message_id}")
def api_delete_message(message_id: int, user: User = Depends(require_api_user), db: Session = Depends(get_db)):
    message = _api_get_message_for_user(message_id, user.id, db)
    try:
        raw_file = Path(message.raw_path)
        if raw_file.exists():
            raw_file.unlink()
    except OSError:
        pass
    db.delete(message)
    db.commit()
    return {"ok": True}


@app.post("/api/messages/{message_id}/reply")
def api_reply_message(
    message_id: int,
    payload: ApiReplyRequest,
    user: User = Depends(require_api_user),
    db: Session = Depends(get_db),
):
    message = _api_get_message_for_user(message_id, user.id, db)
    if message.is_outbound:
        raise HTTPException(status_code=400, detail="Cannot reply to an outbound message")
    mask = db.get(Mask, message.mask_id)
    if not mask:
        raise HTTPException(status_code=404, detail="Mask not found")
    if not _can_send_from_domain(mask.domain):
        raise HTTPException(status_code=400, detail=f"Reply not enabled for {mask.domain}")
    cleaned_reply = payload.body.strip()
    if not cleaned_reply:
        raise HTTPException(status_code=400, detail="Reply body cannot be empty")

    target_email, in_reply_to, references, original_subject, to_cc_addresses = _reply_metadata(message)
    target_emails = _compute_reply_targets(mask, target_email, to_cc_addresses, payload.reply_all)
    if not target_emails:
        raise HTTPException(status_code=400, detail="No valid reply recipient found")
    try:
        sent_msg, sender, sent_subject = _send_reply_email(mask, target_emails, cleaned_reply, in_reply_to, references, original_subject)
    except Exception as exc:
        logger.exception("API reply send failed. message_id=%s", message.id)
        raise HTTPException(status_code=502, detail=f"Failed to send reply: {str(exc)}") from exc

    MESSAGE_DIR.mkdir(parents=True, exist_ok=True)
    outbound_raw_path = MESSAGE_DIR / f"{uuid.uuid4().hex}.eml"
    outbound_raw_path.write_bytes(sent_msg.as_bytes())
    outbound = Message(
        mask_id=mask.id,
        from_addr=sender[:500],
        to_addr=", ".join(target_emails)[:500],
        subject=sent_subject[:500],
        text_preview=cleaned_reply[:2000],
        is_outbound=True,
        is_read=True,
        raw_path=outbound_raw_path.as_posix(),
    )
    db.add(outbound)
    db.commit()
    db.refresh(outbound)
    return _message_to_api_payload(outbound, _safe_tz_name(user.timezone))


@app.post("/settings/timezone")
def update_timezone(
    timezone: str = Form(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    clean_timezone = _safe_tz_name(timezone)
    db_user = db.get(User, user.id)
    if not db_user:
        return RedirectResponse(url="/dashboard?error=User+not+found", status_code=302)
    db_user.timezone = clean_timezone
    db.commit()
    return RedirectResponse(url=f"/dashboard?info=Timezone+updated+to+{clean_timezone.replace('/', '%2F')}", status_code=302)


@app.get("/dashboard")
def dashboard(
    request: Request,
    selected_mask: Optional[int] = None,
    selected_message: Optional[int] = None,
    mark_read: bool = False,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    user_timezone = _safe_tz_name(getattr(user, "timezone", "UTC"))
    masks = db.scalars(select(Mask).where(Mask.user_id == user.id).order_by(Mask.created_at.desc())).all()
    domains = db.scalars(
        select(Domain)
        .where(or_(Domain.is_default.is_(True), Domain.user_id == user.id))
        .order_by(Domain.is_default.desc(), Domain.created_at.desc())
    ).all()
    custom_domains = [d for d in domains if not d.is_default]
    verified_domains = [d for d in domains if d.is_default or d.is_verified]

    active_mask = None
    if selected_mask:
        active_mask = db.scalar(select(Mask).where(Mask.id == selected_mask, Mask.user_id == user.id))
    if not active_mask and masks:
        active_mask = masks[0]

    messages = []
    if active_mask:
        messages = db.scalars(
            select(Message)
            .where(Message.mask_id == active_mask.id)
            .order_by(Message.received_at.desc())
            .limit(100)
        ).all()

    unread_counts = {}
    unread_rows = db.execute(
        select(Message.mask_id, func.count(Message.id))
        .join(Mask, Message.mask_id == Mask.id)
        .where(
            Mask.user_id == user.id,
            Message.is_outbound.is_(False),
            Message.is_read.is_(False),
        )
        .group_by(Message.mask_id)
    ).all()
    for mask_id, count in unread_rows:
        unread_counts[mask_id] = count

    active_message = None
    if active_mask and messages:
        if selected_message:
            active_message = db.scalar(
                select(Message)
                .where(Message.id == selected_message, Message.mask_id == active_mask.id)
            )
        if not active_message:
            active_message = messages[0]
        if mark_read and active_message and (not active_message.is_outbound) and (not active_message.is_read):
            active_message.is_read = True
            db.commit()
            active_message = db.get(Message, active_message.id)
    can_reply_all_active_message = False
    if active_mask and active_message and (not active_message.is_outbound) and _can_send_from_domain(active_mask.domain):
        target_email, _, _, _, to_cc_addresses = _reply_metadata(active_message)
        reply_all_targets = _compute_reply_targets(active_mask, target_email, to_cc_addresses, True)
        can_reply_all_active_message = len(reply_all_targets) > 1

    message_times_short = {}
    message_times_full = {}
    for msg in messages:
        message_times_short[msg.id] = _format_dt_for_user(msg.received_at, user_timezone, "%m/%d %H:%M")
        message_times_full[msg.id] = _format_dt_for_user(msg.received_at, user_timezone, "%Y-%m-%d %H:%M:%S")

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "user": user,
            "masks": masks,
            "active_mask": active_mask,
            "messages": messages,
            "message_times_short": message_times_short,
            "message_times_full": message_times_full,
            "unread_counts": unread_counts,
            "default_domain": _normalize_domain(DEFAULT_DOMAIN),
            "domains": domains,
            "custom_domains": custom_domains,
            "verified_domains": verified_domains,
            "info": request.query_params.get("info"),
            "error": request.query_params.get("error"),
            "dns_available": DNS_AVAILABLE,
            "mx_target_host": MX_TARGET_HOST,
            "public_smtp_port": PUBLIC_SMTP_PORT,
            "can_reply_active_mask": bool(active_mask and _can_send_from_domain(active_mask.domain)),
            "can_reply_all_active_message": can_reply_all_active_message,
            "active_message": active_message,
            "active_message_body": _extract_message_body(active_message) if active_message else "",
            "user_timezone": user_timezone,
            "timezone_options": TIMEZONE_OPTIONS,
            "now": datetime.utcnow(),
        },
    )


@app.post("/masks")
def create_mask(
    local_part: str = Form(...),
    domain_name: str = Form(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    clean_local = local_part.strip().lower()
    clean_domain = _normalize_domain(domain_name)
    if not _is_valid_local_part(clean_local):
        return RedirectResponse(url="/dashboard?error=Invalid+mask+name", status_code=302)

    selected_domain = db.scalar(
        select(Domain).where(
            Domain.name == clean_domain,
            Domain.is_verified.is_(True),
            or_(Domain.is_default.is_(True), Domain.user_id == user.id),
        )
    )
    if not selected_domain:
        return RedirectResponse(url="/dashboard?error=Domain+is+not+verified+or+not+available", status_code=302)

    existing = db.scalar(select(Mask).where(Mask.local_part == clean_local, Mask.domain == clean_domain))
    if existing:
        if existing.user_id == user.id:
            return RedirectResponse(url=f"/dashboard?selected_mask={existing.id}&info=Mask+already+exists", status_code=302)
        return RedirectResponse(url="/dashboard?error=Mask+already+exists", status_code=302)

    mask = Mask(user_id=user.id, local_part=clean_local, domain=clean_domain)
    db.add(mask)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(Mask).where(Mask.local_part == clean_local, Mask.domain == clean_domain))
        if existing:
            if existing.user_id == user.id:
                return RedirectResponse(url=f"/dashboard?selected_mask={existing.id}&info=Mask+already+exists", status_code=302)
            return RedirectResponse(url="/dashboard?error=Mask+already+exists", status_code=302)
        return RedirectResponse(url="/dashboard?error=Could+not+create+mask", status_code=302)
    db.refresh(mask)
    return RedirectResponse(url=f"/dashboard?selected_mask={mask.id}&info=Mask+created", status_code=302)


@app.post("/messages/{message_id}/delete")
def delete_message(
    message_id: int,
    selected_mask: Optional[int] = Form(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    message = db.scalar(
        select(Message)
        .join(Mask, Message.mask_id == Mask.id)
        .where(Message.id == message_id, Mask.user_id == user.id)
    )
    if not message:
        return RedirectResponse(url="/dashboard?error=Message+not+found", status_code=302)

    mask_id = message.mask_id
    try:
        raw_file = Path(message.raw_path)
        if raw_file.exists():
            raw_file.unlink()
    except OSError:
        pass

    db.delete(message)
    db.commit()
    keep_mask = selected_mask if selected_mask else mask_id
    return RedirectResponse(url=f"/dashboard?selected_mask={keep_mask}&info=Message+deleted", status_code=302)


@app.post("/messages/{message_id}/mark-read")
def mark_message_read(
    message_id: int,
    selected_mask: Optional[int] = Form(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    message = db.scalar(
        select(Message)
        .join(Mask, Message.mask_id == Mask.id)
        .where(Message.id == message_id, Mask.user_id == user.id)
    )
    if not message:
        return RedirectResponse(url="/dashboard?error=Message+not+found", status_code=302)
    message.is_read = True
    db.commit()
    keep_mask = selected_mask if selected_mask else message.mask_id
    return RedirectResponse(url=f"/dashboard?selected_mask={keep_mask}&selected_message={message.id}&info=Marked+as+read", status_code=302)


@app.post("/messages/{message_id}/mark-unread")
def mark_message_unread(
    message_id: int,
    selected_mask: Optional[int] = Form(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    message = db.scalar(
        select(Message)
        .join(Mask, Message.mask_id == Mask.id)
        .where(Message.id == message_id, Mask.user_id == user.id)
    )
    if not message:
        return RedirectResponse(url="/dashboard?error=Message+not+found", status_code=302)
    if not message.is_outbound:
        message.is_read = False
        db.commit()
    keep_mask = selected_mask if selected_mask else message.mask_id
    return RedirectResponse(url=f"/dashboard?selected_mask={keep_mask}&selected_message={message.id}&info=Marked+as+unread", status_code=302)


@app.post("/messages/{message_id}/reply")
def reply_message(
    message_id: int,
    reply_body: str = Form(...),
    reply_all: str = Form("false"),
    selected_mask: Optional[int] = Form(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    message = db.scalar(
        select(Message)
        .join(Mask, Message.mask_id == Mask.id)
        .where(Message.id == message_id, Mask.user_id == user.id)
    )
    if not message:
        return RedirectResponse(url="/dashboard?error=Message+not+found", status_code=302)
    if message.is_outbound:
        return RedirectResponse(url="/dashboard?error=Cannot+reply+to+an+outbound+message+entry", status_code=302)

    mask = db.get(Mask, message.mask_id)
    if not mask:
        return RedirectResponse(url="/dashboard?error=Mask+not+found", status_code=302)
    if not _can_send_from_domain(mask.domain):
        return RedirectResponse(url=f"/dashboard?selected_mask={mask.id}&error=Reply+not+enabled+for+{mask.domain}", status_code=302)

    cleaned_reply = reply_body.strip()
    if not cleaned_reply:
        return RedirectResponse(url=f"/dashboard?selected_mask={mask.id}&error=Reply+message+cannot+be+empty", status_code=302)

    target_email, in_reply_to, references, original_subject, to_cc_addresses = _reply_metadata(message)
    if not target_email:
        return RedirectResponse(url=f"/dashboard?selected_mask={mask.id}&error=Could+not+resolve+reply+recipient", status_code=302)
    should_reply_all = reply_all.strip().lower() in {"1", "true", "yes", "on"}
    target_emails = _compute_reply_targets(mask, target_email, to_cc_addresses, should_reply_all)
    if not target_emails:
        return RedirectResponse(url=f"/dashboard?selected_mask={mask.id}&error=No+valid+reply+recipient+found", status_code=302)

    try:
        sent_msg, sender, sent_subject = _send_reply_email(mask, target_emails, cleaned_reply, in_reply_to, references, original_subject)
    except Exception as exc:
        logger.exception(
            "Failed outbound reply send. mask_id=%s mask_domain=%s recipient=%s",
            mask.id,
            mask.domain,
            ",".join(target_emails),
        )
        error_text = str(exc).lower()
        if "authentication" in error_text or "auth" in error_text:
            msg = "SMTP+authentication+failed.+Check+SES+SMTP+username/password"
        elif "sandbox" in error_text:
            msg = "SES+sandbox+restriction.+Verify+recipient+or+request+production+access"
        elif "domain" in error_text or "identity" in error_text:
            msg = "SES+identity+not+verified+for+this+sender+domain+in+this+region"
        else:
            msg = "Failed+to+send+reply+via+outbound+SMTP"
        return RedirectResponse(url=f"/dashboard?selected_mask={mask.id}&error={msg}", status_code=302)

    # Persist outbound reply in the same mask timeline for auditability and continuity.
    MESSAGE_DIR.mkdir(parents=True, exist_ok=True)
    outbound_raw_path = MESSAGE_DIR / f"{uuid.uuid4().hex}.eml"
    outbound_raw_path.write_bytes(sent_msg.as_bytes())
    db.add(
        Message(
            mask_id=mask.id,
            from_addr=sender[:500],
            to_addr=", ".join(target_emails)[:500],
            subject=sent_subject[:500],
            text_preview=cleaned_reply[:2000],
            is_outbound=True,
            is_read=True,
            raw_path=outbound_raw_path.as_posix(),
        )
    )
    db.commit()

    keep_mask = selected_mask if selected_mask else mask.id
    return RedirectResponse(url=f"/dashboard?selected_mask={keep_mask}&info=Reply+sent", status_code=302)


@app.post("/masks/{mask_id}/delete")
def delete_mask(
    mask_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    mask = db.scalar(select(Mask).where(Mask.id == mask_id, Mask.user_id == user.id))
    if not mask:
        return RedirectResponse(url="/dashboard?error=Mask+not+found", status_code=302)

    messages = db.scalars(select(Message).where(Message.mask_id == mask.id)).all()
    for message in messages:
        try:
            raw_file = Path(message.raw_path)
            if raw_file.exists():
                raw_file.unlink()
        except OSError:
            pass
        db.delete(message)

    db.delete(mask)
    db.commit()
    return RedirectResponse(url="/dashboard?info=Mask+deleted", status_code=302)


@app.post("/domains")
def add_domain(
    domain_name: str = Form(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    clean_domain = _normalize_domain(domain_name)
    if not _is_valid_domain(clean_domain):
        return RedirectResponse(url="/dashboard?error=Invalid+domain+format", status_code=302)

    existing = db.scalar(select(Domain).where(Domain.name == clean_domain))
    if existing:
        if existing.user_id == user.id or existing.is_default:
            return RedirectResponse(url="/dashboard?info=Domain+already+added", status_code=302)
        return RedirectResponse(url="/dashboard?error=Domain+is+already+claimed+by+another+user", status_code=302)

    domain = Domain(
        user_id=user.id,
        name=clean_domain,
        verification_token=_generate_domain_token(),
        is_default=False,
        is_verified=False,
    )
    db.add(domain)
    db.commit()
    return RedirectResponse(url="/dashboard?info=Domain+added.+Publish+TXT+record+then+verify", status_code=302)


@app.post("/domains/{domain_id}/delete")
def delete_domain(
    domain_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    domain = db.scalar(select(Domain).where(Domain.id == domain_id, Domain.user_id == user.id))
    if not domain:
        return RedirectResponse(url="/dashboard?error=Domain+not+found", status_code=302)
    if domain.is_default:
        return RedirectResponse(url="/dashboard?error=Default+domain+cannot+be+deleted", status_code=302)

    mask_exists = db.scalar(select(Mask).where(Mask.domain == domain.name))
    if mask_exists:
        return RedirectResponse(url="/dashboard?error=Delete+masks+on+this+domain+first", status_code=302)

    db.delete(domain)
    db.commit()
    return RedirectResponse(url="/dashboard?info=Domain+deleted", status_code=302)


@app.post("/domains/{domain_id}/verify")
def verify_domain(
    domain_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    domain = db.scalar(select(Domain).where(Domain.id == domain_id, Domain.user_id == user.id))
    if not domain:
        return RedirectResponse(url="/dashboard?error=Domain+not+found", status_code=302)
    if domain.is_verified:
        return RedirectResponse(url="/dashboard?info=Domain+already+verified", status_code=302)
    if not DNS_AVAILABLE:
        return RedirectResponse(url="/dashboard?error=DNS+verification+requires+dnspython", status_code=302)

    verify_host = f"_relay-verify.{domain.name}"
    try:
        txt_answers = dns.resolver.resolve(verify_host, "TXT")
        txt_values = _extract_txt_values(txt_answers)
    except DNSException:
        return RedirectResponse(url="/dashboard?error=TXT+record+not+found+yet", status_code=302)

    if domain.verification_token not in txt_values:
        return RedirectResponse(url="/dashboard?error=TXT+token+mismatch", status_code=302)

    try:
        mx_answers = dns.resolver.resolve(domain.name, "MX")
        mx_hosts = _extract_mx_hosts(mx_answers)
    except DNSException:
        return RedirectResponse(url="/dashboard?error=MX+record+not+found+yet", status_code=302)

    if MX_TARGET_HOST and MX_TARGET_HOST not in mx_hosts:
        return RedirectResponse(
            url=f"/dashboard?error=MX+must+include+{MX_TARGET_HOST}",
            status_code=302,
        )

    domain.is_verified = True
    domain.verified_at = datetime.utcnow()
    db.commit()
    if MX_TARGET_HOST:
        info_msg = "Domain+verified+(TXT+and+MX).+You+can+now+create+masks"
    else:
        info_msg = "Domain+verified+(TXT+and+MX+exists).+You+can+now+create+masks"
    return RedirectResponse(url=f"/dashboard?info={info_msg}", status_code=302)
