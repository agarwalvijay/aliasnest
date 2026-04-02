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

- This is MVP scope only (steps 1-3), with optional outbound reply support via SMTP relay.
- Replace `SECRET_KEY` before production use.
- Outbound reply via SMTP relay (SES or similar):
  - `OUTBOUND_SMTP_HOST`, `OUTBOUND_SMTP_PORT`, `OUTBOUND_SMTP_USER`, `OUTBOUND_SMTP_PASS`
  - `OUTBOUND_SMTP_STARTTLS=true` for SES on port 587
  - `OUTBOUND_ALLOWED_DOMAINS` controls which mask domains can send replies (comma-separated, `*` for all)
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

## Mobile App (Expo)

A mobile client scaffold is included at `mobile/`.

### Start mobile dev server

```bash
cd mobile
npm install
npm run start
```

### Configure API base URL

Set `EXPO_PUBLIC_API_BASE_URL` before start:

```bash
EXPO_PUBLIC_API_BASE_URL=http://<server-ip>:8080 npm run start
```

- iOS simulator can use `http://127.0.0.1:8080` if API runs on same Mac.
- Android emulator typically needs `http://10.0.2.2:8080`.
- Physical device must use LAN/public IP reachable from the phone.

### Mobile features currently wired to API

- Login/logout with bearer token auth (`/api/auth/*`)
- List/create/delete masks
- List/open/read/unread/delete/reply messages
- List/add/verify/delete custom domains
- Update timezone

## Modern Web App (React + Vite)

A new API-driven web frontend is included at `web/`.

### Run web dev

```bash
cd web
npm install
VITE_API_BASE_URL=http://<server-ip>:8080 npm run dev -- --host
```

Build for production:

```bash
cd web
npm run build
```

This produces `web/dist/` for Nginx static hosting.

## Deploy On Ubuntu Server (No Docker)

Assumes clone path: `/home/vagarwal/aliasnest`

### 1) Setup Python app

```bash
cd /home/vagarwal/aliasnest
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 2) Configure environment

Create/update `.env`:

```env
SECRET_KEY=<long-random-secret>
DATABASE_URL=sqlite:////home/vagarwal/aliasnest/app/data/app.db
DEFAULT_DOMAIN=aliasnest.com
SMTP_HOST=0.0.0.0
SMTP_PORT=2525
PUBLIC_SMTP_PORT=25
MX_TARGET_HOST=mx.aliasnest.com
SIGNUP_OPEN=false
```

### 3) Install systemd services

```bash
sudo cp deploy/aliasnest.service /etc/systemd/system/
sudo cp deploy/aliasnest-port25-redirect.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aliasnest.service
sudo systemctl enable --now aliasnest-port25-redirect.service
sudo systemctl status aliasnest.service
```

### 4) Nginx (API + web app)

Example Nginx site:

```nginx
server {
  listen 80;
  server_name aliasnest.com;

  root /home/vagarwal/aliasnest/web/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Build Android APK For Sideload

`mobile/eas.json` is included with an APK profile.

### 1) Install tooling and login

```bash
cd mobile
npm install
npm install -g eas-cli
eas login
```

### 2) Configure mobile API URL for production

Set public API URL in app config for runtime env (recommended via EAS env var):

```bash
eas env:create --name EXPO_PUBLIC_API_BASE_URL --value https://aliasnest.com --scope project
```

### 3) Build APK

```bash
cd mobile
eas build -p android --profile preview
```

When build completes, download the `.apk` and sideload on Android.
