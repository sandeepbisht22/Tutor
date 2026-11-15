import { ArrowRight, ListChecks, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TopicNode } from "../domain/types";
import { listNotes } from "../repo/notes";
import { topicTagColor } from "../lib/colors";
import { topicAndDescendantIds } from "../repo/topics";
import { useLoad } from "./app";
import { ago, InlineInput, MasteryBar, plural, TopicMark } from "./bits";
import { TopicCard } from "./HomeScreen";
import type { Go } from "./nav";

interface Props {
  tree: TopicNode[];
  topic: TopicNode;
  go: Go;
  onCreateNote(): void;
  onCreateSubtopic(name: string): void;
  onRename(name: string): void;
  onDelete(): void;
}

export function TopicScreen({ tree, topic, go, onCreateNote, onCreateSubtopic, onRename, onDelete }: Props) {
  const notes = useLoad((db) => listNotes(db, topic.id), [topic.id]);
  const [mode, setMode] = useState<"view" | "rename" | "delete" | "subtopic">("view");
  const { total, ready, suggested, strong, fresh } = topic.counts;
  const learning = Math.max(0, total - strong - fresh);

  return (
    <div className="page topic">
      <header className="topic-head">
        <TopicMark name={topic.name} color={topicTagColor(tree, topic.id)} size="lg" />
        {mode === "rename" ? (
          <InlineInput
            label="Topic name"
            initial={topic.name}
            onCancel={() => setMode("view")}
            onSubmit={(name) => {
              setMode("view");
              if (name !== topic.name) onRename(name);
            }}
          />
        ) : (
          <h1 className="page-title">{topic.name}</h1>
        )}
        <p className="topic-meta">
          {plural(topic.counts.notes, "note")}, {plural(total, "question")}
          {topic.children.length > 0 ? `, ${plural(topic.children.length, "sub-topic")}` : ""}
        </p>
        {total > 0 && (
          <div className="topic-mastery">
            <MasteryBar counts={topic.counts} />
            <ul className="legend" aria-hidden="true">
              <li>
                <span className="swatch is-strong" /> {strong} strong
              </li>
              <li>
                <span className="swatch is-learning" /> {learning} learning
              </li>
              <li>
                <span className="swatch is-fresh" /> {fresh} not practised yet
              </li>
            </ul>
          </div>
        )}
        <div className="row topic-actions">
          <button
            className="btn-primary"
            disabled={ready === 0}
            onClick={() => go({ name: "practice", title: topic.name, topicIds: topicAndDescendantIds(topic) })}
          >
            {ready === 0 ? "Nothing ready to practise" : `Practise ${plural(ready, "question")}`}
          </button>
          {total > 0 && (
            <button className="btn" onClick={() => go({ name: "questions", topicId: topic.id })}>
              <ListChecks size={15} />
              All questions
            </button>
          )}
          <span className="spacer" />
          <button className="btn-quiet" onClick={() => setMode("rename")}>
            <Pencil size={14} />
            Rename
          </button>
          <button className="btn-quiet is-danger" onClick={() => setMode("delete")}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
        {mode === "delete" && (
          <div className="confirm" role="alertdialog" aria-label="Delete topic">
            <p>
              Delete “{topic.name}”
              {topic.counts.notes > 0 || topic.children.length > 0
                ? ` with its ${plural(topic.counts.notes, "note")}, ${plural(total, "question")} and ${plural(topic.children.length, "sub-topic")}`
                : ""}
              ? This cannot be undone.
            </p>
            <div className="row">
              <button className="btn-danger" onClick={onDelete}>
                Delete topic
              </button>
              <button className="btn-quiet" onClick={() => setMode("view")}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </header>

      {suggested > 0 && (
        <button className="ai-card" onClick={() => go({ name: "suggestions" })}>
          <span className="ai-card-icon" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <span className="ai-card-text">
            <strong>{plural(suggested, "suggested question")}</strong>
            <span>Waiting for you to keep or dismiss.</span>
          </span>
          <span className="ai-card-go">
            Review
            <ArrowRight size={14} aria-hidden="true" />
          </span>
        </button>
      )}

      <section aria-labelledby="notes-title">
        <div className="section-head">
          <h2 id="notes-title">Notes</h2>
        </div>
        <ul className="sheets">
          <li>
            <button className="sheet is-new" onClick={onCreateNote}>
              <Plus size={18} />
              New note
            </button>
          </li>
          {notes?.map((note) => (
            <li key={note.id}>
              <button className="sheet" onClick={() => go({ name: "note", noteId: note.id, topicId: topic.id })}>
                <span className="sheet-title">{note.title.trim() || "Untitled note"}</span>
                <span className="sheet-preview">{note.preview || "Empty"}</span>
                <span className="sheet-foot">
                  <span className={note.questionCount > 0 ? "sheet-count" : undefined}>
                    {note.questionCount === 0 ? "No questions" : plural(note.questionCount, "question")}
                  </span>
                  <span>{ago(note.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {notes && notes.length === 0 && <p className="hint">Write what you are learning in your own words. Tutor makes questions from it.</p>}
      </section>

      <section aria-labelledby="subtopics-title">
        <div className="section-head">
          <h2 id="subtopics-title">Sub-topics</h2>
        </div>
        {topic.children.length === 0 && mode !== "subtopic" ? (
          <button className="empty-line is-action" onClick={() => setMode("subtopic")}>
            <Plus size={15} aria-hidden="true" />
            Split a big topic into smaller ones when it grows, for example by chapter.
          </button>
        ) : (
          <ul className="topic-grid">
            {topic.children.map((child) => (
              <li key={child.id}>
                <TopicCard tree={tree} topic={child} onOpen={() => go({ name: "topic", topicId: child.id })} />
              </li>
            ))}
            <li>
              {mode === "subtopic" ? (
                <div className="topic-card is-input">
                  <InlineInput
                    label="Sub-topic name"
                    onCancel={() => setMode("view")}
                    onSubmit={(name) => {
                      setMode("view");
                      onCreateSubtopic(name);
                    }}
                  />
                </div>
              ) : (
                <button className="topic-card is-new" onClick={() => setMode("subtopic")}>
                  <Plus size={18} />
                  New sub-topic
                </button>
              )}
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}
