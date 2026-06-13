#!/usr/bin/env bash
# Visual self-verification helper for the mobile UI rebuild.
#
# Captures a screenshot from the running Android emulator (or a plugged-in
# device with USB debugging on) so a build agent can compare the live RN screen
# against the UI contract mockups in docs/mockups/mobile-contract/ and self-correct,
# with no phone photo / airdrop loop.
#
# Usage:
#   scripts/device-shot.sh [outfile.png] [serial]
# Examples:
#   scripts/device-shot.sh                       # -> /tmp/ros-shot-<ts>.png on the only device
#   scripts/device-shot.sh /tmp/home.png         # explicit out path
#   scripts/device-shot.sh /tmp/home.png emulator-5554
#
# Companion helpers (run adb directly):
#   adb shell am start -a android.intent.action.VIEW -d "<deeplink>"   # navigate
#   adb shell input tap <x> <y>                                        # tap
#   adb devices -l                                                     # list targets
set -euo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
[ -x "$ADB" ] || ADB="$(command -v adb || true)"
if [ -z "${ADB:-}" ] || [ ! -x "$ADB" ]; then
  echo "adb not found. Set ADB=/path/to/adb or add platform-tools to PATH." >&2
  exit 1
fi

OUT="${1:-/tmp/ros-shot-$(date +%Y%m%d-%H%M%S).png}"
SERIAL="${2:-}"
TARGET=()
[ -n "$SERIAL" ] && TARGET=(-s "$SERIAL")

"$ADB" "${TARGET[@]}" exec-out screencap -p > "$OUT"
SIZE=$(wc -c < "$OUT" | tr -d ' ')
if [ "$SIZE" -lt 1000 ]; then
  echo "screencap produced only ${SIZE} bytes, no device on screen?" >&2
  exit 1
fi
echo "$OUT"
