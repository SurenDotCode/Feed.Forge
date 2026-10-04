/// <reference lib="dom" />
import { continueRender, delayRender } from "remotion";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff2";
import merriweather700 from "@fontsource/merriweather/files/merriweather-latin-700-normal.woff2";
import merriweather900 from "@fontsource/merriweather/files/merriweather-latin-900-normal.woff2";
import montserrat700 from "@fontsource/montserrat/files/montserrat-latin-700-normal.woff2";
import montserrat900 from "@fontsource/montserrat/files/montserrat-latin-900-normal.woff2";
import oswald700 from "@fontsource/oswald/files/oswald-latin-700-normal.woff2";
import playfair400 from "@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2";
import playfair700 from "@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2";
import spaceGrotesk700 from "@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2";

/**
 * Fonts are bundled with the app (no Google Fonts download at render time),
 * so renders work offline and never fail because of a network hiccup.
 * If a font still fails to load, the render continues with the fallback stack.
 */

type FontFile = { family: string; weight: string; url: string };

const FILES: FontFile[] = [
  { family: "Montserrat", weight: "700", url: montserrat700 },
  { family: "Montserrat", weight: "900", url: montserrat900 },
  { family: "Inter", weight: "400", url: inter400 },
  { family: "Inter", weight: "500", url: inter500 },
  { family: "Inter", weight: "700", url: inter700 },
  { family: "Playfair Display", weight: "400", url: playfair400 },
  { family: "Playfair Display", weight: "700", url: playfair700 },
  { family: "Oswald", weight: "700", url: oswald700 },
  { family: "Merriweather", weight: "700", url: merriweather700 },
  { family: "Merriweather", weight: "900", url: merriweather900 },
  { family: "Space Grotesk", weight: "700", url: spaceGrotesk700 },
];

let started = false;

function loadAll(): void {
  if (started || typeof document === "undefined" || typeof FontFace === "undefined") return;
  started = true;
  for (const f of FILES) {
    const handle = delayRender(`Loading font ${f.family} ${f.weight}`, { timeoutInMilliseconds: 30_000 });
    const face = new FontFace(f.family, `url(${f.url}) format('woff2')`, { weight: f.weight, style: "normal" });
    face
      .load()
      .then(() => {
        (document.fonts as unknown as { add(f: FontFace): void }).add(face);
      })
      .catch((err: unknown) => {
        console.warn(`[fonts] ${f.family} ${f.weight} failed to load, using fallback: ${String(err)}`);
      })
      .finally(() => continueRender(handle));
  }
}

loadAll();

const stack = (family: string, fallback: string) => `"${family}", ${fallback}`;

const montserrat = stack("Montserrat", "Arial, Helvetica, sans-serif");
const inter = stack("Inter", "Arial, Helvetica, sans-serif");
const playfairDisplay = stack("Playfair Display", "Georgia, 'Times New Roman', serif");
const oswald = stack("Oswald", "Impact, 'Arial Narrow', sans-serif");
const merriweather = stack("Merriweather", "Georgia, 'Times New Roman', serif");
const spaceGrotesk = stack("Space Grotesk", "Arial, Helvetica, sans-serif");

export const CAPTION_FONTS = {
  montserrat,
  inter,
  playfairDisplay,
  oswald,
} as const;

/** Maps archetype textCardFont names to registered font families */
export const TEXT_CARD_FONTS: Record<string, string> = {
  Inter: inter,
  Merriweather: merriweather,
  "Space Grotesk": spaceGrotesk,
};
