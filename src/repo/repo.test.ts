import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/driver";
import { migrate } from "../db/migrate";
import type { Annotation, DocNode } from "../domain/types";
import { createScheduler } from "../lib/scheduler";
import { openTestDb } from "../test/nodeDb";
import { getActivity, getPracticeStats, listAttempts, recordAttempt, typicalAnswerMs } from "./attempts";
import { getImage, saveImage } from "./images";
import {
  createNote,
  deleteNote,
  getNote,
  listBlocks,
  listBlocksAwaitingSuggestions,
  listNotes,
  listRecentNotes,
  markBlockSuggested,
  saveNote,
  searchNotes,
} from "./notes";
import {
  acceptAllSuggestions,
  acceptSuggestion,
  acknowledgeSource,
  COVER_PROMPT,
  createQuestion,
  getQuestion,
  listQuestionsForNote,
  listQuestionsForTopics,
  listReadyQuestions,
  listStruggling,
  listSuggestions,
  nextReadyAt,
  setQuestionStatus,
} from "./questions";
import { DEFAULT_SETTINGS, loadSettings, saveSetting } from "./settings";
import { buildTopicTree, countByTopic, createTopic, deleteTopic, findTopic, listTopics, renameTopic, topicAndDescendantIds, topicPath } from "./topics";

const para = (text: string, blockId?: string): DocNode => ({
  type: "paragraph",
  ...(blockId ? { attrs: { blockId } } : {}),
  content: [{ type: "text", text }],
});
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const figure = (imageId: string, annotations: Annotation[], description = "", blockId = "fig"): DocNode => ({
  type: "figure",
  attrs: { blockId, imageId, width: 800, height: 600, description, annotations },
});
const cover = (id: string, text: string, x = 0.1): Annotation => ({ id, kind: "cover", x, y: 0.1, w: 0.2, h: 0.1, text });

let db: Db;
beforeEach(async () => {
  db = await openTestDb();
});

