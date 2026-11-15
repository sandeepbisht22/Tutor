import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type Grade } from "ts-fsrs";
import type { Rating, Schedule } from "../domain/types";

/**
 * Thin wrapper around ts-fsrs (the FSRS spaced-repetition algorithm).
 * The rest of the app only sees `Schedule` objects with millisecond timestamps.
 */

export const RATINGS: Rating[] = [1, 2, 3, 4];
export const RATING_LABELS: Record<Rating, string> = { 1: "Forgot", 2: "Barely", 3: "Got it", 4: "Easily" };

export interface SchedulerOptions {
  /** target probability of remembering a question when it comes due (0.7–0.97) */
  retention?: number;
  /** small random spread on intervals so questions don't bunch up; off in tests */
  fuzz?: boolean;
}

export interface Scheduler {
  /** when the question would next be due for each possible rating */
  preview(schedule: Schedule, now: number): Record<Rating, number>;
  /** the question's new memory state after a rating */
  grade(schedule: Schedule, rating: Rating, now: number): Schedule;
}

export function newSchedule(now: number): Schedule {
  return fromFsrs(createEmptyCard(new Date(now)));
}

export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const engine = fsrs(
    generatorParameters({
      request_retention: options.retention ?? 0.9,
      enable_fuzz: options.fuzz ?? true,
    }),
  );
  return {
    preview(schedule, now) {
      const outcomes = engine.repeat(toFsrs(schedule), new Date(now));
      const due = {} as Record<Rating, number>;
      for (const rating of RATINGS) due[rating] = outcomes[rating as Grade].card.due.getTime();
      return due;
    },
    grade(schedule, rating, now) {
      return fromFsrs(engine.next(toFsrs(schedule), new Date(now), rating as Grade).card);
    },
  };
}

function toFsrs(s: Schedule): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.lastPractised === null ? undefined : new Date(s.lastPractised),
  };
}

function fromFsrs(c: FsrsCard): Schedule {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastPractised: c.last_review ? c.last_review.getTime() : null,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "10m", "3d", "1.4mo" — how far away a due time is. */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return "<1m";
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim(days / 30)}mo`;
  return `${trim(days / 365)}y`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
