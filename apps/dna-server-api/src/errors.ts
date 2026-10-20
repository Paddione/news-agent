// The error envelope: {error: {code, message}} with a status per code.
import type { ErrorRequestHandler } from "express";
import { ConversationBusy } from "@earendil-works/pi-durable";
import type { ErrorCode } from "@dna/sdk";
import type { Logger } from "@dna/sdk/node";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  busy: 409,
  conflict: 409,
  unavailable: 503,
  internal: 500,
  offline: 503,
};

export class ApiFault extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const invalid = (message: string) => new ApiFault("invalid", message);
export const notFound = (message: string) => new ApiFault("not_found", message);
export const conflict = (message: string) => new ApiFault("conflict", message);

export function errorMiddleware(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let fault: ApiFault;
    if (err instanceof ApiFault) fault = err;
    else if (err instanceof ConversationBusy) fault = new ApiFault("busy", "The agent is busy");
    else if (err?.type === "entity.parse.failed") fault = invalid("Body must be valid JSON");
    else if (err?.type === "entity.too.large") fault = invalid("Body too large");
    else {
      log.error("http.error", {
        method: req.method,
        path: req.path,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      fault = new ApiFault("internal", err instanceof Error ? err.message : "Internal error");
    }
    if (res.headersSent) return void res.end();
    res.status(fault.status).json({ error: { code: fault.code, message: fault.message } });
  };
}

/** Parse a positive integer from a path or query value. */
export function int(value: unknown, name: string, fallback?: number): number {
  if ((value === undefined || value === "") && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw invalid(`${name} must be a whole number`);
  return n;
}

export const optInt = (value: unknown, name: string): number | undefined =>
  value === undefined || value === "" ? undefined : int(value, name);
