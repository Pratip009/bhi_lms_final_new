/**
 * Calendar dates in the office's time zone. `new Date().toISOString()` is UTC, which in New Jersey
 * rolls over to "tomorrow" at 7–8 pm and would allow attendance for a future local date.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";

export function todayLocal(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const thisMonthLocal = (now = new Date()) => todayLocal(now).slice(0, 7);

/** YYYY-MM-DD of a stored Date, in the office time zone. */
export const localDateOf = (d: Date) => todayLocal(d);

/** "9:05 AM" in the office time zone. */
export function timeLocal(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit" }).format(d);
}

/** "9:05:12 AM" in the office time zone, to the second (check-in and fill-out times). */
export function timeLocalExact(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(d);
}
