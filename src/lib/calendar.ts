/** The activity calendar's month row (pure, so it can be tested). */

/** Columns closer than this to the previous month label stay unlabelled, so names never run together. */
export const MONTH_LABEL_GAP = 3;

/**
 * A month name above each column whose week starts a new month. A label that
 * would sit within MONTH_LABEL_GAP columns of the previous one is left out
 * (at the start of the calendar that is the first, partial month).
 */
export function monthLabels(days: number[]): string[] {
  const weeks = Math.ceil(days.length / 7);
  if (weeks === 0) return [];
  const starts = Array.from({ length: weeks }, (_, week) => {
    const month = new Date(days[week * 7]).getMonth();
    return week === 0 || new Date(days[(week - 1) * 7]).getMonth() !== month;
  });
  let last = -MONTH_LABEL_GAP;
  return starts.map((start, week) => {
    const nextStart = starts.findIndex((s, i) => i > week && s);
    const crowdedStart = week === 0 && nextStart !== -1 && nextStart < MONTH_LABEL_GAP;
    if (!start || week - last < MONTH_LABEL_GAP || crowdedStart) return "";
    last = week;
    return new Date(days[week * 7]).toLocaleDateString(undefined, { month: "short" });
  });
}
