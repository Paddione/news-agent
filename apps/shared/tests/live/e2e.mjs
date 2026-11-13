// Live end to end on one device: real models, real jev, real search, small spend.
//   node apps/shared/tests/live/e2e.mjs <device> [--wait-cron] [--skip-ui] [--skip-tui]
// Steps: probe, one cron tick (the crontab's code path) against the device URL (plus a fresh workflow call when the
// slot replays an older sweep), wait for the sweep, assert the
// sweep and its telemetry, drive the browser through a local hub, run the TUI smoke, confirm the crontab line,
// and with --wait-cron wait for the device's own cron to start a sweep. Prints PASS lines and a JSON summary.
// The local device has no crontab line, so steps 6 and 7 only run on remote devices.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "../../../..");
const device = process.argv[2];
const flags = new Set(process.argv.slice(3));
if (!device) {
  console.error(
    "usage: node apps/shared/tests/live/e2e.mjs <device> [--wait-cron] [--skip-ui] [--skip-tui]",
  );
  process.exit(2);
}
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const tokens = { client: process.env.DNA_CLIENT_TOKEN, cron: process.env.DNA_CRON_TOKEN };
const { loadNetwork } = await import(
  join(root, "apps/shared/packages/dna-sdk/src/node/network.ts")
);
const net = loadNetwork();
const dev = net.devices[device];
if (!dev) throw new Error(`No device ${device} in ${net.file}`);
const url = dev.url;
const sh = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const summary = { device, url, startedAt: new Date(started).toISOString() };
const check = (ok, msg) => {
  if (!ok) throw new Error(`FAIL ${msg}`);
  console.log(`PASS ${msg}`);
};
const dna = async (...args) => {
  const { stdout } = await sh(
    process.execPath,
    [join(root, "apps/dna-cli/bin/dna.mjs"), "--json", ...args],
    { env: { ...process.env, NODE_NO_WARNINGS: "1" }, timeout: 300_000 },
  ).catch((e) => e);
  return JSON.parse(stdout);
};
const api = async (path, init = {}) => {
  const res = await fetch(url + path, {
    ...init,
    headers: {
      authorization: `Bearer ${tokens.client}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
};

// 1. probe (opens the tunnel for private devices)
const probe = await dna("net", "probe", device);
check(
  Array.isArray(probe) && probe.every((c) => c.ok),
  `probe ${device}: ${probe.map((c) => `${c.name} ${c.detail}`).join(", ")}`,
);
const info = await api("/v1/info");
summary.searchMode = info.searchMode;
summary.model = info.defaultModel;

// 2. one tick, the crontab's code path, against the device URL
const tick = await sh(
  process.execPath,
  ["--import", "tsx", join(root, "apps/dna-server-cron/src/main.ts"), "tick"],
  {
    cwd: join(root, "apps/dna-server-cron"),
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      DNA_ENV_FILE: "none",
      DNA_API_URL: url,
      DNA_DEVICE_NAME: device,
      DNA_CRON_TOKEN: tokens.cron,
    },
    timeout: 120_000,
  },
).catch((e) => e);
const line = String(tick.stdout ?? "").trim();
// The schedule decides whether a tick starts a sweep: not_due (this slot already swept, or the schedule is off) is a
// working tick too.
const m = line.match(/(cron:\S+): (accepted|replay|skipped|not_due)(?: sweep (\d+))?/);
check(m, `cron tick: ${line || tick.stderr}`);
let sweepId = Number(m[3]);
summary.requestId = m[1];
// A replayed, skipped or not due tick can point at a sweep from older code (or none), so start a fresh one.
if (m[2] !== "accepted") {
  for (
    let i = 0;
    i < 120 &&
    (await api("/v1/sweeps?limit=5")).some((s) => s.status === "running" || s.status === "queued");
    i++
  )
    await sleep(5000);
  const requestId = `e2e:${device}:${Date.now()}`;
  const res = await fetch(`${url}/v1/workflows/news-sweep`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.cron}`, "content-type": "application/json" },
    body: JSON.stringify({ requestId, trigger: "test" }),
  }).then((r) => r.json());
  check(res.status === "accepted", `fresh sweep ${res.sweep?.id} accepted (${requestId})`);
  sweepId = res.sweep.id;
  summary.requestId = requestId;
}

