// Which server answers for the local agent model: the local llama.cpp server while it is reachable, otherwise the
// hosted fallback (DNA_FALLBACK_*), capped per day so a long outage cannot run up a bill. Checked once per sweep.
import type { Context } from "@earendil-works/chord";
import type { Conversation } from "@earendil-works/pi-durable";

export type Route = "local" | "fallback" | "down";

/** What the sweep and the agents need from the route (AgentModelRoute; tests pass a stub). */
export interface AgentRoute {
  ensure(main: Conversation, ctx: Context): Promise<Route>;
  modelFor(id: string): string;
}

export interface ModelRouteOptions {
  localModel: string;
  fallbackModel?: string;
  /** Fallback sweeps per calendar day. */
  dailyCap: number;
  /** True when the local server answers its health check. */
  probe: () => Promise<boolean>;
  /** Calendar day key for the cap; tests replace it. */
  day?: () => string;
}

export class ModelRoute {
  private state: Route = "local";
  private used = { day: "", count: 0 };

  constructor(private readonly options: ModelRouteOptions) {}

  async check(): Promise<Route> {
    const { fallbackModel, dailyCap, probe } = this.options;
    if (await probe()) return (this.state = "local");
    const day = (this.options.day ?? (() => new Date().toISOString().slice(0, 10)))();
    if (this.used.day !== day) this.used = { day, count: 0 };
    if (!fallbackModel || this.used.count >= dailyCap) return (this.state = "down");
    this.used.count++;
    return (this.state = "fallback");
  }

  /** The model id to run for a configured id: the local model maps to the fallback while the route is "fallback". */
  modelFor(id: string): string {
    return this.state === "fallback" && id === this.options.localModel && this.options.fallbackModel
      ? this.options.fallbackModel
      : id;
  }
}

/** llama-server's /health next to its /v1 base URL. */
export function localProbe(baseUrl: string, timeoutMs = 3000): () => Promise<boolean> {
  const url = `${baseUrl.replace(/\/v1\/?$/, "")}/health`;
  return async () => {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok;
    } catch {
      return false;
    }
  };
}

/** The route applied to the running agent: the main conversation switches models when the route changes. */
export class AgentModelRoute {
  private applied?: string;

  constructor(
    private readonly route: ModelRoute,
    private readonly deps: {
      catalog: { ref(id: string): { provider: string; modelId: string } };
      /** The model the reader picked (settings), which the route may stand in for. */
      selected: () => string;
      log?: { info(event: string, data: Record<string, unknown>): void };
    },
  ) {}

  modelFor(id: string): string {
    return this.route.modelFor(id);
  }

  async ensure(main: Pick<Conversation, "configure">, ctx: Context): Promise<Route> {
    const route = await this.route.check();
    const selected = this.deps.selected();
    const want = this.route.modelFor(selected);
    if (want !== (this.applied ?? selected)) {
      await main.configure({ model: this.deps.catalog.ref(want) }, ctx);
      this.deps.log?.info("agent.model_route", { route, model: want });
    }
    this.applied = want;
    return route;
  }
}
