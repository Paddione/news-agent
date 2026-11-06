// The crontab line ticks every minute by default; the API's schedule decides which ticks start a sweep.
// Single source for the crontab-field-to-minutes parse: dna-server-api imports tickMinutes from here,
// so the tick math cannot drift between the route and the cron again.
export const DEFAULT_SCHEDULE = "* * * * *";

/** The tick in minutes for a requestId slot: 1 for every minute, N for a step of N minutes, else an hour. */
export function slotMinutes(cronSchedule: string): number {
  const minute = cronSchedule.trim().split(/\s+/)[0];
  if (minute === "*") return 1;
  const step = minute.match(/^\*\/(\d+)$/)?.[1];
  return step ? Number(step) : 60;
}

/** Alias kept so the API route can share this parse under its own contract name. */
export { slotMinutes as tickMinutes };
