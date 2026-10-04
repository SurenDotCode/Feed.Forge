/**
 * Turn a long AI image prompt or narration line into short stock-photo search
 * queries without an LLM call ("A lone student studying late at night under a
 * warm desk lamp, cinematic lighting" → "lone student studying late").
 */
const STOP = new Set(
  (
    "a an the and or but of to in on at for with from by is are was were be been being it its this that these those " +
    "as into onto over under above below about through between while during after before than then so very just " +
    "their there they them his her he she we you your our my i me us who whom which what when where why how " +
    "has have had do does did not no can could would should will shall may might must also only each every any some " +
    // prompt / photography jargon that hurts stock search
    "image photo photograph picture shot scene frame view close closeup close-up wide angle macro aerial overhead " +
    "cinematic cinematography lighting light lit glow glowing soft hard warm cool dramatic moody atmospheric " +
    "background foreground composition style styled aesthetic detailed highly ultra realistic photorealistic hyperrealistic " +
    "render rendered 4k 8k hd high quality resolution depth field bokeh vertical portrait orientation format " +
    "showing shows depicting depicts featuring features illustrating capturing captured visual visually tone toned " +
    "color colors colour colours palette vibrant muted subtle dark bright golden hour film grain looking"
    + " most many few more less like make makes made get gets got one two three first second last never always ever here even still actually really things thing way ways"
  ).split(/\s+/),
);

export function stockKeywords(text: string, max: number): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, max).join(" ");
}

/** Ordered, de-duplicated stock queries: specific first, then broader */
export function stockQueries(visualPrompt: string, scriptLine: string): string[] {
  const qs = [
    stockKeywords(visualPrompt, 4),
    stockKeywords(visualPrompt, 2),
    stockKeywords(scriptLine, 3),
    stockKeywords(scriptLine, 1),
  ].filter((q) => q.length > 0);
  return [...new Set(qs)];
}
