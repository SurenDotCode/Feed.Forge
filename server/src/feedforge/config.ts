import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * FeedForge backend configuration.
 * Every value comes from environment variables so the same build runs on
 * localhost, Docker, Hugging Face Spaces, Railway, Render or Cloud Run.
 */

// src/feedforge/config.ts → server root is two levels up
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The engine resolves prompts/, assets/ and src/remotion/ relative to cwd.
// Pin cwd to the server root so `npm start` works from any directory.
if (process.cwd() !== SERVER_ROOT) {
  process.chdir(SERVER_ROOT);
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function flag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

const defaultFrontend = path.resolve(SERVER_ROOT, "..", "public");

export const settings = {
  port: int(process.env["PORT"], 7860, 1, 65535),
  host: process.env["HOST"] ?? "0.0.0.0",

  /** Where job folders (job.json, rendered video, assets) are stored */
  jobsDir: path.resolve(process.env["FEEDFORGE_DATA_DIR"] ?? path.join(SERVER_ROOT, "data"), "jobs"),

  /** Parallel renders. Remotion is CPU/RAM heavy: keep 1 on small machines. */
  workers: int(process.env["FEEDFORGE_WORKERS"], 1, 1, 4),

  /** Keep only the newest N finished jobs on disk (0 = keep all) */
  maxJobs: int(process.env["FEEDFORGE_MAX_JOBS"], 50, 0, 10_000),

  /** Offline smoke-test mode: no API keys, no cost, placeholder visuals + silent voice */
  mock: flag(process.env["FEEDFORGE_MOCK"]) || process.argv.includes("--mock"),

  /** One Google AI Studio key powers script, research, images and voice */
  googleKey: (process.env["GOOGLE_API_KEY"] || process.env["GEMINI_API_KEY"] || "").trim(),

  /** Optional overrides */
  /** Gemini model IDs — Google retires models over time, so all three are overridable */
  /** Comma-separated list = automatic fallback chain (free-tier quota is per model) */
  llmModels: (process.env["FEEDFORGE_LLM_MODEL"]?.trim() || "gemini-3.8-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  imageModel: process.env["FEEDFORGE_IMAGE_MODEL"]?.trim() || undefined,
  ttsModel: process.env["FEEDFORGE_TTS_MODEL"]?.trim() || undefined,
  platform: (process.env["FEEDFORGE_PLATFORM"] ?? "youtube").trim(),
  archetype: process.env["FEEDFORGE_ARCHETYPE"]?.trim() || undefined,
  aiVideo: flag(process.env["FEEDFORGE_AI_VIDEO"]),

  /**
   * Economy mode (default ON): ~2 text calls per video instead of ~18 — no web research,
   * no critic/revision loop, no per-scene prompt rewriting, 5 scenes by default.
   * Set FEEDFORGE_ECONOMY=0 for full quality when you have a billed API key.
   */
  economy: (process.env["FEEDFORGE_ECONOMY"] ?? "1").trim() !== "0",

  /** auto = Gemini AI images with stock-photo fallback; stock = stock photos first */
  visuals: (process.env["FEEDFORGE_VISUALS"] ?? "auto").trim().toLowerCase() === "stock" ? ("stock" as const) : ("auto" as const),
  music: process.env["FEEDFORGE_MUSIC"]?.trim() === "lyria" ? ("lyria" as const) : ("bundled" as const),

  /** Comma-separated list of origins allowed to call the API ("*" = any) */
  allowedOrigins: (process.env["FEEDFORGE_ALLOWED_ORIGINS"] ?? "*")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),

  /** Folder holding the web UI (index.html). Served at / for local testing. */
  frontendDir: path.resolve(process.env["FEEDFORGE_FRONTEND_DIR"] ?? defaultFrontend),
};

fs.mkdirSync(settings.jobsDir, { recursive: true });

/** Primary text model (first in the chain) */
export const primaryLlmModel = settings.llmModels[0]!;

/** Optional third-party keys the engine can use when present */
export function engineKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  if (settings.googleKey) keys["GOOGLE_API_KEY"] = settings.googleKey;
  for (const name of ["PEXELS_API_KEY", "PIXABAY_API_KEY", "TAVILY_API_KEY"]) {
    const v = process.env[name]?.trim();
    if (v) keys[name] = v;
  }
  return keys;
}
