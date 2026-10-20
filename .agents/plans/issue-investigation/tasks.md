---
title: Issue investigation
domains: [dna-server-api, dna-sdk, dna-client-browser]
status: staged
---

# issue-investigation — Implementation Plan

Spec: `.agents/plans/issue-investigation/design.md` (approved 2026-10-20).
Base: `main` at `493dc94`, branch `feature/issue-investigation`, worktree
`~/.worktrees/news-agent-0b2f6c96/feature/issue-investigation`. Commands run from `apps/` unless noted.

Repo profile: no `repo.yaml`. Assumed: main branch `main`, tickets `none`, task runner `just`, no generated
artifacts. Runtime: Node, `node --test --import tsx`, Vue 3 + vite, `@earendil-works/pi-durable` tasks.
Setup (once): `npm install --no-audit --no-fund` in the worktree root.

Reference code to follow, not to copy blindly:
- Durable task with phases and a subagent conversation: `src/news/deep-research.ts` (task) and
  `src/agents/tools/deep-dive-research.ts` (`tx.createTask` + `tx.createConversation` + `configure` in one commit).
- Agent extension and prompt loading: `src/agents/index.ts` (`deepResearch`, `loadPrompt`, `child()`).
- Faux model rules by prompt section: `src/agents/faux-script.ts` (`deep-research` rule).
- Health probe and fallback route: `src/agents/model-route.ts`.
- `execFile` seam and tracker: `src/news/issues.ts`.

## Acceptance criteria

1. A card issue created through S2 ends with a German report comment, `investigated` and `target:<repo>`
   labels, and a `done` row; the card shows the state.
2. The catch-up starts open news-card issues without a result at most every 10 minutes, never two at once
   and never during a sweep; a removed `investigation-failed` label retries with reset attempts.
3. Three failures give `failed` and `investigation-failed`; a restart mid-run posts exactly one comment.
4. :1919 down → fallback when configured and under the daily cap, else the issue stays queued.
5. Repo tools only read allowed projects, through `codebase-memory-mcp cli`, after an index refresh.
6. `just test unit`, `just test faux` and `just test ui` pass apart from the two failures known on `main`.

## File Structure

Create:
- `apps/dna-server-api/src/db/migrations/004_investigations.sql` — table `investigations`.
- `apps/dna-server-api/src/db/repos/investigations.ts` — `InvestigationsRepo`.
- `apps/dna-server-api/src/news/graph.ts` — `codeGraph()` and `fauxGraph()` over `codebase-memory-mcp cli`.
- `apps/dna-server-api/src/agents/tools/repo.ts` — `repo_search`, `repo_symbol`, `repo_overview`.
- `apps/dna-server-api/src/news/investigation-report.ts` — schema check, repair prompt text, Markdown, labels.
- `apps/dna-server-api/src/news/investigate.ts` — `startInvestigation`, `investigateCatchup`, task `dna.investigate`, fallback call.
- `apps/dna-server-api/prompt_engineering/agents/investigator/SYSTEM_PROMPT.md` and `USER_PROMPT_investigate.md`.
- `apps/dna-server-api/tests/investigations.test.ts` — repo, report, catch-up, route, end to end.
- `apps/dna-server-api/tests/repo-tools.test.ts` — graph seam and tools.

Modify:
- `apps/dna-server-api/src/db/store.ts` — `store.investigations`.
- `apps/dna-server-api/src/db/repos/news.ts` — `card().issue.investigation`.
- `apps/dna-server-api/src/news/issues.ts` — tracker `list`, `view`, `comment`, `addLabels`, `removeLabel`.
- `apps/dna-server-api/src/config.ts`, `src/deps.ts`, `src/runtime.ts` — `DNA_INVESTIGATE*`, `deps.graph`, the task.
- `apps/dna-server-api/src/agents/index.ts` — `investigator` extension.
- `apps/dna-server-api/src/agents/faux-script.ts` — `investigator` rule.
- `apps/dna-server-api/src/routes/issues.ts` — start after create.
- `apps/dna-server-api/src/routes/workflows.ts` — catch-up on the news-sweep call.
- `apps/dna-server-api/tests/issues.test.ts` — new tracker methods.
- `apps/shared/packages/dna-sdk/src/api.ts` — `Investigation`, `Card.issue.investigation`.
- `apps/dna-client-browser/fe/src/components/IssueButton.vue`, `CardDetailDialog.vue`, `styles/app.css`.
- `apps/dna-client-browser/tests/ui-faux.mjs` — investigation state check.
- `.env.example` — the four `DNA_INVESTIGATE*` variables.

