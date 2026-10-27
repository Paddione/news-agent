// The model catalog: Haiku 5.5 (default) plus 29 more models, all through OpenRouter.
// DNA_PROVIDER=faux swaps in a free deterministic model with the same 1M window.
// DNA_PROVIDER=local serves one open-weight model from an OpenAI-compatible endpoint (llama-server), plus an optional
// small helper model on a second llama-server.
import { envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelRef } from "@earendil-works/pi-durable";

export interface CatalogEntry {
  id: string;
  name: string;
  tier: string;
  icon: string;
}

export interface ModelInfo extends CatalogEntry {
  provider: string;
  contextWindow: number;
  reasoning: boolean;
  cost: { input: number; output: number };
}

export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
export const FAUX_WINDOW = 1_000_000;
export const FAUX_MODEL = "faux-haiku";

export const CATALOG: readonly CatalogEntry[] = [
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", tier: "A", icon: "anthropic.png" },
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", tier: "S+", icon: "anthropic.png" },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    tier: "S+",
    icon: "anthropic.png",
  },
  { id: "anthropic/claude-fable-5.1", name: "Claude Fable 5.1", tier: "S+", icon: "anthropic.png" },
  { id: "openai/gpt-6-astra", name: "GPT-6 Astra", tier: "S+", icon: "openai.png" },
  { id: "anthropic/claude-opus-5", name: "Opus 5", tier: "S+", icon: "anthropic.png" },
  { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", tier: "S+", icon: "openai.png" },
  { id: "anthropic/claude-fable-5", name: "Fable 5", tier: "S", icon: "anthropic.png" },
  { id: "meta/muse-spark-1.3", name: "Muse Spark 1.3", tier: "S", icon: "meta.png" },
  { id: "openai/gpt-6-sol", name: "GPT-6 Sol", tier: "S", icon: "openai.png" },
  { id: "x-ai/grok-4.7", name: "Grok 4.7", tier: "S", icon: "grok.png" },
  { id: "xiaomi/mimo-v2.6-pro", name: "MiMo-V2.6-Pro", tier: "S", icon: "xiaomi.png" },
  { id: "x-ai/grok-4.6", name: "Grok 4.6", tier: "S", icon: "grok.png" },
  { id: "z-ai/glm-5.3", name: "GLM-5.3", tier: "A", icon: "zai.png" },
  { id: "moonshotai/kimi-k3", name: "Kimi K3", tier: "A", icon: "kimi.png" },
  { id: "openai/gpt-5.6-terra", name: "GPT 5.6 Terra", tier: "A", icon: "openai.png" },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", tier: "A", icon: "gemini.png" },
  { id: "qwen/qwen3.8-2.4t-a95b", name: "Qwen3.8-2.4T-A95B", tier: "A", icon: "qwen.png" },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    tier: "A",
    icon: "deepseek.png",
  },
  { id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", tier: "A", icon: "gemini.png" },
  { id: "anthropic/claude-sonnet-5", name: "Sonnet 5", tier: "A", icon: "anthropic.png" },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna", tier: "A", icon: "openai.png" },
  { id: "xiaomi/mimo-v2.6-flash", name: "MiMo-V2.6-Flash", tier: "A", icon: "xiaomi.png" },
  { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna", tier: "A", icon: "openai.png" },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    name: "DeepSeek V4 Pro 0813",
    tier: "A",
    icon: "deepseek.png",
  },
  { id: "z-ai/glm-5.2", name: "GLM-5.2", tier: "A", icon: "zai.png" },
  { id: "z-ai/glm-5.3-flash", name: "GLM-5.3-Flash", tier: "B", icon: "zai.png" },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", tier: "B", icon: "gemini.png" },
  { id: "minimax/minimax-m3", name: "MiniMax-M3", tier: "B", icon: "minimax.png" },
  {
    id: "google/gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    tier: "B",
    icon: "gemini.png",
  },
];

export interface LocalOptions {
  baseUrl: string;
  model: string;
  contextWindow: number;
  /** A hosted OpenAI-compatible model the app switches to while the local server is down. */
  fallback?: FallbackOptions;
  /** A second, small local model on its own llama-server, e.g. for the quick model's one-shot jobs. */
  helper?: HelperOptions;
}

export interface HelperOptions {
  baseUrl: string;
  model: string;
  contextWindow: number;
}

export interface FallbackOptions {
  baseUrl: string;
  model: string;
  contextWindow: number;
  /** Env names pi-ai reads the bearer key from, first set wins. */
  apiKeyEnv: string[];
  /** USD per 1M tokens, for the cost telemetry. */
  cost: { input: number; output: number };
  /** Wire protocol; some hosted models only speak the Responses API (default openai-completions). */
  api?: "openai-completions" | "openai-responses";
  /** Extra request headers, e.g. a gateway's session or client id. */
  headers?: Record<string, string>;
}

export interface ModelCatalog {
  readonly models: MutableModels;
  readonly provider: "openrouter" | "faux" | "local";
  readonly defaultModel: ModelRef;
  list(): ModelInfo[];
  /** A catalog id to a pi-durable model reference; throws for ids outside the catalog. */
  ref(id: string): ModelRef;
  info(id: string): ModelInfo | undefined;
}

