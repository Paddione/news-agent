// One-off rollout of the topic groups (.agents/plans/topic-groups/design.md): creates the groups, adds or regroups
// their topics with hand-set weights, and turns off the topics they replace. Prints the steps; --apply runs them
// against the local API. Run from apps/dna-server-api: npx tsx scripts/topic-groups-rollout.ts [--apply]
import { fileURLToPath } from "node:url";
import { DnaClient, type Keyword, type TopicGroup } from "@dna/sdk";
import { loadRootEnv } from "@dna/sdk/node";

export const GROUPS: { name: string; weight: number; topics: [string, number][] }[] = [
  {
    name: "agent-harnesses",
    weight: 1.5,
    topics: [
      ["agent harness", 2],
      ["Claude Code", 1.5],
      ["Codex CLI", 1.5],
      ["OpenCode", 1.2],
      ["pi agent", 1],
      ["multi-agent orchestration", 0.7],
      ["durable agents", 0.8],
      ["coding agents", 0.6],
    ],
  },
  {
    name: "agent-security",
    weight: 1.5,
    topics: [
      ["coding agent security", 2],
      ["prompt injection", 1.5],
      ["agent sandboxing", 1.5],
    ],
  },
  {
    name: "local-inference",
    weight: 1.5,
    topics: [
      ["llama.cpp", 2],
      ["GGUF quantization", 1],
    ],
  },
  {
    name: "models",
    weight: 1.2,
    topics: [
      ["open-weight coding models", 1.2],
      ["LLM judge models", 1.5],
      ["Claude model release", 1],
    ],
  },
  {
    name: "agentic-resources",
    weight: 1.2,
    topics: [
      ["MCP servers", 1.5],
      ["agent skills", 1],
      ["Claude Code plugins", 1],
      ["agent hooks", 1],
      ["context engineering", 1.2],
    ],
  },
  {
    name: "agent-ops",
    weight: 0.8,
    topics: [
      ["coding agent benchmarks", 0.8],
      ["agent observability", 0.8],
    ],
  },
];

/** Topics the groups replace or that brought no liked cards. Turned off, not removed: seeds come back on restart. */
export const DISABLED = [
  "voice agents",
  "Gemini CLI",
  "Gemini",
  "Aider",
  "Cline",
  "Goose agent",
  "Cursor agent",
  "DeepSeek Harness",
  "chain of thought monitoring",
  "exe.dev",
  "pi-durable",
  "proactive agents",
  "software factories",
  "agentic engineering",
  "jev",
  "classifiers",
  "agent sandboxes",
  "MCP",
  "OpenAI Codex",
  "compaction",
  "agent benchmarks",
  "agent swarms",
];

export type RolloutStep =
  | { op: "addGroup"; name: string; weight: number }
  | { op: "addTopic"; term: string; weight: number; group: string }
  | { op: "assignTopic"; id: number; term: string; weight: number; group: string }
  | { op: "disableTopic"; id: number; term: string };

/** What is left to do to reach the rollout table from the current keywords and groups. Empty when done. */
export function rolloutSteps(current: Keyword[], groups: TopicGroup[]): RolloutStep[] {
  const steps: RolloutStep[] = [];
  const topics = current.filter((k) => k.kind === "topic");
  const find = (term: string) => topics.find((k) => k.term.toLowerCase() === term.toLowerCase());
  for (const g of GROUPS) {
    const existing = groups.find((x) => x.name === g.name);
    if (!existing) steps.push({ op: "addGroup", name: g.name, weight: g.weight });
    for (const [term, weight] of g.topics) {
      const k = find(term);
      if (!k) steps.push({ op: "addTopic", term, weight, group: g.name });
      else if (!existing || k.groupId !== existing.id || k.weight !== weight || !k.enabled)
        steps.push({ op: "assignTopic", id: k.id, term: k.term, weight, group: g.name });
    }
  }
  for (const term of DISABLED) {
    const k = find(term);
    if (k?.enabled) steps.push({ op: "disableTopic", id: k.id, term: k.term });
  }
  return steps;
}

async function main(apply: boolean) {
  loadRootEnv();
  const port = process.env.DNA_PORT ?? "4850";
  const token = process.env.DNA_CLIENT_TOKEN;
  if (!token) throw new Error("DNA_CLIENT_TOKEN is missing (the repo root .env)");
  const client = new DnaClient(`http://127.0.0.1:${port}`, token);
  const keywords = await client.keywords("topic");
  const groups = await client.topicGroups();
  console.log(
    `before: ${JSON.stringify(keywords.map(({ id, term, weight, enabled, groupId }) => ({ id, term, weight, enabled, groupId })))}`,
  );
  const steps = rolloutSteps(keywords, groups);
  for (const s of steps) console.log(JSON.stringify(s));
  if (!apply) {
    console.log(`${steps.length} steps; dry run, pass --apply to run them`);
    return;
  }
  const ids = new Map(groups.map((g) => [g.name, g.id]));
  for (const s of steps) {
    if (s.op === "addGroup")
      ids.set(s.name, (await client.addTopicGroup({ name: s.name, weight: s.weight })).id);
    else if (s.op === "addTopic")
      await client.addKeyword({
        kind: "topic",
        term: s.term,
        weight: s.weight,
        groupId: ids.get(s.group),
      });
    else if (s.op === "assignTopic")
      await client.updateKeyword(s.id, {
        weight: s.weight,
        enabled: true,
        groupId: ids.get(s.group),
      });
    else await client.updateKeyword(s.id, { enabled: false });
  }
  console.log(`${steps.length} steps applied`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main(process.argv.includes("--apply"));
