# AGENTS.md — news-agent

Gemeinsame Doktrin: `~/agentic-resources/AGENTS.md` (Skills, Workflows, Goals) und
`~/AGENTS.md` (Worktrees, Hooks, Commits, Push-Freigabe). Repo-Spezifika stehen in
`repo.yaml` (`main_branch`, `verify:`, `land:`, `deps:`). Hier nur, was davon abweicht
oder nur hier gilt.

## Repo-Besonderheiten

- Fork von `disler/pi-durable-news-agent` (`upstream`). Eigene Arbeit landet nur in
  `origin` (`Paddione/news-agent`). PRs, Issues und Pushes nie gegen `upstream`;
  `gh` ist per `remote.origin.gh-resolved=base` auf `origin` festgelegt, Wrapper
  (`agent-workspace.py pr`) übergeben `--repo` ausdrücklich.
- Live-Betrieb läuft aus diesem Checkout: systemd-User-Units `news-agent-api`,
  `news-agent-hub`, `news-agent-tick` (Timer) mit `WorkingDirectory` unter
  `~/news-agent/apps/…`. Änderungen im Hauptcheckout wirken nach Neustart der Units
  live. Arbeiten deshalb nur im Worktree; Dienste nicht ohne Auftrag neu starten.
  Keine Unit committet oder pusht im Checkout (geprüft 2026-11-14).
- `.env` und `dna-network.yaml` sind lokal und nie zu stagen.
- Verifikation: `npm run check` und `npm test` (siehe `repo.yaml`); Recipes unter
  `just/` (`just --list`).
- Abschluss: im Worktree `python3 ~/scripts/agent-workspace.py land` (`land: ff`: Rebase,
  `check` + `verify`, Fast-Forward auf `main`, Push nach `origin`, `finish`).
- Skills: `.agents/skills/` sind unversionierte Links auf
  `~/agentic-resources/{core,lifecycle}`, angelegt per
  `python3 ~/scripts/agent-resources.py link-consumers`.
