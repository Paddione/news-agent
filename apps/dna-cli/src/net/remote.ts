// The ssh and exe-dev drivers. Drivers know kinds and services, never machines: every machine fact comes from
// dna-network.yaml. `up` runs provision, deploy, env, service, cron, expose (exe-dev), wait and probe.
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import { repoRoot, type NetDevice } from "@dna/sdk/node";
import type { Step } from "./local.ts";
import { probe } from "./probe.ts";
import { exeDev, q, remote, rsync, run, shPath, sleep, sshTarget } from "./ops.ts";

export const LABEL = "dev.dna.api";
export const UNIT = "dna-api";
/** The hub service on devices that serve their own UI (d.ui). */
export const HUB_LABEL = "dev.dna.hub";
export const HUB_UNIT = "dna-hub";
const NVM_INSTALL = "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh";
const root = () => repoRoot();

function localEnv(): Record<string, string> {
  // Native parser (same engine process.loadEnvFile uses) instead of the
  // hand-rolled line regex: no process.env side effects, so the
  // DNA_ENV_FILE=none escape hatch keeps working. Deliberately NOT
  // loadRootEnv(), which would publish every .env key into process.env.
  const file = join(root(), ".env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8"))))
    if (v !== undefined) out[k] = v;
  return out;
}

async function facts(d: NetDevice) {
  const out = (
    await remote(
      d,
      `echo "HOME=$HOME"; echo "USER=$(id -un)"; echo "NODE=$(nvm which ${d.node} 2>/dev/null || true)"`,
    )
  ).stdout;
  const get = (k: string) => out.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  return { home: get("HOME"), user: get("USER"), node: get("NODE") };
}
const abs = (p: string, home: string) =>
  p === "~" ? home : p.startsWith("~/") ? `${home}/${p.slice(2)}` : p;
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/__([A-Z_]+)__/g, (m, key: string) => {
    if (!(key in values)) throw new Error(`Template placeholder ${m} has no value`);
    return values[key];
  });

// ------------------------------------------------------------------ steps

export async function provision(d: NetDevice): Promise<Step> {
  const apt =
    d.kind === "exe-dev"
      ? `if command -v apt-get >/dev/null; then sudo -n apt-get update -qq >/dev/null && sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git rsync curl build-essential >/dev/null; fi\n`
      : "";
  const out = await remote(
    d,
    `${apt}if [ ! -s "$NVM_DIR/nvm.sh" ]; then curl -fsSL ${NVM_INSTALL} | PROFILE=/dev/null bash >/dev/null; fi
. "$NVM_DIR/nvm.sh"
nvm install ${d.node} >/dev/null 2>&1
echo "node $(nvm which ${d.node})"`,
    { timeoutMs: 900_000 },
  );
  return { step: "provision", ok: true, detail: out.stdout.trim().split("\n").pop() ?? "" };
}

