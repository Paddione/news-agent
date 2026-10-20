# Issue investigation

Date: 2026-10-20. Status: approved design, awaiting spec review. Sub-project S3 of four (S1 topic groups #4,
S2 card to issue #5/#6; S4 turns finished investigations into specs and plans for dev-flow).

## Goal

Every news-card issue in the inbox repo gets investigated without a click: what the source says (web), what
our repos already have and what is missing (code graph), and a proposal with target repos. The result is a
comment on the issue plus labels, and the card shows the state.

## Decisions

- Model: the investigation runs as a subagent on the local agent model (Swift on :1919) with the news agent's
  research tools. When :1919 does not answer, a research model over OpenRouter does the web half
  (`DNA_INVESTIGATE_FALLBACK_MODEL`), capped per day; the repo half then falls back to a fixed graph search.
- Trigger: automatic. The S2 route starts an investigation after it creates an issue; a catch-up on the
  minute tick finds news-card issues without a result (issues created elsewhere, interrupted runs).
- Targets are recommended only: the issue stays in the inbox and gets `target:<repo>` labels. Nothing is
  transferred.
- One investigation at a time, and never while a sweep runs, so it does not compete with the news agent for
  :1919.
- The issue text is untrusted. The investigator's tools are read-only; the server, not the agent, writes the
  comment and labels.

## Flow

1. Start: `startInvestigation(repo, number, cardId?)` inserts a `queued` row (idempotent per issue) and
   enqueues the durable task `dna.investigate`. Callers: the S2 route after a create, and the catch-up.
2. Catch-up (in the news-sweep workflow call, at most every 10 minutes, stored in settings
   `investigateCatchupAt`): `gh issue list -R <issue repo> --label <DNA_ISSUE_LABEL> --state open --json
   number,labels` and start every issue without `investigating`, `investigated` or `investigation-failed`
   that has no `queued`/`running` row. An issue whose `investigation-failed` label was removed by the reader
   and whose row is `failed` gets its attempts reset and starts again.
3. The task waits until no sweep is running and no other investigation is `running` (checked on a short
   poll, durable across restarts), then sets `running`, adds the `investigating` label and refreshes the code
   graph (`codebase-memory-mcp cli index_repository --repo-path <root>` for each allowed project; roots from
   `list_projects`).
4. Route: if `localBaseUrl` answers its health check → local; else if `DNA_INVESTIGATE_FALLBACK_MODEL` is set
   and today's fallback count is below `DNA_INVESTIGATE_FALLBACK_DAILY` → fallback; else stay `queued` and
   retry on the next catch-up.
5. Local: one subagent conversation (prompt `prompt_engineering/agents/investigator/SYSTEM_PROMPT.md`) with
   tools `deep_search`, `open_page`, `read_item` and the three repo tools below. Input: the issue title and
   body (fetched with `gh issue view --json title,body`), framed as untrusted data, plus the allowed projects.
   It must answer with the report as JSON (schema below).
6. Fallback: one OpenRouter call to the research model with the issue as untrusted data, asking for the web
   half of the report; then for 3 to 5 key terms from the issue title, `repo_search` in every allowed project,
   and the hits go into "Was wir schon haben" marked "automatische Suche, kein Abgleich durch das Modell".
7. Finish: the server renders the report to Markdown, posts it with `gh issue comment --body-file -`, removes
   `investigating`, adds `investigated` and one `target:<repo>` per target, stores `done` with the comment URL,
   and publishes `feed.card_updated` for the card.
8. Failure (model error, invalid JSON after one repair prompt, gh failure): attempts + 1, a short comment
   with the reason, label `investigating` removed; after the third attempt status `failed` and label
   `investigation-failed`, otherwise back to `queued` for the catch-up.

## Report schema

```ts
interface InvestigationReport {
  summary: string;                       // Kurzfazit, 2 to 4 sentences
  source: { claim: string; evidence: string[] }[];   // Was die Quelle sagt, with links
  existing: { project: string; paths: string[]; note: string }[];  // Was wir schon haben
  missing: string[];                     // Was fehlt
  proposal: "adopt" | "evaluate" | "watch" | "drop";
  targets: string[];                     // allowed project names; unknown ones are dropped
  reasoning: string;
}
```

Rendered in German: `## Kurzfazit`, `## Was die Quelle sagt`, `## Was wir schon haben`, `## Was fehlt`,
`## Vorschlag` (übernehmen/bewerten/beobachten/verwerfen, Ziel-Repos, Begründung), and a footer with model,
route and date. Target labels use the repo name without the `home-patrick-` prefix (`target:news-agent`,
`target:dotfiles` for `home-patrick`).

## Repo tools (read-only)

`src/agents/tools/repo.ts`, all through `codebase-memory-mcp cli` via `execFile` (no shell), output cut to
6000 characters, `project` must be in `DNA_INVESTIGATE_REPOS`:

| Tool | CLI |
|---|---|
| `repo_search(project, query)` | `search_code --project <p> --pattern <q> --mode compact` |
| `repo_symbol(project, name)` | `search_graph --project <p> --name-pattern <name>` then `get_code_snippet --project <p> --qualified-name <qn>` for the first hit |
| `repo_overview(project)` | `get_architecture --project <p>` |

## Data

Migration `004_investigations.sql`:

```sql
CREATE TABLE investigations (
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  card_id INTEGER REFERENCES cards (id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  route TEXT CHECK (route IN ('local', 'fallback')),
  model TEXT,
  report_md TEXT,
  targets_json TEXT,
  comment_url TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (repo, number)
);
```

`Card.issue` gains `investigation?: { status, targets: string[], commentUrl?: string }` from the row of the
card's issue.

## Issue tracker additions

`IssueTracker` (S2) gains `list(label)`, `view(number)` (title, body, labels), `comment(number, body)` →
URL, `addLabels(number, labels)`, `removeLabel(number, label)`. The gh implementation uses the same
`execFile` seam; the faux tracker keeps issues in memory so faux mode and tests run the full flow.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DNA_INVESTIGATE` | `on`; `faux` when `DNA_SEARCH_MODE=fixture` | `on`, `off`, `faux` (faux graph and tracker) |
| `DNA_INVESTIGATE_REPOS` | `home-patrick,home-patrick-Bachelorprojekt,home-patrick-agentic-resources,home-patrick-news-agent,home-patrick-unsloth-boxes` | graph projects the investigator may read |
| `DNA_INVESTIGATE_FALLBACK_MODEL` | unset | OpenRouter research model; unset means no fallback |
| `DNA_INVESTIGATE_FALLBACK_DAILY` | `5` | fallback investigations per day |

## Browser client

- The issue chip shows the investigation state: queued (clock), running (spinner), done (check plus target
  tags), failed (warning). Each state has an `aria-label`.
- The detail dialog shows status, targets, model and route, and links the report comment.
- No new button: removing `investigation-failed` on GitHub retries. No new capability, so CLI and TUI only
  show the state where they already print the issue.

## Tests

- Report: rendering of every section; unknown targets dropped; label names; invalid JSON → one repair prompt,
  then failure.
- State: queued → running → done with comment and labels; three failures → `failed` and label; label removed
  → attempts reset; a restart mid-run finishes without a second comment.
- Catch-up: skips `investigating`/`investigated`/`investigation-failed` and issues with an active row; asks
  GitHub at most every 10 minutes; starts nothing while a sweep or another investigation runs.
- Route: :1919 down → fallback; daily cap reached → stays queued; no fallback model → stays queued.
- Repo tools (stub `execFile`): arguments, unknown project rejected, output cut, index refresh per project.
- End to end (`fauxApp`, faux model script, faux tracker, faux graph): a card turned into an issue ends
  `done` with a comment, labels and the card's investigation state.
- UI (`ui-faux.mjs`): after the faux investigation the chip shows done and a target tag.
- `just test unit`, `just test faux`; `just test ui` from a dot-free copy.

## Rollout

1. Apply `004` to a copy of the live database, back up, deploy, restart.
2. Add the `news-card` label to dotfiles#150, #151 and #152 (they were filed by hand with `enhancement`
   only), so the catch-up picks them up.
3. Review the first report (dotfiles#150, the injection judge) together before leaving it running.

## Risks

- Swift's answers can be thin or wrong about our code; the report names paths so they can be checked, and
  S4 re-reads the code before planning.
- Untrusted issue text reaches the model. Read-only tools and server-side writes limit what a prompt
  injection can do to a misleading report; the report footer names the route and model.
- The graph refresh adds a few seconds per project per investigation.
