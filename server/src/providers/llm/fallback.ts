import type { z } from "zod";
import type { LLMProvider, LLMProviderKey, LLMResult } from "../../schema/providers.js";
import type { BaseLLM } from "./base.js";

/**
 * Tries several models in order. When a model is out of quota (429) or overloaded
 * (503 "high demand"), the request moves to the next model instead of failing.
 *
 * Free-tier quotas on the Gemini API are per model, so a chain of models gives a
 * free-tier key several independent daily allowances.
 *
 * A model that ran out of quota is skipped for a cool-down period, so later calls
 * don't waste requests (and time) on it.
 */

type Member = { name: string; llm: BaseLLM };

const coolDownUntil = new Map<string, number>();

function errorText(err: unknown): string {
  return String(err instanceof Error ? err.message : err).toLowerCase();
}

export function isQuotaErrorText(m: string): boolean {
  return m.includes("quota") || m.includes("resource_exhausted") || /\b429\b/.test(m) || m.includes("too many requests");
}

export function isOverloadedText(m: string): boolean {
  return m.includes("high demand") || m.includes("overloaded") || m.includes("unavailable") || /\b503\b/.test(m);
}

export function isUnavailableModelText(m: string): boolean {
  return m.includes("no longer available") || (m.includes("model") && m.includes("not found"));
}

/** Seconds from "Please retry in 41.8s" if present */
function retryAfterSeconds(m: string): number | null {
  const r = /retry in\s+([\d.]+)\s*s/.exec(m);
  return r ? Number(r[1]) : null;
}

export class FallbackLLM implements LLMProvider {
  readonly id: LLMProviderKey = "gemini";
  /** Called whenever the chain switches model (for job logs) */
  onSwitch?: (from: string, to: string, reason: string) => void;

  constructor(private readonly members: Member[]) {
    if (members.length === 0) throw new Error("FallbackLLM needs at least one model");
    // Fail fast inside a chain; the last model keeps one retry for transient errors
    members.forEach((m, i) => {
      m.llm.maxRetries = i === members.length - 1 ? 1 : 0;
    });
  }

  get models(): string[] {
    return this.members.map((m) => m.name);
  }

  async generate<T extends z.ZodType>(opts: {
    systemPrompt: string;
    userMessage: string;
    schema: T;
    enableWebSearch?: boolean;
  }): Promise<LLMResult<z.infer<T>>> {
    const now = Date.now();
    const ready = this.members.filter((m) => (coolDownUntil.get(m.name) ?? 0) <= now);
    // If every model is cooling down, try them all anyway (cool-downs are estimates)
    const order = ready.length > 0 ? ready : this.members;

    let lastErr: unknown;
    for (let i = 0; i < order.length; i++) {
      const member = order[i]!;
      try {
        return await member.llm.generate(opts);
      } catch (err) {
        lastErr = err;
        const m = errorText(err);
        let reason: string;
        if (isQuotaErrorText(m)) {
          const wait = retryAfterSeconds(m);
          // Per-minute limits say "retry in Ns"; daily limits don't → cool down longer
          coolDownUntil.set(member.name, Date.now() + (wait ? (wait + 2) * 1000 : 15 * 60_000));
          reason = "quota reached";
        } else if (isOverloadedText(m)) {
          reason = "overloaded";
        } else if (isUnavailableModelText(m)) {
          coolDownUntil.set(member.name, Date.now() + 24 * 3600_000);
          reason = "model unavailable for this key";
        } else {
          throw err; // a real error (bad schema, safety, auth) — don't mask it
        }
        const next = order[i + 1];
        if (next) this.onSwitch?.(member.name, next.name, reason);
      }
    }
    throw lastErr;
  }
}
