import type { Db } from "../db/driver";
import type {
  DocNode,
  NoteBlock,
  Question,
  QuestionKind,
  QuestionMedia,
  QuestionOrigin,
  QuestionStatus,
  SourceStatus,
} from "../domain/types";
import { figureAnnotations } from "../lib/blocks";
import { newId } from "../lib/id";
import { newSchedule } from "../lib/scheduler";

interface QuestionRow {
  id: string;
  topic_id: string;
  note_id: string | null;
  source_block_id: string | null;
  source_hash: string | null;
  kind: QuestionKind;
  prompt: string;
  answer: string;
  media_json: string | null;
  status: QuestionStatus;
  origin: QuestionOrigin;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_practised: number | null;
  created_at: number;
  updated_at: number;
  current_hash: string | null;
  source_text: string | null;
  note_title: string | null;
}

/** Questions joined with their note's title and the current state of their source block. */
const SELECT_QUESTIONS = `
  SELECT q.*, b.content_hash AS current_hash, b.text AS source_text, n.title AS note_title
    FROM questions q
    LEFT JOIN note_blocks b ON b.note_id = q.note_id AND b.id = q.source_block_id
    LEFT JOIN notes n ON n.id = q.note_id`;

function sourceStatus(row: QuestionRow): SourceStatus {
  if (!row.source_block_id) return "none";
  if (row.current_hash === null) return "removed";
  return row.current_hash === row.source_hash ? "ok" : "changed";
}

function parseMedia(json: string | null): QuestionMedia | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as QuestionMedia;
  } catch {
    return null;
  }
}