## Interfaces

```ts
// dna-sdk api.ts
export type InvestigationStatus = "queued" | "running" | "done" | "failed";
export interface Investigation { status: InvestigationStatus; targets: string[]; commentUrl?: string;
  route?: "local" | "fallback"; model?: string }
// Card.issue: { number; url; investigation?: Investigation }

// db/repos/investigations.ts
export interface InvestigationRow extends Investigation { repo: string; number: number; cardId?: number;
  attempts: number; reportMd?: string; error?: string; startedAt?: string; finishedAt?: string; createdAt: string }
class InvestigationsRepo {
  get(repo: string, number: number): InvestigationRow | undefined;
  forCard(cardId: number): InvestigationRow | undefined;
  enqueue(repo: string, number: number, cardId?: number): { row: InvestigationRow; created: boolean };
  running(): InvestigationRow | undefined;
  start(repo: string, number: number, route: "local" | "fallback", model: string): InvestigationRow;
  finish(repo: string, number: number, r: { reportMd: string; targets: string[]; commentUrl: string }): InvestigationRow;
  fail(repo: string, number: number, error: string, maxAttempts?: number): InvestigationRow; // queued or failed
  retry(repo: string, number: number): InvestigationRow;   // failed → queued, attempts 0
  fallbacksToday(day: string): number;
}

// news/issues.ts additions to IssueTracker
list(label: string): Promise<{ number: number; labels: string[] }[]>;
view(number: number): Promise<{ title: string; body: string; labels: string[] }>;
comment(number: number, body: string): Promise<string>;           // comment URL
addLabels(number: number, labels: string[]): Promise<void>;
removeLabel(number: number, label: string): Promise<void>;

// news/graph.ts
export interface CodeGraph {
  projects(): Promise<{ name: string; root: string }[]>;
  refresh(root: string): Promise<void>;
  search(project: string, pattern: string): Promise<string>;
  symbol(project: string, name: string): Promise<string>;
  overview(project: string): Promise<string>;
}
export function codeGraph(allowed: string[], exec?: ExecFile): CodeGraph;   // throws on a project not in allowed
export function fauxGraph(allowed: string[]): CodeGraph;

// news/investigation-report.ts
export interface InvestigationReport { summary: string; source: { claim: string; evidence: string[] }[];
  existing: { project: string; paths: string[]; note: string }[]; missing: string[];
  proposal: "adopt" | "evaluate" | "watch" | "drop"; targets: string[]; reasoning: string }
export function parseReport(text: string, allowed: string[]): InvestigationReport;   // throws ReportError
export function renderReport(r: InvestigationReport, meta: { route: string; model: string; date: string;
  automaticRepoSearch?: boolean }): string;
export function targetLabels(targets: string[]): string[];   // home-patrick → target:dotfiles, home-patrick-x → target:x

// news/investigate.ts
export function startInvestigation(app: App, repo: string, number: number, cardId?: number): Promise<boolean>;
export function investigateCatchup(app: App, now?: number): Promise<number>;   // issues started
export const INVESTIGATE_MAX_ATTEMPTS = 3;
export const CATCHUP_MINUTES = 10;

// config: investigate: "on" | "off" | "faux"; investigateRepos: string[];
//         investigateFallbackModel?: string; investigateFallbackDaily: number
```

## Task 1 — Investigations table, repository and the card state

Permitted files: `004_investigations.sql`, `db/repos/investigations.ts`, `db/store.ts`, `db/repos/news.ts`,
`dna-sdk/src/api.ts`, `tests/investigations.test.ts`.

- [x] Write `tests/investigations.test.ts` (repository part, `tempStore()`): `enqueue` is idempotent per
      issue; `start` sets `running`, route, model, `startedAt`, attempts + 1; `fail` returns to `queued` below
      3 attempts and `failed` at 3; `retry` resets; `finish` stores report, targets and comment URL;
      `running()` finds the running row; `fallbacksToday` counts fallback starts of the day; a card with an
      issue (S2 `addCardIssue`) and an investigation row shows `card().issue.investigation`.
