// The sweep schedule: how often a cron tick starts a sweep. The crontab ticks every minute (DNA_CRON_SCHEDULE,
// "* * * * *" by default) and the API decides whether a tick is due: one sweep per interval slot, or none when the schedule
// is off. Changing the interval is one settings write, never a crontab edit.
import type { ScheduleState } from "@dna/sdk";
import type { Store } from "../db/store.ts";
// Single source: the tick parse lives in dna-server-cron and is shared here under the route's contract name.
import { tickMinutes } from "../../../dna-server-cron/src/schedule.ts";

export const SCHEDULE_PRESETS = [1, 5, 10, 15, 30, 60] as const;
/** Scheduled sweeps run this often until the reader picks another preset. */
export const DEFAULT_EVERY = 5;
/** The most cards one sweep presents until the reader picks another number. */
export const DEFAULT_CARDS = 7;
export const MAX_CARDS = 30;

interface ScheduleSetting {
  everyMinutes?: number | null;
  cardsPerSweep?: number;
}
const MINUTE = 60_000;

export { tickMinutes };

export class Schedule {
  constructor(private readonly deps: { store: Store; cronSchedule: string }) {}

  get tick(): number {
    return tickMinutes(this.deps.cronSchedule);
  }

  /** Intervals this device's tick can keep: multiples of the tick. */
  presets(): number[] {
    return SCHEDULE_PRESETS.filter((m) => m >= this.tick && m % this.tick === 0);
  }

  private setting(): ScheduleSetting {
    return this.deps.store.settings.get<ScheduleSetting>("schedule", {});
  }

  /** Minutes between sweeps, or null when scheduled sweeps are off. */
  every(): number | null {
    const saved = this.setting().everyMinutes;
    return saved !== undefined
      ? saved
      : (this.presets().find((m) => m >= DEFAULT_EVERY) ?? this.tick);
  }

  /** The most cards one sweep presents. */
  cards(): number {
    return this.setting().cardsPerSweep ?? DEFAULT_CARDS;
  }

  set(patch: ScheduleSetting): ScheduleState {
    this.deps.store.settings.set("schedule", { ...this.setting(), ...patch });
    return this.state();
  }

  /** Whether a cron tick now starts a sweep: once per interval slot. */
  due(now = Date.now()): { due: true } | { due: false; reason: string } {
    const every = this.every();
    if (every === null) return { due: false, reason: "Scheduled sweeps are off" };
    const last = this.deps.store.sweeps.lastCronAt();
    if (
      last &&
      Math.floor(Date.parse(last) / (every * MINUTE)) === Math.floor(now / (every * MINUTE))
    )
      return { due: false, reason: `Already swept this ${every} minute slot` };
    return { due: true };
  }

  /** The next tick that will start a sweep. */
  next(now = Date.now()): Date | undefined {
    const every = this.every();
    if (every === null) return undefined;
    if (this.due(now).due)
      return new Date((Math.floor(now / (this.tick * MINUTE)) + 1) * this.tick * MINUTE);
    return new Date((Math.floor(now / (every * MINUTE)) + 1) * every * MINUTE);
  }

  state(now = Date.now()): ScheduleState {
    return {
      everyMinutes: this.every(),
      cardsPerSweep: this.cards(),
      presets: this.presets(),
      tickMinutes: this.tick,
      nextSweepAt: this.next(now)?.toISOString(),
    };
  }
}
