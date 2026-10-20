// Render a card image for every generated image that failed (no OpenAI key). Opens the db directly: the running
// service holds the store lock. Usage: node --import tsx scripts/backfill-rendered-images.ts --db <dna.sqlite> [--dry-run]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import type { HfsCategory } from "@dna/sdk";
import { CARD_RENDER_MODEL, rasterize, renderCardSvg } from "../src/news/card-render.ts";

interface Row {
  id: number;
  title: string | null;
  source: string | null;
  topic: string | null;
  category: HfsCategory | null;
}

export function backfillRendered(db: DatabaseSync, dataDir: string, dryRun: boolean): number[] {
  const rows = db
    .prepare(
      `SELECT im.id,
              COALESCE((SELECT json_extract(c.props_json, '$.title') FROM cards c WHERE c.image_id = im.id LIMIT 1), i.title) AS title,
              i.source_name AS source, i.matched_topic AS topic,
              (SELECT primary_category FROM classifications cl WHERE cl.item_id = i.id ORDER BY cl.id DESC LIMIT 1) AS category
         FROM images im LEFT JOIN items i ON i.id = im.item_id
        WHERE im.origin = 'generated' AND im.status = 'failed'
        ORDER BY im.id`,
    )
    .all() as unknown as Row[];
  if (dryRun) return rows.map((r) => r.id);
  const dir = join(dataDir, "images");
  mkdirSync(dir, { recursive: true });
  const update = db.prepare(
    "UPDATE images SET status = 'ready', file_path = ?, model = ?, cost_usd = 0, error = NULL WHERE id = ?",
  );
  for (const r of rows) {
    const file = join(dir, `${r.id}.png`);
    const svg = renderCardSvg({
      title: r.title ?? "Untitled",
      source: r.source ?? "Web",
      topic: r.topic ?? undefined,
      category: r.category ?? undefined,
    });
    writeFileSync(file, rasterize(svg));
    update.run(file, CARD_RENDER_MODEL, r.id);
  }
  return rows.map((r) => r.id);
}

function main() {
  const { values } = parseArgs({
    options: { db: { type: "string" }, "dry-run": { type: "boolean" } },
  });
  if (!values.db) throw new Error("--db <path to dna.sqlite> is required");
  const ids = backfillRendered(
    new DatabaseSync(values.db),
    dirname(values.db),
    !!values["dry-run"],
  );
  console.log(
    `${values["dry-run"] ? "would render" : "rendered"} ${ids.length} images${ids.length ? `: ${ids.join(", ")}` : ""}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