export function createModelCatalog(options: {
  provider: "openrouter" | "faux" | "local";
  installFaux?: (models: MutableModels) => void;
  defaultModel?: string;
  local?: LocalOptions;
}): ModelCatalog {
  const models = createModels();
  if (options.provider === "local") return localCatalog(models, options.local);
  if (options.provider === "faux") {
    if (!options.installFaux) throw new Error("A faux catalog needs installFaux");
    options.installFaux(models);
    const free = {
      provider: "faux",
      contextWindow: FAUX_WINDOW,
      reasoning: false,
      cost: { input: 0, output: 0 },
    };
    const all: ModelInfo[] = [
      { id: FAUX_MODEL, name: "Faux Haiku", tier: "T", icon: "lab.png", ...free },
      ...CATALOG.map((c) => ({ ...c, ...free })),
    ];
    return {
      models,
      provider: "faux",
      defaultModel: { provider: "faux", modelId: FAUX_MODEL },
      list: () => all,
      ref: (id) => {
        if (!all.some((m) => m.id === id))
          throw new Error(
            `Unknown model ${id}. The faux catalog mirrors the ${CATALOG.length} catalog models plus ${FAUX_MODEL}.`,
          );
        return { provider: "faux", modelId: id };
      },
      info: (id) => all.find((m) => m.id === id),
    };
  }
  const provider = openrouterProvider();
  models.setProvider(provider);
  const known = provider.getModels();
  const missing = CATALOG.filter((c) => !known.some((m) => m.id === c.id)).map((c) => c.id);
  if (missing.length) throw new Error(`OpenRouter catalog is missing: ${missing.join(", ")}`);
  const list = () =>
    CATALOG.map((c) => {
      const m = known.find((x) => x.id === c.id)!;
      return {
        ...c,
        provider: "openrouter",
        contextWindow: m.contextWindow,
        reasoning: m.reasoning,
        cost: { input: m.cost.input, output: m.cost.output },
      };
    });
  const defaultId = options.defaultModel ?? DEFAULT_MODEL;
  const ref = (id: string): ModelRef => {
    if (!CATALOG.some((c) => c.id === id))
      throw new Error(`Unknown model ${id}. Pick one of the ${CATALOG.length} catalog models.`);
    return { provider: "openrouter", modelId: id };
  };
  return {
    models,
    provider: "openrouter",
    defaultModel: ref(defaultId),
    list,
    ref,
    info: (id) => list().find((m) => m.id === id),
  };
}

function localCatalog(models: MutableModels, local: LocalOptions | undefined): ModelCatalog {
  if (!local)
    throw new Error("A local catalog needs local options (baseUrl, model, contextWindow)");
  models.setProvider(llamaProvider("local", "Local llama.cpp", local));
  const helper = local.helper;
  if (helper) models.setProvider(llamaProvider("helper", "Local helper llama.cpp", helper));
  const fallback = local.fallback;
  if (fallback)
    models.setProvider(
      createProvider({
        id: "fallback",
        name: "Hosted fallback",
        baseUrl: fallback.baseUrl,
        auth: { apiKey: envApiKeyAuth("Fallback endpoint key", fallback.apiKeyEnv) },
        models: [
          {
            id: fallback.model,
            name: fallback.model,
            api: fallback.api ?? "openai-completions",
            provider: "fallback",
            baseUrl: fallback.baseUrl,
            headers: fallback.headers,
            input: ["text"],
            cost: { ...fallback.cost, cacheRead: 0, cacheWrite: 0 },
            reasoning: false,
            contextWindow: fallback.contextWindow,
            maxTokens: 8192,
          },
        ],
        api: fallback.api === "openai-responses" ? openAIResponsesApi() : openAICompletionsApi(),
      }),
    );
  const info: ModelInfo = {
    id: local.model,
    name: local.model,
    tier: "L",
    icon: "qwen.png",
    provider: "local",
    contextWindow: local.contextWindow,
    reasoning: false,
    cost: { input: 0, output: 0 },
  };
  const fallbackInfo: ModelInfo | undefined = fallback && {
    id: fallback.model,
    name: fallback.model,
    tier: "L",
    icon: "qwen.png",
    provider: "fallback",
    contextWindow: fallback.contextWindow,
    reasoning: false,
    cost: fallback.cost,
  };
  const helperInfo: ModelInfo | undefined = helper && {
    id: helper.model,
    name: helper.model,
    tier: "L",
    icon: "lab.png",
    provider: "helper",
    contextWindow: helper.contextWindow,
    reasoning: false,
    cost: { input: 0, output: 0 },
  };
  const all = [info, fallbackInfo, helperInfo].filter((m): m is ModelInfo => m !== undefined);
  const ref = (id: string): ModelRef => {
    if (id === local.model) return { provider: "local", modelId: id };
    if (fallback && id === fallback.model) return { provider: "fallback", modelId: id };
    if (helper && id === helper.model) return { provider: "helper", modelId: id };
    throw new Error(
      `Unknown model ${id}. The local catalog serves ${all.map((m) => m.id).join(", ")}.`,
    );
  };
  return {
    models,
    provider: "local",
    defaultModel: ref(local.model),
    list: () => all,
    ref,
    info: (id) => all.find((m) => m.id === id),
  };
}

/** One free text model on a llama-server; it ignores the key, DNA_LOCAL_API_KEY=local satisfies pi-ai's auth. */
function llamaProvider(id: string, name: string, endpoint: HelperOptions) {
  return createProvider({
    id,
    name,
    baseUrl: endpoint.baseUrl,
    auth: { apiKey: envApiKeyAuth("Local endpoint key", ["DNA_LOCAL_API_KEY"]) },
    models: [
      {
        id: endpoint.model,
        name: endpoint.model,
        api: "openai-completions",
        provider: id,
        baseUrl: endpoint.baseUrl,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: false,
        contextWindow: endpoint.contextWindow,
        maxTokens: 8192,
      },
    ],
    api: openAICompletionsApi(),
  });
}
