import assert from "node:assert/strict";
import { test } from "node:test";
import { tempStore } from "./helpers.ts";

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
