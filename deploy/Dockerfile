# PocketClaw gateway container — for Docker, Fly.io, Railway, etc.
#
#   docker build -t pocketclaw -f deploy/Dockerfile .
#   docker run -p 3333:3333 -e POCKETCLAW_TOKEN=pick-a-password pocketclaw
#
# No Anthropic key needed at build/run time: paste your API key in the app's
# settings and the gateway forwards it to Claude Code per request.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY docs ./docs
COPY server ./server

# Run as an unprivileged user: the gateway spawns a shell-capable agent, so it
# must not run as root. Give the app + workspace to that user.
RUN useradd --create-home --uid 10001 pocketclaw \
  && mkdir -p /workspace \
  && chown -R pocketclaw:pocketclaw /app /workspace

ENV HOST=0.0.0.0 \
    PORT=3333 \
    POCKETCLAW_WORKSPACE=/workspace

USER pocketclaw
EXPOSE 3333
CMD ["node", "server/server.js"]
