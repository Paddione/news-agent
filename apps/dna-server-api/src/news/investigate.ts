import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  configure,
  defineTask,
  type AgentChange,
  type ConversationId,
  type Task,
} from "@earendil-works/pi-durable";
import { answerTextOf, loadPrompt } from "@dna/durable-agent";
import type { Deps } from "../deps.ts";
import type { App } from "../runtime.ts";
import { localProbe } from "../agents/model-route.ts";
import {
  parseReport,
  renderReport,
  repairPrompt,
  targetLabels,
  type InvestigationReport,
} from "./investigation-report.ts";

export const INVESTIGATE_MAX_ATTEMPTS = 3;
export const CATCHUP_MINUTES = 10;

export interface InvestigateInput {
  repo: string;
  number: number;
  cardId?: number;
}

export function titleTerms(title: string): string[] {
  const words = title
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  return words.slice(0, Math.min(Math.max(words.length, 3), 5));
}

export function createInvestigateTask(
  deps: Deps,
  investigatorChild: () => AgentChange,
): Task<InvestigateInput, any, any, object> {
  const agentsDir = join(deps.config.promptsDir, "agents");

  return defineTask<
    InvestigateInput,
    { phase: "wait" | "refresh" | "research" | "finish" },
    { status: string; route?: string; done: boolean }
  >({
    name: "dna.investigate",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, runtime, ctx: Context) => {
        const { repo, number } = task.input;
        while (!runtime.signal.aborted) {
          const sweepActive = deps.store.sweeps.active().length > 0;
          const running = deps.store.investigations.running();
          const otherRunning =
            running && !(running.repo === repo && running.number === number);
          if (!sweepActive && !otherRunning) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (runtime.signal.aborted) return;
        await runtime.commit(
          () => ({ status: "running", checkpoint: { phase: "refresh" } }),
          ctx,
        );
      },

      refresh: async (task, runtime, ctx: Context) => {
        const { number } = task.input;
        try {
          await deps.issues.addLabels(number, ["investigating"]);
        } catch (e) {
          deps.log.warn("investigate.add_label_failed", { error: String(e) });
        }

        try {
          const projects = await deps.graph.projects();
          for (const p of projects) {
            if (deps.config.investigateRepos.includes(p.name)) {
              try {
                await deps.graph.refresh(p.root);
              } catch (err) {
                deps.log.warn("investigate.refresh_failed", {
                  project: p.name,
                  error: String(err),
                });
              }
            }
          }
        } catch (err) {
          deps.log.warn("investigate.projects_failed", { error: String(err) });
        }

        await runtime.commit(
          () => ({ status: "running", checkpoint: { phase: "research" } }),
          ctx,
        );
      },

      research: async (task, runtime, ctx: Context) => {
        const { repo, number, cardId } = task.input;

        const probe = deps.investigateProbe ?? localProbe(deps.config.localBaseUrl);
        const localUp = await probe();
        const today = new Date().toISOString().slice(0, 10);
        const fallbacksCount = deps.store.investigations.fallbacksToday(today);
        const fallbackUnderCap = fallbacksCount < deps.config.investigateFallbackDaily;

        let route: "local" | "fallback" | undefined;
        let modelName = "";

        if (localUp) {
          route = "local";
          modelName =
            deps.catalog.provider === "faux" ? "faux-local" : deps.config.researchModel;
        } else if (deps.config.investigateFallbackModel && fallbackUnderCap) {
          route = "fallback";
          modelName = deps.config.investigateFallbackModel;
        }

        if (!route) {
          try {
            await deps.issues.removeLabel(number, "investigating");
          } catch {}
          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: {
                status: "completed",
                result: { status: "queued", done: false },
              },
            }),
            ctx,
          );
          return;
        }

        deps.store.investigations.start(repo, number, route, modelName);

        try {
          const issue = await deps.issues.view(number);
          let report: InvestigationReport;

          if (route === "local") {
            let childId: ConversationId | undefined;
            await runtime.commit(async (tx) => {
              const existingConv = (
                await tx.scanConversations({ ownerTaskId: runtime.taskId }, 2)
              ).items[0];
              if (existingConv) {
                childId = existingConv.id;
              } else {
                const created = await tx.createConversation({
                  ownership: { kind: "task", taskId: runtime.taskId as never },
                });
                await configure(tx, created.id, investigatorChild());
                childId = created.id;
              }
            }, ctx);

            const handle = await runtime.conversation(childId!, ctx);
            if (!handle) throw new Error("Could not open investigator child conversation");

            const prompt = loadPrompt(
              agentsDir,
              "investigator",
              "USER_PROMPT_investigate.md",
              {
                allowed_projects: deps.config.investigateRepos.join(", "),
                repo,
                number,
                title: issue.title,
                body: issue.body,
              },
            );

            const submission = await handle.submit(
              {
                type: "input",
                content: prompt,
                requestId: `inv:${runtime.taskId}:req`,
              },
              ctx,
            );
            const settled = await submission.wait(ctx);
            if (settled.status !== "done" || settled.type !== "input") {
              throw new Error(`Investigator subagent did not finish: ${settled.status}`);
            }

            let answer = "";
            await runtime.commit(async (tx) => {
              const entry = await tx.entry(AssistantEntry, settled.answer);
              answer = answerTextOf(entry?.model?.[0] as AssistantMessage | undefined);
            }, ctx);

            try {
              report = parseReport(answer, deps.config.investigateRepos);
            } catch (parseErr: any) {
              const repair = repairPrompt(parseErr.message);
              const repSub = await handle.submit(
                {
                  type: "input",
                  content: repair,
                  requestId: `inv:${runtime.taskId}:repair`,
                },
                ctx,
              );
              const repSettled = await repSub.wait(ctx);
              if (repSettled.status !== "done" || repSettled.type !== "input") {
                throw new Error(`Repair failed: ${repSettled.status}`);
              }
              let repairAnswer = "";
              await runtime.commit(async (tx) => {
                const entry = await tx.entry(AssistantEntry, repSettled.answer);
                repairAnswer = answerTextOf(
                  entry?.model?.[0] as AssistantMessage | undefined,
                );
              }, ctx);
              report = parseReport(repairAnswer, deps.config.investigateRepos);
            }
          } else {
            // Fallback route
            const res = await deps.http.postJson(
              "https://openrouter.ai/api/v1/chat/completions",
              {
                model: deps.config.investigateFallbackModel,
                messages: [
                  {
                    role: "system",
                    content:
                      "Act as issue investigator. Return a JSON report with summary, source, missing, proposal, targets, reasoning.",
                  },
                  {
                    role: "user",
                    content: `Title: ${issue.title}\nBody: ${issue.body}`,
                  },
                ],
                response_format: { type: "json_object" },
              },
              {
                Authorization: `Bearer ${deps.config.openrouterApiKey ?? process.env.OPENROUTER_API_KEY ?? ""}`,
              },
            );

            const body = JSON.parse(res.text || "{}");
            const content = body.choices?.[0]?.message?.content ?? res.text;
            const partial = parseReport(content, deps.config.investigateRepos);

            const terms = titleTerms(issue.title);
            const existingList: { project: string; paths: string[]; note: string }[] = [];
            for (const project of deps.config.investigateRepos) {
              const paths: string[] = [];
              for (const term of terms) {
                try {
                  const searchRes = await deps.graph.search(project, term);
                  if (
                    searchRes &&
                    !searchRes.includes("No matches") &&
                    searchRes.trim().length > 0
                  ) {
                    paths.push(
                      `Hit for "${term}": ${searchRes.slice(0, 100).replace(/\n/g, " ")}`,
                    );
                  }
                } catch {}
              }
              if (paths.length > 0) {
                existingList.push({
                  project,
                  paths: paths.slice(0, 5),
                  note: `Suchtreffer für ${terms.join(", ")}`,
                });
              }
            }
            partial.existing = existingList;
            report = partial;
          }

          // Finish phase
          const reportMd = renderReport(report, {
            route,
            model: modelName,
            date: new Date().toISOString().slice(0, 10),
            automaticRepoSearch: route === "fallback",
          });

          const existingRow = deps.store.investigations.get(repo, number);
          let commentUrl = existingRow?.commentUrl;
          if (!commentUrl) {
            commentUrl = await deps.issues.comment(number, reportMd);
          }

          try {
            await deps.issues.removeLabel(number, "investigating");
          } catch {}

          const labelsToAdd = ["investigated", ...targetLabels(report.targets)];
          await deps.issues.addLabels(number, labelsToAdd);

          deps.store.investigations.finish(repo, number, {
            reportMd,
            targets: report.targets,
            commentUrl,
          });

          if (cardId) {
            const card = deps.store.news.card(cardId);
            if (card) deps.bus.publish({ type: "feed.card_updated", card });
          }

          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: {
                status: "completed",
                result: { status: "done", route, done: true },
              },
            }),
            ctx,
          );
        } catch (error: any) {
          const updated = deps.store.investigations.fail(
            repo,
            number,
            error.message,
            INVESTIGATE_MAX_ATTEMPTS,
          );
          try {
            await deps.issues.removeLabel(number, "investigating");
          } catch {}
          if (updated.status === "failed") {
            try {
              await deps.issues.addLabels(number, ["investigation-failed"]);
            } catch {}
          }
          try {
            await deps.issues.comment(
              number,
              `Untersuchung fehlgeschlagen (Versuch ${updated.attempts}/${INVESTIGATE_MAX_ATTEMPTS}): ${error.message}`,
            );
          } catch {}
          deps.log.error("investigation.failed", {
            repo,
            number,
            attempts: updated.attempts,
            error: error.message,
          });

          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: {
                status: "completed",
                result: { status: updated.status, done: false },
              },
            }),
            ctx,
          );
        }
      },
    },

    abort: async (_task, runtime, ctx: Context) => {
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        ctx,
      );
    },
  });
}

