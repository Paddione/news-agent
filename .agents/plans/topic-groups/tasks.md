---
title: Topic groups with hand-set group weights
domains: [dna-server-api, dna-sdk, dna-client-browser]
status: staged
---

# topic-groups — Implementation Plan

Spec: `.agents/plans/topic-groups/design.md` (approved 2026-10-20, group weights included).
Base: `main` at `45c9883`, branch `feature/topic-groups`, worktree
`~/.worktrees/news-agent-0b2f6c96/feature/topic-groups`. All commands run from `apps/` unless noted.

Repo profile: no `repo.yaml` in this repo. Assumed: main branch `main`, tickets `none`, task runner `just`
(`just test unit|faux|ui`), no generated artifacts, no S1 line-limit gate (no `docs/code-quality`).
Runtime: Node with `node --test --import tsx` (node:test; same as the package `tsx --test` scripts), TypeScript strict, Vue 3 + vite for the browser client.

## Acceptance criteria

1. Migration `002_topic_groups.sql` applies on a copy of the live `dna.sqlite`; all existing keywords keep
   their weights and get `group_id = NULL`.
2. `planQueries`, `weightsOf`, `topicChoices` and the relevance/importance prompt inputs use
   `topic.weight * group.weight`; topics of a disabled group are never drawn or offered.
3. `GET/POST /v1/topic-groups`, `PATCH/DELETE /v1/topic-groups/:id` work with the validation in the spec;
   `groupId` on keywords assigns/unassigns and is rejected on non-topic keywords.
4. Feed cards carry `group`; the `group` tab lists the group's cards; a card chip opens it.
5. Settings show topics per group with group weight, enabled toggle, topic group select and "Add group".
6. `applyFeedback` never changes a group weight.
7. `just test unit`, `just test faux` and `just test ui` pass.

## File Structure

Create:
- `apps/dna-server-api/src/db/migrations/002_topic_groups.sql` — table `topic_groups`, column `keywords.group_id`.
- `apps/dna-server-api/src/routes/topic-groups.ts` — handlers `groups.list|add|update|remove`.
- `apps/dna-server-api/scripts/topic-groups-rollout.ts` — one-off data rollout over the API.
- `apps/dna-server-api/tests/topic-groups.test.ts` — repo, effective weight, card group, search by group.
- `apps/dna-server-api/tests/topic-groups-routes.test.ts` — HTTP routes through the SDK client.
- `apps/dna-server-api/tests/topic-groups-rollout.test.ts` — rollout planning function.

Modify:
- `apps/dna-server-api/src/db/repos/taste.ts` (218 lines) — group CRUD, `groupId` on keywords, `effectiveWeight`.
- `apps/dna-server-api/src/news/taste.ts` (127) — `planQueries`, `topicChoices` use effective weight / skip disabled groups.
- `apps/dna-server-api/src/news/rank.ts` (39) — `weightsOf` returns effective topic weight.
- `apps/dna-server-api/src/news/hfs.ts` (313) — `topic_keywords` carry effective weight, drawn from enabled groups only.
- `apps/dna-server-api/src/db/repos/news.ts` (1128) — `card()` sets `group`; `searchCards` handles `by: "group"`.
- `apps/dna-server-api/src/routes/keywords.ts` (49) — `groupId` on add/update.
- `apps/dna-server-api/src/app.ts` — register `topicGroupRoutes`.
- `apps/dna-server-api/src/agents/tools/reader.ts` (338) — `edit_keyword` `group`, keyword lines, `open_tab` group, bus frame.
- `apps/dna-server-api/src/agents/tools/read-taste.ts` (46) — group and effective weight per topic.
- `apps/shared/packages/dna-sdk/src/api.ts` (620) — `TopicGroup`, `Keyword.groupId`, `Card.group`, `TAB_BYS`, bus frame.
- `apps/shared/packages/dna-sdk/src/routes.ts` (281) — four `groups.*` routes.
- `apps/shared/packages/dna-sdk/src/capabilities.ts` — `keywords` capability includes `groups.*`.
- `apps/shared/packages/dna-sdk/src/client.ts` — `topicGroups()`, `addTopicGroup()`, `updateTopicGroup()`, `removeTopicGroup()`, `groupId` on keyword bodies.
- `apps/dna-client-browser/fe/src/components/cards/CardView.vue` (127) — group chip.
- `apps/dna-client-browser/fe/src/components/SearchView.vue` (52) — `WHAT.group`.
- `apps/dna-client-browser/fe/src/components/SettingsModal.vue` (336) — group sections. If it passes ~420 lines,
  extract the topic section into `components/TopicGroupsSection.vue`.