- [x] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/investigations.test.ts` — expected: FAIL.
- [x] Implement the migration from the spec, the repository, `store.investigations` and the card join.
- [x] Re-run — expected: PASS. `npx tsc -p dna-server-api` — exit 0.
- [x] Commit (type feat, scope investigate): "investigations table and repository".

## Task 2 — Tracker additions

Permitted files: `news/issues.ts`, `tests/issues.test.ts`.

- [x] Extend `tests/issues.test.ts` with the stub `ExecFile`: `list` runs
      `gh issue list -R <repo> --label <l> --state open --json number,labels --limit 100` and maps label names;
      `view` runs `gh issue view <n> -R <repo> --json title,body,labels`; `comment` runs
      `gh issue comment <n> -R <repo> --body-file -` with the body on stdin and returns the printed URL;
      `addLabels` creates missing labels once and runs `gh issue edit <n> -R <repo> --add-label a,b`;
      `removeLabel` runs `--remove-label`. The faux tracker keeps issues, labels and comments in memory.
- [x] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/issues.test.ts` — expected: FAIL.
- [x] Implement in `ghTracker` and `fauxTracker`.
- [x] Re-run — expected: PASS.
- [x] Commit (type feat, scope issues): "tracker list, view, comment and labels".

## Task 3 — Code graph seam and repo tools

Permitted files: `news/graph.ts`, `agents/tools/repo.ts`, `tests/repo-tools.test.ts`.

- [x] Write `tests/repo-tools.test.ts` (stub `ExecFile`): `projects()` parses `list_projects` output into
      name/root; `refresh` runs `codebase-memory-mcp cli --quiet index_repository --repo-path <root>`;
      `search` runs `cli search_code --project <p> --pattern <q> --mode compact`; `symbol` runs
      `search_graph --project <p> --name-pattern <n>` then `get_code_snippet --project <p> --qualified-name <qn>`;
      `overview` runs `get_architecture --project <p>`; a project outside the allowed list throws before any
      call; output over 6000 characters is cut with a marker. The three tools call the graph and return its
      text; an error becomes a tool error text.
- [x] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/repo-tools.test.ts` — expected: FAIL.
- [x] Implement `codeGraph`, `fauxGraph` (fixed text per call) and the tools (`defineAppTool`, read-only,
      `replay: "safe"`).
- [x] Re-run — expected: PASS.
- [x] Commit (type feat, scope investigate): "code graph seam and read-only repo tools".

## Task 4 — Report parsing and rendering

Permitted files: `news/investigation-report.ts`, `tests/investigations.test.ts`.

- [x] Extend the test: `parseReport` accepts a fenced or bare JSON object, drops unknown targets, rejects a
      missing field or a proposal outside the four values with `ReportError`; `renderReport` writes the five
      German sections in order, maps proposals to übernehmen/bewerten/beobachten/verwerfen, lists paths per
      project and the footer with route, model and date, and marks the automatic repo search when set;
      `targetLabels(["home-patrick", "home-patrick-news-agent"])` → `["target:dotfiles", "target:news-agent"]`.
- [x] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/investigations.test.ts` — expected: FAIL.
- [x] Implement.
- [x] Re-run — expected: PASS.
- [x] Commit (type feat, scope investigate): "investigation report schema and rendering".

## Task 5 — Investigator agent and the durable task

Permitted files: `news/investigate.ts`, the two prompt files, `agents/index.ts`, `agents/faux-script.ts`,
`config.ts`, `deps.ts`, `runtime.ts`, `tests/investigations.test.ts`, `.env.example`.

- [x] Extend the test with `fauxApp` (fixture mode → faux tracker, faux graph, faux model): create an issue in
      the faux tracker, `startInvestigation` → the row ends `done`, the tracker has one comment with
      `## Kurzfazit`, labels `investigated` and `target:news-agent`, and `investigating` is gone; a second
      `startInvestigation` for the same issue starts nothing. With the faux model scripted to answer invalid
      JSON twice the row is `queued` with attempts 1 and a failure comment; after three such runs `failed` and
      `investigation-failed`. With the probe stubbed down and no fallback model the row stays `queued`; with a
      fallback model and a stubbed `http` the row ends `done` with route `fallback` and the automatic-search
      mark; with `fallbacksToday` at the cap it stays `queued`. Restarting the app mid-run (stop after
      `running`, reopen on the same data dir) ends with exactly one report comment.
