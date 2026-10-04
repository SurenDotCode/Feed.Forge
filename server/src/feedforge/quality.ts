import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface QualityReport {
  passed: boolean;
  /** Named pass/fail checks (shown in the UI's specs panel) */
  checks: Record<string, boolean>;
  errors: string[];
  scene_count: number;
  format: "mp4";
  target: "9:16";
  duration_s: number | null;
  width: number | null;
  height: number | null;
  has_audio: boolean;
  size_mb: number | null;
  critic_score: number | null;
}

/** ffprobe quality gate: file size, duration window, 1080x1920, audio present */
export async function validateVideo(
  videoPath: string,
  sceneCount: number,
  criticScore: number | null,
  expected: { width: number; height: number; maxDuration: number },
): Promise<QualityReport> {
  const errors: string[] = [];
  let duration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let hasAudio = false;
  let sizeMb: number | null = null;

  if (!fs.existsSync(videoPath)) {
    errors.push("output file is missing");
  } else {
    const size = fs.statSync(videoPath).size;
    sizeMb = Math.round((size / 1_048_576) * 100) / 100;
    if (size < 50_000) errors.push("output file is too small");

    try {
      const { stdout } = await run(
        "ffprobe",
        [
          "-v", "error",
          "-show_entries", "format=duration:stream=codec_type,width,height",
          "-of", "json",
          videoPath,
        ],
        { timeout: 30_000 },
      );
      const data = JSON.parse(stdout) as {
        format?: { duration?: string };
        streams?: { codec_type?: string; width?: number; height?: number }[];
      };
      duration = data.format?.duration ? Math.round(Number(data.format.duration) * 10) / 10 : null;
      const video = data.streams?.find((s) => s.codec_type === "video");
      hasAudio = !!data.streams?.some((s) => s.codec_type === "audio");
      width = video?.width ?? null;
      height = video?.height ?? null;

      const maxDuration = expected.maxDuration + 15; // small tolerance for outro/transitions
      if (duration == null || duration < 5 || duration > maxDuration) {
        errors.push(`duration ${duration ?? "?"}s outside 5-${maxDuration}s`);
      }
      if (width !== expected.width || height !== expected.height) {
        errors.push(`video is ${width}x${height}, expected ${expected.width}x${expected.height}`);
      }
      if (!hasAudio) errors.push("audio stream missing");
    } catch (err) {
      errors.push(`ffprobe validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const exists = sizeMb !== null;
  const maxDuration = expected.maxDuration + 15;
  const checks: Record<string, boolean> = {
    file_not_empty: exists && (sizeMb ?? 0) * 1_048_576 >= 50_000,
    video_stream: width !== null && height !== null,
    aspect_9_16: !!width && !!height && Math.abs(width / height - 9 / 16) < 0.01,
    [`resolution_${expected.width}x${expected.height}`]: width === expected.width && height === expected.height,
    audio_present: hasAudio,
    [`duration_5_to_${maxDuration}s`]: duration !== null && duration >= 5 && duration <= maxDuration,
    scene_count_ok: sceneCount >= 3 && sceneCount <= 16,
  };

  return {
    passed: errors.length === 0,
    checks,
    errors,
    scene_count: sceneCount,
    format: "mp4",
    target: "9:16",
    duration_s: duration,
    width,
    height,
    has_audio: hasAudio,
    size_mb: sizeMb,
    critic_score: criticScore,
  };
}
