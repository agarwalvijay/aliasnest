#!/usr/bin/env bash
# Build an Android APK locally — no EAS / cloud needed.
#
#   ./build-apk.sh            # release APK (debug-signed; fine for sideloading)
#   ./build-apk.sh debug      # debug APK
#
# Prerequisites on this machine:
#   - Node + npm
#   - JDK 17  (java -version)
#   - Android SDK, with ANDROID_HOME / ANDROID_SDK_ROOT set and platform-tools
#     on PATH (Android Studio installs these).
#
# The API the app talks to is baked in at build time. Override per-build with:
#   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:8080 ./build-apk.sh debug
set -euo pipefail

cd "$(dirname "$0")"

VARIANT="${1:-release}"
export EXPO_PUBLIC_API_BASE_URL="${EXPO_PUBLIC_API_BASE_URL:-https://app.aliasnest.com}"

echo "==> JS dependencies"
npm install

# Regenerate the native android/ project from app.json (icons, package id,
# google-services.json, plugins). --clean keeps it reproducible.
echo "==> expo prebuild (API base = $EXPO_PUBLIC_API_BASE_URL)"
npx expo prebuild --platform android --clean

echo "==> gradle assemble (${VARIANT})"
cd android
if [ "$VARIANT" = "debug" ]; then
  ./gradlew assembleDebug
  OUT="app/build/outputs/apk/debug/app-debug.apk"
else
  ./gradlew assembleRelease
  OUT="app/build/outputs/apk/release/app-release.apk"
fi

echo ""
echo "==> APK built: $(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
echo "    Install on a connected device with:  adb install -r \"$OUT\""
