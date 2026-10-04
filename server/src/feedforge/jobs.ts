import { settings, engineKeys, primaryLlmModel } from "./config.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getPlatformConfig } from "../config/platforms.js";
import type { PipelineCallbacks, StageName } from "../pipeline/orchestrator.js";
import { runPipeline } from "../pipeline/orchestrator.js";
import { createProviders, createVerificationModel } from "../providers/factory.js";
import { FallbackLLM } from "../providers/llm/fallback.js";
import { GeminiLLM } from "../providers/llm/gemini.js";
import { BundledMusic } from "../providers/music/bundled-adapter.js";
import { DirectorScore } from "../schema/director-score.js";
import type { LLMProvider } from "../schema/providers.js";
import { MockImage, MockLLM, MockTTS, mockScore } from "./mock.js";
import { buildPublishPack, type PublishPack } from "./publish-pack.js";
import { type QualityReport, validateVideo } from "./quality.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public job shape — exactly what the FeedForge UI renders
// ─────────────────────────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "done" | "failed";
export type UiStage = "queued" | "script" | "generate" | "compose" | "validate" | "done";

/** Scene-by-scene script the UI shows in its script panel / "Download script" action */
export interface JobPlan {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  scenes: { narration: string; visual_prompt: string; on_screen_text: string | null }[];
}

/** Counters the UI's specs panel can display */
export interface JobUsage {
  llm_calls: number;
  tts_chars: number;
  scenes: number;
  stock_assets: number;
}

export interface PublicJob {
  id: string;
  topic: string;
  scenes_requested: number | null;
  status: JobStatus;
  stage: UiStage;
  progress: number;
  elapsed_s: number;
  est_cost_usd: number;
  video_url: string | null;
  publish_pack: PublishPack | null;
  quality: QualityReport | null;
  degraded_scenes: number[];
  error: string | null;
  logs: string[];
  created_at: string;
  /** Unix seconds (same field the Python backend returned) */
  created: number;
  plan: JobPlan | null;
  usage: JobUsage;
}

interface StoredJob extends Omit<PublicJob, "logs" | "elapsed_s" | "created"> {
  log: string[];
  started_at: string | null;
  finished_at: string | null;
  video_file: string | null; // relative to the job folder
  critic_score: number | null;
}

/** Engine's 6 internal stages → the UI's 4 pipeline steps */
const STAGE_MAP: Record<StageName, UiStage> = {
  research: "script",
  director: "script",
  tts: "generate",
  visuals: "generate",
  assembly: "compose",
  critic: "validate",
};

/** Progress % reached when each engine stage starts / completes */
const PROGRESS: Record<StageName, [number, number]> = {
  research: [3, 12],
  director: [12, 25],
  tts: [25, 35],
  visuals: [35, 65],
  assembly: [65, 90],
  critic: [90, 95],
};

const LABEL: Record<StageName, string> = {
  research: "Research",
  director: "Script",
  tts: "Voiceover",
  visuals: "Visuals + music",
  assembly: "Render",
  critic: "Critic review",
};

const MAX_LOG_LINES = 400;

// ─────────────────────────────────────────────────────────────────────────────
// Store (in memory + atomic job.json per job, survives restarts)
// ─────────────────────────────────────────────────────────────────────────────

const jobs = new Map<string, StoredJob>();
const queue: string[] = [];
let active = 0;

function jobDir(id: string): string {
  return path.join(settings.jobsDir, id);
}

function save(job: StoredJob): void {
  const dir = jobDir(job.id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.job.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, path.join(dir, "job.json"));
}

