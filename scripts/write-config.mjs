// Vercel build step: tells the static UI where the FeedForge backend lives.
// Set FEEDFORGE_API_URL in Vercel → Project → Settings → Environment Variables.
import { writeFileSync } from "node:fs";

let raw = (process.env.FEEDFORGE_API_URL || "").trim().replace(/\/+$/, "");

if (raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      console.warn(`[WARN] FEEDFORGE_API_URL should use https:// on HTTPS sites: "${raw}"`);
    }
  } catch {
    console.error(`✗ Invalid FEEDFORGE_API_URL: "${raw}"`);
    raw = "";
  }
}

writeFileSync("public/config.js", `window.FEEDFORGE_API_URL = ${JSON.stringify(raw)};\n`);
console.log(`✓ Config written. Backend URL: ${raw || "(none set - using local/browser origin)"}`);
