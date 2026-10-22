import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decide, ScoreAnswer, SystemOneResult } from "@dna/jev";
import {
  buildNeedBundle,
  evaluateNeed,
  EXCERPT_MAX,
  NEED_EVIDENCE_TERM_CAP,
  NEED_LABEL,
  NEED_MAX_ATTEMPTS,
  REPORT_MAX,
  runNeedGate,
  type NeedEvidence,
} from "../src/news/need.ts";
import { fauxGraph, type CodeGraph } from "../src/news/graph.ts";
import { fauxTracker } from "../src/news/issues.ts";

const long = (n: number, ch = "x") => ch.repeat(n);

function scoreResult(score: number, topLevel = "3"): SystemOneResult {
  const answer: ScoreAnswer = {
    type: "score",
    score,
    confidence: 0.8,
    legend: { 0: "none", 1: "weak", 2: "moderate", 3: "strong", 4: "compelling" },
    probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, [topLevel]: 1 },
  };
  return {
    model: "mock",
    answers: { need: answer },
    usage: { input_tokens: 1, output_tokens: 1 },
    raw: {
      request: { state: {}, questions: {} },
      requestText: "{}",
      response: { model: "mock", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
      responseText: "{}",
    },
    meta: {
      provider: "mock",
      requestedModel: "mock",
      resolvedModel: "mock",
      elapsedMs: 1,
      attempts: 1,
      cost: { amount: 0, source: "mock" },
    },
  };
}

const decideScore =
  (score: number): Decide =>
  async () =>
    scoreResult(score);

const evidence = (over: Partial<NeedEvidence> = {}): NeedEvidence => ({
  project: "home-patrick-news-agent",
  report: "report",
  targets: ["home-patrick-news-agent"],
  overview: "overview",
  symbols: [],
  searches: [],
  receipt: { project: "home-patrick-news-agent", refreshedAt: "2026-10-22T00:00:00.000Z" },
  ...over,
});

test("bundle clips report and excerpts to bounds", async () => {
  const graph = fauxGraph(["home-patrick-news-agent"]);
  const bundle = await buildNeedBundle(graph, {
    project: "home-patrick-news-agent",
    reportMd: long(REPORT_MAX + 500),
    targets: ["home-patrick-news-agent"],
    terms: ["investigation", "report"],
    now: () => "2026-10-22T00:00:00.000Z",
  });
  assert.equal(bundle.status, "ready");
  if (bundle.status === "ready") {
    assert.ok(bundle.evidence.report.length <= REPORT_MAX + 30);
    assert.ok(bundle.evidence.report.includes("more chars"));
    assert.ok(bundle.evidence.overview.length <= EXCERPT_MAX + 30);
    assert.equal(bundle.evidence.receipt.project, "home-patrick-news-agent");
    assert.equal(bundle.evidence.receipt.refreshedAt, "2026-10-22T00:00:00.000Z");
  }
});

test("bundle degrades a failing symbol lookup to an empty excerpt while search works", async () => {
  const graph: CodeGraph = {
    ...fauxGraph(["p"]),
    async symbol() {
      throw new Error('symbol not found. Use search_graph(name_pattern="...") first');
    },
  };
  const bundle = await buildNeedBundle(graph, {
    project: "p",
    reportMd: "r",
    targets: ["p"],
    terms: ["missing-thing"],
    now: () => "t",
  });
  assert.equal(bundle.status, "ready");
  if (bundle.status === "ready") {
    assert.deepEqual(bundle.evidence.symbols, ['(no symbol excerpt for "missing-thing")']);
    assert.ok(bundle.evidence.searches.length === 1);
  }
});

