import { Brain, CalendarCheck, Flame, Trophy } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { TopicNode } from "../domain/types";
import { monthLabels } from "../lib/calendar";
import { topicTagColor } from "../lib/colors";
import { getActivity, getPracticeStats } from "../repo/attempts";
import { listStruggling } from "../repo/questions";
import { useLoad } from "./app";
import { MasteryBar, plural, TopicMark } from "./bits";
import type { Go } from "./nav";
import { QuestionDialog } from "./QuestionsScreen";

/** The calendar shows this many weeks, Monday to Sunday, ending with this week. */
const WEEKS = 26;

/** Days from the Monday WEEKS-1 weeks ago up to and including today, so every column is a whole week. */
function calendarSpan(now = new Date()): number {
  return (WEEKS - 1) * 7 + ((now.getDay() + 6) % 7) + 1;
}

export function ProgressScreen({ tree, go }: { tree: TopicNode[]; go: Go }) {
  const stats = useLoad((db) => getPracticeStats(db), []);
  const span = calendarSpan();
  const activity = useLoad((db) => getActivity(db, span), [span]);
  const struggling = useLoad((db) => listStruggling(db), []);
  const [openId, setOpenId] = useState<string | null>(null);

  const total = tree.reduce((sum, topic) => sum + topic.counts.total, 0);
  const strong = tree.reduce((sum, topic) => sum + topic.counts.strong, 0);
  const answered = activity?.days.reduce((sum, day) => sum + day.count, 0) ?? 0;

  return (
    <div className="page">
      <h1 className="page-title">Progress</h1>

      <dl className="facts">
        <Fact icon={<CalendarCheck size={16} />} label="Today" value={stats ? plural(stats.practisedToday, "answer") : "…"} />
        <Fact icon={<Flame size={16} />} label="Days in a row" value={activity ? String(activity.streak) : "…"} />
        <Fact
          icon={<Brain size={16} />}
          label="Remembered when asked again"
          value={stats ? (stats.remembered30d === null ? "Not enough yet" : `${Math.round(stats.remembered30d * 100)}%`) : "…"}
        />
        <Fact icon={<Trophy size={16} />} label="Strong questions" value={`${strong} of ${total}`} />
      </dl>
      <p className="muted facts-note">
        “Remembered when asked again” counts questions you had already learned, over the last 30 days
        {stats && stats.rememberedSample > 0 ? ` (${plural(stats.rememberedSample, "answer")})` : ""}. A question is strong once Tutor expects you to remember it for three weeks or more.
      </p>

      <section className="panel">
        <h2>Answers per day, last {WEEKS} weeks</h2>
        {activity && answered === 0 ? (
          <p className="empty-line">No answers in the last {WEEKS} weeks yet.</p>
        ) : (
          activity && <Heatmap days={activity.days} />
        )}
      </section>

      <section className="panel">
        <h2>How well you know each topic</h2>
        {tree.length === 0 || total === 0 ? (
          <p className="empty-line">Add questions to a topic and its progress shows up here.</p>
        ) : (
          <>
            <ul className="legend" aria-label="Legend">
              <li>
                <span className="swatch is-strong" /> Strong
              </li>
              <li>
                <span className="swatch is-learning" /> Learning
              </li>
              <li>
                <span className="swatch is-fresh" /> Not practised yet
              </li>
            </ul>
            <table className="strength">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th aria-label="Share of questions" />
                  <th className="num">Strong</th>
                  <th className="num">Learning</th>
                  <th className="num">Not yet</th>
                </tr>
              </thead>
              <tbody>
                {tree
                  .filter((topic) => topic.counts.total > 0)
                  .map((topic) => {
                    const { total: all, strong: s, fresh: f } = topic.counts;
                    const learning = Math.max(0, all - s - f);
                    return (
                      <tr key={topic.id}>
                        <th scope="row">
                          <button className="link" onClick={() => go({ name: "topic", topicId: topic.id })}>
                            <TopicMark name={topic.name} color={topicTagColor(tree, topic.id)} size="xs" />
                            {topic.name}
                          </button>
                        </th>
                        <td>
                          <MasteryBar counts={topic.counts} />
                        </td>
                        <td className="num">{s}</td>
                        <td className="num">{learning}</td>
                        <td className="num">{f}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Questions you keep forgetting</h2>
        {struggling && struggling.length === 0 ? (
          <p className="empty-line">None. Questions you forget twice or more after learning them are listed here.</p>
        ) : (
          <ul className="rows">
            {struggling?.map((question) => (
              <li key={question.id}>
                <button className="row-link" onClick={() => setOpenId(question.id)}>
                  <span className="row-main">
                    <span className="row-title">{question.prompt}</span>
                    <span className="row-sub is-preview">{question.answer}</span>
                  </span>
                  <span className="row-meta">Forgotten {plural(question.lapses, "time")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {struggling && struggling.length > 0 && (
          <p className="muted">A question that will not stick is often too big. Open it and split it into smaller ones, or reword it.</p>
        )}
      </section>

      {openId && <QuestionDialog questionId={openId} go={go} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * One square per day, a column per week, Monday at the top. A single measure in
 * one teal, light to dark (validated ramps in data.css); empty days stay grey.
 */
function Heatmap({ days }: { days: { day: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const level = (count: number) => (count === 0 ? 0 : Math.min(4, Math.ceil((4 * count) / max)));
  const label = (day: number) => new Date(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const active = days.filter((d) => d.count > 0).length;
  const shown = hover !== null ? days[hover] : null;

  const months = monthLabels(days.map((d) => d.day));

  return (
    <figure className="heatmap-figure">
      <div className="heatmap-wrap">
        <ol className="heatmap-weekdays" aria-hidden="true">
          <li>Mon</li>
          <li />
          <li>Wed</li>
          <li />
          <li>Fri</li>
          <li />
          <li />
        </ol>
        <div className="heatmap-body">
          <ol className="heatmap-months" aria-hidden="true">
            {months.map((month, week) => (
              <li key={week}>{month}</li>
            ))}
          </ol>
          <ol
            className="heatmap"
            role="img"
            aria-label={`${plural(total, "answer")} on ${plural(active, "day")} in the last ${WEEKS} weeks`}
            onMouseLeave={() => setHover(null)}
          >
            {days.map((entry, index) => (
              <li
                key={entry.day}
                className={`heat-cell is-${level(entry.count)}${index === days.length - 1 ? " is-today" : ""}${hover === index ? " is-hover" : ""}`}
                onMouseEnter={() => setHover(index)}
              />
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="heatmap-foot">
        <span className="chart-readout" aria-live="polite">
          {shown ? `${label(shown.day)}: ${plural(shown.count, "answer")}` : "Point at a day to see it."}
        </span>
        <span className="heat-legend" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((step) => (
            <span key={step} className={`heat-cell is-${step}`} />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}
