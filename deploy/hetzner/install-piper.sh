#!/usr/bin/env bash
# Install Piper TTS (natural neural voice) for the autopilot — voice quality is
# the single biggest factor in Content Rewards approvals, so the bootstrap runs
# this by default. Idempotent; ~90 MB from GitHub releases (no HuggingFace).
#
#   PIPER_VOICE_NAME=en-us-lessac-medium ./install-piper.sh   # default voice
#
# Other voices: https://github.com/rhasspy/piper/releases/tag/v0.0.2
# (voice-<name>.tar.gz — e.g. en-us-ryan-high, en-gb-alan-low)

set -euo pipefail

DEST=/opt/piper
VOICE="${PIPER_VOICE_NAME:-en-us-lessac-medium}"
BIN_URL=https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
VOICE_URL="https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-${VOICE}.tar.gz"

if [ ! -x "$DEST/piper" ]; then
  echo "==> installing piper binary -> $DEST"
  mkdir -p "$DEST"
  curl -fsSL "$BIN_URL" | tar xz -C "$(dirname "$DEST")"   # tarball root is 'piper/'
fi

if [ ! -f "$DEST/${VOICE}.onnx" ]; then
  echo "==> installing voice ${VOICE}"
  curl -fsSL "$VOICE_URL" | tar xz -C "$DEST"
fi

echo "test" | "$DEST/piper" --model "$DEST/${VOICE}.onnx" --output_file /tmp/piper-selftest.wav >/dev/null 2>&1
rm -f /tmp/piper-selftest.wav
echo "==> piper OK"

# point the autopilot at it (only if the operator hasn't configured TTS already)
if [ -f /etc/autopilot.env ] && ! grep -qE '^PIPER_BIN=' /etc/autopilot.env; then
  {
    echo "PIPER_BIN=$DEST/piper"
    echo "PIPER_VOICE=$DEST/${VOICE}.onnx"
  } >> /etc/autopilot.env
  echo "==> PIPER_BIN/PIPER_VOICE written to /etc/autopilot.env"
fi
