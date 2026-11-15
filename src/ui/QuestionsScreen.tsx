import { LayoutGrid, List as ListIcon, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Question, Rating, TopicNode } from "../domain/types";
import { RATING_LABELS } from "../lib/scheduler";
import { listAttempts } from "../repo/attempts";
import { acknowledgeSource, deleteQuestion, getQuestion, listQuestionsForTopics, setQuestionStatus, updateQuestionText } from "../repo/questions";
import { topicAndDescendantIds } from "../repo/topics";
import { useApp, useLoad } from "./app";
import { ago, Dialog, plural, QuestionForm, QuestionImage, questionState, questionTone } from "./bits";
import type { Go } from "./nav";
import { useStoredFlag } from "./hooks";
import { verdict } from "./useAnswerFlow";

type Filter = "all" | "ready" | "fresh" | "paused" | "flagged";

const FILTERS: { value: Filter; label: string; test(question: Question, now: number): boolean }[] = [
  { value: "all", label: "All", test: () => true },
  { value: "ready", label: "Ready now", test: (q, now) => questionTone(q, now) === "ready" },
  { value: "fresh", label: "Not practised yet", test: (q, now) => questionTone(q, now) === "fresh" },
  { value: "paused", label: "Paused", test: (q) => q.status === "paused" },
  { value: "flagged", label: "Source changed", test: (q) => q.sourceStatus === "changed" || q.sourceStatus === "removed" },
];

