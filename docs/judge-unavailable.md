# Judge-Ausfall als Fehlerzweig (F4)

Der lokale Judge hält die GPU nur während `jev` in Benutzung ist
(`apps/dna-server-api/src/news/judge-runtime.ts:1-6`).

## Fehlertypen

`JudgeUnavailableError` kennt genau zwei Ursachen
(`apps/dna-server-api/src/news/judge-runtime.ts:10-17`):

| Grund | Auslöser | Beleg |
|---|---|---|
| `gpu_training` | Session-Binary meldet Exit 3 (Training belegt die GPU) | `apps/dna-server-api/src/news/judge-runtime.ts:26-32` |
| `judge_unavailable` | llama-server nicht hochgekommen, 5xx, Timeout | `apps/dna-server-api/src/news/judge-runtime.ts:33-37`, `:119` |

## Retry statt Abbruch

Ein `JudgeUnavailableError` bricht den Sweep nicht ab: die Phase geht mit
durablem Backoff (`BACKOFF_MS = [30_000, 120_000, 480_000]`,
`apps/dna-server-api/src/news/sweep-task.ts:60`) in die Retry-Phase
(`sweep-task.ts:53`, `:127-128`, `:553-554`). Nach erschöpften Versuchen
(`:156-179`) wird der Fehler weitergereicht (`:375`, `:490`).

## Telemetrie

Jeder `jev`-Aufruf wird bepreist und gespeichert
(`apps/dna-server-api/src/news/hfs.ts:133-169`); Fehlschläge landen als
`jev.failed`-Warnung in den Logs (`hfs.ts:179`).