describe("migrations", () => {
  it("are idempotent", async () => {
    await migrate(db);
    await migrate(db);
    const rows = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM schema_migrations`);
    expect(rows[0].n).toBe(1);
  });
});

describe("topics", () => {
  it("nests sub-topics, keeps sibling order and gives the path to a topic", async () => {
    const react = await createTopic(db, "  React  ");
    const hooks = await createTopic(db, "Hooks", react.id);
    await createTopic(db, "Routing", react.id);
    const effect = await createTopic(db, "useEffect", hooks.id);
    await createTopic(db, "SQL");

    const tree = buildTopicTree(await listTopics(db));
    expect(tree.map((t) => t.name)).toEqual(["React", "SQL"]);
    expect(tree[0].children.map((t) => t.name)).toEqual(["Hooks", "Routing"]);
    expect(tree[0].children[0].children[0]).toMatchObject({ name: "useEffect", depth: 2 });
    expect(topicAndDescendantIds(tree[0])).toHaveLength(4);
    expect(topicPath(tree, effect.id).map((t) => t.name)).toEqual(["React", "Hooks", "useEffect"]);
    expect(topicPath(tree, "missing")).toEqual([]);
  });

  it("rejects empty names and renames", async () => {
    await expect(createTopic(db, "   ")).rejects.toThrow();
    const topic = await createTopic(db, "Old");
    await renameTopic(db, topic.id, "New");
    expect((await listTopics(db))[0].name).toBe("New");
  });

  it("deleting a topic removes its sub-topics, notes, images and questions", async () => {
    const parent = await createTopic(db, "Parent");
    const child = await createTopic(db, "Child", parent.id);
    const note = await createNote(db, child.id, "n");
    const image = await saveImage(db, { noteId: note.id, mime: "image/png", data: "AAAA", width: 2, height: 2 });
    await createQuestion(db, { topicId: child.id, noteId: note.id, prompt: "q", answer: "a" });

    await deleteTopic(db, parent.id);
    expect(await listTopics(db)).toEqual([]);
    expect(await getNote(db, note.id)).toBeNull();
    expect(await getImage(db, image.id)).toBeNull();
    expect(await db.select(`SELECT id FROM questions`)).toEqual([]);
  });

  it("rolls counts up to parent topics", async () => {
    const now = 1_000_000;
    const parent = await createTopic(db, "Parent");
    const child = await createTopic(db, "Child", parent.id);
    await createNote(db, child.id, "n");
    await createQuestion(db, { topicId: parent.id, prompt: "q1", answer: "a" }, now);
    await createQuestion(db, { topicId: child.id, prompt: "q2", answer: "a" }, now);
    await createQuestion(db, { topicId: child.id, prompt: "q3", answer: "a" }, now + 5000);
    const paused = await createQuestion(db, { topicId: child.id, prompt: "q4", answer: "a" }, now);
    await setQuestionStatus(db, paused.id, "paused");
    await createQuestion(db, { topicId: child.id, prompt: "q5", answer: "a", status: "suggested", origin: "ai" }, now);

    const tree = buildTopicTree(await listTopics(db), await countByTopic(db, now));
    expect(tree[0].counts).toEqual({ notes: 1, total: 4, ready: 2, fresh: 3, strong: 0, suggested: 1 });
    expect(findTopic(tree, child.id)?.counts).toMatchObject({ notes: 1, total: 3, ready: 1, suggested: 1 });
  });
});

describe("notes and source blocks", () => {
  it("saves content, text and blocks, and lists notes newest first", async () => {
    const topic = await createTopic(db, "Topic");
    const note = await createNote(db, topic.id);
    const saved = await saveNote(db, note.id, { title: "Closures", doc: doc(para("A closure captures scope."), para("Second.")) });

    const loaded = await getNote(db, note.id);
    expect(loaded?.title).toBe("Closures");
    expect(loaded?.text).toBe("A closure captures scope.\nSecond.");
    expect(loaded?.doc).toEqual(saved.doc);
    expect((await listBlocks(db, note.id)).map((b) => b.id)).toEqual(saved.ids);

    const list = await listNotes(db, topic.id);
    expect(list[0]).toMatchObject({ title: "Closures", questionCount: 0 });
    expect(list[0].preview).toContain("A closure");
  });

  it("keeps block ids stable and remembers what the AI has already seen", async () => {
    const topic = await createTopic(db, "Topic");
    const note = await createNote(db, topic.id);
    const first = await saveNote(db, note.id, { title: "t", doc: doc(para("one"), para("two")) });
    expect((await listBlocksAwaitingSuggestions(db, note.id)).map((b) => b.text)).toEqual(["one", "two"]);

    await markBlockSuggested(db, note.id, first.blocks[0]);
    const second = await saveNote(db, note.id, { title: "t", doc: first.doc });
    expect(second.changed).toBe(false);
    expect(second.ids).toEqual(first.ids);
    // the unchanged, already-seen block is not offered again; editing it brings it back
    expect((await listBlocksAwaitingSuggestions(db, note.id)).map((b) => b.text)).toEqual(["two"]);
    await saveNote(db, note.id, { title: "t", doc: doc(para("one, edited", first.ids[0]), first.doc.content![1]) });
    expect((await listBlocksAwaitingSuggestions(db, note.id)).map((b) => b.text)).toEqual(["one, edited", "two"]);
  });

  it("flags a question when its source text changes or disappears", async () => {
    const topic = await createTopic(db, "Topic");
    const note = await createNote(db, topic.id, "HTTP");
    const saved = await saveNote(db, note.id, { title: "HTTP", doc: doc(para("HTTP is stateless."), para("Other.")) });
    const block = saved.blocks[0];

    const question = await createQuestion(db, {
      topicId: topic.id,
      noteId: note.id,
      sourceBlockId: block.id,
      sourceHash: block.hash,
      prompt: "Is HTTP stateful or stateless?",
      answer: "Stateless",
    });
    expect(question).toMatchObject({ sourceStatus: "ok", sourceText: "HTTP is stateless.", noteTitle: "HTTP", kind: "text" });

    await saveNote(db, note.id, { title: "HTTP", doc: doc(para("HTTP is a stateless protocol.", block.id), saved.doc.content![1]) });
    expect((await getQuestion(db, question.id))?.sourceStatus).toBe("changed");
    await acknowledgeSource(db, question.id);
    expect((await getQuestion(db, question.id))?.sourceStatus).toBe("ok");

    await saveNote(db, note.id, { title: "HTTP", doc: doc(saved.doc.content![1]) });
    expect((await getQuestion(db, question.id))?.sourceStatus).toBe("removed");
    await acknowledgeSource(db, question.id);
    expect(await getQuestion(db, question.id)).toMatchObject({ sourceStatus: "none", sourceBlockId: null });
  });

  it("deleting a note deletes its questions and blocks", async () => {
    const topic = await createTopic(db, "Topic");
    const note = await createNote(db, topic.id);
    await saveNote(db, note.id, { title: "t", doc: doc(para("x")) });
    await createQuestion(db, { topicId: topic.id, noteId: note.id, prompt: "q", answer: "a" });
    await deleteNote(db, note.id);
    expect(await listQuestionsForNote(db, note.id)).toEqual([]);
    expect(await listBlocks(db, note.id)).toEqual([]);
  });
});

describe("images and covers", () => {
  it("stores an image and reads it back", async () => {
    const topic = await createTopic(db, "Topic");
    const note = await createNote(db, topic.id);
    const image = await saveImage(db, { noteId: note.id, mime: "image/png", data: "iVBORw0KGgo=", width: 640.4, height: 480 });
    expect(await getImage(db, image.id)).toEqual({ id: image.id, mime: "image/png", data: "iVBORw0KGgo=", width: 640, height: 480 });
  });

  it("turns each cover with an answer into a question and keeps it in step with the image", async () => {
    const topic = await createTopic(db, "Anatomy");
    const note = await createNote(db, topic.id);
    const save = (annotations: Annotation[]) =>
      saveNote(db, note.id, { title: "Heart", doc: doc(figure("img1", annotations, "Diagram of the heart")) });

    await save([cover("c1", "Left ventricle"), cover("c2", "  "), { ...cover("t1", "a label"), kind: "text" }]);
    let questions = await listQuestionsForNote(db, note.id);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      prompt: COVER_PROMPT,
      answer: "Left ventricle",
      origin: "cover",
      status: "active",
      kind: "image",
      topicId: topic.id,
      sourceStatus: "ok",
    });
    expect(questions[0].media).toMatchObject({ imageId: "img1", coverId: "c1", width: 800 });
    const original = questions[0];

    // practise it, then rename the cover and add a second one: progress is kept
    const practised = await recordAttempt(db, original, 3, { scheduler: createScheduler({ fuzz: false }) });
    await save([cover("c1", "Left ventricle (LV)"), cover("c2", "Aorta", 0.5)]);
    questions = await listQuestionsForNote(db, note.id);
    expect(questions.map((q) => q.answer).sort()).toEqual(["Aorta", "Left ventricle (LV)"]);
    const kept = questions.find((q) => q.id === original.id);
    expect(kept).toMatchObject({ reps: 1, due: practised.due, sourceStatus: "ok" });
    expect(kept?.media?.annotations).toHaveLength(2);

    // removing a cover removes its question; saving again changes nothing
    await save([cover("c2", "Aorta", 0.5)]);
    await save([cover("c2", "Aorta", 0.5)]);
    questions = await listQuestionsForNote(db, note.id);
    expect(questions.map((q) => q.answer)).toEqual(["Aorta"]);
  });
});

describe("questions and attempts", () => {
  const scheduler = createScheduler({ fuzz: false });
  const now = Date.UTC(2026, 0, 1, 9);

  it("rejects questions without a question or an answer", async () => {
    const topic = await createTopic(db, "Topic");
    await expect(createQuestion(db, { topicId: topic.id, prompt: " ", answer: "a" })).rejects.toThrow();
  });

  it("only offers active, ready questions from the chosen topics", async () => {
    const a = await createTopic(db, "A");
    const b = await createTopic(db, "B");
    const inA = await createQuestion(db, { topicId: a.id, prompt: "a1", answer: "x" }, now);
    await createQuestion(db, { topicId: b.id, prompt: "b1", answer: "x" }, now);
    await createQuestion(db, { topicId: a.id, prompt: "a2", answer: "x", status: "suggested", origin: "ai" }, now);
    await createQuestion(db, { topicId: a.id, prompt: "a3", answer: "x" }, now + 60_000);

    expect((await listReadyQuestions(db, { now })).map((q) => q.prompt).sort()).toEqual(["a1", "b1"]);
    expect((await listReadyQuestions(db, { now, topicIds: [a.id] })).map((q) => q.id)).toEqual([inA.id]);
    expect(await listReadyQuestions(db, { now, topicIds: [] })).toEqual([]);
    expect(await nextReadyAt(db, now)).toBe(now + 60_000);
    expect((await listQuestionsForTopics(db, [a.id])).map((q) => q.prompt).sort()).toEqual(["a1", "a3"]);
  });

  it("keeps or drops AI suggestions", async () => {
    const topic = await createTopic(db, "Topic");
    const note = await createNote(db, topic.id, "N");
    const make = (prompt: string) =>
      createQuestion(db, { topicId: topic.id, noteId: note.id, prompt, answer: "x", status: "suggested", origin: "ai" }, now - 1000);
    const first = await make("s1");
    await make("s2");
    await make("s3");
    expect((await listSuggestions(db)).map((q) => q.prompt)).toEqual(["s1", "s2", "s3"]);
    expect(await listReadyQuestions(db, { now })).toEqual([]);

    await acceptSuggestion(db, first.id, now);
    expect(await getQuestion(db, first.id)).toMatchObject({ status: "active", due: now });
    expect(await acceptAllSuggestions(db, note.id, now)).toBe(2);
    expect(await listSuggestions(db)).toEqual([]);
    expect(await listReadyQuestions(db, { now })).toHaveLength(3);
  });

  it("reschedules the question and logs the attempt", async () => {
    const topic = await createTopic(db, "Topic");
    const question = await createQuestion(db, { topicId: topic.id, prompt: "q", answer: "a" }, now);

    const after = await recordAttempt(db, question, 3, {
      scheduler,
      now,
      answerText: "  my answer ",
      durationMs: 4200.6,
      place: "sticky",
      aiScore: 0.8,
      aiFeedback: "Close.",
    });
    expect(after.reps).toBe(1);
    expect(after.due).toBeGreaterThan(now);
    expect(await getQuestion(db, question.id)).toMatchObject({ due: after.due, state: after.state, reps: 1, lastPractised: now });
    expect(await listReadyQuestions(db, { now })).toEqual([]);

    const history = await listAttempts(db, question.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      rating: 3,
      answerText: "my answer",
      durationMs: 4201,
      place: "sticky",
      aiScore: 0.8,
      aiFeedback: "Close.",
      stateBefore: 0,
      dueAfter: after.due,
    });
  });

  it("reports today's count, the remembered share, and questions you keep forgetting", async () => {
    const topic = await createTopic(db, "Topic");
    expect(await getPracticeStats(db, now)).toEqual({ practisedToday: 0, remembered30d: null, rememberedSample: 0 });

    let good = await createQuestion(db, { topicId: topic.id, prompt: "q1", answer: "a" }, now);
    let bad = await createQuestion(db, { topicId: topic.id, prompt: "q2", answer: "a" }, now);
    good = await recordAttempt(db, good, 4, { scheduler, now }); // straight to long-term
    bad = await recordAttempt(db, bad, 4, { scheduler, now });
    await recordAttempt(db, good, 3, { scheduler, now: now + 1000 });
    bad = await recordAttempt(db, bad, 1, { scheduler, now: now + 2000 }); // forgotten once

    const stats = await getPracticeStats(db, now + 3000);
    expect(stats).toEqual({ practisedToday: 4, remembered30d: 0.5, rememberedSample: 2 });
    expect(await listStruggling(db)).toEqual([]);

    // learn it again, forget it again → it shows up as a question you struggle with
    let t = now + 3000;
    while (bad.state !== 2) {
      bad = await recordAttempt(db, bad, 3, { scheduler, now: t });
      t = bad.due;
    }
    await recordAttempt(db, bad, 1, { scheduler, now: t });
    expect((await listStruggling(db)).map((q) => q.prompt)).toEqual(["q2"]);
  });

  it("counts attempts per day and the current streak", async () => {
    const topic = await createTopic(db, "Topic");
    const question = await createQuestion(db, { topicId: topic.id, prompt: "q", answer: "a" });
    const noon = new Date(2026, 5, 15, 12).getTime();
    const day = 24 * 60 * 60 * 1000;
    const at = async (when: number) => {
      await db.execute(
        `INSERT INTO attempts (id, question_id, attempted_at, rating, state_before, stability_before, difficulty_before, scheduled_days, due_after)
         VALUES ($1, $2, $3, 3, 0, 0, 0, 0, 0)`,
        [`a${when}`, question.id, when],
      );
    };
    // yesterday ×2, two days ago, (gap), five days ago
    await at(noon - day);
    await at(noon - day + 1000);
    await at(noon - 2 * day);
    await at(noon - 5 * day);

    let activity = await getActivity(db, 7, noon);
    expect(activity.days.map((d) => d.count)).toEqual([0, 1, 0, 0, 1, 2, 0]);
    expect(activity.streak).toBe(2); // still alive: today is not over

    await at(noon);
    activity = await getActivity(db, 7, noon);
    expect(activity.days.at(-1)?.count).toBe(1);
    expect(activity.streak).toBe(3);
    expect((await getActivity(db, 7, noon + 3 * day)).streak).toBe(0);
  });
});

describe("settings", () => {
  it("returns defaults, then stored values, and ignores bad ones", async () => {
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
    await saveSetting(db, "retention", 0.85);
    await saveSetting(db, "aiMode", "off");
    await saveSetting(db, "aiMode", "device");
    await saveSetting(db, "stickyEveryMinutes", 30);
    await saveSetting(db, "autoAccept", true);
    expect(await loadSettings(db)).toMatchObject({ retention: 0.85, aiMode: "device", stickyEveryMinutes: 30, autoAccept: true });

    await saveSetting(db, "retention", 5);
    await db.execute(`UPDATE settings SET value = '"sometimes"' WHERE key = 'autoAccept'`);
    await db.execute(`INSERT INTO settings (key, value) VALUES ('aiMode', '"telepathy"') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    expect(await loadSettings(db)).toMatchObject({ retention: 0.97, autoAccept: false, aiMode: "auto" });
  });
});

