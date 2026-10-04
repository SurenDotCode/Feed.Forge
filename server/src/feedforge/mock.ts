import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { DirectorScore } from "../schema/director-score.js";
import type {
  ImageProvider,
  LLMProvider,
  TTSProvider,
  TTSResult,
  WordTimestamp,
} from "../schema/providers.js";

/**
 * Offline smoke-test providers (FEEDFORGE_MOCK=1 or `npm run smoke`).
 * They exercise the full API → engine → Remotion render → quality gate path
 * without API keys or cost. Visuals are placeholders and the voice is silent.
 */

const run = promisify(execFile);

/** LLM that is intentionally unavailable — the engine falls back gracefully */
export class MockLLM implements LLMProvider {
  readonly id = "gemini" as const;
  async generate(): Promise<never> {
    throw new Error("LLM disabled in mock mode");
  }
}

/** Silent narration with evenly spaced word timestamps (~2.6 words/sec) */
export class MockTTS implements TTSProvider {
  async generate(text: string): Promise<TTSResult> {
    const tokens = text.split(/\s+/).filter(Boolean);
    const perWord = 0.38;
    const words: WordTimestamp[] = tokens.map((word, i) => ({
      word,
      start: Math.round(i * perWord * 1000) / 1000,
      end: Math.round((i * perWord + perWord * 0.9) * 1000) / 1000,
    }));
    const duration = Math.max(3, tokens.length * perWord + 0.5);
    const out = path.join(os.tmpdir(), `feedforge-mock-tts-${process.pid}-${Date.now()}.mp3`);
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-t", duration.toFixed(2), "-c:a", "libmp3lame", "-b:a", "64k", out,
    ]);
    const audio = fs.readFileSync(out);
    fs.rmSync(out, { force: true });
    return { audio, words };
  }
}

const PALETTE = ["0x1A1A1A", "0xA68B5B", "0x2B2620", "0x7A6540"];

/** Solid brand-colour placeholder frame (1080x1920), rendered with FFmpeg */
export class MockImage implements ImageProvider {
  private n = 0;
  async generate(_prompt: string): Promise<Buffer> {
    const color = PALETTE[this.n++ % PALETTE.length]!;
    const out = path.join(os.tmpdir(), `feedforge-mock-img-${process.pid}-${Date.now()}-${this.n}.png`);
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920`, "-frames:v", "1", out,
    ]);
    const png = fs.readFileSync(out);
    fs.rmSync(out, { force: true });
    return png;
  }
}

/** Deterministic scene plan so mock runs skip research/script LLM calls */
export function mockScore(topic: string, sceneCount: number | null): DirectorScore {
  const n = sceneCount ?? 5;
  const lines = [
    `Here is a quick look at ${topic}.`,
    "Most people never notice this part.",
    "It starts with one simple idea.",
    "Then small details make a big difference.",
    "Put it into practice and see what changes.",
    "Save this so you remember it later.",
  ];
  const scenes = Array.from({ length: n }, (_, i) => ({
    visual_type: (i % 3 === 2 ? "text_card" : "ai_image") as "text_card" | "ai_image",
    visual_prompt: i % 3 === 2 ? topic.toUpperCase().slice(0, 40) : `Scene ${i + 1} about ${topic}`,
    motion: (i % 2 === 0 ? "zoom_in" : "pan_right") as "zoom_in" | "pan_right",
    script_line: lines[i % lines.length]!,
    transition: i < n - 1 ? ("crossfade" as const) : null,
  }));
  return DirectorScore.parse({
    emotional_arc: "curiosity-to-understanding",
    archetype: "warm_narrative",
    music_mood: "chill_lofi",
    scenes,
  });
}
