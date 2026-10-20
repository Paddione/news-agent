import assert from "node:assert/strict";
import { test } from "node:test";
import { figureGroups, figuresOf } from "../src/components.ts";

test("figuresOf reads only valid entries", () => {
  assert.deepEqual(figuresOf({}), []);
  assert.deepEqual(figuresOf({ figures: "x" }), []);
  assert.deepEqual(
    figuresOf({
      figures: [
        { label: "a", value: 1 },
        { label: "b" },
        null,
        { label: "c", value: 2, unit: "%" },
      ],
    }),
    [
      { label: "a", value: 1 },
      { label: "c", value: 2, unit: "%" },
    ],
  );
});

test("figureGroups makes a bar group per group and unit with 2 or more rows", () => {
  const f = [
    { label: "new", value: 72.5, unit: "%", group: "swe" },
    { label: "price", value: 3, unit: "$" },
    { label: "old", value: 61, unit: "%", group: "swe" },
    { label: "stars", value: 1200 },
  ];
  const g = figureGroups(f);
  assert.deepEqual(
    g.bars.map((b) => [b.key, b.unit, b.rows.map((r) => r.label)]),
    [["swe|%", "%", ["new", "old"]]],
  );
  assert.deepEqual(
    g.rest.map((r) => r.label),
    ["price", "stars"],
  );
});
