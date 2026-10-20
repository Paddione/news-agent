import assert from "node:assert/strict";
import { test } from "node:test";
import { fmt, linear, path, share } from "../fe/src/components/viz/scale.ts";

test("linear maps 0..max onto 0..range and is flat for an empty domain", () => {
  assert.equal(linear(10, 200)(5), 100);
  assert.equal(linear(0, 200)(5), 0);
});

test("path spreads points evenly and inverts y", () => {
  assert.equal(path([0, 10], 100, 50), "M0,50 L100,0");
  assert.equal(path([5], 100, 50, 10), "M0,25");
  assert.equal(path([], 100, 50), "");
});

test("fmt and share", () => {
  assert.equal(fmt(1234.56), "1,234.6");
  assert.equal(fmt(72), "72");
  assert.equal(share(1, 4), "25%");
  assert.equal(share(1, 0), "–");
});
