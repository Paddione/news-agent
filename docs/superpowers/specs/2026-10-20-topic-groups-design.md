# Topic groups

Date: 2026-10-20. Status: approved design, awaiting spec review.

## Goal

The reader steers the feed with a few coarse knobs instead of 30+ topic weights. Topics are grouped
(agent-harnesses, agent-security, models, local-inference, agentic-resources, agent-ops), each group has a
hand-set weight, and every card shows the group its topic belongs to.

Why: topic weights alone do not converge to the reader's taste. Show me less moves a topic by -0.15 and
Show me more by +0.1, so a topic only rises when more than 60% of its cards are liked; with about 20% liked
cards every topic drifts to the 0.1 floor. The judge's topic matching is also noisy (48 cards on
"voice agents", mostly unrelated papers). Group weights are set by hand and are not moved by feedback.

## Scope

In: groups table, effective weight, group on cards, group tab, group API, settings UI, agent tool changes,
a one-off data rollout script.
Out: feedback moving group weights (feedback keeps nudging topic weights only), card-to-issue, investigation
and spec generation (separate sub-projects S2 to S4).

## Data model

Migration `apps/dna-server-api/src/db/migrations/002_topic_groups.sql`:

```sql
CREATE TABLE topic_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  weight REAL NOT NULL DEFAULT 1.0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE keywords ADD COLUMN group_id INTEGER REFERENCES topic_groups (id) ON DELETE SET NULL;
```

- `group_id` is only set on `kind = 'topic'` rows; the API rejects it on hype/facts/signal keywords.
- `name` is kebab-case, 1 to 40 characters (`^[a-z0-9]+(-[a-z0-9]+)*$`).
- `weight` is clamped to 0.1 to 2, like keyword and source weights.
- A card's group is derived at read time: `items.matched_topic` -> topic keyword (case-insensitive term
  match) -> `topic_groups.name`. Moving a topic to another group regroups its old cards too.
- `TasteRepo.seed` keeps `INSERT OR IGNORE`, so seeded topics never lose their group; a newly seeded topic
  has no group.

## Effective weight

`effective = topic.weight * (group ? group.weight : 1)`.

It replaces the topic weight in:

- `planQueries` (`src/news/taste.ts`): the weighted draw uses the effective weight. Topics whose group is
  disabled are not drawn.
- `weightsOf` (`src/news/rank.ts`): `topic` is the effective weight, so `rankScore` and the importance
  prompt's `topic_weight` use it.
- The `topic_keywords` list in the relevance and importance prompts (`src/news/hfs.ts`) carries the
  effective weight.
- `topicChoices` for the relevance prompt leaves out topics whose group is disabled.

Feedback (`applyFeedback`) is unchanged: it nudges the topic's own weight, never the group's.

## API and SDK

`apps/shared/packages/dna-sdk`:

```ts
export interface TopicGroup {
  id: number;
  name: string;
  weight: number;
  enabled: boolean;
  topicCount: number;
}
// Keyword gains: groupId?: number
// Card gains: group?: string   (next to the existing topic?: string)
// TAB_BYS becomes ["search", "keyword", "url", "group"]
// The taste.keywords bus frame gains groups: TopicGroup[]
```

Routes (`routes.ts`, scope `settings` like the keyword routes):

| Route | Method and path | Body / result |
|---|---|---|
| `groups.list` | `GET /v1/topic-groups` | `TopicGroup[]` |
| `groups.add` | `POST /v1/topic-groups` | `{ name, weight?, enabled? }` -> 201 `TopicGroup`; duplicate name -> 409 |
| `groups.update` | `PATCH /v1/topic-groups/:id` | `{ name?, weight?, enabled? }` -> `TopicGroup` |
| `groups.remove` | `DELETE /v1/topic-groups/:id` | topics of the group get `group_id = NULL` |

`POST /v1/keywords` and `PATCH /v1/keywords/:id` accept `groupId: number | null`. Unknown group id -> 404,
`groupId` on a non-topic keyword -> 400.

