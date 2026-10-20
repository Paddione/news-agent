# P1 — Kartenbild ohne Modell

Spec: `design.md` §P1, D2, D3, D8. Arbeitsverzeichnis: `apps/dna-server-api`. Tests laufen mit `npx tsx --test tests/<datei>.test.ts`.

## Task 1: Quellbild-Kandidaten in `Images.resolve`

**Files:**
- Create: `apps/dna-server-api/src/news/source-images.ts`
- Modify: `apps/dna-server-api/src/news/images.ts` (Methode `resolve`, Zeilen 76–88)
- Test: `apps/dna-server-api/tests/images.test.ts` (neuer Test am Ende)

**Interfaces:**
- Produces:
  - `youtubeThumb(url: string): string | undefined`
  - `githubPreview(url: string): string | undefined`
  - `firstContentImage(md: string | undefined): string | undefined`
  - `imageCandidates(input: { url: string; imageUrl?: string; contentMd?: string }): string[]` in der Reihenfolge og:image, YouTube, GitHub, Markdown, ohne Duplikate
  - `Images.resolve(item)` probiert die Kandidaten der Reihe nach mit `sourceImage`.

- [ ] **Step 1: Write the failing test** (am Ende von `tests/images.test.ts`, Imports oben ergänzen)

```ts
import type { Http } from "../src/news/http.ts";
import { firstContentImage, githubPreview, imageCandidates, youtubeThumb } from "../src/news/source-images.ts";

/** Answers image/jpeg for urls containing "img-ok", text/html for everything else. */
const imageHttp = {
  get: async (url: string) => ({
    url,
    headers: new Headers({ "content-type": url.includes("img-ok") || url.includes("ytimg") || url.includes("githubassets") ? "image/jpeg" : "text/html" }),
  }),
} as unknown as Http;

test("source image candidates: og:image, YouTube, GitHub, first markdown image, skipping logos", () => {
  assert.equal(youtubeThumb("https://www.youtube.com/watch?v=OLqP8jxJ0Wc&t=3"), "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg");
  assert.equal(youtubeThumb("https://youtu.be/OLqP8jxJ0Wc"), "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg");
  assert.equal(youtubeThumb("https://www.youtube.com/shorts/OLqP8jxJ0Wc"), "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg");
  assert.equal(youtubeThumb("https://example.com/watch?v=x"), undefined);
  assert.equal(githubPreview("https://github.com/earendil-works/pi-durable/releases/tag/v1.1.0"), "https://opengraph.githubassets.com/1/earendil-works/pi-durable");
  assert.equal(githubPreview("https://github.com/orgs/foo/people"), undefined);
  assert.equal(firstContentImage("![logo](https://x.dev/logo.png) text ![chart](https://x.dev/img-ok/chart.png)"), "https://x.dev/img-ok/chart.png");
  assert.equal(firstContentImage(undefined), undefined);
  assert.deepEqual(
    imageCandidates({ url: "https://youtu.be/OLqP8jxJ0Wc", imageUrl: "https://x.dev/page.html", contentMd: "" }),
    ["https://x.dev/page.html", "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg"],
  );
});

test("resolve falls through an og:image that is not an image to the next candidate", async () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const images = new Images({ store, http: imageHttp, dataDir: dir, promptsDir: PROMPTS_DIR, model: "m" });
    const { item } = store.news.upsertItem({
      url: "https://github.com/earendil-works/pi-durable",
      title: "pi-durable 1.1.0",
      imageUrl: "https://x.dev/not-an-image.html",
    });
    const id = await images.resolve(item);
    const row = store.news.image(id!)!;
    assert.equal(row.origin, "source");
    assert.equal(row.url, "https://opengraph.githubassets.com/1/earendil-works/pi-durable");
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/images.test.ts`
Expected: FAIL with `Cannot find module '../src/news/source-images.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/dna-server-api/src/news/source-images.ts
// Image candidates beyond og:image: a YouTube thumbnail, a GitHub social preview, the first real image in the article.

const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
const GITHUB = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/;
const GITHUB_RESERVED = new Set(["orgs", "topics", "features", "marketplace", "settings", "login", "sponsors", "about", "collections", "trending", "explore"]);
const NOT_CONTENT = /logo|icon|avatar|pixel|1x1/i;

export function youtubeThumb(url: string): string | undefined {
  const m = url.match(YOUTUBE);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : undefined;
}

export function githubPreview(url: string): string | undefined {
  const m = url.match(GITHUB);
  if (!m || GITHUB_RESERVED.has(m[1])) return undefined;
  return `https://opengraph.githubassets.com/1/${m[1]}/${m[2].replace(/\.git$/, "")}`;
}

