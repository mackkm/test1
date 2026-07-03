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
RUN mkdir -p /workspace

ENV HOST=0.0.0.0 \
    PORT=3333 \
    POCKETCLAW_WORKSPACE=/workspace

EXPOSE 3333
CMD ["node", "server/server.js"]
