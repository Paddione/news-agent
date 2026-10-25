---
title: Nemotron 3.5 Bolt E4B local integration
domains: [durable-agent, dna-server-api, docs]
status: staged
---

# nemotron-e4b-integration — Implementation Plan

Spec: `.agents/plans/nemotron-e4b-integration/design.md`.
Base: `main` at `ac2cfde`, branch `feature/nemotron-e4b-integration`, worktree
`~/.worktrees/news-agent-0b2f6c96/feature/nemotron-e4b-integration`.
Commands run from the worktree root unless noted.

Repo profile: no `repo.yaml`. Assumed: main branch `main`, tickets `none`,
task runner `just`, no generated artifacts, no line-limit gate. Runtime: Node,
`node --test --import tsx` (node:test), TypeScript.

## Acceptance criteria

1. A documented recipe serves Nemotron 3.5 Bolt E4B via llama.cpp and points
   news-agent at it through `DNA_PROVIDER=local` + `DNA_LOCAL_*`.
2. `npm run eval:local-model` (or equivalent) sends a fixed prompt set to the
   local endpoint and prints per-prompt tool-call success + latency, exiting 0
   on completion.
3. `.env.example` contains an E4B profile (commented) alongside the existing
   Qwen profile.
4. `README.md` documents the E4B serving recipe and the comparison workflow.
5. `just test unit` still passes (no regression in durable-agent / dna-server-api).

## File Structure

Create:
- `apps/dna-server-api/scripts/eval-local-model.mjs` — fixed prompt-set runner
  against the local endpoint; prints tool-call success + latency; exit 0 on
  completion.
- `docs/local-models.md` — supported local models (Qwen slot + E4B), serving
  recipes, env profiles, comparison workflow.

Modify:
- `.env.example` — add commented E4B profile (`DNA_LOCAL_MODEL`,
  `DNA_LOCAL_CONTEXT`, `DNA_LOCAL_BASE_URL`).
- `README.md` — add "Local models" section linking to `docs/local-models.md`
  and the E4B recipe.
- `package.json` — add `eval:local-model` script entry.

## Interfaces

```js
// eval-local-model.mjs
// Env: DNA_LOCAL_BASE_URL (default http://127.0.0.1:8099),
//      DNA_LOCAL_MODEL (default Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf's served alias),
//      DNA_LOCAL_CONTEXT (informational).
// Output: one line per prompt: "<id> tool=<name|null> latency_ms=<n> ok=<bool>"
// Exit 0 on completion, 1 if the endpoint is unreachable.
```

## Tasks

### Task 1 — Document local models and E4B recipe

- Create `docs/local-models.md` with:
  - Overview: news-agent local provider is env-driven; any OpenAI-compatible
    endpoint works.
  - Qwen slot recipe (existing, summarized).
  - E4B recipe:
    - Download: `hf_hub_download('nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB', 'Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf')`
    - Serve: `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=<gpu> ~/opt/llama-current/bin/llama-server -m <gguf> -c 8192 -ngl 99 -fa on --jinja --host 127.0.0.1 --port 8099`
    - Env profile: `DNA_PROVIDER=local`, `DNA_LOCAL_BASE_URL=http://127.0.0.1:8099`, `DNA_LOCAL_MODEL=<served alias>`, `DNA_LOCAL_CONTEXT=8192`.
    - Memory: ~8.2 GB VRAM at 8k ctx; 32k recipe for 5070 Ti.
  - Comparison workflow: serve both (different ports), run `npm run eval:local-model`
    against each, compare tool-call success + latency.
- Modify `README.md`: add a "Local models" section linking to the doc.

### Task 2 — .env.example E4B profile

- Append a commented block to `.env.example`:
  ```
  # Nemotron 3.5 Bolt E4B (local slot, see docs/local-models.md)
  # DNA_PROVIDER=local
  # DNA_LOCAL_BASE_URL=http://127.0.0.1:8099
  # DNA_LOCAL_MODEL=Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf
  # DNA_LOCAL_CONTEXT=8192
  ```
- Keep the existing Qwen profile intact.

### Task 3 — eval-local-model script

- Create `apps/dna-server-api/scripts/eval-local-model.mjs`:
  - Read env (defaults above).
  - Health-check the endpoint; exit 1 with a clear message if unreachable.
  - Fixed prompt set (≥6 prompts, mix of simple + tool-calling with a
    `get_weather` tool schema).
  - For each prompt: POST `/v1/chat/completions`, measure latency, parse
    tool_calls, print `<id> tool=<name|null> latency_ms=<n> ok=<bool>`.
  - Print a summary line: `summary ok=<n>/<total>`.
  - Exit 0 on completion.
- Add to `package.json` scripts: `"eval:local-model": "node apps/dna-server-api/scripts/eval-local-model.mjs"`.

### Task 4 — Verification

- Run `just test unit` (or `npm test` in affected packages) to confirm no
  regression.
- Manually run the script against a live E4B endpoint and confirm output format.

## Verification commands

- `just test unit` (from repo root) — must pass.
- `npm run eval:local-model` against a live endpoint — must print per-prompt
  lines + summary and exit 0.

## Risks

- `eval_harness.py` compares base-vs-tuned finetunes, not two served models;
  this script is a lighter smoke/compare tool, not a statistical benchmark.
- E4B tool-calling quality vs. Qwen slot is unmeasured beyond the smoke test;
  adoption decision needs the comparison run.