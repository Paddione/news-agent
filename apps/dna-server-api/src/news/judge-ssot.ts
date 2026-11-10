// apps/dna-server-api/src/news/judge-ssot.ts
// The judge attachment chain, Env -> file -> version: resolve the manifest
// path (JEV_MANIFEST wins, judge.yaml is the default), load the file, and
// refuse when the path does not resolve or the version does not match.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { loadManifest, type JudgeManifest } from "@dna/jev";

const API_DIR = resolve(import.meta.dirname, "../..");

export interface JudgeSsot {
  manifestPath: string;
  manifestName: string;
  policy: { reject_min: number; allow_max: number };
}

/** apps/dna-server-api/config/judge.yaml, next to this package (not via repoRoot: that follows node_modules symlinks). */
export const JUDGE_SSOT_FILE = join(API_DIR, "config/judge.yaml");

/** The judge.yaml SSOT, parsed. */
export function loadJudgeSsot(file = JUDGE_SSOT_FILE): JudgeSsot {
  const raw = parse(readFileSync(file, "utf8")) as Record<string, any>;
  const manifestPath =
    typeof raw.manifest_path === "string" && raw.manifest_path.trim()
      ? raw.manifest_path.trim()
      : (() => {
          throw new Error(`${file}: manifest_path must be a non empty string`);
        })();
  if (typeof raw.manifest_name !== "string" || !raw.manifest_name.trim())
    throw new Error(`${file}: manifest_name must be a non empty string`);
  const policy = raw.policy ?? {};
  if (typeof policy.reject_min !== "number" || typeof policy.allow_max !== "number")
    throw new Error(`${file}: policy needs numeric reject_min and allow_max`);
  return {
    manifestPath,
    manifestName: raw.manifest_name.trim(),
    policy: { reject_min: policy.reject_min, allow_max: policy.allow_max },
  };
}

/** Env first, judge.yaml second: where the judge manifest lives. */
export function judgeManifestPath(
  env: NodeJS.ProcessEnv = process.env,
  ssot: JudgeSsot = loadJudgeSsot(),
): string {
  return env.JEV_MANIFEST?.trim() || ssot.manifestPath;
}

/** Load the manifest at the resolved path and check its version (name). */
export function loadJudgeManifest(
  env: NodeJS.ProcessEnv = process.env,
  ssot: JudgeSsot = loadJudgeSsot(),
): JudgeManifest {
  const path = judgeManifestPath(env, ssot);
  let manifest: JudgeManifest;
  try {
    manifest = loadManifest(path);
  } catch (error) {
    throw new Error(`judge manifest at ${path} does not resolve: ${String(error).slice(0, 160)}`);
  }
  if (manifest.name !== ssot.manifestName)
    throw new Error(
      `judge manifest at ${path} is ${manifest.name}, judge.yaml expects ${ssot.manifestName}`,
    );
  return manifest;
}
