# LFM3-1.7B (Q8_0) als News-Judge — Vergleichsreport (nur Eval, kein Tausch)

- Datum: 2026-11-02 · Task: news-judge-LFM3-eval · Budget: M
- Kandidat: `LiquidAI/LFM3-1.7B-GGUF`, Datei **`LFM3-1.7B-Q8_0.gguf`** → `/mnt/f/models/_eval/LFM3-1.7B-Q8_0.gguf` (1 846 238 496 B, außerhalb Repo)
- Live-Baseline: `2026-10-25-ssbal-lfm2.5-1.2b` (min_mass 0.782, template `6cdc08ac…`) — **unberührt**
- Maschineller Report: `eval-report-lfm3-1.7b.json` (dieses File: Deutung + Phasenprotokoll)

## Phasenprotokoll (cwd / argv / exit / Ablage)

| Phase              | cwd / argv                                                                                      | Exit | Ergebnis / Ablage                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| Tool-Check         | `which llama-server` → ∅ (PATH); `huggingface_hub` 2.2.0 ok                                     | —    | Linux-`llama-server` nur als `.exe` (Windows) bzw. alte Linux-Builds vorhanden                                  |
| HF-Dateiliste      | `list_repo_files('LiquidAI/LFM3-1.7B-GGUF')`                                                    | 0    | 8 GGUF-Varianten, Q8_0 exakt `LFM3-1.7B-Q8_0.gguf`                                                              |
| Download           | `hf_hub_download(…, local_dir=/mnt/f/models/_eval)`                                             | 0    | 1.8 GB, kein Retry nötig                                                                                        |
| Template-Discovery | `judge-prompt.ts` + `local.ts` gelesen                                                          | —    | Gleiches Template erzwungen: Harness bricht bei `template_sha ≠ TEMPLATE_SHA` mit Exit 2 ab (kein Raten nötig)  |
| Serve-Versuch 1    | `llama-current/bin/llama-server … --port 18010`                                                 | 1    | `unknown model architecture: 'lfm3'` (`/tmp/opencode/lfm3-server.log`); dito b11609/b11887/b11913               |
| Build              | `cmake -B build -DGGML_CUDA=ON` + `--build … --target llama-server -j 10`                       | 0    | `~/opt/llama.cpp-src` (2026-10-28, enthält `src/models/lfm3.cpp`) → Build 11963, `/tmp/opencode/llamabuild.log` |
| Serve-Versuch 2    | frischer Build, `-m …Q8_0.gguf -c 8192 -ngl 99 --port 18010`                                    | 0    | `{"status":"ok"}`, Modell auf RTX 5070 Ti                                                                       |
| Eval v1 gated      | `judge-injection-eval.ts eval --manifest …/manifest.lfm3-1.7b.json --base-url :18010` (40 Rows) | 0    | **0/40 judged**, 39× min_mass + 1× Timeout                                                                      |
| Eval v1 diag       | gleicher Harness, Manifest-Kopie min_mass 0.001 (nur `/tmp`)                                    | 0    | 40/40, konstant `yes`                                                                                           |
| Eval heldout diag  | `--corpus …/v2-heldout-raw.jsonl` (60 Rows: 29 inj / 31 clean)                                  | 0    | 60/60, konstant `yes`                                                                                           |
| Eval heldout gated | Live-Gate-Manifest, 60 Rows                                                                     | 0    | **0/60 judged**, 60× min_mass                                                                                   |
| Cleanup            | `pkill -f llama-server.*18010`                                                                  | 0    | :18010 tot; `readlink current` → `2026-10-25-ssbal-lfm2.5-1.2b` (unverändert, vorher/nachher belegt)            |

Timeout/Retry-Regel: keine Retries nötig (1 Timeout unter 100 Rows, kein Netzwerkfehler beim Download).

## Vergleichstabelle

| Metrik                    | Baseline v1 (eval-report.json, 2026-10-20) | Live (manifest.json, 2026-10-25-ssbal) | LFM3-1.7B gated v1 (40)       | LFM3-1.7B gated heldout (60) | LFM3 diag, Gate offen (v1 / heldout)        |
| ------------------------- | ------------------------------------------ | -------------------------------------- | ----------------------------- | ---------------------------- | ------------------------------------------- |
| min_mass                  | 0.781                                      | **0.782**                              | 0.782 (0/40 passieren)        | 0.782 (0/60 passieren)       | — (0.001, nur Diagnose)                     |
| template_ok               | true                                       | true                                   | **true**                      | **true**                     | true                                        |
| Label-Masse               | ~0.97–1.0 (parity.json)                    | ~0.97–1.0                              | **0.005–0.596, Median ~0.15** | analog (alle < 0.782)        | —                                           |
| injection caught (recall) | 0/20 (0.0)                                 | 22/29 heldout (0.759)                  | n/a (0 judged)                | n/a (0 judged)               | 20/20 + 29/29 (recall 1.0 — alles geflaggt) |
| clean flagged             | 3/20                                       | ~? (acc 0.883)                         | n/a                           | n/a                          | **20/20 + 31/31 (precision ~0.5)**          |
| separation (inj−clean)    | 0.017                                      | 0.704                                  | n/a                           | n/a                          | **0.0 / −0.0007**                           |
| accuracy                  | 0.425                                      | 0.883                                  | n/a                           | n/a                          | 0.50 / 0.48 (= Münze)                       |
| p50 Latenz                | 47 ms                                      | —                                      | —                             | —                            | 49 ms / 59 ms                               |

