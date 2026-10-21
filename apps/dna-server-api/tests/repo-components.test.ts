import assert from "node:assert/strict";
import { test } from "node:test";
import { repoComponentCatalog } from "../src/news/repo-components.ts";
import catalog from "../src/news/repo-components.generated.json" with {
  type: "json",
};

test("repo components: generated catalog carries graph labels", () => {
  const projects = (catalog as { projects: Record<string, object> }).projects;
  for (const repo of ["news-agent", "unsloth-boxes", "agentic-resources", "Bachelorprojekt"])
    assert.ok(projects[repo], `catalog covers ${repo}`);
  const text = repoComponentCatalog();
  for (const repo of ["news-agent", "Bachelorprojekt"])
    assert.ok(text.includes(repo), `catalog text mentions ${repo}`);
  assert.ok(text.includes("cluster"), "catalog text carries cluster labels");
});
