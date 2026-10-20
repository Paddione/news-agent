---
title: Card to issue
domains: [dna-server-api, dna-sdk, dna-client-browser]
status: completed
---

# card-to-issue — Implementation Plan

Spec: `.agents/plans/card-to-issue/design.md` (approved 2026-10-20).
Base: `main` at `58a87a6`, branch `feature/card-to-issue`, worktree
`~/.worktrees/news-agent-0b2f6c96/feature/card-to-issue`. Commands run from `apps/` unless noted.

Repo profile: no `repo.yaml`. Assumed: main branch `main`, tickets `none`, task runner `just`, no generated
artifacts, no line-limit gate. Runtime: Node, `node --test --import tsx` (node:test), Vue 3 + vite.

Setup (once): `npm install --no-audit --no-fund` in the worktree root.

## Acceptance criteria

1. `POST /v1/cards/:id/issue` creates one issue per card in `DNA_ISSUE_REPO` via `gh`, returns 201, and 200 with
   the same issue on every later call without calling GitHub.
2. A tracker failure returns 503 and writes nothing; a retry works.
3. The issue body has the note, card facts, findings and the untrusted-content line; labels are `news-card`
   plus `group:<name>` for grouped cards.
4. Cards carry `issue`; the card shows a button with a note panel, then a "#n" chip; the detail dialog links it.
5. With `DNA_SEARCH_MODE=fixture` the tracker defaults to `faux`, so no test creates a real issue.
6. `just test unit`, `just test faux` and `just test ui` pass, apart from the two failures known on `main`
   (`stream.test.ts` SSE transcript, `dna-cli` doctor "Node 24" on Node 22).

## File Structure

Create:
- `apps/dna-server-api/src/db/migrations/003_card_issues.sql` — table `card_issues`.
- `apps/dna-server-api/src/news/issues.ts` — `IssueTracker`, `ghTracker`, `fauxTracker`, `issueFor`.
- `apps/dna-server-api/src/routes/issues.ts` — handler `cards.issue`.
- `apps/dna-server-api/tests/issues.test.ts` — tracker and body builder.
- `apps/dna-server-api/tests/card-issues.test.ts` — repository and route.
- `apps/dna-client-browser/fe/src/components/IssueButton.vue` — button, note panel, chip.

Modify:
- `apps/dna-server-api/src/db/repos/news.ts` — `cardIssue`, `addCardIssue`, `card().issue`.
- `apps/dna-server-api/src/config.ts` — `issueRepo`, `issueLabel`, `issueTracker`.
- `apps/dna-server-api/src/deps.ts` — `issues: IssueTracker`.
- `apps/dna-server-api/src/runtime.ts` — build the tracker from config.
- `apps/dna-server-api/src/app.ts` — register `issueRoutes`.
- `apps/shared/packages/dna-sdk/src/api.ts` — `CardIssue`, `Card.issue`.
- `apps/shared/packages/dna-sdk/src/routes.ts` — route `cards.issue`.
- `apps/shared/packages/dna-sdk/src/capabilities.ts` — capability `card.issue`.
- `apps/shared/packages/dna-sdk/src/client.ts` — `createIssue(cardId, body)`.
- `apps/dna-client-browser/fe/src/components/cards/CardView.vue` — mount `IssueButton`.
- `apps/dna-client-browser/fe/src/components/CardDetailDialog.vue` — issue link.
- `apps/dna-client-browser/fe/src/styles/app.css` — panel and chip styles.
- `apps/dna-client-browser/tests/ui-faux.mjs` — issue checks.
- `README.md` — the three `DNA_ISSUE_*` variables.

## Interfaces

```ts
// dna-sdk api.ts
export interface CardIssue { repo: string; number: number; url: string; note?: string; createdAt: string }
// Card: + issue?: { number: number; url: string }

// news/issues.ts
export interface IssueInput { title: string; body: string; labels: string[] }
export interface CreatedIssue { number: number; url: string }
export interface IssueTracker { readonly repo: string; create(input: IssueInput): Promise<CreatedIssue> }
export class IssueTrackerError extends Error {}
export type ExecFile = (
  file: string, args: string[], input?: string,
) => Promise<{ stdout: string; stderr: string; code: number }>;
export function ghTracker(repo: string, exec?: ExecFile): IssueTracker;
export function fauxTracker(repo: string): IssueTracker & { created: IssueInput[] };
export function issueFor(card: Card, item: Item | undefined, findings: Finding[], note: string | undefined,
  baseLabel: string): IssueInput;

// NewsRepo
cardIssue(cardId: number): CardIssue | undefined;
addCardIssue(cardId: number, input: { repo: string; number: number; url: string; note?: string }): CardIssue;

// Config: issueRepo: string; issueLabel: string; issueTracker: "gh" | "faux"
```

## Task 1 — Card issues table and repository

Permitted files: `003_card_issues.sql`, `db/repos/news.ts`, `dna-sdk/src/api.ts`, `tests/card-issues.test.ts`.

