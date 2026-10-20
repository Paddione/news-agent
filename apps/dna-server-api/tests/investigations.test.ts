import assert from "node:assert/strict";
import { test } from "node:test";
import { tempStore } from "./helpers.ts";
import { seedCard } from "./card-issues.test.ts";
import {
  parseReport,
  renderReport,
  targetLabels,
  ReportError,
  type InvestigationReport,
} from "../src/news/investigation-report.ts";

test("investigations repository: lifecycle, limits and card join", () => {
  const { store, cleanup } = tempStore();
  try {
    const repo = "Paddione/dotfiles";
    const number = 153;

    // enqueue is idempotent per issue
    const first = (store as any).investigations.enqueue(repo, number);
    assert.equal(first.created, true);
    assert.equal(first.row.status, "queued");
    assert.equal(first.row.attempts, 0);

    const second = (store as any).investigations.enqueue(repo, number);
    assert.equal(second.created, false);
    assert.equal(second.row.status, "queued");

    // running() finds running row
    assert.equal((store as any).investigations.running(), undefined);

    // start sets running, route, model, startedAt, attempts + 1
    const started = (store as any).investigations.start(repo, number, "local", "model-a");
    assert.equal(started.status, "running");
    assert.equal(started.route, "local");
    assert.equal(started.model, "model-a");
    assert.equal(started.attempts, 1);
    assert.ok(started.startedAt);

    const running = (store as any).investigations.running();
    assert.ok(running);
    assert.equal(running.repo, repo);
    assert.equal(running.number, number);

    // fail returns to queued below 3 attempts
    const failed1 = (store as any).investigations.fail(repo, number, "transient error");
    assert.equal(failed1.status, "queued");
    assert.equal(failed1.error, "transient error");

    // start again (attempt 2)
    (store as any).investigations.start(repo, number, "local", "model-a");
    const failed2 = (store as any).investigations.fail(repo, number, "second error");
    assert.equal(failed2.status, "queued");

    // start again (attempt 3) -> fail at 3 sets failed
    (store as any).investigations.start(repo, number, "local", "model-a");
    const failed3 = (store as any).investigations.fail(repo, number, "third error");
    assert.equal(failed3.status, "failed");
    assert.equal(failed3.attempts, 3);

    // retry resets to queued with attempts 0
    const retried = (store as any).investigations.retry(repo, number);
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempts, 0);

    // finish stores report, targets, comment URL
    (store as any).investigations.start(repo, number, "fallback", "fallback-model");
    const finished = (store as any).investigations.finish(repo, number, {
      reportMd: "## Kurzfazit\nAlles gut.",
      targets: ["home-patrick-news-agent"],
      commentUrl: "https://github.com/Paddione/dotfiles/issues/153#issuecomment-1",
    });
    assert.equal(finished.status, "done");
    assert.equal(finished.reportMd, "## Kurzfazit\nAlles gut.");
    assert.deepEqual(finished.targets, ["home-patrick-news-agent"]);
    assert.equal(
      finished.commentUrl,
      "https://github.com/Paddione/dotfiles/issues/153#issuecomment-1",
    );
    assert.ok(finished.finishedAt);

    // fallbacksToday counts fallback starts of the day
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((store as any).investigations.fallbacksToday(today), 1);
    assert.equal((store as any).investigations.fallbacksToday("2020-01-01"), 0);

    // card with an issue shows card().issue.investigation
    const { card } = seedCard(store, "Card with investigation");
    store.news.addCardIssue(card.id, {
      repo,
      number,
      url: "https://github.com/Paddione/dotfiles/issues/153",
    });

    const c = store.news.card(card.id);
    assert.ok(c?.issue);
    assert.deepEqual((c.issue as any).investigation, {
      status: "done",
      targets: ["home-patrick-news-agent"],
      commentUrl: "https://github.com/Paddione/dotfiles/issues/153#issuecomment-1",
      route: "fallback",
      model: "fallback-model",
    });

    const forCard = (store as any).investigations.forCard(card.id);
    assert.ok(forCard);
    assert.equal(forCard.repo, repo);
    assert.equal(forCard.number, number);
  } finally {
    cleanup();
  }
});

