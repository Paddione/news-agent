import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DnaError } from "@dna/sdk";
import { loadConfig } from "../src/config.ts";
import { tempStore } from "./helpers.ts";
import { bootServer, settledSweep } from "./server.ts";

export function seedCard(store: any, title: string) {
  const { item } = store.news.upsertItem({
    url: `https://x.dev/${encodeURIComponent(title)}`,
    title,
    excerpt: title,
  });
  const { card } = store.news.addCard({
    kind: "news",
    component: "brief",
    props: { title, summary: `${title} summary` },
    itemId: item.id,
    toolCallId: `call-${title}`,
  });
  return { card, item };
}

test("card issues: stored once per card and shown on the card", () => {
  const { store, cleanup } = tempStore();
  try {
    const { card } = seedCard(store, "Laya guard gates commands");
    assert.equal(store.news.card(card.id)?.issue, undefined);
    assert.equal(store.news.cardIssue(card.id), undefined);
    const url = "https://github.com/Paddione/dotfiles/issues/153";
    const issue = store.news.addCardIssue(card.id, {
      repo: "Paddione/dotfiles",
      number: 153,
      url,
      note: "check our hooks",
    });
    assert.deepEqual(
      { repo: issue.repo, number: issue.number, url: issue.url, note: issue.note },
      { repo: "Paddione/dotfiles", number: 153, url, note: "check our hooks" },
    );
    assert.ok(issue.createdAt);
    assert.deepEqual(store.news.card(card.id)?.issue, { number: 153, url });
    assert.deepEqual(store.news.cardIssue(card.id), issue);
    assert.throws(() =>
      store.news.addCardIssue(card.id, { repo: "Paddione/dotfiles", number: 154, url }),
    );
  } finally {
    cleanup();
  }
});

// The route through a real server with a stub gh on PATH: it fails while FAIL exists, else prints an issue URL.
test("POST /v1/cards/:id/issue: create once, reuse, validate, survive gh failures", async () => {
  const bin = mkdtempSync(join(tmpdir(), "gh-stub-"));
  const fail = join(bin, "FAIL");
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\ncat >/dev/null\n[ "$1" = label ] && exit 0\nif [ "$1" = issue ] && [ "$2" = list ]; then echo "[]"; exit 0; fi\nif [ "$1" = issue ] && [ "$2" = view ]; then echo '{"title":"Test Issue","body":"Test body"}'; exit 0; fi\nif [ "$1" = issue ] && [ "$2" = comment ]; then echo "https://github.com/Paddione/dotfiles/issues/1#issuecomment-1"; exit 0; fi\nif [ "$1" = issue ] && [ "$2" = edit ]; then exit 0; fi\nif [ -e "${fail}" ]; then echo "HTTP 401: Bad credentials" >&2; exit 1; fi\nn=$(($(cat "${bin}/n" 2>/dev/null || echo 0) + 1)); echo $n > "${bin}/n"\necho "https://github.com/Paddione/dotfiles/issues/$n"\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const s = await bootServer({
    FIRECRAWL_API_KEY: "",
    DNA_ISSUE_TRACKER: "gh",
    PATH: `${bin}:${process.env.PATH}`,
  });
  try {
    const started = await s.cron.newsSweep({ requestId: "issues:1" });
    await settledSweep(s.client, started.data.sweep!.id);
    const [a, b] = (await s.client.feed()).items;
    await assert.rejects(
      s.client.createIssue(a.id, { note: "x".repeat(2001) }),
      (e) => e instanceof DnaError && e.status === 400,
    );
    await assert.rejects(
      s.client.createIssue(999_999, {}),
      (e) => e instanceof DnaError && e.status === 404,
    );
    writeFileSync(fail, "");
    await assert.rejects(
      s.client.createIssue(a.id, { note: "check our hooks" }),
      (e) => e instanceof DnaError && e.status === 503 && /HTTP 401/.test(e.message),
    );
    assert.equal((await s.client.card(a.id)).card.issue, undefined);
    rmSync(fail);
    const first = await s.client.createIssue(a.id, { note: "check our hooks" });
    assert.deepEqual(
      { repo: first.repo, number: first.number, note: first.note },
      { repo: "Paddione/dotfiles", number: 1, note: "check our hooks" },
    );
    const firstCard = (await s.client.card(a.id)).card;
    assert.ok(firstCard.issue?.investigation);
    assert.ok(
      ["queued", "running", "done"].includes(firstCard.issue!.investigation.status),
    );
    const again = await s.client.createIssue(a.id, {});
    assert.equal(again.number, 1);
    const cardIssue = (await s.client.card(a.id)).card.issue;
    assert.equal(cardIssue?.number, 1);
    assert.equal(cardIssue?.url, "https://github.com/Paddione/dotfiles/issues/1");
    assert.ok(cardIssue?.investigation);
    assert.equal((await s.client.createIssue(b.id, {})).number, 2);
  } finally {
    await s.cleanup();
    rmSync(bin, { recursive: true, force: true });
  }
});

test("the tracker defaults to faux in fixture search mode", () => {
  assert.equal(loadConfig([], { DNA_SEARCH_MODE: "fixture" }).issueTracker, "faux");
  assert.equal(loadConfig([], { DNA_SEARCH_MODE: "web" }).issueTracker, "gh");
  assert.equal(
    loadConfig([], { DNA_SEARCH_MODE: "web", DNA_ISSUE_TRACKER: "faux" }).issueTracker,
    "faux",
  );
});

test("POST /v1/cards/:id/issue: with DNA_INVESTIGATE=off leaves no investigation row", async () => {
  const bin = mkdtempSync(join(tmpdir(), "gh-stub-"));
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\ncat >/dev/null\n[ "$1" = label ] && exit 0\necho "https://github.com/Paddione/dotfiles/issues/99"\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const s = await bootServer({
    FIRECRAWL_API_KEY: "",
    DNA_ISSUE_TRACKER: "gh",
    DNA_INVESTIGATE: "off",
    PATH: `${bin}:${process.env.PATH}`,
  });
  try {
    const started = await s.cron.newsSweep({ requestId: "issues:off:1" });
    await settledSweep(s.client, started.data.sweep!.id);
    const [a] = (await s.client.feed()).items;
    const issue = await s.client.createIssue(a.id, {});
    assert.equal(issue.number, 99);
    const cardA = (await s.client.card(a.id)).card;
    assert.equal(cardA.issue?.investigation, undefined);
  } finally {
    await s.cleanup();
    rmSync(bin, { recursive: true, force: true });
  }
});
