import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkAnswer, quickCheck, ratingForScore, type AnswerCheck } from "../ai/grade";
import type { Attempt, AttemptPlace, Question, Rating } from "../domain/types";
import { formatInterval, RATINGS } from "../lib/scheduler";
import { listAttempts, recordAttempt } from "../repo/attempts";
import { useApp } from "./app";

export type CheckState =
  | { state: "none" }
  | { state: "checking" }
  | { state: "done"; result: AnswerCheck }
  | { state: "failed" };

/**
 * Everything that happens around one question: typing an answer, showing the
 * real one, having the AI check what was typed, and saving a rating.
 * Shared by the practice screen and the sticky window.
 */
export function useAnswerFlow(
  question: Question | undefined,
  place: AttemptPlace,
  onRated: (updated: Question, rating: Rating) => void,
) {
  const { db, settings, scheduler, getProvider, changed } = useApp();
  // a question that comes round again in the same session counts as a new showing
  const key = question ? `${question.id}:${question.reps}` : "";
  const keyRef = useRef(key);
  keyRef.current = key;

  // What was typed and whether the answer shows belong to one showing, so the
  // next question starts blank in the very render it appears (never with the
  // previous card's "revealed" state, which would flash its answer).
  const [draft, setDraft] = useState({ key: "", text: "" });
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const answer = draft.key === key ? draft.text : "";
  const revealed = revealedKey === key && key !== "";
  const setAnswer = useCallback((text: string) => setDraft({ key: keyRef.current, text }), []);
  const [check, setCheck] = useState<CheckState>({ state: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<Attempt | null>(null);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    shownAt.current = Date.now();
    setCheck({ state: "none" });
    setError(null);
    setLastAttempt(null);
    if (!question) return;
    let active = true;
    void listAttempts(db, question.id, 1).then((attempts) => active && setLastAttempt(attempts[0] ?? null));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, db]);

  const reveal = useCallback(() => {
    if (!question || revealed) return;
    setRevealedKey(key);
    if (answer.trim() === "" || !settings.checkAnswers) return;

    const input = { prompt: question.prompt, expected: question.answer, answer };
    const quick = quickCheck(answer, question.answer);
    if (quick) {
      setCheck({ state: "done", result: quick });
      return;
    }
    const startedFor = keyRef.current;
    setCheck({ state: "checking" });
    void getProvider()
      .then((provider) => (provider ? checkAnswer(provider, input) : null))
      .then((result) => {
        if (keyRef.current !== startedFor) return;
        setCheck(result ? { state: "done", result } : { state: "none" });
      })
      .catch(() => keyRef.current === startedFor && setCheck({ state: "failed" }));
  }, [answer, getProvider, key, question, revealed, settings.checkAnswers]);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!question || busy) return;
      setBusy(true);
      try {
        const now = Date.now();
        const result = check.state === "done" ? check.result : null;
        const updated = await recordAttempt(db, question, rating, {
          scheduler,
          now,
          answerText: answer,
          durationMs: now - shownAt.current,
          place,
          aiScore: result?.score ?? null,
          aiFeedback: result?.feedback || null,
        });
        changed();
        onRated(updated, rating);
      } catch {
        setError("That could not be saved. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [answer, busy, changed, check, db, onRated, place, question, scheduler],
  );

  /** for each rating, how long until the question comes back */
  const comesBack = useMemo(() => {
    if (!question || !revealed) return null;
    const now = Date.now();
    const due = scheduler.preview(question, now);
    return Object.fromEntries(RATINGS.map((r) => [r, formatInterval(due[r] - now)])) as Record<Rating, string>;
  }, [question, revealed, scheduler]);

  const proposed: Rating | null = check.state === "done" ? ratingForScore(check.result.score) : null;

  return { answer, setAnswer, revealed, reveal, check, proposed, rate, busy, error, comesBack, lastAttempt };
}

/** "Right", "Partly right" or "Not quite" for an AI score. */
export function verdict(score: number): { text: string; tone: "good" | "partly" | "wrong" } {
  if (score >= 0.7) return { text: "Right", tone: "good" };
  return score >= 0.35 ? { text: "Partly right", tone: "partly" } : { text: "Not quite", tone: "wrong" };
}
