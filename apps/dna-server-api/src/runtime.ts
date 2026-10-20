// Open everything the server runs: dna.sqlite, the Judge, search, images, the durable Harness with both agents,
// the telemetry projector, and the root news-desk conversation. Close it all on shutdown.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Conversation, SubmissionId } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { JevClient, LocalJev, loadManifest, TEMPLATE_SHA, type Decide } from "@dna/jev";
import type { CompactionState } from "@dna/sdk";
import {
  createModelCatalog,
  DEFAULT_POINTS,
  fit,
  fits,
  installScriptedFaux,
  openDurableHarness,
  startProjector,
  toPolicy,
  type CompactionPoints,
  type DurableHarness,
} from "@dna/durable-agent";
import { createLogger, type Logger } from "@dna/sdk/node";
import { createAgents, type Agents } from "./agents/index.ts";
import { fauxRules } from "./agents/faux-script.ts";
import type { Config } from "./config.ts";
import { openStore } from "./db/store.ts";
import { AgentModelRoute, localProbe, ModelRoute } from "./agents/model-route.ts";
import type { Deps } from "./deps.ts";
import { Bus } from "./events.ts";
import { Dates } from "./news/dates.ts";
import { fixtureDecide, fixtureHttp } from "./news/fixtures.ts";
import { jsonlCapture } from "./news/capture.ts";
import { Judge } from "./news/hfs.ts";
import { JudgeRuntime, shellSession, withRuntime } from "./news/judge-runtime.ts";
import { liveHttp } from "./news/http.ts";
import { Images } from "./news/images.ts";
import { Quick } from "./news/quick.ts";
import { fauxTracker, ghTracker } from "./news/issues.ts";
import { codeGraph, fauxGraph } from "./news/graph.ts";
import { Schedule } from "./news/schedule.ts";
import { closeStalledSweeps, withdrawStuckSweeps } from "./news/sweep.ts";
import { SearchService } from "./news/search/index.ts";

export interface CompactionSetting {
  points: CompactionPoints;
  enabled: boolean;
}

export interface App extends Deps {
  harness: DurableHarness;
  ctx: Context;
  agents: Agents;
  main: Conversation;
  compaction: CompactionSetting;
  /** The main agent's model id and context window, read live. */
  mainModel(): Promise<{ id: string; window: number }>;
  setCompaction(next: Partial<CompactionSetting>): CompactionSetting;
  /** The points, the switch, and the main model's window the points must fit. */
  compactionState(): CompactionState;
  /** Re-read the main model's window after a model change; refit saved points that no longer fit. */
  refreshModel(): Promise<{ id: string; window: number }>;
  readonly startedAt: number;
  close(): Promise<void>;
}

function decideFor(config: Config): { decide: Decide; judgeRuntime?: JudgeRuntime } {
  if (config.jevBackend === "fixture") return { decide: fixtureDecide() };
  if (config.jevBackend === "local") {
    // node:test never touches a GPU session or a real judge: the same isolation JevClient.selectProvider applies.
    if (process.env.NODE_TEST_CONTEXT && process.env.JEV_LIVE !== "1") {
      const mock = new JevClient({ provider: "mock" });
      return { decide: (state, questions, opts) => mock.systemOne(state, questions, opts) };
    }
    const manifest = loadManifest(config.jevManifest);
    // Refuse at startup, before the first jev call would preempt the GPU for a judge that cannot be used.
    if (manifest.template_sha !== TEMPLATE_SHA)
      throw new Error(
        `Judge ${manifest.version} (${config.jevManifest}) was trained on template ${manifest.template_sha.slice(0, 12)}, the runtime renders ${TEMPLATE_SHA.slice(0, 12)}. Retrain or roll back judge-prompt.ts.`,
      );
    const jev = new LocalJev({ baseUrl: config.jevLocalBaseUrl, manifest });
    let ready: Promise<void> | undefined;
    const judgeRuntime = new JudgeRuntime({ session: shellSession(config.gpuSessionBin) });
    const decide: Decide = async (state, questions, opts) => {
      // init needs the server up, so it runs after the first acquire and is reused afterwards.
      ready ??= jev.init().catch((error) => {
        ready = undefined;
        throw error;
      });
      await ready;
      return jev.systemOne(state, questions, opts);
    };
    return { decide: withRuntime(judgeRuntime, decide), judgeRuntime };
  }
  const client =
    config.jevBackend === "auto" ? new JevClient() : new JevClient({ provider: config.jevBackend });
  return { decide: (state, questions, opts) => client.systemOne(state, questions, opts) };
}

