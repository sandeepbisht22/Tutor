import type { Db } from "../db/driver";
import type { DocNode, Note, NoteBlock, NoteRef, NoteSummary } from "../domain/types";
import { EMPTY_DOC, normalizeBlocks, type NormalizedDoc } from "../lib/blocks";
import { newId } from "../lib/id";
import { syncCoverQuestions } from "./questions";

interface NoteRow {
  id: string;
  topic_id: string;
  title: string;
  content_json: string;
  content_text: string;
  created_at: number;
  updated_at: number;
}

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  topicId: row.topic_id,
  title: row.title,
  doc: JSON.parse(row.content_json) as DocNode,
  text: row.content_text,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listNotes(db: Db, topicId: string): Promise<NoteSummary[]> {
  const rows = await db.select<{
    id: string;
    topic_id: string;
    title: string;
    preview: string;
    updated_at: number;
    question_count: number;
  }>(
    `SELECT n.id, n.topic_id, n.title, substr(n.content_text, 1, 200) AS preview, n.updated_at,
            (SELECT COUNT(*) FROM questions q WHERE q.note_id = n.id AND q.status <> 'suggested') AS question_count
       FROM notes n
      WHERE n.topic_id = $1
      ORDER BY n.updated_at DESC`,
    [topicId],
  );
  return rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    title: r.title,
    preview: r.preview,
    updatedAt: r.updated_at,
    questionCount: Number(r.question_count),
  }));
}

interface NoteRefRow {
  id: string;
  topic_id: string;
  title: string;
  updated_at: number;
}

const toNoteRef = (row: NoteRefRow): NoteRef => ({ id: row.id, topicId: row.topic_id, title: row.title, updatedAt: row.updated_at });

/** The notes edited most recently, across every topic. */
export async function listRecentNotes(db: Db, limit = 5): Promise<NoteRef[]> {
  const rows = await db.select<NoteRefRow>(`SELECT id, topic_id, title, updated_at FROM notes ORDER BY updated_at DESC LIMIT $1`, [limit]);
  return rows.map(toNoteRef);
}

/**
 * Notes whose title or text contains `query` (ignoring case). Title matches come
 * first. `%` and `_` are matched as themselves, not as wildcards.
 */
export async function searchNotes(db: Db, query: string, limit = 8): Promise<NoteRef[]> {
  const text = query.trim();
  if (text === "") return [];
  const pattern = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const rows = await db.select<NoteRefRow>(
    `SELECT id, topic_id, title, updated_at
       FROM notes
      WHERE title LIKE $1 ESCAPE '\\' OR content_text LIKE $1 ESCAPE '\\'
      ORDER BY (title LIKE $1 ESCAPE '\\') DESC, updated_at DESC
      LIMIT $2`,
    [pattern, limit],
  );
  return rows.map(toNoteRef);
}

export async function getNote(db: Db, id: string): Promise<Note | null> {
  const rows = await db.select<NoteRow>(`SELECT * FROM notes WHERE id = $1`, [id]);
  return rows[0] ? toNote(rows[0]) : null;
}

export async function createNote(db: Db, topicId: string, title = ""): Promise<Note> {
  const now = Date.now();
  const id = newId();
  await db.execute(
    `INSERT INTO notes (id, topic_id, title, content_json, content_text, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', $5, $5)`,
    [id, topicId, title, JSON.stringify(EMPTY_DOC), now],
  );
  return { id, topicId, title, doc: EMPTY_DOC, text: "", createdAt: now, updatedAt: now };
}

const CHUNK = 100;

/**
 * Save a note's title and content. Block ids are added where missing, the
 * note's block list (what questions link to) is brought in line with the
 * content, and questions made from image covers are kept in step.
 */
export async function saveNote(
  db: Db,
  id: string,
  input: { title: string; doc: DocNode },
  genId?: () => string,
): Promise<NormalizedDoc> {
  const normalized = normalizeBlocks(input.doc, genId);
  const { blocks } = normalized;
  const text = blocks.map((b) => b.text).join("\n");

  await db.execute(
    `UPDATE notes SET title = $1, content_json = $2, content_text = $3, updated_at = $4 WHERE id = $5`,
    [input.title, JSON.stringify(normalized.doc), text, Date.now(), id],
  );

  // Rows are updated in place (not deleted and re-added) so each block keeps
  // its record of what the AI has already written suggestions for.
  const existing = await db.select<{ id: string }>(`SELECT id FROM note_blocks WHERE note_id = $1`, [id]);
  const keep = new Set(blocks.map((b) => b.id));
  const gone = existing.map((row) => row.id).filter((blockId) => !keep.has(blockId));
  for (let i = 0; i < gone.length; i += CHUNK) {
    const part = gone.slice(i, i + CHUNK);
    await db.execute(
      `DELETE FROM note_blocks WHERE note_id = $1 AND id IN (${part.map((_, n) => `$${n + 2}`).join(", ")})`,
      [id, ...part],
    );
  }
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const values: string[] = [];
    const params: unknown[] = [id];
    for (const block of blocks.slice(i, i + CHUNK)) {
      const base = params.length;
      values.push(`($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      params.push(block.id, block.position, block.type, block.text, block.hash);
    }
    await db.execute(
      `INSERT INTO note_blocks (note_id, id, position, type, text, content_hash) VALUES ${values.join(", ")}
       ON CONFLICT(note_id, id) DO UPDATE SET
         position = excluded.position, type = excluded.type,
         text = excluded.text, content_hash = excluded.content_hash`,
      params,
    );
  }

  await syncCoverQuestions(db, id, normalized.doc, blocks);
  return normalized;
}

export async function listBlocks(db: Db, noteId: string): Promise<NoteBlock[]> {
  const rows = await db.select<BlockRow>(
    `SELECT id, position, type, text, content_hash FROM note_blocks WHERE note_id = $1 ORDER BY position`,
    [noteId],
  );
  return rows.map(toBlock);
}

/** Blocks whose current text the AI has not written suggestions for yet. */
export async function listBlocksAwaitingSuggestions(db: Db, noteId: string): Promise<NoteBlock[]> {
  const rows = await db.select<BlockRow>(
    `SELECT id, position, type, text, content_hash FROM note_blocks
      WHERE note_id = $1 AND (suggested_hash IS NULL OR suggested_hash <> content_hash)
      ORDER BY position`,
    [noteId],
  );
  return rows.map(toBlock);
}

/** Notes that still have text the AI has not looked at, most recently edited first. */
export async function listNotesAwaitingSuggestions(db: Db, limit = 20): Promise<string[]> {
  const rows = await db.select<{ id: string }>(
    `SELECT n.id FROM notes n
      WHERE EXISTS (SELECT 1 FROM note_blocks b
                     WHERE b.note_id = n.id AND (b.suggested_hash IS NULL OR b.suggested_hash <> b.content_hash))
      ORDER BY n.updated_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => row.id);
}

export async function markBlockSuggested(db: Db, noteId: string, block: NoteBlock): Promise<void> {
  await db.execute(`UPDATE note_blocks SET suggested_hash = $1 WHERE note_id = $2 AND id = $3`, [
    block.hash,
    noteId,
    block.id,
  ]);
}

/** Deletes the note with its images and questions. */
export async function deleteNote(db: Db, id: string): Promise<void> {
  await db.execute(`DELETE FROM notes WHERE id = $1`, [id]);
}

interface BlockRow {
  id: string;
  position: number;
  type: string;
  text: string;
  content_hash: string;
}

const toBlock = (r: BlockRow): NoteBlock => ({
  id: r.id,
  position: r.position,
  type: r.type,
  text: r.text,
  hash: r.content_hash,
});