- `apps/dna-client-browser/tests/ui-faux.mjs` — faux API serves `/v1/topic-groups`, one card with `group`.

## Interfaces (produced, consumed by later tasks)

```ts
// dna-sdk api.ts
export interface TopicGroup { id: number; name: string; weight: number; enabled: boolean; topicCount: number }
// Keyword: + groupId?: number      Card: + group?: string
export const TAB_BYS = ["search", "keyword", "url", "group"] as const;
// bus frame: { type: "taste.keywords"; keywords: Keyword[]; groups: TopicGroup[] }

// TasteRepo (db/repos/taste.ts)
groups(): TopicGroup[];
group(id: number): TopicGroup | undefined;
findGroup(name: string): TopicGroup | undefined;
addGroup(name: string, weight?: number, enabled?: boolean): TopicGroup;   // throws on duplicate name
updateGroup(id: number, patch: { name?: string; weight?: number; enabled?: boolean }): TopicGroup | undefined;
removeGroup(id: number): boolean;                                           // sets keywords.group_id NULL
setKeywordGroup(keywordId: number, groupId: number | null): Keyword | undefined;
effectiveWeight(k: Keyword): number;            // k.weight * (group?.weight ?? 1), rounded to 2 places
activeTopics(): Keyword[];                      // enabled topics whose group is absent or enabled
export const GROUP_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// rollout script
export function rolloutSteps(current: Keyword[], groups: TopicGroup[]): RolloutStep[];
type RolloutStep =
  | { op: "addGroup"; name: string; weight: number }
  | { op: "addTopic"; term: string; weight: number; group: string }
  | { op: "assignTopic"; id: number; term: string; weight: number; group: string }
  | { op: "disableTopic"; id: number; term: string };
```

## Task 1 — Migration and group repository

Setup (once): `npm install --no-audit --no-fund` in the worktree root (the worktree has no `node_modules`).

Permitted files: `002_topic_groups.sql`, `db/repos/taste.ts`, `tests/topic-groups.test.ts`, `dna-sdk/src/api.ts`
(types only). Timeout 10 min. Evidence: test output in the commit message body.

- [ ] Write `tests/topic-groups.test.ts` with `tempStore()`: groups CRUD; duplicate name throws; invalid name
      (`"Agent Harness"`) throws; `removeGroup` leaves its topics with `groupId` undefined; `setKeywordGroup`
      on a `facts` keyword throws; `effectiveWeight` = 1.5 × 1.2 = 1.8; `activeTopics` drops topics of a
      disabled group; existing seeded keywords have no `groupId` after migration.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/topic-groups.test.ts` — expected: FAIL
      (no table, no methods).
- [ ] Add the migration exactly as in the spec, the types in `api.ts`, and the repository methods.
      `toKeyword` maps `group_id` to `groupId`. Weights go through the existing `clamp`.
- [ ] Re-run the same command — expected: PASS. Run `npx tsc -p dna-server-api` — expected: exit 0.
- [ ] Commit (Conventional Commit, type feat, scope taste): "topic groups table and repository".

## Task 2 — Effective weight in drawing, ranking and prompts

Permitted files: `news/taste.ts`, `news/rank.ts`, `news/hfs.ts`, `tests/taste.test.ts`, `tests/topic-groups.test.ts`.

- [ ] Extend `tests/topic-groups.test.ts`: `planQueries` with a fixed `random` never returns a topic of a
      disabled group; with groups weighted 2.0 vs 0.1 the heavy group's topic wins the draw for
      `random = () => 0.5`; `weightsOf` on an item matched to a grouped topic returns the product;
      `topicChoices(store.taste.activeTopics())` has no key for a disabled group's topic;
      `applyFeedback(... signal: "less")` changes the topic weight and leaves `group.weight` unchanged.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/topic-groups.test.ts` — expected: FAIL.