export async function startInvestigation(
  app: App,
  repo: string,
  number: number,
  cardId?: number,
): Promise<boolean> {
  if (app.config.investigate === "off") return false;

  const { row, created } = app.store.investigations.enqueue(repo, number, cardId);
  if (!created && row.status !== "queued") return false;
  if (!app.agents.investigateTask) return false;

  const input: InvestigateInput = { repo, number };
  if (cardId !== undefined) input.cardId = cardId;

  await app.harness.harness.commit(async (tx) => {
    await tx.createTask(
      app.agents.investigateTask,
      input,
      {
        ownership: { kind: "conversation" },
        conversationId: app.main.id,
        background: true,
      },
    );
  }, app.ctx);

  return true;
}

export async function investigateCatchup(
  app: App,
  now = Date.now(),
): Promise<number> {
  if (app.config.investigate === "off") return 0;

  const lastCatchup = app.store.settings.get<number | undefined>(
    "investigateCatchupAt",
    undefined,
  );
  if (lastCatchup !== undefined && now - lastCatchup < CATCHUP_MINUTES * 60_000) {
    return 0;
  }
  app.store.settings.set("investigateCatchupAt", now);

  const list = await app.issues.list(app.config.issueLabel);
  let startedCount = 0;

  for (const item of list) {
    const hasInvestigating = item.labels.includes("investigating");
    const hasInvestigated = item.labels.includes("investigated");
    const hasFailed = item.labels.includes("investigation-failed");

    const row = app.store.investigations.get(app.issues.repo, item.number);

    if (
      row &&
      row.status === "failed" &&
      !hasFailed &&
      !hasInvestigating &&
      !hasInvestigated
    ) {
      app.store.investigations.retry(app.issues.repo, item.number);
      const started = await startInvestigation(
        app,
        app.issues.repo,
        item.number,
        row.cardId,
      );
      if (started) startedCount++;
      continue;
    }

    if (hasInvestigating || hasInvestigated || hasFailed) {
      continue;
    }

    if (
      row &&
      (row.status === "queued" || row.status === "running" || row.status === "done")
    ) {
      continue;
    }

    const started = await startInvestigation(app, app.issues.repo, item.number);
    if (started) startedCount++;
  }

  return startedCount;
}
