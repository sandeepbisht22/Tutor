import { BarChart3, ChevronRight, FileText, House, Plus, Search, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { TopicNode } from "../domain/types";
import { topicTagColor } from "../lib/colors";
import { listRecentNotes } from "../repo/notes";
import { topicPath } from "../repo/topics";
import { useLoad } from "./app";
import { InlineInput, Kbd, Logo, plural, TagDot, TopicMark } from "./bits";
import { MOD_KEY } from "./hooks";
import type { Go, Route } from "./nav";

interface Props {
  tree: TopicNode[];
  route: Route;
  go: Go;
  ready: number;
  suggested: number;
  /** false while the sidebar is a closed drawer: keeps it out of the tab order */
  reachable: boolean;
  onCreateTopic(name: string): void;
  onSearch(): void;
}

const RECENT_COUNT = 4;

/** The sidebar island: search, practise, the main places, recent notes and every topic. */
export function Sidebar({ tree, route, go, ready, suggested, reachable, onCreateTopic, onSearch }: Props) {
  const currentTopicId = "topicId" in route ? route.topicId : null;
  const currentNoteId = route.name === "note" ? route.noteId : null;
  const recent = useLoad((db) => listRecentNotes(db, RECENT_COUNT), []);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);

  // keep the way to the current topic unfolded
  useEffect(() => {
    if (!currentTopicId) return;
    const ancestors = topicPath(tree, currentTopicId)
      .slice(0, -1)
      .map((topic) => topic.id);
    setUnfolded((current) => (ancestors.every((id) => current.has(id)) ? current : new Set([...current, ...ancestors])));
  }, [tree, currentTopicId]);

  const toggle = (id: string) =>
    setUnfolded((current) => (current.has(id) ? new Set([...current].filter((entry) => entry !== id)) : new Set([...current, id])));

  return (
    <nav className="sidebar" aria-label="Tutor" inert={!reachable}>
      <div className="side-brand">
        <Logo size={20} />
        <span>Tutor</span>
      </div>

      <button className="side-search" onClick={onSearch}>
        <Search size={15} aria-hidden="true" />
        <span>Search</span>
        <Kbd>{MOD_KEY}</Kbd>
        <Kbd>K</Kbd>
      </button>

      <button className="side-practise" disabled={ready === 0} onClick={() => go({ name: "practice", title: "All topics" })}>
        <span className="side-practise-title">{ready === 0 ? "All caught up" : "Practise now"}</span>
        <span className="side-practise-sub">{ready === 0 ? "Nothing is ready yet" : `${plural(ready, "question")} ready`}</span>
      </button>

      <ul className="side-list">
        <NavItem icon={<House size={16} />} label="Today" current={route.name === "home"} onClick={() => go({ name: "home" })} />
        <NavItem
          icon={<Sparkles size={16} />}
          label="Suggested"
          count={suggested}
          tone="ai"
          current={route.name === "suggestions"}
          onClick={() => go({ name: "suggestions" })}
        />
        <NavItem icon={<BarChart3 size={16} />} label="Progress" current={route.name === "progress"} onClick={() => go({ name: "progress" })} />
      </ul>

      {recent && recent.length > 0 && (
        <section className="side-widget" aria-labelledby="side-recent-title">
          <h2 id="side-recent-title" className="side-head">
            Recent
          </h2>
          <ul className="side-list">
            {recent.map((note) => (
              <li key={note.id}>
                <button
                  className="side-link is-note"
                  aria-current={note.id === currentNoteId ? "page" : undefined}
                  onClick={() => go({ name: "note", noteId: note.id, topicId: note.topicId })}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span className="side-link-label">{note.title.trim() || "Untitled note"}</span>
                  <TagDot color={topicTagColor(tree, note.topicId)} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="side-widget side-topics" aria-labelledby="side-topics-title">
        <div className="side-head">
          <h2 id="side-topics-title">Topics</h2>
          <button className="side-add" aria-label="New topic" title="New topic" onClick={() => setAdding(true)}>
            <Plus size={15} />
          </button>
        </div>
        <ul className="side-tree">
          {tree.map((topic) => (
            <TopicItem key={topic.id} tree={tree} topic={topic} depth={0} currentId={currentTopicId} unfolded={unfolded} onToggle={toggle} go={go} />
          ))}
          {adding && (
            <li className="side-input">
              <InlineInput
                label="Topic name"
                onCancel={() => setAdding(false)}
                onSubmit={(name) => {
                  setAdding(false);
                  onCreateTopic(name);
                }}
              />
            </li>
          )}
        </ul>
        {tree.length === 0 && !adding && <p className="side-empty">Your topics will be listed here.</p>}
      </section>

      <ul className="side-list side-foot">
        <NavItem icon={<SettingsIcon size={16} />} label="Settings" current={route.name === "settings"} onClick={() => go({ name: "settings" })} />
      </ul>
    </nav>
  );
}

function NavItem(props: { icon: ReactNode; label: string; current: boolean; count?: number; tone?: "ai"; onClick(): void }) {
  return (
    <li>
      <button className="side-link" aria-current={props.current ? "page" : undefined} onClick={props.onClick}>
        {props.icon}
        <span className="side-link-label">{props.label}</span>
        {props.count !== undefined && props.count > 0 && (
          <span className={`side-count${props.tone === "ai" ? " is-ai" : ""}`}>{props.count}</span>
        )}
      </button>
    </li>
  );
}

interface TopicItemProps {
  tree: TopicNode[];
  topic: TopicNode;
  depth: number;
  currentId: string | null;
  unfolded: ReadonlySet<string>;
  onToggle(id: string): void;
  go: Go;
}

function TopicItem({ tree, topic, depth, currentId, unfolded, onToggle, go }: TopicItemProps) {
  const open = unfolded.has(topic.id);
  const nested = topic.children.length > 0;
  const current = topic.id === currentId;
  return (
    <li>
      <div className={`side-topic${current ? " is-current" : ""}`} style={{ "--depth": depth } as CSSProperties}>
        {nested ? (
          <button
            className={`side-twisty${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-label={`${open ? "Fold" : "Unfold"} ${topic.name}`}
            onClick={() => onToggle(topic.id)}
          >
            <ChevronRight size={13} />
          </button>
        ) : (
          <span className="side-twisty" aria-hidden="true" />
        )}
        <button className="side-topic-name" aria-current={current ? "page" : undefined} onClick={() => go({ name: "topic", topicId: topic.id })}>
          {depth === 0 ? <TopicMark name={topic.name} color={topicTagColor(tree, topic.id)} size="xs" /> : <TagDot color={topicTagColor(tree, topic.id)} />}
          <span>{topic.name}</span>
        </button>
        {topic.counts.ready > 0 && (
          <span className="side-count is-ready" title={`${plural(topic.counts.ready, "question")} ready`}>
            {topic.counts.ready}
          </span>
        )}
      </div>
      {nested && open && (
        <ul>
          {topic.children.map((child) => (
            <TopicItem key={child.id} tree={tree} topic={child} depth={depth + 1} currentId={currentId} unfolded={unfolded} onToggle={onToggle} go={go} />
          ))}
        </ul>
      )}
    </li>
  );
}
