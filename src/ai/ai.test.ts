import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/driver";
import type { DocNode, NoteBlock } from "../domain/types";
import type { ChatMessage, FetchLike, LlmProvider } from "../llm/types";
import { createNote, saveNote } from "../repo/notes";
import { createQuestion, listQuestionsForNote } from "../repo/questions";
import { DEFAULT_SETTINGS } from "../repo/settings";
import { createTopic } from "../repo/topics";
import { openTestDb } from "../test/nodeDb";
import { initialLastClosed, startOfTomorrow, stickyDue, type StickyPacing } from "../lib/sticky";
import { buildCheckMessages, checkAnswer, parseCheck, quickCheck, ratingForScore } from "./grade";
import { resolveProvider, warmUpBuiltIn } from "./provider";
import { NoteQueue } from "./queue";
import { buildSuggestMessages, parseSuggestions, questionBudget, suggestForNote, worthAsking } from "./suggest";

const para = (text: string, blockId?: string): DocNode => ({
  type: "paragraph",
  ...(blockId ? { attrs: { blockId } } : {}),
  content: [{ type: "text", text }],
});
const block = (text: string, type = "paragraph"): NoteBlock => ({ id: "b", position: 0, type, text, hash: "h" });

/** A stand-in model that answers from a script and records what it was asked. */
function fakeProvider(reply: (messages: ChatMessage[]) => string): LlmProvider & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    id: "fake",
    label: "Fake",
    kind: "local",
    model: "fake",
    calls,
    async complete(messages) {
      calls.push(messages);
      return reply(messages);
    },
  };
}

const LONG = "Microtasks such as promise callbacks run before the next macrotask such as a setTimeout callback.";

