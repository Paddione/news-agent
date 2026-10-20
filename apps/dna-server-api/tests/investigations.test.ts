import assert from "node:assert/strict";
import { test } from "node:test";
import { tempStore, fauxApp, until } from "./helpers.ts";
import { seedCard } from "./card-issues.test.ts";
import { startInvestigation, investigateCatchup } from "../src/news/investigate.ts";
import { setFauxInvestigatorMode } from "../src/agents/faux-script.ts";
import { openApp } from "../src/runtime.ts";
import { workflowRoutes } from "../src/routes/workflows.ts";
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

test("investigation end to end: startInvestigation completes with comment and labels; second start does nothing", async () => {
  setFauxInvestigatorMode(undefined);
  const { app, cleanup } = await fauxApp();
  try {
    const fauxTrack = app.issues as any;
    const created = await fauxTrack.create({
      title: "Add local issue investigation",
      body: "Investigate how to connect news cards to github issues",
      labels: ["news-card"],
    });

    const started = await startInvestigation(app, app.issues.repo, created.number);
    assert.equal(started, true);

    await until(
      () =>
        app.store.investigations.get(app.issues.repo, created.number)?.status ===
        "done",
      15_000,
      "investigation done",
    );

    const row = app.store.investigations.get(app.issues.repo, created.number);
    assert.equal(row?.status, "done");
    assert.deepEqual(row?.targets, ["home-patrick-news-agent"]);
    assert.ok(row?.commentUrl);

    const issueView = await fauxTrack.view(created.number);
    assert.ok(!issueView.labels.includes("investigating"));
    assert.ok(issueView.labels.includes("investigated"));
    assert.ok(issueView.labels.includes("target:news-agent"));

    const issueObj = fauxTrack.issues.get(created.number);
    assert.equal(issueObj.comments.length, 1);
    assert.ok(issueObj.comments[0].includes("## Kurzfazit"));

    // Second startInvestigation for same issue returns false and does nothing
    const second = await startInvestigation(app, app.issues.repo, created.number);
    assert.equal(second, false);
    assert.equal(issueObj.comments.length, 1);
  } finally {
    await cleanup();
  }
});

test("investigation: invalid JSON twice results in failure comment and queued, then failed at 3 attempts", async () => {
  setFauxInvestigatorMode("invalid_json");
  const { app, cleanup } = await fauxApp();
  try {
    const fauxTrack = app.issues as any;
    const created = await fauxTrack.create({
      title: "Broken JSON issue",
      body: "This issue will cause invalid json",
      labels: ["news-card"],
    });

    // Run 1
    await startInvestigation(app, app.issues.repo, created.number);
    await until(
      () =>
        app.store.investigations.get(app.issues.repo, created.number)
          ?.status === "queued" &&
        (app.store.investigations.get(app.issues.repo, created.number)
          ?.attempts ?? 0) >= 1,
      15_000,
      "attempt 1 queued",
    );

    let row = app.store.investigations.get(app.issues.repo, created.number);
    assert.equal(row?.status, "queued");
    assert.equal(row?.attempts, 1);
    let issueView = await fauxTrack.view(created.number);
    assert.ok(!issueView.labels.includes("investigating"));
    assert.ok(!issueView.labels.includes("investigation-failed"));
    let issueObj = fauxTrack.issues.get(created.number);
    assert.equal(issueObj.comments.length, 1);
    assert.ok(
      issueObj.comments[0].includes(
        "Untersuchung fehlgeschlagen (Versuch 1/3)",
      ),
    );

    // Run 2
    await startInvestigation(app, app.issues.repo, created.number);
    await until(
      () =>
        app.store.investigations.get(app.issues.repo, created.number)
          ?.status === "queued" &&
        (app.store.investigations.get(app.issues.repo, created.number)
          ?.attempts ?? 0) >= 2,
      15_000,
      "attempt 2 queued",
    );
    row = app.store.investigations.get(app.issues.repo, created.number);
    assert.equal(row?.status, "queued");
    assert.equal(row?.attempts, 2);

    // Run 3 -> max attempts (3) -> status 'failed' and 'investigation-failed' label
    await startInvestigation(app, app.issues.repo, created.number);
    await until(
      () =>
        app.store.investigations.get(app.issues.repo, created.number)?.status ===
        "failed",
      15_000,
      "attempt 3 failed",
    );
    row = app.store.investigations.get(app.issues.repo, created.number);
    assert.equal(row?.status, "failed");
    assert.equal(row?.attempts, 3);
    issueView = await fauxTrack.view(created.number);
    assert.ok(issueView.labels.includes("investigation-failed"));
  } finally {
    setFauxInvestigatorMode(undefined);
    await cleanup();
  }
});