export function firstContentImage(md: string | undefined): string | undefined {
  for (const m of (md ?? "").matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/g))
    if (!NOT_CONTENT.test(m[1])) return m[1];
  return undefined;
}

export function imageCandidates(input: { url: string; imageUrl?: string; contentMd?: string }): string[] {
  const all = [input.imageUrl, youtubeThumb(input.url), githubPreview(input.url), firstContentImage(input.contentMd)];
  return [...new Set(all.filter((u): u is string => !!u))];
}
```

In `src/news/images.ts` den Import ergänzen und `resolve` ersetzen:
```ts
import { imageCandidates } from "./source-images.ts";
```
```ts
  /** Resolve an item's image now from the first usable candidate. Returns undefined when one must be made. */
  async resolve(item: Item): Promise<number | undefined> {
    const cached = item.cacheId ? this.deps.store.sources.cachedById(item.cacheId) : undefined;
    const candidates = imageCandidates({
      url: item.url,
      imageUrl: item.imageUrl ?? cached?.imageUrl,
      contentMd: cached?.contentMd,
    });
    for (const candidate of candidates) {
      const url = await this.sourceImage(candidate);
      if (url)
        return this.deps.store.news.addImage({ origin: "source", status: "ready", url, itemId: item.id });
    }
    return undefined;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/images.test.ts`
Expected: PASS (die 2 bestehenden und die 2 neuen Tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dna-server-api/src/news/source-images.ts apps/dna-server-api/src/news/images.ts apps/dna-server-api/tests/images.test.ts
git commit -m "feat(images): try YouTube, GitHub and in-article images before giving up on a source image"
```

## Task 2: Kartenbild rendern

**Files:**
- Create: `apps/dna-server-api/src/news/card-render.ts`
- Create: `apps/dna-server-api/assets/fonts/Inter-Regular.ttf`, `Inter-Bold.ttf`, `LICENSE.txt`
- Modify: `apps/dna-server-api/package.json` (Dependency)
- Test: `apps/dna-server-api/tests/card-render.test.ts`

**Interfaces:**
- Produces:
  - `CARD_RENDER_MODEL = "card-render@1"`
  - `interface CardArt { title: string; source: string; topic?: string; category?: HfsCategory }`
  - `wrapTitle(title: string, maxChars?: number, maxLines?: number): string[]`, Defaults 26 und 4
  - `renderCardSvg(art: CardArt): string`
  - `rasterize(svg: string): Buffer` liefert ein PNG mit 1536×1024.

- [ ] **Step 1: Abhängigkeit und Schrift**

```bash
cd apps/dna-server-api
npm install --save-exact @resvg/resvg-js@2.6.2
mkdir -p assets/fonts && cd assets/fonts
curl -fsSLO https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
unzip -l Inter-4.1.zip | grep -E 'Inter-(Regular|Bold)\.ttf|LICENSE'
unzip -j -o Inter-4.1.zip 'extras/ttf/Inter-Regular.ttf' 'extras/ttf/Inter-Bold.ttf' 'LICENSE.txt'
rm Inter-4.1.zip && ls
```
Expected: `Inter-Bold.ttf  Inter-Regular.ttf  LICENSE.txt`. Weichen die Pfade im Zip ab, die von `unzip -l` gezeigten Pfade nehmen.

- [ ] **Step 2: Write the failing test**

```ts
// apps/dna-server-api/tests/card-render.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { rasterize, renderCardSvg, wrapTitle } from "../src/news/card-render.ts";

test("wrapTitle breaks on words, caps at 4 lines and ends an overflow with an ellipsis", () => {
  assert.deepEqual(wrapTitle("Codex CLI adds durable sessions"), ["Codex CLI adds durable", "sessions"]);
  const long = wrapTitle("word ".repeat(80));
  assert.equal(long.length, 4);
  assert.match(long[3], /…$/);
  assert.deepEqual(wrapTitle("x".repeat(40)), ["x".repeat(25) + "…"], "one word over maxChars is cut to maxChars - 1 plus …");
});

test("renderCardSvg is deterministic, escapes text and colors by category", () => {
  const art = { title: "R&D <beta> ships 🚀", source: "github.com", topic: "agents", category: "signal" as const };
  const a = renderCardSvg(art);
  assert.equal(a, renderCardSvg(art));
  assert.match(a, /R&amp;D &lt;beta&gt; ships 🚀/);
  assert.match(a, /#f386a1/);
  assert.match(renderCardSvg({ ...art, category: "hype" }), /#f0a640/);
  assert.match(renderCardSvg({ ...art, category: undefined }), /#8a8f98/);
  assert.match(a, /github\.com · agents/);
});

test("rasterize yields a 1536x1024 PNG", () => {
  const png = rasterize(renderCardSvg({ title: "A", source: "s" }));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1536);
  assert.equal(png.readUInt32BE(20), 1024);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test tests/card-render.test.ts`
Expected: FAIL with `Cannot find module '../src/news/card-render.ts'`

- [ ] **Step 4: Write minimal implementation**

```ts
// apps/dna-server-api/src/news/card-render.ts
// A card image without an image model: the title on a dark panel with an H/F/S accent, rasterized by resvg with the
// bundled Inter so the PNG is the same on every machine.
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { HfsCategory } from "@dna/sdk";

export const CARD_RENDER_MODEL = "card-render@1";
const FONTS = join(import.meta.dirname, "../../assets/fonts");
const ACCENT: Record<HfsCategory, string> = { signal: "#f386a1", facts: "#57c48a", hype: "#f0a640" };
const NEUTRAL = "#8a8f98";

export interface CardArt {
  title: string;
  source: string;
  topic?: string;
  category?: HfsCategory;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
  const tspans = lines.map((l, i) => `<tspan x="120" dy="${i ? 108 : 0}">${esc(l)}</tspan>`).join("");
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test tests/card-render.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dna-server-api/src/news/card-render.ts apps/dna-server-api/tests/card-render.test.ts apps/dna-server-api/assets/fonts apps/dna-server-api/package.json package-lock.json
git commit -m "feat(images): render a deterministic card image with resvg and bundled Inter"
```

## Task 3: Fallback ohne Key rendert statt zu scheitern

**Files:**
- Modify: `apps/dna-server-api/src/news/images.ts` (neue Methoden `fallback`, `render`)
- Modify: `apps/dna-server-api/src/agents/tools/present.ts:37-46` (`imageFor`)
- Test: `apps/dna-server-api/tests/images.test.ts`

**Interfaces:**
- Consumes: `renderCardSvg`, `rasterize`, `CARD_RENDER_MODEL` (Task 2), `store.news.latestHfs(itemId)?.primary`.
- Produces:
  - `Images.fallback(item: Item | undefined, input: { title: string; summary: string }): number`: mit `openaiKey` ein `pending`-Bild (bisheriger Pfad), sonst `render`.
  - `Images.render(item: Item | undefined, title: string): number`: ein `ready`-Bild mit `origin: "generated"`, `model: CARD_RENDER_MODEL`, `cost_usd: 0` und Datei `data/images/<id>.png`.

- [ ] **Step 1: Write the failing test**

```ts
test("without a key a card image is rendered, not failed; with a key it is queued for generation", async () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const base = { store, http: fixtureHttp("news"), dataDir: dir, promptsDir: PROMPTS_DIR, model: "gpt-image-2.5-flare" };
    const { item } = store.news.upsertItem({ url: "https://openai.com/news/d", title: "D", sourceName: "openai.com" });
    const rendered = store.news.image(new Images(base).fallback(item, { title: "D", summary: "s" }))!;
    assert.equal(rendered.status, "ready");
    assert.equal(rendered.origin, "generated");
    assert.equal(rendered.costUsd, 0);
    assert.ok(rendered.filePath!.endsWith(".png") && existsSync(rendered.filePath!));
    const row = store.db.prepare("SELECT model FROM images WHERE id = ?").get(rendered.id) as { model: string };
    assert.equal(row.model, "card-render@1");
    const queued = store.news.image(new Images({ ...base, openaiKey: "sk-test" }).fallback(item, { title: "D", summary: "s" }))!;
    assert.equal(queued.status, "pending");
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/images.test.ts`
Expected: FAIL with `images.fallback is not a function` (TypeError)

- [ ] **Step 3: Write minimal implementation** (in `class Images`, nach `pending`)

```ts
import { CARD_RENDER_MODEL, rasterize, renderCardSvg } from "./card-render.ts";
```
```ts
  /** No source image: generate with OpenAI when a key is set, otherwise render one now. */
  fallback(item: Item | undefined, input: { title: string; summary: string }): number {
    if (this.deps.openaiKey) return this.pending(item?.id, this.prompt(input));
    return this.render(item, input.title);
  }

  /** A rendered card image, ready at once and free. Stored as generated so the schema needs no change. */
  render(item: Item | undefined, title: string): number {
    const id = this.deps.store.news.addImage({
      origin: "generated",
      status: "pending",
      model: CARD_RENDER_MODEL,
      itemId: item?.id,
    });
    const dir = join(this.deps.dataDir, "images");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${id}.png`);
    const svg = renderCardSvg({
      title,
      source: item?.sourceName ?? "Web",
      topic: item?.matchedTopic,
      category: item ? this.deps.store.news.latestHfs(item.id)?.primary : undefined,
    });
    writeFileSync(file, rasterize(svg));
    this.deps.store.news.updateImage(id, { status: "ready", filePath: file, costUsd: 0, model: CARD_RENDER_MODEL });
    return id;
  }
