import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { Images } from "../src/news/images.ts";
import { fixtureHttp } from "../src/news/fixtures.ts";
import { PROMPTS_DIR, tempStore } from "./helpers.ts";
import { backfillRendered } from "../scripts/backfill-rendered-images.ts";

test("a valid source og:image wins; otherwise OpenAI generates one and its cost is saved", async () => {
  const { store, dir, cleanup } = tempStore();
  try {
    let calls = 0;
    let sent: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls++;
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("jpg").toString("base64") }],
          usage: {
            input_tokens: 100,
            output_tokens: 400,
            input_tokens_details: { text_tokens: 100, image_tokens: 0 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const images = new Images({
      store,
      http: fixtureHttp("news"),
      dataDir: dir,
      promptsDir: PROMPTS_DIR,
      model: "gpt-image-2.5-flare",
      openaiKey: "sk-test",
      fetch: fakeFetch,
    });
    const { item } = store.news.upsertItem({
      url: "https://openai.com/news/a",
      title: "A",
      imageUrl: "https://cdn.fixture.dev/images/codex.png",
    });
    const sourceId = await images.resolve(item);
    assert.equal(store.news.image(sourceId!)!.origin, "source");
    const { item: bare } = store.news.upsertItem({ url: "https://openai.com/news/b", title: "B" });
    assert.equal(await images.resolve(bare), undefined);
    const prompt = images.prompt({ title: "B", summary: "about B" });
    assert.match(prompt, /No words, no letters/);
    const id = images.pending(bare.id, prompt);
    const result = await images.generate(id, prompt);
    assert.deepEqual(
      result,
      { ok: true, costUsd: 0.0125 },
      "100 text tokens at $5 plus 400 output tokens at $30 per 1M",
    );
    assert.equal(sent.model, "gpt-image-2.5-flare");
    assert.equal(sent.quality, "low");
    const row = store.news.image(id)!;
    assert.equal(row.status, "ready");
    assert.ok(existsSync(row.filePath!));
    assert.equal(calls, 1);
  } finally {
    cleanup();
  }
});

test("without an OpenAI key the image fails cleanly and the card keeps no image", async () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const images = new Images({
      store,
      http: fixtureHttp("news"),
      dataDir: dir,
      promptsDir: PROMPTS_DIR,
      model: "gpt-image-2.5-flare",
    });
    const { item } = store.news.upsertItem({ url: "https://openai.com/news/c", title: "C" });
    const id = images.pending(item.id, "a prompt");
    const result = await images.generate(id, "a prompt");
    assert.equal(result.ok, false);
    assert.match(result.error!, /OPENAI_API_KEY/);
    assert.equal(store.news.image(id)!.status, "failed");
  } finally {
    cleanup();
  }
});

import type { Http } from "../src/news/http.ts";
import {
  firstContentImage,
  githubPreview,
  imageCandidates,
  youtubeThumb,
} from "../src/news/source-images.ts";

/** Answers image/jpeg for urls containing "img-ok", text/html for everything else. */
const imageHttp = {
  get: async (url: string) => ({
    url,
    headers: new Headers({
      "content-type":
        url.includes("img-ok") || url.includes("ytimg") || url.includes("githubassets")
          ? "image/jpeg"
          : "text/html",
    }),
  }),
} as unknown as Http;

test("source image candidates: og:image, YouTube, GitHub, first markdown image, skipping logos", () => {
  assert.equal(
    youtubeThumb("https://www.youtube.com/watch?v=OLqP8jxJ0Wc&t=3"),
    "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg",
  );
  assert.equal(
    youtubeThumb("https://youtu.be/OLqP8jxJ0Wc"),
    "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg",
  );
  assert.equal(
    youtubeThumb("https://www.youtube.com/shorts/OLqP8jxJ0Wc"),
    "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg",
  );
  assert.equal(youtubeThumb("https://example.com/watch?v=x"), undefined);
  assert.equal(
    githubPreview("https://github.com/earendil-works/pi-durable/releases/tag/v1.1.0"),
    "https://opengraph.githubassets.com/1/earendil-works/pi-durable",
  );
  assert.equal(githubPreview("https://github.com/orgs/foo/people"), undefined);
  assert.equal(
    firstContentImage(
      "![logo](https://x.dev/logo.png) text ![chart](https://x.dev/img-ok/chart.png)",
    ),
    "https://x.dev/img-ok/chart.png",
  );
  assert.equal(firstContentImage(undefined), undefined);
  assert.deepEqual(
    imageCandidates({
      url: "https://youtu.be/OLqP8jxJ0Wc",
      imageUrl: "https://x.dev/page.html",
      contentMd: "",
    }),
    ["https://x.dev/page.html", "https://i.ytimg.com/vi/OLqP8jxJ0Wc/hqdefault.jpg"],
  );
});

test("resolve falls through an og:image that is not an image to the next candidate", async () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const images = new Images({
      store,
      http: imageHttp,
      dataDir: dir,
      promptsDir: PROMPTS_DIR,
      model: "m",
    });
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

test("without a key a card image is rendered, not failed; with a key it is queued for generation", async () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const base = {
      store,
      http: fixtureHttp("news"),
      dataDir: dir,
      promptsDir: PROMPTS_DIR,
      model: "gpt-image-2.5-flare",
    };
    const { item } = store.news.upsertItem({
      url: "https://openai.com/news/d",
      title: "D",
      sourceName: "openai.com",
    });
    const rendered = store.news.image(
      new Images(base).fallback(item, { title: "D", summary: "s" }),
    )!;
    assert.equal(rendered.status, "ready");
    assert.equal(rendered.origin, "generated");
    assert.equal(rendered.costUsd, 0);
    assert.ok(rendered.filePath!.endsWith(".png") && existsSync(rendered.filePath!));
    const row = store.db.prepare("SELECT model FROM images WHERE id = ?").get(rendered.id) as {
      model: string;
    };
    assert.equal(row.model, "card-render@1");
    const queued = store.news.image(
      new Images({ ...base, openaiKey: "sk-test" }).fallback(item, { title: "D", summary: "s" }),
    )!;
    assert.equal(queued.status, "pending");
  } finally {
    cleanup();
  }
});

test("backfill renders every failed generated image and leaves others alone", () => {
  const { store, dir, cleanup } = tempStore();
  try {
    const { item } = store.news.upsertItem({
      url: "https://openai.com/news/e",
      title: "E",
      sourceName: "openai.com",
    });
    const failed = store.news.addImage({
      origin: "generated",
      status: "failed",
      itemId: item.id,
      error: "OPENAI_API_KEY is not set",
    });
    const source = store.news.addImage({
      origin: "source",
      status: "ready",
      url: "https://x.dev/a.png",
      itemId: item.id,
    });
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