function log(job: StoredJob, message: string): void {
  for (const line of message.split("\n")) {
    const text = line.trimEnd();
    if (!text.trim()) continue;
    const stamp = new Date().toISOString().slice(11, 19);
    job.log.push(`[${stamp}] ${text}`);
  }
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

function elapsed(job: StoredJob): number {
  if (!job.started_at) return 0;
  const end = job.finished_at ? Date.parse(job.finished_at) : Date.now();
  return Math.max(0, Math.round((end - Date.parse(job.started_at)) / 100) / 10);
}

export function toPublic(job: StoredJob): PublicJob {
  return {
    id: job.id,
    topic: job.topic,
    scenes_requested: job.scenes_requested,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    elapsed_s: elapsed(job),
    est_cost_usd: job.est_cost_usd,
    video_url: job.video_url,
    publish_pack: job.publish_pack,
    quality: job.quality,
    degraded_scenes: job.degraded_scenes,
    error: job.error,
    logs: job.log,
    created_at: job.created_at,
    created: Math.floor(Date.parse(job.created_at) / 1000),
    plan: job.plan ?? null,
    usage: job.usage ?? { llm_calls: 0, tts_chars: 0, scenes: 0, stock_assets: 0 },
  };
}

/** Time-sortable id: base36 timestamp + random suffix (10 chars) */
function newId(): string {
  return Date.now().toString(36).slice(-7) + crypto.randomBytes(2).toString("hex").slice(0, 3);
}

export function getJob(id: string): StoredJob | undefined {
  return jobs.get(id);
}

export function listJobs(limit = 50): PublicJob[] {
  return [...jobs.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map(toPublic);
}

export function videoPath(job: StoredJob): string | null {
  if (job.status !== "done" || !job.video_file) return null;
  const p = path.join(jobDir(job.id), job.video_file);
  return fs.existsSync(p) ? p : null;
}

export function createJob(topic: string, scenes: number | null): PublicJob {
  const job: StoredJob = {
    id: newId(),
    topic: topic.trim(),
    scenes_requested: scenes,
    status: "queued",
    stage: "queued",
    progress: 0,
    est_cost_usd: 0,
    video_url: null,
    publish_pack: null,
    quality: null,
    degraded_scenes: [],
    error: null,
    log: [],
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    video_file: null,
    critic_score: null,
    plan: null,
    usage: { llm_calls: 0, tts_chars: 0, scenes: 0, stock_assets: 0 },
  };
  log(job, "Queued.");
  jobs.set(job.id, job);
  save(job);
  queue.push(job.id);
  pump();
  return toPublic(job);
}

/** Load jobs from disk on boot. Re-queue waiting jobs; interrupted ones are marked failed. */
export function restoreJobs(): void {
  if (!fs.existsSync(settings.jobsDir)) return;
  const restored: StoredJob[] = [];
  for (const entry of fs.readdirSync(settings.jobsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(settings.jobsDir, entry.name, "job.json");
    try {
      const job = JSON.parse(fs.readFileSync(file, "utf-8")) as StoredJob;
      if (!job?.id || job.id !== entry.name) continue;
      if (job.status === "running") {
        job.status = "failed";
        job.error = "Interrupted: the server restarted while this video was rendering. Please generate it again.";
        job.finished_at = new Date().toISOString();
        log(job, `FAILED: ${job.error}`);
        save(job);
      }
      jobs.set(job.id, job);
      restored.push(job);
    } catch {
      // unreadable job folder — ignore
    }
  }
  restored
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((j) => queue.push(j.id));
  pump();
}

export function queueStats() {
  return { active, queued: queue.length, total: jobs.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker pool
// ─────────────────────────────────────────────────────────────────────────────

function pump(): void {
  while (active < settings.workers && queue.length > 0) {
    const id = queue.shift()!;
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    active++;
    execute(job)
      .catch((err) => console.error(`[feedforge] job ${id} crashed:`, err))
      .finally(() => {
        active--;
        prune();
        pump();
      });
  }
}

function prune(): void {
  if (settings.maxJobs <= 0) return;
  const finished = [...jobs.values()]
    .filter((j) => j.status === "done" || j.status === "failed")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const old of finished.slice(settings.maxJobs)) {
    jobs.delete(old.id);
    fs.rmSync(jobDir(old.id), { recursive: true, force: true });
  }
}

function fail(job: StoredJob, message: string): void {
  job.status = "failed";
  job.error = message.length > 600 ? `${message.slice(0, 600)}…` : message;
  job.finished_at = new Date().toISOString();
  log(job, `FAILED: ${job.error}`);
  save(job);
}

/** Turn provider/stack errors into something a user can act on */
export function friendlyError(raw: string): string {
  const msg = raw.replace(/^Error:\s*/, "");
  const low = msg.toLowerCase();
  if (low.includes("api key not valid") || low.includes("api_key_invalid") || low.includes("permission_denied"))
    return `Google API key was rejected. Check GOOGLE_API_KEY. (${msg.slice(0, 200)})`;
  if (low.includes("no longer available") || low.includes("is not found for api version") || (low.includes("model") && low.includes("not found")))
    return `A Gemini model used by FeedForge is not available for your API key. Set FEEDFORGE_LLM_MODEL / FEEDFORGE_IMAGE_MODEL / FEEDFORGE_TTS_MODEL in server/.env to a model your key supports. (${msg.slice(0, 260)})`;
  if (low.includes("forbidden") || low.includes(" 403"))
    return `Google refused the request (403). Check that GOOGLE_API_KEY is valid and the Gemini API is enabled for it. (${msg.slice(0, 200)})`;
  // Match 429 only as a standalone code — file paths/ids can contain those digits
  if (low.includes("quota") || low.includes("resource_exhausted") || /(^|[^\d])429([^\d]|$)/.test(low.replace(/[a-z]:\\[^\s)]*/g, "")))
    return `Google API quota or rate limit reached. Wait a minute or check billing. (${msg.slice(0, 200)})`;
  if (low.includes("compositor error") || low.includes("no frame found"))
    return `The video renderer could not read one of the stock clips. Please generate again (a different clip will be picked). (${msg.slice(0, 200)})`;
  if (low.includes("browser") && (low.includes("download") || low.includes("could not find")))
    return `Video renderer could not start Chrome Headless Shell. Run "npx remotion browser ensure" in server/. (${msg.slice(0, 200)})`;
  if (low.includes("whisper") || low.includes("huggingface"))
    return `Voice alignment model could not be loaded (first run downloads ~460MB). Check internet access. (${msg.slice(0, 200)})`;
  return msg;
}

async function execute(job: StoredJob): Promise<void> {
  const dir = jobDir(job.id);
  job.status = "running";
  job.started_at = new Date().toISOString();
  job.progress = 1;
  log(job, settings.mock ? "Worker started (MOCK MODE — placeholder visuals, silent voice)." : "Worker started.");
  save(job);

  if (!settings.mock && !settings.googleKey) {
    fail(job, "GOOGLE_API_KEY is not configured on the backend. Add it to server/.env (local) or your host's environment variables, then restart the backend.");
    return;
  }

  let platform;
  try {
    platform = getPlatformConfig(settings.platform);
  } catch (err) {
    fail(job, `Invalid FEEDFORGE_PLATFORM "${settings.platform}": ${String(err)}`);
    return;
  }

  // Providers: one Google key → Gemini script/research, Gemini images, Gemini TTS
  const keys = engineKeys();
  let llm: LLMProvider;
  let pipelineProviders;
  try {
    if (settings.mock) {
      llm = new MockLLM();
      pipelineProviders = {
        llm,
        tts: new MockTTS(),
        imageGen: new MockImage(),
        stock: [],
        videoProviders: [],
        music: new BundledMusic(),
      };
    } else {
      const p = createProviders({
        llm: "gemini",
        tts: "gemini-tts",
        image: "gemini",
        stock: "pexels",
        video: settings.aiVideo ? "gemini" : undefined,
        music: settings.music,
        keys,
        llmModel: primaryLlmModel,
        imageModel: settings.imageModel,
        ttsModel: settings.ttsModel,
        searchProvider: keys["TAVILY_API_KEY"] ? "tavily" : "native",
      });
      llm = p.llm;
      // Several text models configured → automatic fallback when one runs out of quota
      if (settings.llmModels.length > 1) {
        const chain = new FallbackLLM(
          settings.llmModels.map((name) => ({ name, llm: new GeminiLLM(name, settings.googleKey) })),
        );
        chain.onSwitch = (from, to, reason) => {
          log(job, `Text model ${from}: ${reason} → switching to ${to}`);
          save(job);
        };
        llm = chain;
      }
      llm = countCalls(llm, job);
      pipelineProviders = { ...p, llm, videoProviders: settings.aiVideo ? p.videoProviders : [] };
    }
  } catch (err) {
    fail(job, `Could not initialise AI providers: ${friendlyError(String(err))}`);
    return;
  }

  let finalScore: DirectorScore | null = null;
  let currentStage: StageName | null = null;

  const callbacks: PipelineCallbacks = {
    onStageStart(stage) {
      currentStage = stage;
      job.stage = STAGE_MAP[stage];
      job.progress = Math.max(job.progress, PROGRESS[stage][0]);
      log(job, `▶ ${LABEL[stage]} started`);
      save(job);
    },
    onStageComplete(stage, detail, durationSec) {
      job.progress = Math.max(job.progress, PROGRESS[stage][1]);
      log(job, `✓ ${LABEL[stage]} done — ${detail} (${durationSec.toFixed(1)}s)`);
      save(job);
    },
    onStageSkip(stage, reason) {
      job.progress = Math.max(job.progress, PROGRESS[stage][1]);
      log(job, `↷ ${LABEL[stage]} skipped — ${reason}`);
      save(job);
    },
    onStageError(stage, error) {
      log(job, `✗ ${LABEL[stage]} error — ${error}`);
      save(job);
    },
    onProgress(_stage, data) {
      const type = data["type"];
      if (type === "asset_failed") {
        const scene = Number(data["scene"]) + 1;
        if (!job.degraded_scenes.includes(scene)) job.degraded_scenes.push(scene);
        job.degraded_scenes.sort((a, b) => a - b);
        log(job, `Scene ${scene} visual failed, rendering without it: ${String(data["error"]).slice(0, 200)}`);
      } else if (type === "score") {
        try {
          finalScore = DirectorScore.parse(data["score"]);
          job.plan = planFromScore(job.topic, finalScore);
          job.usage.scenes = finalScore.scenes.length;
          job.usage.tts_chars = finalScore.scenes.reduce((n, s) => n + s.script_line.length, 0);
          log(job, `Scene plan ready: ${finalScore.scenes.length} scenes, style "${finalScore.archetype}".`);
        } catch {
          /* engine already validated it */
        }
      } else if (type === "revision") {
        log(job, `Script revised (round ${data["round"]}, critic score ${data["critiqueScore"]}/10).`);
      } else if (type === "review") {
        job.critic_score = typeof data["score"] === "number" ? data["score"] : null;
      } else if (type === "results") {
        log(job, "Research complete.");
      } else if (type === "music_resolved") {
        log(job, `Music: ${data["provider"]}${data["fallback"] ? " (fallback)" : ""}.`);
      } else if (type === "bundling") {
        log(job, "Bundling video composition…");
      } else if (type === "rendering") {
        log(job, `Rendering ${data["totalFrames"]} frames at ${platform.width}x${platform.height}…`);
      } else {
        return; // high-frequency events: no disk write
      }
      save(job);
    },
    async onCostEstimate(estimate) {
      job.est_cost_usd = settings.mock ? 0 : Math.round(estimate.totalCost * 1000) / 1000;
      log(job, settings.mock ? "Estimated cost: $0 (mock mode)" : `Estimated cost: $${job.est_cost_usd.toFixed(3)}`);
      save(job);
      return true; // auto-approve: server mode has no interactive prompt
    },
    onActualCost(cost) {
      if (!settings.mock) job.est_cost_usd = Math.round(cost.totalCost * 1000) / 1000;
      save(job);
    },
    onLog(message) {
      // Engine prints local file paths at the end — keep them out of the UI log
      if (/^\s*(Output|Video|Score|Log):/.test(message) || message.includes(settings.jobsDir)) return;
      log(job, message);
      save(job);
    },
    isCancelled: () => false,
  };

  // Economy mode defaults to 5 scenes: fewer image generations per video
  const sceneCount = job.scenes_requested ?? (settings.economy ? 5 : null);
  const direction = sceneCount ? `Structure the video in exactly ${sceneCount} scenes.` : undefined;
  if (settings.economy && !settings.mock) log(job, "Economy mode: minimal API calls per video.");
  if (!settings.mock) {
    log(
      job,
      pipelineProviders.stock.length > 0
        ? `Visuals: ${settings.visuals === "stock" ? "stock photos first" : "AI images, stock-photo fallback"}.`
        : "Visuals: AI images only (add PEXELS_API_KEY for a free stock-photo fallback).",
    );
  }
  const replayScore = settings.mock ? mockScore(job.topic, job.scenes_requested) : undefined;
  if (replayScore) {
    finalScore = replayScore;
    job.plan = planFromScore(job.topic, replayScore);
  }

  try {
    const result = await runPipeline(
      {
        topic: job.topic,
        llm: pipelineProviders.llm,
        tts: pipelineProviders.tts,
        ttsProvider: "gemini-tts",
        imageGen: pipelineProviders.imageGen,
        imageProvider: "gemini",
        stock: pipelineProviders.stock,
        videoProviders: pipelineProviders.videoProviders,
        videoProvider: settings.aiVideo ? "gemini" : undefined,
        noVideo: !settings.aiVideo,
        archetype: settings.archetype,
        platform: settings.platform,
        dryRun: false,
        noMusic: false,
        musicProvider: pipelineProviders.music,
        musicProviderKey: settings.mock ? "bundled" : settings.music,
        preview: false,
        outputDir: dir,
        yes: true,
        verifyModel: settings.mock ? undefined : createVerificationModel("gemini", primaryLlmModel, settings.googleKey),
        direction: replayScore ? undefined : direction,
        replayScore,
        economy: settings.economy,
        stockVerify: !settings.economy,
        visualsMode: settings.visuals,
      },
      callbacks,
    );

    if (!result.videoPath || !fs.existsSync(result.videoPath)) {
      throw new Error("The pipeline finished but no video file was produced.");
    }

    // Keep a stable path for streaming; drop heavy intermediates
    const finalPath = path.join(dir, "video.mp4");
    fs.renameSync(result.videoPath, finalPath);
    job.video_file = "video.mp4";
    try {
      const scorePath = path.join(result.outputDir, "score.json");
      if (!finalScore && fs.existsSync(scorePath)) {
        finalScore = DirectorScore.parse(JSON.parse(fs.readFileSync(scorePath, "utf-8")));
      }
    } catch {
      /* score is optional for packaging */
    }

    // ── Validate: ffprobe quality gate ──
    job.stage = "validate";
    job.progress = Math.max(job.progress, 95);
    log(job, "Running quality gate (ffprobe)…");
    save(job);
    const score = finalScore as DirectorScore | null;
    const quality = await validateVideo(finalPath, score?.scenes.length ?? 0, job.critic_score, {
      width: platform.width,
      height: platform.height,
      maxDuration: platform.maxDurationSeconds,
    });
    job.quality = quality;
    if (!quality.passed) {
      throw new Error(`Quality gate failed: ${quality.errors.join(", ")}`);
    }
    log(job, `Quality gate passed: ${quality.duration_s}s, ${quality.width}x${quality.height}, audio ✓.`);

    // ── Publish pack: title, caption, hashtags ──
    const pack = await buildPublishPack(settings.mock ? null : llm, job.topic, score);
    job.publish_pack = pack.pack;
    if (score) job.plan = planFromScore(job.topic, score, pack.pack);
    log(job, pack.usedFallback && !settings.mock ? `Caption generated from script (LLM unavailable: ${pack.error})` : "Caption and hashtags ready.");

    try {
      job.usage.stock_assets = fs
        .readdirSync(path.join(result.outputDir, "assets"))
        .filter((f) => /^scene-\d+-stock\./.test(f)).length;
    } catch {
      /* optional counter */
    }

    // Clean up intermediates (assets, public copies) — keep score/log for debugging
    try {
      fs.rmSync(path.join(result.outputDir, "assets"), { recursive: true, force: true });
    } catch {
      /* best effort */
    }

    job.status = "done";
    job.stage = "done";
    job.progress = 100;
    job.video_url = `/api/jobs/${job.id}/video`;
    job.finished_at = new Date().toISOString();
    log(job, `Done in ${elapsed(job)}s.`);
    save(job);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (currentStage) job.stage = STAGE_MAP[currentStage];
    if (raw.startsWith("Quality gate failed")) job.stage = "validate";
    fail(job, friendlyError(raw));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI contract helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map the engine's scene plan to the UI's plan shape (title/hook/caption/hashtags/scenes) */
function planFromScore(topic: string, score: DirectorScore, pack?: PublishPack | null): JobPlan {
  const first = score.scenes[0]?.script_line ?? "";
  return {
    title: pack?.title ?? topic,
    hook: first,
    caption: pack?.caption ?? "",
    hashtags: pack?.hashtags ?? [],
    scenes: score.scenes.map((s) => ({
      narration: s.script_line,
      visual_prompt: s.visual_prompt,
      on_screen_text: s.visual_type === "text_card" ? s.visual_prompt.slice(0, 60) : null,
    })),
  };
}

/** Wrap the text model so every request is counted in job.usage.llm_calls */
function countCalls(llm: LLMProvider, job: StoredJob): LLMProvider {
  return {
    id: llm.id,
    generate: ((opts: Parameters<LLMProvider["generate"]>[0]) => {
      job.usage.llm_calls++;
      return llm.generate(opts);
    }) as LLMProvider["generate"],
  };
}

/**
 * Delete a finished job and its files.
 * Returns "deleted", "missing", or "busy" (queued/running jobs are never deleted).
 */
export function deleteJob(id: string): "deleted" | "missing" | "busy" {
  const job = jobs.get(id);
  if (!job) return "missing";
  if (job.status === "queued" || job.status === "running") return "busy";
  jobs.delete(id);
  fs.rmSync(jobDir(id), { recursive: true, force: true });
  return "deleted";
}
