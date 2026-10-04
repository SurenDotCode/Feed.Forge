import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BaseLLM } from "./base.js";
import { FallbackLLM } from "./fallback.js";
import { FallbackTTS } from "../tts/fallback.js";

const schema = z.object({ ok: z.boolean() });
const req = { systemPrompt: "s", userMessage: "u", schema };

function member(name: string, impl: () => Promise<unknown>) {
  const llm = { maxRetries: 2, generate: vi.fn(impl) } as unknown as BaseLLM;
  return { name, llm };
}
const ok = async () => ({ data: { ok: true }, usage: { inputTokens: 1, outputTokens: 1 } });

describe("FallbackLLM", () => {
  it("moves past quota and overload errors to the next model", async () => {
    const a = member("quota-model", async () => { throw new Error("429 You exceeded your current quota"); });
    const b = member("busy-model", async () => { throw new Error("This model is currently experiencing high demand"); });
    const c = member("good-model", ok);
    const chain = new FallbackLLM([a, b, c]);
    const switches: string[] = [];
    chain.onSwitch = (from, to, reason) => switches.push(`${from}>${to}:${reason}`);

    const r = await chain.generate(req);

    expect(r.data).toEqual({ ok: true });
    expect(switches).toEqual(["quota-model>busy-model:quota reached", "busy-model>good-model:overloaded"]);
  });

  it("skips a model that ran out of quota on later calls (cool-down)", async () => {
    const a = member("cooldown-a", async () => { throw new Error("RESOURCE_EXHAUSTED quota"); });
    const b = member("cooldown-b", ok);
    const chain = new FallbackLLM([a, b]);
    await chain.generate(req);
    await chain.generate(req);
    expect(a.llm.generate).toHaveBeenCalledTimes(1);
    expect(b.llm.generate).toHaveBeenCalledTimes(2);
  });

  it("does not hide real errors such as an invalid API key", async () => {
    const a = member("auth-a", async () => { throw new Error("API key not valid. Please pass a valid API key."); });
    const b = member("auth-b", ok);
    await expect(new FallbackLLM([a, b]).generate(req)).rejects.toThrow("API key not valid");
    expect(b.llm.generate).not.toHaveBeenCalled();
  });

  it("throws the last error when every model is exhausted", async () => {
    const a = member("all-a", async () => { throw new Error("429 quota"); });
    const b = member("all-b", async () => { throw new Error("429 quota exceeded for b"); });
    await expect(new FallbackLLM([a, b]).generate(req)).rejects.toThrow("quota exceeded for b");
  });

  it("disables per-request HTTP retries except on the last model", () => {
    const a = member("r-a", ok), b = member("r-b", ok), c = member("r-c", ok);
    new FallbackLLM([a, b, c]);
    expect([a.llm.maxRetries, b.llm.maxRetries, c.llm.maxRetries]).toEqual([0, 0, 1]);
  });
});

describe("FallbackTTS", () => {
  it("uses the next voice model when one is out of quota", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const audio = Buffer.from("x");
    const tts = new FallbackTTS([
      { name: "tts-a", tts: { generate: async () => { throw new Error("429 quota"); } } },
      { name: "tts-b", tts: { generate: async () => ({ audio, words: [] }) } },
    ]);
    expect((await tts.generate("hi")).audio).toBe(audio);
  });

  it("rethrows non-quota errors", async () => {
    const tts = new FallbackTTS([
      { name: "tts-a", tts: { generate: async () => { throw new Error("Gemini TTS returned no audio data"); } } },
      { name: "tts-b", tts: { generate: async () => ({ audio: Buffer.from("x"), words: [] }) } },
    ]);
    await expect(tts.generate("hi")).rejects.toThrow("no audio data");
  });
});
