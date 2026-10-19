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
      await run(bin, args, { timeout: 120_000 });
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
  private pending?: Promise<void>;
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

  async ensure(): Promise<void> {
    if (!this.active) {
      this.pending ??= this.opts.session.acquire().then(
        () => {
          this.active = true;
          this.lastBeat = this.now();
        },
        (error) => {
          this.pending = undefined;
          throw error;
        },
      );
      await this.pending;
    } else if (this.now() - this.lastBeat >= this.heartbeatMs) {
      this.lastBeat = this.now();
      await this.opts.session.heartbeat();
    }
    this.arm();
  }

  private arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.close(), this.idleMs);
    this.timer.unref?.();
  }

  async close(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.active) return;
    this.active = false;
    this.pending = undefined;
    await this.opts.session.release();
  }
}

export function withRuntime(runtime: JudgeRuntime, decide: Decide): Decide {
  return async (state, questions, opts) => {
    await runtime.ensure();
    return decide(state, questions, opts);
  };
}