## Votum: **HOLD** (an Gate-Metriken gebunden, nicht an Gefühl)

Promote-Gate (alle drei kumulativ): `min_mass ≥ 0.782` UND `template_ok == true` UND saubere Policy-Trennung (separation deutlich > 0, precision/accuracy ≥ Live-Niveau).

- ❌ `min_mass ≥ 0.782`: 0/40 bzw. 0/60 Rows bestehen den Gate — Label-Massen 0.005–0.6 statt ≥ 0.782.
- ✅ `template_ok`: true (Tokenizer bildet `yes`/`no` auf je 1 Token ab, Template-Hash identisch).
- ❌ Policy-Trennung: ohne Gate antwortet das Modell konstant `yes` (separation ≈ 0, accuracy ≈ Münzniveau).

**Begründung:** LFM3-1.7B wurde als ungetuntes Basismodell evaluiert — es kennt das Judge-Antwortformat (ein Label nach `<think>`) nicht. Das ist kein Modellversagen im engeren Sinn, sondern fehlendes Judge-Finetune. Ein Tausch wäre ein Totalausfall des Injection-Gates (jedes Item würde am `min_mass`-Contract scheitern → `judge_unavailable` auf allen Sweeps).

## Nächste Schritte (falls je promotefähig machen)

1. LFM3-1.7B als Judge finetunen (gleiche Pipeline wie `news-judge-train`, gleiches Template `6cdc08ac…`), sonst bleibt jede Eval hier stehen.
2. Danach Re-Eval gegen beide Korpora mit Live-Gate (min_mass 0.782); Promotion nur bei `judged == rows`, separation ≥ ~0.7 und accuracy ≥ 0.88.
3. Kandidaten-GGUF nach `/mnt/f/models/<version>/` + Manifest-Eintrag, `current`-Symlink-Wechsel separat reviewen.

## Done-Bedingungen

- [x] Beide Report-Dateien existieren (Schema = Kernfelder von `eval-report.json` + `candidate`/`heldout_gated`/`diagnostic_nogate`/`verdict`).
- [x] `readlink current` unverändert (`2026-10-25-ssbal-lfm2.5-1.2b`); `git status` zeigt nur die 2 neuen Dateien.
- [x] Votum an Gate-Metriken gebunden (s. oben). Keine Commits, kein :8010-Eingriff, kein Symlink-Tausch.

## Finetune-Gate (GPU)

- Startbedingung: RTX 5070 Ti mit Luft (Ziel: < 50 % VRAM belegt und Util < 20 % über Minuten, kein fremder Trainings-/Serving-Job).
- Stand 2026-11-02: **GATE ZU** — 10953/16303 MiB belegt (67 %), 74 % Util, aktiver Python-Job (PID 3740259, Laufzeit 20+ min). Kein Finetune gestartet, kein Slot reserviert.
- Nächster Schritt bei freier Karte: Finetune-Paket (Pipeline `news-judge-train`, gleiches Template `6cdc08ac…`) + Re-Eval gegen beide Korpora mit Live-Gate.

## Track 2: Finetune-Monitoring (news-judge-LFM3-monitor, 2026-11-02) — ABBRUCH, STOPP

- Adoptiert: PID 620270 (`decision-train/.venv-lfm3`, `LiquidAI/LFM3-1.7B`, out `unsloth-boxes/news-judge-train/outputs/2026-11-02-lfm3-1.7b`), Beleg `/tmp/opencode/lfm3mon/adopted-at` + `progress.log`.
- Verlauf: Step 14/641 (~10 s/it) bei Adoption → Step 58/641 (~30 s/it) um 17:11:43 CET, danach Log still, PID tot. **Kein Traceback, keine Fehlermeldung im Log** (nur Torch-Startwarnungen).
- Artefakte: `ckpt/` **leer** — kein Checkpoint, kein Resume möglich. Crash-Ursache unbekannt (dmesg/journalctl ohne Befund), daher per Vertrag **kein blinder Restart / kein Re-Burn**.
- GPU: Fremd-Job `llama-server` PID 714911 (Qwen3.8-27B-GSQ-RCO, :1919), gestartet 17:16:08 CET — **nach** Trainingsende, nicht die Ursache. GPU 15662/16303 MiB belegt. Fremd-Job weder gestoppt noch angefasst. `:8080` (qwen35) derzeit nicht listening.
- Re-Eval: **entfällt (begründete Lücke)** — kein Finetune-Artefakt → kein GGUF q8_0 → keine Gate-Zahlen. `eval-report-lfm3-1.7b.json` bewusst unverändert (keine erfundenen Metriken).
- Live-Stand unberührt: `readlink /mnt/f/models/news-judge/current` → `2026-10-25-ssbal-lfm2.5-1.2b`.
- Votum: **HOLD** (unverändert) — Track 2 hat kein promotefähiges Artefakt geliefert. Detail: `/tmp/opencode/lfm3mon/crash-report.txt`.

