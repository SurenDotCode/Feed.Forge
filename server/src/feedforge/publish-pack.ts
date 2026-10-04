import { z } from "zod";
import type { DirectorScore } from "../schema/director-score.js";
import type { LLMProvider } from "../schema/providers.js";

export interface PublishPack {
  title: string;
  caption: string;
  hashtags: string[];
}

const PackSchema = z.object({
  title: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

const SYSTEM_PROMPT = `You write publish-ready metadata for short vertical videos on a social feed.
Return:
- title: a punchy title, max 70 characters, no hashtags, no quotes.
- caption: 1-3 short sentences (max 300 characters) that hook the viewer and match the video's narration. No hashtags inside the caption.
- hashtags: 5 to 8 relevant hashtags, each starting with #, no spaces inside a tag.`;

function cleanTag(tag: string): string | null {
  const body = tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return body.length >= 2 ? `#${body}` : null;
}

function normalise(pack: PublishPack, topic: string): PublishPack {
  const title = pack.title.replace(/["“”]/g, "").replace(/#\S+/g, "").trim().slice(0, 100) || topic.slice(0, 100);
  const caption = pack.caption.trim().slice(0, 600) || title;
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const raw of pack.hashtags) {
    const tag = cleanTag(raw);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      hashtags.push(tag);
    }
    if (hashtags.length === 8) break;
  }
  if (hashtags.length === 0) hashtags.push(...fallbackTags(topic));
  return { title, caption, hashtags };
}

const STOP = new Set(
  "a an the and or but of to in on at for with from by is are was were be how why what when who that this these those your you my our their it its into about than then as".split(
    " ",
  ),
);

function fallbackTags(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const tags = [...new Set(words)].slice(0, 5).map((w) => `#${w}`);
  return [...tags, "#shorts", "#qoneqt"].slice(0, 8);
}

/** Deterministic publish pack built from the script — used when the LLM is unavailable */
export function fallbackPack(topic: string, score: DirectorScore | null): PublishPack {
  const firstLine = score?.scenes[0]?.script_line ?? "";
  const title = topic.charAt(0).toUpperCase() + topic.slice(1);
  const caption = firstLine ? `${firstLine} Watch till the end.` : `Everything you need to know about ${topic}, in under a minute.`;
  return normalise({ title, caption, hashtags: fallbackTags(topic) }, topic);
}

/** Generate title, caption and hashtags from the final script. Never throws. */
export async function buildPublishPack(
  llm: LLMProvider | null,
  topic: string,
  score: DirectorScore | null,
  timeoutMs = 45_000,
): Promise<{ pack: PublishPack; usedFallback: boolean; error?: string }> {
  if (!llm || !score) return { pack: fallbackPack(topic, score), usedFallback: true };

  const narration = score.scenes.map((s, i) => `${i + 1}. ${s.script_line}`).join("\n");
  const userMessage = `Topic: ${topic}\nEmotional arc: ${score.emotional_arc}\n\nNarration:\n${narration}`;

  try {
    const result = await Promise.race([
      llm.generate({ systemPrompt: SYSTEM_PROMPT, userMessage, schema: PackSchema }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs)),
    ]);
    return { pack: normalise(result.data, topic), usedFallback: false };
  } catch (err) {
    return {
      pack: fallbackPack(topic, score),
      usedFallback: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
