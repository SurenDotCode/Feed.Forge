import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TTSProvider, TTSResult, WordTimestamp } from "../../schema/providers.js";
import type { WhisperAligner } from "./whisper-aligner.js";

/**
 * Decorator that wraps any TTSProvider and auto-injects word-level timestamps
 * when the inner provider returns an empty words array. Also transcodes WAV
 * audio to MP3 to maintain the pipeline's MP3 contract.
 *
 *   inner.generate(text)
 *     │
 *     ├── words.length > 0 ──► passthrough (ElevenLabs, Inworld)
 *     │
 *     └── words.length === 0 ──► whisperAligner.align()
 *                                    │
 *                                    ├── aligned words > 0 ──► return
 *                                    └── aligned words === 0 ──► HARD FAIL
 *
 *   If audio is WAV (RIFF header) ──► ffmpeg transcode to MP3
 */
export class AlignedTTSProvider implements TTSProvider {
  constructor(
    private inner: TTSProvider,
    private aligner: WhisperAligner,
  ) {}

  async generate(text: string): Promise<TTSResult> {
    const result = await this.inner.generate(text);

    let { audio, words } = result;

    // Auto-align if provider returned no timestamps.
    // FEEDFORGE_CAPTION_ALIGN=estimate skips Whisper (no ~460MB model download);
    // if Whisper cannot load or align, captions are timed from the audio instead
    // of failing the whole video.
    if (words.length === 0 && text.trim().length > 0) {
      const mode = (process.env["FEEDFORGE_CAPTION_ALIGN"] ?? "whisper").trim().toLowerCase();
      if (mode === "estimate") {
        words = await estimateWordTimings(audio, text);
      } else {
        try {
          words = await this.aligner.align(audio, text);
        } catch (err) {
          console.warn(
            `[tts] Whisper alignment unavailable, timing captions from audio instead: ${err instanceof Error ? err.message : String(err)}`,
          );
          words = await estimateWordTimings(audio, text);
        }
      }
    }

    // Transcode WAV to MP3 to match pipeline's voiceover.mp3 contract
    if (isWav(audio)) {
      audio = await transcodeWavToMp3(audio);
    }

    return { audio, words };
  }
}

/**
 * Fallback word timing without a speech model: find where speech starts and ends
 * (ffmpeg silencedetect), then spread the transcript's words across that span,
 * weighted by word length plus pauses after punctuation.
 */
export async function estimateWordTimings(audio: Buffer, text: string): Promise<WordTimestamp[]> {
  const tokens = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (tokens.length === 0) return [];

  const { duration, speechStart, speechEnd } = await probeSpeech(audio);
  const start = Math.min(speechStart, Math.max(0, duration - 0.5));
  const end = speechEnd > start + 0.5 ? speechEnd : Math.max(start + 0.5, duration);

  const weights = tokens.map((w) => {
    const letters = (w.match(/[\p{L}\p{N}]/gu) ?? []).length;
    const pause = /[.!?]["')\]]*$/.test(w) ? 6 : /[,;:\u2014-]["')\]]*$/.test(w) ? 3 : 0;
    return Math.max(2, letters) + 1.5 + pause;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const span = end - start;

  const out: WordTimestamp[] = [];
  let t = start;
  for (let i = 0; i < tokens.length; i++) {
    const slot = (weights[i]! / total) * span;
    const spoken = Math.max(0.08, slot * 0.85);
    out.push({
      word: tokens[i]!,
      start: Math.round(t * 1000) / 1000,
      end: Math.round(Math.min(end, t + spoken) * 1000) / 1000,
    });
    t += slot;
  }
  return out;
}

/** Duration + first/last non-silent moment of an audio buffer (any ffmpeg-readable format) */
async function probeSpeech(audio: Buffer): Promise<{ duration: number; speechStart: number; speechEnd: number }> {
  const tmp = await mkdtemp(join(tmpdir(), "tts-probe-"));
  const input = join(tmp, isWav(audio) ? "in.wav" : "in.mp3");
  try {
    await writeFile(input, audio);
    const stderr = await new Promise<string>((resolve) => {
      execFile(
        "ffmpeg",
        ["-hide_banner", "-i", input, "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"],
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
        (_err, _stdout, err) => resolve(String(err ?? "")),
      );
    });
    const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
    const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
    if (!duration) throw new Error("could not read voiceover duration");

    const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    // leading silence: a silence that starts at ~0
    const speechStart = starts.length && starts[0]! < 0.05 && ends.length ? Math.min(ends[0]!, duration) : 0;
    // trailing silence: the last silence runs to EOF (no end reported, or end ≈ duration)
    const lastStart = starts.length ? starts[starts.length - 1]! : null;
    const lastEnd = ends.length ? ends[ends.length - 1]! : null;
    const trailing =
      lastStart !== null &&
      lastStart > speechStart &&
      (starts.length > ends.length || (lastEnd !== null && Math.abs(lastEnd - duration) < 0.15));
    const speechEnd = trailing ? lastStart! : duration;
    return { duration, speechStart, speechEnd: speechEnd > speechStart ? speechEnd : duration };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Check if buffer starts with RIFF/WAV header */
function isWav(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString("ascii", 0, 4) === "RIFF";
}

/** Transcode WAV buffer to MP3 via ffmpeg (temp files). */
async function transcodeWavToMp3(wav: Buffer): Promise<Buffer> {
  const tmp = await mkdtemp(join(tmpdir(), "tts-transcode-"));
  const wavPath = join(tmp, "input.wav");
  const mp3Path = join(tmp, "output.mp3");

  try {
    await writeFile(wavPath, wav);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        ["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-q:a", "2", mp3Path],
        { timeout: 30_000 },
        (err) => {
          if (err) {
            reject(
              new Error(
                `WAV→MP3 transcode failed: ${err.message}. Ensure ffmpeg is installed and in PATH.`,
              ),
            );
          } else {
            resolve();
          }
        },
      );
    });

    return await readFile(mp3Path);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
