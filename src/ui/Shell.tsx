import { ChevronRight, Info, PanelLeft, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NoteQueue } from "../ai/queue";
import { suggestForNote } from "../ai/suggest";
import { desktop } from "../platform";
import { createNote, deleteNote, listNotesAwaitingSuggestions } from "../repo/notes";
import { buildTopicTree, countByTopic, createTopic, deleteTopic, findTopic, listTopics, renameTopic, topicPath } from "../repo/topics";
import { errorText, startBuiltInEarly, useApp, useLoad } from "./app";
import { CommandPalette } from "./CommandPalette";
import { HomeScreen } from "./HomeScreen";
import { useMediaQuery, useStoredFlag } from "./hooks";
import type { Go, Route } from "./nav";
import { NoteScreen } from "./NoteScreen";
import { PracticeScreen } from "./PracticeScreen";
import { ProgressScreen } from "./ProgressScreen";
import { QuestionsScreen } from "./QuestionsScreen";
import { QueueContext, useQueueState } from "./queue";
import { SettingsScreen } from "./SettingsScreen";
import { Sidebar } from "./Sidebar";
import { SuggestionsScreen } from "./SuggestionsScreen";
import { TopicScreen } from "./TopicScreen";

/** Give Tutor's own start-up a moment before loading the model (gigabytes read from disk). */
const ENGINE_START_DELAY_MS = 2500;

/** What the top bar calls the screens that are not a topic. */
const PAGE_NAMES: Partial<Record<Route["name"], string>> = {
  home: "Today",
  note: "Note",
  questions: "Questions",
  suggestions: "Suggested questions",
  progress: "Progress",
  settings: "Settings",
};

const MOD = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