const toQuestion = (row: QuestionRow): Question => ({
  id: row.id,
  topicId: row.topic_id,
  noteId: row.note_id,
  noteTitle: row.note_title,
  sourceBlockId: row.source_block_id,
  sourceHash: row.source_hash,
  sourceStatus: sourceStatus(row),
  sourceText: row.source_text,
  kind: row.kind,
  prompt: row.prompt,
  answer: row.answer,
  media: parseMedia(row.media_json),
  status: row.status,
  origin: row.origin,
  due: row.due,
  stability: row.stability,
  difficulty: row.difficulty,
  elapsedDays: row.elapsed_days,
  scheduledDays: row.scheduled_days,
  learningSteps: row.learning_steps,
  reps: row.reps,
  lapses: row.lapses,
  state: row.state,
  lastPractised: row.last_practised,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface NewQuestion {
  topicId: string;
  noteId?: string | null;
  /** the note block this question was made from, with that block's hash at the time */
  sourceBlockId?: string | null;
  sourceHash?: string | null;
  prompt: string;
  answer: string;
  media?: QuestionMedia | null;
  /** AI-made questions start as 'suggested' and wait for a decision */
  status?: QuestionStatus;
  origin?: QuestionOrigin;
}

export async function createQuestion(db: Db, input: NewQuestion, now = Date.now()): Promise<Question> {
  const { prompt, answer } = cleanText(input);
  const id = newId();
  await db.execute(
    `INSERT INTO questions (id, topic_id, note_id, source_block_id, source_hash, kind, prompt, answer, media_json,
                            status, origin, due, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [
      id,
      input.topicId,
      input.noteId ?? null,
      input.sourceBlockId ?? null,
      input.sourceHash ?? null,
      input.media ? "image" : "text",
      prompt,
      answer,
      input.media ? JSON.stringify(input.media) : null,
      input.status ?? "active",
      input.origin ?? "manual",
      newSchedule(now).due,
      now,
    ],
  );
  const question = await getQuestion(db, id);
  if (!question) throw new Error("The question could not be saved.");
  return question;
}

export async function getQuestion(db: Db, id: string): Promise<Question | null> {
  const rows = await db.select<QuestionRow>(`${SELECT_QUESTIONS} WHERE q.id = $1`, [id]);
  return rows[0] ? toQuestion(rows[0]) : null;
}

/** A note's questions: suggestions first, then the rest in the order they were made. */
export async function listQuestionsForNote(db: Db, noteId: string): Promise<Question[]> {
  const rows = await db.select<QuestionRow>(
    `${SELECT_QUESTIONS} WHERE q.note_id = $1
      ORDER BY CASE q.status WHEN 'suggested' THEN 0 ELSE 1 END, q.created_at`,
    [noteId],
  );
  return rows.map(toQuestion);
}

/** Every question you practise in the given topics (suggestions left out), newest first. */
export async function listQuestionsForTopics(db: Db, topicIds: string[]): Promise<Question[]> {
  if (topicIds.length === 0) return [];
  const rows = await db.select<QuestionRow>(
    `${SELECT_QUESTIONS}
      WHERE q.status <> 'suggested' AND q.topic_id IN (${marks(topicIds, 0)})
      ORDER BY q.created_at DESC`,
    topicIds,
  );
  return rows.map(toQuestion);
}

/** All AI suggestions waiting for a decision, grouped by note (most recently edited note first). */
export async function listSuggestions(db: Db): Promise<Question[]> {
  const rows = await db.select<QuestionRow>(
    `${SELECT_QUESTIONS} WHERE q.status = 'suggested' ORDER BY n.updated_at DESC, q.note_id, q.created_at`,
  );
  return rows.map(toQuestion);
}

/** Active questions that are ready now, longest-waiting first. Omit topicIds for every topic. */
export async function listReadyQuestions(
  db: Db,
  options: { topicIds?: string[]; now?: number; limit?: number } = {},
): Promise<Question[]> {
  const now = options.now ?? Date.now();
  const params: unknown[] = [now, options.limit ?? 200];
  let topicFilter = "";
  if (options.topicIds) {
    if (options.topicIds.length === 0) return [];
    topicFilter = `AND q.topic_id IN (${marks(options.topicIds, params.length)})`;
    params.push(...options.topicIds);
  }
  const rows = await db.select<QuestionRow>(
    `${SELECT_QUESTIONS}
      WHERE q.status = 'active' AND q.due <= $1 ${topicFilter}
      ORDER BY q.due ASC
      LIMIT $2`,
    params,
  );
  return rows.map(toQuestion);
}

/** When the next question becomes ready, or null if nothing is waiting. */
export async function nextReadyAt(db: Db, now = Date.now()): Promise<number | null> {
  const rows = await db.select<{ next: number | null }>(
    `SELECT MIN(due) AS next FROM questions WHERE status = 'active' AND due > $1`,
    [now],
  );
  return rows[0]?.next ?? null;
}

/** Active questions you have forgotten at least twice after learning them, worst first. */
export async function listStruggling(db: Db, limit = 8): Promise<Question[]> {
  const rows = await db.select<QuestionRow>(
    `${SELECT_QUESTIONS}
      WHERE q.status = 'active' AND q.lapses >= 2
      ORDER BY q.lapses DESC, q.difficulty DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toQuestion);
}

export async function updateQuestionText(db: Db, id: string, input: { prompt: string; answer: string }): Promise<void> {
  const { prompt, answer } = cleanText(input);
  await db.execute(`UPDATE questions SET prompt = $1, answer = $2, updated_at = $3 WHERE id = $4`, [
    prompt,
    answer,
    Date.now(),
    id,
  ]);
}

export async function setQuestionStatus(db: Db, id: string, status: QuestionStatus): Promise<void> {
  await db.execute(`UPDATE questions SET status = $1, updated_at = $2 WHERE id = $3`, [status, Date.now(), id]);
}

/** Keep a suggestion: it becomes a question you practise, ready straight away. */
export async function acceptSuggestion(db: Db, id: string, now = Date.now()): Promise<void> {
  await db.execute(
    `UPDATE questions SET status = 'active', due = $1, updated_at = $1 WHERE id = $2 AND status = 'suggested'`,
    [now, id],
  );
}

/** Keep every waiting suggestion (of one note, or of all notes). Returns how many. */
export async function acceptAllSuggestions(db: Db, noteId?: string, now = Date.now()): Promise<number> {
  const result = noteId
    ? await db.execute(
        `UPDATE questions SET status = 'active', due = $1, updated_at = $1 WHERE status = 'suggested' AND note_id = $2`,
        [now, noteId],
      )
    : await db.execute(`UPDATE questions SET status = 'active', due = $1, updated_at = $1 WHERE status = 'suggested'`, [
        now,
      ]);
  return result.rowsAffected;
}

/** Drop undecided AI suggestions made from a block (its text changed, so they are out of date). */
export async function deleteStaleSuggestions(db: Db, noteId: string, blockId: string): Promise<void> {
  await db.execute(
    `DELETE FROM questions WHERE note_id = $1 AND source_block_id = $2 AND status = 'suggested' AND origin = 'ai'`,
    [noteId, blockId],
  );
}

/**
 * You checked a question whose source text changed and it is still right:
 * remember the block's current hash (or drop the link if the block is gone).
 */
export async function acknowledgeSource(db: Db, id: string): Promise<void> {
  await db.execute(
    `UPDATE questions
        SET source_hash = (SELECT b.content_hash FROM note_blocks b
                            WHERE b.note_id = questions.note_id AND b.id = questions.source_block_id),
            updated_at = $1
      WHERE id = $2`,
    [Date.now(), id],
  );
  await db.execute(`UPDATE questions SET source_block_id = NULL WHERE id = $1 AND source_hash IS NULL`, [id]);
}

export async function deleteQuestion(db: Db, id: string): Promise<void> {
  await db.execute(`DELETE FROM questions WHERE id = $1`, [id]);
}

export const COVER_PROMPT = "What is under the cover?";

/**
 * Covers drawn on a note's images become questions on their own: one per cover
 * that has an answer. Called on every note save, so moving, renaming or
 * removing a cover updates or removes its question, and progress is kept.
 */
export async function syncCoverQuestions(db: Db, noteId: string, doc: DocNode, blocks: NoteBlock[]): Promise<void> {
  const hashes = new Map(blocks.map((block) => [block.id, block.hash]));
  const wanted = new Map<string, { blockId: string; answer: string; media: string; hash: string | null }>();

  for (const node of doc.content ?? []) {
    if (node.type !== "figure") continue;
    const blockId = node.attrs?.blockId;
    const imageId = node.attrs?.imageId;
    if (typeof blockId !== "string" || typeof imageId !== "string") continue;
    const annotations = figureAnnotations(node);
    for (const cover of annotations) {
      if (cover.kind !== "cover" || cover.text.trim() === "") continue;
      const media: QuestionMedia = {
        imageId,
        width: Number(node.attrs?.width) || 0,
        height: Number(node.attrs?.height) || 0,
        annotations,
        coverId: cover.id,
      };
      wanted.set(`${blockId}:${cover.id}`, {
        blockId,
        answer: cover.text.trim(),
        media: JSON.stringify(media),
        hash: hashes.get(blockId) ?? null,
      });
    }
  }

  const existing = await db.select<{
    id: string;
    source_block_id: string | null;
    source_hash: string | null;
    answer: string;
    media_json: string | null;
  }>(`SELECT id, source_block_id, source_hash, answer, media_json FROM questions WHERE note_id = $1 AND origin = 'cover'`, [
    noteId,
  ]);

  const now = Date.now();
  for (const row of existing) {
    const key = `${row.source_block_id}:${parseMedia(row.media_json)?.coverId}`;
    const target = wanted.get(key);
    if (!target) {
      await deleteQuestion(db, row.id);
      continue;
    }
    wanted.delete(key);
    if (row.answer !== target.answer || row.media_json !== target.media || row.source_hash !== target.hash) {
      await db.execute(
        `UPDATE questions SET answer = $1, media_json = $2, source_hash = $3, updated_at = $4 WHERE id = $5`,
        [target.answer, target.media, target.hash, now, row.id],
      );
    }
  }

  for (const target of wanted.values()) {
    await db.execute(
      `INSERT INTO questions (id, topic_id, note_id, source_block_id, source_hash, kind, prompt, answer, media_json,
                              status, origin, due, created_at, updated_at)
       SELECT $1, n.topic_id, n.id, $2, $3, 'image', $4, $5, $6, 'active', 'cover', $7, $7, $7
         FROM notes n WHERE n.id = $8`,
      [newId(), target.blockId, target.hash, COVER_PROMPT, target.answer, target.media, now, noteId],
    );
  }
}

function cleanText(input: { prompt: string; answer: string }): { prompt: string; answer: string } {
  const prompt = input.prompt.trim();
  const answer = input.answer.trim();
  if (prompt === "" || answer === "") throw new Error("A question needs both the question and its answer.");
  return { prompt, answer };
}

/** "$3, $4, $5" for a list of values that starts after `offset` earlier parameters. */
function marks(values: unknown[], offset: number): string {
  return values.map((_, index) => `$${offset + index + 1}`).join(", ");
}
