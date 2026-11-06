# Progress: OD-3/OD-4 news-agent

Prozent: 100 % (Deploy-Ketten-Cycle beseitigt, SSE-Guard verifiziert, DB-Kernel entkoppelt, Merge-Freigabe erteilt)

## Erledigt
- `sse.ts:1-20` gelesen; Worker-Diff (7 Files, nur Write-Set) übernommen geprüft.
- Eigene Verifikation 2026-11-06: `tsc -p apps/dna-cli` exit 0,
  `tsc -p apps/dna-server-api` exit 0, `stream+db`-Suite fail 0,
  `sources+schedule+taste+repo-tools`-Suite fail 0.
- Deferred (STOP, Owner-Entscheid): `tickMinutes↔slotMinutes`-Vereinigung und
  `until`-Helper-Dup (brauchen Files außerhalb Write-Set) → Folgepaket.
- 2026-11-06 Graph-Cycle-Re-Query nach OD-5 Graph-Refresh (`2026-11-06T20:39:48Z`):
  `net/remote.ts` + `net/index.ts` (10-Node-Cycle deploy/portOpen/tunnel/statusOf): **0 Rows** (beseitigt).
  Einzige verbleibende CALLS-Kante ist die überwachte `arm↔pump`-Drossel in `sse.ts` (2 Rows, by-design).

## Nächste Schritte
- Keine — Ziel vollständig erreicht. Merge-Freigabe erteilt.

## Erledigt
- `sse.ts:1-20` gelesen (Stream-Invarienten dokumentiert).
- Goal angelegt.

## Nächste Schritte
- Worker-Paket P2 (disjunkt: nur `sse.ts`, `db/db.ts`, `dna-cli/src/net/*`).
- Cycle-Re-Query + `tsc` + Route-Tests.

## Offene Punkte
- `plan_refs:` nachtragen.
