#!/usr/bin/env bash
# Record a CLEAN (unbranded, native-resolution) companion marketing clip off a
# running Android emulator/device, by capturing the screen with adb screenrecord
# while Maestro drives the deterministic montage flow (.maestro/07-companion-marketing.yaml).
#
# Why not `maestro record`? That path can overlay command captions / branding.
# adb screenrecord gives a raw device-resolution mp4 that matches the desktop
# clips, ready to trim in post.
#
# Prereqs (see .maestro/README.md): an emulator running with the companion dev
# client installed (`npm run android` from mobile/), `adb` + `maestro` on PATH.
#
# Usage (from mobile/):
#   bash scripts/record-companion-clip.sh [output.mp4]
# Default output: ~/Desktop/FinalRecords/companion-raw.mp4
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # mobile/
cd "$HERE"

OUT="${1:-$HOME/Desktop/FinalRecords/companion-raw.mp4}"
FLOW=".maestro/07-companion-marketing.yaml"
DEVICE_PATH="/sdcard/companion-clip.mp4"

command -v adb >/dev/null     || { echo "adb not on PATH (Android SDK platform-tools)"; exit 1; }
command -v maestro >/dev/null || { echo "maestro not on PATH (curl -Ls https://get.maestro.mobile.dev | bash)"; exit 1; }

if ! adb get-state >/dev/null 2>&1; then
  echo "No emulator/device visible to adb. Start an AVD (Android Studio) and check 'adb devices'."; exit 1
fi

mkdir -p "$(dirname "$OUT")"
adb shell rm -f "$DEVICE_PATH" >/dev/null 2>&1 || true

echo "Starting screen capture on device..."
# High bitrate for a crisp marketing clip. screenrecord caps at 180s (plenty).
adb shell screenrecord --bit-rate 12000000 "$DEVICE_PATH" &
SR_PID=$!
sleep 1.5

echo "Driving the montage flow with Maestro..."
maestro test "$FLOW" || echo "(flow reported a non-zero exit; continuing to save whatever was captured)"
sleep 1

echo "Stopping capture (graceful SIGINT so the mp4 finalizes)..."
adb shell pkill -INT screenrecord >/dev/null 2>&1 || true
# Give the device a moment to flush the moov atom, then detach the local adb proc.
sleep 2.5
kill "$SR_PID" >/dev/null 2>&1 || true
wait "$SR_PID" 2>/dev/null || true

echo "Pulling the clip..."
adb pull "$DEVICE_PATH" "$OUT"
adb shell rm -f "$DEVICE_PATH" >/dev/null 2>&1 || true

echo ""
echo "Saved: $OUT"
echo "Next: trim head/tail like the desktop clips, then upload to Blob as companion.mp4 + companion.poster.jpg."
echo "Poster: ffmpeg -i \"$OUT\" -frames:v 1 -q:v 3 companion.poster.jpg"
