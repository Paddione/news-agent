// Repo-component catalog, generated from live code-graph labels.
// Source: /tmp/gen-repo-catalog.py (packages + clusters per graph
// project, API-domain slices + handled_by for Bachelorprojekt).
// Regenerate after index refresh; do not hand-edit the JSON.
import catalog from "./repo-components.generated.json" with { type: "json" };

interface Cluster {
  label: string;
  members: number;
  cohesion: number;
  top_nodes: string[];
}

interface Project {
  graph_project: string;
  packages?: { name: string; nodes: number }[];
  clusters?: Cluster[];
  error?: string;
}

/** Compact prompt fragment: repo -> component signals for target routing. */
export function repoComponentCatalog(): string {
  const lines: string[] = ["Repo components (graph-derived):"];
  const projects = (catalog as { projects: Record<string, Project> }).projects;
  for (const [repo, p] of Object.entries(projects)) {
    if (p.error) {
      lines.push(`- ${repo}: catalog unavailable (${p.error})`);
      continue;
    }
    const pkgs = (p.packages ?? []).slice(0, 6).map((x) => x.name).join(", ");
    lines.push(`- ${repo}: packages ${pkgs}`);
    for (const c of (p.clusters ?? []).slice(0, 4))
      lines.push(
        `  - cluster ${c.label} (${c.members}, cohesion ${c.cohesion}): ${c.top_nodes.join(", ")}`,
      );
  }
  const slices = (
    catalog as {
      bachelor_slices: {
        slice: string;
        routes: string;
        handled_by: string[];
      }[];
    }
  ).bachelor_slices.slice(0, 12);
  lines.push("- Bachelorprojekt API slices:");
  for (const s of slices)
    lines.push(
      `  - ${s.slice} (${s.routes} routes): ${(s.handled_by ?? []).slice(0, 3).join(", ")}`,
    );
  return lines.join("\n");
}
