// What tools, tasks and routes share. Built once in runtime.ts.
import type { ModelCatalog } from "@dna/durable-agent";
import type { Logger } from "@dna/sdk/node";
import type { AgentRoute } from "./agents/model-route.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db/store.ts";
import type { Bus } from "./events.ts";
import type { Dates } from "./news/dates.ts";
import type { Judge } from "./news/hfs.ts";
import type { Http } from "./news/http.ts";
import type { Images } from "./news/images.ts";
import type { Quick } from "./news/quick.ts";
import type { IssueTracker } from "./news/issues.ts";
import type { Schedule } from "./news/schedule.ts";
import type { SearchService } from "./news/search/index.ts";
import type { CodeGraph } from "./news/graph.ts";

export interface Deps {
  config: Config;
  log: Logger;
  store: Store;
  bus: Bus;
  judge: Judge;
  search: SearchService;
  images: Images;
  http: Http;
  catalog: ModelCatalog;
  /** The quick model for one-shot jobs. */
  quick: Quick;
  /** Publish dates from pages, with the quick model as the fallback. */
  dates: Dates;
  /** How often scheduled sweeps run. */
  schedule: Schedule;
  /** Where cards turned into issues go (gh, or faux in fixture mode). */
  issues: IssueTracker;
  /** The code graph representation for repository tools. */
  graph: CodeGraph;
  /** Optional probe for checking local investigator agent health. */
  investigateProbe?: () => Promise<boolean>;
  /** DNA_FALLBACK_*: local agent model or the hosted fallback, checked per sweep. Unset without a fallback. */
  route?: AgentRoute;
}
