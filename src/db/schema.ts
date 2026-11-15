/**
 * Schema migrations. Each entry is one version: a list of single statements
 * (run one by one, because the Tauri SQL plugin executes one statement per call).
 *
 * Never edit a released migration. Add a new entry at the end instead.
 */
export const migrations: string[][] = [
  // v1 — topics, notes, source blocks, images, questions, attempts, settings
  [
    `CREATE TABLE topics (
      id         TEXT PRIMARY KEY,
      parent_id  TEXT REFERENCES topics(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_topics_parent ON topics(parent_id)`,

    `CREATE TABLE notes (
      id           TEXT PRIMARY KEY,
      topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      title        TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_notes_topic ON notes(topic_id, updated_at)`,

    // One row per top-level block of a note (paragraph, list, image…).
    // Questions point at these, and the hash tells us when the text a question
    // was made from has changed.
    `CREATE TABLE note_blocks (
      note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      id             TEXT NOT NULL,
      position       INTEGER NOT NULL,
      type           TEXT NOT NULL,
      text           TEXT NOT NULL,
      content_hash   TEXT NOT NULL,
      -- hash of the text the AI last wrote suggestions for (NULL = never)
      suggested_hash TEXT,
      PRIMARY KEY (note_id, id)
    )`,

    // Image bytes live in the database (base64) so one file holds everything.
    // Labels and the description live in the note's document, next to the image.
    `CREATE TABLE images (
      id         TEXT PRIMARY KEY,
      note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      mime       TEXT NOT NULL,
      data       TEXT NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,

    `CREATE TABLE questions (
      id              TEXT PRIMARY KEY,
      topic_id        TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      note_id         TEXT REFERENCES notes(id) ON DELETE CASCADE,
      source_block_id TEXT,
      source_hash     TEXT,
      kind            TEXT NOT NULL DEFAULT 'text',
      prompt          TEXT NOT NULL,
      answer          TEXT NOT NULL,
      media_json      TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      origin          TEXT NOT NULL DEFAULT 'manual',
      due             INTEGER NOT NULL,
      stability       REAL NOT NULL DEFAULT 0,
      difficulty      REAL NOT NULL DEFAULT 0,
      elapsed_days    INTEGER NOT NULL DEFAULT 0,
      scheduled_days  INTEGER NOT NULL DEFAULT 0,
      learning_steps  INTEGER NOT NULL DEFAULT 0,
      reps            INTEGER NOT NULL DEFAULT 0,
      lapses          INTEGER NOT NULL DEFAULT 0,
      state           INTEGER NOT NULL DEFAULT 0,
      last_practised  INTEGER,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_questions_due ON questions(status, due)`,
    `CREATE INDEX idx_questions_topic ON questions(topic_id)`,
    `CREATE INDEX idx_questions_note ON questions(note_id)`,

    // Every attempt, forever. This is what progress tracking is built on.
    `CREATE TABLE attempts (
      id                TEXT PRIMARY KEY,
      question_id       TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      attempted_at      INTEGER NOT NULL,
      rating            INTEGER NOT NULL,
      answer_text       TEXT,
      ai_score          REAL,
      ai_feedback       TEXT,
      duration_ms       INTEGER NOT NULL DEFAULT 0,
      place             TEXT NOT NULL DEFAULT 'practice',
      state_before      INTEGER NOT NULL,
      stability_before  REAL NOT NULL,
      difficulty_before REAL NOT NULL,
      scheduled_days    INTEGER NOT NULL,
      due_after         INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_attempts_question ON attempts(question_id, attempted_at)`,
    `CREATE INDEX idx_attempts_time ON attempts(attempted_at)`,

    `CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
];
