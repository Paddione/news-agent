import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "@dna/sdk";
import type { Finding, Item } from "../src/db/repos/news.ts";
import {
  fauxTracker,
  ghTracker,
  issueFor,
  IssueTrackerError,
  type ExecFile,
} from "../src/news/issues.ts";

const URL = "https://github.com/Paddione/dotfiles/issues/153";

function stub(answer: { stdout?: string; stderr?: string; code?: number } = {}) {
  const calls: { file: string; args: string[]; input?: string }[] = [];
  const exec: ExecFile = async (file, args, input) => {
    calls.push({ file, args, input });
    if (args[0] === "label") return { stdout: "", stderr: "", code: 0 };
    return {
      stdout: answer.stdout ?? `${URL}\n`,
      stderr: answer.stderr ?? "",
      code: answer.code ?? 0,
    };
  };
  return { exec, calls };
}

const input = { title: "Laya guard", body: "body text", labels: ["news-card"] };

test("ghTracker: creates the label once, passes the body on stdin, parses the number", async () => {
  const { exec, calls } = stub();
  const tracker = ghTracker("Paddione/dotfiles", exec);
  assert.deepEqual(await tracker.create(input), { number: 153, url: URL });
  await tracker.create(input);
  assert.deepEqual(
    calls.map((c) => [c.file, ...c.args].join(" ")),
    [
      "gh label create news-card -R Paddione/dotfiles --force",
      "gh issue create -R Paddione/dotfiles --title=Laya guard --body-file - --label news-card",
      "gh issue create -R Paddione/dotfiles --title=Laya guard --body-file - --label news-card",
    ],
  );
  assert.equal(calls[1].input, "body text");
});

test("ghTracker: failures and unexpected output are IssueTrackerErrors", async () => {
  const failing = ghTracker(
    "Paddione/dotfiles",
    stub({ code: 1, stderr: "HTTP 401: Bad credentials" }).exec,
  );
  await assert.rejects(
    failing.create(input),
    (e) => e instanceof IssueTrackerError && /HTTP 401/.test(e.message),
  );
  const odd = ghTracker("Paddione/dotfiles", stub({ stdout: "ok\n" }).exec);
  await assert.rejects(
    odd.create(input),
    (e) => e instanceof IssueTrackerError && /unexpected/.test(e.message),
  );
});

test("fauxTracker numbers issues and records them", async () => {
  const faux = fauxTracker("Paddione/dotfiles");
  assert.equal((await faux.create(input)).number, 1);
  const second = await faux.create(input);
  assert.deepEqual(second, { number: 2, url: "https://github.com/Paddione/dotfiles/issues/2" });
  assert.equal(faux.created.length, 2);
});

const card = {
  id: 253,
  kind: "news",
  component: "signal_alert",
  props: {
    title: "Laya guard gates commands",
    why: "It checks each command locally before it runs",
  },
  title: "Laya guard gates commands",
  url: "https://example.dev/laya",
  discussionUrl: "https://news.ycombinator.com/item?id=1",
  publishedAt: "2026-10-19T10:00:00Z",
  topic: "agent sandboxing",
  group: "agent-security",
  hfs: {
    hype: 14,
    facts: 89,
    signal: 74,
    primary: "facts",
    labels: [],
    ranked: [],
    suspectCombo: false,
  },
} as unknown as Card;
const item = {
  id: 9,
  url: "https://example.dev/laya",
  title: "Laya",
  sourceName: "Hacker News",
} as Item;
const finding = (summary: string): Finding => ({
  id: 1,
  itemId: 9,
  summary,
  claims: ["runs locally"],
  evidence: ["https://example.dev/laya#how"],
  claimSupport: [{ claim: "runs locally", supported: 1 }],
  createdAt: "2026-10-19T10:00:00Z",
});

test("issueFor: title, labels and the body sections", () => {
  const issue = issueFor(
    card,
    item,
    [finding("First finding"), finding("Second finding")],
    "check our hooks",
    "news-card",
  );
  assert.equal(issue.title, "Laya guard gates commands");
  assert.deepEqual(issue.labels, ["news-card", "group:agent-security"]);
  for (const part of [
    "## Note",
    "check our hooks",
    "https://example.dev/laya",
    "https://news.ycombinator.com/item?id=1",
    "H 14 F 89 S 74",
    "agent sandboxing",
    "card 253",
    "First finding",
    "Second finding",
    "https://example.dev/laya#how",
    "untrusted",
  ])
    assert.ok(issue.body.includes(part), part);
  const bare = issueFor(
    { ...card, group: undefined, title: "x".repeat(300) } as Card,
    item,
    [],
    undefined,
    "news-card",
  );
  assert.ok(!bare.body.includes("## Note"));
  assert.deepEqual(bare.labels, ["news-card"]);
  assert.equal(bare.title.length, 120);
});
