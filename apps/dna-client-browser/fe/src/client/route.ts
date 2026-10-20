// Hash routes: #/ is the main view; #/dashboard is the dashboard. #/executions[/run|tool|sweep/<id>] is the
// executions view.
import { ref } from "vue";

export type Route =
  | { view: "main" }
  | { view: "dashboard" }
  | { view: "executions"; kind?: "run" | "tool" | "sweep" | "usage" | "logs"; id?: number };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "dashboard") return { view: "dashboard" };
  if (parts[0] !== "executions") return { view: "main" };
  const kind = parts[1] as "run" | "tool" | "sweep" | "usage" | "logs" | undefined;
  return { view: "executions", kind, id: parts[2] ? Number(parts[2]) : undefined };
}

export const route = ref<Route>(parse(location.hash));
addEventListener("hashchange", () => (route.value = parse(location.hash)));

export function go(path: string) {
  location.hash = path;
}
