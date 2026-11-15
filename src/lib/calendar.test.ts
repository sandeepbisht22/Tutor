import { describe, expect, it } from "vitest";
import { monthLabels } from "./calendar";

/** `weeks` consecutive Mondays starting at the given date, one entry per day. */
function days(start: string, weeks: number): number[] {
  const first = new Date(`${start}T12:00:00`);
  return Array.from({ length: weeks * 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i, 12).getTime());
}

describe("monthLabels", () => {
  it("labels the first week of each month and leaves the other weeks blank", () => {
    const labels = monthLabels(days("2026-01-05", 10)); // Mondays: Jan 5 … Mar 9
    expect(labels).toHaveLength(10);
    expect(labels[0]).not.toBe("");
    expect(labels.filter(Boolean)).toHaveLength(3);
    expect(labels[1]).toBe("");
  });

  it("drops a label that would crowd the previous one", () => {
    // Jun 29 is in June, Jul 6 starts July one column later: only July is named
    const labels = monthLabels(days("2026-06-29", 6));
    expect(labels[0]).toBe("");
    expect(labels[1]).not.toBe("");
  });

  it("returns nothing for no days", () => {
    expect(monthLabels([])).toEqual([]);
  });
});
