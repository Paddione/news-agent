// dna-server-cron: tick | install | uninstall | status
//   tick       one idempotent workflow call for this tick's slot (what the crontab runs); exit 0 on 2xx. The API's
//              schedule (5 to 60 minutes, or off) decides whether the tick starts a sweep.
//   install    write the crontab line (DNA_CRON_SCHEDULE, default * * * * *)
//   uninstall  remove it
//   status     the line plus the last 5 ticks
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLogger, installProcessHandlers, loadRootEnv, repoRoot } from "@dna/sdk/node";
import { cronLine, install, managedLine, readCrontab, uninstall } from "./crontab.ts";
import { DEFAULT_SCHEDULE, slotMinutes } from "./schedule.ts";
import { digestTick } from "./digest.ts";
import { tick } from "./tick.ts";

if (process.env.DNA_ENV_FILE !== "none") loadRootEnv(process.env.DNA_ENV_FILE || undefined);
const log = createLogger("cron");
installProcessHandlers(log);
const command = process.argv[2] ?? "tick";
const device = process.env.DNA_DEVICE_NAME ?? "local";
const script = resolve(import.meta.dirname, "../bin/dna-cron.sh");

function recentTicks(n = 5): string[] {
  const file = join(process.env.DNA_LOG_DIR ?? join(repoRoot(), "logs"), "cron.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .flatMap((l) => {
      try {
        const x = JSON.parse(l);
        return x.event === "cron.attempt"
          ? [
              `${x.ts} ${x.slot} attempt ${x.attempt} ${x.status ?? "offline"} ${x.outcome ?? x.error ?? ""}${x.sweepId ? ` sweep ${x.sweepId}` : ""}`,
            ]
          : [];
      } catch {
        return [];
      }
    })
    .slice(-n);
}

if (command === "tick") {
  const token = process.env.DNA_CRON_TOKEN?.trim();
  if (!token) {
    log.error("cron.no_token", {});
    console.error("DNA_CRON_TOKEN is not set. Run: just api tokens");
    process.exit(1);
  }
  const apiUrl = process.env.DNA_API_URL ?? `http://127.0.0.1:${process.env.DNA_PORT ?? 4850}`;
  const backoffMs = process.env.DNA_CRON_BACKOFF_MS?.split(",").map(Number);
  const r = await tick({
    apiUrl,
    token,
    device,
    log,
    backoffMs,
    slotMinutes: slotMinutes(process.env.DNA_CRON_SCHEDULE ?? DEFAULT_SCHEDULE),
  });
  log[r.ok ? "info" : "error"]("cron.tick", {
    slot: r.requestId,
    ok: r.ok,
    attempts: r.attempts,
    status: r.status,
    outcome: r.result?.status,
    sweepId: r.result?.sweep?.id,
    reason: r.result?.reason,
    error: r.error,
  });
  console.log(
    r.ok
      ? `${r.requestId}: ${r.result?.status}${r.result?.sweep ? ` sweep ${r.result.sweep.id}` : ""}${r.result?.reason ? ` (${r.result.reason})` : ""}`
      : `${r.requestId}: failed after ${r.attempts} attempts: ${r.error}`,
  );
  // Weekly coach digest, best effort: never changes the tick exit code.
  const d = await digestTick({ apiUrl, token, device, log, backoffMs });
  log[d.ok ? "info" : "warn"]("cron.digestTick", {
    slot: d.requestId,
    ok: d.ok,
    attempts: d.attempts,
    status: d.status,
    outcome: d.result?.status,
    filename: d.result?.digest?.filename,
    reason: d.result?.reason,
    error: d.error,
  });
  if (!d.ok) console.warn(`${d.requestId}: digest failed after ${d.attempts} attempts: ${d.error}`);
  else if (d.result?.status === "completed")
    console.log(`${d.requestId}: digest ${d.result.digest!.filename}`);
  process.exit(r.ok ? 0 : 1);
} else if (command === "install") {
  const r = install(cronLine(process.env.DNA_CRON_SCHEDULE ?? DEFAULT_SCHEDULE, script));
  log.info("cron.install", { changed: r.changed, line: r.line });
  console.log(`${r.changed ? "Installed" : "Already installed"}: ${r.line}`);
} else if (command === "uninstall") {
  const r = uninstall();
  log.info("cron.uninstall", { changed: r.changed });
  console.log(r.changed ? "Removed the dna-cron line" : "No dna-cron line to remove");
} else if (command === "status") {
  const line = managedLine(readCrontab());
  console.log(line ? `Installed: ${line}` : "Not installed. Run: just cron install");
  const ticks = recentTicks();
  console.log(ticks.length ? `Last ticks:\n${ticks.join("\n")}` : "No ticks logged yet");
} else {
  console.error(`Unknown command ${command}. Use tick, install, uninstall or status.`);
  process.exit(2);
}