- [ ] `planQueries` and the two prompt builders in `hfs.ts` read `store.taste.activeTopics()` and map
      `weight: store.taste.effectiveWeight(k)`. `weightsOf` uses `effectiveWeight` of `findKeyword`.
- [ ] Re-run the test file and `node --test --import tsx dna-server-api/tests/taste.test.ts dna-server-api/tests/judge.test.ts`
      — expected: PASS.
- [ ] Commit (Conventional Commit, type feat, scope taste): "rank and draw topics by group-weighted effective weight".

## Task 3 — SDK, routes and bus frame

Permitted files: `apps/shared/packages/dna-sdk/src/api.ts`, `apps/shared/packages/dna-sdk/src/routes.ts`,
`apps/shared/packages/dna-sdk/src/capabilities.ts`, `apps/shared/packages/dna-sdk/src/client.ts`, `routes/topic-groups.ts`, `routes/keywords.ts`,
`app.ts`, `agents/tools/reader.ts` (publish helper only), `tests/topic-groups-routes.test.ts`.

- [ ] Write `tests/topic-groups-routes.test.ts` with `bootServer` (pattern of `tests/settings.test.ts`):
      add/list/update/remove a group; weight 3 → 400; name `"Bad Name"` → 400; duplicate → 409;
      `updateKeyword(id, { groupId })` assigns and `{ groupId: null }` unassigns; `groupId` on a `signal`
      keyword → 400; unknown group id → 404; `DELETE` leaves the topic with no group.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/topic-groups-routes.test.ts` — expected: FAIL.
- [ ] Add routes `groups.list` (`GET /v1/topic-groups`, scope `read`), `groups.add` (`POST`, `settings`),
      `groups.update` (`PATCH /v1/topic-groups/:id`, `settings`), `groups.remove` (`DELETE`, `settings`);
      client methods; capability entry. Duplicate name → `conflict` error code. Every change publishes
      `taste.keywords` with `keywords` and `groups` (one helper used by routes and `reader.ts`).
- [ ] Re-run the test file and `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/settings.test.ts dna-server-api/tests/auth.test.ts`
      — expected: PASS.
- [ ] Commit (Conventional Commit, type feat, scope api): "topic group routes and groupId on keywords".

## Task 4 — Group on cards and the group tab

Permitted files: `db/repos/news.ts`, `dna-sdk/src/api.ts`, `tests/topic-groups.test.ts`.

- [ ] Extend the test: a card whose item has `matched_topic = 'Claude Code'` (case differs from the keyword)
      gets `group: "agent-harnesses"`; a card with an ungrouped topic has no `group`;
      `searchCards("group", "agent-harnesses")` returns exactly the grouped cards, newest first.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/topic-groups.test.ts` — expected: FAIL.
- [ ] `card()` joins `keywords` (kind `topic`, `lower(term) = lower(i.matched_topic)`) and `topic_groups`;
      `searchCards` adds the `group` branch with the same `STORY_VISIBLE`/`RELEASE_VISIBLE` filters.
      `TAB_BYS` gains `"group"`.
- [ ] Re-run, plus `node --test --import tsx dna-server-api/tests/stories.test.ts dna-server-api/tests/card-render.test.ts`
      — expected: PASS.
- [ ] Commit (Conventional Commit, type feat, scope feed): "group on cards and group tab search".

## Task 5 — Agent tools

