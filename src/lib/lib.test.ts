import { describe, expect, it } from "vitest";
import type { DocNode } from "../domain/types";
import { hashText, nodeText, normalizeBlocks } from "./blocks";
import { createScheduler, formatInterval, newSchedule } from "./scheduler";

const p = (text: string, blockId?: string): DocNode => ({
  type: "paragraph",
  ...(blockId ? { attrs: { blockId } } : {}),
  content: text ? [{ type: "text", text }] : [],
});

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("blocks", () => {
  it("extracts text from nested lists with one line per item", () => {
    const list: DocNode = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [p("first")] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "sec" }, { type: "text", text: "ond" }] }] },
      ],
    };
    expect(nodeText(list)).toBe("first\nsecond");
  });

  it("assigns ids to blocks that have none and keeps existing ones", () => {
    const result = normalizeBlocks({ type: "doc", content: [p("a", "keep"), p("b")] }, counter());
    expect(result.ids).toEqual(["keep", "id-1"]);
    expect(result.changed).toBe(true);
    expect(result.blocks.map((b) => b.text)).toEqual(["a", "b"]);

    const again = normalizeBlocks(result.doc, counter());
    expect(again.changed).toBe(false);
    expect(again.ids).toEqual(result.ids);
  });

  it("gives a duplicated id (copy/paste, split paragraph) a fresh one", () => {
    const result = normalizeBlocks({ type: "doc", content: [p("a", "x"), p("b", "x")] }, counter());
    expect(result.ids).toEqual(["x", "id-1"]);
  });

  it("leaves empty blocks out of the block list but still gives them ids", () => {
    const result = normalizeBlocks({ type: "doc", content: [p(""), p("text")] }, counter());
    expect(result.ids).toHaveLength(2);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ position: 0, text: "text" });
  });

  it("hashes equal text equally and different text differently", () => {
    expect(hashText("same")).toBe(hashText("same"));
    expect(hashText("same")).not.toBe(hashText("same!"));
  });
});

describe("scheduler", () => {
  const now = Date.UTC(2026, 0, 1, 9);
  const scheduler = createScheduler({ fuzz: false });

  it("starts a new question as due immediately", () => {
    const s = newSchedule(now);
    expect(s).toMatchObject({ state: 0, reps: 0, due: now, lastPractised: null });
  });

  it("previews later due times for better ratings", () => {
    const due = scheduler.preview(newSchedule(now), now);
    expect(due[1]).toBeGreaterThan(now);
    expect(due[1]).toBeLessThanOrEqual(due[2]);
    expect(due[2]).toBeLessThanOrEqual(due[3]);
    expect(due[3]).toBeLessThan(due[4]);
  });

  it("grade() agrees with preview()", () => {
    const s = newSchedule(now);
    expect(scheduler.grade(s, 3, now).due).toBe(scheduler.preview(s, now)[3]);
  });

  it("graduates a question to long-term memory and grows the interval", () => {
    let s = newSchedule(now);
    let t = now;
    for (let i = 0; i < 4 && s.state !== 2; i++) {
      s = scheduler.grade(s, 3, t);
      t = s.due;
    }
    expect(s.state).toBe(2);
    const first = s.scheduledDays;
    expect(first).toBeGreaterThanOrEqual(1);

    s = scheduler.grade(s, 3, s.due);
    expect(s.scheduledDays).toBeGreaterThan(first);
  });

  it("counts a lapse and shortens the interval when a learned question is forgotten", () => {
    let s = scheduler.grade(newSchedule(now), 4, now); // rated 4 → straight to long-term
    expect(s.state).toBe(2);
    const before = s.scheduledDays;
    s = scheduler.grade(s, 1, s.due);
    expect(s.lapses).toBe(1);
    expect(s.due - (s.lastPractised ?? 0)).toBeLessThan(before * 24 * 60 * 60 * 1000);
  });

  it("schedules shorter intervals when higher retention is requested", () => {
    const strict = createScheduler({ fuzz: false, retention: 0.95 });
    const relaxed = createScheduler({ fuzz: false, retention: 0.8 });
    const s = newSchedule(now);
    expect(strict.grade(s, 4, now).scheduledDays).toBeLessThan(relaxed.grade(s, 4, now).scheduledDays);
  });

  it("formats intervals", () => {
    const m = 60_000;
    expect(formatInterval(10_000)).toBe("<1m");
    expect(formatInterval(10 * m)).toBe("10m");
    expect(formatInterval(3 * 60 * m)).toBe("3h");
    expect(formatInterval(4 * 24 * 60 * m)).toBe("4d");
    expect(formatInterval(45 * 24 * 60 * m)).toBe("1.5mo");
    expect(formatInterval(730 * 24 * 60 * m)).toBe("2y");
  });
});