- [x] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/investigations.test.ts` — expected: FAIL.
- [x] Implement: config (`DNA_INVESTIGATE` default `faux` in fixture mode else `on`; repos list; fallback model;
      daily cap 5), `deps.graph`; the `investigator` extension with tools `deep_search`, `open_page`,
      `read_item`, `repo_search`, `repo_symbol`, `repo_overview` and the system prompt (untrusted issue text,
      read-only, JSON answer per schema, German report text); the faux `investigator` rule (one `repo_search`,
      then a valid report JSON naming `home-patrick-news-agent`); the task `dna.investigate` with phases
      `wait` (no active sweep, no other running row, poll 5 s) → `refresh` (index allowed projects) →
      `research` (route: probe `localBaseUrl`, else fallback when configured and under cap, else back to queued)
      → `finish` (render, comment, labels, row, `feed.card_updated`), failures through `fail`; one repair prompt
      for invalid JSON. The fallback is one chat completion to OpenRouter through `deps.http` with
      `OPENROUTER_API_KEY`, followed by `repo_search` over 3 to 5 title terms in every allowed project.
      `.env.example` lists the four variables.
- [x] Re-run — expected: PASS. Also `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/tools.test.ts dna-server-api/tests/deep-research.test.ts` — PASS, and `just test prompts` from the repo root — PASS.
- [x] Commit (type feat, scope investigate): "investigator agent and durable investigation task".

## Task 6 — Triggers

Permitted files: `routes/issues.ts`, `routes/workflows.ts`, `news/investigate.ts`, `tests/investigations.test.ts`,
`tests/card-issues.test.ts`.

- [x] Extend the tests: the S2 route with `DNA_INVESTIGATE=faux` leaves a `queued` or later row for the new
      issue and still answers 201 at once; with `DNA_INVESTIGATE=off` no row. `investigateCatchup`: with faux
      issues labeled `news-card` (one plain, one `investigated`, one `investigating`, one with a `queued` row,
      one `failed` row whose label was removed) it starts the plain one and the retried one; a second call
      within 10 minutes returns 0 without calling `list`; the news-sweep workflow call runs it.
- [x] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/investigations.test.ts dna-server-api/tests/card-issues.test.ts` — expected: FAIL.
- [x] Implement: `startInvestigation` after `addCardIssue` (not awaited past enqueue); `investigateCatchup`
      with the throttle in settings `investigateCatchupAt`, called from `workflow.newsSweep` after the sweep
      start (errors logged, never failing the workflow call).
- [x] Re-run — expected: PASS.
- [x] Commit (type feat, scope investigate): "start investigations on create and catch up on the tick".

## Task 7 — Browser client

Permitted files: `IssueButton.vue`, `CardDetailDialog.vue`, `styles/app.css`, `tests/ui-faux.mjs`.

- [x] Extend `tests/ui-faux.mjs`: after the existing "Create issue" check, wait until the issue chip has
      `aria-label` "Open issue #1, investigated" and a target tag "news-agent"; the detail dialog links the
      report comment.
- [x] Run from a dot-free copy (`rsync -a --exclude node_modules --exclude .git` into the session scratchpad,
      `node_modules` symlinked): `npm run build -w dna-client-browser && node dna-client-browser/tests/ui-faux.mjs`
      — expected: FAIL.
- [x] Implement the chip states (queued clock, running spinner, done check plus target tags, failed warning;
      `aria-label` "Open issue #n, <state>") and the dialog block (status, targets, model, route, report link).
- [x] Re-run from a fresh copy — expected: `ALL PASS`. `npm run check -w dna-client-browser` — exit 0.
- [x] Commit (type feat, scope browser): "investigation state on the issue chip".

## Task 8 — Verify and roll out

- [x] Apply `migrate()` to a sqlite backup copy of the live database: expected `["004_investigations.sql"]`,
      card and card-issue counts unchanged.
- [x] `just test unit` — expected: pass apart from the two failures known on `main`.
- [x] `just test faux` — expected: 21/22 plus any new faux tests passing (the known `stream.test.ts` failure).
- [x] `just test ui` from a dot-free copy — expected: `ALL PASS`.
- [x] Gate commands of the canonical template do not exist in this repo (no Taskfile); the commands above stand
      in for `task test:changed`. There are no generated artifacts, so `task freshness:regenerate` and
      `task freshness:check` have no counterpart.
- [ ] After merge: back up the live database, `git pull --ff-only` in `~/news-agent`, restart
      `news-agent-api` and `news-agent-hub`; `gh issue edit 150 151 152 -R Paddione/dotfiles --add-label news-card`;
      wait for the catch-up, then review the report on dotfiles#150 with the reader before leaving it running.
