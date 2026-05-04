import asyncio
import logging
import threading
import uuid
from email import message_from_bytes
from email.policy import default

from aiosmtpd.controller import Controller
from sqlalchemy import select

from .config import FIREBASE_SERVICE_ACCOUNT_PATH, MESSAGE_DIR
from .database import SessionLocal
from .models import Mask, Message, PushToken

logger = logging.getLogger(__name__)

_firebase_initialized = False

def _init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return True
    if not FIREBASE_SERVICE_ACCOUNT_PATH:
        logger.warning("Firebase not configured: FIREBASE_SERVICE_ACCOUNT_PATH is not set")
        return False
    try:
        import firebase_admin
        from firebase_admin import credentials
        cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
        _firebase_initialized = True
        logger.info("Firebase initialized OK")
        return True
    except Exception as exc:
        logger.warning("Firebase init failed: %s", exc)
        return False

MESSAGE_DIR.mkdir(parents=True, exist_ok=True)


def _extract_preview(raw_bytes: bytes) -> str:
    try:
        parsed = message_from_bytes(raw_bytes, policy=default)
        for part in parsed.walk():
            content_type = part.get_content_type()
            if content_type == "text/plain":
                payload = part.get_content()
                return (payload or "").strip()[:2000]
        if parsed.get_content_type() == "text/plain":
            payload = parsed.get_content()
            return (payload or "").strip()[:2000]
    except Exception:
        return ""
    return ""


class MaskSMTPHandler:
    async def handle_DATA(self, server, session, envelope):  # noqa: N802
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._persist_message, envelope)
        return "250 Message accepted for delivery"

    def _persist_message(self, envelope):
        db = SessionLocal()
        try:
            for recipient in envelope.rcpt_tos:
                local_part, _, domain = recipient.partition("@")
                mask = db.scalar(select(Mask).where(Mask.local_part == local_part, Mask.domain == domain, Mask.is_active.is_(True)))
                if not mask:
                    continue

                msg_id = uuid.uuid4().hex
                raw_path = MESSAGE_DIR / f"{msg_id}.eml"
                raw_path.write_bytes(envelope.content)

                parsed = message_from_bytes(envelope.content, policy=default)
                subject = (parsed.get("Subject") or "(No Subject)")[:500]
                header_from = (parsed.get("From") or "").strip()
                from_value = header_from or (envelope.mail_from or "")

                message = Message(
                    mask_id=mask.id,
                    from_addr=from_value[:500],
                    to_addr=recipient[:500],
                    subject=subject,
                    text_preview=_extract_preview(envelope.content),
                    is_outbound=False,
                    raw_path=raw_path.as_posix(),
                )
                db.add(message)
                db.flush()

                push_tokens = db.scalars(select(PushToken).where(PushToken.user_id == mask.user_id)).all()
                if push_tokens:
                    from sqlalchemy import func as sqlfunc
                    unread = db.scalar(
                        sqlfunc.count(Message.id).select().where(
                            Message.mask_id.in_(
                                select(Mask.id).where(Mask.user_id == mask.user_id)
                            ),
                            Message.is_read.is_(False),
                            Message.is_outbound.is_(False),
                        )
                    ) or 1
                    _send_push_notifications(
                        tokens=[pt.token for pt in push_tokens],
                        title=f"New mail to {local_part}@{domain}",
                        body=subject,
                        badge=unread,
                    )
            db.commit()
        finally:
            db.close()


def _send_push_notifications(tokens: list, title: str, body: str, badge: int = 1):
    logger.info("Push: sending to %d token(s)", len(tokens))
    if not tokens or not _init_firebase():
        return
    try:
        from firebase_admin import messaging, exceptions
        stale_tokens = []
        for token in tokens:
            try:
                message = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    android=messaging.AndroidConfig(priority="high"),
                    apns=messaging.APNSConfig(
                        payload=messaging.APNSPayload(aps=messaging.Aps(badge=badge))
                    ),
                    token=token,
                )
                result = messaging.send(message)
                logger.info("FCM sent OK: %s", result)
            except exceptions.NotFoundError:
                logger.info("FCM token stale, removing: %s…", token[:12])
                stale_tokens.append(token)
            except Exception as exc:
                logger.warning("FCM send failed for token %s…: %s", token[:12], exc)
        if stale_tokens:
            _remove_stale_tokens(stale_tokens)
    except Exception as exc:
        logger.warning("Push notification error: %s", exc)


def _remove_stale_tokens(tokens: list):
    db = SessionLocal()
    try:
        for token in tokens:
            row = db.scalar(select(PushToken).where(PushToken.token == token))
            if row:
                db.delete(row)
        db.commit()
    except Exception as exc:
        logger.warning("Failed to remove stale tokens: %s", exc)
    finally:
        db.close()


class SMTPServerRuntime:
    def __init__(self, hostname: str, port: int):
        self.hostname = hostname
        self.port = port
        self.controller = Controller(MaskSMTPHandler(), hostname=hostname, port=port)
        self._thread = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return

        def _run():
            self.controller.start()

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()

    def stop(self):
        try:
            self.controller.stop()
        except Exception:
            pass
