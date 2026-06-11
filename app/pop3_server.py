"""Read-only POP3(S) gateway.

Lets standard mail clients (Gmail "Check mail from other accounts", Outlook,
Apple Mail) pull a user's inbound mask mail. Every received message already has
its full raw RFC822 stored on disk (see smtp_receiver._persist_message), so
RETR just streams that file — attachments ride along for free, no MIME rebuild.

Phase 1 is intentionally read-only: DELE is accepted but never destroys mail.
Clients dedupe via UIDL (we use the stable Message.id), so "leave a copy on
server" yields correct incremental fetches without us tracking fetch state.

Auth (USER/PASS): username is the account email; password is either the account
password or any non-revoked API token (recommended as an app-specific password,
since the client stores it to poll us).
"""

import asyncio
import hashlib
import logging
import ssl
import threading
from datetime import datetime

from sqlalchemy import select

from .auth import verify_password
from .config import POP3_MAX_MESSAGES
from .database import SessionLocal
from .models import ApiToken, Mask, Message, User

logger = logging.getLogger(__name__)

_MAX_LINE = 512  # RFC 1939 limits command lines to 512 octets.


def _authenticate(username: str, password: str):
    """Return the matching User id+email, or None. Runs blocking DB work."""
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == username.strip().lower()))
        if not user:
            return None
        ok = verify_password(password, user.password_hash)
        if not ok:
            token_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
            token = db.scalar(
                select(ApiToken).where(
                    ApiToken.token_hash == token_hash,
                    ApiToken.user_id == user.id,
                    ApiToken.is_revoked.is_(False),
                )
            )
            if token:
                token.last_used_at = datetime.utcnow()
                db.commit()
                ok = True
        if not ok:
            return None
        return user.id, user.email
    finally:
        db.close()


def _load_inbox(user_id: int):
    """Snapshot the user's inbound messages as (message_id, raw_path) tuples,
    newest last so POP3 ordinals stay stable within the session."""
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Message.id, Message.raw_path)
            .join(Mask, Message.mask_id == Mask.id)
            .where(Mask.user_id == user_id, Message.is_outbound.is_(False))
            .order_by(Message.received_at.asc())
            .limit(max(1, POP3_MAX_MESSAGES))
        ).all()
        return [(int(mid), raw_path) for mid, raw_path in rows]
    finally:
        db.close()


def _read_raw(raw_path: str) -> bytes:
    with open(raw_path, "rb") as fh:
        return fh.read()


def _to_crlf(raw: bytes) -> bytes:
    return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n").replace(b"\n", b"\r\n")


def _dot_stuff(body: bytes) -> bytes:
    """CRLF-normalize and byte-stuff leading dots per RFC 1939 §3."""
    crlf = _to_crlf(body)
    lines = crlf.split(b"\r\n")
    return b"\r\n".join((b"." + ln) if ln.startswith(b".") else ln for ln in lines)


