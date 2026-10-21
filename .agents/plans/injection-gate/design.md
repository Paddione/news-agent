# Prompt-Injection-Gate (Issue #150, dotfiles inbox)

Date: 2026-10-21. Status: design written with the implementation (single pass, user chose full scope).

## Goal

Web text from sweeps must not reach the agent model on :1919 before the local judge has said whether the text
instructs the reader AI. The article behind the issue (loomcycle: decision model as prompt-injection judge)
shows a typed decision call beats a chat judge, provided the corpus, criteria and thresholds are ours.

## Decisions

- **One new jev command**, `prompt_engineering/jev/injection/command.json`, one `noul` question with
  criteria-based true/false definitions. Phrased so that text that only *reports or quotes* injections
  answers no — that is the hard negative class of our own inbox cards.
- **Band policy from the article, stored in the command's `policy`** (`reject_min: 0.7`, `allow_max: 0.3`):
  - `score >= 0.7` → `reject`: the item is dropped in the gate (`status = rejected`, reason in `last_error`).
  - `0.3 < score < 0.7` → `restrict`: the item stays, but agent tools show title and excerpt only.
  - `score <= 0.3` → `allow`: unchanged behaviour.
  Helpers live in `@dna/jev` (`injectionVerdict`) so command policy, gate and tools read the same numbers.
- **Where the gate runs**: the sweep `gate` phase, next to relevance and worth, with the same idempotency
  rule (a score is paid once, kept on `items.injection`, so a checkpoint replay never re-runs it).
  Everything downstream (dedupe, rank, research, present) then only ever sees items that passed.
- **Material judged**: title, source and `excerptOf()` — the feed's words plus the cached body when there is
  one, exactly the material relevance and worth already read. No extra page fetch in the gate: the gate must
  stay free and fast; the `jev_classify` `injection` case re-reads the page for an explicit re-check.
- **Persistence**: migration `005_item_injection.sql` adds `items.injection REAL` (NULL = never judged).
  No schema change to classifications: the score belongs to the item, not to an H/F/S card.
- **Enforcement of the restrict band** sits where an agent tool hands over page text: `read_item` prints the
  title and excerpt plus a reason line, `scrape_url` and `hyper_fetch` refuse with a hint. Judge-side reads
  (`pageText` for hfs, stories, rescore) are *not* restricted: the judge is the thing doing the checking.
- **Corpus** lives next to the command it measures: `prompt_engineering/jev/injection/corpus.jsonl`, one JSON
  row per text with `id`, `label` (`injection` | `clean`), `title`, `source`, `text`. Both classes are needed
  in production: injections must be caught, articles *about* injections must pass.
- **Measurement**: `scripts/judge-injection-eval.ts` runs the corpus through the same `LocalJev.systemOne`
  path production uses (manifest, template hash, min_mass floor included) and writes recall, precision, the
  band confusion, score separation and the model version to `prompt_engineering/jev/injection/eval-report.json`.
  The gate ships with the thresholds regardless; whether the current judge is *good enough* is a documented
  measurement result, not an assumption.

## Flow

1. `gather` collects items; its filter now also picks up items that have no injection score yet.
2. `gate` runs relevance, worth and injection in parallel per item (only the pieces that are missing).
3. `injection()` renders the command, judges, stores `items.injection` and returns the verdict.
4. Verdict `reject` → `status = rejected`, `last_error` explains why, the item never leaves the gate.
   Verdict `allow`/`restrict` → the relevance/worth thresholds decide `candidate` as before.
5. Tools that would show page text check `agentText()` first and withhold it in the review band.

## Out of scope

Retraining the judge (unsloth-boxes `news-judge-train`) — the corpus is the training/eval input for that
decision, this change only measures and gates. Firecrawl-credit funded full-page scanning inside the gate.
