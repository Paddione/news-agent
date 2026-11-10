// apps/dna-cli/tests/net-inventory.test.ts
// `net inventory` is the mesh map table: every device with kind, API URL,
// laptop hub port and UI URL. Pure: no probes, no ssh, no server.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { inventory, net, NET_VERBS } from "../src/net/index.ts";

const dir = mkdtempSync(join(tmpdir(), "dna-net-inv-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const file = join(dir, "dna-network.yaml");
writeFileSync(
  file,
  `devices:
  local: { kind: local, url: http://127.0.0.1:4850, hub_port: 4851 }
  mini: { kind: ssh, ssh: me@mini.local, service: launchd, url: http://mini.local:4850, ui: "http://mini.local:4851/" }
`,
);
process.env.DNA_NETWORK_FILE = file;

test("inventory is a known verb and lists every device as a map table", async () => {
  assert.ok((NET_VERBS as readonly string[]).includes("inventory"));
  const rows = inventory();
  assert.deepEqual(rows, [
    {
      device: "local",
      kind: "local",
      url: "http://127.0.0.1:4850",
      hub: 4851,
      ui: "http://localhost:4851",
    },
    {
      device: "mini",
      kind: "ssh",
      url: "http://mini.local:4850",
      hub: 4851,
      ui: "http://mini.local:4851",
    },
  ]);
});

test("net inventory needs no device argument", async () => {
  const data = (await net("inventory", [], {})) as ReturnType<typeof inventory>;
  assert.equal(data.length, 2);
  assert.equal(data[0].device, "local");
});
