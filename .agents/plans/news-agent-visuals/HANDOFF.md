# Handoff: news-agent-visuals

Harness-neutral entry point (Claude Code, opencode, Codex, agy, …). Everything needed is in this folder and in the repo; no session context is required.

## Where

- Repo: `Paddione/news-agent`, branch `feature/news-agent-visuals` (base `main`).
- Local worktree on the plan author's machine: `~/.worktrees/news-agent-0b2f6c96/feature/news-agent-visuals`. Elsewhere: `git fetch origin && git switch feature/news-agent-visuals`.
- Do not work on `main`. Do not open a PR until Task V is green.

## Read in this order

1. `design.md` — spec with decisions D1–D10. Decisions are settled; do not reopen them.
2. `tasks.md` — goal, global constraints, review focus, file map, partial order, final Task V.
3. `tasks.d/p0-viz.md` → `p1-card-image.md` → `p2-figures.md` → `p3-dashboard.md`.

## Execution order

P0 → P1 → P2 → P3 → Task V. P0 and P1 are independent and may run in parallel. P2 Task 5 needs P0. P3 needs P0 and must come after P2 (both append to `apps/dna-client-browser/tests/ui-faux.mjs`).

## Rules

- Each task: write the failing test, run it and see the stated failure, implement, run it green, commit with the message given in the task.
- Commit format: Conventional Commits `<type>(<scope>): <subject>`. No co-author lines.
- Where a task says "prüfen" (verify a name, signature or CSS variable), check the real code and adapt the snippet; do not invent new variables or types.
- If a test from the plan is wrong against the real code, fix the test only when the spec supports it, and note it in the commit body.
- Node `>=24`. Install once from the repo root: `npm install`.

## Commands

| Purpose | Command (repo root) |
|---|---|
| One server test file | `cd apps/dna-server-api && npx tsx --test tests/<file>.test.ts` |
| SDK tests | `cd apps/shared/packages/dna-sdk && npx tsx --test tests/<file>.test.ts` |
| TUI tests | `cd apps/dna-client-tui && npx tsx --test tests/render.test.ts` |
| Browser typecheck | `npm run check -w dna-client-browser` |
| Browser UI suite (needs Chrome/Playwright) | `npm run build -w dna-client-browser && node apps/dna-client-browser/tests/ui-faux.mjs` |
| Everything | `npm run fmt:check && npm run lint && npm run check && npm test` |

## Done means

All Task V steps green, branch pushed, then open a PR against `main` titled `feat: visual content for the news agent (card images, figures, dashboard)`. Do not run the live backfill (Task V step 7 is a dry run only).
