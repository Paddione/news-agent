// apps/shared/packages/jev/src/local.ts
// JEV_BACKEND=local: a fine-tuned open model behind llama-server answers each question with one label token.
// Raw logprobs of the label tokens (no grammar, see spec) become the same distributions jev returns.
import { readFileSync } from "node:fs";
import { ContractError, type SystemOneResult } from "./client.ts";
import { labelsFor, renderPrompt, TEMPLATE_SHA } from "./judge-prompt.ts";
import {
  validateRequest,
  type Answer,
  type Question,
  type Questions,
  type State,
} from "./types.ts";

export interface JudgeManifest {
  name: string;
  version: string;
  gguf: string;
  base_model: string;
  temperature: number;
  /** Optional per-question (command) temperature override, e.g. { injection: 1 }. */
  temperatures?: Record<string, number>;
  min_mass: number;
  template_sha: string;
  commands: Record<string, number>;
}

export function loadManifest(path: string): JudgeManifest {
  return JSON.parse(readFileSync(path, "utf8")) as JudgeManifest;
}

const round = (n: number, d = 4) => Number(n.toFixed(d));

export function answerFrom(q: Question, probs: number[]): Answer {
  const confidence = round(Math.max(...probs));
  if (q.type === "noul") return { type: "noul", noul: round(probs[0]) };
  if (q.type === "score") {
    const legend = Object.fromEntries(q.criteria.map((level, i) => [String(i), level]));
    return {
      type: "score",
      score: round(
        probs.reduce((acc, p, i) => acc + p * i, 0),
        2,
      ),
      legend,
      probabilities: Object.fromEntries(probs.map((p, i) => [String(i), round(p)])),
      confidence,
    };
  }
  const options = Object.keys(q.criteria);
  const best = probs.indexOf(Math.max(...probs));
  return {
    type: "choice",
    choice: options[best],
    probabilities: Object.fromEntries(options.map((o, i) => [o, round(probs[i])])),
    confidence,
  };
}

export class LocalJev {
  private ids = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly opts: {
      baseUrl: string;
      manifest: JudgeManifest;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Check the template hash and resolve every label to its single token id. */
  async init(): Promise<void> {
    if (this.opts.manifest.template_sha !== TEMPLATE_SHA)
      throw new Error(
        `Judge ${this.opts.manifest.version} was trained on template ${this.opts.manifest.template_sha.slice(0, 12)}, runtime renders ${TEMPLATE_SHA.slice(0, 12)}. Retrain or roll back judge-prompt.ts.`,
      );
    const all = ["yes", "no", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"];
    for (const label of new Set(all)) {
      const { tokens } = (await this.post("/tokenize", { content: label })) as { tokens: number[] };
      if (tokens.length !== 1)
        throw new ContractError(
          `Label "${label}" is ${tokens.length} tokens; the judge needs one.`,
        );
      this.ids.set(label, tokens[0]);
    }
  }

  async distribution(
    prompt: string,
    labels: string[],
    signal?: AbortSignal,
    opts: { questionId?: string } = {},
  ): Promise<{ probs: number[]; mass: number }> {
    const res = (await this.post(
      "/completion",
      {
        prompt,
        n_predict: 1,
        n_probs: 50,
        post_sampling_probs: false,
        temperature: 1,
        cache_prompt: true,
      },
      signal,
    )) as { completion_probabilities: { top_logprobs: { id: number; logprob: number }[] }[] };
    const top = new Map(
      res.completion_probabilities[0].top_logprobs.map((t) => [t.id, Math.exp(t.logprob)]),
    );
    const raw = labels.map((l) => top.get(this.ids.get(l)!) ?? 0);
    const mass = raw.reduce((a, b) => a + b, 0);
    if (mass <= 0 || mass < this.opts.manifest.min_mass)
      throw new ContractError(
        `Judge put ${mass.toFixed(3)} on the labels, below min_mass ${this.opts.manifest.min_mass}.`,
      );
    const t = opts.questionId !== undefined
      ? (this.opts.manifest.temperatures?.[opts.questionId] ?? this.opts.manifest.temperature)
      : this.opts.manifest.temperature;
    const scaled = raw.map((p) => (p > 0 ? Math.pow(p / mass, 1 / t) : 0));
    const z = scaled.reduce((a, b) => a + b, 0);
    return { probs: scaled.map((p) => p / z), mass };
  }

  async systemOne(
    state: State,
    questions: Questions,
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<SystemOneResult> {
    const request = { model: this.opts.manifest.version, state, questions };
    validateRequest(request);
    const started = performance.now();
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(questions)) {
      const { probs } = await this.distribution(renderPrompt(state, q), labelsFor(q), opts.signal, {
        questionId: id,
      });
      answers[id] = answerFrom(q, probs);
    }
    const response = {
      model: `local/${this.opts.manifest.version}`,
      answers,
      usage: { input_tokens: 0, output_tokens: 0, cost: 0 },
    };
    const requestText = JSON.stringify(request);
    return {
      ...response,
      raw: { request, requestText, response, responseText: JSON.stringify(response) },
      meta: {
        provider: "local",
        requestedModel: opts.model ?? this.opts.manifest.version,
        resolvedModel: response.model,
        elapsedMs: Math.round(performance.now() - started),
        attempts: 1,
        cost: { amount: 0, source: "reported" },
      },
    };
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`local judge HTTP ${res.status} on ${path}`);
    return res.json();
  }
}
