# Local models

news-agent can run against any OpenAI-compatible endpoint instead of OpenRouter by
setting `DNA_PROVIDER=local`. The local provider is env-driven, so swapping the
served model is a matter of restarting llama-server with a different GGUF and
updating three env vars — no code change.

## Env profile

```bash
DNA_PROVIDER=local
DNA_LOCAL_BASE_URL=http://127.0.0.1:8099/v1
DNA_LOCAL_MODEL=<served alias>
DNA_LOCAL_CONTEXT=<context window>
DNA_LOCAL_API_KEY=local   # llama-server ignores the key; satisfies pi-ai auth
```

## Qwen slot (current default)

The existing slot serves `unsloth/Qwen3.5-9B-GGUF` (Q8_0) via `~/opt/llama-current`.

```bash
M9B=$(python3 -c "from huggingface_hub import hf_hub_download; print(hf_hub_download('unsloth/Qwen3.5-9B-GGUF', 'Qwen3.5-9B-Q8_0.gguf'))")
CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 ~/opt/llama-current/bin/llama-server \
  -m "$M9B" -c 32768 --port 8099 --host 127.0.0.1
```

## Nemotron 3.5 Bolt E4B (candidate)

`nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB` is an open 4B MoE model (Q4_K_M,
~6.16 GB weights) aimed at fast local agent tasks. Verified to serve on a
5070 Ti and to handle tool-calling.

Download:

```bash
python3 -c "from huggingface_hub import hf_hub_download; print(hf_hub_download('nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB', 'Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf'))"
```

Serve (8k context, ~8.2 GB VRAM, fits a 5070 Ti):

```bash
GGUF=$(python3 -c "from huggingface_hub import hf_hub_download; print(hf_hub_download('nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB', 'Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf'))")
CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 ~/opt/llama-current/bin/llama-server \
  -m "$GGUF" -c 8192 -ngl 99 -fa on --jinja --host 127.0.0.1 --port 8099
```

32k variant (5070 Ti only):

```bash
CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 ~/opt/llama-current/bin/llama-server \
  -m "$GGUF" -c 32768 -ngl 99 -fa on --jinja --host 127.0.0.1 --port 8099
```

Env profile:

```bash
DNA_PROVIDER=local
DNA_LOCAL_BASE_URL=http://127.0.0.1:8099/v1
DNA_LOCAL_MODEL=Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf
DNA_LOCAL_CONTEXT=8192
```

## Comparison workflow

1. Serve model A on port 8099, model B on port 8100.
2. Point `DNA_LOCAL_BASE_URL` at one, run `npm run eval:local-model`, capture output.
3. Repeat for the other.
4. Compare tool-call success and latency; adopt the winner by updating the env
   profile (no code change).

## Notes

- Bolt E4B is text-only. Multimodal (Nemotron 3.5 Super VL) is a separate,
  larger effort and is not covered here.
- Serving blocks are also tracked in `unsloth-boxes/BACKENDS.md` (separate
  chore in that repo).
