// dna.sqlite: node:sqlite in WAL mode. One API process writes; SSE readers, the telemetry
// projector and request handlers read while it commits.
//
// Split into two kernels in one file (single-file shim so every existing
// `from "../db.ts"` import keeps working):
//   A. conn kernel — openDb/tx/Db: the sqlite connection, nothing else.
//   B. format kernel — nowIso/json/parse/bind/bool/num/str: pure value mapping, no Db use.
// Format never touches conn, so the dependency direction is one-way by construction.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ---- A. conn kernel -------------------------------------------------------

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const { journal_mode } = db.prepare("PRAGMA journal_mode=WAL").get() as { journal_mode: string };
  if (journal_mode !== "wal")
    throw new Error(`Expected WAL journal mode for ${path}, got ${journal_mode}`);
  db.exec("PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  // Queries with optional filters pass every named parameter; let a statement ignore the ones it does not use.
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    statement.setAllowUnknownNamedParameters(true);
    return statement;
  };
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// ---- B. format kernel (pure: no Db, no I/O) -----------------------------------

export const nowIso = () => new Date().toISOString();
export const json = (value: unknown) => JSON.stringify(value ?? null);
export function parse<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

type SqlValue = string | number | bigint | null | Uint8Array;

/** node:sqlite rejects undefined and booleans: map them to NULL and 0/1. */
export function bind<T extends Record<string, unknown>>(params: T): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) out[key] = null;
    else if (typeof value === "boolean") out[key] = value ? 1 : 0;
    else if (typeof value === "object" && !(value instanceof Uint8Array))
      out[key] = JSON.stringify(value);
    else out[key] = value as SqlValue;
  }
  return out;
}

export const bool = (value: unknown) => value === 1 || value === true;
export const num = (value: unknown) =>
  value === null || value === undefined ? undefined : Number(value);
export const str = (value: unknown) =>
  value === null || value === undefined ? undefined : String(value);
