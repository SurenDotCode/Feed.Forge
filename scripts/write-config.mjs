// Vercel build step: tells the static UI where the FeedForge backend lives.
// Set FEEDFORGE_API_URL in Vercel → Project → Settings → Environment Variables.
import { writeFileSync } from "node:fs";

const defaultBackend = "https://suggestions-animation-long-remembered.trycloudflare.com";
let raw = (process.env.FEEDFORGE_API_URL || defaultBackend).trim().replace(/\/+$/, "");
if (raw.includes("railway.app")) {
  raw = defaultBackend;
}

let parsed;
try {
  parsed = new URL(raw);
} catch {
  console.error(`\n✗ FEEDFORGE_API_URL is not a valid URL: "${raw}"\n`);
  process.exit(1);
}
if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
  console.error(`\n✗ FEEDFORGE_API_URL must use https:// (browsers block http APIs on an https site): "${raw}"\n`);
  process.exit(1);
}

writeFileSync("public/config.js", `window.FEEDFORGE_API_URL = ${JSON.stringify(raw)};\n`);
console.log(`✓ UI will call the backend at ${raw}`);