export async function deploy(d: NetDevice): Promise<Step> {
  await remote(d, `mkdir -p "${shPath(d.codeDir)}/logs" "${shPath(d.codeDir)}/data"`);
  await rsync(d, root(), d.codeDir.replace(/^~\//, ""));
  await remote(
    d,
    `cd "${shPath(d.codeDir)}" && { [ -f apps/package.json ] || rm -rf apps/node_modules; } && nvm exec ${d.node} npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1${d.ui ? ` && nvm exec ${d.node} npm run build -w dna-client-browser >/dev/null 2>&1` : ""} && echo installed`,
    { timeoutMs: 900_000 },
  );
  return {
    step: "deploy",
    ok: true,
    detail: `synced the repo to ${d.codeDir} and ran npm ci${d.ui ? ", built the UI" : ""}`,
  };
}

/** <code_dir>/.env from env_keys plus the device's own settings. Secrets travel on stdin, mode 600. */
export async function writeEnv(d: NetDevice): Promise<Step> {
  const local = localEnv();
  const missing = d.envKeys.filter((k) => !(local[k] ?? process.env[k]));
  const body = [
    `DNA_DEVICE_NAME=${d.id}`,
    `DNA_DEVICE_LABEL=${d.name.replace(/[\n\r]/g, " ")}`,
    `DNA_HOST=0.0.0.0`,
    `DNA_PORT=${d.port}`,
    `DNA_CRON_SCHEDULE=${d.cron}`,
    ...d.envKeys.flatMap((k) => {
      const v = local[k] ?? process.env[k];
      return v && !/[\n\r]/.test(v) ? [`${k}=${v}`] : [];
    }),
  ].join("\n");
  await remote(
    d,
    `umask 077
F="${shPath(d.codeDir)}/.env"
cat > "$F.tmp" <<'DNA_ENV_EOF'
${body}
DNA_ENV_EOF
mv "$F.tmp" "$F"
chmod 600 "$F"
echo ok`,
  );
  return {
    step: "env",
    ok: missing.length === 0,
    detail: `${d.codeDir}/.env written with ${d.envKeys.length - missing.length} keys${missing.length ? `, missing ${missing.join(", ")}` : ""}`,
  };
}

/** Write one launchd agent or systemd unit from a template and (re)start it. */
async function installUnit(
  d: NetDevice,
  template: { dir: string; plist: string; unit: string },
  label: string,
  unit: string,
  values: Record<string, string>,
) {
  if (d.service === "launchd") {
    const plist = fill(readFileSync(join(template.dir, template.plist), "utf8"), values);
    await remote(
      d,
      `P="$HOME/Library/LaunchAgents/${label}.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$P" <<'DNA_PLIST_EOF'
${plist}
DNA_PLIST_EOF
launchctl bootout gui/$(id -u)/${label} 2>/dev/null || true
# The old process can take a while to drain its streams; wait until launchd lets go of the label.
for i in $(seq 1 30); do launchctl print gui/$(id -u)/${label} >/dev/null 2>&1 || break; sleep 1; done
for i in $(seq 1 20); do launchctl bootstrap gui/$(id -u) "$P" 2>/dev/null && break; sleep 1; done
launchctl print gui/$(id -u)/${label} >/dev/null && echo ok`,
    );
  } else {
    const text = fill(readFileSync(join(template.dir, template.unit), "utf8"), values);
    await remote(
      d,
      `sudo -n tee /etc/systemd/system/${unit}.service >/dev/null <<'DNA_UNIT_EOF'
${text}
DNA_UNIT_EOF
sudo -n systemctl daemon-reload
sudo -n systemctl enable ${unit} >/dev/null 2>&1
sudo -n systemctl restart ${unit}
echo ok`,
    );
  }
}

/** The API service, plus the hub service on devices that serve their own UI. */
export async function installService(d: NetDevice): Promise<Step> {
  const f = await facts(d);
  if (!f.node)
    throw new Error(`${d.id}: node ${d.node} not found; run: just net step provision ${d.id}`);
  const code = abs(d.codeDir, f.home);
  const base = {
    NODE: f.node,
    HOME: f.home,
    USER: f.user,
    PATH: `${f.node.replace(/\/node$/, "")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  await installUnit(
    d,
    {
      dir: join(root(), "apps/dna-server-api/deploy"),
      plist: "dna-api.plist",
      unit: "dna-api.service",
    },
    LABEL,
    UNIT,
    { ...base, LABEL, UNIT, APP: `${code}/apps/dna-server-api`, LOG: `${code}/logs/api.out` },
  );
  if (d.ui)
    await installUnit(
      d,
      {
        dir: join(root(), "apps/dna-client-browser/deploy"),
        plist: "dna-hub.plist",
        unit: "dna-hub.service",
      },
      HUB_LABEL,
      HUB_UNIT,
      {
        ...base,
        LABEL: HUB_LABEL,
        APP: `${code}/apps/dna-client-browser`,
        LOG: `${code}/logs/hub.out`,
        DEVICE: d.id,
        HUB_PORT: String(d.ui.port),
        HUB_HOSTS: new URL(d.ui.url).host,
        API_URL: `http://127.0.0.1:${d.port}`,
      },
    );
  const names =
    d.service === "launchd"
      ? [LABEL, ...(d.ui ? [HUB_LABEL] : [])]
      : [UNIT, ...(d.ui ? [HUB_UNIT] : [])];
  return { step: "service", ok: true, detail: `${d.service} ${names.join(" and ")} run ${f.node}` };
}

/** Restart or stop the API service, and the hub service too with `withHub` on devices that serve their UI. */
async function serviceCommand(d: NetDevice, action: "restart" | "stop", withHub = false) {
  const hub = withHub && !!d.ui;
  if (d.service === "launchd")
    return remote(
      d,
      [LABEL, ...(hub ? [HUB_LABEL] : [])]
        .map((l) =>
          action === "restart"
            ? `launchctl kickstart -k gui/$(id -u)/${l}`
            : `launchctl bootout gui/$(id -u)/${l} 2>/dev/null || true`,
        )
        .join("\n"),
    );
  return remote(d, `sudo -n systemctl ${action} ${UNIT}${hub ? ` ${HUB_UNIT}` : ""}`);
}

export async function cron(d: NetDevice, action: "install" | "remove" | "status"): Promise<Step> {
  const verb = action === "remove" ? "uninstall" : action;
  const out = await remote(
    d,
    `cd "${shPath(d.codeDir)}/apps/dna-server-cron" && DNA_CRON_SCHEDULE=${q(d.cron)} NODE_NO_WARNINGS=1 nvm exec ${d.node} node --import tsx src/main.ts ${verb} 2>&1 | grep -v "^Running node"`,
  );
  return {
    step: "cron",
    ok: action !== "status" || /Installed:/.test(out.stdout),
    detail: out.stdout.trim(),
  };
}

/** exe.dev proxies one port per VM: the UI (the hub), private behind the exe.dev login. */
export async function expose(d: NetDevice): Promise<Step> {
  const port = d.ui?.port ?? d.port;
  await exeDev(["share", "port", d.vm!, String(port)]);
  await exeDev(["share", "set-private", d.vm!]);
  return {
    step: "expose",
    ok: true,
    detail: `https://${d.vm}.exe.xyz proxies :${port} and stays private (exe.dev login)`,
  };
}

/** The device's own UI answers on the device. */
export async function uiReady(d: NetDevice, seconds = 60): Promise<Step> {
  if (!d.ui)
    return { step: "ui", ok: true, detail: `${d.id} serves no UI (clients use a laptop hub)` };
  const out = await remote(
    d,
    `for i in $(seq 1 ${seconds}); do curl -sf http://127.0.0.1:${d.ui.port}/hub/healthz && exit 0; sleep 1; done; echo "no hub"; tail -20 "${shPath(d.codeDir)}/logs/hub.out"; exit 1`,
    { allowFail: true, timeoutMs: (seconds + 30) * 1000 },
  );
  return {
    step: "ui",
    ok: out.code === 0,
    detail:
      out.code === 0
        ? `${d.ui.url} ${d.kind === "exe-dev" ? "(private: exe.dev login)" : "(open to your network)"}`
        : out.stdout.trim().slice(-600),
  };
}

/** Wait for /healthz on the device itself, so it works before any tunnel exists. */
export async function waitHealthy(d: NetDevice, seconds = 90): Promise<Step> {
  const out = await remote(
    d,
    `for i in $(seq 1 ${seconds}); do curl -sf http://127.0.0.1:${d.port}/healthz && exit 0; sleep 1; done; echo "no healthz"; tail -20 "${shPath(d.codeDir)}/logs/api.out"; exit 1`,
    { allowFail: true, timeoutMs: (seconds + 30) * 1000 },
  );
  return {
    step: "wait",
    ok: out.code === 0,
    detail: out.code === 0 ? out.stdout.trim() : out.stdout.trim().slice(-600),
  };
}

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

/** A background ssh -L for devices with a tunnel (the private sandbox). Idempotent. */
export async function tunnel(d: NetDevice): Promise<Step> {
  if (!d.tunnel) return { step: "tunnel", ok: true, detail: `${d.id} needs no tunnel` };
  if (await portOpen(d.tunnel.local))
    return { step: "tunnel", ok: true, detail: `127.0.0.1:${d.tunnel.local} is already forwarded` };
  await run(
    "ssh",
    [
      "-f",
      "-N",
      "-o",
      "BatchMode=yes",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-L",
      `${d.tunnel.local}:127.0.0.1:${d.tunnel.remote}`,
      sshTarget(d),
    ],
    { timeoutMs: 30_000 },
  );
  for (let i = 0; i < 20 && !(await portOpen(d.tunnel.local)); i++) await sleep(250);
  return {
    step: "tunnel",
    ok: await portOpen(d.tunnel.local),
    detail: `127.0.0.1:${d.tunnel.local} forwards to ${d.ssh}:${d.tunnel.remote}`,
  };
}

/**
 * Leaf probe step: pure HTTP checks over `probe`, no tunnel/ssh work. Callers that need a
 * tunnel ensure it first (up/deploy/step), so this leaf never calls back into the deploy
 * chain and the module graph stays one-directional (deploy chain → probeStep → probe).
 */
export async function probeStep(
  d: NetDevice,
  tokens: { client?: string; cron?: string },
): Promise<Step> {
  const checks = await probe(d.url, tokens);
  return {
    step: "probe",
    ok: checks.every((c) => c.ok),
    detail: checks.map((c) => `${c.ok ? "pass" : "FAIL"} ${c.name} (${c.detail})`).join("; "),
  };
}

/** Tunnel-owning wrapper for the `probe` step verb: the tunnel lives here, never in the leaf. */
export async function probeStepWithTunnel(
  d: NetDevice,
  tokens: { client?: string; cron?: string },
): Promise<Step> {
  if (d.tunnel) await tunnel(d);
  return probeStep(d, tokens);
}

/**
 * The macOS privacy check: a probe LaunchAgent and a probe crontab line each read code_dir and write a timestamp.
 * The cron half runs the way the tick runs: /bin/bash on a script inside code_dir, then node with its cwd there.
 * If either is blocked, the device needs Full Disk Access for that program.
 */
export async function tcc(d: NetDevice): Promise<Step> {
  if (d.service !== "launchd") return { step: "tcc", ok: true, detail: `${d.id} is not a Mac` };
  const f = await facts(d);
  if (!f.node)
    throw new Error(`${d.id}: node ${d.node} not found; run: just net step provision ${d.id}`);
  const code = abs(d.codeDir, f.home);
  // The launchd half runs the same node binary the service runs; the cron half runs bash then node under cron, like the tick.
  const js = `const fs=require("fs");const o="${f.home}/.dna-tcc/launchd";try{fs.readdirSync("${code}");fs.writeFileSync("${code}/.tcc-launchd","x");fs.writeFileSync(o+".ok",String(Date.now()))}catch(e){fs.writeFileSync(o+".fail",String(e.message))}`;
  const out = await remote(
    d,
    `mkdir -p "${code}" "$HOME/.dna-tcc"
rm -f "$HOME/.dna-tcc/launchd.ok" "$HOME/.dna-tcc/launchd.fail" "$HOME/.dna-tcc/cron.ok" "$HOME/.dna-tcc/cron.fail"
cat > "${code}/.tcc-probe.sh" <<'EOF_PROBE'
#!/bin/bash
cd "$1" && ls >/dev/null 2>&1 && touch "$1/.tcc-cron" 2>/dev/null && "$2" -e "process.cwd()" 2>/dev/null && date +%s > "$HOME/.dna-tcc/cron.ok" || echo "blocked $(date +%s)" > "$HOME/.dna-tcc/cron.fail"
EOF_PROBE
P="$HOME/Library/LaunchAgents/dev.dna.tcc.plist"
cat > "$P" <<'EOF_PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>dev.dna.tcc</string>
<key>ProgramArguments</key><array><string>${f.node}</string><string>-e</string><string>${js.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string></array>
<key>RunAtLoad</key><true/></dict></plist>
EOF_PLIST
launchctl bootout gui/$(id -u)/dev.dna.tcc 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$P"
( crontab -l 2>/dev/null | grep -v "tcc-probe.sh" || true; echo "* * * * * /bin/bash ${code}/.tcc-probe.sh ${code} ${f.node} > /dev/null 2>&1" ) | crontab -
for i in $(seq 1 150); do { [ -f "$HOME/.dna-tcc/launchd.ok" ] || [ -f "$HOME/.dna-tcc/launchd.fail" ]; } && { [ -f "$HOME/.dna-tcc/cron.ok" ] || [ -f "$HOME/.dna-tcc/cron.fail" ]; } && break; sleep 1; done
{ crontab -l 2>/dev/null | grep -v "tcc-probe.sh" || true; } | crontab -
launchctl bootout gui/$(id -u)/dev.dna.tcc 2>/dev/null || true
rm -f "$P" "${code}/.tcc-launchd" "${code}/.tcc-cron" "${code}/.tcc-probe.sh" "$HOME/.dna-tcc/probe.sh"
echo "launchd $( [ -f $HOME/.dna-tcc/launchd.ok ] && echo ok || echo blocked )"
echo "cron $( [ -f $HOME/.dna-tcc/cron.ok ] && echo ok || echo blocked )"`,
    { timeoutMs: 240_000 },
  );
  const launchd = /launchd ok/.test(out.stdout);
  const cronOk = /cron ok/.test(out.stdout);
  const fix = [!launchd ? f.node : "", !cronOk ? "/usr/sbin/cron" : ""].filter(Boolean);
  return {
    step: "tcc",
    ok: launchd && cronOk,
    detail: `the service's node ${launchd ? "can" : "cannot"} read ${d.codeDir}, cron ${cronOk ? "can" : "cannot"}${fix.length ? `. On the Mac, add to System Settings, Privacy and Security, Full Disk Access (Cmd Shift G types a path): ${fix.join(" and ")}` : ""}`,
  };
}

// ------------------------------------------------------------------ exe.dev VM

async function exeVms(): Promise<string[]> {
  const out = await exeDev<{ vms?: { vm_name?: string }[] }>(["ls"]);
  return (out.vms ?? []).map((v) => v.vm_name ?? "");
}

export async function create(d: NetDevice): Promise<Step> {
  const vm = d.vm!;
  let detail = `VM ${vm} already exists`;
  if (!(await exeVms()).includes(vm)) {
    const c = d.create ?? {};
    await exeDev(
      [
        "new",
        `--name=${vm}`,
        "--no-email",
        ...(c.cpu ? [`--cpu=${c.cpu}`] : []),
        ...(c.memory ? [`--memory=${c.memory}`] : []),
        ...(c.disk ? [`--disk=${c.disk}`] : []),
      ],
      300_000,
    );
    detail = `created VM ${vm}`;
  }
  for (let i = 0; i < 40; i++) {
    const ok = await run(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
        sshTarget(d),
        "echo READY",
      ],
      { allowFail: true, timeoutMs: 20_000 },
    );
    if (ok.stdout.includes("READY"))
      return { step: "create", ok: true, detail: `${detail}, ssh ${d.ssh} ready` };
    await sleep(3000);
  }
  return { step: "create", ok: false, detail: `${d.ssh} never accepted ssh` };
}

