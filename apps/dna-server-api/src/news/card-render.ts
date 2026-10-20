// A card image without an image model: the title on a dark panel with an H/F/S accent, rasterized by resvg with the
// bundled Inter so the PNG is the same on every machine.
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { HfsCategory } from "@dna/sdk";

export const CARD_RENDER_MODEL = "card-render@1";
const FONTS = join(import.meta.dirname, "../../assets/fonts");
const ACCENT: Record<HfsCategory, string> = {
  signal: "#f386a1",
  facts: "#57c48a",
  hype: "#f0a640",
};
const NEUTRAL = "#8a8f98";

export interface CardArt {
  title: string;
  source: string;
  topic?: string;
  category?: HfsCategory;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export function wrapTitle(title: string, maxChars = 26, maxLines = 4): string[] {
  const lines: string[] = [];
  let line = "";
  for (const raw of title.trim().split(/\s+/)) {
    const word = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw;
    if (!line) line = word;
    else if (`${line} ${word}`.length <= maxChars) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
  return kept;
}

export function renderCardSvg(art: CardArt): string {
  const accent = art.category ? ACCENT[art.category] : NEUTRAL;
  const lines = wrapTitle(art.title);
  const top = 512 - ((lines.length - 1) * 108) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="120" dy="${i ? 108 : 0}">${esc(l)}</tspan>`)
    .join("");
  const footer = [art.source, art.topic].filter(Boolean).join(" · ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">`,
    `<rect width="1536" height="1024" fill="#14161a"/>`,
    `<rect width="28" height="1024" fill="${accent}"/>`,
    `<text x="120" y="${top}" font-family="Inter" font-weight="700" font-size="92" fill="#f4f5f7">${tspans}</text>`,
    `<text x="120" y="952" font-family="Inter" font-size="40" fill="${accent}">${esc(footer)}</text>`,
    `</svg>`,
  ].join("");
}

export function rasterize(svg: string): Buffer {
  return new Resvg(svg, {
    font: {
      fontFiles: [join(FONTS, "Inter-Regular.ttf"), join(FONTS, "Inter-Bold.ttf")],
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
    },
  })
    .render()
    .asPng();
}
