# Plan: News-SSOT-Gates (3 Kandidaten)

Zweck: Alle 3 SSOT-Lücken aus der Graph-Analyse
(`~/dotfiles/.agents/goals/ssot-graph-luecken-inventur/PROGRESS.md`, Belege
verifiziert 2026-11-10) schließen. Ausdrücklich kein Bedarf bei
Routen/Capabilities (`routes.ts`, `capabilities.ts` + Testzwang — SSOT bleibt
unberührt). Kein `AGENTS.md`/`repo.yaml` — keine Doktrin-Imports.

## Partials (disjunkt)

- **P1 Modellkatalog**: `models.yaml` (Katalog + Default + Slot-Belegung),
  generiert/gecheckt gegen `durable-agent/src/models.ts:26-81` + `.env.example`
  (`DNA_MODEL`, `DNA_*`); Check: jede Env-Modellwahl steht im Katalog.
  Basis: `models.ts:26-81`, `.env.example:17,65-75`, `docs/local-models.md`.
  Abnahme: unbekanntes Modell → rot.
- **P2 Mesh-Topologie**: `network.schema.json` + `dna-network.example.yaml` als
  SSOT-Template; Check Ports/URLs gegen `k8s/*.yaml` + `just/*`; Task
  `net inventory` (Map-Tabelle). Reale `dna-network.yaml` bleibt gitignored
  (`.gitignore:6`) — geprüft wird Template + Beispiel gegen Manifeste.
  Basis: `dna-network.example.yaml:20-32`, `k8s/dna-hub.yaml:41,106`,
  `just/net/mod.just:1`. Abnahme: Port-Drift → rot.
- **P3 Judge-Anbindung**: `judge.yaml` (`manifest_path`, `version`, `policy`);
  Check Env→Datei→Version in `judge-config.test.ts`-Nähe
  (`apps/dna-server-api/tests/judge-config.test.ts:17`); lose Kopplung ans
  unsloth-Manifest nur als Referenz, keine Kopie. Basis:
  `judge-injection-eval.ts:27`, `runtime.ts:7`, `.env.example:78`.
  Abnahme: nicht auflösbarer Manifest-Pfad → rot.
- **P4 Verify**: vorhandene Tests grün (Capabilities-/Routen-Tests unangetastet).
  Danach STOPP.