/** The main window: the sidebar, a top bar, and one screen at a time. */
export function Shell() {
  const { db, settings, getProvider, changed } = useApp();
  const [stack, setStack] = useState<Route[]>([{ name: "home" }]);
  const [notice, setNotice] = useState<string | null>(null);
  const [minute, setMinute] = useState(0);
  const route = stack[stack.length - 1];
  const narrow = useMediaQuery("(max-width: 979px)");
  const [docked, setDocked] = useStoredFlag("tutor.sidebar", true);
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);

  const go = useCallback((next: Route) => setStack((current) => (next.name === "home" ? [next] : [...current, next])), []);
  const replace = useCallback((next: Route) => setStack((current) => [...current.slice(0, -1), next]), []);
  const back = useCallback(() => setStack((current) => (current.length > 1 ? current.slice(0, -1) : [{ name: "home" }])), []);

  // questions become ready as time passes; refresh the counts every minute
  useEffect(() => {
    const timer = setInterval(() => setMinute((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const loaded = useLoad(async (database) => ({ topics: await listTopics(database), counts: await countByTopic(database, Date.now()) }), [minute]);
  const tree = useMemo(() => (loaded ? buildTopicTree(loaded.topics, loaded.counts) : null), [loaded]);

  // Background AI work: writing suggestions for a note, one note at a time.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const queue = useMemo(
    () =>
      new NoteQueue(async (noteId) => {
        const provider = await getProvider();
        if (!provider) return;
        const added = await suggestForNote(db, provider, noteId, { autoAccept: settingsRef.current.autoAccept });
        if (added > 0) changed();
      }),
    [db, getProvider, changed],
  );
  const wantsSuggestions = settings.autoSuggest && settings.aiMode !== "off";

  // shortly after launch, catch up on notes edited while no model was available
  useEffect(() => {
    if (!wantsSuggestions) return;
    const timer = setTimeout(() => {
      void listNotesAwaitingSuggestions(db, 5).then((ids) => ids.forEach((id) => queue.enqueue(id)));
    }, 4000);
    return () => clearTimeout(timer);
  }, [db, queue, wantsSuggestions]);

  // Start the built-in AI soon after Tutor opens, so the first suggestion does
  // not wait for the model to load. Runs again when the AI choice changes in
  // Settings. The engine still frees the model's memory after a few idle minutes.
  useEffect(() => {
    const timer = setTimeout(() => {
      // Not shown to the user: the next real request starts the engine again
      // and reports any problem in the place the user is looking.
      startBuiltInEarly(settingsRef.current).catch(() => false);
    }, ENGINE_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settings.aiMode]);

  const practising = route.name === "practice";
  const toggleButton = useRef<HTMLButtonElement>(null);

  const toggleSidebar = useCallback(() => {
    if (narrow) setDrawer((open) => !open);
    else setDocked(!docked);
  }, [docked, narrow, setDocked]);

  // Closing the drawer the user dismissed gives the keyboard back to the button that opened it.
  // That happens after the re-render: until then the button is still inside the inert workspace.
  const restoreFocus = useRef(false);
  const dismissDrawer = useCallback(() => {
    restoreFocus.current = true;
    setDrawer(false);
  }, []);
  useEffect(() => {
    if (drawer || !restoreFocus.current) return;
    restoreFocus.current = false;
    toggleButton.current?.focus();
  }, [drawer]);

  // a practice session has no sidebar: never come back to a drawer opened behind it
  useEffect(() => {
    if (practising) setDrawer(false);
  }, [practising]);

  // the open drawer takes the keyboard, like a dialog
  useEffect(() => {
    if (narrow && drawer) document.querySelector<HTMLElement>(".sidebar button:not(:disabled)")?.focus();
  }, [narrow, drawer]);

  // Ctrl/Cmd + \ shows or hides the sidebar; Escape closes it when it covers the screen
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "\\" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!practising) toggleSidebar();
      } else if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault();
        if (!practising) setSearching((open) => !open);
      } else if (event.key === "Escape" && narrow && drawer) {
        dismissDrawer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissDrawer, drawer, narrow, practising, toggleSidebar]);

  const attempt = useCallback(async (action: () => Promise<void>) => {
    try {
      setNotice(null);
      await action();
    } catch (error) {
      setNotice(errorText(error));
    }
  }, []);

  const createTopicAndOpen = (name: string) =>
    attempt(async () => {
      const created = await createTopic(db, name);
      changed();
      setDrawer(false);
      go({ name: "topic", topicId: created.id });
    });

  if (!tree) return <div className="fatal" aria-busy="true" />;

  const topicId = route.name === "topic" || route.name === "note" || route.name === "questions" ? route.topicId : null;
  const topic = topicId ? findTopic(tree, topicId) : undefined;
  const trail = topicId ? topicPath(tree, topicId) : [];
  const ready = tree.reduce((sum, t) => sum + t.counts.ready, 0);
  const suggested = tree.reduce((sum, t) => sum + t.counts.suggested, 0);

  let screen;
  if (route.name === "practice") {
    screen = <PracticeScreen tree={tree} title={route.title} topicIds={route.topicIds} go={go} onFinish={back} />;
  } else if (route.name === "settings") {
    screen = <SettingsScreen />;
  } else if (route.name === "progress") {
    screen = <ProgressScreen tree={tree} go={go} />;
  } else if (route.name === "suggestions") {
    screen = <SuggestionsScreen go={go} />;
  } else if (route.name === "note") {
    screen = (
      <NoteScreen
        key={route.noteId}
        noteId={route.noteId}
        onLeave={(noteId) => wantsSuggestions && queue.enqueue(noteId)}
        onSuggest={(noteId) => queue.enqueue(noteId)}
        onDelete={() =>
          attempt(async () => {
            await deleteNote(db, route.noteId);
            changed();
            back();
          })
        }
      />
    );
  } else if (route.name === "topic" && topic) {
    screen = (
      <TopicScreen
        key={topic.id}
        tree={tree}
        topic={topic}
        go={go}
        onCreateNote={() =>
          attempt(async () => {
            const note = await createNote(db, topic.id);
            changed();
            go({ name: "note", noteId: note.id, topicId: topic.id });
          })
        }
        onCreateSubtopic={(name) =>
          attempt(async () => {
            const child = await createTopic(db, name, topic.id);
            changed();
            go({ name: "topic", topicId: child.id });
          })
        }
        onRename={(name) =>
          attempt(async () => {
            await renameTopic(db, topic.id, name);
            changed();
          })
        }
        onDelete={() =>
          attempt(async () => {
            await deleteTopic(db, topic.id);
            changed();
            if (topic.parentId) replace({ name: "topic", topicId: topic.parentId });
            else go({ name: "home" });
          })
        }
      />
    );
  } else if (route.name === "questions" && topic) {
    screen = <QuestionsScreen topic={topic} go={go} />;
  } else {
    screen = (
      <HomeScreen tree={tree} go={go} onCreateTopic={createTopicAndOpen} />
    );
  }

  const navGo: Go = (next) => {
    setDrawer(false);
    go(next);
  };
  const screenKey =
    route.name === "note" ? `note:${route.noteId}` : route.name === "topic" || route.name === "questions" ? `${route.name}:${route.topicId}` : route.name;
  const withSidebar = !practising;
  const sidebarShown = withSidebar && (narrow ? drawer : docked);

  return (
    <QueueContext.Provider value={queue}>
      <div className={`shell is-${route.name}${sidebarShown ? " has-sidebar" : ""}${narrow ? " is-narrow" : ""}`}>
        {withSidebar && (narrow || docked) && (
          <Sidebar
            tree={tree}
            route={route}
            go={navGo}
            ready={ready}
            suggested={suggested}
            reachable={sidebarShown}
            onCreateTopic={createTopicAndOpen}
            onSearch={() => {
              setDrawer(false);
              setSearching(true);
            }}
          />
        )}
        {narrow && drawer && <div className="scrim" onClick={dismissDrawer} />}

        <div className="workspace" inert={sidebarShown && narrow}>
          {withSidebar && (
            <header className="topbar">
              <button
                ref={toggleButton}
                className="icon-btn"
                aria-label={sidebarShown ? "Hide sidebar" : "Show sidebar"}
                title={`${sidebarShown ? "Hide" : "Show"} sidebar (${MOD}\\)`}
                aria-expanded={sidebarShown}
                onClick={toggleSidebar}
              >
                <PanelLeft size={17} />
              </button>
              <nav className="trail" aria-label="You are here">
                {trail.map((node, index) => {
                  const last = index === trail.length - 1 && route.name === "topic";
                  return (
                    <span key={node.id}>
                      {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
                      {last ? (
                        <span aria-current="page">{node.name}</span>
                      ) : (
                        <button onClick={() => go({ name: "topic", topicId: node.id })}>{node.name}</button>
                      )}
                    </span>
                  );
                })}
                {PAGE_NAMES[route.name] && (
                  <span>
                    {trail.length > 0 && <ChevronRight size={14} aria-hidden="true" />}
                    <span aria-current="page">{PAGE_NAMES[route.name]}</span>
                  </span>
                )}
              </nav>
              <span className="spacer" />
              <QueueNote />
              {!sidebarShown && (
                <button className="icon-btn" aria-label="Search" title={`Search (${MOD}K)`} onClick={() => setSearching(true)}>
                  <Search size={17} />
                </button>
              )}
            </header>
          )}

          <main className="screen" key={screenKey}>
            {screen}
          </main>
        </div>

        {searching && <CommandPalette tree={tree} ready={ready} go={go} onClose={() => setSearching(false)} />}

        {notice && (
          <div className="toast" role="alert">
            <Info size={16} aria-hidden="true" />
            <span>{notice}</span>
            <button className="btn-quiet" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {!desktop && <div className="preview-flag">Browser preview: data is kept in this browser only</div>}
      </div>
    </QueueContext.Provider>
  );
}

/** A quiet line in the top bar while the AI is writing suggestions. */
function QueueNote() {
  const queue = useQueueState();
  if (queue.running === null) return null;
  return (
    <span className="queue-note" role="status">
      <span className="pulse" aria-hidden="true" />
      Writing questions…
    </span>
  );
}