```

In `src/agents/tools/present.ts` die letzte Zeile von `imageFor` ersetzen:
```ts
  return deps.images.fallback(item, { title, summary });
```
`startImage` bleibt unverändert. Ein gerendertes Bild ist `ready`, deshalb wird keine `dna.image`-Task gestartet.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/images.test.ts tests/sweep-faux.test.ts tests/tools.test.ts`
Expected: PASS. In `sweep-faux` bleibt `cards.every((c) => c.image?.status === "ready")` grün, weil der Faux-Lauf ohne Key jetzt rendert.

- [ ] **Step 5: Commit**

```bash
git add apps/dna-server-api/src/news/images.ts apps/dna-server-api/src/agents/tools/present.ts apps/dna-server-api/tests/images.test.ts
git commit -m "feat(images): render card images when no OpenAI key is set instead of failing"
```

## Task 4: Backfill-Skript

**Files:**
- Create: `apps/dna-server-api/scripts/backfill-rendered-images.ts`
- Test: `apps/dna-server-api/tests/images.test.ts`

**Interfaces:**
- Consumes: `renderCardSvg`, `rasterize`, `CARD_RENDER_MODEL`.
- Produces: `backfillRendered(db: DatabaseSync, dataDir: string, dryRun: boolean): number[]` liefert die IDs der betroffenen Bilder. Die CLI ist `--db <pfad> [--dry-run]`. Sie öffnet die DB direkt mit `DatabaseSync`, nicht über `openStore`, weil der laufende Dienst die Lock-Datei hält.