export async function openApp(
  config: Config,
  options: { log?: Logger; /** Tests: replace the jev backend. */ decide?: Decide } = {},
): Promise<App> {
  mkdirSync(config.dataDir, { recursive: true });
  const log = options.log ?? createLogger("api").child({ device: config.device });
  const store = openStore(config.dataDir, config.configDir);
  const http = config.searchMode === "fixture" ? fixtureHttp() : liveHttp(log);
  const catalog = createModelCatalog({
    provider: config.provider,
    installFaux: (models) => installScriptedFaux(models, fauxRules()),
    defaultModel: config.provider === "openrouter" ? config.model : undefined,
    local:
      config.provider === "local"
        ? {
            baseUrl: config.localBaseUrl,
            model: config.model,
            contextWindow: config.localContextWindow,
            fallback: config.fallback && {
              baseUrl: config.fallback.baseUrl,
              model: config.fallback.model,
              // Same window as local, so compaction points stay valid when a sweep switches models.
              contextWindow: config.localContextWindow,
              apiKeyEnv: ["DNA_FALLBACK_API_KEY", "META_API_KEY"],
              cost: config.fallback.cost,
            },
          }
        : undefined,
  });
  const route =
    config.provider === "local" && config.fallback
      ? new AgentModelRoute(
          new ModelRoute({
            localModel: config.model,
            fallbackModel: config.fallback.model,
            dailyCap: config.fallback.dailySweeps,
            minIntervalMs: config.fallback.minIntervalMinutes * 60_000,
            lastFallback: {
              get: () => store.settings.get<number | undefined>("fallbackLastSweepAt", undefined),
              set: (ms) => store.settings.set("fallbackLastSweepAt", ms),
            },
            probe: localProbe(config.localBaseUrl),
          }),
          { catalog, selected: () => store.settings.get("model", config.model), log },
        )
      : undefined;
  const { decide, judgeRuntime } = options.decide
    ? { decide: options.decide, judgeRuntime: undefined }
    : decideFor(config);
  const judge = new Judge({
    decide,
    capture: config.jevCapture ? jsonlCapture(config.jevCapture, log) : undefined,
    store,
    log,
    dir: join(config.promptsDir, "jev"),
  });
  const search = new SearchService(
    { http, store, log },
    {
      mode: config.searchMode,
      firecrawlKey: config.firecrawlKey,
      sweepCap: config.sweepCredits,
      dailyCap: config.dailyCredits,
    },
  );
  const images = new Images({
    store,
    http,
    log,
    dataDir: config.dataDir,
    promptsDir: config.promptsDir,
    model: config.imageModel,
    openaiKey: config.openaiKey,
    quality: config.imageQuality,
    offline: config.provider === "faux" || config.searchMode === "fixture",
  });
  const bus = new Bus();
  const quick = new Quick({ catalog, store, log, route });
  const dates = new Dates({ http, store, log, quick });
  const deps: Deps = {
    config,
    log,
    store,
    bus,
    judge,
    search,
    images,
    http,
    catalog,
    quick,
    dates,
    schedule: new Schedule({ store, cronSchedule: config.cronSchedule }),
    issues:
      config.issueTracker === "faux" ? fauxTracker(config.issueRepo) : ghTracker(config.issueRepo),
    graph:
      config.investigate === "faux"
        ? fauxGraph(config.investigateRepos)
        : codeGraph(config.investigateRepos),
    investigateProbe:
      config.provider === "faux" ? async () => true : localProbe(config.localBaseUrl),
    route,
  };
  const agents = createAgents(deps);

  const compaction: CompactionSetting = store.settings.get("compaction", {
    points: DEFAULT_POINTS,
    enabled: true,
  });
  let window = 1_000_000;
  const harness = await openDurableHarness({
    dbPath: join(config.dataDir, "agent.sqlite"),
    catalog,
    extensions: agents.all,
    defaults: agents.defaults,
    compaction: () => toPolicy(window, compaction.points, compaction.enabled),
    logger: log,
  });
  const stopProjector = startProjector(harness.harness, store.telemetry, log);
  const ctx = harness.ctx;
  const main = await harness.harness.root(ctx, {
    agent: { model: catalog.defaultModel, thinkingLevel: "low" },
  });
  const mainModel = async () => {
    const agent = await main.agent(ctx);
    const id = agent.model?.modelId ?? catalog.defaultModel.modelId;
    return { id, window: catalog.info(id)?.contextWindow ?? 1_000_000 };
  };
  window = (await mainModel()).window;
  harness.harness.resume();

  const stallTimer = setInterval(() => {
    closeStalledSweeps({ store, log, config, bus });
    withdrawStuckSweeps(
      { store, log, bus },
      {
        mainId: main.id as number,
        withdraw: (id) => harness.harness.abortSubmission(id as SubmissionId, ctx, main.id),
      },
    ).catch((error) => log.warn("sweep.withdraw_failed", { error: String(error) }));
  }, 60_000);
  stallTimer.unref();

  log.info("app.opened", {
    device: config.device,
    provider: config.provider,
    model: (await mainModel()).id,
    searchMode: search.mode,
    jev: config.jevBackend,
    dataDir: config.dataDir,
    mainConversation: main.id,
  });

  return Object.assign(deps, {
    harness,
    ctx,
    agents,
    main,
    compaction,
    mainModel,
    startedAt: Date.now(),
    compactionState: () => ({ ...compaction.points, enabled: compaction.enabled, window }),
    async refreshModel() {
      const model = await mainModel();
      window = model.window;
      if (!fits(window, compaction.points)) {
        const before = compaction.points;
        compaction.points = fit(window, compaction.points);
        store.settings.set("compaction", compaction);
        log.warn("agent.compaction_refit", {
          model: model.id,
          window,
          before,
          after: compaction.points,
        });
      }
      return model;
    },
    setCompaction(next: Partial<CompactionSetting>) {
      if (next.points) compaction.points = next.points;
      if (next.enabled !== undefined) compaction.enabled = next.enabled;
      store.settings.set("compaction", compaction);
      log.info("agent.compaction_set", { ...compaction.points, enabled: compaction.enabled });
      return { ...compaction };
    },
    async close() {
      clearInterval(stallTimer);
      await judgeRuntime?.close();
      stopProjector();
      await harness.close();
      store.close();
      log.info("app.closed", {});
    },
  });
}
