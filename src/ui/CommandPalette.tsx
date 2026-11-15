import { BarChart3, FileText, House, Search, Settings as SettingsIcon, Sparkles, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { NoteRef, TopicNode } from "../domain/types";
import { topicTagColor } from "../lib/colors";
import { listRecentNotes, searchNotes } from "../repo/notes";
import { findTopic } from "../repo/topics";
import { useApp } from "./app";
import { ago, Kbd, plural, TopicMark } from "./bits";
import type { Go } from "./nav";

interface Props {
  tree: TopicNode[];
  ready: number;
  go: Go;
  onClose(): void;
}

interface Item {
  key: string;
  group: "Go to" | "Topics" | "Notes";
  label: string;
  hint?: string;
  icon: ReactNode;
  run(): void;
}

const MAX_TOPICS = 6;

function flatten(tree: TopicNode[]): TopicNode[] {
  return tree.flatMap((topic) => [topic, ...flatten(topic.children)]);
}

/**
 * Search everything from one place (Ctrl/⌘ K): places to go, topics, and notes
 * by title or text. Opens without animation: it is used many times a day.
 */
export function CommandPalette({ tree, ready, go, onClose }: Props) {
  const { db } = useApp();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteRef[]>([]);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    let current = true;
    const load = needle ? searchNotes(db, needle) : listRecentNotes(db, 5);
    load.then((found) => current && setNotes(found)).catch(() => current && setNotes([]));
    return () => {
      current = false;
    };
  }, [db, needle]);

  const items = useMemo<Item[]>(() => {
    const open = (run: () => void) => () => {
      onClose();
      run();
    };
    const places: Item[] = [
      ...(ready > 0
        ? [{ key: "practise", group: "Go to" as const, label: "Start practising", hint: plural(ready, "question"), icon: <Target size={16} />, run: open(() => go({ name: "practice", title: "All topics" })) }]
        : []),
      { key: "today", group: "Go to", label: "Today", icon: <House size={16} />, run: open(() => go({ name: "home" })) },
      { key: "suggested", group: "Go to", label: "Suggested questions", icon: <Sparkles size={16} />, run: open(() => go({ name: "suggestions" })) },
      { key: "progress", group: "Go to", label: "Progress", icon: <BarChart3 size={16} />, run: open(() => go({ name: "progress" })) },
      { key: "settings", group: "Go to", label: "Settings", icon: <SettingsIcon size={16} />, run: open(() => go({ name: "settings" })) },
    ];
    const topics = (needle ? flatten(tree).filter((topic) => topic.name.toLowerCase().includes(needle)) : tree).slice(0, MAX_TOPICS);
    return [
      ...places.filter((item) => !needle || item.label.toLowerCase().includes(needle)),
      ...topics.map<Item>((topic) => ({
        key: `topic:${topic.id}`,
        group: "Topics",
        label: topic.name,
        hint: topic.counts.ready > 0 ? `${topic.counts.ready} ready` : plural(topic.counts.notes, "note"),
        icon: <TopicMark name={topic.name} color={topicTagColor(tree, topic.id)} size="xs" />,
        run: open(() => go({ name: "topic", topicId: topic.id })),
      })),
      ...notes.map<Item>((note) => ({
        key: `note:${note.id}`,
        group: "Notes",
        label: note.title.trim() || "Untitled note",
        hint: `${findTopic(tree, note.topicId)?.name ?? ""}, ${ago(note.updatedAt)}`,
        icon: <FileText size={16} />,
        run: open(() => go({ name: "note", noteId: note.id, topicId: note.topicId })),
      })),
    ];
  }, [go, needle, notes, onClose, ready, tree]);

  // the highlighted row stays valid and in view as results change
  useEffect(() => setActive(0), [needle]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (items.length === 0 ? 0 : (index + step + items.length) % items.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[active]?.run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-field">
          <Search size={17} aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            aria-label="Search topics, notes and places"
            placeholder="Search topics, notes and places"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKey}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="palette-results" id="palette-results" role="listbox" ref={list}>
          {items.length === 0 && <li className="palette-empty">Nothing matches “{query.trim()}”.</li>}
          {items.map((item, index) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.key} role="presentation">
                {heading && (
                  <div className="palette-group" role="presentation">
                    {heading === "Notes" && !needle ? "Recent notes" : heading}
                  </div>
                )}
                <div
                  id={`palette-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  className={`palette-item${index === active ? " is-active" : ""}`}
                  onMouseMove={() => index !== active && setActive(index)}
                  onClick={item.run}
                >
                  <span className="palette-icon">{item.icon}</span>
                  <span className="palette-label">{item.label}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot" aria-hidden="true">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>Enter</Kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}
