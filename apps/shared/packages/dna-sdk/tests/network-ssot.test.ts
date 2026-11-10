// apps/shared/packages/dna-sdk/tests/network-ssot.test.ts
// The SSOT gate for the mesh topology: dna-network.example.yaml (the template,
// validated by network.schema.json) must agree with k8s/*.yaml and the .env
// defaults on every port, URL and schedule. Port drift is red.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseAllDocuments } from "yaml";
import { hubPort, parseNetwork, type Network } from "../src/node/network.ts";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const example = () => parseNetwork(readFileSync(join(ROOT, "dna-network.example.yaml"), "utf8"));

/** All scalar values for one key across every document of a k8s manifest file. */
function k8sValues(file: string, key: string): unknown[] {
  const docs = parseAllDocuments(readFileSync(join(ROOT, "k8s", file), "utf8"));
  const out: unknown[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, val] of Object.entries(v)) {
        if (k === key) out.push(val);
        walk(val);
      }
  };
  docs.forEach((d) => walk(d.toJS()));
  return out;
}

const envDefault = (key: string): string => {
  const m = readFileSync(join(ROOT, ".env.example"), "utf8").match(
    new RegExp(`^${key}=(\\S+)`, "m"),
  );
  assert.ok(m, `${key} has no default in .env.example`);
  return m[1];
};

/** The gate: every port/URL/schedule the example names must match the manifests. */
export function assertTopologyMatches(
  network: Network,
  k8s: (file: string, key: string) => unknown[],
) {
  const local = network.devices.local;
  assert.ok(local, "the example names no local device");
  const apiPorts = k8s("dna-api.yaml", "containerPort").concat(k8s("dna-api.yaml", "targetPort"));
  for (const p of apiPorts)
    assert.equal(p, network.devices.local.port, `port drift: k8s dna-api ${p}`);
  const hubPorts = k8s("dna-hub.yaml", "containerPort").concat(k8s("dna-hub.yaml", "targetPort"));
  for (const p of hubPorts)
    assert.equal(p, hubPort(network.devices.local), `port drift: k8s dna-hub ${p}`);
  const apiUrl = k8s("dna-hub.yaml", "value").find(
    (v) => typeof v === "string" && v.startsWith("http://dna-api:"),
  );
  assert.ok(apiUrl, "k8s dna-hub names no dna-api URL");
  assert.equal(
    (apiUrl as string).split(":").pop(),
    String(network.devices.local.port),
    `port drift: dna-hub DNA_API_URL ${apiUrl}`,
  );
}

test("the example template parses and names the local device on the .env defaults", () => {
  const net = example();
  assert.equal(net.devices.local.port, Number(envDefault("DNA_PORT")));
  assert.equal(hubPort(net.devices.local), Number(envDefault("DNA_HUB_PORT")));
  assert.equal(net.devices.local.url, `http://127.0.0.1:${envDefault("DNA_PORT")}`);
});

test("the example matches k8s: no port drift", () => {
  assertTopologyMatches(example(), k8sValues);
});

test("port drift is red", () => {
  const drifted = example();
  drifted.devices.local.port = 9999;
  assert.throws(() => assertTopologyMatches(drifted, k8sValues), /port drift/);
});

test("the example cron matches the cluster tick", () => {
  const net = example();
  const schedules = k8sValues("dna-cronjob.yaml", "schedule").filter((s) => typeof s === "string");
  assert.ok(schedules.length > 0, "dna-cronjob.yaml names no schedule");
  for (const s of schedules)
    assert.equal(s, net.devices.local.cron, `schedule drift: k8s dna-tick ${s}`);
});
