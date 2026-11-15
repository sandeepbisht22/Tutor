import type { Db } from "../db/driver";
import type { DocNode, NoteBlock, QuestionMedia } from "../domain/types";
import { figureAnnotations } from "../lib/blocks";
import { extractJson, stripThinking } from "../llm/json";
import type { ChatMessage, LlmProvider } from "../llm/types";
import { getNote, listBlocks, listBlocksAwaitingSuggestions, markBlockSuggested } from "../repo/notes";
import { createQuestion, deleteStaleSuggestions, listQuestionsForNote } from "../repo/questions";

/** Writing questions from notes: one small request per changed paragraph. */

export interface Suggestion {
  prompt: string;
  answer: string;
}

const MIN_TEXT = 40;

/** Is there enough in this block to ask about? Headings and bare images are skipped. */
export function worthAsking(block: NoteBlock): boolean {
  if (block.type === "heading") return false;
  if (block.type === "figure") return block.text.replace(/^Image:?/, "").trim().length >= 12;
  return block.text.length >= MIN_TEXT;
}

/** Longer passages may get more questions, but never many. */
export function questionBudget(block: NoteBlock): number {
  if (block.text.length < 200) return 1;
  return block.text.length < 600 ? 2 : 3;
}

export function buildSuggestMessages(input: {
  noteTitle: string;
  heading: string;
  text: string;
  max: number;
  alreadyAsked: string[];
}): ChatMessage[] {
  const system = [
    "You write study questions from a student's own notes, so the student can practise recalling them later.",
    "Rules:",
    "- Ask only about what the passage says. Do not add outside facts.",
    "- One fact or idea per question.",
    '- Each question must make sense on its own, without the passage in view. Name the thing you ask about. Never write "the passage", "the text" or "the note".',
    "- No yes/no or true/false questions.",
    "- Keep answers short: a word, a phrase, or one or two sentences.",
    "- Write in the same language as the passage.",
    `- Write at most ${input.max} question${input.max === 1 ? "" : "s"}. Fewer good questions beat more weak ones. If nothing in the passage is worth remembering, return an empty list.`,
    'Reply with JSON only, in this shape: {"questions":[{"question":"...","answer":"..."}]}',
  ].join("\n");

  const context = [input.noteTitle.trim() && `Note: ${input.noteTitle.trim()}`, input.heading && `Section: ${input.heading}`]
    .filter(Boolean)
    .join("\n");
  const asked =
    input.alreadyAsked.length > 0
      ? `\n\nAlready asked, do not repeat:\n${input.alreadyAsked.slice(-12).map((q) => `- ${q}`).join("\n")}`
      : "";
  return [
    { role: "system", content: system },
    { role: "user", content: `${context ? `${context}\n\n` : ""}Passage:\n${input.text}${asked}` },
  ];
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const YES_NO = new Set(["yes", "no", "true", "false"]);

/** Read the model's reply defensively: small models wander off the requested format. */
export function parseSuggestions(reply: string, alreadyAsked: string[], max: number): Suggestion[] {
  const parsed = extractJson(stripThinking(reply));
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];

  const seen = new Set(alreadyAsked.map(normalize));
  const result: Suggestion[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const prompt = text(record.question ?? record.q ?? record.prompt);
    const answer = text(record.answer ?? record.a);
    if (prompt.length < 8 || prompt.length > 300 || answer === "" || answer.length > 600) continue;
    if (YES_NO.has(normalize(answer))) continue;
    const key = normalize(prompt);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ prompt, answer });
    if (result.length >= max) break;
  }
  return result;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export interface SuggestOptions {
  /** add the questions to practice directly instead of leaving them as suggestions */
  autoAccept?: boolean;
  signal?: AbortSignal;
}

/**
 * Write suggestions for every block of a note whose text the AI has not seen
 * yet. Suggestions made from an older version of a block are replaced.
 * Returns how many questions were added. Stops at the first failed request,
 * leaving the remaining blocks for next time.
 */
export async function suggestForNote(
  db: Db,
  provider: LlmProvider,
  noteId: string,
  options: SuggestOptions = {},
): Promise<number> {
  const note = await getNote(db, noteId);
  if (!note) return 0;
  const pending = await listBlocksAwaitingSuggestions(db, noteId);
  if (pending.length === 0) return 0;

  const headings = headingByBlock(await listBlocks(db, noteId));
  const questions = await listQuestionsForNote(db, noteId);
  const asked = questions.filter((q) => q.status !== "suggested").map((q) => q.prompt);
  let added = 0;

  for (const block of pending) {
    if (options.signal?.aborted) break;
    await deleteStaleSuggestions(db, noteId, block.id);

    // nothing to ask, or you already keep questions made from exactly this text
    const covered = questions.some(
      (q) => q.status !== "suggested" && q.sourceBlockId === block.id && q.sourceHash === block.hash,
    );
    if (!worthAsking(block) || covered) {
      await markBlockSuggested(db, noteId, block);
      continue;
    }

    const max = questionBudget(block);
    const reply = await provider.complete(
      buildSuggestMessages({
        noteTitle: note.title,
        heading: headings.get(block.id) ?? "",
        text: block.text,
        max,
        alreadyAsked: asked,
      }),
      { maxTokens: 700, temperature: 0.3, signal: options.signal },
    );

    const media = block.type === "figure" ? figureMedia(note.doc, block.id) : null;
    for (const suggestion of parseSuggestions(reply, asked, max)) {
      await createQuestion(db, {
        topicId: note.topicId,
        noteId,
        sourceBlockId: block.id,
        sourceHash: block.hash,
        prompt: suggestion.prompt,
        answer: suggestion.answer,
        media,
        status: options.autoAccept ? "active" : "suggested",
        origin: "ai",
      });
      asked.push(suggestion.prompt);
      added++;
    }
    await markBlockSuggested(db, noteId, block);
  }
  return added;
}

/** For each block, the heading it sits under (gives the model context). */
function headingByBlock(blocks: NoteBlock[]): Map<string, string> {
  const map = new Map<string, string>();
  let current = "";
  for (const block of blocks) {
    if (block.type === "heading") current = block.text;
    else map.set(block.id, current);
  }
  return map;
}

/** The image of a figure block with its labels (covers left out), to show with a question. */
export function figureMedia(doc: DocNode, blockId: string): QuestionMedia | null {
  const node = (doc.content ?? []).find((n) => n.type === "figure" && n.attrs?.blockId === blockId);
  const imageId = node?.attrs?.imageId;
  if (!node || typeof imageId !== "string") return null;
  return {
    imageId,
    width: Number(node.attrs?.width) || 0,
    height: Number(node.attrs?.height) || 0,
    annotations: figureAnnotations(node),
  };
}