describe("writing suggestions", () => {
  it("decides which blocks are worth asking about, and how much", () => {
    expect(worthAsking(block("Short."))).toBe(false);
    expect(worthAsking(block(LONG))).toBe(true);
    expect(worthAsking(block(LONG, "heading"))).toBe(false);
    expect(worthAsking(block("Image", "figure"))).toBe(false);
    expect(worthAsking(block("Image: Diagram of the heart\nLabels: aorta", "figure"))).toBe(true);
    expect(questionBudget(block(LONG))).toBe(1);
    expect(questionBudget(block("x".repeat(300)))).toBe(2);
    expect(questionBudget(block("x".repeat(900)))).toBe(3);
  });

  it("gives the model the passage, its context and what was already asked", () => {
    const [system, user] = buildSuggestMessages({
      noteTitle: "Event loop",
      heading: "Ordering",
      text: LONG,
      max: 2,
      alreadyAsked: ["What is a macrotask?"],
    });
    expect(system.content).toContain("at most 2 questions");
    expect(user.content).toContain("Note: Event loop");
    expect(user.content).toContain("Section: Ordering");
    expect(user.content).toContain(LONG);
    expect(user.content).toContain("- What is a macrotask?");
  });

  it("reads messy replies and drops weak, repeated or yes/no questions", () => {
    const reply = `<think>The user wants {"questions": []} maybe.</think>
      Here you go:
      \`\`\`json
      {"questions": [
        {"question": "Which runs first, a microtask or a macrotask?", "answer": "A microtask"},
        {"question": "which runs first: a microtask or a macrotask", "answer": "Microtask"},
        {"question": "Do microtasks run first?", "answer": "Yes"},
        {"question": "Hm?", "answer": "too short a question"},
        {"q": "What is an example of a macrotask?", "a": "A setTimeout callback"},
        {"question": "What is already asked?", "answer": "This one"},
        {"question": 42}
      ]}
      \`\`\``;
    expect(parseSuggestions(reply, ["What is already asked?"], 3)).toEqual([
      { prompt: "Which runs first, a microtask or a macrotask?", answer: "A microtask" },
      { prompt: "What is an example of a macrotask?", answer: "A setTimeout callback" },
    ]);
    expect(parseSuggestions(reply, [], 1)).toHaveLength(1);
    expect(parseSuggestions("I could not think of anything.", [], 3)).toEqual([]);
    expect(parseSuggestions('[{"question":"What does a bare array hold?","answer":"Questions"}]', [], 3)).toHaveLength(1);
  });

  describe("for a note", () => {
    let db: Db;
    let topicId: string;
    let noteId: string;
    beforeEach(async () => {
      db = await openTestDb();
      topicId = (await createTopic(db, "JS")).id;
      noteId = (await createNote(db, topicId, "Event loop")).id;
    });

    const reply = (n: number) => () =>
      JSON.stringify({ questions: [{ question: `What does passage ${n} say about ordering?`, answer: "Microtasks first" }] });

    it("asks once per worthwhile block and links each suggestion to its paragraph", async () => {
      const saved = await saveNote(db, noteId, {
        title: "Event loop",
        doc: { type: "doc", content: [{ type: "heading", content: [{ type: "text", text: "Ordering" }] }, para(LONG), para("Tiny.")] },
      });
      const provider = fakeProvider(reply(1));
      expect(await suggestForNote(db, provider, noteId)).toBe(1);
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0][1].content).toContain("Section: Ordering");

      const [question] = await listQuestionsForNote(db, noteId);
      expect(question).toMatchObject({
        status: "suggested",
        origin: "ai",
        topicId,
        sourceBlockId: saved.ids[1],
        sourceStatus: "ok",
        answer: "Microtasks first",
      });

      // nothing new to look at → no request at all
      expect(await suggestForNote(db, provider, noteId)).toBe(0);
      expect(provider.calls).toHaveLength(1);
    });

    it("replaces undecided suggestions when the paragraph changes, and can add straight to practice", async () => {
      const saved = await saveNote(db, noteId, { title: "t", doc: { type: "doc", content: [para(LONG)] } });
      await suggestForNote(db, fakeProvider(reply(1)), noteId);
      await saveNote(db, noteId, { title: "t", doc: { type: "doc", content: [para(`${LONG} Edited.`, saved.ids[0])] } });

      expect(await suggestForNote(db, fakeProvider(reply(2)), noteId, { autoAccept: true })).toBe(1);
      const questions = await listQuestionsForNote(db, noteId);
      expect(questions).toHaveLength(1);
      expect(questions[0]).toMatchObject({ prompt: "What does passage 2 say about ordering?", status: "active" });
    });

    it("leaves alone a paragraph you already wrote a question for", async () => {
      const saved = await saveNote(db, noteId, { title: "t", doc: { type: "doc", content: [para(LONG)] } });
      await createQuestion(db, {
        topicId,
        noteId,
        sourceBlockId: saved.blocks[0].id,
        sourceHash: saved.blocks[0].hash,
        prompt: "My own question?",
        answer: "My own answer",
      });
      const provider = fakeProvider(reply(1));
      expect(await suggestForNote(db, provider, noteId)).toBe(0);
      expect(provider.calls).toHaveLength(0);
    });

    it("stops on a failed request and picks the block up again next time", async () => {
      await saveNote(db, noteId, { title: "t", doc: { type: "doc", content: [para(LONG)] } });
      const broken = fakeProvider(() => {
        throw new Error("model crashed");
      });
      await expect(suggestForNote(db, broken, noteId)).rejects.toThrow("model crashed");
      expect(await suggestForNote(db, fakeProvider(reply(1)), noteId)).toBe(1);
    });

    it("attaches the image when the suggestion comes from an image block", async () => {
      await saveNote(db, noteId, {
        title: "Heart",
        doc: {
          type: "doc",
          content: [
            {
              type: "figure",
              attrs: {
                imageId: "img1",
                width: 400,
                height: 300,
                description: "Cross-section of the human heart showing all four chambers",
                annotations: [{ id: "t1", kind: "text", x: 0.2, y: 0.2, w: 0, h: 0, text: "aorta" }],
              },
            },
          ],
        },
      });
      const provider = fakeProvider(reply(1));
      await suggestForNote(db, provider, noteId);
      expect(provider.calls[0][1].content).toContain("Labels: aorta");
      const [question] = await listQuestionsForNote(db, noteId);
      expect(question.kind).toBe("image");
      expect(question.media).toMatchObject({ imageId: "img1", width: 400 });
      expect(question.media?.coverId).toBeUndefined();
    });
  });
});

