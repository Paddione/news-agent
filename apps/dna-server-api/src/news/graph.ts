import { spawn } from "node:child_process";
import type { ExecFile } from "./issues.ts";

export interface CodeGraph {
  projects(): Promise<{ name: string; root: string }[]>;
  refresh(root: string): Promise<void>;
  search(project: string, pattern: string): Promise<string>;
  symbol(project: string, name: string): Promise<string>;
  overview(project: string): Promise<string>;
}

const defaultExecFile: ExecFile = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.stdin.end(input ?? "");
  });

const clip = (text: string | undefined, max: number) =>
  !text ? "" : text.length > max ? `${text.slice(0, max)} [${text.length - max} more chars]` : text;

export function extractFirstQualifiedName(stdout: string): string | undefined {
  let currentPrefix = "";
  for (const line of stdout.split("\n")) {
    const groupMatch = /^([^\s(:]+)\s*\([^)]*\):/.exec(line);
    if (groupMatch) {
      currentPrefix = groupMatch[1].trim();
      if (currentPrefix === "-") currentPrefix = "";
      continue;
    }
    const itemMatch = /^\s+([^\s]+)\s+[A-Za-z]+/.exec(line);
    if (itemMatch) {
      const name = itemMatch[1];
      return currentPrefix ? `${currentPrefix}.${name}` : name;
    }
    const qnMatch = /(?:qualified_name|qn)[:=]\s*([^\s]+)/.exec(line);
    if (qnMatch) return qnMatch[1];
  }
  return undefined;
}

export function codeGraph(allowed: string[], exec: ExecFile = defaultExecFile): CodeGraph {
  const check = (project: string) => {
    if (!allowed.includes(project))
      throw new Error(`Project "${project}" is not in the allowed list: ${allowed.join(", ")}`);
  };

  const run = async (args: string[]) => {
    const r = await exec("codebase-memory-mcp", args).catch((e: Error) => {
      throw new Error(`codebase-memory-mcp could not run: ${e.message}`);
    });
    if (r.code !== 0)
      throw new Error(
        `codebase-memory-mcp ${args.join(" ")} failed: ${r.stderr.trim().slice(0, 500)}`,
      );
    return r.stdout;
  };

  return {
    async projects() {
      const out = await run(["cli", "list_projects"]);
      const projects: { name: string; root: string }[] = [];
      for (const line of out.split("\n")) {
        const match = /^\s*([^\s]+)\s+([^\s]+)\s+[^\s]+/.exec(line);
        if (
          match &&
          match[1] !== "projects:" &&
          match[1] !== "total:" &&
          match[1] !== "returned:"
        ) {
          projects.push({ name: match[1], root: match[2] });
        }
      }
      return projects;
    },

    async refresh(root: string) {
      await run(["cli", "--quiet", "index_repository", "--repo-path", root]);
    },

    async search(project: string, pattern: string) {
      check(project);
      const out = await run([
        "cli",
        "search_code",
        "--project",
        project,
        "--pattern",
        pattern,
        "--mode",
        "compact",
      ]);
      return clip(out, 6000);
    },

    async symbol(project: string, name: string) {
      check(project);
      const out = await run(["cli", "search_graph", "--project", project, "--name-pattern", name]);
      const qn = extractFirstQualifiedName(out);
      if (!qn) return clip(out, 6000);
      const snippet = await run([
        "cli",
        "get_code_snippet",
        "--project",
        project,
        "--qualified-name",
        qn,
      ]);
      return clip(snippet, 6000);
    },

    async overview(project: string) {
      check(project);
      const out = await run(["cli", "get_architecture", "--project", project]);
      return clip(out, 6000);
    },
  };
}

export function fauxGraph(allowed: string[]): CodeGraph {
  const check = (project: string) => {
    if (!allowed.includes(project))
      throw new Error(`Project "${project}" is not in the allowed list: ${allowed.join(", ")}`);
  };
  return {
    async projects() {
      return allowed.map((name) => ({ name, root: `/repos/${name}` }));
    },
    async refresh(_root: string) {},
    async search(project: string, pattern: string) {
      check(project);
      return `faux search for "${pattern}" in ${project}`;
    },
    async symbol(project: string, name: string) {
      check(project);
      return `faux symbol "${name}" in ${project}`;
    },
    async overview(project: string) {
      check(project);
      return `faux overview for ${project}`;
    },
  };
}
