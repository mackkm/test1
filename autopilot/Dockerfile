# Campaign Shorts Autopilot — self-contained container.
#
# Runs the full loop (research → render → post → Whop submit) 24/7 with one
# command, on any machine with Docker — your own computer, an existing VM, a
# NAS, anywhere. No Hetzner API needed.
#
#   docker build -t autopilot -f autopilot/Dockerfile .
#   docker run -d --name autopilot --restart unless-stopped \
#     -p 3444:3444 -v autopilot-data:/var/lib/autopilot \
#     --env-file autopilot/.env  autopilot
#
# Then check:  curl http://localhost:3444/status
# One-time YouTube auth:  docker exec -it autopilot node autopilot.js auth-youtube
#
# Bakes in Piper (natural neural TTS) so voiceovers aren't robotic — the single
# biggest factor in Content Rewards approvals. Piper is x86_64; build on / run
# on an amd64 host (or pass --platform linux/amd64).
FROM node:22-slim

# ffmpeg + espeak-ng (fallback voice) + fonts for captions; curl/ca-certs for Piper
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg espeak-ng fonts-dejavu-core ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Piper neural TTS (binary + a default voice), both from GitHub releases
RUN set -eux; \
    curl -fsSL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
      | tar xz -C /opt; \
    curl -fsSL https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-lessac-medium.tar.gz \
      | tar xz -C /opt/piper; \
    echo hi | /opt/piper/piper --model /opt/piper/en-us-lessac-medium.onnx --output_file /tmp/t.wav; rm -f /tmp/t.wav

WORKDIR /app/autopilot
COPY autopilot/ /app/autopilot/

# unprivileged runtime user; owns the writable data dir
RUN useradd --system --uid 10001 --home /var/lib/autopilot autopilot \
  && mkdir -p /var/lib/autopilot \
  && chown -R autopilot:autopilot /app /var/lib/autopilot

ENV AUTOPILOT_DATA=/var/lib/autopilot \
    AUTOPILOT_PORT=3444 \
    PIPER_BIN=/opt/piper/piper \
    PIPER_VOICE=/opt/piper/en-us-lessac-medium.onnx
VOLUME /var/lib/autopilot
EXPOSE 3444
USER autopilot
# default: the 24/7 loop + status/media server on :3444
CMD ["node", "autopilot.js"]
