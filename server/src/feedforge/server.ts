// config must load first: it pins cwd before engine modules resolve prompts/ and assets/
import { settings } from "./config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { createJob, deleteJob, getJob, listJobs, queueStats, restoreJobs, toPublic, videoPath } from "./jobs.js";

/**
 * FeedForge API — the contract the FeedForge web UI calls.
 *
 *   GET  /health                 provider + worker status
 *   POST /api/jobs               { topic, scenes? }        → 202 job
 *   POST /api/batch              { topics: string[] }      → 202 { jobs }
 *   GET  /api/jobs               → { jobs } newest first (max 50)
 *   GET  /api/jobs/:id           → job
 *   GET  /api/jobs/:id/video     → MP4 stream (Range supported, ?download=1 to save)
 */

const app = Fastify({
  logger: { level: process.env["LOG_LEVEL"] ?? "warn" },
  trustProxy: true,
  bodyLimit: 64 * 1024,
});

// ── CORS: the Vercel-hosted UI calls this API from another origin ──
const allowAll = settings.allowedOrigins.includes("*");
await app.register(cors, {
  origin: allowAll
    ? true
    : (origin, cb) => {
        // same-origin / curl requests have no Origin header
        if (!origin) return cb(null, true);
        cb(null, settings.allowedOrigins.includes(origin.replace(/\/$/, "")));
      },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
  maxAge: 86400,
});

// ── Consistent JSON errors (FastAPI-style { detail }) ──
app.setErrorHandler((error: { statusCode?: number; message?: string }, _req, reply) => {
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status >= 500) app.log.error(error);
  reply.status(status).send({ detail: status >= 500 ? "Internal server error" : (error.message ?? "Bad request") });
});
app.setNotFoundHandler((_req, reply) => {
  reply.status(404).send({ detail: "Not found" });
});

// ── Validation helpers ──
function parseTopic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length >= 3 && t.length <= 500 ? t : null;
}

function parseScenes(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 3 || n > 8) return "invalid";
  return n;
}

// ── Health ──
app.get("/health", async () => {
  const configured = settings.mock || !!settings.googleKey;
  return {
    ok: true,
    version: "1.0.2",
    llm: settings.mock ? "Mock" : configured ? "Gemini" : "not configured",
    image_provider: settings.mock ? "Mock" : configured ? "Gemini" : "not configured",
    tts: settings.mock ? "Mock" : configured ? "Gemini TTS" : "not configured",
    workers: settings.workers,
    mock: settings.mock,
    economy: settings.economy,
    visuals: settings.visuals,
    stock_photos: Boolean(process.env["PEXELS_API_KEY"]?.trim() || process.env["PIXABAY_API_KEY"]?.trim()),
    models: {
      llm: settings.llmModels,
      image: settings.imageModel ?? "default",
      tts: settings.ttsModel ?? "default",
    },
    queue: queueStats(),
  };
});

// ── Jobs ──
app.post("/api/jobs", async (req, reply) => {
  const body = (req.body ?? {}) as { topic?: unknown; scenes?: unknown };
  const topic = parseTopic(body.topic);
  if (!topic) return reply.status(422).send({ detail: "topic must be 3-500 characters" });
  const scenes = parseScenes(body.scenes);
  if (scenes === "invalid") return reply.status(422).send({ detail: "scenes must be 3-8 or null" });
  return reply.status(202).send(createJob(topic, scenes));
});

app.post("/api/batch", async (req, reply) => {
  const body = (req.body ?? {}) as { topics?: unknown };
  if (!Array.isArray(body.topics) || body.topics.length < 1 || body.topics.length > 25) {
    return reply.status(422).send({ detail: "topics must be a list of 1-25 items" });
  }
  const valid = body.topics.map(parseTopic).filter((t): t is string => t !== null);
  if (!valid.length) return reply.status(400).send({ detail: "No valid topics" });
  return reply.status(202).send({ jobs: valid.map((t) => createJob(t, null)) });
});

app.get("/api/jobs", async () => ({ jobs: listJobs(50) }));