// 3. wait for a terminal state (12 min)
let sweep;
for (const end = Date.now() + 12 * 60_000; Date.now() < end; await sleep(5000)) {
  sweep = await api(`/v1/sweeps/${sweepId}`);
  if (["completed", "no_news", "failed", "stalled"].includes(sweep.status)) break;
}
summary.sweep = {
  id: sweep.id,
  status: sweep.status,
  gathered: sweep.gathered,
  kept: sweep.kept,
  presented: sweep.presented,
  credits: sweep.firecrawlCreditsUsed,
  cost: sweep.cost,
  ms:
    sweep.endedAt && sweep.startedAt
      ? Date.parse(sweep.endedAt) - Date.parse(sweep.startedAt)
      : undefined,
};
check(["completed", "no_news"].includes(sweep.status), `sweep ${sweep.id} is ${sweep.status}`);
check(
  sweep.audit && sweep.audit.missing.length === 0,
  `sweep ${sweep.id} audit lists no missing steps`,
);
const runs = await api(`/v1/executions?sweepId=${sweep.id}`);
check(
  runs.reduce((n, r) => n + r.generations, 0) > 0,
  `sweep ${sweep.id} has generations (${runs.reduce((n, r) => n + r.generations, 0)})`,
);
const done = sweep.toolCalls.filter((t) => !t.isError);
check(
  done.length > 0 && done.every((t) => typeof t.durationMs === "number"),
  `${done.length} tool calls carry duration_ms`,
);
check(
  (sweep.cost?.jevCalls ?? 0) > 0 || sweep.gathered === 0,
  `jev calls ${sweep.cost?.jevCalls} for ${sweep.cost?.jevUsd?.toFixed(4)} usd`,
);
if (info.searchMode === "firecrawl")
  check(sweep.firecrawlCreditsUsed > 0, `Firecrawl credits logged (${sweep.firecrawlCreditsUsed})`);
else check(sweep.firecrawlCreditsUsed === 0, `no Firecrawl credits in ${info.searchMode} mode`);

