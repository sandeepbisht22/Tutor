/**
 * Tutor's vocabulary:
 *   Topic     a subject you are learning; topics can hold sub-topics
 *   Note      what you wrote about a topic
 *   Question  something Tutor asks you, made from a note (by you or by the AI)
 *   Attempt   one time you answered a question
 */

export interface Topic {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface TopicCounts {
  notes: number;
  /** questions you practise (suggestions not counted) */
  total: number;
  /** active questions ready to practise now */
  ready: number;
  /** active questions never practised */
  fresh: number;
  /** active questions whose memory is expected to last three weeks or more */
  strong: number;
  /** AI suggestions waiting for a decision */
  suggested: number;
}

export interface TopicNode extends Topic {
  depth: number;
  children: TopicNode[];
  /** counts for this topic plus all of its sub-topics */
  counts: TopicCounts;
}

/** TipTap / ProseMirror JSON */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface NoteBlock {
  id: string;
  position: number;
  type: string;
  text: string;
  hash: string;
}

export interface Note {
  id: string;
  topicId: string;
  title: string;
  doc: DocNode;
  text: string;
  createdAt: number;
  updatedAt: number;
}

/** Just enough of a note to find and open it. */
export interface NoteRef {
  id: string;
  topicId: string;
  title: string;
  updatedAt: number;
}

export interface NoteSummary {
  id: string;
  topicId: string;
  title: string;
  preview: string;
  updatedAt: number;
  questionCount: number;
}

/**
 * Something drawn on top of an image. Positions and sizes are fractions of the
 * image (0–1), so they hold at any display size.
 *   text   a label at (x, y)
 *   box    an outlined rectangle
 *   arrow  from (x, y) to (x + w, y + h)
 *   cover  a filled rectangle hiding part of the image; `text` is what it hides
 */
export type AnnotationKind = "text" | "box" | "arrow" | "cover";

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface StoredImage {
  id: string;
  mime: string;
  /** base64 */
  data: string;
  width: number;
  height: number;
}

/** The image shown with a question: a snapshot taken when the question was made. */
export interface QuestionMedia {
  imageId: string;
  width: number;
  height: number;
  annotations: Annotation[];
  /** the cover that stays closed until the answer is shown */
  coverId?: string;
}

export type QuestionStatus = "suggested" | "active" | "paused";
/** who made it: you, the AI, or a cover you drew on an image */
export type QuestionOrigin = "manual" | "ai" | "cover";
export type QuestionKind = "text" | "image";
/** Is the note text a question was made from still the same? */
export type SourceStatus = "none" | "ok" | "changed" | "removed";

/** FSRS memory state of a question. Times are epoch milliseconds. */
export interface Schedule {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 never practised, 1 learning, 2 long-term, 3 relearning */
  state: number;
  lastPractised: number | null;
}

export interface Question extends Schedule {
  id: string;
  topicId: string;
  noteId: string | null;
  noteTitle: string | null;
  sourceBlockId: string | null;
  sourceHash: string | null;
  sourceStatus: SourceStatus;
  /** the source paragraph as it reads now */
  sourceText: string | null;
  kind: QuestionKind;
  prompt: string;
  answer: string;
  media: QuestionMedia | null;
  status: QuestionStatus;
  origin: QuestionOrigin;
  createdAt: number;
  updatedAt: number;
}

export type AttemptPlace = "practice" | "sticky";
/** 1 Forgot, 2 Barely, 3 Got it, 4 Easily */
export type Rating = 1 | 2 | 3 | 4;

export interface Attempt {
  id: string;
  questionId: string;
  attemptedAt: number;
  rating: Rating;
  answerText: string | null;
  /** 0–1, how right the typed answer was according to the AI */
  aiScore: number | null;
  aiFeedback: string | null;
  durationMs: number;
  place: AttemptPlace;
  stateBefore: number;
  stabilityBefore: number;
  difficultyBefore: number;
  scheduledDays: number;
  dueAfter: number;
}