- [ ] Write `tests/card-issues.test.ts` (repository part, `tempStore()`): a new card has no `issue`;
      `addCardIssue` stores repo/number/url/note and `card(id).issue` is `{ number, url }`;
      `cardIssue(id)` returns the row with `createdAt`; a second `addCardIssue` for the same card throws.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/card-issues.test.ts` — expected: FAIL.
- [ ] Add the migration from the spec, the SDK types and the two repository methods; `card()` selects the issue
      with a `LEFT JOIN card_issues`.
- [ ] Re-run — expected: PASS. `npx tsc -p dna-server-api` — expected: exit 0.
- [ ] Commit (type feat, scope feed): "card issues table".

## Task 2 — Issue tracker and issue body

Permitted files: `news/issues.ts`, `tests/issues.test.ts`.

- [ ] Write `tests/issues.test.ts`:
      `ghTracker("Paddione/dotfiles", stub)` with a stub `ExecFile` that records calls and answers
      `https://github.com/Paddione/dotfiles/issues/153\n`: `create` returns `{ number: 153, url }`; the calls are
      `gh label create news-card -R Paddione/dotfiles --force`, then
      `gh issue create -R Paddione/dotfiles --title … --body-file - --label news-card`, with the body as `input`;
      a second `create` with the same label does not call `label create` again;
      exit code 1 with stderr "HTTP 401" → `IssueTrackerError` matching /HTTP 401/;
      output "ok" → `IssueTrackerError` matching /unexpected/.
      `fauxTracker` numbers 1, 2 and records inputs.
      `issueFor` for a grouped card with two findings and a note: title is the card title, labels
      `["news-card", "group:agent-security"]`, body contains `## Note`, the source URL, `H 14 F 89 S 74`,
      both finding summaries and the untrusted-content line; without note no `## Note`; a 300-character title
      is cut to 120.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/issues.test.ts` — expected: FAIL.
- [ ] Implement. The real `ExecFile` wraps `node:child_process` `execFile` (no shell) and writes `input` to
      stdin; stderr in errors is trimmed to 500 characters.
- [ ] Re-run — expected: PASS.
- [ ] Commit (type feat, scope issues): "gh issue tracker and card issue body".

## Task 3 — Config, deps and the route

Permitted files: `config.ts`, `deps.ts`, `runtime.ts`, `app.ts`, `routes/issues.ts`,
`apps/shared/packages/dna-sdk/src/api.ts`, `apps/shared/packages/dna-sdk/src/routes.ts`,
`apps/shared/packages/dna-sdk/src/capabilities.ts`, `apps/shared/packages/dna-sdk/src/client.ts`,
`tests/card-issues.test.ts`, `README.md`.

- [ ] Extend `tests/card-issues.test.ts` with `bootServer({ FIRECRAWL_API_KEY: "" })` (fixture search mode, so
      the tracker is faux): `client.createIssue(card.id, { note: "check our hooks" })` → `number` 1 and the
      card's `issue`; the second call returns the same number; the faux tracker saw one input; a 2001-character
      note → 400; card 999999 → 404; with the tracker's `create` replaced by a throwing function → 503 and
      no row, then a retry → 201. A `feed.card_updated` frame for the card is published.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/card-issues.test.ts` — expected: FAIL.
- [ ] Config: `issueRepo` (`DNA_ISSUE_REPO`, default `Paddione/dotfiles`), `issueLabel` (`DNA_ISSUE_LABEL`,
      default `news-card`), `issueTracker` (`DNA_ISSUE_TRACKER`, default `faux` when `searchMode === "fixture"`,
      else `gh`). Runtime builds `deps.issues`. Route `cards.issue` (`POST /v1/cards/:id/issue`, scope
      `feedback`): existing row → 200; else build with `issueFor`, `create`, store, publish, 201; tracker errors
      → `ApiFault("unavailable", message)`. The repo never comes from the request. SDK route, capability
      `card.issue`, client `createIssue`. README lists the variables.
- [ ] Re-run, plus `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/auth.test.ts dna-server-api/tests/settings.test.ts`
      — expected: PASS.
- [ ] Commit (type feat, scope api): "turn a card into an issue".

## Task 4 — Browser client

Permitted files: `IssueButton.vue`, `CardView.vue`, `CardDetailDialog.vue`, `styles/app.css`, `tests/ui-faux.mjs`.

- [ ] Extend `tests/ui-faux.mjs` (the API already runs with `DNA_SEARCH_MODE=fixture`, so the tracker is faux):
      on the first visible card click "Create issue", fill "What should be checked? (optional)" with
      "check our hooks", click the panel's "Create issue"; the chip "#1" appears with `href` ending `/issues/1`;
      after `page.reload()` the chip is still there; `GET /v1/cards/:id` has `issue.number === 1`.
- [ ] Run `npm run build -w dna-client-browser && node dna-client-browser/tests/ui-faux.mjs` from a dot-free copy
      (`rsync -a --exclude node_modules --exclude .git` of the worktree into the session scratchpad, with
      `node_modules` symlinked) — expected: FAIL.
- [ ] Implement the component as in the spec (icon `CircleDot`, Escape closes, button disabled while pending,
      note kept on error), mount it in the card meta row before Details, link the issue in the detail dialog.
- [ ] Re-run from a fresh copy — expected: PASS (`ALL PASS`). `npm run check -w dna-client-browser` — exit 0.
- [ ] Commit (type feat, scope browser): "create issue button on cards".

## Task 5 — Verify and roll out

- [ ] Copy the live database with the sqlite backup API and apply `migrate()` to the copy: expected
      `["003_card_issues.sql"]` and unchanged card count.
- [ ] From the repo root: `just test unit` — expected: pass apart from the two failures known on `main`.
- [ ] `just test faux` — expected: 21/22 (the known `stream.test.ts` failure).
- [ ] `just test ui` from a dot-free copy — expected: `ALL PASS`.
- [ ] Gate commands of the canonical template do not exist in this repo (no Taskfile); the commands above stand
      in for `task test:changed`. There are no generated artifacts, so `task freshness:regenerate` and
      `task freshness:check` have no counterpart.
- [ ] After merge: back up `~/news-agent-data/live/dna.sqlite`, `git pull --ff-only` in `~/news-agent`,
      `systemctl --user restart news-agent-api news-agent-hub`, convert one card from the UI, check the issue in
      `Paddione/dotfiles` and close it if it was only a test.
