---
title: Sweep-Zweige — Diagramm und Kurzdoku
domains: [dna-server-api, dna-server-cron]
status: staged
spec: .agents/plans/f3-sweep-zweige/design.md
branch: fix/f3-sweep-zweige-20261021
---

# F3 Sweep-Zweige: Diagramm + Doku

**Goal:** Sweep-Diagramm und Kurzdoku zeigen alle Tick-Zweige: replay,
not_due, skipped (3x), stalled (3 Ursachen), accepted.

**Spec:** `.agents/plans/f3-sweep-zweige/design.md`

## Tasks

- [x] 1. Mermaid-Diagramm Tick-Ablauf anlegen (cron-tick -> POST
  news-sweep -> replay? -> due? -> closeStalled -> running? -> route?
  -> accepted; inkl. HTTP 200/202 + Idempotent-Replay). Siehe `design.md`.
- [x] 2. replay-Zweig dokumentieren (gleiche requestId = gleicher Sweep,
  Header Idempotent-Replay). Siehe `design.md`.
- [x] 3. not_due-Zweig dokumentieren (off vs. Slot belegt; kein
  Sweep-Objekt, HTTP 200). Siehe `design.md`.
- [x] 4. skipped-Zweige dokumentieren (still running / route down /
  throttled mit Fallback-Intervall). Siehe `design.md`.
- [x] 5. stalled-Ursachen dokumentieren (run ended vor complete_sweep /
  Timeout DNA_STALL_MINUTES / withdraw queued-behind-failed).
  Siehe `design.md`.
- [x] 6. Doku mit Tests gegenprüfen (workflow, sweep-faux, schedule,
  model-route, cron tick) und Pfad:Zeile je Kante festhalten.
  Testliste in `design.md`; vor Übergabe relevante Suiten fahren.

## Abnahme

- Diagramm rendert, jede Kante hat path:line-Beleg; Kurzdoku nennt alle
  4 Status plus stalled-Ursachen.
- Kein Code, nur Docs; kein Commit/Push durch diesen Child.