export async function destroy(d: NetDevice, yes: boolean): Promise<Step> {
  const vm = d.vm!;
  if (!(await exeVms()).includes(vm))
    return { step: "destroy", ok: true, detail: `VM ${vm} does not exist` };
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Destroy exe.dev VM ${vm} and its disk? Type the VM name to confirm: `,
    );
    rl.close();
    if (answer.trim() !== vm) return { step: "destroy", ok: false, detail: "cancelled" };
  }
  await exeDev(["rm", vm], 120_000);
  return { step: "destroy", ok: true, detail: `VM ${vm} removed` };
}

// ------------------------------------------------------------------ verbs

export const remoteDriver = {
  async status(d: NetDevice, tokens: { client?: string; cron?: string }) {
    if (d.tunnel) await tunnel(d).catch(() => undefined);
    const checks = await probe(d.url, tokens);
    return { device: d.id, url: d.url, online: checks[0].ok, checks };
  },
  async probe(d: NetDevice, tokens: { client?: string; cron?: string }) {
    if (d.tunnel) await tunnel(d);
    return probe(d.url, tokens);
  },
  async up(
    d: NetDevice,
    tokens: { client?: string; cron?: string },
    log: (s: Step) => void,
  ): Promise<Step[]> {
    const steps: Step[] = [];
    const go = async (fn: () => Promise<Step>) => {
      const s = await fn();
      steps.push(s);
      log(s);
      if (!s.ok) throw Object.assign(new Error(`${s.step}: ${s.detail}`), { steps });
    };
    try {
      if (d.kind === "exe-dev") await go(() => create(d));
      await go(() => provision(d));
      await go(() => deploy(d));
      await go(() => writeEnv(d));
      await go(() => installService(d));
      await go(() => waitHealthy(d));
      if (d.ui) await go(() => uiReady(d));
      await go(() => cron(d, "install"));
      if (d.kind === "exe-dev") await go(() => expose(d));
      if (d.tunnel) await go(() => tunnel(d));
      await go(() => probeStep(d, tokens));
    } catch (error) {
      if (!(error as { steps?: Step[] }).steps)
        steps.push({ step: "error", ok: false, detail: (error as Error).message });
    }
    return steps;
  },
  async deploy(d: NetDevice, tokens: { client?: string; cron?: string }): Promise<Step[]> {
    // Reinstalling the services restarts them, and adds any a newer version needs (the UI service).
    const steps = [await deploy(d), await writeEnv(d), await installService(d)];
    if (d.tunnel) steps.push(await tunnel(d));
    steps.push(
      await waitHealthy(d),
      ...(d.ui ? [await uiReady(d)] : []),
      await probeStep(d, tokens),
    );
    return steps;
  },
  async restart(d: NetDevice): Promise<Step[]> {
    await serviceCommand(d, "restart");
    return [{ step: "restart", ok: true, detail: `${d.service} restarted` }, await waitHealthy(d)];
  },
  async down(d: NetDevice): Promise<Step[]> {
    const c = await cron(d, "remove");
    await serviceCommand(d, "stop", true);
    return [
      c,
      { step: "service", ok: true, detail: `${d.service} stopped${d.ui ? " (API and UI)" : ""}` },
    ];
  },
  cron: (d: NetDevice, action: "install" | "remove" | "status") => cron(d, action),
  async logs(d: NetDevice, app: string, lines: number): Promise<string> {
    const file =
      app === "api" || app === "cron" || app === "cli" ? `logs/${app}.jsonl` : `logs/${app}`;
    return (
      await remote(
        d,
        `tail -n ${lines} "${shPath(d.codeDir)}/${file}" 2>/dev/null || echo "no ${file} yet"`,
      )
    ).stdout;
  },
  async step(
    verb: string,
    d: NetDevice,
    tokens: { client?: string; cron?: string },
    args: string[],
  ): Promise<Step> {
    switch (verb) {
      case "create":
        return create(d);
      case "provision":
        return provision(d);
      case "deploy":
        return deploy(d);
      case "env":
        return writeEnv(d);
      case "service":
        return installService(d);
      case "cron":
        return cron(d, "install");
      case "expose":
        return expose(d);
      case "wait":
        return waitHealthy(d);
      case "ui":
        return uiReady(d);
      case "probe":
        return probeStepWithTunnel(d, tokens);
      case "tunnel":
        return tunnel(d);
      case "tcc":
        return tcc(d);
      case "destroy":
        return destroy(d, args.includes("--yes"));
      default:
        throw new Error(
          `Unknown step ${verb}. Steps: create, provision, deploy, env, service, wait, ui, cron, expose, probe, tunnel, tcc`,
        );
    }
  },
};
