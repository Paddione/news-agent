---
title: F4 Judge-Pfad — Judge-Ausfall ist ein benannter Fehlerzweig mit Retry
domains: [dna-server-api, sweep]
status: staged
branch: fix/f4-judge-pfad-20261021
---

# f4-judge-pfad — Implementation Plan

Ziel: Der Judge-Ausfall (`gpu_training`, `judge_unavailable`) ist als
Fehlerzweig mit Retry und Telemetrie belegt, nicht mehr unsichtbar.

## File Structure

| Datei | Änderung |
|---|---|
| `docs/judge-unavailable.md` | Neu: Fehlerzweig-Doku mit Ursachen, Retry und Telemetrie (path:line je Kante) |
| `apps/dna-server-api/src/news/judge-runtime.ts` | Unverändert (SSOT der Fehlertypen, Zeilen 10-17, 26-37) |
| `apps/dna-server-api/src/news/sweep-task.ts` | Unverändert (Retry-Pfad, Zeilen 126-127, 331, 446, BACKOFF 59) |
| `apps/dna-server-api/src/news/hfs.ts` | Unverändert (Telemetry + Warnung, Zeilen 96-134) |

Verbrauchte Schnittstellen: `JudgeUnavailableError(reason, detail)`,
`JudgeRuntime.ensure/close`, `telemetry.jev()`. Produziert: Doku-Datei.

## Tasks

- [x] 1. Ursachen belegen: `judge-runtime.ts:10-17` (Typen), `:26-37` (Exit 3 → gpu_training).
- [x] 2. Retry belegen: `sweep-task.ts:126-127` (kein sofortiger Abbruch), `:331`/`:446` (Weiterreichen), `BACKOFF_MS` (59) + Retry-Phase (52, 509-510).
- [x] 3. Telemetrie belegen: `hfs.ts:96-134` (`telemetry.jev`, `jev.failed`-Warnung).
- [x] 4. `docs/judge-unavailable.md` mit Zweig-Tabelle anlegen.
- [x] 5. Verifikation im Worktree (cwd = `apps/`): `NODE_NO_WARNINGS=1 npx tsx --test dna-server-api/tests/workflow.test.ts` läuft grün (Exit 0); `grep -n "JudgeUnavailableError" dna-server-api/src/news/sweep-task.ts` liefert Treffer.

## Abnahme

Jede Doku-Kante hat einen path:line-Beleg; kein Verhalten geändert, nur Doku neu.