app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
  const job = getJob(req.params.id);
  if (!job) return reply.status(404).send({ detail: "Job not found" });
  return toPublic(job);
});

// Delete a finished job (UI: 200/404 = gone, 409 = still running)
app.delete<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
  const result = deleteJob(req.params.id);
  if (result === "missing") return reply.status(404).send({ detail: "job not found" });
  if (result === "busy") return reply.status(409).send({ detail: "job is still running" });
  return { deleted: req.params.id };
});

app.get<{ Params: { id: string }; Querystring: { download?: string } }>(
  "/api/jobs/:id/video",
  async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.status(404).send({ detail: "Job not found" });
    const file = videoPath(job);
    if (!file) return reply.status(404).send({ detail: "Video is not ready" });

    const size = fs.statSync(file).size;
    const name = `feedforge-${job.id}.mp4`;
    const disposition = req.query.download ? "attachment" : "inline";
    reply
      .header("Content-Type", "video/mp4")
      .header("Accept-Ranges", "bytes")
      .header("Cache-Control", "public, max-age=3600")
      .header("Content-Disposition", `${disposition}; filename="${name}"`);

    // Range requests: needed for seeking in <video> (Safari requires them)
    const range = req.headers.range;
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (match && (match[1] || match[2])) {
      let start: number;
      let end: number;
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      } else {
        const suffix = Number(match[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
      }
      if (start > end || start >= size) {
        return reply.status(416).header("Content-Range", `bytes */${size}`).send();
      }
      reply
        .status(206)
        .header("Content-Range", `bytes ${start}-${end}/${size}`)
        .header("Content-Length", String(end - start + 1));
      return reply.send(fs.createReadStream(file, { start, end }));
    }

    reply.header("Content-Length", String(size));
    return reply.send(fs.createReadStream(file));
  },
);

// ── Web UI (local testing: one server for UI + API) ──
const indexPath = path.join(settings.frontendDir, "index.html");
const hasFrontend = fs.existsSync(indexPath);

app.get("/", async (_req, reply) => {
  if (!hasFrontend) {
    return reply.type("application/json").send({
      ok: true,
      service: "FeedForge API",
      docs: "See /health and /api/jobs",
    });
  }
  return reply.type("text/html; charset=utf-8").send(fs.readFileSync(indexPath, "utf-8"));
});

// UI assets: /static/* → public/static/* (shader hero, effects, job actions)
const staticDir = path.join(settings.frontendDir, "static");
const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};
app.get<{ Params: { "*": string } }>("/static/*", async (req, reply) => {
  const rel = decodeURIComponent(req.params["*"] ?? "");
  const file = path.resolve(staticDir, rel);
  // block path traversal outside public/static
  if (!file.startsWith(staticDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return reply.status(404).send({ detail: "Not found" });
  }
  return reply
    .type(MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream")
    .header("Cache-Control", "no-cache")
    .send(fs.createReadStream(file));
});

// Same-origin when served from here, so the UI needs no API base URL
app.get("/config.js", async (_req, reply) => {
  return reply
    .type("application/javascript; charset=utf-8")
    .header("Cache-Control", "no-store")
    .send('window.FEEDFORGE_API_URL = "";\n');
});

// ── Boot ──
restoreJobs();

try {
  await app.listen({ port: settings.port, host: settings.host });
} catch (err) {
  console.error(`[feedforge] could not start on port ${settings.port}:`, err);
  process.exit(1);
}

const shown = settings.host === "0.0.0.0" ? "localhost" : settings.host;
console.log(`\n  FeedForge backend running → http://${shown}:${settings.port}`);
console.log(`  UI:      ${hasFrontend ? `http://${shown}:${settings.port}/` : "(not found — API only)"}`);
console.log(`  Mode:    ${settings.mock ? "MOCK (offline smoke test)" : settings.googleKey ? "LIVE (Gemini)" : "LIVE — ⚠ GOOGLE_API_KEY missing"}`);
console.log(`  Workers: ${settings.workers}   Jobs dir: ${settings.jobsDir}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}
