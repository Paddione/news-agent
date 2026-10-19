// apps/dna-server-api/tests/judge-runtime.test.ts
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { JudgeRuntime, JudgeUnavailableError, type Session } from "../src/news/judge-runtime.ts";

function fakeSession(fail?: Error) {
  const log: string[] = [];
  const session: Session = {
    acquire: async () => {
      log.push("acquire");
      if (fail) throw fail;
      await new Promise((r) => setTimeout(r, 5));
    },
    release: async () => {
      log.push("release");
    },
    heartbeat: async () => {
      log.push("heartbeat");
    },
  };
  return { session, log };
}

test("concurrent ensure calls acquire once", async () => {
  const { session, log } = fakeSession();
  const rt = new JudgeRuntime({ session });
  await Promise.all([rt.ensure(), rt.ensure(), rt.ensure()]);
  assert.deepEqual(log, ["acquire"]);
  await rt.close();
});

test("idle timer releases, the next ensure acquires again", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { session, log } = fakeSession();
  let clock = 0;
  const rt = new JudgeRuntime({ session, idleMs: 600_000, now: () => clock });
  const first = rt.ensure();
  mock.timers.tick(5);
  await first;
  clock = 600_000;
  mock.timers.tick(600_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(rt.active, false);
  assert.deepEqual(log, ["acquire", "release"]);
  mock.timers.reset();
});

test("heartbeat at most once per heartbeatMs", async () => {
  const { session, log } = fakeSession();
  let clock = 0;
  const rt = new JudgeRuntime({ session, heartbeatMs: 60_000, now: () => clock });
  await rt.ensure();
  clock = 10_000;
  await rt.ensure();
  clock = 61_000;
  await rt.ensure();
  assert.deepEqual(log, ["acquire", "heartbeat"]);
  await rt.close();
});

test("failed acquire surfaces JudgeUnavailableError and leaves the runtime inactive", async () => {
  const { session } = fakeSession(new JudgeUnavailableError("gpu_training"));
  const rt = new JudgeRuntime({ session });
  await assert.rejects(
    rt.ensure(),
    (e: unknown) => e instanceof JudgeUnavailableError && e.reason === "gpu_training",
  );
  assert.equal(rt.active, false);
});