test("investigation report: parseReport validates schema, drops unknown targets, handles fences", () => {
  const allowed = ["home-patrick", "home-patrick-news-agent"];
  const valid = {
    summary: "Kurzfazit hier.",
    source: [{ claim: "Claim 1", evidence: ["https://example.com"] }],
    existing: [{ project: "home-patrick-news-agent", paths: ["src/a.ts"], note: "Has a" }],
    missing: ["Feature B"],
    proposal: "adopt",
    targets: ["home-patrick-news-agent", "unknown-repo"],
    reasoning: "Gute Idee.",
  };

  // Bare JSON
  const parsed1 = parseReport(JSON.stringify(valid), allowed);
  assert.equal(parsed1.summary, "Kurzfazit hier.");
  assert.deepEqual(parsed1.targets, ["home-patrick-news-agent"]); // unknown dropped

  // Fenced JSON
  const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
  const parsed2 = parseReport(fenced, allowed);
  assert.equal(parsed2.summary, "Kurzfazit hier.");

  // Missing field throws ReportError
  assert.throws(
    () => parseReport(JSON.stringify({ ...valid, summary: undefined }), allowed),
    ReportError,
  );

  // Proposal outside the four values throws ReportError
  assert.throws(
    () => parseReport(JSON.stringify({ ...valid, proposal: "invalid" }), allowed),
    ReportError,
  );

  // Invalid JSON throws ReportError
  assert.throws(() => parseReport("not json", allowed), ReportError);
});

test("investigation report: renderReport sections, proposal translations, footer and automatic search note", () => {
  const report: InvestigationReport = {
    summary: "Das ist die Zusammenfassung.",
    source: [{ claim: "Quelle A", evidence: ["https://source.dev"] }],
    existing: [
      { project: "home-patrick-news-agent", paths: ["apps/dna/test.ts"], note: "Bereits da" },
    ],
    missing: ["Fehlender Baustein"],
    proposal: "evaluate",
    targets: ["home-patrick-news-agent"],
    reasoning: "Muss geprüft werden.",
  };

  const md = renderReport(report, {
    route: "local",
    model: "Swift",
    date: "2026-10-20",
  });

  assert.ok(md.includes("## Kurzfazit"));
  assert.ok(md.includes("## Was die Quelle sagt"));
  assert.ok(md.includes("## Was wir schon haben"));
  assert.ok(md.includes("## Was fehlt"));
  assert.ok(md.includes("## Vorschlag"));
  assert.ok(md.includes("bewerten"));
  assert.ok(md.includes("apps/dna/test.ts"));
  assert.ok(md.includes("local"));
  assert.ok(md.includes("Swift"));
  assert.ok(md.includes("2026-10-20"));

  // Check section order
  const idx1 = md.indexOf("## Kurzfazit");
  const idx2 = md.indexOf("## Was die Quelle sagt");
  const idx3 = md.indexOf("## Was wir schon haben");
  const idx4 = md.indexOf("## Was fehlt");
  const idx5 = md.indexOf("## Vorschlag");
  assert.ok(idx1 < idx2 && idx2 < idx3 && idx3 < idx4 && idx4 < idx5);

  // With automaticRepoSearch
  const autoMd = renderReport(report, {
    route: "fallback",
    model: "openrouter/model",
    date: "2026-10-20",
    automaticRepoSearch: true,
  });
  assert.ok(autoMd.includes("automatische Suche, kein Abgleich durch das Modell"));
});

test("investigation report: targetLabels maps repos to labels", () => {
  const labels = targetLabels(["home-patrick", "home-patrick-news-agent"]);
  assert.deepEqual(labels, ["target:dotfiles", "target:news-agent"]);
});
