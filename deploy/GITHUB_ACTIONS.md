# CI/CD for AliasNest

## Deploy (`.github/workflows/deploy.yml`)

On push to `main` (or manual run), CI SSHes into the GCP box and runs
`deploy/redeploy.sh main` (git reset → pip install → web build →
`pm2 restart aliasnest-api`).

**Nothing to declare.** `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT` are
organization-level secrets shared by every app on the box (same as the
atsumi/comed deploys), so this repo inherits them automatically.

There is intentionally **no `DEPLOY_PATH`**: `deploy/redeploy.sh` hardcodes
`APP_DIR=/home/vagarwal/aliasnest` and the workflow calls it by absolute path,
so aliasnest can never deploy into another app's directory.

The box pulls the code itself (`git fetch origin` inside `redeploy.sh`), so it
must be able to read `agarwalvijay/aliasnest.git` non-interactively — which
already works if `./deploy/redeploy.sh` runs by hand today.

## Mobile APK — built locally (no EAS)

There is no mobile CI. Build an installable Android APK on your machine:

```bash
cd mobile
./build-apk.sh            # release APK (debug-signed, fine for sideloading)
./build-apk.sh debug      # debug APK
```

Prerequisites: Node, JDK 17, and the Android SDK (`ANDROID_HOME` set). The
script runs `expo prebuild` then Gradle `assembleRelease`, and prints the APK
path plus the `adb install` command.

The API URL is baked in at build time — defaults to `https://app.aliasnest.com`.
Point a test build at a local server with:

```bash
EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:8080 ./build-apk.sh debug
```

When you're ready for the app stores, switch this to an EAS build/submit flow
(`eas.json` already has `preview`/`production` profiles).