/** Every question in a topic (and its sub-topics), searchable. */
export function QuestionsScreen({ topic, go }: { topic: TopicNode; go: Go }) {
  const ids = useMemo(() => topicAndDescendantIds(topic), [topic]);
  const questions = useLoad((db) => listQuestionsForTopics(db, ids), [ids.join(",")]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [asCards, setAsCards] = useStoredFlag("tutor.questions-as-cards", false);

  const now = Date.now();
  const needle = search.trim().toLowerCase();
  const all = questions ?? [];
  const counts = new Map(FILTERS.map((entry) => [entry.value, all.filter((q) => entry.test(q, now)).length]));
  const test = FILTERS.find((entry) => entry.value === filter)?.test ?? (() => true);
  const shown = all.filter(
    (q) => test(q, now) && (needle === "" || q.prompt.toLowerCase().includes(needle) || q.answer.toLowerCase().includes(needle)),
  );

  return (
    <div className="page">
      <h1 className="page-title">Questions in {topic.name}</h1>
      <div className="search">
        <Search size={16} aria-hidden="true" />
        <input
          className="text-input"
          type="search"
          aria-label="Search questions"
          placeholder="Search questions and answers"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="list-tools">
      <div className="chips" role="group" aria-label="Show">
        {FILTERS.filter((entry) => entry.value === "all" || (counts.get(entry.value) ?? 0) > 0).map((entry) => (
          <button key={entry.value} className="chip" aria-pressed={filter === entry.value} onClick={() => setFilter(entry.value)}>
            {entry.label}
            <span className="chip-count">{counts.get(entry.value) ?? 0}</span>
          </button>
        ))}
      </div>
        <div className="view-switch" role="group" aria-label="View">
          <button className="icon-btn" aria-label="List" aria-pressed={!asCards} title="List" onClick={() => setAsCards(false)}>
            <ListIcon size={16} />
          </button>
          <button className="icon-btn" aria-label="Cards" aria-pressed={asCards} title="Cards" onClick={() => setAsCards(true)}>
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {questions && shown.length === 0 ? (
        <p className="empty-line">
          {needle || filter !== "all" ? "No question matches." : "This topic has no questions yet. They are made from its notes."}
        </p>
      ) : asCards ? (
        <ul className="q-tiles">
          {shown.map((question) => (
            <li key={question.id}>
              <button className="q-tile" onClick={() => setOpenId(question.id)}>
                <span className="q-tile-prompt">{question.prompt}</span>
                <span className="q-tile-answer">{question.answer}</span>
                <span className={`state-pill is-${questionTone(question, now)}`}>{questionState(question, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="rows">
          {shown.map((question) => (
            <li key={question.id}>
              <button className="row-link" onClick={() => setOpenId(question.id)}>
                <span className="row-main">
                  <span className="row-title">{question.prompt}</span>
                  <span className="row-sub is-preview">{question.answer}</span>
                </span>
                <span className={`state-pill is-${questionTone(question, now)}`}>{questionState(question, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openId && <QuestionDialog questionId={openId} go={go} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** One question in full: its answer, where it came from, and every attempt so far. */
export function QuestionDialog({ questionId, go, onClose }: { questionId: string; go: Go; onClose(): void }) {
  const { db, changed } = useApp();
  const question = useLoad((database) => getQuestion(database, questionId), [questionId]);
  const attempts = useLoad((database) => listAttempts(database, questionId), [questionId]);
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");

  const act = async (action: () => Promise<unknown>) => {
    await action();
    changed();
  };

  if (question === undefined) return null;
  if (question === null) {
    return (
      <Dialog label="Question" onClose={onClose}>
        <p>This question no longer exists.</p>
      </Dialog>
    );
  }

  const forgotten = (attempts ?? []).filter((a) => a.rating === 1).length;

  return (
    <Dialog label="Question" onClose={onClose} wide>
      {mode === "edit" ? (
        <QuestionForm
          initial={question}
          submitLabel="Save question"
          onCancel={() => setMode("view")}
          onSubmit={(prompt, answer) => act(() => updateQuestionText(db, question.id, { prompt, answer })).then(() => setMode("view"))}
        />
      ) : (
        <>
          {question.media && <QuestionImage media={question.media} revealed />}
          <h2 className="dialog-title">{question.prompt}</h2>
          <p className="dialog-answer">{question.answer}</p>
        </>
      )}

      <p className="muted">
        <span className={`state-pill is-${questionTone(question)}`}>{questionState(question)}</span>
        {question.noteTitle !== null && (
          <>
            {" "}
            From the note{" "}
            <button
              className="link"
              onClick={() => question.noteId && go({ name: "note", noteId: question.noteId, topicId: question.topicId })}
            >
              {question.noteTitle.trim() || "Untitled note"}
            </button>
            .
          </>
        )}
      </p>
      {question.sourceText && question.origin !== "cover" && <blockquote className="source-quote">{question.sourceText}</blockquote>}
      {(question.sourceStatus === "changed" || question.sourceStatus === "removed") && (
        <div className="source-flag">
          <span>
            {question.sourceStatus === "changed" ? "The paragraph this came from has changed." : "The paragraph this came from was deleted."}
          </span>
          <button className="btn-quiet" onClick={() => act(() => acknowledgeSource(db, question.id))}>
            Question is still right
          </button>
        </div>
      )}

      {mode === "delete" ? (
        <div className="confirm">
          <p>Delete this question and its history?</p>
          <div className="row">
            <button className="btn-danger" onClick={() => act(() => deleteQuestion(db, question.id)).then(onClose)}>
              Delete question
            </button>
            <button className="btn-quiet" onClick={() => setMode("view")}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        mode === "view" && (
          <div className="row">
            {question.origin !== "cover" && (
              <button className="btn" onClick={() => setMode("edit")}>
                Edit
              </button>
            )}
            <button
              className="btn"
              onClick={() => act(() => setQuestionStatus(db, question.id, question.status === "paused" ? "active" : "paused"))}
            >
              {question.status === "paused" ? "Ask this again" : "Stop asking for now"}
            </button>
            {question.origin !== "cover" && (
              <button className="btn-quiet is-danger" onClick={() => setMode("delete")}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button className="btn-quiet" onClick={onClose}>
              Close
            </button>
          </div>
        )
      )}

      <h3 className="dialog-section">Your answers so far</h3>
      {attempts && attempts.length === 0 ? (
        <p className="muted">You have not been asked this yet.</p>
      ) : (
        <>
          <p className="muted">
            Asked {plural(attempts?.length ?? 0, "time")}, forgotten {plural(forgotten, "time")}.
          </p>
          <table className="history">
            <thead>
              <tr>
                <th>When</th>
                <th>How it went</th>
                <th>What you wrote</th>
              </tr>
            </thead>
            <tbody>
              {attempts?.map((attempt) => (
                <tr key={attempt.id}>
                  <td>
                    {ago(attempt.attemptedAt)}
                    <span className="muted"> {attempt.place === "sticky" ? "on a sticky note" : "in practice"}</span>
                  </td>
                  <td>
                    <RatingMark rating={attempt.rating} />
                  </td>
                  <td>
                    {attempt.answerText ?? <span className="muted">Nothing typed</span>}
                    {attempt.aiScore !== null && (
                      <span className="muted">
                        {" "}
                        ({verdict(attempt.aiScore).text.toLowerCase()}
                        {attempt.aiFeedback ? `: ${attempt.aiFeedback}` : ""})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Dialog>
  );
}

export function RatingMark({ rating }: { rating: Rating }) {
  return <span className={`rating-mark rating-${rating}`}>{RATING_LABELS[rating]}</span>;
}

export type { Question };
