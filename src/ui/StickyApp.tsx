import { Check, ChevronDown, ChevronUp, Clock, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Question, Rating } from "../domain/types";
import { formatInterval, RATING_LABELS, RATINGS } from "../lib/scheduler";
import { initialLastClosed, startOfTomorrow, stickyDue } from "../lib/sticky";
import { compactSticky, desktop, hideSticky, onEvent, showMainWindow, showSticky } from "../platform";
import { listReadyQuestions } from "../repo/questions";
import { useApp } from "./app";
import { Logo, QuestionImage } from "./bits";
import { useAnswerFlow, verdict } from "./useAnswerFlow";

/**
 * The sticky window: one question on a yellow note that sits on top of other
 * apps. It appears on its own, at the pace chosen in Settings, and goes away
 * when the question is answered, closed or snoozed.
 */
export function StickyApp() {
  const { db, settings, setSetting } = useApp();
  const [question, setQuestion] = useState<Question | null>(null);
  const [compact, setCompact] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const [farewell, setFarewell] = useState<string | null>(null);

  const lastClosed = useRef(initialLastClosed(Date.now(), settings.stickyEveryMinutes));
  const practising = useRef(false);
  const visible = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const close = useCallback(() => {
    visible.current = false;
    lastClosed.current = Date.now();
    setQuestion(null);
    setCompact(false);
    setSnoozing(false);
    setFarewell(null);
    void compactSticky(false).then(hideSticky);
  }, []);

  const tick = useCallback(async () => {
    const current = settingsRef.current;
    const due = stickyDue({
      now: Date.now(),
      enabled: current.stickyEnabled,
      pausedUntil: current.stickyPausedUntil,
      everyMinutes: current.stickyEveryMinutes,
      lastClosedAt: lastClosed.current,
      visible: visible.current,
      practising: practising.current,
    });
    if (!due) return;
    const [next] = await listReadyQuestions(db, { limit: 1 });
    if (!next || visible.current) return; // nothing ready: look again on the next tick
    visible.current = true;
    setQuestion(next);
    await showSticky();
  }, [db]);

  useEffect(() => {
    const stops = [
      onEvent("tutor://tick", () => void tick()),
      onEvent<boolean>("tutor://practising", (on) => {
        practising.current = on;
      }),
      onEvent<number>("tutor://pause-stickies", (minutes) => {
        void setSetting("stickyPausedUntil", Date.now() + minutes * 60_000);
        close();
      }),
    ];
    // The browser preview has no desktop shell to send ticks, so it shows a question right away.
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!desktop) {
      lastClosed.current = 0;
      void tick();
      timer = setInterval(() => void tick(), 5000);
    }
    return () => {
      stops.forEach((stop) => stop());
      clearInterval(timer);
    };
  }, [close, setSetting, tick]);

  // switched off or paused from Settings while a note is showing
  useEffect(() => {
    if (visible.current && (!settings.stickyEnabled || settings.stickyPausedUntil > Date.now())) close();
  }, [close, settings.stickyEnabled, settings.stickyPausedUntil]);

  const onRated = useCallback(
    (updated: Question, rating: Rating) => {
      setFarewell(`${RATING_LABELS[rating]}. Back in ${formatInterval(updated.due - Date.now())}.`);
      setTimeout(close, 1600);
    },
    [close],
  );
  const flow = useAnswerFlow(question ?? undefined, "sticky", onRated);

  const snooze = (until: number) => {
    void setSetting("stickyPausedUntil", until);
    close();
  };

  const toggleCompact = () => {
    setCompact((value) => {
      void compactSticky(!value);
      return !value;
    });
  };

  if (!question) return <div className="sticky is-empty" />;

  if (compact) {
    return (
      <div className="sticky is-compact" data-tauri-drag-region>
        <button className="sticky-open" onClick={toggleCompact}>
          <ChevronUp size={15} />A question is waiting
        </button>
        <button className="sticky-icon" aria-label="Close" title="Close" onClick={close}>
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="sticky">
      <header data-tauri-drag-region>
        <button className="sticky-brand" onClick={() => void showMainWindow()} title="Open Tutor">
          <Logo size={18} />
          Tutor
        </button>
        <span className="spacer" data-tauri-drag-region />
        <button className="sticky-icon" aria-label="Snooze" title="Not now" aria-expanded={snoozing} onClick={() => setSnoozing((on) => !on)}>
          <Clock size={15} />
        </button>
        <button className="sticky-icon" aria-label="Make smaller" title="Make smaller" onClick={toggleCompact}>
          <ChevronDown size={15} />
        </button>
        <button className="sticky-icon" aria-label="Close" title="Close until the next one" onClick={close}>
          <X size={15} />
        </button>
      </header>

      {snoozing ? (
        <div className="sticky-body">
          <p className="sticky-prompt">No questions for how long?</p>
          <div className="sticky-choices">
            <button onClick={() => snooze(Date.now() + 15 * 60_000)}>15 minutes</button>
            <button onClick={() => snooze(Date.now() + 60 * 60_000)}>1 hour</button>
            <button onClick={() => snooze(startOfTomorrow(Date.now()))}>Until tomorrow</button>
            <button onClick={() => setSnoozing(false)}>Back to the question</button>
          </div>
        </div>
      ) : farewell ? (
        <div className="sticky-body is-centered">
          <span className="done-mark is-small" aria-hidden="true">
            <Check size={18} strokeWidth={3} />
          </span>
          <p className="sticky-prompt">{farewell}</p>
        </div>
      ) : (
        <div className="sticky-body">
          {question.media && <QuestionImage media={question.media} revealed={flow.revealed} />}
          <p className="sticky-prompt">{question.prompt}</p>

          {!flow.revealed ? (
            <form
              className="sticky-answer"
              onSubmit={(event) => {
                event.preventDefault();
                flow.reveal();
              }}
            >
              <input
                aria-label="Your answer"
                placeholder="Type your answer, or just think it"
                value={flow.answer}
                onChange={(event) => flow.setAnswer(event.target.value)}
              />
              <button type="submit">Show answer</button>
            </form>
          ) : (
            <>
              <p className="sticky-answer-text">{question.answer}</p>
              {flow.check.state === "checking" && <p className="sticky-note">Checking your answer…</p>}
              {flow.check.state === "done" && (
                <p className="sticky-note">
                  <strong>{verdict(flow.check.result.score).text}.</strong> {flow.check.result.feedback}
                </p>
              )}
              {flow.error && <p className="sticky-note">{flow.error}</p>}
              <div className="sticky-rate" role="group" aria-label="How well did you remember it?">
                {RATINGS.map((rating) => (
                  <button
                    key={rating}
                    className={`rate-${rating}${flow.proposed === rating ? " is-proposed" : ""}`}
                    disabled={flow.busy}
                    title={`Back in ${flow.comesBack?.[rating] ?? ""}`}
                    onClick={() => void flow.rate(rating)}
                  >
                    <span className="rate-dot" aria-hidden="true" />
                    {RATING_LABELS[rating]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
