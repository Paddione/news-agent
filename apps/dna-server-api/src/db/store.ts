// Open dna.sqlite (WAL), migrate, seed defaults on first run, and expose one repo per table group.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lockFile } from "@dna/durable-agent";
import { type Db, openDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import { InvestigationsRepo } from "./repos/investigations.ts";
import { NewsRepo } from "./repos/news.ts";
import { SettingsRepo } from "./repos/settings.ts";
import { SourcesRepo, type SourceSeed } from "./repos/sources.ts";
import { SweepsRepo } from "./repos/sweeps.ts";
import { TasteRepo, type KeywordKind } from "./repos/taste.ts";
import { TelemetryRepo } from "./repos/telemetry.ts";

export interface Store {
  db: Db;
  settings: SettingsRepo;
  sources: SourcesRepo;
  news: NewsRepo;
  taste: TasteRepo;
  sweeps: SweepsRepo;
  telemetry: TelemetryRepo;
  investigations: InvestigationsRepo;
  close(): void;
}

export function openStore(dataDir: string, configDir: string): Store {
  const path = join(dataDir, "dna.sqlite");
  const unlock = lockFile(`${path}.lock`);
  const db = openDb(path);
  migrate(db);
  const store: Store = {
    db,
    settings: new SettingsRepo(db),
    sources: new SourcesRepo(db),
    news: new NewsRepo(db),
    taste: new TasteRepo(db),
    sweeps: new SweepsRepo(db),
    telemetry: new TelemetryRepo(db),
    investigations: new InvestigationsRepo(db),
    close() {
      try {
        db.close();
      } finally {
        unlock();
      }
    },
  };
  store.news.refreshReleases(true);
  const sources = (
    JSON.parse(readFileSync(join(configDir, "sources.json"), "utf8")) as { sources: SourceSeed[] }
  ).sources;
  const key = (s: { kind: string; url?: string; query?: string }) =>
    `${s.kind}|${s.url ?? ""}|${s.query ?? ""}`;
  if (!store.settings.get("seeded", false)) {
    const keywords = JSON.parse(readFileSync(join(configDir, "keywords.json"), "utf8")) as Record<
      KeywordKind,
      string[]
    >;
    store.sources.seed(sources);
    store.taste.seed(keywords);
    store.settings.set("seeded", true);
    store.settings.set("seededSources", sources.map(key));
  } else {
    // A source added to config/sources.json later reaches existing devices once; one the reader removed stays removed.
    const seeded = new Set(
      store.settings.get<string[]>("seededSources", store.sources.list().map(key)),
    );
    const added = sources.filter((s) => !seeded.has(key(s)));
    if (added.length) store.sources.seed(added);
    store.settings.set("seededSources", [...seeded, ...added.map(key)]);
  }
  return store;
}
