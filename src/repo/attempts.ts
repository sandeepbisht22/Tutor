import type { Db } from "../db/driver";
import type { Attempt, AttemptPlace, Question, Rating } from "../domain/types";
import { newId } from "../lib/id";
import type { Scheduler } from "../lib/scheduler";

export interface AttemptInput {
  scheduler: Scheduler;
  now?: number;
  /** what you typed, if anything */
  answerText?: string | null;
  /** time from seeing the question to rating it */
  durationMs?: number;
  /** a practice session, or a sticky question on the desktop */
  place?: AttemptPlace;
  /** the AI's check of the typed answer, if it ran */
  aiScore?: number | null;
  aiFeedback?: string | null;
}

/** Apply a rating: reschedule the question and log the attempt. Returns the updated question. */
export async function recordAttempt(db: Db, question: Question, rating: Rating, input: AttemptInput): Promise<Question> {
  const now = input.now ?? Date.now();
  const next = input.scheduler.grade(question, rating, now);

  await db.execute(
    `UPDATE questions
        SET due = $1, stability = $2, difficulty = $3, elapsed_days = $4, scheduled_days = $5,
            learning_steps = $6, reps = $7, lapses = $8, state = $9, last_practised = $10, updated_at = $10
      WHERE id = $11`,
    [
      next.due,
      next.stability,
      next.difficulty,
      next.elapsedDays,
      next.scheduledDays,
      next.learningSteps,
      next.reps,
      next.lapses,
      next.state,
      now,
      question.id,
    ],
  );
  await db.execute(
    `INSERT INTO attempts (id, question_id, attempted_at, rating, answer_text, ai_score, ai_feedback,
                           duration_ms, place, state_before, stability_before, difficulty_before,
                           scheduled_days, due_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      newId(),
      question.id,
      now,
      rating,
      input.answerText?.trim() || null,
      input.aiScore ?? null,
      input.aiFeedback ?? null,
      Math.max(0, Math.round(input.durationMs ?? 0)),
      input.place ?? "practice",
      question.state,
      question.stability,
      question.difficulty,
      next.scheduledDays,
      next.due,
    ],
  );
  return { ...question, ...next, lastPractised: now, updatedAt: now };
}

interface AttemptRow {
  id: string;
  question_id: string;
  attempted_at: number;
  rating: Rating;
  answer_text: string | null;
  ai_score: number | null;
  ai_feedback: string | null;
  duration_ms: number;
  place: AttemptPlace;
  state_before: number;
  stability_before: number;
  difficulty_before: number;
  scheduled_days: number;
  due_after: number;
}

/** A question's attempts, newest first. */
export async function listAttempts(db: Db, questionId: string, limit = 200): Promise<Attempt[]> {
  const rows = await db.select<AttemptRow>(
    `SELECT * FROM attempts WHERE question_id = $1 ORDER BY attempted_at DESC LIMIT $2`,
    [questionId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    questionId: r.question_id,
    attemptedAt: r.attempted_at,
    rating: r.rating,
    answerText: r.answer_text,
    aiScore: r.ai_score,
    aiFeedback: r.ai_feedback,
    durationMs: r.duration_ms,
    place: r.place,
    stateBefore: r.state_before,
    stabilityBefore: r.stability_before,
    difficultyBefore: r.difficulty_before,
    scheduledDays: r.scheduled_days,
    dueAfter: r.due_after,
  }));
}

const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export interface PracticeStats {
  /** attempts since local midnight */
  practisedToday: number;
  /**
   * Of the questions you had already learned, the share you still remembered
   * when asked again in the last 30 days; null if there were none.
   */
  remembered30d: number | null;
  /** how many attempts that share is based on */
  rememberedSample: number;
}

export async function getPracticeStats(db: Db, now = Date.now()): Promise<PracticeStats> {
  const [today] = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM attempts WHERE attempted_at >= $1`, [
    startOfDay(now),
  ]);
  // state_before = 2: the question was in long-term memory (not still being learned)
  const [learned] = await db.select<{ total: number; passed: number | null }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN rating > 1 THEN 1 ELSE 0 END) AS passed
       FROM attempts
      WHERE attempted_at >= $1 AND state_before = 2`,
    [now - 30 * DAY],
  );
  const total = Number(learned.total);
  return {
    practisedToday: Number(today.n),
    remembered30d: total > 0 ? Number(learned.passed ?? 0) / total : null,
    rememberedSample: total,
  };
}

export interface Activity {
  /** one entry per local day, oldest first, ending today */
  days: { day: number; count: number }[];
  /** days in a row with at least one attempt, counting today or ending yesterday */
  streak: number;
}

/** Attempts per day for the last `span` days, and the current daily streak. */
export async function getActivity(db: Db, span = 28, now = Date.now()): Promise<Activity> {
  const today = startOfDay(now);
  const lookback = 400;
  const rows = await db.select<{ attempted_at: number }>(
    `SELECT attempted_at FROM attempts WHERE attempted_at >= $1`,
    [today - lookback * DAY],
  );
  const perDay = new Map<number, number>();
  for (const row of rows) {
    const day = startOfDay(row.attempted_at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  // Walk calendar days (not fixed 24h steps) so daylight-saving changes don't skew the buckets.
  const dayBefore = (day: number, n: number) => {
    const date = new Date(day);
    date.setDate(date.getDate() - n);
    return date.getTime();
  };

  const days: Activity["days"] = [];
  for (let i = span - 1; i >= 0; i--) {
    const day = dayBefore(today, i);
    days.push({ day, count: perDay.get(day) ?? 0 });
  }

  let streak = 0;
  let cursor = perDay.has(today) ? 0 : 1; // a streak survives until the end of today
  while (cursor < lookback && perDay.has(dayBefore(today, cursor))) {
    streak++;
    cursor++;
  }
  return { days, streak };
}

/**
 * How long you usually take to answer: the median of your last 50 timed
 * answers, so one long pause does not skew it. Null before the first answer.
 */
export async function typicalAnswerMs(db: Db): Promise<number | null> {
  const rows = await db.select<{ duration_ms: number }>(
    `SELECT duration_ms FROM attempts WHERE duration_ms > 0 ORDER BY attempted_at DESC LIMIT 50`,
  );
  if (rows.length === 0) return null;
  const sorted = rows.map((row) => Number(row.duration_ms)).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
