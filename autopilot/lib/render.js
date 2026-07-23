/* Shorts renderer: script lines -> voiceover (TTS) -> line-timed ASS captions
 * -> 1080x1920 H.264 MP4, using only ffmpeg + a TTS engine.
 *
 * TTS engines, in order of preference:
 *   - Piper (natural neural voices): set PIPER_BIN and PIPER_VOICE (.onnx)
 *   - espeak-ng (robotic but dependable, apt-installable): default
 *
 * Backgrounds: drop .mp4/.mov/.jpg/.png files into assets/backgrounds/ to use
 * your own footage (scaled + center-cropped to 9:16). With no assets the
 * renderer synthesizes an animated gradient so the pipeline always produces a
 * video. Optional music bed: assets/music/*, mixed at MUSIC_VOLUME (0.12). */

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensure } = require("./state");

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
const PIPER_BIN = process.env.PIPER_BIN || "";
const PIPER_VOICE = process.env.PIPER_VOICE || "";
const ESPEAK_VOICE = process.env.ESPEAK_VOICE || "en-us+m3";
const ESPEAK_WPM = Number(process.env.ESPEAK_WPM || 165);
const MUSIC_VOLUME = Number(process.env.MUSIC_VOLUME || 0.12);
const FONT = process.env.CAPTION_FONT || "DejaVu Sans";
const ASSETS = process.env.AUTOPILOT_ASSETS || path.join(__dirname, "..", "assets");

const GAP_S = 0.28; // silence between lines
const LEAD_S = 0.45; // before the hook
const TAIL_S = 0.9; // after the CTA

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    throw new Error(`${bin} ${args.slice(0, 4).join(" ")}... failed (${r.status}): ${(r.stderr || "").slice(-800)}`);
  }
  return r;
}

function probeDuration(file) {
  const r = run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const d = parseFloat(r.stdout.trim());
  if (!isFinite(d)) throw new Error(`ffprobe: no duration for ${file}`);
  return d;
}

function tts(text, outWav) {
  if (PIPER_BIN && PIPER_VOICE) {
    run(PIPER_BIN, ["--model", PIPER_VOICE, "--output_file", outWav], { input: text });
  } else {
    run("espeak-ng", ["-v", ESPEAK_VOICE, "-s", String(ESPEAK_WPM), "-w", outWav, text]);
  }
}

/* espeak/piper output params differ; normalize every clip (and the silence
 * between clips) to 24kHz mono s16 so the concat demuxer is happy. */
function normalize(inWav, outWav) {
  run(FFMPEG, ["-y", "-v", "error", "-i", inWav, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", outWav]);
}

function makeSilence(seconds, outWav) {
  run(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", seconds.toFixed(3), "-c:a", "pcm_s16le", outWav]);
}

function assTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
}

function escapeAss(text) {
  return text.replace(/\\/g, "\\\\").replace(/[{}]/g, "");
}

function buildAss(cues) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${FONT},76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,5,90,90,60,1
Style: Hook,${FONT},88,&H0000E7FF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,2,5,70,70,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = cues
    .map(
      (c, i) =>
        `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${i === 0 ? "Hook" : "Cap"},,0,0,0,,{\\fad(140,120)}${escapeAss(c.text)}`
    )
    .join("\n");
  return header + events + "\n";
}

function pickAsset(dir, seed) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(mp4|mov|mkv|webm|jpg|jpeg|png)$/i.test(f));
  } catch {
    return null;
  }
  if (!files.length) return null;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return path.join(dir, files[h % files.length]);
}

/* Deterministic pleasant palette per video id. */
function gradientColors(seed) {
  const palettes = [
    ["0x1a2a6c", "0xb21f1f", "0xfdbb2d"],
    ["0x0f2027", "0x203a43", "0x2c5364"],
    ["0x41295a", "0x2f0743", "0xdd2476"],
    ["0x000428", "0x004e92", "0x2ebf91"],
    ["0x232526", "0x414345", "0xff512f"],
  ];
  let h = 0;
  for (const ch of seed) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return palettes[h % palettes.length];
}

