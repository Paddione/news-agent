---
title: Nemotron 3.5 Bolt E4B local integration
domains: [durable-agent, dna-server-api, docs]
status: staged
---

# Nemotron 3.5 Bolt E4B — local integration

Spec for issue #225 (Paddione/dotfiles). Goal: make NVIDIA Nemotron 3.5 Bolt E4B
(`nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB`, Q4_K_M) a first-class, documented
local slot in news-agent, with a reproducible smoke/eval recipe, so it can be
compared against the current Qwen3.8-27B slot and adopted if it wins.

## Decisions

- **No catalog code change required.** `localCatalog` in
  `apps/shared/packages/durable-agent/src/models.ts` is already env-driven
  (`DNA_LOCAL_BASE_URL`, `DNA_LOCAL_MODEL`, `DNA_LOCAL_CONTEXT`). E4B is served
  by pointing those at a llama-server instance. Adding a hardcoded entry would
  duplicate config and fight the existing design.
- **Display name/icon:** keep `name = local.model` and `icon = "qwen.png"` for
  now; add a small optional `DNA_LOCAL_ICON`/`DNA_LOCAL_NAME` override is out of
  scope (cosmetic, tracked separately if wanted).
- **Scope = news-agent only.** The `unsloth-boxes/BACKENDS.md` serving block for
  E4B is a separate chore in that repo (not part of this plan's diff).
- **Eval = smoke + manual comparison.** There is no automated model-vs-model
  harness in the repo (`eval_harness.py` compares base-vs-tuned finetunes). We
  add a small Node script that sends a fixed prompt set to the local endpoint
  and prints tool-call success + latency, plus a documented manual recipe.
- **Context size:** default recipe uses 8192 (fits 3060 Ti at ~7 GB); 32768
  recipe documented for 5070 Ti.

## Non-goals

- No multimodal/vision support (Bolt E4B is text; Super VL multimodality is a
  separate, larger effort).
- No automatic model download / lifecycle management (llama-server stays
  user-operated, consistent with existing design).
- No change to `CATALOG` (OpenRouter models).

## Verified (experiment 2026-10-25)

- Model file: `Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf` (6.16 GB).
- Serves on 5070 Ti with build 747: `-c 8192 -ngl 99`, loads in ~31s, 8.2 GB VRAM.
- Simple chat + tool-calling both work (get_weather invoked with city=Berlin).
- Swift :1919 (current slot) was down during the experiment; A/B latency not
  measured this run.