import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { COMPONENT_SPECS, type Card, type CardComponent, type TranscriptItem } from "@dna/sdk";
import { CardBlock, figureLines, hfsBadges } from "../src/cards.ts";
import { buildCommands } from "../src/commands.ts";
import { contextBar } from "../src/context-bar.ts";
import { agentText, itemComponent } from "../src/render.ts";

const long = "x".repeat(400);
const wide = "漢字とかなの混在テキスト🙂🚀 ".repeat(12);
const BANNED = [/—/, /–/, /·/, /•/, /…/, / - /, /\.\.\./];
const clean = (lines: string[], what: string) => {
  for (const line of lines) {
    const plain = stripTerminalSequences(line);
    const hit = BANNED.find((re) => re.test(plain));
    assert.ok(!hit, `${what} has ${hit} in: ${plain.slice(0, 120)}`);
  }
};

const hfs = {
  hype: 7,
  facts: 84,
  signal: 91,
  primary: "signal" as const,
  labels: ["signal", "facts"] as ("signal" | "facts")[],
  ranked: [
    { category: "signal" as const, score: 91, confidence: 0.9 },
    { category: "facts" as const, score: 84, confidence: 0.8 },
    { category: "hype" as const, score: 7, confidence: 0.7 },
  ],
  suspectCombo: false,
};
const props: Record<CardComponent, Record<string, unknown>> = {
  headline: { title: `Big news — ${wide}`, dek: long },
  brief: { title: "A brief - with a spaced hyphen", summary: `Summary… ${long}` },
  signal_alert: { title: wide, action: long, why: "Because · reasons" },
  fact_check: { claim: wide, verdict: "Mostly true", evidence: ["https://example.com/a", long] },
  hype_watch: { title: wide, reality_check: long },
  release: { name: "pi-durable", version: "1.1.0", changes: [long, wide, "• bullet"] },
  thread_pulse: { title: wide, takes: [long, wide] },
  quote: { quote: long, speaker: "Someone – somewhere" },
};
const cards: Card[] = (Object.keys(COMPONENT_SPECS) as CardComponent[]).map((component, i) => ({
  id: i + 1,
  kind: "news",
  component,
  props: props[component],
  title: wide,
  sourceName: "Hacker News — front page",
  hfs,
  toolCallId: String(i),
  createdAt: new Date().toISOString(),
  feedback: { signal: "more", labels: ["signal"] },
}));

const items: TranscriptItem[] = [
  { kind: "user", id: 1, text: `hello ${wide}\n${long}` },
  {
    kind: "user",
    id: 2,
    text: "# Purpose\n\nRun scheduled sweep 7 and present only news worth attention.",
  },
  {
    kind: "assistant",
    id: 3,
    streaming: false,
    model: "m",
    blocks: [
      { type: "thinking", text: `planning ${wide}` },
      {
        type: "text",
        text: `# Title\n\nSome **bold** text and a list:\n\n- one ${wide}\n- two — three\n\n\`\`\`ts\nconst x = "${long}";\n\`\`\``,
      },
      {
        type: "tool",
        call: {
          callId: "a",
          name: "jev_classify",
          args: { command: "hfs", item_id: 12 },
          status: "done",
          result: `${wide}\n`.repeat(8),
        },
      },
      {
        type: "tool",
        call: {
          callId: "b",
          name: "present_news",
          args: { props: { title: long } },
          status: "running",
        },
      },
      {
        type: "tool",
        call: {
          callId: "c",
          name: "present_news",
          args: { component: "poster" },
          status: "error",
          result: `<harness>\n[error] ${long}\n</harness>`,
        },
      },
    ],
    error: `Provider request failed ${long}`,
  },
  { kind: "tool-result", id: 4, name: "read_item", text: long, isError: false },
  {
    kind: "event",
    id: 5,
    entryKind: "dna.sweep-progress",
    text: `jev kept 6 of 42 ${wide}`,
    data: { phase: "gate" },
  },
];