test("bundle caps symbol/search terms", async () => {
  const calls: string[] = [];
  const base = fauxGraph(["p"]);
  const graph: CodeGraph = {
    ...base,
    async symbol(project, name) {
      calls.push(`symbol:${name}`);
      return base.symbol(project, name);
    },
    async search(project, pattern) {
      calls.push(`search:${pattern}`);
      return base.search(project, pattern);
    },
  };
  const terms = ["a", "b", "c", "d", "e", "f"];
  const bundle = await buildNeedBundle(graph, {
    project: "p",
    reportMd: "r",
    targets: ["p"],
    terms,
    now: () => "t",
  });
  assert.equal(bundle.status, "ready");
  assert.ok(calls.length <= NEED_EVIDENCE_TERM_CAP * 2, calls.join(","));
});

test("bundle rejects projects outside the allow-list as unknown", async () => {
  const allowListed: CodeGraph = {
    async projects() {
      return [{ name: "other", root: "/repos/other" }];
    },
    async refresh() {},
    async search() {
      throw new Error('Project "x" is not in the allowed list: other');
    },
    async symbol() {
      throw new Error('Project "x" is not in the allowed list: other');
    },
    async overview() {
      throw new Error('Project "x" is not in the allowed list: other');
    },
  };
  const bundle = await buildNeedBundle(allowListed, {
    project: "x",
    reportMd: "r",
    targets: ["x"],
    terms: ["t"],
    now: () => "t",
  });
  assert.equal(bundle.status, "unknown");
  if (bundle.status === "unknown") assert.match(bundle.reason, /allow/i);
});

test("bundle returns unknown when the receipt is stale or missing", async () => {
  const missing: CodeGraph = {
    async projects() {
      return [];
    },
    async refresh() {
      throw new Error("should not refresh without a receipt");
    },
    async search() {
      throw new Error("unreached");
    },
    async symbol() {
      throw new Error("unreached");
    },
    async overview() {
      throw new Error("unreached");
    },
  };
  const noReceipt = await buildNeedBundle(missing, {
    project: "ghost",
    reportMd: "r",
    targets: ["ghost"],
    terms: ["t"],
    now: () => "t",
  });
  assert.equal(noReceipt.status, "unknown");

  const stale: CodeGraph = {
    ...fauxGraph(["p"]),
    async refresh() {
      throw new Error("index stale");
    },
  };
  const staleReceipt = await buildNeedBundle(stale, {
    project: "p",
    reportMd: "r",
    targets: ["p"],
    terms: ["t"],
    now: () => "t",
  });
  assert.equal(staleReceipt.status, "unknown");
  if (staleReceipt.status === "unknown") assert.match(staleReceipt.reason, /stale|refresh/i);
});

test("evaluateNeed scores a ready bundle and names the top level", async () => {
  const out = await evaluateNeed(decideScore(3.5), evidence());
  assert.equal(out.status, "scored");
  if (out.status === "scored") {
    assert.equal(out.score, 0.875);
    assert.equal(out.verdict, "ready");
    assert.ok(out.reason.includes("0.88") || out.reason.includes("0.875"));
    assert.ok(out.reason.includes("strong"));
  }
  const low = await evaluateNeed(decideScore(0.3), evidence());
  assert.equal(low.status, "scored");
  if (low.status === "scored") assert.equal(low.verdict, "triage");
});

test("evaluateNeed answers unknown on a non-score answer, never as zero", async () => {
  const bad: Decide = async () => {
    const r = scoreResult(0);
    r.answers = { need: { type: "noul", noul: 0.9 } };
    return r;
  };
  const out = await evaluateNeed(bad, evidence());
  assert.equal(out.status, "unknown");
});

test("gate posts score plus reason and labels ready-to-plan at threshold", async () => {
  const tracker = fauxTracker("Paddione/dotfiles");
  const out = await runNeedGate(
    {
      issues: tracker,
      graph: fauxGraph(["home-patrick-news-agent"]),
      decide: decideScore(2.8),
      allowed: ["home-patrick-news-agent"],
    },
    {
      repo: "Paddione/dotfiles",
      number: 1,
      title: "Add local issue investigation",
      reportMd: "## Kurzfazit\nAdopt it.",
      targets: ["home-patrick-news-agent"],
    },
  );
  assert.equal(out.status, "ready");
  const issue = tracker.issues.get(1)!;
  assert.equal(issue.comments.length, 1);
  assert.ok(issue.comments[0].includes("Need-Score 0.70"));
  assert.ok(issue.comments[0].includes("Schwelle"));
  assert.ok(issue.labels.includes(NEED_LABEL));
});

