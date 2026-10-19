// apps/dna-server-api/src/news/capture.ts
// JEV_CAPTURE: every rendered jev call as one JSON line, the raw material for the local judge's training corpus.
// Capture is best effort: a failed write is logged once per call and never fails the sweep.
import { appendFileSync } from "node:fs";
import type { Questions, State } from "@dna/jev";
import type { Logger } from "@dna/sdk/node";

export interface CaptureRecord {
  command: string;
  version: number;
  item_id: number | null;
  /** When the call was made: judge-feedback picks the call a reader saw before giving feedback. */
  at: string;
  state: State;
  questions: Questions;
}

export function jsonlCapture(path: string, log?: Logger): (rec: CaptureRecord) => void {
  return (rec) => {
    try {
      appendFileSync(path, `${JSON.stringify(rec)}\n`);
    } catch (error) {
      log?.warn("jev.capture_failed", { path, error: String(error) });
    }
  };
}
