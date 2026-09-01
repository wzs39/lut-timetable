#!/usr/bin/env bash
# Build the Android debug APK inside the Docker sandbox.
# Host needs: Node (for cap sync) + Docker. No Android SDK / JDK required.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [host] Building web assets + syncing Capacitor (Node only)"
npm run build
npx cap sync android

echo "==> [docker] Building sandbox image (first run downloads the SDK)"
docker build -t lut-android-builder -f docker/android.Dockerfile docker

echo "==> [docker] Running Gradle assembleDebug inside the container"
docker run --rm -v "$(pwd):/app" -w /app/android lut-android-builder \
  bash -c "chmod +x gradlew && ./gradlew assembleDebug --no-daemon"

APK="android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "==> Done! APK: $(pwd)/$APK"
