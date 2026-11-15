import { ArrowLeft, Check, CornerDownLeft, Flame } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Question, Rating, TopicNode } from "../domain/types";
import { topicTagColor } from "../lib/colors";
import { formatInterval, RATING_LABELS, RATINGS } from "../lib/scheduler";
import { emitEvent } from "../platform";
import { getActivity } from "../repo/attempts";
import { listReadyQuestions, nextReadyAt } from "../repo/questions";
import { findTopic } from "../repo/topics";
import { useApp, useLoad } from "./app";
import { ago, Kbd, plural, QuestionImage, TagDot } from "./bits";
import type { Go } from "./nav";
import { useAnswerFlow, verdict } from "./useAnswerFlow";

interface Props {
  tree: TopicNode[];
  title: string;
  /** undefined = every topic */
  topicIds: string[] | undefined;
  go: Go;
  onFinish(): void;
}

/** A question answered now that comes back within this window is asked again in the same session. */
const SAME_SESSION_MS = 20 * 60_000;
/** The ruled lines on the card, in px; the typed answer grows a line at a time. */
const LINE = 34;

type Tally = Record<Rating, number>;
const NO_TALLY: Tally = { 1: 0, 2: 0, 3: 0, 4: 0 };

/** The card that was just rated, drawn on its way out while the next one is already in place. */
interface Leaving {
  key: string;
  question: Question;
  answer: string;
  /** back under the deck when it returns this session, away when it does not */
  to: "back" | "away";
}