test("investigation: probe down + no fallback stays queued; with fallback model & stubbed http finishes with fallback; at cap stays queued", async () => {
  setFauxInvestigatorMode(undefined);
  const { app, cleanup } = await fauxApp();
  try {
    const fauxTrack = app.issues as any;
    const created1 = await fauxTrack.create({
      title: "Fallback test 1",
      body: "Test body",
      labels: ["news-card"],
    });

    // 1. Probe stubbed down and no fallback model -> stays queued
    app.investigateProbe = async () => false;
    app.config.investigateFallbackModel = undefined;

    await startInvestigation(app, app.issues.repo, created1.number);
    await new Promise((r) => setTimeout(r, 500));
    const row1 = app.store.investigations.get(app.issues.repo, created1.number);
    assert.equal(row1?.status, "queued");

    // 2. Fallback model configured and stubbed http -> finishes with fallback
    const created2 = await fauxTrack.create({
      title: "Fallback test 2: local down but fallback configured",
      body: "Testing fallback route",
      labels: ["news-card"],
    });
    app.config.investigateFallbackModel = "openrouter/research-model";
    app.http.postJson = async () => ({
      status: 200,
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: new Headers(),
      text: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Fallback report summary.",
                source: [{ claim: "Claim A", evidence: ["https://example.com"] }],
                existing: [],
                missing: ["None"],
                proposal: "adopt",
                targets: ["home-patrick-news-agent"],
                reasoning: "Fallback reasoning.",
              }),
            },
          },
        ],
      }),
    });

    await startInvestigation(app, app.issues.repo, created2.number);
    await until(
      () =>
        app.store.investigations.get(app.issues.repo, created2.number)?.status ===
        "done",
      15_000,
      "fallback done",
    );

    const row2 = app.store.investigations.get(app.issues.repo, created2.number);
    assert.equal(row2?.status, "done");
    assert.equal(row2?.route, "fallback");
    assert.equal(row2?.model, "openrouter/research-model");
    assert.ok(
      row2?.reportMd?.includes(
        "automatische Suche, kein Abgleich durch das Modell",
      ),
    );

    // 3. FallbacksToday at the daily cap -> stays queued
    const created3 = await fauxTrack.create({
      title: "Fallback test 3: at cap",
      body: "Testing cap",
      labels: ["news-card"],
    });
    app.config.investigateFallbackDaily = 1; // already 1 fallback run today (created2)
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(app.store.investigations.fallbacksToday(today), 1);

    await startInvestigation(app, app.issues.repo, created3.number);
    await new Promise((r) => setTimeout(r, 500));
    const row3 = app.store.investigations.get(app.issues.repo, created3.number);
    assert.equal(row3?.status, "queued");
  } finally {
    await cleanup();
  }
});

test("investigation: restart mid-run ends with exactly one report comment", async () => {
  setFauxInvestigatorMode(undefined);
  const { app, dir, config, cleanup } = await fauxApp();
  try {
    const fauxTrack = app.issues as any;
    const created = await fauxTrack.create({
      title: "Restart mid-run issue",
      body: "Will stop after running",
      labels: ["news-card"],
    });

    await startInvestigation(app, app.issues.repo, created.number);

    // Wait until running or done
    await until(
      () =>
        app.store.investigations.get(app.issues.repo, created.number)?.status ===
          "running" ||
        app.store.investigations.get(app.issues.repo, created.number)?.status ===
          "done",
      15_000,
      "running or done",
    );

    // Close app
    await app.close();

    // Reopen on same data dir
    const reopened = await openApp(config);
    try {
      const reopenedFauxTrack = reopened.issues as any;
      await until(
        () =>
          reopened.store.investigations.get(reopened.issues.repo, created.number)
            ?.status === "done",
        15_000,
        "reopened done",
      );

      const issueObj = reopenedFauxTrack.issues.get(created.number);
      assert.equal(issueObj.comments.length, 1);
    } finally {
      await reopened.close();
    }
  } finally {
    await cleanup();
  }
});

