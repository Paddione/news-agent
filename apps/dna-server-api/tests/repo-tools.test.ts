import assert from "node:assert/strict";
import { test } from "node:test";
import { codeGraph, fauxGraph } from "../src/news/graph.ts";
import { repoSearch, repoSymbol, repoOverview } from "../src/agents/tools/repo.ts";
import type { ExecFile } from "../src/news/issues.ts";

test("codeGraph: projects, refresh, search, symbol, overview with stubbed execFile", async () => {
  const calls: { file: string; args: string[] }[] = [];
  const exec: ExecFile = async (file, args) => {
    calls.push({ file, args });
    if (args[1] === "list_projects") {
      return {
        stdout: `projects: 2  (cols: name root_path branch)\n  home-patrick-news-agent /home/patrick/news-agent main\n  home-patrick-dotfiles /home/patrick master\n`,
        stderr: "",
        code: 0,
      };
    }
    if (args[1] === "index_repository") {
      return { stdout: "indexed", stderr: "", code: 0 };
    }
    if (args[1] === "search_code") {
      return { stdout: "found matches in issues.ts", stderr: "", code: 0 };
    }
    if (args[1] === "search_graph") {
      return {
        stdout: `results: 1\nhome-patrick-news-agent.apps.dna-server-api.src.news.issues (apps/dna-server-api/src/news/issues.ts):\n  IssueTracker Interface 18-21 3 0\n`,
        stderr: "",
        code: 0,
      };
    }
    if (args[1] === "get_code_snippet") {
      return { stdout: "export interface IssueTracker { ... }", stderr: "", code: 0 };
    }
    if (args[1] === "get_architecture") {
      return { stdout: "project architecture summary", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  };

  const allowed = ["home-patrick-news-agent", "home-patrick-dotfiles"];
  const graph = codeGraph(allowed, exec);

  // projects()
  const projects = await graph.projects();
  assert.deepEqual(projects, [
    { name: "home-patrick-news-agent", root: "/home/patrick/news-agent" },
    { name: "home-patrick-dotfiles", root: "/home/patrick" },
  ]);

  // refresh()
  await graph.refresh("/home/patrick/news-agent");
  assert.deepEqual(calls[1], {
    file: "codebase-memory-mcp",
    args: ["cli", "--quiet", "index_repository", "--repo-path", "/home/patrick/news-agent"],
  });

  // search()
  const searchRes = await graph.search("home-patrick-news-agent", "IssueTracker");
  assert.equal(searchRes, "found matches in issues.ts");
  assert.deepEqual(calls[2], {
    file: "codebase-memory-mcp",
    args: [
      "cli",
      "search_code",
      "--project",
      "home-patrick-news-agent",
      "--pattern",
      "IssueTracker",
      "--mode",
      "compact",
    ],
  });

  // symbol()
  const symbolRes = await graph.symbol("home-patrick-news-agent", "IssueTracker");
  assert.equal(symbolRes, "export interface IssueTracker { ... }");
  assert.deepEqual(calls[3], {
    file: "codebase-memory-mcp",
    args: [
      "cli",
      "search_graph",
      "--project",
      "home-patrick-news-agent",
      "--name-pattern",
      "IssueTracker",
    ],
  });
  assert.deepEqual(calls[4], {
    file: "codebase-memory-mcp",
    args: [
      "cli",
      "get_code_snippet",
      "--project",
      "home-patrick-news-agent",
      "--qualified-name",
      "home-patrick-news-agent.apps.dna-server-api.src.news.issues.IssueTracker",
    ],
  });

  // overview()
  const overviewRes = await graph.overview("home-patrick-news-agent");
  assert.equal(overviewRes, "project architecture summary");
  assert.deepEqual(calls[5], {
    file: "codebase-memory-mcp",
    args: ["cli", "get_architecture", "--project", "home-patrick-news-agent"],
  });

  // project outside allowed throws before any call
  await assert.rejects(() => graph.search("forbidden-project", "foo"), /forbidden-project/);
  assert.equal(calls.length, 6);
});

test("codeGraph: cuts output over 6000 characters with a marker", async () => {
  const longText = "a".repeat(7000);
  const exec: ExecFile = async () => ({ stdout: longText, stderr: "", code: 0 });
  const graph = codeGraph(["test-repo"], exec);
  const res = await graph.search("test-repo", "pattern");
  assert.ok(res.length < 6500);
  assert.ok(res.includes("more chars]"));
});

test("repo tools: wrap graph calls and format errors as tool errors", async () => {
  const allowed = ["repo-a"];
  const faux = fauxGraph(allowed);

  const searchTool = repoSearch(faux);
  const searchRes = await (searchTool as any).execute(
    { project: "repo-a", query: "foo" },
    {} as any,
  );
  assert.equal(searchRes.isError, undefined);
  assert.ok(searchRes.content[0].text.includes("foo"));

  const symbolTool = repoSymbol(faux);
  const symbolRes = await (symbolTool as any).execute(
    { project: "repo-a", name: "Bar" },
    {} as any,
  );
  assert.equal(symbolRes.isError, undefined);
  assert.ok(symbolRes.content[0].text.includes("Bar"));

  const overviewTool = repoOverview(faux);
  const overviewRes = await (overviewTool as any).execute({ project: "repo-a" }, {} as any);
  assert.equal(overviewRes.isError, undefined);
  assert.ok(overviewRes.content[0].text.includes("repo-a"));

  // Forbidden project becomes tool error
  const errRes = await (searchTool as any).execute(
    { project: "forbidden", query: "foo" },
    {} as any,
  );
  assert.equal(errRes.isError, true);
  assert.ok(errRes.content[0].text.includes("forbidden"));
});
