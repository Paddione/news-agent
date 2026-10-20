import assert from "node:assert/strict";
import { test } from "node:test";
import { tempStore } from "./helpers.ts";
import { seedCard } from "./card-issues.test.ts";

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