// 4. the device's own UI, then the browser: the device's UI when the laptop can reach it, else a local hub
if (dev.ui) {
  const [st] = await dna("net", "status", device);
  check(
    st.ui?.running,
    `${device}: serves its own UI${dev.kind === "exe-dev" ? " (private exe.dev share)" : ` at ${dev.ui.url}`}`,
  );
}
if (!flags.has("--skip-ui")) {
  const hosted = dev.ui && dev.kind !== "exe-dev" ? dev.ui.url : undefined;
  if (!hosted)
    await sh("npm", ["run", "build", "-w", "dna-client-browser"], {
      cwd: join(root, "apps"),
      timeout: 300_000,
    });
  const port = await new Promise((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port: p } = s.address();
      s.close(() => done(p));
    });
  });
  const base = hosted ?? `http://localhost:${port}`;
  const tmp = mkdtempSync(join(tmpdir(), "dna-live-ui-"));
  const hub = hosted
    ? undefined
    : spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          join(root, "apps/dna-client-browser/hub/src/main.ts"),
          "--port",
          String(port),
        ],
        {
          cwd: join(root, "apps/dna-client-browser"),
          env: {
            ...process.env,
            NODE_NO_WARNINGS: "1",
            DNA_ENV_FILE: "none",
            DNA_API_URL: url,
            DNA_TARGET: device,
            DNA_LOG_DIR: join(tmp, "logs"),
          },
          stdio: "ignore",
        },
      );
  const require = createRequire(import.meta.url);
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome", headless: !process.env.HEADED });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/hub/healthz`)).ok) break;
      } catch {}
      await sleep(100);
    }
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .locator(sweep.presented > 0 ? ".card" : '[data-role="agent"]')
      .first()
      .waitFor({ timeout: 30_000 });
    const cards = await page.locator(".card").count();
    check(
      cards > 0 || sweep.status === "no_news",
      `${device}: the feed loads through ${hosted ? "the device's own UI" : "a local hub"} (${cards} cards)`,
    );
    await page
      .screenshot({
        path: join(root, "apps/dna-client-browser/test-results", `live-${device}.png`),
      })
      .catch(() => {});
    // A live device's chat is the reader's: only the local test device gets a message.
    if (dev.kind === "local") {
      const agentCount = await page.locator('[data-role="agent"]').count();
      await page
        .getByLabel("Message the agent")
        .fill("In one short sentence, what did your last sweep find?");
      await page.getByLabel("Message the agent").press("Enter");
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll('[data-role="agent"]').length > n &&
          !document.querySelector(".agent-status.working"),
        agentCount,
        { timeout: 180_000 },
      );
      const reply = (await page.locator('[data-role="agent"]').last().innerText()).trim();
      check(
        reply.length > 0,
        `${device}: a chat message gets an answer (${reply.slice(0, 120).replace(/\s+/g, " ")})`,
      );
    } else {
      const shown = await Promise.all(
        [
          page.getByLabel("Message the agent"),
          page.getByLabel("Sweep schedule"),
          page.getByLabel("Search news"),
        ].map((l) =>
          l
            .waitFor({ timeout: 20_000 })
            .then(() => true)
            .catch(() => false),
        ),
      );
      check(
        shown.every(Boolean),
        `${device}: the agent column, schedule and search render (read only, no chat)`,
      );
    }
    check(
      errors.length === 0,
      `${device}: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`,
    );
  } finally {
    await browser.close();
    hub?.kill("SIGTERM");
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 5. the TUI smoke against the device
if (!flags.has("--skip-tui")) {
  const tui = await sh(join(root, "apps/dna-client-tui/tests/smoke.sh"), [device], {
    cwd: join(root, "apps/dna-client-tui"),
    timeout: 600_000,
  }).catch((e) => e);
  check(
    /ALL TUI SMOKE CHECKS PASSED/.test(tui.stdout ?? ""),
    `${device}: TUI smoke${tui.stdout ? "" : `: ${tui.message}`}`,
  );
}

// 6. the crontab line
if (dev.kind !== "local") {
  const cron = await dna("net", "cron", device, "status");
  const cronText = typeof cron === "string" ? cron : JSON.stringify(cron);
  check(
    cronText.includes(`Installed: ${dev.cron}`),
    `${device}: the crontab line is installed (${dev.cron})`,
  );
} else console.log(`SKIP ${device}: the crontab line is opt in on this Mac (just combos local)`);

// 7. a sweep the device's own cron started
if (flags.has("--wait-cron") && dev.kind !== "local") {
  let own;
  for (const end = Date.now() + 16 * 60_000; Date.now() < end && !own; await sleep(15_000)) {
    own = (await api("/v1/sweeps?limit=20")).find(
      (s) =>
        s.trigger === "cron" &&
        s.requestId !== summary.requestId &&
        Date.parse(s.createdAt) > started,
    );
  }
  check(
    own,
    `${device}: its own cron started sweep ${own?.id} (${own?.requestId}, ${own?.status})`,
  );
  summary.cronSweep = { id: own.id, requestId: own.requestId, status: own.status };
}

const usage = await api("/v1/usage?days=1");
summary.today = usage.at(-1);
summary.ms = Date.now() - started;
console.log(JSON.stringify(summary, null, 2));
console.log(`ALL LIVE CHECKS PASSED (${device})`);