describe("finding notes", () => {
  it("lists the most recently edited notes first, up to the limit", async () => {
    const topic = await createTopic(db, "Biology");
    const older = await createNote(db, topic.id, "Older");
    const newer = await createNote(db, topic.id, "Newer");
    const third = await createNote(db, topic.id, "Third");
    await db.execute(`UPDATE notes SET updated_at = $1 WHERE id = $2`, [1000, older.id]);
    await db.execute(`UPDATE notes SET updated_at = $1 WHERE id = $2`, [3000, newer.id]);
    await db.execute(`UPDATE notes SET updated_at = $1 WHERE id = $2`, [2000, third.id]);
    const recent = await listRecentNotes(db, 2);
    expect(recent.map((n) => n.title)).toEqual(["Newer", "Third"]);
    expect(recent[0].topicId).toBe(topic.id);
  });

  it("finds notes by title or text, ignoring case", async () => {
    const topic = await createTopic(db, "Biology");
    const cells = await createNote(db, topic.id, "Mitochondria");
    await saveNote(db, cells.id, { title: "Mitochondria", doc: doc(para("They make ATP for the cell.")) });
    await createNote(db, topic.id, "Ribosomes");
    expect((await searchNotes(db, "mito")).map((n) => n.title)).toEqual(["Mitochondria"]);
    expect((await searchNotes(db, "atp")).map((n) => n.title)).toEqual(["Mitochondria"]);
    expect(await searchNotes(db, "   ")).toEqual([]);
  });

  it("treats % and _ in a search as plain characters", async () => {
    const topic = await createTopic(db, "Maths");
    await createNote(db, topic.id, "Growth of 50% per year");
    await createNote(db, topic.id, "Plain note");
    expect((await searchNotes(db, "50%")).map((n) => n.title)).toEqual(["Growth of 50% per year"]);
    expect(await searchNotes(db, "%")).toHaveLength(1);
    expect(await searchNotes(db, "_")).toHaveLength(0);
  });
});

describe("typicalAnswerMs", () => {
  it("is null before anything was answered", async () => {
    expect(await typicalAnswerMs(db)).toBeNull();
  });

  it("is the median time of recent answers, so one long pause does not skew it", async () => {
    const topic = await createTopic(db, "Spanish");
    let question = await createQuestion(db, { topicId: topic.id, prompt: "ir, yo", answer: "fui" });
    const scheduler = createScheduler({ fuzz: false });
    for (const [i, durationMs] of [10_000, 20_000, 900_000].entries()) {
      question = await recordAttempt(db, question, 3, { scheduler, now: 1_000_000 + i, durationMs });
    }
    expect(await typicalAnswerMs(db)).toBe(20_000);
  });
});