- [ ] **Step 1: Write the failing test**

```ts
import { backfillRendered } from "../scripts/backfill-rendered-images.ts";

test("backfill renders every failed generated image and leaves others alone", () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const { item } = store.news.upsertItem({ url: "https://openai.com/news/e", title: "E", sourceName: "openai.com" });
    const failed = store.news.addImage({ origin: "generated", status: "failed", itemId: item.id, error: "OPENAI_API_KEY is not set" });
    const source = store.news.addImage({ origin: "source", status: "ready", url: "https://x.dev/a.png", itemId: item.id });
    assert.deepEqual(backfillRendered(store.db, dir, true), [failed]);
    assert.equal(store.news.image(failed)!.status, "failed", "dry run writes nothing");
    assert.deepEqual(backfillRendered(store.db, dir, false), [failed]);
    const row = store.news.image(failed)!;
    assert.equal(row.status, "ready");
    assert.ok(existsSync(row.filePath!));
    assert.equal(store.news.image(source)!.url, "https://x.dev/a.png");
    assert.deepEqual(backfillRendered(store.db, dir, false), [], "idempotent");
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/images.test.ts`
Expected: FAIL with `Cannot find module '../scripts/backfill-rendered-images.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/dna-server-api/scripts/backfill-rendered-images.ts
// Render a card image for every generated image that failed (no OpenAI key). Opens the db directly: the running
// service holds the store lock. Usage: node --import tsx scripts/backfill-rendered-images.ts --db <dna.sqlite> [--dry-run]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import type { HfsCategory } from "@dna/sdk";
import { CARD_RENDER_MODEL, rasterize, renderCardSvg } from "../src/news/card-render.ts";

interface Row {
  id: number;
  title: string | null;
  source: string | null;
  topic: string | null;
  category: HfsCategory | null;
}

export function backfillRendered(db: DatabaseSync, dataDir: string, dryRun: boolean): number[] {
  const rows = db
    .prepare(
      `SELECT im.id,
              COALESCE((SELECT json_extract(c.props_json, '$.title') FROM cards c WHERE c.image_id = im.id LIMIT 1), i.title) AS title,
              i.source_name AS source, i.matched_topic AS topic,
              (SELECT primary_category FROM classifications cl WHERE cl.item_id = i.id ORDER BY cl.id DESC LIMIT 1) AS category
         FROM images im LEFT JOIN items i ON i.id = im.item_id
        WHERE im.origin = 'generated' AND im.status = 'failed'
        ORDER BY im.id`,
    )
    .all() as unknown as Row[];
  if (dryRun) return rows.map((r) => r.id);
  const dir = join(dataDir, "images");
  mkdirSync(dir, { recursive: true });
  const update = db.prepare(
    "UPDATE images SET status = 'ready', file_path = ?, model = ?, cost_usd = 0, error = NULL WHERE id = ?",
  );
  for (const r of rows) {
    const file = join(dir, `${r.id}.png`);
    const svg = renderCardSvg({
      title: r.title ?? "Untitled",
      source: r.source ?? "Web",
      topic: r.topic ?? undefined,
      category: r.category ?? undefined,
    });
    writeFileSync(file, rasterize(svg));
    update.run(file, CARD_RENDER_MODEL, r.id);
  }
  return rows.map((r) => r.id);
}

function main() {
  const { values } = parseArgs({ options: { db: { type: "string" }, "dry-run": { type: "boolean" } } });
  if (!values.db) throw new Error("--db <path to dna.sqlite> is required");
  const ids = backfillRendered(new DatabaseSync(values.db), dirname(values.db), !!values["dry-run"]);
  console.log(`${values["dry-run"] ? "would render" : "rendered"} ${ids.length} images${ids.length ? `: ${ids.join(", ")}` : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

Die Bilder landen in `dirname(db)/images`, wo auch `Images` sie ablegt (`dataDir/images`). `images.get` liefert nur Dateien unter `config.dataDir`. Live ist das `~/news-agent-data/live`, also dasselbe Verzeichnis wie die DB.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/images.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dna-server-api/scripts/backfill-rendered-images.ts apps/dna-server-api/tests/images.test.ts
git commit -m "feat(images): add backfill script that renders previously failed card images"
```