for (const width of [40, 80, 200]) {
  test(`cards fit width ${width} with no dots or dashes`, () => {
    for (const card of cards) {
      const lines = new CardBlock(card).render(width);
      assert.ok(lines.length >= 3, card.component);
      for (const line of lines)
        assert.ok(
          visibleWidth(line) <= width,
          `${card.component} line ${visibleWidth(line)} > ${width}`,
        );
      clean(lines, card.component);
    }
  });
  for (const expand of [false, true])
    test(`transcript items fit width ${width}${expand ? " expanded" : ""}`, () => {
      for (const item of items) {
        const lines = itemComponent(item, expand).render(width);
        for (const line of lines)
          assert.ok(
            visibleWidth(line) <= width,
            `${item.kind} line ${visibleWidth(line)} > ${width}`,
          );
        if (item.kind !== "assistant") clean(lines, item.kind);
      }
    });
}

test("H/F/S badges are ranked symbols", () => {
  assert.equal(stripTerminalSequences(hfsBadges(hfs)), "⚡ Signal 91  ✔ Facts 84  ▲ Hype 7");
});

test("the context bar marks used, background and force without dots or dashes", () => {
  const bar = stripTerminalSequences(contextBar(20, 64_000, 1_000_000, 100_000, 200_000));
  assert.match(bar, /^▕[█░│┃]{20}▏ 64k {2}bg 100k {2}force 200k$/);
  assert.equal(bar.indexOf("│"), 3);
  assert.equal(bar.indexOf("┃"), 5);
  clean([bar], "context bar");
});

test("agent markdown lists become arrows and dashes become commas", () => {
  assert.equal(
    agentText("Intro — more\n- one\n2. two\n```\na - b\n```"),
    "Intro, more\n▸ one\n▸ two\n```\na - b\n```",
  );
});

test("completions: models, keyword kinds, card ids and labels", async () => {
  const commands = buildCommands({
    models: () => ["anthropic/claude-haiku-5.5", "openai/gpt-5.5"],
    cardIds: () => [3, 12, 31],
    timelineIds: () => ["7"],
    questionIds: () => [4],
  });
  const complete = async (name: string, prefix: string) =>
    ((await commands.find((x) => x.name === name)!.getArgumentCompletions!(prefix)) ?? []).map(
      (i) => i.value,
    );
  assert.deepEqual(await complete("model", "anthropic"), ["anthropic/claude-haiku-5.5"]);
  assert.deepEqual(await complete("keywords", "s"), ["signal"]);
  assert.deepEqual(await complete("card", "1"), ["12"]);
  assert.deepEqual(await complete("more", "3"), ["3", "31"]);
  assert.deepEqual(await complete("label", "12 sig"), ["12 signal"]);
  assert.deepEqual(await complete("label", "12 signal f"), ["12 signal facts"]);
  assert.deepEqual(await complete("answer", ""), ["4"]);
  assert.deepEqual(await complete("keyword", "add t"), ["add topic"]);
  assert.deepEqual(await complete("timeline", ""), ["7"]);
});

test("every command declares at most one capability, and every capability has a command", async () => {
  const { CAPABILITY_IDS } = await import("@dna/sdk");
  const { TUI_COMMANDS } = await import("../src/coverage.ts");
  const commands = buildCommands({
    models: () => [],
    cardIds: () => [],
    timelineIds: () => [],
    questionIds: () => [],
  });
  for (const id of CAPABILITY_IDS) {
    const name = TUI_COMMANDS[id];
    assert.ok(name, id);
    if (name !== "plain text")
      assert.ok(
        commands.some((x) => `/${x.name}` === name && x.cap === id),
        `${name} declares ${id}`,
      );
  }
});

test("figures render as aligned lines with bars for a group and no banned punctuation", () => {
  const lines = figureLines({
    figures: [
      { label: "New model", value: 72.5, unit: "%", group: "swe" },
      { label: "Previous", value: 61, unit: "%", group: "swe" },
      { label: "Price", value: 3, unit: "$" },
    ],
  }).map(stripTerminalSequences);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^ {2}New model {2,}72\.5 % {2}▇{20}$/);
  assert.match(lines[1], /^ {2}Previous {2,}61 % {2}▇{17}$/);
  assert.match(lines[2], /^ {2}Price {2,}3 \$$/);
  assert.equal(lines[0].indexOf("72.5"), lines[1].indexOf("61"), "values align");
  clean(lines, "figure lines");
  assert.deepEqual(figureLines({}), []);
});
