#!/usr/bin/env node
/* A stand-in for the `claude` CLI, used by the gateway tests.
 *
 * It speaks just enough of `--output-format stream-json --verbose`: reads the
 * prompt on stdin, writes a few NDJSON events, and exits. The prompt selects the
 * behaviour so a test can drive the gateway's happy path and its failure paths:
 *
 *   HANG   never write anything (exercises the idle/duration watchdogs)
 *   FAIL   write to stderr and exit non-zero
 *   NOJSON write a line of garbage before the real events
 *
 * Every invocation appends its argv + cwd to $MOCK_CLAUDE_LOG (if set) so tests
 * can assert on the flags the gateway built. */

"use strict";

const fs = require("fs");

const argv = process.argv.slice(2);
if (process.env.MOCK_CLAUDE_LOG) {
  fs.appendFileSync(
    process.env.MOCK_CLAUDE_LOG,
    JSON.stringify({ argv, cwd: process.cwd(), env: { key: process.env.ANTHROPIC_API_KEY || "" } }) + "\n"
  );
}

let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => run(prompt.trim()));

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function run(prompt) {
  if (prompt.includes("HANG")) {
    // Stay alive with no output so the gateway's watchdog is what ends this.
    setInterval(() => {}, 1000);
    return;
  }

  if (prompt.includes("FAIL")) {
    process.stderr.write("mock claude: something went wrong\n");
    process.exit(3);
  }

  // STALE reproduces a session id the CLI no longer knows about: it fails only
  // while --resume is passed, and succeeds once the gateway retries without it.
  if (prompt.includes("STALE") && argv.includes("--resume")) {
    process.stderr.write("No conversation found with session ID\n");
    process.exit(1);
  }

  if (prompt.includes("NOJSON")) process.stdout.write("not json at all\n");

  const resumeIdx = argv.indexOf("--resume");
  const sessionId = resumeIdx !== -1 ? argv[resumeIdx + 1] : "sess-" + process.pid;

  emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "considering…" },
    },
  });
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } }] },
  });
  emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "echo: " + prompt.slice(0, 40) },
    },
  });
  emit({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    total_cost_usd: 0.001,
    result: "echo: " + prompt.slice(0, 40),
  });
  process.exit(0);
}
