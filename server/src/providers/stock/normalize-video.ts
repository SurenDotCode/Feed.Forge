import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Re-encode a downloaded stock clip into a renderer-safe file and return its real duration.
 *
 * Stock sites serve clips with variable frame rates, odd timebases and rounded durations,
 * which makes the renderer request frames that don't exist ("No frame found at position").
 * Output: constant 30fps H.264, 1080x1920 (cover crop), no audio, max `maxSeconds` long.
 * Returns null if the clip can't be processed — the caller should not use it.
 */
export async function normalizeStockVideo(src: string, dest: string, maxSeconds = 20): Promise<number | null> {
  const tmp = `${dest}.tmp.mp4`;
  try {
    await run(
      "ffmpeg",
      [
        "-y", "-v", "error",
        "-i", src,
        "-t", String(maxSeconds),
        "-an",
        "-vf", "fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-movflags", "+faststart",
        tmp,
      ],
      { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets,r_frame_rate", "-of", "json", tmp],
      { timeout: 60_000 },
    );
    const info = JSON.parse(stdout) as { streams?: { nb_read_packets?: string; r_frame_rate?: string }[] };
    const frames = Number(info.streams?.[0]?.nb_read_packets ?? 0);
    const [num, den] = (info.streams?.[0]?.r_frame_rate ?? "30/1").split("/").map(Number);
    const fps = num && den ? num / den : 30;
    // Duration from the actual frame count — exact, unlike container metadata
    const duration = frames > 0 ? frames / fps : 0;
    if (duration < 0.5) throw new Error(`clip too short (${frames} frames)`);
    fs.renameSync(tmp, dest);
    return Math.floor(duration * 100) / 100;
  } catch (err) {
    console.warn(`[stock] Could not prepare video clip ${src}: ${err instanceof Error ? err.message : String(err)}`);
    fs.rmSync(tmp, { force: true });
    return null;
  }
}