test("gate below threshold comments but leaves the issue in triage", async () => {
  const tracker = fauxTracker("Paddione/dotfiles");
  const out = await runNeedGate(
    {
      issues: tracker,
      graph: fauxGraph(["home-patrick-news-agent"]),
      decide: decideScore(0.4),
      allowed: ["home-patrick-news-agent"],
    },
    {
      repo: "Paddione/dotfiles",
      number: 2,
      title: "Nice to have someday",
      reportMd: "## Kurzfazit\nMaybe later.",
      targets: ["home-patrick-news-agent"],
    },
  );
  assert.equal(out.status, "triage");
  const issue = tracker.issues.get(2)!;
  assert.equal(issue.comments.length, 1);
  assert.ok(!issue.labels.includes(NEED_LABEL));
});

test("gate retries a failing judge with cap, comments failure, never scores zero", async () => {
  const tracker = fauxTracker("Paddione/dotfiles");
  let calls = 0;
  const down: Decide = async () => {
    calls++;
    throw new Error("local judge HTTP 500 on /completion");
  };
  const out = await runNeedGate(
    {
      issues: tracker,
      graph: fauxGraph(["home-patrick-news-agent"]),
      decide: down,
      allowed: ["home-patrick-news-agent"],
    },
    {
      repo: "Paddione/dotfiles",
      number: 3,
      title: "Judge is down",
      reportMd: "## Kurzfazit\nReport.",
      targets: ["home-patrick-news-agent"],
    },
  );
  assert.equal(out.status, "unknown");
  assert.equal(calls, NEED_MAX_ATTEMPTS);
  const issue = tracker.issues.get(3)!;
  assert.ok(!issue.labels.includes(NEED_LABEL));
  assert.ok(
    issue.comments.some((c) => c.includes(`Versuch ${NEED_MAX_ATTEMPTS}/${NEED_MAX_ATTEMPTS}`)),
  );
  assert.ok(issue.comments.every((c) => !c.includes("Need-Score 0.00")));
});

test("gate on a stale graph retries, then reports unknown without a label", async () => {
  const tracker = fauxTracker("Paddione/dotfiles");
  const stale: CodeGraph = {
    ...fauxGraph(["home-patrick-news-agent"]),
    async refresh() {
      throw new Error("index stale");
    },
  };
  const out = await runNeedGate(
    { issues: tracker, graph: stale, decide: decideScore(4), allowed: ["home-patrick-news-agent"] },
    {
      repo: "Paddione/dotfiles",
      number: 4,
      title: "Stale graph",
      reportMd: "## Kurzfazit\nReport.",
      targets: ["home-patrick-news-agent"],
    },
  );
  assert.equal(out.status, "unknown");
  const issue = tracker.issues.get(4)!;
  assert.ok(!issue.labels.includes(NEED_LABEL));
  assert.ok(issue.comments.length >= 1);
});

test("gate skips issues with no graph-backed target and calls no judge", async () => {
  const tracker = fauxTracker("Paddione/dotfiles");
  let calls = 0;
  const decide: Decide = async () => {
    calls++;
    return scoreResult(4);
  };
  const out = await runNeedGate(
    { issues: tracker, graph: fauxGraph(["home-patrick-news-agent"]), decide, allowed: [] },
    {
      repo: "Paddione/dotfiles",
      number: 5,
      title: "No target",
      reportMd: "## Kurzfazit\nReport.",
      targets: ["unknown-repo"],
    },
  );
  assert.equal(out.status, "skipped");
  assert.equal(calls, 0);
  assert.equal(tracker.issues.get(5)?.comments.length ?? 0, 0);
});
