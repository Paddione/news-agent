---
title: Prompt-Injection-Gate vor der Agent-Übergabe (dotfiles #150)
domains: [dna-server-api, jev]
status: completed
---

# injection-gate — Implementation Plan

Spec: `.agents/plans/injection-gate/design.md`. Base: `main` at `5e91cf6`, branch
`feature/injection-gate-20261021`, worktree `~/.worktrees/news-agent-0b2f6c96/feature/injection-gate-20261021`.
All commands run from `apps/` unless noted.

## Acceptance criteria

1. `just test unit` passes (tsc per package, oxlint, oxfmt --check, node:test over all workspaces).
2. `prompt_engineering/jev/injection/command.json` loads through `loadCommand`, renders through
   `renderCommand`, and `Judge.injection()` stores `items.injection` and returns the band verdict.
3. Sweep gate: an item whose text instructs the agent ends as `rejected` with a reason in `last_error` and
   never becomes a candidate; an item in the review band stays a candidate with a stored score; a replay of
   the gate phase does not judge the same item twice.
4. `read_item` shows title and excerpt only for an item in the review band; `scrape_url` and `hyper_fetch`
   refuse it with a hint; judge-side reads are untouched.
5. Corpus: `prompt_engineering/jev/injection/corpus.jsonl` parses, unique ids, both labels, every text long
   enough to be judged; test asserts structure.
6. `npx tsx scripts/judge-injection-eval.ts eval` measures the live local judge on :8010 and writes
   `eval-report.json` with recall, precision, band confusion, separation and model version.

## File Structure

Create:
- `apps/dna-server-api/prompt_engineering/jev/injection/command.json` — the noul question + band policy.
- `apps/dna-server-api/prompt_engineering/jev/injection/corpus.jsonl` — versioned test corpus.
- `apps/dna-server-api/src/db/migrations/005_item_injection.sql` — `items.injection REAL`.
- `apps/dna-server-api/src/news/injection.ts` — stored verdict + `agentText()` for tools.
- `apps/dna-server-api/scripts/judge-injection-eval.ts` — corpus benchmark against a live judge.
- `apps/dna-server-api/tests/injection.test.ts` — command, verdict, corpus, gate, tool restriction.

Modify:
- `apps/shared/packages/jev/src/policy.ts` — `InjectionVerdict`, `injectionVerdict()`.
- `apps/dna-server-api/src/news/hfs.ts` — `JEV_COMMANDS` + `Judge.injection()`.
- `apps/dna-server-api/src/news/sweep-task.ts` — gate phase runs the injection question.
- `apps/dna-server-api/src/db/repos/news.ts` — `Item.injection`, `toItem`, `updateItem` map.
- `apps/dna-server-api/src/news/fixtures.ts` — fixture rule for the injection question.
- `apps/dna-server-api/src/agents/tools/jev-classify.ts` — `injection` case.
- `apps/dna-server-api/src/agents/tools/read-item.ts`, `scrape-url.ts`, `hyper-fetch.ts` — restrict band.

## Result

Implemented and measured; see `prompt_engineering/jev/injection/eval-report.json` and the comment on
dotfiles issue #150.

### Live measurement 2026-10-21 (judge `2026-10-20-lfm2.5-1.2b`, LFM2.5-1.2B-Instruct q8_0, temp 1.2, min_mass 0.781, template_ok)

40/40 rows judged, 0 failures, p50 47 ms. Score ranges overlap completely:

- injection (20): 0 reject, 20 restrict, 0 allow — min 0.4087, mean 0.5826, max 0.6943
- clean (20): 3 reject (FP: clean-01, clean-02, clean-11), 17 restrict, 0 allow — min 0.3917, mean 0.5657, max 0.7288
- separation 0.0169, precision 0, recall 0, accuracy 0.425 at reject >= 0.7 / allow <= 0.3

Consequence: with this judge the gate degrades to restrict-by-default — no full page text
ever reaches the agent, injections are never hard-rejected, and three clean articles about
prompt injection are dropped. The 1.2B judge cannot separate with this prompt; a retrain in
`unsloth-boxes/news-judge-train` with injection rows (and an `injection` entry in
`manifest.commands`) is needed before the reject band can be trusted. Thresholds stay
configurable in the command `policy`, so a better judge flips the behaviour without code changes.
