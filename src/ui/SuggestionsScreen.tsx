import { Check, FileText, X } from "lucide-react";
import { useState } from "react";
import type { Question } from "../domain/types";
import { acceptAllSuggestions, acceptSuggestion, deleteQuestion, listSuggestions, updateQuestionText } from "../repo/questions";
import { useApp, useLoad } from "./app";
import { plural, QuestionForm } from "./bits";
import type { Go } from "./nav";
import { QuestionText } from "./NoteQuestions";

/** Every question the AI has suggested and you have not decided on yet. */
export function SuggestionsScreen({ go }: { go: Go }) {
  const { db, changed } = useApp();
  const suggestions = useLoad((database) => listSuggestions(database), []);
  const [editing, setEditing] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    await action();
    changed();
  };

  if (!suggestions) return null;
  if (suggestions.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Suggested questions</h1>
        <p className="empty-line">Nothing waiting. When Tutor writes questions from your notes, they show up here for you to keep or dismiss.</p>
        <button className="btn" onClick={() => go({ name: "home" })}>
          Back to topics
        </button>
      </div>
    );
  }

  // one group per note, in the order the query returns them
  const groups: { noteId: string | null; title: string; topicId: string; items: Question[] }[] = [];
  for (const question of suggestions) {
    const last = groups[groups.length - 1];
    if (last && last.noteId === question.noteId) last.items.push(question);
    else groups.push({ noteId: question.noteId, title: question.noteTitle?.trim() || "Untitled note", topicId: question.topicId, items: [question] });
  }

  return (
    <div className="page">
      <h1 className="page-title">Suggested questions</h1>
      <div className="row suggestions-intro">
        <p className="lead">Tutor wrote these from your notes. Keep the good ones; they join your practice straight away.</p>
        <span className="spacer" />
        <button className="btn-primary" onClick={() => act(() => acceptAllSuggestions(db))}>
          <Check size={15} />
          Keep all {suggestions.length}
        </button>
      </div>

      {groups.map((group) => (
        <section key={group.noteId ?? "none"} className="suggestion-group">
          <div className="section-head">
            <h2 className="group-title">
              <FileText size={16} aria-hidden="true" />
              {group.title}
            </h2>
            {group.noteId && (
              <button className="btn-quiet" onClick={() => go({ name: "note", noteId: group.noteId as string, topicId: group.topicId })}>
                Open note
              </button>
            )}
          </div>
          <ul className="suggestion-list">
            {group.items.map((question) => (
              <li key={question.id} className="q-card is-suggested">
                {editing === question.id ? (
                  <QuestionForm
                    initial={question}
                    submitLabel="Save and keep"
                    onCancel={() => setEditing(null)}
                    onSubmit={(prompt, answer) =>
                      act(async () => {
                        await updateQuestionText(db, question.id, { prompt, answer });
                        await acceptSuggestion(db, question.id);
                        setEditing(null);
                      })
                    }
                  />
                ) : (
                  <>
                    <QuestionText question={question} />
                    {question.sourceText && question.kind === "text" && (
                      <blockquote className="source-quote">{question.sourceText}</blockquote>
                    )}
                    <div className="q-actions">
                      <button className="btn-keep" onClick={() => act(() => acceptSuggestion(db, question.id))}>
                        <Check size={14} />
                        Keep
                      </button>
                      <button className="btn-quiet" onClick={() => setEditing(question.id)}>
                        Edit
                      </button>
                      <button className="btn-quiet" onClick={() => act(() => deleteQuestion(db, question.id))}>
                        <X size={14} />
                        Dismiss
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">{plural(group.items.length, "suggestion")} from this note.</p>
        </section>
      ))}
    </div>
  );
}
