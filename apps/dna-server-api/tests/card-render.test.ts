import assert from "node:assert/strict";
import { test } from "node:test";
import { rasterize, renderCardSvg, wrapTitle } from "../src/news/card-render.ts";

test("wrapTitle breaks on words, caps at 4 lines and ends an overflow with an ellipsis", () => {
  assert.deepEqual(wrapTitle("Codex CLI adds durable sessions"), [
    "Codex CLI adds durable",
    "sessions",
  ]);
  const long = wrapTitle("word ".repeat(80));
  assert.equal(long.length, 4);
  assert.match(long[3], /…$/);
  assert.deepEqual(
    wrapTitle("x".repeat(40)),
    ["x".repeat(25) + "…"],
    "one word over maxChars is cut to maxChars - 1 plus …",
  );
});

test("renderCardSvg is deterministic, escapes text and colors by category", () => {
  const art = {
    title: "R&D <beta> ships 🚀",
    source: "github.com",
    topic: "agents",
    category: "signal" as const,
  };
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
