// apps/dna-server-api/src/news/judge-runtime.ts
// The local judge only holds the GPU while jev is in use: the first call acquires a session (news-gpu-session
// preempts allowlisted inference units and starts llama-server), idleMs after the last call releases it.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Decide } from "@dna/jev";

const run = promisify(execFile);

export class JudgeUnavailableError extends Error {
  constructor(
    readonly reason: "gpu_training" | "judge_unavailable",
    detail = "",
  ) {
    super(`local judge unavailable: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "JudgeUnavailableError";
  }
}

export interface Session {
  acquire(): Promise<void>;
  release(): Promise<void>;
  heartbeat(): Promise<void>;
}

export function shellSession(bin: string): Session {
  const call = async (...args: string[]) => {
    try {
      await run(bin, args, { timeout: 180_000 });
    } catch (error: any) {
      if (error?.code === 3)
        throw new JudgeUnavailableError("gpu_training", String(error.stderr ?? "").trim());
      throw new JudgeUnavailableError(
        "judge_unavailable",
        String(error?.stderr ?? error)
          .trim()
          .slice(0, 200),
      );
    }
  };
  return {
    acquire: () => call("acquire", "--pid", String(process.pid)),
    release: () => call("release"),
    heartbeat: () => call("heartbeat"),
  };
}

export class JudgeRuntime {
  // ensure and close run one at a time: an ensure racing the idle release would otherwise hit the script's
  // "session healthy" path just before release tears the judge down, leaving active=true with no judge.
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private lastBeat = 0;
  active = false;
  private readonly idleMs: number;
  private readonly heartbeatMs: number;
  private readonly now: () => number;

  constructor(
    private readonly opts: {
      session: Session;
      idleMs?: number;
      heartbeatMs?: number;
      now?: () => number;
    },
  ) {
    this.idleMs = opts.idleMs ?? 600_000;
    this.heartbeatMs = opts.heartbeatMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  ensure(): Promise<void> {
    return this.serial(async () => {
      if (!this.active) {
        await this.opts.session.acquire();
        this.active = true;
        this.lastBeat = this.now();
      } else if (this.now() - this.lastBeat >= this.heartbeatMs) {
        this.lastBeat = this.now();
        try {
          await this.opts.session.heartbeat();
        } catch (error) {
          this.lost();
          throw error;
        }
      }
      this.arm();
    });
  }

  close(): Promise<void> {
    return this.serial(async () => {
      clearTimeout(this.timer);
      if (!this.active) return;
      this.active = false;
      await this.opts.session.release();
    });
  }

  /** The judge vanished under an active session (crash, reap): forget it so the next ensure acquires again. */
  lost(): void {
    clearTimeout(this.timer);
    this.active = false;
  }

  private arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.close(), this.idleMs);
    this.timer.unref?.();
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }
}

/** Connection refused, a 5xx from llama-server or a request timeout: the judge is gone, not the question bad. */
const judgeGone = (error: unknown) =>
  (error instanceof TypeError && /fetch failed/.test(error.message)) ||
  (error instanceof Error && /local judge HTTP 5\d\d/.test(error.message)) ||
  (error instanceof DOMException && error.name === "TimeoutError");

export function withRuntime(runtime: JudgeRuntime, decide: Decide): Decide {
  return async (state, questions, opts) => {
    await runtime.ensure();
    try {
      return await decide(state, questions, opts);
    } catch (error) {
      if (!judgeGone(error)) throw error;
      runtime.lost();
      throw new JudgeUnavailableError("judge_unavailable", String(error).slice(0, 200));
    }
  };
}
