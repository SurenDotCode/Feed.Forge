import type { TTSProvider, TTSResult } from "../../schema/providers.js";
import { isOverloadedText, isQuotaErrorText, isUnavailableModelText } from "../llm/fallback.js";

/** Tries TTS models in order; moves on when one is out of quota, overloaded or unavailable. */
export class FallbackTTS implements TTSProvider {
  constructor(private readonly members: { name: string; tts: TTSProvider }[]) {
    if (members.length === 0) throw new Error("FallbackTTS needs at least one model");
  }

  async generate(text: string): Promise<TTSResult> {
    let lastErr: unknown;
    for (const member of this.members) {
      try {
        return await member.tts.generate(text);
      } catch (err) {
        lastErr = err;
        const m = String(err instanceof Error ? err.message : err).toLowerCase();
        if (!(isQuotaErrorText(m) || isOverloadedText(m) || isUnavailableModelText(m))) throw err;
        console.warn(`[tts] ${member.name} unavailable (${m.slice(0, 120)}), trying next model`);
      }
    }
    throw lastErr;
  }
}