export function PracticeScreen({ tree, title, topicIds, go, onFinish }: Props) {
  const { db } = useApp();
  const [queue, setQueue] = useState<Question[] | null>(null);
  const [tally, setTally] = useState<Tally>(NO_TALLY);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  // the card that was uncovered by a leaving card: it is already in place, so it is not dealt in afterwards
  const [uncovered, setUncovered] = useState("");
  const [loadError, setLoadError] = useState(false);
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const typed = useRef("");
  const done = RATINGS.reduce((sum, rating) => sum + tally[rating], 0);

  useEffect(() => {
    let active = true;
    listReadyQuestions(db, { topicIds })
      .then((questions) => active && setQueue(questions))
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [db, topicIds]);

  // sticky questions stay away while a session is open
  useEffect(() => {
    void emitEvent("tutor://practising", true);
    return () => void emitEvent("tutor://practising", false);
  }, []);

  const question = queue?.[0];
  const onRated = useCallback((updated: Question, rating: Rating) => {
    const comesBack = updated.due - Date.now() <= SAME_SESSION_MS;
    setLeaving({ key: `${updated.id}:${updated.reps}`, question: updated, answer: typed.current, to: comesBack ? "back" : "away" });
    setQueue((current) => {
      if (!current) return current;
      const rest = current.slice(1);
      return comesBack ? [...rest, updated] : rest;
    });
    setTally((current) => ({ ...current, [rating]: current[rating] + 1 }));
  }, []);
  const flow = useAnswerFlow(question, "practice", onRated);
  const { answer, revealed, reveal, rate } = flow;
  typed.current = answer;

  const key = question ? `${question.id}:${question.reps}` : "";
  useEffect(() => {
    answerBox.current?.focus();
  }, [key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
      if (event.key === "Escape") {
        onFinish();
        return;
      }
      if (!question) return;
      if (!revealed) {
        // Enter always shows the answer (Shift+Enter makes a new line).
        // Space does too, unless it is part of an answer being typed.
        const enter = event.key === "Enter" && !event.shiftKey;
        const space = event.key === " " && (!typing || answer.trim() === "");
        if (enter || space) {
          event.preventDefault();
          answerBox.current?.blur();
          reveal();
        }
        return;
      }
      if (!typing && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        void rate(Number(event.key) as Rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, onFinish, question, rate, reveal, revealed]);

  const onType = (event: ChangeEvent<HTMLTextAreaElement>) => {
    flow.setAnswer(event.target.value);
    // grow one ruled line at a time, so the writing stays on the lines
    const box = event.target;
    box.style.height = "auto";
    box.style.height = `${Math.max(2, Math.ceil(box.scrollHeight / LINE)) * LINE}px`;
  };

  const remaining = queue?.length ?? 0;
  const total = done + remaining;
  const progress = total === 0 ? 0 : done / total;
  const behind = Math.min(Math.max(remaining - 1, 0), 3);
  const topicOf = (q: Question) => ({ name: findTopic(tree, q.topicId)?.name ?? "", color: topicTagColor(tree, q.topicId) });

  return (
    <div className="practice">
      <header className="practice-head">
        <button className="btn-quiet practice-exit" onClick={onFinish}>
          <ArrowLeft size={16} />
          Finish
          <Kbd>Esc</Kbd>
        </button>
        <div className="practice-title">
          <h1>{title}</h1>
          <p>{queue === null ? "Loading…" : remaining === 0 ? `${done} answered` : `${plural(remaining, "question")} to go`}</p>
        </div>
        <span className="practice-count">{question ? `${done + 1} of ${total}` : ""}</span>
      </header>
      <div
        className="practice-progress"
        role="progressbar"
        aria-label="Session progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      {(loadError || flow.error) && (
        <p className="form-error practice-error" role="alert">
          {loadError ? "The questions could not be loaded." : flow.error}
        </p>
      )}

      {queue !== null && !question && <SessionEnd done={done} tally={tally} onFinish={onFinish} />}

      {question && (
        <div className="practice-stage">
          <div className="card-stack" aria-live="polite">
            {Array.from({ length: behind }, (_, index) => (
              <span key={index} className={`deck-under is-${index + 1}`} aria-hidden="true" />
            ))}
            <article key={key} className={`index-card${leaving || uncovered === key ? "" : " is-dealt"}`}>
              <CardHead name={topicOf(question).name} color={topicOf(question).color} fresh={question.state === 0} />
              {question.media && <QuestionImage media={question.media} revealed={revealed} />}
              <p className="index-front">{question.prompt}</p>
              {!revealed ? (
                <textarea
                  ref={answerBox}
                  className="index-write"
                  aria-label="Your answer"
                  rows={2}
                  value={answer}
                  onChange={onType}
                  placeholder="Write what you remember, or just think it"
                />
              ) : (
                <>
                  {answer.trim() !== "" && <p className="index-yours">{answer}</p>}
                  <p className="index-back">{question.answer}</p>
                </>
              )}
            </article>
            {leaving && (
              <article
                key={`leaving:${leaving.key}`}
                className={`index-card is-leaving is-${leaving.to}`}
                aria-hidden="true"
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget) return;
                  setUncovered(key);
                  setLeaving(null);
                }}
              >
                <CardHead name={topicOf(leaving.question).name} color={topicOf(leaving.question).color} fresh={false} />
                <p className="index-front">{leaving.question.prompt}</p>
                {leaving.answer.trim() !== "" && <p className="index-yours">{leaving.answer}</p>}
                <p className="index-back">{leaving.question.answer}</p>
              </article>
            )}
          </div>

          {revealed && (
            <div className="practice-notes">
              {flow.check.state === "checking" && (
                <p className="checking">
                  <span className="pulse" aria-hidden="true" />
                  Checking your answer…
                </p>
              )}
              {flow.check.state === "failed" && <p className="muted">Your answer could not be checked this time.</p>}
              {flow.check.state === "done" && (
                <p className={`verdict is-${verdict(flow.check.result.score).tone}`}>
                  <strong>{verdict(flow.check.result.score).text}.</strong> {flow.check.result.feedback}
                </p>
              )}
              {question.sourceText && question.origin !== "cover" && (
                <details className="from-notes">
                  <summary>From your notes</summary>
                  <blockquote className="source-quote">{question.sourceText}</blockquote>
                  {question.noteId && (
                    <button
                      className="btn-quiet"
                      onClick={() => go({ name: "note", noteId: question.noteId as string, topicId: question.topicId })}
                    >
                      Open the note
                    </button>
                  )}
                </details>
              )}
              {flow.lastAttempt && (
                <p className="muted last-time">
                  Last time, {ago(flow.lastAttempt.attemptedAt)}: {RATING_LABELS[flow.lastAttempt.rating].toLowerCase()}
                  {flow.lastAttempt.answerText ? `. You wrote “${flow.lastAttempt.answerText}”.` : "."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {question && (
        <div className={`answer-island${revealed ? " is-rating" : ""}`} role="group" aria-label={revealed ? "How well did you remember it?" : "Answer"}>
          {!revealed ? (
            <button className="island-reveal" onClick={reveal}>
              Show answer
              <span className="island-keys" aria-hidden="true">
                <CornerDownLeft size={14} />
              </span>
            </button>
          ) : (
            RATINGS.map((rating) => (
              <button
                key={rating}
                className={`rate rate-${rating}${flow.proposed === rating ? " is-proposed" : ""}`}
                disabled={flow.busy}
                onClick={() => void rate(rating)}
              >
                <span className="rate-top">
                  <span className="rate-dot" aria-hidden="true" />
                  <span className="rate-label">{RATING_LABELS[rating]}</span>
                  <Kbd>{rating}</Kbd>
                </span>
                <span className="rate-interval">back in {flow.comesBack?.[rating]}</span>
                {flow.proposed === rating && <span className="rate-proposed">Tutor's guess</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** The top line of a card, above the red rule: where the question comes from. */
function CardHead({ name, color, fresh }: { name: string; color: ReturnType<typeof topicTagColor>; fresh: boolean }) {
  return (
    <div className="index-head">
      <span className="index-topic">
        <TagDot color={color} />
        {name}
      </span>
      {fresh && <span className="index-new">New</span>}
    </div>
  );
}

/** The end of a session: how it went, the streak, and when the next question comes back. */
function SessionEnd({ done, tally, onFinish }: { done: number; tally: Tally; onFinish(): void }) {
  const next = useLoad((db) => nextReadyAt(db), []);
  const activity = useLoad((db) => getActivity(db, 7), []);
  const remembered = tally[2] + tally[3] + tally[4];
  return (
    <div className={`practice-done${done > 0 ? " is-finished" : ""}`}>
      {done > 0 && (
        <span className="done-mark" aria-hidden="true">
          <Check size={26} strokeWidth={2.75} />
        </span>
      )}
      <h2>{done === 0 ? "Nothing is ready here" : "That is everything for now"}</h2>
      <p className="done-lead">
        {done === 0
          ? "Questions come back when you are about to forget them. Write more notes, or look again later."
          : `You answered ${plural(done, "question")} and remembered ${remembered} of them. Each one comes back when you are about to forget it.`}
      </p>

      {done > 0 && (
        <div className="tally">
          <div className="tally-bar" role="img" aria-label={RATINGS.map((r) => `${tally[r]} ${RATING_LABELS[r].toLowerCase()}`).join(", ")}>
            {RATINGS.map((rating) => tally[rating] > 0 && <span key={rating} className={`is-${rating}`} style={{ flexGrow: tally[rating] }} />)}
          </div>
          <ul className="tally-legend">
            {RATINGS.map((rating) => (
              <li key={rating}>
                <span className={`swatch is-rate-${rating}`} />
                {RATING_LABELS[rating]}
                <strong>{tally[rating]}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done > 0 && activity && activity.streak > 0 && (
        <p className="done-streak">
          <Flame size={15} aria-hidden="true" />
          {plural(activity.streak, "day")} in a row
        </p>
      )}
      {next && <p className="muted">The next question comes back in {formatInterval(next - Date.now())}.</p>}
      <button className="btn-primary is-large" autoFocus onClick={onFinish}>
        Done
      </button>
    </div>
  );
}
