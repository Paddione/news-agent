#!/usr/bin/env node
// Fixed prompt-set smoke/compare runner for a local OpenAI-compatible endpoint.
// Usage: npm run eval:local-model  (or: node apps/dna-server-api/scripts/eval-local-model.mjs)
// Env: DNA_LOCAL_BASE_URL (default http://127.0.0.1:8099/v1),
//      DNA_LOCAL_MODEL (default Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf),
//      DNA_LOCAL_CONTEXT (informational only).
import process from "node:process";

const baseUrl = (process.env.DNA_LOCAL_BASE_URL || "http://127.0.0.1:8099/v1").replace(/\/+$/, "");
const model = process.env.DNA_LOCAL_MODEL || "Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf";

const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

const PROMPTS = [
  { id: "simple-1", messages: [{ role: "user", content: "Reply with exactly: HELLO" }], tools: null },
  { id: "simple-2", messages: [{ role: "user", content: "What is 7 * 8? Reply with just the number." }], tools: null },
  { id: "tool-weather-berlin", messages: [{ role: "user", content: "What is the weather in Berlin?" }], tools: [WEATHER_TOOL] },
  { id: "tool-weather-tokyo", messages: [{ role: "user", content: "Tell me the weather in Tokyo." }], tools: [WEATHER_TOOL] },
  { id: "tool-noop", messages: [{ role: "user", content: "Say hi in one word." }], tools: [WEATHER_TOOL] },
  { id: "multi", messages: [{ role: "user", content: "What's the weather in Paris and London?" }], tools: [WEATHER_TOOL] },
];

async function chat(prompt) {
  const body = {
    model,
    messages: prompt.messages,
    max_tokens: 128,
    temperature: 0,
  };
  if (prompt.tools) {
    body.tools = prompt.tools;
    body.tool_choice = "auto";
  }
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const toolName = toolCalls.length ? toolCalls[0]?.function?.name : null;
  return { latency, toolName, content: msg.content || "", raw: data };
}

async function main() {
  // Health check.
  try {
    const h = await fetch(`${baseUrl}/models`);
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
  } catch (e) {
    console.error(`endpoint unreachable at ${baseUrl}: ${e.message}`);
    process.exit(1);
  }

  let okCount = 0;
  for (const p of PROMPTS) {
    try {
      const { latency, toolName, content } = await chat(p);
      const expectsTool = p.id.startsWith("tool-") && p.id !== "tool-noop";
      const gotTool = toolName !== null;
      const ok = expectsTool ? gotTool : !gotTool || content.trim().length > 0;
      if (ok) okCount++;
      console.log(`${p.id} tool=${toolName ?? "null"} latency_ms=${latency} ok=${ok}`);
    } catch (e) {
      console.log(`${p.id} tool=null latency_ms=0 ok=false error=${e.message}`);
    }
  }
  console.log(`summary ok=${okCount}/${PROMPTS.length}`);
}

main();