Every change to groups or to a keyword's group publishes `taste.keywords` with the keyword list and groups.

`searchCards(by: "group", value)` returns news cards whose item's `matched_topic` is a topic of the named
group, with the same visibility filters and order as the other tabs.

## Agent tools

- `edit_keyword` (`src/agents/tools/reader.ts`) gains an optional `group` (group name) to assign a topic to
  an existing group. The agent cannot create groups or change group weights.
- Keyword lines in `read_taste` and `reader.ts` show the group and the effective weight, e.g.
  `#12 topic "Claude Code" weight 1.50 group agent-harnesses (x2.00 = 3.00)`.
- `open_tab` accepts `by: "group"`.

## Browser client

- Card (`components/cards/CardView.vue`): a group chip next to the H/F/S line; the tooltip names the topic,
  a click opens the group tab.
- Search view: `WHAT.group` label for the group tab.
- Settings, Keywords tab (`SettingsModal.vue`): topics listed under one header per group plus "No group".
  Each header has a weight input and an enabled toggle. Each topic row has a group select. An
  "Add group" field creates a group.

## Data rollout (after deploy, not part of the migration)

A script `apps/dna-server-api/scripts/topic-groups-rollout.ts` calls the API with `DNA_CLIENT_TOKEN`:

1. Create the groups with their weights (set by the reader during rollout; default 1.0).
2. Create the new topics and assign them; disable the replaced topics (disable, not delete, because seeds
   come back on restart).
3. Print the before/after topic list so it can be reverted by hand.

Groups and topics:

| Group | Topics (term = web search query) |
|---|---|
| agent-harnesses | agent harness 2.0, Claude Code 1.5, Codex CLI 1.5, OpenCode 1.2, pi agent 1.0, multi-agent orchestration 0.7, durable agents 0.8, coding agents 0.6 (catch-all) |
| agent-security | coding agent security 2.0, prompt injection 1.5, agent sandboxing 1.5 |
| models | open-weight coding models 1.2, LLM judge models 1.5, Claude model release 1.0 |
| local-inference | llama.cpp 2.0, GGUF quantization 1.0 |
| agentic-resources | MCP servers 1.5, agent skills 1.0, Claude Code plugins 1.0, agent hooks 1.0, context engineering 1.2 |
| agent-ops | coding agent benchmarks 0.8, agent observability 0.8 |

Disabled: voice agents, Gemini CLI, Gemini, Aider, Cline, Goose agent, Cursor agent, DeepSeek Harness,
chain of thought monitoring, exe.dev, pi-durable, proactive agents, software factories, agentic
engineering, jev, classifiers, agent sandboxes, MCP, OpenAI Codex, compaction, agent benchmarks,
agent swarms.

## Tests (`apps/dna-server-api/tests`, `tsx --test`)

- Migration: applies on a store with existing keywords; `group_id` is NULL for all of them; existing weights
  unchanged.
- `planQueries`: draw probability follows the effective weight; topics of a disabled group are never drawn.
- `weightsOf`: returns topic weight times group weight; 1 as group factor without a group.
- `topicChoices`: leaves out topics of a disabled group.
- Group routes: add, update, remove; weight outside 0.1 to 2 -> 400; duplicate name -> 409; remove sets
  topics' `group_id` to NULL.
- Keyword routes: `groupId` assigns and unassigns; on a facts keyword -> 400; unknown id -> 404.
- `searchCards("group", name)` and `card(id).group` return the right cards and name.
- `applyFeedback` leaves group weights untouched.

Also: `npm run build` for the browser client (includes `vue-tsc`), `npm run lint` at the root, and
`npm test` in `apps/dna-client-browser` (includes `tests/ui-faux.mjs`).

## Risks

- A topic term that is not a good web query wastes a search slot. The rollout prints the topic list; terms
  that bring no cards after a week get replaced by hand.
- `matched_topic` stores the term as text. Renaming a topic orphans its old cards from the group. Renaming
  is rare; the settings UI warns on rename.
