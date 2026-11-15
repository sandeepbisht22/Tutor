import { describe, expect, it } from "vitest";
import { estimateMinutes, rootTopicId, TAG_COLORS, tagColor, topicTagColor } from "./colors";

interface Node {
  id: string;
  children: Node[];
}

const tree: Node[] = [
  { id: "spanish", children: [{ id: "verbs", children: [{ id: "irregular", children: [] }] }] },
  { id: "biology", children: [] },
];

describe("tag colours", () => {
  it("gives the same id the same colour every time", () => {
    expect(tagColor("abc")).toBe(tagColor("abc"));
  });

  it("only ever returns one of the tag colours", () => {
    for (const id of ["a", "bb", "topic-123", "0f9e-77", ""]) expect(TAG_COLORS).toContain(tagColor(id));
  });

  it("spreads different ids over several colours", () => {
    const used = new Set(Array.from({ length: 40 }, (_, i) => tagColor(`topic-${i}`)));
    expect(used.size).toBeGreaterThanOrEqual(6);
  });

  it("finds the top-level topic of a nested one", () => {
    expect(rootTopicId(tree, "irregular")).toBe("spanish");
    expect(rootTopicId(tree, "biology")).toBe("biology");
    expect(rootTopicId(tree, "missing")).toBeNull();
  });

  it("colours a sub-topic like its top-level topic", () => {
    expect(topicTagColor(tree, "irregular")).toBe(tagColor("spanish"));
    expect(topicTagColor(tree, "missing")).toBe(tagColor("missing"));
  });
});

describe("estimateMinutes", () => {
  it("uses the typical answer time and rounds up to whole minutes", () => {
    expect(estimateMinutes(9, 20_000)).toBe(3);
    expect(estimateMinutes(1, 5_000)).toBe(1);
  });

  it("falls back to a usual pace without history, and ignores outliers", () => {
    expect(estimateMinutes(10, null)).toBe(2);
    expect(estimateMinutes(10, 10 * 60_000)).toBe(10);
  });

  it("is zero when nothing is waiting", () => {
    expect(estimateMinutes(0, 20_000)).toBe(0);
  });
});
