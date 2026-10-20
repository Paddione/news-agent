import assert from "node:assert/strict";
import { test } from "node:test";
import type { Keyword, TopicGroup } from "@dna/sdk";
import { GROUPS, rolloutSteps, type RolloutStep } from "../scripts/topic-groups-rollout.ts";

const topic = (id: number, term: string, weight = 1, enabled = true): Keyword => ({
  id,
  kind: "topic",
  term,
  weight,
  source: "seed",
  enabled,
});

/** Apply steps to an in-memory copy, the way the API would. */
function apply(keywords: Keyword[], groups: TopicGroup[], steps: RolloutStep[]) {
  let next = 1000;
  const ks = keywords.map((k) => ({ ...k }));
  const gs = groups.map((g) => ({ ...g }));
  const groupId = (name: string) => gs.find((g) => g.name === name)!.id;
  for (const s of steps) {
    if (s.op === "addGroup")
      gs.push({ id: next++, name: s.name, weight: s.weight, enabled: true, topicCount: 0 });
    else if (s.op === "addTopic")
      ks.push({ ...topic(next++, s.term, s.weight), groupId: groupId(s.group), source: "user" });
    else if (s.op === "assignTopic")
      Object.assign(
        ks.find((k) => k.id === s.id)!,
        {
          weight: s.weight,
          enabled: true,
          groupId: groupId(s.group),
        },
      );
    else ks.find((k) => k.id === s.id)!.enabled = false;
  }
  return { keywords: ks, groups: gs };
}

test("rollout: creates the groups, regroups known topics, adds new ones, disables replaced ones", () => {
  const current = [topic(1, "Claude Code", 1.1), topic(2, "MCP", 0.7), topic(3, "facts term")];
  current[2].kind = "facts";
  const steps = rolloutSteps(current, []);
  const groups = steps.filter((s) => s.op === "addGroup");
  assert.equal(groups.length, 6);
  assert.deepEqual(
    Object.fromEntries(groups.map((g) => [g.name, g.weight])),
    Object.fromEntries(GROUPS.map((g) => [g.name, g.weight])),
  );
  assert.deepEqual(
    steps.find((s) => s.op === "assignTopic"),
    { op: "assignTopic", id: 1, term: "Claude Code", weight: 1.5, group: "agent-harnesses" },
  );
  assert.ok(steps.some((s) => s.op === "addTopic" && s.term === "MCP servers"));
  assert.ok(steps.some((s) => s.op === "disableTopic" && s.id === 2));
  assert.ok(!steps.some((s) => "id" in s && s.id === 3));
});

test("rollout is idempotent", () => {
  const current = [topic(1, "Claude Code", 1.1), topic(2, "MCP", 0.7)];
  const after = apply(current, [], rolloutSteps(current, []));
  assert.deepEqual(rolloutSteps(after.keywords, after.groups), []);
});
