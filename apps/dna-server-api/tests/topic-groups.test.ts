import assert from "node:assert/strict";
import { test } from "node:test";
import { tempStore } from "./helpers.ts";

test("seeded keywords start without a group", () => {
  const { store, cleanup } = tempStore();
  try {
    const topics = store.taste.keywords("topic");
    assert.ok(topics.length > 0);
    assert.ok(topics.every((k) => k.groupId === undefined));
  } finally {
    cleanup();
  }
});

test("groups: add, find, update, remove; names are kebab-case and unique", () => {
  const { store, cleanup } = tempStore();
  try {
    const g = store.taste.addGroup("agent-harnesses", 1.5);
    assert.deepEqual(
      { name: g.name, weight: g.weight, enabled: g.enabled, topicCount: g.topicCount },
      { name: "agent-harnesses", weight: 1.5, enabled: true, topicCount: 0 },
    );
    assert.equal(store.taste.findGroup("agent-harnesses")?.id, g.id);
    assert.throws(() => store.taste.addGroup("agent-harnesses"), /already/);
    assert.throws(() => store.taste.addGroup("Agent Harness"), /kebab-case/);
    assert.equal(store.taste.updateGroup(g.id, { weight: 5 })?.weight, 2);
    assert.equal(store.taste.updateGroup(g.id, { enabled: false })?.enabled, false);
    const topic = store.taste.addKeyword("topic", "Claude Code CLI");
    store.taste.setKeywordGroup(topic.id, g.id);
    assert.equal(store.taste.group(g.id)?.topicCount, 1);
    assert.equal(store.taste.removeGroup(g.id), true);
    assert.equal(store.taste.keyword(topic.id)?.groupId, undefined);
    assert.equal(store.taste.groups().length, 0);
  } finally {
    cleanup();
  }
});

test("only topics take a group", () => {
  const { store, cleanup } = tempStore();
  try {
    const g = store.taste.addGroup("models");
    const facts = store.taste.addKeyword("facts", "benchmark table");
    assert.throws(() => store.taste.setKeywordGroup(facts.id, g.id), /only topics/i);
    const topic = store.taste.addKeyword("topic", "llama.cpp");
    assert.equal(store.taste.setKeywordGroup(topic.id, g.id)?.groupId, g.id);
    assert.equal(store.taste.setKeywordGroup(topic.id, null)?.groupId, undefined);
  } finally {
    cleanup();
  }
});

test("effective weight multiplies topic and group; disabled groups drop their topics", () => {
  const { store, cleanup } = tempStore();
  try {
    const g = store.taste.addGroup("agentic-resources", 1.2);
    const grouped = store.taste.addKeyword("topic", "MCP servers", 1.5);
    const loose = store.taste.addKeyword("topic", "loose topic", 0.8);
    store.taste.setKeywordGroup(grouped.id, g.id);
    assert.equal(store.taste.effectiveWeight(store.taste.keyword(grouped.id)!), 1.8);
    assert.equal(store.taste.effectiveWeight(store.taste.keyword(loose.id)!), 0.8);
    store.taste.updateGroup(g.id, { enabled: false });
    const active = store.taste.activeTopics().map((k) => k.term);
    assert.ok(!active.includes("MCP servers"));
    assert.ok(active.includes("loose topic"));
  } finally {
    cleanup();
  }
});
