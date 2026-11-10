// dna net <verb> [device]: one set of verbs for every device kind, driven by dna-network.yaml.
import { spawnSync } from "node:child_process";
import { device, hubPort, loadNetwork, type NetDevice, type Network } from "@dna/sdk/node";
import { local, type Step } from "./local.ts";
import { remote } from "./ops.ts";
import { remoteDriver, tunnel } from "./remote.ts";

export const NET_VERBS = [
  "status",
  "probe",
  "up",
  "deploy",
  "down",
  "restart",
  "cron",
  "logs",
  "tunnel",
  "browser",
  "destroy",
  "step",
  "inventory",
] as const;

type Tokens = { client?: string; cron?: string };
const print = (s: Step) =>
  process.stderr.write(`${s.ok ? "pass" : "FAIL"}  ${s.step}: ${s.detail}\n`);

export interface UiStatus {
  url: string;
  running: boolean;
  /** Served by the device itself (its hub service), not by a hub on this laptop. */
  hosted: boolean;
  /** Behind the exe.dev login. */
  private: boolean;
}

const hubDevice = async (url: string, init?: RequestInit) => {
  try {
    const r = await fetch(`${url}/hub/healthz`, { ...init, signal: AbortSignal.timeout(2500) });
    return ((await r.json()) as { device?: string }).device;
  } catch {
    return undefined;
  }
};

/**
 * The device's browser UI and whether it answers: the device's own hub when it serves one (checked on the device
 * over ssh when the URL is private), else a hub on this laptop at the device's hub_port.
 */
async function uiOf(d: NetDevice): Promise<UiStatus> {
  if (d.ui) {
    const priv = d.kind === "exe-dev";
    const running = priv
      ? (
          await remote(d, `curl -s -m 3 http://127.0.0.1:${d.ui.port}/hub/healthz`, {
            allowFail: true,
            timeoutMs: 20_000,
          }).catch(() => ({ stdout: "" }))
        ).stdout.includes(`"device":"${d.id}"`)
      : (await hubDevice(d.ui.url)) === d.id;
    return { url: d.ui.url, running, hosted: true, private: priv };
  }
  const url = `http://localhost:${hubPort(d)}`;
  return {
    url,
    running: (await hubDevice(`http://127.0.0.1:${hubPort(d)}`)) === d.id,
    hosted: false,
    private: false,
  };
}

/** Opens the device's UI in Chrome, else the default browser. A device without its own UI needs its laptop hub first. */
async function openBrowser(d: NetDevice): Promise<Step> {
  const ui = await uiOf(d);
  if (!ui.running)
    return {
      step: "browser",
      ok: false,
      detail: ui.hosted
        ? `${d.id} UI is not answering at ${ui.url}: just net up ${d.id}`
        : `no hub on ${ui.url}: just browser start ${d.id}`,
    };
  const tries: [string, string[]][] =
    process.platform === "darwin"
      ? [
          ["open", ["-a", "Google Chrome", ui.url]],
          ["open", [ui.url]],
        ]
      : [["xdg-open", [ui.url]]];
  for (const [cmd, args] of tries)
    if (spawnSync(cmd, args).status === 0) return { step: "browser", ok: true, detail: ui.url };
  return { step: "browser", ok: false, detail: `could not open a browser, visit ${ui.url}` };
}

/** Device status: API checks plus the UI. Renamed off `statusOf` to not collide with probe.ts's fetch helper. */
async function deviceStatusOf(d: NetDevice, tokens: Tokens) {
  const [status, ui] = await Promise.all([
    d.kind === "local" ? local.status(d, tokens) : remoteDriver.status(d, tokens),
    uiOf(d),
  ]);
  return { ...status, ui };
}

export interface InventoryRow {
  device: string;
  kind: string;
  url: string;
  hub: number;
  ui: string;
}

/** The map table: every device, its kind, API URL, laptop hub port and UI URL. Pure: no probes, no ssh. */
export function inventory(network: Network = loadNetwork()): InventoryRow[] {
  return Object.values(network.devices).map((d) => ({
    device: d.id,
    kind: d.kind,
    url: d.url,
    hub: hubPort(d),
    ui: d.ui?.url ?? `http://localhost:${hubPort(d)}`,
  }));
}

export async function net(verb: string, args: string[], tokens: Tokens): Promise<unknown> {
  const network = loadNetwork();
  if (verb === "inventory" && !args[0]) return inventory(network);
  if (verb === "status" && !args[0]) {
    const out = [];
    for (const d of Object.values(network.devices)) {
      try {
        out.push(await deviceStatusOf(d, tokens));
      } catch (error) {
        out.push({
          device: d.id,
          url: d.url,
          online: false,
          ui: await uiOf(d),
          error: String((error as Error).message),
        });
      }
    }
    return out;
  }
  if (verb === "step") {
    const [stepName, id] = args;
    if (!stepName || !id) throw new Error("Usage: dna net step <verb> <device>");
    const d = device(network, id);
    if (d.kind === "local") throw new Error("Steps run on ssh and exe-dev devices");
    return [await remoteDriver.step(stepName, d, tokens, args.slice(2))];
  }
  const id = args[0];
  if (!id) throw new Error(`Usage: dna net ${verb} <device>`);
  const d = device(network, id);
  if (verb === "browser") return [await openBrowser(d)];
  if (d.kind === "local") {
    switch (verb) {
      case "status":
        return [await deviceStatusOf(d, tokens)];
      case "probe":
        return local.probe(d, tokens);
      case "up":
        return local.up(d, tokens);
      case "deploy":
        return [
          {
            step: "deploy",
            ok: true,
            detail: "local runs this checkout; restart to pick up changes",
          },
        ];
      case "down":
        return local.down();
      case "restart":
        return [...(await local.down()), ...(await local.up(d, tokens))];
      case "cron":
        return local.cron(cronAction(args[1]));
      case "logs":
        return local.logs(args[1] ?? "api", Number(args[2] ?? 40));
      case "tunnel":
        return [{ step: "tunnel", ok: true, detail: "local needs no tunnel" }];
      default:
        throw new Error(`${verb} does not apply to local. Verbs: ${NET_VERBS.join(", ")}`);
    }
  }
  switch (verb) {
    case "status":
      return [await deviceStatusOf(d, tokens)];
    case "probe":
      return remoteDriver.probe(d, tokens);
    case "up":
      return remoteDriver.up(d, tokens, print);
    case "deploy":
      return remoteDriver.deploy(d, tokens);
    case "down":
      return remoteDriver.down(d);
    case "restart":
      return remoteDriver.restart(d);
    case "cron":
      return [await remoteDriver.cron(d, cronAction(args[1]))];
    case "logs":
      return remoteDriver.logs(d, args[1] ?? "api", Number(args[2] ?? 40));
    case "tunnel":
      return [await tunnel(d)];
    case "destroy":
      if (d.kind !== "exe-dev")
        throw new Error(`destroy only removes exe-dev VMs; ${d.id} is ${d.kind}`);
      return [await remoteDriver.step("destroy", d, tokens, args.slice(1))];
    default:
      throw new Error(`Unknown net verb ${verb}. Use: ${NET_VERBS.join(", ")}`);
  }
}

function cronAction(value: string | undefined): "install" | "remove" | "status" {
  const action = value ?? "status";
  if (action !== "install" && action !== "remove" && action !== "status")
    throw new Error("Usage: dna net cron <device> install|remove|status");
  return action;
}
