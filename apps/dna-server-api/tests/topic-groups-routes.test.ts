import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { DnaError } from "@dna/sdk";
import { bootServer, type Booted } from "./server.ts";

let s: Booted;
before(async () => {
  s = await bootServer({ FIRECRAWL_API_KEY: "" });
});
after(() => s.cleanup());

const status = async (p: Promise<unknown>, code: number, pattern?: RegExp) => {
  await assert.rejects(
    p,
    (e: unknown) =>
      e instanceof DnaError && e.status === code && (!pattern || pattern.test(e.message)),
  );
};

test("topic groups: add, list, update, remove, with validation", async () => {
  const g = await s.client.addTopicGroup({ name: "agent-ops", weight: 0.8 });
  assert.deepEqual(
    { name: g.name, weight: g.weight, enabled: g.enabled, topicCount: g.topicCount },
    { name: "agent-ops", weight: 0.8, enabled: true, topicCount: 0 },
  );
  assert.ok((await s.client.topicGroups()).some((x) => x.id === g.id));
  await status(s.client.addTopicGroup({ name: "agent-ops" }), 409, /already/);
  await status(s.client.addTopicGroup({ name: "Bad Name" }), 400, /kebab-case/);
  await status(s.client.updateTopicGroup(g.id, { weight: 3 }), 400);
  const updated = await s.client.updateTopicGroup(g.id, { weight: 1.1, enabled: false });
  assert.deepEqual([updated.weight, updated.enabled], [1.1, false]);
  await status(s.client.updateTopicGroup(99_999, { weight: 1 }), 404);
  await s.client.removeTopicGroup(g.id);
  assert.ok(!(await s.client.topicGroups()).some((x) => x.id === g.id));
  await status(s.client.removeTopicGroup(g.id), 404);
});

test("keywords take a groupId: assign, unassign, topics only", async () => {
  const g = await s.client.addTopicGroup({ name: "local-inference", weight: 1.5 });
  const topic = await s.client.addKeyword({ kind: "topic", term: "llama.cpp", groupId: g.id });
  assert.equal(topic.groupId, g.id);
  assert.equal((await s.client.topicGroups()).find((x) => x.id === g.id)?.topicCount, 1);
  const out = await s.client.updateKeyword(topic.id, { groupId: null });
  assert.equal(out.groupId, undefined);
  const back = await s.client.updateKeyword(topic.id, { groupId: g.id });
  assert.equal(back.groupId, g.id);
  const signal = await s.client.addKeyword({ kind: "signal", term: "group test signal term" });
  await status(s.client.updateKeyword(signal.id, { groupId: g.id }), 400, /only topics/i);
  await status(s.client.updateKeyword(topic.id, { groupId: 99_999 }), 404);
  await s.client.removeTopicGroup(g.id);
  const loose = (await s.client.keywords("topic")).find((k) => k.id === topic.id);
  assert.equal(loose?.groupId, undefined);
});
