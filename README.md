# Home Email Relay MVP (Steps 1-3 + Domain Verification)

This implements the first 3 milestones:

1. Default domain + user-created masks
2. SMTP inbound receive + message storage
3. Per-user dashboard to view messages per mask

## What is included

- `FastAPI` web app with register/login/logout
- Default shared domain support for all users
- Custom domain add + DNS TXT + MX verification
- Mask creation on default domain or verified custom domains
- Embedded SMTP server (`aiosmtpd`) on port `2525`
- Message metadata and body preview stored in SQLite
- Raw `.eml` stored on disk at `app/data/messages`
- Dashboard showing only the signed-in user's masks and per-mask inbox

## Run with Docker Compose

```bash
docker compose up --build
```

Then open:

- Web UI: `http://localhost:8080`
- SMTP ingress: `localhost:2525`

## Quick test flow

1. Register a user at `/register`
2. (Optional) Add custom domain and verify ownership:
   - Host: `_relay-verify.yourdomain.com`
   - Value: token shown in dashboard
3. Create a mask, for example `shopping1@relay.local`
4. Send test email to SMTP listener:

```bash
python3 -m smtplib - <<'PY'
import smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['From'] = 'sender@example.com'
msg['To'] = 'shopping1@relay.local'
msg['Subject'] = 'Test message'
msg.set_content('hello from smtp test')

with smtplib.SMTP('localhost', 2525) as s:
    s.send_message(msg)
PY
```

5. Refresh dashboard and view message in mask inbox.

## Notes

- This is MVP scope only (steps 1-3). No forwarding pipelines or outbound send/reply yet.
- Replace `SECRET_KEY` before production use.
- Registration is restricted by default (`SIGNUP_OPEN=false`).
  - Set `SIGNUP_OPEN=true` to allow public signup.
  - Set `SIGNUP_INVITE_CODE=<code>` to require an invite.
  - Set `ALLOWED_SIGNUP_EMAILS=user1@example.com,user2@example.com` for allowlist signup.
- For internet delivery, configure DNS and route MX to your home public IP/NAT.
- Custom-domain verification checks:
  - TXT at `_relay-verify.<domain>` with dashboard token
  - MX at `<domain>` exists
  - If `MX_TARGET_HOST` is set, MX must include that host
- Recommended: set `MX_TARGET_HOST` to your public mail host (example `mail.yourdomain.com`) and ensure:
  - `A/AAAA` for that host points to your public IP
  - Router forwards TCP `PUBLIC_SMTP_PORT` (typically `25`) to your server SMTP port
