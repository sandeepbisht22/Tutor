import { ArrowRight, Check, Flame, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Question, TopicNode } from "../domain/types";
import { estimateMinutes, topicTagColor } from "../lib/colors";
import { formatInterval } from "../lib/scheduler";
import { getActivity, getPracticeStats, typicalAnswerMs } from "../repo/attempts";
import { listReadyQuestions, nextReadyAt } from "../repo/questions";
import { findTopic, topicAndDescendantIds } from "../repo/topics";
import { useLoad } from "./app";
import { InlineInput, MasteryBar, plural, TagDot, TopicMark } from "./bits";
import { greeting } from "./hooks";
import type { Go } from "./nav";

interface Props {
  tree: TopicNode[];
  go: Go;
  onCreateTopic(name: string): void;
}

const RECENT_DAYS = 14;

export function HomeScreen({ tree, go, onCreateTopic }: Props) {
  const [adding, setAdding] = useState(false);
  const next = useLoad((db) => nextReadyAt(db), []);
  const upNext = useLoad((db) => listReadyQuestions(db, { limit: 1 }), []);
  const stats = useLoad((db) => getPracticeStats(db), []);
  const activity = useLoad((db) => getActivity(db, RECENT_DAYS), []);
  const pace = useLoad((db) => typicalAnswerMs(db), []);
  const ready = tree.reduce((sum, topic) => sum + topic.counts.ready, 0);
  const total = tree.reduce((sum, topic) => sum + topic.counts.total, 0);
  const suggested = tree.reduce((sum, topic) => sum + topic.counts.suggested, 0);

  if (tree.length === 0) return <Welcome onCreate={onCreateTopic} />;

  const first = upNext?.[0];
  const minutes = estimateMinutes(ready, pace ?? null);
  const readyTopics = tree.filter((topic) => topic.counts.ready > 0);
  const practise = (topic?: TopicNode) =>
    go(topic ? { name: "practice", title: topic.name, topicIds: topicAndDescendantIds(topic) } : { name: "practice", title: "All topics" });

  return (
    <div className="page home">
      <section className="today" aria-labelledby="today-title">
        <div className="today-text">
          <p className="today-greeting">{greeting()}</p>
          <h1 id="today-title" className="page-title">
            {ready > 0 ? `${plural(ready, "question is", "questions are")} ready` : total === 0 ? "No questions yet" : "You are up to date"}
          </h1>
          <p className="lead">
            {ready > 0
              ? `About ${plural(minutes, "minute")}. Answering them now, just before you forget, is what makes them stick.`
              : total === 0
                ? "Open a topic and write a note. Tutor makes questions from your notes."
                : next
                  ? `The next question comes back in ${formatInterval(next - Date.now())}. Nothing to do until then.`
                  : "Nothing is scheduled. Add notes to get new questions."}
          </p>
          {ready > 0 && (
            <div className="today-actions">
              <button className="btn-primary is-large" onClick={() => practise()}>
                Start practising
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {readyTopics.length > 1 && (
            <ul className="today-chips" aria-label="Practise one topic">
              {readyTopics.map((topic) => (
                <li key={topic.id}>
                  <button className="topic-chip" onClick={() => practise(topic)} aria-label={`Practise ${topic.name}, ${topic.counts.ready} ready`}>
                    <TopicMark name={topic.name} color={topicTagColor(tree, topic.id)} size="xs" />
                    {topic.name}
                    <span className="topic-chip-count">{topic.counts.ready}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Deck tree={tree} question={first} ready={ready} onOpen={() => practise()} />
      </section>

      <div className="home-strip">
        {activity && stats && <Recent days={activity.days} streak={activity.streak} today={stats.practisedToday} />}
        {suggested > 0 && (
          <button className="ai-card" onClick={() => go({ name: "suggestions" })}>
            <span className="ai-card-icon" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <span className="ai-card-text">
              <strong>{plural(suggested, "suggested question")}</strong>
              <span>Tutor wrote {suggested === 1 ? "it" : "them"} from your notes. Keep the good ones.</span>
            </span>
            <span className="ai-card-go">
              Review
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>
        )}
      </div>

      <section aria-labelledby="topics-title">
        <div className="section-head">
          <h2 id="topics-title">Topics</h2>
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={14} />
            New topic
          </button>
        </div>
        <ul className="topic-grid">
          {tree.map((topic) => (
            <li key={topic.id}>
              <TopicCard tree={tree} topic={topic} onOpen={() => go({ name: "topic", topicId: topic.id })} />
            </li>
          ))}
          {adding && (
            <li>
              <div className="topic-card is-input">
                <InlineInput
                  label="Topic name"
                  onCancel={() => setAdding(false)}
                  onSubmit={(name) => {
                    setAdding(false);
                    onCreateTopic(name);
                  }}
                />
              </div>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

/**
 * The ready questions as a stack of index cards, the first one face up.
 * The stack is as deep as there are questions waiting (up to three cards behind).
 */
function Deck({ tree, question, ready, onOpen }: { tree: TopicNode[]; question?: Question; ready: number; onOpen(): void }) {
  const behind = Math.min(Math.max(ready - 1, 0), 3);
  const under = Array.from({ length: behind }, (_, index) => <span key={index} className={`deck-under is-${index + 1}`} aria-hidden="true" />);

  if (!question) {
    return (
      <div className="deck is-empty" aria-hidden="true">
        <span className="deck-card">
          <span className="deck-check">
            <Check size={22} strokeWidth={2.5} />
          </span>
          <span className="deck-prompt">Nothing to answer right now</span>
        </span>
      </div>
    );
  }

  return (
    <button className="deck" onClick={onOpen} aria-label={`Start practising. First question: ${question.prompt}`}>
      {under}
      <span className="deck-card">
        <span className="deck-topic">
          <TagDot color={topicTagColor(tree, question.topicId)} />
          {findTopic(tree, question.topicId)?.name ?? "First up"}
        </span>
        <span className="deck-prompt">{question.prompt}</span>
      </span>
    </button>
  );
}

/** The last two weeks as a row of days, with today's count and the streak. */
function Recent({ days, streak, today }: { days: { day: number; count: number }[]; streak: number; today: number }) {
  const level = (count: number) => (count === 0 ? 0 : count < 4 ? 1 : count < 10 ? 2 : 3);
  const label = (day: number) => new Date(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="recent">
      <div className="recent-head">
        <span className="recent-streak">
          <Flame size={15} aria-hidden="true" className={streak > 0 ? "is-lit" : undefined} />
          {streak > 0 ? `${plural(streak, "day")} in a row` : "No streak yet"}
        </span>
        <span className="recent-today">{today === 0 ? "Nothing answered today" : `${plural(today, "answer")} today`}</span>
      </div>
      <ol className="recent-days" aria-label={`Answers on each of the last ${days.length} days`}>
        {days.map((entry, index) => (
          <li
            key={entry.day}
            className={`recent-day is-${level(entry.count)}${index === days.length - 1 ? " is-today" : ""}`}
            title={`${label(entry.day)}: ${plural(entry.count, "answer")}`}
          />
        ))}
      </ol>
    </div>
  );
}

/** A topic as a card: its mark, what is in it, how well it is known, and what is ready. */
export function TopicCard({ tree, topic, onOpen }: { tree: TopicNode[]; topic: TopicNode; onOpen(): void }) {
  const { notes, total, ready } = topic.counts;
  return (
    <button className="topic-card" onClick={onOpen}>
      <span className="topic-card-top">
        <TopicMark name={topic.name} color={topicTagColor(tree, topic.id)} size="md" />
        {ready > 0 && <span className="ready-count">{ready} ready</span>}
      </span>
      <span className="topic-card-name">{topic.name}</span>
      <span className="topic-card-meta">
        {plural(notes, "note")}, {plural(total, "question")}
        {topic.children.length > 0 ? `, ${plural(topic.children.length, "sub-topic")}` : ""}
      </span>
      <MasteryBar counts={topic.counts} />
    </button>
  );
}

function Welcome({ onCreate }: { onCreate(name: string): void }) {
  const [name, setName] = useState("");
  return (
    <div className="page welcome">
      <div className="welcome-card">
        <h1 className="page-title">Welcome to Tutor</h1>
        <p className="lead">Write down what you are learning. Tutor turns it into questions and asks them again just before you would forget.</p>
        <ol className="steps">
          <li>
            <strong>Create a topic</strong>
            <span>Anything you want to learn: a language, a course, a framework.</span>
          </li>
          <li>
            <strong>Write notes in it</strong>
            <span>Text and images, in your own words.</span>
          </li>
          <li>
            <strong>Answer the questions</strong>
            <span>In practice sessions, and on small sticky notes on your desktop.</span>
          </li>
        </ol>
        <form
          className="first-topic"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <label htmlFor="first-topic">What is your first topic?</label>
          <div className="row">
            <input
              id="first-topic"
              className="text-input"
              autoFocus
              placeholder="For example: Spanish, Biology, React"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className="btn-primary" disabled={name.trim() === ""}>
              Create topic
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
