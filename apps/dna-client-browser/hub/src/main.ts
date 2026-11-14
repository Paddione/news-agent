// The browser hub on 127.0.0.1: holds the client token, proxies /api to the device DNA_TARGET names in
// dna-network.yaml, and serves the Vue app (Vite middleware with --dev, else fe/dist). It runs no agents.
// Port: --port, else the device's hub_port, else DNA_HUB_PORT, else 4851. A stale listener on it is stopped first.
// On a device (the hub service), DNA_HUB_HOST=0.0.0.0 serves the network and DNA_HUB_HOSTS names the hosts it
// answers for (the device's UI host); on the laptop it stays on 127.0.0.1.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import {
  createLogger,
  installProcessHandlers,
  loadNetwork,
  loadRootEnv,
  targetUrl,
} from "@dna/sdk/node";
import { guard } from "./guard.ts";
import { proxy } from "./proxy.ts";

if (process.env.DNA_ENV_FILE !== "none") loadRootEnv(process.env.DNA_ENV_FILE || undefined);
const args = process.argv.slice(2);
const option = (key: string, fallback: string) => {
  const i = args.indexOf(key);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const log = createLogger("hub");
installProcessHandlers(log);
const host = process.env.DNA_HUB_HOST ?? "127.0.0.1";
const device = option("--device", process.env.DNA_TARGET ?? "local");
const network = loadNetwork();
const port = Number(
  option("--port", String(network.devices[device]?.hubPort ?? process.env.DNA_HUB_PORT ?? "4851")),
);
const token = process.env.DNA_CLIENT_TOKEN?.trim() ?? "";
if (token.length < 32) {
  console.error("DNA_CLIENT_TOKEN is missing. Run: just api tokens");
  process.exit(1);
}
const url = process.env.DNA_API_URL ?? targetUrl(device, network);
const appDir = resolve(import.meta.dirname, "../..");

const app = express();
app.disable("x-powered-by");
const allowed = new Set([
  `localhost:${port}`,
  `127.0.0.1:${port}`,
  `[::1]:${port}`,
  ...(process.env.DNA_HUB_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
]);
app.get("/hub/healthz", (_req, res) => res.json({ ok: true, device, url }));
app.use(
  "/api",
  guard(allowed),
  express.json({ limit: "256kb" }),
  proxy({ url, token, device }, log),
);

const server = createServer(app);
let vite: { close(): Promise<void> } | undefined;
if (args.includes("--dev")) {
  const { createServer: createVite } = await import("vite");
  const dev = await createVite({
    configFile: resolve(appDir, "fe/vite.config.ts"),
    server: { middlewareMode: true, ws: { server } },
  });
  app.use(dev.middlewares);
  vite = dev;
} else {
  const newestMtime = (target: string): number => {
    if (!existsSync(target)) return 0;
    const st = statSync(target);
    if (!st.isDirectory()) return st.mtimeMs;
    let max = 0;
    for (const entry of readdirSync(target, { withFileTypes: true }))
      max = Math.max(max, newestMtime(resolve(target, entry.name)));
    return max;
  };
  const distIndex = resolve(appDir, "fe/dist/index.html");
  const distMtime = existsSync(distIndex) ? statSync(distIndex).mtimeMs : 0;
  const srcMtime = Math.max(
    newestMtime(resolve(appDir, "fe/src")),
    newestMtime(resolve(appDir, "fe/index.html")),
    newestMtime(resolve(appDir, "fe/vite.config.ts")),
    newestMtime(resolve(appDir, "../shared/packages/dna-sdk/src")),
  );
  if (distMtime < srcMtime || distMtime === 0) {
    const built = spawnSync("npx", ["vite", "build", "--config", "fe/vite.config.ts"], {
      cwd: appDir,
      stdio: "inherit",
    });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }
  app.use(express.static(resolve(appDir, "fe/dist"), { index: false, maxAge: "1h" }));
  app.get("/{*path}", (_req, res) => res.sendFile(distIndex, { dotfiles: "allow" }));
}

spawnSync(resolve(appDir, "../../just/free-port.sh"), [String(port)], { stdio: "inherit" });
server.listen(port, host, () => {
  log.info("hub.listening", { port, device, url, dev: !!vite });
  console.log(`Durable News Agent: http://${host}:${port} (device ${device} at ${url})`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  server.closeAllConnections();
  await vite?.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
