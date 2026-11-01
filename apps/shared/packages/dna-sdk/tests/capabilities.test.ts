import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CAPABILITIES, CAPABILITY_IDS, INFRA_ROUTES } from "../src/capabilities.ts";
import { ROUTES, type RouteId } from "../src/routes.ts";
import { CLI_COMMANDS } from "../../../../dna-cli/src/coverage.ts";
import { TUI_COMMANDS } from "../../../../dna-client-tui/src/coverage.ts";

const BROWSER = join(import.meta.dirname, "../../../../dna-client-browser/fe/src");
const vueFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? vueFiles(join(dir, e.name))
      : e.name.endsWith(".vue")
        ? [join(dir, e.name)]
        : [],
  );

test("every client route belongs to a capability", () => {
  const covered = new Set<RouteId>(Object.values(CAPABILITIES).flatMap((c) => c.routes));
  for (const id of Object.keys(ROUTES) as RouteId[])
    if (!INFRA_ROUTES.includes(id)) assert.ok(covered.has(id), `${id} has no capability`);
});

test("the CLI covers every capability", () => {
  for (const id of CAPABILITY_IDS) assert.ok(CLI_COMMANDS[id], `CLI has no command for ${id}`);
});

test("the TUI covers every capability", () => {
  for (const id of CAPABILITY_IDS) assert.ok(TUI_COMMANDS[id], `TUI has no command for ${id}`);
});

test("the browser has a data-cap control for every capability", () => {
  const source = vueFiles(BROWSER)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  for (const id of CAPABILITY_IDS)
    assert.ok(source.includes(`data-cap="${id}"`), `browser has no data-cap="${id}"`);
});