test("investigateCatchup: handles news-card labels, throttles, and triggers from workflow", async () => {
  const { app, cleanup } = await fauxApp();
  try {
    const fauxTrack = app.issues as any;
    // 1. plain issue (label "news-card")
    const plain = await fauxTrack.create({
      title: "Plain issue",
      body: "Needs investigation",
      labels: ["news-card"],
    });

    // 2. investigated issue (labels "news-card", "investigated")
    const investigated = await fauxTrack.create({
      title: "Already investigated",
      body: "Done",
      labels: ["news-card", "investigated"],
    });

    // 3. investigating issue (labels "news-card", "investigating")
    const investigating = await fauxTrack.create({
      title: "Currently investigating",
      body: "In progress",
      labels: ["news-card", "investigating"],
    });

    // 4. with a queued row (label "news-card", but already queued in DB)
    const queuedIssue = await fauxTrack.create({
      title: "Already queued",
      body: "In queue",
      labels: ["news-card"],
    });
    app.store.investigations.enqueue(app.issues.repo, queuedIssue.number);

    // 5. failed row whose label was removed (label "news-card", row in DB is failed)
    const failedIssue = await fauxTrack.create({
      title: "Failed issue for retry",
      body: "Failed earlier",
      labels: ["news-card"], // no "investigation-failed" label
    });
    app.store.investigations.enqueue(app.issues.repo, failedIssue.number);
    app.store.investigations.start(app.issues.repo, failedIssue.number, "local", "model-x");
    app.store.investigations.fail(app.issues.repo, failedIssue.number, "err 1");
    app.store.investigations.start(app.issues.repo, failedIssue.number, "local", "model-x");
    app.store.investigations.fail(app.issues.repo, failedIssue.number, "err 2");
    app.store.investigations.start(app.issues.repo, failedIssue.number, "local", "model-x");
    app.store.investigations.fail(app.issues.repo, failedIssue.number, "fatal err 3");
    assert.equal(app.store.investigations.get(app.issues.repo, failedIssue.number)?.status, "failed");

    // Spy on app.issues.list
    let listCalls = 0;
    const origList = app.issues.list.bind(app.issues);
    app.issues.list = async (label?: string) => {
      listCalls++;
      return origList(label);
    };

    const now = Date.now();
    // First catchup call
    const startedCount = await investigateCatchup(app, now);
    assert.equal(startedCount, 2);
    assert.equal(listCalls, 1);

    // Verify which ones started:
    const plainRow = app.store.investigations.get(app.issues.repo, plain.number);
    assert.ok(plainRow);
    assert.ok(["queued", "running", "done"].includes(plainRow.status));

    const retriedRow = app.store.investigations.get(app.issues.repo, failedIssue.number);
    assert.ok(retriedRow);
    assert.ok(["queued", "running", "done"].includes(retriedRow.status));
    assert.equal(retriedRow.attempts, 0);

    // investigated and investigating should not have DB rows
    assert.equal(app.store.investigations.get(app.issues.repo, investigated.number), undefined);
    assert.equal(app.store.investigations.get(app.issues.repo, investigating.number), undefined);

    // Second catchup call within 10 minutes returns 0 without calling list
    const secondCount = await investigateCatchup(app, now + 5 * 60_000);
    assert.equal(secondCount, 0);
    assert.equal(listCalls, 1);

    // Workflow call: workflow.newsSweep runs it
    app.store.settings.set("investigateCatchupAt", 0);
    const routes = workflowRoutes({ app });
    let resStatus = 200;
    let resBody: any;
    const fakeReq: any = {
      body: { trigger: "manual", requestId: "test-sweep-catchup", cards: 1 },
    };
    const fakeRes: any = {
      status(c: number) { resStatus = c; return this; },
      json(b: any) { resBody = b; return this; },
      set() { return this; },
    };
    await routes["workflow.newsSweep"](fakeReq, fakeRes);
    // News sweep must have called investigateCatchup, advancing listCalls to 2 and setting investigateCatchupAt
    assert.equal(listCalls, 2);
    assert.ok(app.store.settings.get("investigateCatchupAt") !== undefined);
  } finally {
    await cleanup();
  }
});