/* render(script, id) -> {videoPath, thumbPath, durationSec}
 * script.lines: array of spoken caption lines (line 0 = hook). */
function render(script, id, log = console.error) {
  ensure();
  const tmp = path.join(DATA_DIR, "tmp", id);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const outDir = path.join(DATA_DIR, "out");
  const videoPath = path.join(outDir, `${id}.mp4`);
  const thumbPath = path.join(outDir, `${id}.jpg`);

  // 1) TTS per line, normalized, with measured durations -> caption timings
  const cues = [];
  const concatList = [];
  const silLead = path.join(tmp, "sil-lead.wav");
  makeSilence(LEAD_S, silLead);
  concatList.push(silLead);
  let t = LEAD_S;
  script.lines.forEach((line, i) => {
    const raw = path.join(tmp, `raw-${i}.wav`);
    const norm = path.join(tmp, `line-${i}.wav`);
    tts(line, raw);
    normalize(raw, norm);
    const d = probeDuration(norm);
    cues.push({ text: line, start: t, end: t + d + GAP_S * 0.6 });
    concatList.push(norm);
    t += d;
    if (i < script.lines.length - 1) {
      const sil = path.join(tmp, `sil-${i}.wav`);
      makeSilence(GAP_S, sil);
      concatList.push(sil);
      t += GAP_S;
    }
  });
  const silTail = path.join(tmp, "sil-tail.wav");
  makeSilence(TAIL_S, silTail);
  concatList.push(silTail);
  const durationSec = t + TAIL_S;

  const listFile = path.join(tmp, "concat.txt");
  fs.writeFileSync(listFile, concatList.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const voiceWav = path.join(tmp, "voice.wav");
  run(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", voiceWav]);

  // 2) captions
  fs.writeFileSync(path.join(tmp, "captions.ass"), buildAss(cues));

  // 3) final mux: background + captions + voice (+ optional music bed)
  const dur = durationSec.toFixed(2);
  const bg = pickAsset(path.join(ASSETS, "backgrounds"), id);
  const music = pickAsset(path.join(ASSETS, "music"), id);
  const args = ["-y", "-v", "error"];
  let vFilter;
  if (bg && /\.(jpg|jpeg|png)$/i.test(bg)) {
    args.push("-loop", "1", "-i", bg);
    vFilter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0006,1.25)':d=25*${dur}:s=1080x1920:fps=25`;
  } else if (bg) {
    args.push("-stream_loop", "-1", "-i", bg);
    vFilter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=25`;
  } else {
    const [c0, c1, c2] = gradientColors(id);
    args.push("-f", "lavfi", "-i", `gradients=s=1080x1920:c0=${c0}:c1=${c1}:c2=${c2}:n=3:speed=0.02:r=25`);
    vFilter = `[0:v]null`;
  }
  args.push("-i", voiceWav);
  if (music) args.push("-stream_loop", "-1", "-i", music);
  vFilter += `,subtitles=captions.ass,format=yuv420p[v]`;
  const aFilter = music
    ? `[2:a]volume=${MUSIC_VOLUME}[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`
    : `[1:a]anull[a]`;
  args.push(
    "-filter_complex", `${vFilter};${aFilter}`,
    "-map", "[v]", "-map", "[a]",
    "-t", dur,
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-r", "25",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-movflags", "+faststart",
    videoPath
  );
  log(`[render] ${script.lines.length} lines, ${dur}s, bg=${bg ? path.basename(bg) : "generated"}, music=${music ? path.basename(music) : "none"}`);
  run(FFMPEG, args, { cwd: tmp }); // cwd=tmp so subtitles=captions.ass needs no path escaping

  run(FFMPEG, ["-y", "-v", "error", "-ss", "0.5", "-i", videoPath, "-frames:v", "1", "-q:v", "3", thumbPath]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { videoPath, thumbPath, durationSec };
}

module.exports = { render };