class _Session:
    def __init__(self, runtime, reader, writer):
        self._runtime = runtime
        self._reader = reader
        self._writer = writer
        self._loop = asyncio.get_event_loop()
        self.user_id = None
        self.user_email = None
        self._pending_user = None
        self.messages = []   # list of (message_id, raw_path)
        self.deleted = set()  # ordinals marked DELE (honored as no-op; never destroyed)

    async def _send_line(self, text: str):
        self._writer.write((text + "\r\n").encode("utf-8", errors="replace"))
        await self._writer.drain()

    async def _send_bytes(self, data: bytes):
        self._writer.write(data)
        await self._writer.drain()

    async def _ok(self, msg=""):
        await self._send_line(f"+OK {msg}".rstrip())

    async def _err(self, msg=""):
        await self._send_line(f"-ERR {msg}".rstrip())

    def _resolve(self, arg: str):
        """Map a 1-based POP3 ordinal to a live (not-deleted) message entry."""
        try:
            idx = int(arg)
        except (TypeError, ValueError):
            return None, None
        if idx < 1 or idx > len(self.messages) or idx in self.deleted:
            return None, None
        return idx, self.messages[idx - 1]

    async def run(self):
        await self._ok("AliasNest POP3 ready")
        while True:
            try:
                raw = await self._reader.readline()
            except (ConnectionError, asyncio.IncompleteReadError):
                return
            if not raw:
                return
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            parts = line.split(" ", 1)
            cmd = parts[0].upper()
            arg = parts[1].strip() if len(parts) > 1 else ""

            if cmd == "QUIT":
                await self._ok("bye")
                return
            if cmd == "CAPA":
                await self._handle_capa()
                continue
            if self.user_id is None:
                await self._handle_auth(cmd, arg)
                continue
            await self._handle_txn(cmd, arg)

    async def _handle_capa(self):
        await self._ok("capability list follows")
        for cap in ("USER", "UIDL", "TOP", "."):
            await self._send_line(cap)

    async def _handle_auth(self, cmd: str, arg: str):
        if cmd == "USER":
            self._pending_user = arg
            await self._ok("send PASS")
        elif cmd == "PASS":
            if not self._pending_user:
                await self._err("USER first")
                return
            result = await self._loop.run_in_executor(
                None, _authenticate, self._pending_user, arg
            )
            if not result:
                await self._err("authentication failed")
                self._pending_user = None
                return
            self.user_id, self.user_email = result
            self.messages = await self._loop.run_in_executor(None, _load_inbox, self.user_id)
            await self._ok(f"mailbox ready, {len(self.messages)} messages")
            logger.info("POP3 login ok: %s (%d msgs)", self.user_email, len(self.messages))
        elif cmd == "NOOP":
            await self._ok()
        else:
            await self._err("authenticate first")

    def _live(self):
        return [(i + 1, mid, path) for i, (mid, path) in enumerate(self.messages)
                if (i + 1) not in self.deleted]

    async def _handle_txn(self, cmd: str, arg: str):
        if cmd == "STAT":
            total = 0
            for _, _, path in self._live():
                total += await self._size(path)
            await self._ok(f"{len(self._live())} {total}")
        elif cmd == "LIST":
            await self._handle_list_uidl(arg, uidl=False)
        elif cmd == "UIDL":
            await self._handle_list_uidl(arg, uidl=True)
        elif cmd == "RETR":
            await self._handle_retr(arg)
        elif cmd == "TOP":
            await self._handle_top(arg)
        elif cmd == "DELE":
            # Read-only: acknowledge but never destroy. Clients dedupe via UIDL.
            idx, _ = self._resolve(arg)
            if idx is None:
                await self._err("no such message")
            else:
                self.deleted.add(idx)
                await self._ok(f"message {idx} marked (kept on server)")
        elif cmd == "RSET":
            self.deleted.clear()
            await self._ok("reset")
        elif cmd == "NOOP":
            await self._ok()
        else:
            await self._err("unknown command")

    async def _size(self, path: str) -> int:
        try:
            import os
            return await self._loop.run_in_executor(None, lambda: os.path.getsize(path))
        except OSError:
            return 0

    async def _handle_list_uidl(self, arg: str, uidl: bool):
        def fmt(ordinal, mid, path):
            return f"{ordinal} {mid}" if uidl else None

        if arg:
            idx, entry = self._resolve(arg)
            if idx is None:
                await self._err("no such message")
                return
            mid, path = entry
            if uidl:
                await self._ok(f"{idx} {mid}")
            else:
                await self._ok(f"{idx} {await self._size(path)}")
            return
        await self._ok("listing follows")
        for ordinal, mid, path in self._live():
            if uidl:
                await self._send_line(f"{ordinal} {mid}")
            else:
                await self._send_line(f"{ordinal} {await self._size(path)}")
        await self._send_line(".")

    async def _handle_retr(self, arg: str):
        idx, entry = self._resolve(arg)
        if idx is None:
            await self._err("no such message")
            return
        _, path = entry
        try:
            raw = await self._loop.run_in_executor(None, _read_raw, path)
        except OSError:
            await self._err("message file missing")
            return
        await self._ok(f"{len(raw)} octets")
        await self._send_bytes(_dot_stuff(raw))
        await self._send_line("")
        await self._send_line(".")

    async def _handle_top(self, arg: str):
        bits = arg.split()
        if len(bits) != 2:
            await self._err("usage: TOP msg n")
            return
        idx, entry = self._resolve(bits[0])
        if idx is None:
            await self._err("no such message")
            return
        try:
            n = int(bits[1])
        except ValueError:
            await self._err("bad line count")
            return
        _, path = entry
        try:
            raw = await self._loop.run_in_executor(None, _read_raw, path)
        except OSError:
            await self._err("message file missing")
            return
        crlf = _to_crlf(raw)
        header, sep, body = crlf.partition(b"\r\n\r\n")
        body_lines = body.split(b"\r\n")[:max(0, n)] if sep else []
        chunk = header + (b"\r\n\r\n" if sep else b"")
        if body_lines:
            chunk += b"\r\n".join(body_lines)
        await self._ok("top follows")
        await self._send_bytes(_dot_stuff(chunk))
        await self._send_line("")
        await self._send_line(".")


class POP3ServerRuntime:
    def __init__(self, host: str, port: int, ssl_context=None):
        self.host = host
        self.port = port
        self.ssl_context = ssl_context
        self._loop = None
        self._server = None
        self._thread = None

    @staticmethod
    def build_ssl_context(cert_path: str, key_path: str):
        if not cert_path or not key_path:
            return None
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
        return ctx

    async def _handle_client(self, reader, writer):
        peer = writer.get_extra_info("peername")
        try:
            await _Session(self, reader, writer).run()
        except Exception:
            logger.exception("POP3 session error from %s", peer)
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="pop3-server", daemon=True)
        self._thread.start()

    def _run(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        try:
            self._server = loop.run_until_complete(
                asyncio.start_server(
                    self._handle_client, host=self.host, port=self.port, ssl=self.ssl_context
                )
            )
        except Exception:
            logger.exception("POP3 server failed to bind %s:%s", self.host, self.port)
            return
        scheme = "POP3S" if self.ssl_context else "POP3 (plaintext)"
        logger.info("%s listening on %s:%s", scheme, self.host, self.port)
        try:
            loop.run_forever()
        finally:
            loop.close()

    def stop(self):
        if self._loop and self._server:
            self._loop.call_soon_threadsafe(self._server.close)
            self._loop.call_soon_threadsafe(self._loop.stop)
