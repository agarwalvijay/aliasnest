import asyncio
import threading
import uuid
from email import message_from_bytes
from email.policy import default

from aiosmtpd.controller import Controller
from sqlalchemy import select

from .config import MESSAGE_DIR
from .database import SessionLocal
from .models import Mask, Message

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

                message = Message(
                    mask_id=mask.id,
                    from_addr=(envelope.mail_from or "")[:500],
                    to_addr=recipient[:500],
                    subject=subject,
                    text_preview=_extract_preview(envelope.content),
                    raw_path=raw_path.as_posix(),
                )
                db.add(message)
            db.commit()
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
