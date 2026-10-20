// GET /v1/stats?days=N: the dashboard's aggregates.
import { invalid } from "../errors.ts";
import { StatsRepo } from "../db/repos/stats.ts";
import type { Handlers, RouteDeps } from "./types.ts";

export function parseDays(raw: unknown): number {
  if (raw === undefined) return 7;
  const days = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw invalid("days must be an integer from 1 to 30");
  return days;
}

export function statsRoutes({ app }: RouteDeps): Handlers<"stats"> {
  const repo = new StatsRepo(app.store.db);
  return { stats: (req, res) => res.json(repo.stats(parseDays(req.query.days))) };
}
