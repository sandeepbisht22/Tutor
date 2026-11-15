import { Check, Pause, Pencil, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { figureMedia } from "../ai/suggest";
import type { DocNode, Question } from "../domain/types";
import {
  acceptAllSuggestions,
  acceptSuggestion,
  acknowledgeSource,
  createQuestion,
  deleteQuestion,
  listQuestionsForNote,
  setQuestionStatus,
  updateQuestionText,
} from "../repo/questions";
import { errorText, useApp, useLoad } from "./app";
import { QuestionForm, QuestionImage, questionState, questionTone } from "./bits";
import type { CurrentBlock } from "./blockId";
import { useQueueState } from "./queue";

interface Props {
  noteId: string;
  topicId: string;
  /** changes after every note save, so "source changed" flags refresh */
  savedAt: number;
  getCurrentBlock(): CurrentBlock | null;
  getDoc(): DocNode;
  flushNote(): Promise<void>;
  onSuggest(): void;
  /** above 0: open the form for a new question about the paragraph the cursor is in */
  askToken: number;
  onAskHandled(): void;
}

type Form = { mode: "new"; source: CurrentBlock | null; linked: boolean } | { mode: "edit"; id: string } | null;

/** The panel beside a note: the questions made from it, and the AI's suggestions. */
export function NoteQuestions({ noteId, topicId, savedAt, getCurrentBlock, getDoc, flushNote, onSuggest, askToken, onAskHandled }: Props) {
  const { db, settings, getProvider, changed } = useApp();
  const questions = useLoad((database) => listQuestionsForNote(database, noteId), [noteId, savedAt]) ?? [];
  const [form, setForm] = useState<Form>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const queue = useQueueState();

  useEffect(() => {
    let active = true;
    void getProvider().then((provider) => active && setAiReady(provider !== null));
    return () => {
      active = false;
    };
  }, [getProvider, settings.aiMode, settings.cloudModel, settings.localModel]);

  // "/question" in the editor: start a question linked to the paragraph being written
  useEffect(() => {
    if (askToken === 0) return;
    const source = getCurrentBlock();
    setForm({ mode: "new", source, linked: source !== null });
    onAskHandled();
  }, [askToken, getCurrentBlock, onAskHandled]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      changed();
    } catch (problem) {
      setError(errorText(problem));
    }
  };

  const suggestions = questions.filter((q) => q.status === "suggested");
  const kept = questions.filter((q) => q.status !== "suggested");
  const working = queue.running === noteId || queue.waiting.includes(noteId);

  return (
    <aside className="note-questions" aria-label="Questions from this note">
      <header className="panel-head">
        <h2>Questions from this note</h2>
        {kept.length > 0 && <span className="panel-count">{kept.length}</span>}
      </header>

      <div className="row">
        <button
          className="btn"
          onClick={() => {
            const source = getCurrentBlock();
            setForm({ mode: "new", source, linked: source !== null });
          }}
        >
          <Plus size={14} />
          Write a question
        </button>
        {aiReady && (
          <button className="btn" onClick={onSuggest} disabled={working}>
            {working ? <span className="pulse" aria-hidden="true" /> : <Sparkles size={14} />}
            {working ? "Writing…" : "Suggest some"}
          </button>
        )}
      </div>
      {aiReady === false && settings.aiMode !== "off" && (
        <p className="hint">Set up an AI model in Settings and Tutor will suggest questions from what you write.</p>
      )}
      {queue.lastError && !working && <p className="form-error">The AI model did not answer: {queue.lastError}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {form?.mode === "new" && (
        <QuestionForm
          submitLabel="Add question"
          onCancel={() => setForm(null)}
          note={
            form.source && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.linked}
                  onChange={(event) => setForm({ ...form, linked: event.target.checked })}
                />
                <span>
                  {form.source.type === "figure"
                    ? "Show the selected image with this question"
                    : `Link to the paragraph “${shorten(form.source.text, 60)}”`}
                </span>
              </label>
            )
          }
          onSubmit={(prompt, answer) =>
            run(async () => {
              const source = form.linked ? form.source : null;
              // save the note first so the linked paragraph exists in the database
              await flushNote();
              await createQuestion(db, {
                topicId,
                noteId,
                prompt,
                answer,
                sourceBlockId: source?.id,
                sourceHash: source?.hash,
                media: source?.type === "figure" ? figureMedia(getDoc(), source.id) : null,
              });
              setForm(null);
            })
          }
        />
      )}

      {suggestions.length > 0 && (
        <section className="suggested-block">
          <div className="section-line">
            <h3>
              <Sparkles size={13} aria-hidden="true" />
              Suggested by Tutor
            </h3>
            {suggestions.length > 1 && (
              <button className="btn-quiet" onClick={() => run(() => acceptAllSuggestions(db, noteId))}>
                Keep all {suggestions.length}
              </button>
            )}
          </div>
          <ul>
            {suggestions.map((question) => (
              <li key={question.id} className="q-card is-suggested">
                <QuestionText question={question} />
                <div className="q-actions">
                  <button className="btn-keep" onClick={() => run(() => acceptSuggestion(db, question.id))}>
                    <Check size={14} />
                    Keep
                  </button>
                  <button className="btn-quiet" onClick={() => setForm({ mode: "edit", id: question.id })}>
                    Edit
                  </button>
                  <button className="btn-quiet" onClick={() => run(() => deleteQuestion(db, question.id))}>
                    <X size={14} />
                    Dismiss
                  </button>
                </div>
                {form?.mode === "edit" && form.id === question.id && (
                  <QuestionForm
                    initial={question}
                    submitLabel="Save and keep"
                    onCancel={() => setForm(null)}
                    onSubmit={(prompt, answer) =>
                      run(async () => {
                        await updateQuestionText(db, question.id, { prompt, answer });
                        await acceptSuggestion(db, question.id);
                        setForm(null);
                      })
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {kept.length === 0 && suggestions.length === 0 && form === null && !working && (
        <p className="hint">
          No questions yet. Put the cursor in a paragraph and choose “Write a question” to link the question to it.
        </p>
      )}

      <ul>
        {kept.map((question) =>
          form?.mode === "edit" && form.id === question.id ? (
            <li key={question.id}>
              <QuestionForm
                initial={question}
                submitLabel="Save question"
                onCancel={() => setForm(null)}
                onSubmit={(prompt, answer) =>
                  run(async () => {
                    await updateQuestionText(db, question.id, { prompt, answer });
                    setForm(null);
                  })
                }
              />
            </li>
          ) : (
            <li key={question.id} className={`q-card${question.status === "paused" ? " is-paused" : ""}`}>
              <QuestionText question={question} />
              {(question.sourceStatus === "changed" || question.sourceStatus === "removed") && (
                <div className="source-flag">
                  <span>
                    {question.sourceStatus === "changed"
                      ? "The paragraph this came from has changed."
                      : "The paragraph this came from was deleted."}
                  </span>
                  <button className="btn-quiet" onClick={() => run(() => acknowledgeSource(db, question.id))}>
                    Question is still right
                  </button>
                </div>
              )}
              <div className="q-foot">
                <span className={`state-pill is-${question.origin === "cover" ? "cover" : questionTone(question)}`}>
                  {question.origin === "cover" ? "From an image cover" : questionState(question)}
                </span>
                <span className="q-icons">
                  {question.origin !== "cover" && (
                    <button aria-label="Edit question" title="Edit" onClick={() => setForm({ mode: "edit", id: question.id })}>
                      <Pencil size={13} />
                    </button>
                  )}
                  {question.status === "paused" ? (
                    <button aria-label="Resume question" title="Ask this again" onClick={() => run(() => setQuestionStatus(db, question.id, "active"))}>
                      <Play size={13} />
                    </button>
                  ) : (
                    <button aria-label="Pause question" title="Stop asking this for now" onClick={() => run(() => setQuestionStatus(db, question.id, "paused"))}>
                      <Pause size={13} />
                    </button>
                  )}
                  {question.origin !== "cover" && (
                    <button aria-label="Delete question" title="Delete" onClick={() => run(() => deleteQuestion(db, question.id))}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>
            </li>
          ),
        )}
      </ul>
    </aside>
  );
}

export function QuestionText({ question }: { question: Question }) {
  return (
    <>
      {question.media && <QuestionImage media={question.media} revealed />}
      <p className="q-prompt">{question.prompt}</p>
      <p className="q-answer">{question.answer}</p>
    </>
  );
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
