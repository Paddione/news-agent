// Card images: keep a valid source og:image, otherwise generate one with the OpenAI Images API (OPENAI_API_KEY).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate } from "@dna/durable-agent";
import { HttpError, retryAfterMs, withRetry } from "@dna/sdk";
import type { Logger } from "@dna/sdk/node";
import type { Item } from "../db/repos/news.ts";
import type { Store } from "../db/store.ts";
import type { Http } from "./http.ts";
import { CARD_RENDER_MODEL, rasterize, renderCardSvg } from "./card-render.ts";
import { imageCandidates } from "./source-images.ts";
import { readFileSync } from "node:fs";

export interface ImageDeps {
  store: Store;
  http: Http;
  log?: Logger;
  dataDir: string;
  promptsDir: string;
  model: string;
  /** OpenAI key for image generation; without one, cards keep their source image or none. */
  openaiKey?: string;
  /** low, medium or high. Low is a few cents at most and fine for a card banner. */
  quality?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** Tests and faux mode write a placeholder instead of calling a model. */
  offline?: boolean;
}

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAYAAAA7KqwyAAAAGElEQVR42mNkYPhfz0AEYBxVSF+FDAwAAKkCBHsPl7IAAAAASUVORK5CYII=",
  "base64",
);

const OPENAI_IMAGES = "https://api.openai.com/v1/images/generations";

interface OpenAiImages {
  data?: { b64_json?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
}

/** gpt-image pricing per 1M tokens: text input $5, image input $8, image output $30. */
export function imageCost(usage: OpenAiImages["usage"]): number {
  if (!usage) return 0;
  const text = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0;
  const image = usage.input_tokens_details?.image_tokens ?? 0;
  return (text * 5 + image * 8 + (usage.output_tokens ?? 0) * 30) / 1_000_000;
}

export class Images {
  constructor(private readonly deps: ImageDeps) {}

  /** A usable source image, checked with a small GET: image content type, under 5 MB. */
  async sourceImage(url: string | undefined): Promise<string | undefined> {
    if (!url || !/^https?:\/\//.test(url)) return undefined;
    if (this.deps.offline) return url;
    try {
      const res = await this.deps.http.get(url, {
        headers: { accept: "image/*" },
        timeoutMs: 8000,
        maxBytes: 5 * 1024 * 1024,
      });
      const type = res.headers.get("content-type") ?? "";
      return type.startsWith("image/") ? res.url : undefined;
    } catch {
      return undefined;
    }
  }

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
        return this.deps.store.news.addImage({
          origin: "source",
          status: "ready",
          url,
          itemId: item.id,
        });
    }
    return undefined;
  }

  pending(itemId: number | undefined, prompt: string): number {
    return this.deps.store.news.addImage({
      origin: "generated",
      status: "pending",
      prompt,
      model: this.deps.model,
      itemId,
    });
  }

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
    this.deps.store.news.updateImage(id, {
      status: "ready",
      filePath: file,
      costUsd: 0,
      model: CARD_RENDER_MODEL,
    });
    return id;
  }

  prompt(input: { title: string; summary: string }): string {
    const template = readFileSync(
      join(this.deps.promptsDir, "images", "news-card", "PROMPT.md"),
      "utf8",
    );
    return renderTemplate(
      template,
      { title: input.title, summary: input.summary.slice(0, 400), accent: "#f386a1" },
      "images/news-card/PROMPT.md",
    ).trim();
  }

  /** Generate into data/images/<imageId>.jpg and mark the image ready (or failed). */
  async generate(
    imageId: number,
    prompt: string,
  ): Promise<{ ok: boolean; costUsd: number; error?: string }> {
    const dir = join(this.deps.dataDir, "images");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${imageId}.${this.deps.offline ? "png" : "jpg"}`);
    if (this.deps.offline) {
      writeFileSync(file, PLACEHOLDER_PNG);
      this.deps.store.news.updateImage(imageId, {
        status: "ready",
        filePath: file,
        costUsd: 0,
        model: "offline",
      });
      return { ok: true, costUsd: 0 };
    }
    const started = Date.now();
    const fail = (error: string, costUsd = 0) => {
      this.deps.store.news.updateImage(imageId, {
        status: "failed",
        error: error.slice(0, 500),
        costUsd,
      });
      this.deps.log?.warn("image.failed", { imageId, error, ms: Date.now() - started });
      return { ok: false, costUsd, error };
    };
    if (!this.deps.openaiKey) return fail("OPENAI_API_KEY is not set");
    const doFetch = this.deps.fetch ?? fetch;
    let body: OpenAiImages;
    try {
      body = await withRetry(
        async () => {
          const res = await doFetch(OPENAI_IMAGES, {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.deps.openaiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: this.deps.model,
              prompt,
              size: "1536x1024",
              quality: this.deps.quality ?? "low",
              n: 1,
              output_format: "jpeg",
              output_compression: 82,
            }),
            signal: AbortSignal.timeout(150_000),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new HttpError(res.status, `${res.status}: ${text.slice(0, 300)}`, {
              retryAfterMs: retryAfterMs(res.headers.get("retry-after")),
              body: text,
            });
          }
          return (await res.json()) as OpenAiImages;
        },
        {
          attempts: 3,
          onRetry: (r) =>
            this.deps.log?.warn("image.retry", {
              imageId,
              attempt: r.attempt,
              error: String(r.error),
            }),
        },
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    const data = body.data?.[0]?.b64_json;
    const costUsd = imageCost(body.usage);
    if (!data) return fail("No image returned", costUsd);
    writeFileSync(file, Buffer.from(data, "base64"));
    this.deps.store.news.updateImage(imageId, {
      status: "ready",
      filePath: file,
      costUsd,
      model: this.deps.model,
    });
    this.deps.log?.info("image.generated", {
      imageId,
      costUsd,
      ms: Date.now() - started,
      model: this.deps.model,
    });
    return { ok: true, costUsd };
  }
}
