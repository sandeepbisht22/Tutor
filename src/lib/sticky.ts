/** When should the next sticky question appear on the desktop? */

export interface StickyPacing {
  now: number;
  /** the user wants sticky questions at all */
  enabled: boolean;
  /** "not before" time set by Pause */
  pausedUntil: number;
  everyMinutes: number;
  /** when the last sticky question was answered or closed (or a stand-in at launch) */
  lastClosedAt: number;
  /** a sticky question is on screen already */
  visible: boolean;
  /** a practice session is open in the main window */
  practising: boolean;
}

export function stickyDue(pacing: StickyPacing): boolean {
  if (!pacing.enabled || pacing.visible || pacing.practising) return false;
  if (pacing.now < pacing.pausedUntil) return false;
  return pacing.now - pacing.lastClosedAt >= pacing.everyMinutes * 60_000;
}

const FIRST_AFTER_MS = 60_000;

/** A stand-in "last closed" time at launch, so the first sticky appears a minute after start. */
export function initialLastClosed(now: number, everyMinutes: number): number {
  return now - everyMinutes * 60_000 + FIRST_AFTER_MS;
}

/** Start of tomorrow, local time (for "pause until tomorrow"). */
export function startOfTomorrow(now: number): number {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}
