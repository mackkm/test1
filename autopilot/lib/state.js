/* Journal + small key/value persistence for the autopilot. Everything lives
 * under AUTOPILOT_DATA (default: ./data next to autopilot.js) so the VM can be
 * rebuilt without losing posting history — mount or back up that one dir. */

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR =
  process.env.AUTOPILOT_DATA || path.join(__dirname, "..", "data");

function ensure() {
  fs.mkdirSync(path.join(DATA_DIR, "out"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "tmp"), { recursive: true });
  return DATA_DIR;
}

const journalPath = () => path.join(DATA_DIR, "journal.jsonl");

/* Append one run record: {ts, topic, video, posts: {...}, error?} */
function journal(entry) {
  ensure();
  fs.appendFileSync(journalPath(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

function readJournal(limit = 50) {
  try {
    const lines = fs.readFileSync(journalPath(), "utf8").trim().split("\n");
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/* Topics covered recently — fed back to research so campaigns don't repeat. */
function recentTopics(n = 20) {
  return readJournal(n * 2)
    .map((e) => e.topic)
    .filter(Boolean)
    .slice(-n);
}

/* Small persisted key/value store (OAuth token caches, cursors). */
function kvPath() {
  return path.join(DATA_DIR, "kv.json");
}
function kvGet(key) {
  try {
    return JSON.parse(fs.readFileSync(kvPath(), "utf8"))[key];
  } catch {
    return undefined;
  }
}
function kvSet(key, value) {
  ensure();
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(kvPath(), "utf8"));
  } catch {
    /* fresh store */
  }
  all[key] = value;
  fs.writeFileSync(kvPath(), JSON.stringify(all, null, 2));
}

module.exports = { DATA_DIR, ensure, journal, readJournal, recentTopics, kvGet, kvSet };