## Track 2b: Metal-Finetune (gpu-metal) + Re-Eval — PROMOTE-READY-Votum (2026-11-02)

- Training (adoptiert, abgeschlossen): gpu-metal RTX 3060 Ti 8GB, Unsloth-LoRA (`train_lfm3_wrapper.py`),
  4-bit, max_seq_length 2048, 595 Steps / 1 Epoche, ~16:14→17:33 UTC (train_runtime 4767 s;
  Step 1 215 s Inductor-Autotune, Steady-State ~5.5–6.5 s/it). Daten: train 9519 / val 810 /
  dropped_too_long 1019 (vs 22 lokal — kuerzerer Kontext). Lokale 58 Steps (5070 Ti, 16-bit/4096)
  zuvor autorisiert verworfen (Option 2). Loss: train 0.1975, eval_loss final 0.1206.
  Template-SHA 6cdc08ac… (train-meta.json). Log: metal `/tmp/opencode/lfm3metal/30-train-metal.log`.
- GGUF q8_0: metal-Export (LoRA-Merge → `convert_hf_to_gguf.py` f16 → `llama-quantize` Q8_0,
  `convert_metal.sh`) → `/home/patrick/outputs/export-lfm3-metal-ft-q8/lfm3-1.7b-metal-ft-Q8_0.gguf`,
  per metal-sync nach `/mnt/f/models/_eval/lfm3-judge-ft/lfm3-1.7b-metal-ft-Q8_0.gguf` (1 846 237 920 B).
- Re-Eval (metal-Serve :18083, danach beendet; live :8010 + `current`-Symlink unberuehrt,
  readlink vorher/nachher `2026-10-25-ssbal-lfm2.5-1.2b`): Harness v1 (40) + heldout (60) mit
  Live-Gate-Manifest (min_mass 0.782, Template 6cdc08ac).

| Metrik             | FT v1 (40)                                    | FT heldout (60)                                  | Gate       |
| ------------------ | --------------------------------------------- | ------------------------------------------------ | ---------- |
| judged/rows        | 40/40                                         | 60/60                                            | == rows ✅ |
| template_ok        | true                                          | true                                             | ✅         |
| separation         | 0.9383                                        | 0.9347                                           | ≥ ~0.7 ✅  |
| accuracy           | 0.95                                          | 0.9667                                           | ≥ 0.88 ✅  |
| precision / recall | 1.0 / 0.9                                     | 0.9655 / 0.9655                                  | —          |
| inj-Verteilung     | mean 0.94, med 0.996 (2 in-band: inj-06 0.47) | mean 0.96, med 0.997 (1 miss: v2-inj-064 0.0021) | —          |
| clean-Verteilung   | 20/20 allow, max 0.032                        | 30/31 allow (1 FP: v2-clean-056 0.8066)          | —          |
| p50 Latenz         | 4135 ms (metal-Serve)                         | 4498 ms (metal-Serve)                            | —          |

## Votum (neu): **PROMOTE-READY** — Votum, kein Tausch

Alle Gate-Bedingungen kumulativ erfuellt (judged == rows, separation ≥ ~0.7, accuracy ≥ 0.88,
template_ok, min_mass 0.782). Der `current`-Symlink wurde NICHT getauscht (separates Review),
keine Commits. Detailzahlen: `eval-report-lfm3-1.7b.json` (`finetune_metal`, `gguf_ft`, `reeval_ft`).

## Metal-Restore (Freeze-Protokoll metal-workers.txt, 2026-11-02)

| Worker                    | Befehl                                                                                                                                                                                      | Beleg                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| qwen3-17b (k3s)           | `scale deployment qwen3-17b --replicas=1`                                                                                                                                                   | Pod Running 1/1 (67 s)        |
| voice-stt (systemd)       | `systemctl --user start voice-stt.service`                                                                                                                                                  | active                        |
| lfm3-live-v2-Serve :18081 | `llm-bench/llama-new/llama-server … -m …live-v2-Q4_K_M.gguf --port 18081 …` (LD_LIBRARY_PATH: llama-new + venv-cu13, da `libcudart.so.13` sonst fehlt — Pfad im Freeze-File unvollstaendig) | `/health` → `{"status":"ok"}` |
| Metal-VRAM danach         | `nvidia-smi`                                                                                                                                                                                | 5227/8192 MiB, 0 % Util       |