Permitted files: `agents/tools/reader.ts`, `agents/tools/read-taste.ts`, `tests/tools.test.ts`.

- [ ] Extend `tests/tools.test.ts`: `edit_keyword` with `group: "agent-security"` assigns the topic; an
      unknown group name returns an error text and changes nothing; the keyword line reads
      `group agent-security (x1.50 = 3.00)`; `open_tab` with `by: "group"` publishes `ui.open_tab`.
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/tools.test.ts` — expected: FAIL.
- [ ] Implement. The agent cannot create groups or change group weights (no new tool).
- [ ] Re-run — expected: PASS. Then `just test prompts` from the repo root — expected: PASS.
- [ ] Commit (Conventional Commit, type feat, scope agent): "topic groups in keyword tools".

## Task 6 — Browser client

Permitted files: `CardView.vue`, `SearchView.vue`, `SettingsModal.vue`, optional `TopicGroupsSection.vue`,
`styles/app.css`, `tests/ui-faux.mjs`.

- [ ] Extend `tests/ui-faux.mjs`: the faux API returns two groups and one card with `group`; assert the chip
      text, that clicking it opens the group tab (`data-search="group-agent-harnesses"`), and that the
      settings Keywords tab shows a section header per group.
- [ ] Run `npm run build -w dna-client-browser && node dna-client-browser/tests/ui-faux.mjs` — expected: FAIL.
- [ ] Implement chip (tooltip = topic), `WHAT.group = "in group"`, settings sections with weight input
      (0.1–2, step 0.1), enabled toggle, per-topic group select, "Add group" form, rename warning.
- [ ] Re-run — expected: PASS. `npm run check -w dna-client-browser` — expected: exit 0.
- [ ] Commit (Conventional Commit, type feat, scope browser): "group chips, group tab and group settings".

## Task 7 — Rollout script

Permitted files: `scripts/topic-groups-rollout.ts`, `tests/topic-groups-rollout.test.ts`.

- [ ] Write the test for `rolloutSteps`: from a keyword list containing `MCP` and `Claude Code` and no
      groups it yields `addGroup` ×6 with the spec weights, `assignTopic` for `Claude Code` (weight 1.5,
      `agent-harnesses`), `addTopic` for `MCP servers`, `disableTopic` for `MCP`; running it on its own
      output state yields no steps (idempotent).
- [ ] Run `NODE_NO_WARNINGS=1 node --test --import tsx dna-server-api/tests/topic-groups-rollout.test.ts` — expected: FAIL.
- [ ] Implement the table from the spec as data, `rolloutSteps` as a pure function, and a CLI that reads
      `DNA_CLIENT_TOKEN` and `DNA_PORT` from the environment, prints the steps, and applies them only with
      `--apply`. It prints the before list as JSON for manual revert.
- [ ] Re-run — expected: PASS.
- [ ] Commit (Conventional Commit, type feat, scope scripts): "topic groups rollout".

## Task 8 — Verify

- [ ] `cp ~/news-agent-data/live/dna.sqlite /tmp/dna-copy.sqlite` and open it with the store's `migrate()`
      through a one-line `npx tsx -e` call; expected: `["002_topic_groups.sql"]` applied, keyword count and
      weights unchanged (compare `SELECT id, weight FROM keywords` before/after).
- [ ] From the repo root: `just test unit` — expected: PASS (types, oxlint, oxfmt, all unit suites).
- [ ] `just test faux` — expected: PASS.
- [ ] `just test ui` — expected: PASS.
- [ ] Gate commands of the canonical template do not exist in this repo (no Taskfile); the equivalents above
      replace `task test:changed`. There are no generated artifacts, so `task freshness:regenerate` and
      `task freshness:check` have no counterpart.
- [ ] After merge and `systemctl --user restart news-agent-api news-agent-hub`:
      `npx tsx dna-server-api/scripts/topic-groups-rollout.ts` (dry run), review, then `--apply`.
