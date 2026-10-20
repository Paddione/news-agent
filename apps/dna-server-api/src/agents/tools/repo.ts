import { Type } from "@earendil-works/pi-ai";
import { defineAppTool, toolError, toolText } from "@dna/durable-agent";
import type { CodeGraph } from "../../news/graph.ts";

export function repoSearch(graph: CodeGraph) {
  return defineAppTool({
    name: "repo_search",
    description: "Search code in a repository using codebase-memory-mcp.",
    returns: "Text: compact code search results.",
    parameters: Type.Object({
      project: Type.String({ description: "Target project name from allowed repos." }),
      query: Type.String({ description: "Code search pattern or term." }),
    }),
    replay: "safe",
    execute: async (args) => {
      try {
        const text = await graph.search(args.project, args.query);
        return toolText(text);
      } catch (err: any) {
        return toolError(err.message ?? String(err));
      }
    },
  });
}

export function repoSymbol(graph: CodeGraph) {
  return defineAppTool({
    name: "repo_symbol",
    description: "Find a symbol in a repository graph and get its code snippet.",
    returns: "Text: symbol code snippet.",
    parameters: Type.Object({
      project: Type.String({ description: "Target project name from allowed repos." }),
      name: Type.String({ description: "Symbol name or pattern." }),
    }),
    replay: "safe",
    execute: async (args) => {
      try {
        const text = await graph.symbol(args.project, args.name);
        return toolText(text);
      } catch (err: any) {
        return toolError(err.message ?? String(err));
      }
    },
  });
}

export function repoOverview(graph: CodeGraph) {
  return defineAppTool({
    name: "repo_overview",
    description: "Get architectural overview of a repository.",
    returns: "Text: architecture summary of the project.",
    parameters: Type.Object({
      project: Type.String({ description: "Target project name from allowed repos." }),
    }),
    replay: "safe",
    execute: async (args) => {
      try {
        const text = await graph.overview(args.project);
        return toolText(text);
      } catch (err: any) {
        return toolError(err.message ?? String(err));
      }
    },
  });
}

export function repoTools(graph: CodeGraph) {
  return [repoSearch(graph), repoSymbol(graph), repoOverview(graph)];
}
