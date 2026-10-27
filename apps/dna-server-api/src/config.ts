// Server configuration from the root .env and flags. Every default here is documented in .env.example.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadNetwork, repoRoot } from "@dna/sdk/node";

export interface Config {
  device: string;
  /** The device's name in dna-network.yaml (DNA_DEVICE_LABEL on devices, written by `just net`). */
  deviceName: string;
  mode: string;
  host: string;
  port: number;
  dataDir: string;
  rootDir: string;
  configDir: string;
  promptsDir: string;
  provider: "openrouter" | "faux" | "local";
  /** DNA_PROVIDER=local: OpenAI-compatible endpoint and context window of the one local model. */
  localBaseUrl: string;
  localContextWindow: number;
  /** DNA_FALLBACK_*: hosted OpenAI-compatible model for sweeps while the local server is down (key: DNA_FALLBACK_API_KEY
   * or META_API_KEY). Off unless base URL and model are set. */
  fallback?: {
    baseUrl: string;
    model: string;
    /** DNA_FALLBACK_CONTEXT: the hosted model's real window (default 1M). Local keeps DNA_LOCAL_CONTEXT. */
    contextWindow: number;
    dailySweeps: number;
    /** DNA_FALLBACK_MIN_INTERVAL_MINUTES: at most one fallback sweep per this many minutes (default 120). */
    minIntervalMinutes: number;
    cost: { input: number; output: number };
    /** DNA_FALLBACK_API: openai-completions (default) or openai-responses. */
    api: "openai-completions" | "openai-responses";
    /** DNA_FALLBACK_HEADERS: a JSON object of extra request headers. */
    headers?: Record<string, string>;
  };
  /** DNA_HELPER_*: a second, small local model on its own llama-server, e.g. for the quick model. Off unless base URL
   * and model are set; DNA_HELPER_CONTEXT is its window (default 32768). */
  helper?: { baseUrl: string; model: string; contextWindow: number };
  jevBackend: "auto" | "fixture" | "mock" | "openrouter" | "typesafe" | "local";
  /** JEV_BACKEND=local: the judge's llama-server, its manifest, and the GPU session command. */
  jevLocalBaseUrl: string;
  jevManifest: string;
  gpuSessionBin: string;
  /** JEV_CAPTURE: append every rendered jev call to this JSONL file. */
  jevCapture?: string;
  /** auto | web | fallback | firecrawl | fixture; SearchService warns on anything else and searches the web. */
  searchMode: string;
  /** DNA_ISSUE_*: where a card turned into an issue goes; faux in fixture search mode so tests never reach GitHub. */
  issueRepo: string;
  issueLabel: string;
  issueTracker: "gh" | "faux";
  firecrawlKey?: string;
  sweepCredits: number;
  dailyCredits: number;
  /** Topic keywords searched per sweep, heaviest and least recently searched first. */
  sweepQueries: number;
  /** Cap on sources the agent saves with save_source. */
  maxSavedSources: number;
  model: string;
  researchModel: string;
  imageModel: string;
  imageQuality: string;
  openaiKey?: string;
  cronSchedule: string;
  clientToken: string;
  cronToken: string;
  stallMinutes: number;
  /** DNA_INVESTIGATE: on | off | faux; defaults to faux in fixture search mode */
  investigate: "on" | "off" | "faux";
  investigateRepos: string[];
  investigateFallbackModel?: string;
  investigateFallbackDaily: number;
  openrouterApiKey?: string;
}

/** apps/dna-server-api: its prompts and default config live with it. */
const APP_DIR = resolve(import.meta.dirname, "..");

