// apps/shared/packages/jev/tests/local-live.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalJev, loadManifest } from "../src/local.ts";

test(
  "live local judge answers every question type",
  { skip: process.env.JEV_LIVE !== "1" },
  async () => {
    const jev = new LocalJev({
      baseUrl: process.env.JEV_LOCAL_BASE_URL ?? "http://127.0.0.1:8010",
      manifest: loadManifest(
        process.env.JEV_MANIFEST ?? "/mnt/f/models/news-judge/current/manifest.json",
      ),
    });
    await jev.init();
    const out = await jev.systemOne(
      {
        title: "llama.cpp b11609 adds Qwen3.8 MTP support",
        excerpt: "Release notes list the new flag --mtp.",
      },
      {
        ai: { type: "noul", instructions: "Is this about AI tooling?" },
        facts: {
          type: "score",
          instructions: "How checkable?",
          criteria: ["none", "some", "primary source"],
        },
      },
    );
    assert.equal(out.answers.ai.type, "noul");
    assert.equal(out.answers.facts.type, "score");
    assert.ok(out.meta.elapsedMs < 2000);
  },
);
