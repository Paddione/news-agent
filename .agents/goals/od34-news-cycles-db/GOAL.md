# GOAL: OD-3/OD-4 news-agent — Net-Cycle, SSE-Guard, DB-Kernel (news-agent)

## Objective
Deploy-Ketten-Cycle und SSE-Selbsttrigger beseitigen, DB-God-Helper
entflechten, duplizierte Routen-/Tool-Paare zusammenführen.

## Erfolgskriterien
- [ ] 10er-Cycle `apps/dna-cli/src/net/remote.ts` (deploy/portOpen/tunnel/probeStep/status/probe/step) + `net/index.ts` (net/statusOf): `probeStep` als Leaf-Modul, `statusOf→deploy`-Rückkante entfernt; Cycle-Query = 0.
- [ ] `apps/dna-server-api/src/sse.ts` (`run↔trigger`, Datei verifiziert): Guard-Flag/Queue, genau ein Trigger-Owner; Re-Emit-Test.
- [ ] `apps/dna-server-api/src/db/db.ts` (`bind:52` din 46, `nowIso:38` din 41) → Format- vs. Conn-Modul + Re-Export-Shim; `npx tsc --noEmit -p apps/dna-cli` grün.
- [ ] `SIMILAR_TO`-Paare (19): `repo{Overview,Search,Symbol}`, `keywords/sources.remove`, `tickMinutes/slotMinutes`, `until`-Helper je vereint.
- [ ] `npx tsc --noEmit` + Route-Tests grün.

## Nicht-Ziele
- Kein Frontend-Redesign (`dna-client-browser` nur lesend berührt).
- Kein Eingriff in `fe/dist`, Fonts/Icons (by-design nicht indiziert).

## Abhängigkeiten
- Graph-Receipt news-agent (4.595/16.523, sauberste). Re-Index via `od5-graph-refresh` (Home).

health_goals: none (Abgeschlossenes DB-/Zyklus-Einmalziel ohne separaten Dauer-Probe; Vertragsinvariante über G-GOALS01 überwacht)
