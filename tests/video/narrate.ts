// The film's narration: every spoken line of docs/submission/narration.md, one Fish Audio request each, saved as
// film-out/narration/<beat>-<line>.wav with a receipt, and film-out/narration/lines.json (text and measured length).
//
//   VIDEO_ENV_FILE=path/to/fish.env node --no-warnings tests/video/narrate.ts [--dry]
//
// Reads only FISH_AUDIO_API_KEY (from the environment or the file VIDEO_ENV_FILE names; never printed). A line whose
// text and settings have not changed is not sent again. Voice "Avery" on S2 (model header s2.1-pro-free); the
// [emotion] tags stay in the text, where S2 reads them as direction, not words. Pauses are cut in the edit.
// Adapted from the Fish adapter in the author family's earlier film pipelines.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VOICE = { referenceId: "ba875f2fb2ea4a4e9b175821014984b6", backend: "s2.1-pro-free" };
const OUT = path.resolve(process.env.FILM_OUT ?? "film-out", "narration");
const dry = process.argv.includes("--dry");

/** The script's spoken lines, by beat, in order. */
export function narrationLines(md = fs.readFileSync("docs/submission/narration.md", "utf8")): Array<{ id: string; beat: number; text: string }> {
  const lines: Array<{ id: string; beat: number; text: string }> = [];
  let beat = 0;
  let inNarration = false;
  let n = 0;
  for (const raw of md.split("\n")) {
    const b = raw.match(/^## Beat (\d+)/);
    if (b) {
      beat = Number(b[1]);
      inNarration = false;
      n = 0;
      continue;
    }
    if (/^\*\*Narration:\*\*/.test(raw)) {
      inNarration = true;
      continue;
    }
    if (/^(\*\*|##)/.test(raw)) inNarration = false;
    const item = inNarration && raw.match(/^- (.+)$/);
    if (item && beat) lines.push({ id: `b${beat}-${++n}`, beat, text: item[1]!.trim() });
  }
  return lines;
}

function credential(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const file = process.env.VIDEO_ENV_FILE;
  if (!file) throw new Error(`set ${name} or VIDEO_ENV_FILE`);
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m?.[1] !== name) continue;
    let v = m[2]!.trim();
    v = /^["']/.test(v) ? v.slice(1, v.lastIndexOf(v[0]!)) : v.replace(/\s+#.*$/, "").trim();
    if (v) return v;
  }
  throw new Error(`${name} missing from the env file`);
}

async function synthesize(text: string, dest: string): Promise<boolean> {
  const settings = { text, reference_id: VOICE.referenceId, format: "wav", sample_rate: 44100, temperature: 0.7, top_p: 0.7, prosody: { speed: 1.0, volume: 0 }, latency: "normal" };
  const hash = crypto.createHash("sha256").update(JSON.stringify({ ...settings, backend: VOICE.backend })).digest("hex");
  try {
    const receipt = JSON.parse(fs.readFileSync(`${dest}.json`, "utf8"));
    if (receipt.hash === hash && fs.statSync(dest).size > 1000) return false;
  } catch {
    /* not made yet */
  }
  const res = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    signal: AbortSignal.timeout(240_000),
    headers: { Authorization: `Bearer ${credential("FISH_AUDIO_API_KEY")}`, "Content-Type": "application/json", model: VOICE.backend },
    body: JSON.stringify(settings),
  });
  // Never print upstream bodies or headers.
  if (!res.ok) throw new Error(`Fish /v1/tts: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length <= 1000) throw new Error("Fish returned empty audio");
  fs.writeFileSync(`${dest}.partial`, bytes);
  fs.renameSync(`${dest}.partial`, dest);
  fs.writeFileSync(`${dest}.json`, JSON.stringify({ hash, ...VOICE, text, createdAt: new Date().toISOString() }, null, 2));
  return true;
}

const seconds = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

if (import.meta.url === `file://${process.argv[1]}`) {
  const lines = narrationLines();
  const chars = lines.reduce((s, l) => s + l.text.length, 0);
  console.log(`[narrate] ${lines.length} lines, ${chars} characters`);
  if (dry) {
    for (const l of lines) console.log(`  ${l.id}  ${l.text}`);
    process.exit(0);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const out = [];
  for (const l of lines) {
    const dest = path.join(OUT, `${l.id}.wav`);
    const fresh = await synthesize(l.text, dest);
    const s = seconds(dest);
    console.log(`  ${l.id}  ${s.toFixed(2)} s${fresh ? "" : " (cached)"}  ${l.text}`);
    out.push({ ...l, file: path.relative(process.cwd(), dest), seconds: s });
  }
  fs.writeFileSync(path.join(OUT, "lines.json"), JSON.stringify(out, null, 2));
  const total = out.reduce((s, l) => s + l.seconds, 0);
  console.log(`[narrate] ${total.toFixed(1)} s of speech -> ${path.relative(process.cwd(), OUT)}/lines.json`);
}
