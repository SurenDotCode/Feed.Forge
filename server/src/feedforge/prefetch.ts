export {};
/**
 * One-time download of the Whisper caption-timing model (~460MB) into the local cache.
 * Run on a good connection:  npm run prefetch
 * After it succeeds, videos never need to download it again (works offline).
 */
const MODEL_ID = "onnx-community/whisper-small.en_timestamped";
const ATTEMPTS = 3;

const { pipeline } = await import("@huggingface/transformers");

let lastPct = -1;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    console.log(`Downloading ${MODEL_ID} (attempt ${attempt}/${ATTEMPTS})…`);
    await pipeline("automatic-speech-recognition", MODEL_ID, {
      progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
        if (p.status === "progress" && typeof p.progress === "number") {
          const pct = Math.floor(p.progress);
          if (pct !== lastPct && pct % 10 === 0) {
            lastPct = pct;
            console.log(`  ${p.file ?? ""} ${pct}%`);
          }
        }
      },
    });
    console.log("\n✓ Whisper model is cached. Captions will use precise word timing.");
    process.exit(0);
  } catch (err) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    lastPct = -1;
  }
}
console.error(
  "\nCould not download the model. Try another network (e.g. phone hotspot), or set\n" +
    "FEEDFORGE_CAPTION_ALIGN=estimate in server/.env to skip it entirely.",
);
process.exit(1);
