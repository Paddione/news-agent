// Weekly coach digest tick: POST /v1/workflows/news-digest with the cron token.
// The server renders at most one digest per week (not_due otherwise), so this
// runs on every tick like the sweep tick. Kept separate from tick() so the
// sweep path is untouched; the retry contract mirrors tick().
import type { DigestResult } from "@dna/sdk";
import type { Logger } from "@dna/sdk/node";
import { BACKOFF_MS } from "./tick.ts";

/** digest:<device>:<YYYY>W<ww> in UTC (ISO week): one slot per week. */
export function digestSlotId(device: string, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d.getTime() - first.getTime()) / (7 * 24 * 3600_000));
  return `digest:${device}:${d.getUTCFullYear()}W${String(week).padStart(2, "0")}`;
}

export interface DigestTickOptions {
  apiUrl: string;
  token: string;
  device: string;
  log: Logger;
  now?: Date;
  backoffMs?: number[];
  timeoutMs?: number;
}

export interface DigestTickResult {
  ok: boolean;
  requestId: string;
  attempts: number;
  status?: number;
  result?: DigestResult;
  error?: string;
}

const retryable = (status: number) => status === 429 || status >= 500;

export async function digestTick(options: DigestTickOptions): Promise<DigestTickResult> {
  const requestId = digestSlotId(options.device, options.now);
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const url = `${options.apiUrl.replace(/\/+$/, "")}/v1/workflows/news-digest`;
  let last: DigestTickResult = { ok: false, requestId, attempts: 0 };
  for (let attempt = 1; attempt <= backoff.length + 1; attempt++) {
    const start = performance.now();
    let retry = false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
          "idempotency-key": requestId,
        },
        body: JSON.stringify({ trigger: "cron", scheduled: true }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      const body = (await res.json().catch(() => undefined)) as
        | (DigestResult & { error?: { message: string } })
        | undefined;
      const ms = Math.round(performance.now() - start);
      if (res.ok) {
        options.log.info("cron.digest", {
          slot: requestId,
          attempt,
          status: res.status,
          outcome: body?.status,
          filename: body?.digest?.filename,
          reason: body?.reason,
          ms,
        });
        return { ok: true, requestId, attempts: attempt, status: res.status, result: body };
      }
      retry = retryable(res.status);
      last = {
        ok: false,
        requestId,
        attempts: attempt,
        status: res.status,
        error: body?.error?.message ?? res.statusText,
      };
      options.log[retry ? "warn" : "error"]("cron.digest", {
        slot: requestId,
        attempt,
        status: res.status,
        error: last.error,
        ms,
      });
    } catch (error) {
      retry = true;
      last = {
        ok: false,
        requestId,
        attempts: attempt,
        error:
          error instanceof Error
            ? error.cause instanceof Error
              ? error.cause.message
              : error.message
            : String(error),
      };
      options.log.warn("cron.digest", {
        slot: requestId,
        attempt,
        error: last.error,
        ms: Math.round(performance.now() - start),
      });
    }
    if (!retry || attempt > backoff.length) break;
    await new Promise((r) => setTimeout(r, backoff[attempt - 1]));
  }
  return last;
}