describe("checking answers", () => {
  it("accepts a word-for-word match without asking the model", async () => {
    expect(quickCheck("  the EVENT loop. ", "The event loop")).toEqual({ score: 1, feedback: "" });
    expect(quickCheck("the nucleus", "Nucleus")).toEqual({ score: 1, feedback: "" });
    expect(quickCheck("something else", "The event loop")).toBeNull();
    expect(quickCheck("", "")).toBeNull();
    const provider = fakeProvider(() => "{}");
    expect(await checkAnswer(provider, { prompt: "q", expected: "Paris", answer: "paris!" })).toEqual({ score: 1, feedback: "" });
    expect(await checkAnswer(provider, { prompt: "q", expected: "Paris", answer: "   " })).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it("asks the model otherwise and reads its verdict", async () => {
    const provider = fakeProvider(() => 'Sure. {"score": 0.5, "feedback": "You named the idea but missed the order."}');
    const result = await checkAnswer(provider, { prompt: "Which runs first?", expected: "Microtasks", answer: "the promise ones I think" });
    expect(result).toEqual({ score: 0.5, feedback: "You named the idea but missed the order." });
    expect(provider.calls[0][1].content).toContain("Student's answer: the promise ones I think");
    expect(buildCheckMessages({ prompt: "p", expected: "e", answer: "a" })[1].content).toContain("Expected answer: e");

    // without a model, a non-matching answer simply isn't checked
    expect(await checkAnswer(null, { prompt: "q", expected: "Paris", answer: "London" })).toBeNull();
  });

  it("handles other score scales and unreadable replies", () => {
    expect(parseCheck('{"score": 8, "feedback": "ok"}')?.score).toBe(0.8);
    expect(parseCheck('{"score": 75}')).toEqual({ score: 0.75, feedback: "" });
    expect(parseCheck('{"score": "1"}')?.score).toBe(1);
    expect(parseCheck('{"score": -3}')?.score).toBe(0);
    expect(parseCheck("looks right to me")).toBeNull();
    expect(parseCheck('{"feedback": "no score"}')).toBeNull();
  });

  it("proposes a rating from the score, never the top one", () => {
    expect([0, 0.3, 0.5, 0.69, 0.7, 1].map(ratingForScore)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe("choosing a model", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const localUp: FetchLike = async (url) => {
    if (url.includes(":11434")) return json({ data: [{ id: "qwen" }] });
    throw new TypeError("refused");
  };
  const localDown: FetchLike = async () => {
    throw new TypeError("refused");
  };
  const cloud = { ...DEFAULT_SETTINGS, cloudProvider: "anthropic" as const, cloudModel: "claude-x" };
  const withKey = { getApiKey: async () => "key" };
  const noKey = { getApiKey: async () => null };

  it("prefers a model on this computer and falls back to the connected cloud model", async () => {
    expect(await resolveProvider(cloud, { fetch: localUp, ...withKey })).toMatchObject({ kind: "local", model: "qwen" });
    expect(await resolveProvider(cloud, { fetch: localDown, ...withKey })).toMatchObject({ id: "anthropic", kind: "cloud", model: "claude-x" });
    expect(await resolveProvider(DEFAULT_SETTINGS, { fetch: localDown, ...withKey })).toBeNull();
    expect(await resolveProvider(cloud, { fetch: localDown, ...noKey })).toBeNull();
  });

  it("respects device-only, cloud-only and off", async () => {
    expect(await resolveProvider({ ...cloud, aiMode: "device" }, { fetch: localDown, ...withKey })).toBeNull();
    expect(await resolveProvider({ ...cloud, aiMode: "cloud" }, { fetch: localUp, ...withKey })).toMatchObject({ kind: "cloud" });
    expect(await resolveProvider({ ...cloud, aiMode: "off" }, { fetch: localUp, ...withKey })).toBeNull();
    const openai = await resolveProvider(
      { ...cloud, aiMode: "cloud", cloudProvider: "openai", cloudModel: "gpt-x" },
      { fetch: localDown, ...withKey },
    );
    expect(openai).toMatchObject({ id: "openai", model: "gpt-x" });
  });

  it("uses Tutor's built-in engine when no AI app is running, starting it for each request", async () => {
    let starts = 0;
    const builtIn = {
      installed: async () => ({ modelName: "Qwen3 4B" }),
      start: async () => {
        starts++;
        return 40123;
      },
    };
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      if (url.includes(":40123")) return json({ choices: [{ message: { content: "hello" } }] });
      throw new TypeError("refused");
    };

    const provider = await resolveProvider(cloud, { fetch, ...withKey, builtIn });
    expect(provider).toMatchObject({ id: "builtin", kind: "local", model: "Qwen3 4B" });
    expect(starts).toBe(0); // choosing it must not load the model
    expect(await provider?.complete([{ role: "user", content: "hi" }])).toBe("hello");
    expect(await provider?.complete([{ role: "user", content: "hi" }])).toBe("hello");
    expect(starts).toBe(2);
    expect(urls.at(-1)).toBe("http://127.0.0.1:40123/v1/chat/completions");
  });

  it("prefers an AI app that is already running over the built-in engine, and skips it when not installed", async () => {
    const installed = { installed: async () => ({ modelName: "Qwen3 4B" }), start: async () => 1 };
    const missing = { installed: async () => null, start: async () => 1 };
    expect(await resolveProvider(cloud, { fetch: localUp, ...withKey, builtIn: installed })).toMatchObject({ id: "ollama" });
    expect(await resolveProvider(cloud, { fetch: localDown, ...withKey, builtIn: missing })).toMatchObject({ kind: "cloud" });
    expect(await resolveProvider({ ...cloud, aiMode: "device" }, { fetch: localDown, ...withKey, builtIn: missing })).toBeNull();
    expect(await resolveProvider({ ...cloud, aiMode: "cloud" }, { fetch: localDown, ...withKey, builtIn: installed })).toMatchObject({ kind: "cloud" });
  });

  describe("starting the built-in engine when Tutor opens", () => {
    const engine = (installed: boolean) => {
      const counter = { starts: 0 };
      return {
        counter,
        builtIn: {
          installed: async () => (installed ? { modelName: "Qwen3 4B" } : null),
          start: async () => {
            counter.starts++;
            return 40123;
          },
        },
      };
    };

    it("starts it when it is the model Tutor would use", async () => {
      for (const aiMode of ["auto", "device"] as const) {
        const { counter, builtIn } = engine(true);
        expect(await warmUpBuiltIn({ ...cloud, aiMode }, { fetch: localDown, builtIn })).toBe(true);
        expect(counter.starts).toBe(1);
      }
    });

    it("leaves it alone when another model would be used, it is not set up, or AI is off", async () => {
      const cases = [
        { settings: cloud, fetch: localUp, installed: true }, // Ollama is running and comes first
        { settings: cloud, fetch: localDown, installed: false },
        { settings: { ...cloud, aiMode: "cloud" as const }, fetch: localDown, installed: true },
        { settings: { ...cloud, aiMode: "off" as const }, fetch: localDown, installed: true },
      ];
      for (const { settings, fetch, installed } of cases) {
        const { counter, builtIn } = engine(installed);
        expect(await warmUpBuiltIn(settings, { fetch, builtIn })).toBe(false);
        expect(counter.starts).toBe(0);
      }
      // the browser preview has no built-in engine
      expect(await warmUpBuiltIn(cloud, { fetch: localDown })).toBe(false);
    });
  });
});

describe("background queue", () => {
  it("runs notes one at a time, skips duplicates and keeps going after a failure", async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const queue = new NoteQueue(async (noteId) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(noteId);
      active--;
      if (noteId === "bad") throw new Error("model crashed");
    });
    const states: (string | null)[] = [];
    queue.subscribe((state) => states.push(state.running));

    queue.enqueue("a");
    queue.enqueue("bad");
    queue.enqueue("bad");
    queue.enqueue("c");
    await queue.idle();

    expect(order).toEqual(["a", "bad", "c"]);
    expect(maxActive).toBe(1);
    expect(states).toContain("bad");
    expect(queue.getState()).toEqual({ running: null, waiting: [], lastError: null });

    queue.enqueue("bad");
    await queue.idle();
    expect(queue.getState().lastError).toBe("model crashed");
  });
});

describe("sticky pacing", () => {
  const base: StickyPacing = {
    now: 100 * 60_000,
    enabled: true,
    pausedUntil: 0,
    everyMinutes: 20,
    lastClosedAt: 80 * 60_000,
    visible: false,
    practising: false,
  };

  it("shows a sticky question once the interval has passed", () => {
    expect(stickyDue(base)).toBe(true);
    expect(stickyDue({ ...base, lastClosedAt: 81 * 60_000 })).toBe(false);
  });

  it("stays quiet when switched off, paused, already showing or during practice", () => {
    expect(stickyDue({ ...base, enabled: false })).toBe(false);
    expect(stickyDue({ ...base, pausedUntil: base.now + 1 })).toBe(false);
    expect(stickyDue({ ...base, pausedUntil: base.now })).toBe(true);
    expect(stickyDue({ ...base, visible: true })).toBe(false);
    expect(stickyDue({ ...base, practising: true })).toBe(false);
  });

  it("brings the first one a minute after launch, and pauses until local midnight", () => {
    const launch = 1_000_000_000;
    const pacing = { ...base, lastClosedAt: initialLastClosed(launch, 20) };
    expect(stickyDue({ ...pacing, now: launch + 59_000 })).toBe(false);
    expect(stickyDue({ ...pacing, now: launch + 60_000 })).toBe(true);

    const evening = new Date(2026, 5, 15, 21, 30).getTime();
    expect(new Date(startOfTomorrow(evening))).toEqual(new Date(2026, 5, 16, 0, 0));
  });
});