const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "data-dir": { type: "string" },
      device: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const rootDir = repoRoot();
  const provider =
    env.DNA_PROVIDER === "faux" ? "faux" : env.DNA_PROVIDER === "local" ? "local" : "openrouter";
  const fallbackModel =
    provider === "local" ? "qwen3.8-27b-gsq-rco-iq2s" : "anthropic/claude-haiku-5.5";
  const searchMode = env.DNA_SEARCH_MODE?.trim() || "auto";
  const config: Config = {
    device: String(values.device ?? env.DNA_DEVICE_NAME ?? "local"),
    deviceName: "",
    mode: env.DNA_MODE ?? (provider === "faux" ? "faux" : "live"),
    host: String(values.host ?? env.DNA_HOST ?? "127.0.0.1"),
    port: int(values.port as string | undefined, int(env.DNA_PORT, 4850)),
    dataDir: resolve(String(values["data-dir"] ?? env.DNA_DATA_DIR ?? join(rootDir, "data"))),
    rootDir,
    configDir: join(APP_DIR, "config"),
    promptsDir: join(APP_DIR, "prompt_engineering"),
    provider,
    jevBackend:
      (env.JEV_BACKEND as Config["jevBackend"]) ?? (searchMode === "fixture" ? "fixture" : "auto"),
    jevLocalBaseUrl: env.JEV_LOCAL_BASE_URL?.trim() || "http://127.0.0.1:8010",
    jevManifest: env.JEV_MANIFEST?.trim() || "/mnt/f/models/news-judge/current/manifest.json",
    gpuSessionBin:
      env.NEWS_GPU_SESSION?.trim() || join(homedir(), "unsloth-boxes/scripts/news-gpu-session"),
    jevCapture: env.JEV_CAPTURE?.trim() || undefined,
    searchMode,
    issueRepo: env.DNA_ISSUE_REPO?.trim() || "Paddione/dotfiles",
    issueLabel: env.DNA_ISSUE_LABEL?.trim() || "news-card",
    issueTracker:
      env.DNA_ISSUE_TRACKER === "gh" || env.DNA_ISSUE_TRACKER === "faux"
        ? env.DNA_ISSUE_TRACKER
        : searchMode === "fixture"
          ? "faux"
          : "gh",
    firecrawlKey: env.FIRECRAWL_API_KEY?.trim() || undefined,
    sweepCredits: int(env.DNA_FIRECRAWL_SWEEP_CREDITS, 5),
    dailyCredits: int(env.DNA_FIRECRAWL_DAILY_CREDITS, 40),
    sweepQueries: int(env.DNA_SWEEP_QUERIES, 15),
    maxSavedSources: int(env.DNA_MAX_SAVED_SOURCES, 25),
    model: env.DNA_MODEL ?? fallbackModel,
    researchModel: env.DNA_RESEARCH_MODEL ?? env.DNA_MODEL ?? fallbackModel,
    localBaseUrl: env.DNA_LOCAL_BASE_URL?.trim() || "http://127.0.0.1:1919/v1",
    localContextWindow: int(env.DNA_LOCAL_CONTEXT, 139264),
    fallback: fallbackFrom(env),
    helper: helperFrom(env),
    imageModel: env.DNA_IMAGE_MODEL ?? "gpt-image-2.5-flare",
    imageQuality: env.DNA_IMAGE_QUALITY ?? "low",
    openaiKey: env.OPENAI_API_KEY?.trim() || undefined,
    cronSchedule: env.DNA_CRON_SCHEDULE ?? "* * * * *",
    clientToken: env.DNA_CLIENT_TOKEN?.trim() ?? "",
    cronToken: env.DNA_CRON_TOKEN?.trim() ?? "",
    stallMinutes: int(env.DNA_STALL_MINUTES, 30),
    investigate:
      (env.DNA_INVESTIGATE as "on" | "off" | "faux") ?? (searchMode === "fixture" ? "faux" : "on"),
    investigateRepos: env.DNA_INVESTIGATE_REPOS
      ? env.DNA_INVESTIGATE_REPOS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [
          "home-patrick",
          "home-patrick-Bachelorprojekt",
          "home-patrick-agentic-resources",
          "home-patrick-news-agent",
          "home-patrick-unsloth-boxes",
        ],
    investigateFallbackModel: env.DNA_INVESTIGATE_FALLBACK_MODEL?.trim() || undefined,
    investigateFallbackDaily: int(env.DNA_INVESTIGATE_FALLBACK_DAILY, 5),
    openrouterApiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
  };
  config.deviceName =
    env.DNA_DEVICE_LABEL?.trim() ||
    (() => {
      try {
        return loadNetwork().devices[config.device]?.name;
      } catch {
        return undefined;
      }
    })() ||
    config.device;
  return config;
}

export function assertTokens(config: Config): void {
  for (const [name, token] of [
    ["DNA_CLIENT_TOKEN", config.clientToken],
    ["DNA_CRON_TOKEN", config.cronToken],
  ] as const) {
    if (token.length < 32)
      throw new Error(`${name} must be at least 32 characters. Run: just api tokens`);
  }
  if (config.clientToken === config.cronToken)
    throw new Error("DNA_CLIENT_TOKEN and DNA_CRON_TOKEN must differ. Run: just api tokens");
}

// Next fire time of an every-N-minutes or fixed-minute schedule; enough for the default cron line.
export function nextRun(schedule: string, now = new Date()): Date | undefined {
  const minute = schedule.trim().split(/\s+/)[0];
  const step = minute.match(/^\*\/(\d+)$/)?.[1];
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (step) {
    const n = Number(step);
    next.setMinutes(Math.floor(now.getMinutes() / n) * n + n);
    return next;
  }
  if (/^\d+$/.test(minute)) {
    next.setMinutes(Number(minute));
    if (next <= now) next.setHours(next.getHours() + 1);
    return next;
  }
  return undefined;
}

function helperFrom(env: NodeJS.ProcessEnv): Config["helper"] {
  const baseUrl = env.DNA_HELPER_BASE_URL?.trim();
  const model = env.DNA_HELPER_MODEL?.trim();
  if (!baseUrl || !model) return undefined;
  return { baseUrl, model, contextWindow: int(env.DNA_HELPER_CONTEXT, 32768) };
}

function fallbackFrom(env: NodeJS.ProcessEnv): Config["fallback"] {
  const baseUrl = env.DNA_FALLBACK_BASE_URL?.trim();
  const model = env.DNA_FALLBACK_MODEL?.trim();
  if (!baseUrl || !model) return undefined;
  const [input = 0, output = 0] = (env.DNA_FALLBACK_COST ?? "")
    .split(",")
    .map((v) => Number(v) || 0);
  return {
    baseUrl,
    model,
    contextWindow: int(env.DNA_FALLBACK_CONTEXT, 1_000_000),
    dailySweeps: int(env.DNA_FALLBACK_DAILY_SWEEPS, 24),
    minIntervalMinutes: int(env.DNA_FALLBACK_MIN_INTERVAL_MINUTES, 120),
    cost: { input, output },
    api: env.DNA_FALLBACK_API?.trim() === "openai-responses" ? "openai-responses" : "openai-completions",
    ...(env.DNA_FALLBACK_HEADERS?.trim() ? { headers: JSON.parse(env.DNA_FALLBACK_HEADERS) } : {}),
  };
}
