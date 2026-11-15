import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Check,
  Code,
  Heading2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  TextQuote,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DocNode, Note } from "../domain/types";
import { getNote, saveNote } from "../repo/notes";
import { errorText, useApp } from "./app";
import { BlockId, currentBlock, isBlockIdSync, syncBlockIds, type CurrentBlock } from "./blockId";
import { Figure } from "./figure";
import { importImage } from "./images";
import { NoteQuestions } from "./NoteQuestions";
import { SlashMenu } from "./SlashMenu";

interface Props {
  noteId: string;
  /** called after the note was saved for the last time, when the screen closes */
  onLeave(noteId: string): void;
  /** ask the AI for suggestions now */
  onSuggest(noteId: string): void;
  onDelete(): void;
}

const SAVE_DELAY = 600;
const PANEL_KEY = "tutor.note-questions-open";

export function NoteScreen(props: Props) {
  const { db } = useApp();
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    let active = true;
    void getNote(db, props.noteId).then((loaded) => active && setNote(loaded));
    return () => {
      active = false;
    };
  }, [db, props.noteId]);

  if (!note) return null;
  return <LoadedNote {...props} note={note} />;
}

function LoadedNote({ note, onLeave, onSuggest, onDelete }: Props & { note: Note }) {
  const { db, changed } = useApp();
  const [title, setTitle] = useState(note.title);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => readPanelOpen());
  /** goes above 0 when "/question" asks the panel to open a new question form */
  const [askToken, setAskToken] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // The latest content, kept outside React state so a save can run when the screen closes.
  const latest = useRef<{ title: string; doc: DocNode }>({ title: note.title, doc: note.doc });
  const dirty = useRef(false);
  const edited = useRef(false);
  const deleted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const leave = useRef(onLeave);
  leave.current = onLeave;

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    if (!dirty.current || deleted.current) return saving.current;
    dirty.current = false;
    const snapshot = { ...latest.current };
    setSaveState("saving");
    saving.current = saving.current
      .then(() => saveNote(db, note.id, snapshot))
      .then(() => {
        setSaveState(dirty.current ? "saving" : "saved");
        setSavedAt(Date.now());
      })
      .catch(() => setSaveState("error"));
    return saving.current;
  }, [db, note.id]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    edited.current = true;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  }, [flush]);

  const editor = useEditor({
    extensions: [StarterKit, BlockId, Figure, Placeholder.configure({ placeholder: "Write what you are learning. Type / for headings, lists, images and questions." })],
    content: note.doc,
    editorProps: {
      // images pasted or dropped into the note are stored with it
      handlePaste: (_view, event) => takeImages(event.clipboardData?.files),
      handleDrop: (_view, event) => takeImages((event as DragEvent).dataTransfer?.files),
    },
    onUpdate({ editor: instance, transaction }) {
      if (isBlockIdSync(transaction)) {
        latest.current.doc = instance.getJSON() as DocNode;
        return;
      }
      latest.current.doc = syncBlockIds(instance).doc;
      scheduleSave();
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  const insertImage = useCallback(
    async (file: Blob) => {
      try {
        setProblem(null);
        const image = await importImage(db, note.id, file);
        editorRef.current
          ?.chain()
          .focus()
          .insertContent({
            type: "figure",
            attrs: { imageId: image.id, width: image.width, height: image.height, description: "", annotations: [] },
          })
          .run();
      } catch (error) {
        setProblem(errorText(error));
      }
    },
    [db, note.id],
  );

  function takeImages(files: FileList | null | undefined): boolean {
    const images = [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return false;
    void (async () => {
      for (const file of images) await insertImage(file);
    })();
    return true;
  }

  // When the screen closes: save what is pending, tell other screens, and let
  // the AI look at the note if it was edited.
  useEffect(
    () => () => {
      void flush().then(() => {
        if (deleted.current) return;
        changed();
        if (edited.current) leave.current(note.id);
      });
    },
    [changed, flush, note.id],
  );

  const getCurrentBlock = useCallback((): CurrentBlock | null => (editor ? currentBlock(editor) : null), [editor]);
  const getDoc = useCallback(() => latest.current.doc, []);

  const showPanel = (open: boolean) => {
    setPanelOpen(open);
    try {
      localStorage.setItem(PANEL_KEY, open ? "1" : "0");
    } catch {
      // remembering the choice is optional
    }
  };
  const togglePanel = () => showPanel(!panelOpen);
  const askQuestion = () => {
    showPanel(true);
    setAskToken((n) => n + 1);
  };

  return (
    <div className={`note${panelOpen ? " has-panel" : ""}`}>
      <div className="note-main">
        <div className="note-bar">
          {editor && <Toolbar editor={editor} onImage={() => fileInput.current?.click()} />}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void insertImage(file);
            }}
          />
          <span className="spacer" />
          <span className={`save-state is-${saveState}`} aria-live="polite">
            {saveState === "saving" ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : saveState === "saved" ? <Check size={13} aria-hidden="true" /> : null}
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Could not save" : "Saved"}
          </span>
          {confirmDelete ? (
            <span className="inline-confirm">
              Delete this note and its questions?
              <button
                className="btn-danger"
                onClick={() => {
                  deleted.current = true;
                  onDelete();
                }}
              >
                Delete note
              </button>
              <button className="btn-quiet" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <>
              <button className="icon-btn" aria-label="Delete note" title="Delete note" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
              </button>
              <button className={`btn${panelOpen ? " is-on" : ""}`} aria-expanded={panelOpen} onClick={togglePanel}>
                {panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                Questions
              </button>
            </>
          )}
        </div>

        {problem && (
          <p className="form-error note-problem" role="alert">
            {problem}
          </p>
        )}

        <div className="note-page">
          <div className="note-sheet">
            <input
            className="note-title"
            aria-label="Note title"
            placeholder="Untitled note"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              latest.current.title = event.target.value;
              scheduleSave();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editor?.commands.focus("start");
              }
            }}
          />
          <EditorContent editor={editor} className="note-body" />
          {editor && <SlashMenu editor={editor} onImage={() => fileInput.current?.click()} onQuestion={askQuestion} />}
          </div>
        </div>
      </div>

      {panelOpen && (
        <NoteQuestions
          noteId={note.id}
          topicId={note.topicId}
          savedAt={savedAt}
          getCurrentBlock={getCurrentBlock}
          getDoc={getDoc}
          flushNote={flush}
          askToken={askToken}
          onAskHandled={() => setAskToken(0)}
          onSuggest={() => {
            edited.current = false; // the request below covers what "leave" would have asked for
            void flush().then(() => onSuggest(note.id));
          }}
        />
      )}
    </div>
  );
}

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

function Toolbar({ editor, onImage }: { editor: Editor; onImage(): void }) {
  // re-render when the selection moves so the pressed states stay right
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick((n) => n + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const tool = (label: string, active: boolean, run: () => void, icon: ReactNode) => (
    <button
      type="button"
      className={`tool${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );

  const chain = () => editor.chain().focus();
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {tool("Heading", editor.isActive("heading", { level: 2 }), () => chain().toggleHeading({ level: 2 }).run(), <Heading2 size={16} />)}
      {tool("Bold", editor.isActive("bold"), () => chain().toggleBold().run(), <Bold size={15} />)}
      {tool("Italic", editor.isActive("italic"), () => chain().toggleItalic().run(), <Italic size={15} />)}
      {tool("Bulleted list", editor.isActive("bulletList"), () => chain().toggleBulletList().run(), <List size={16} />)}
      {tool("Numbered list", editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), <ListOrdered size={16} />)}
      {tool("Quote", editor.isActive("blockquote"), () => chain().toggleBlockquote().run(), <TextQuote size={16} />)}
      {tool("Code", editor.isActive("codeBlock"), () => chain().toggleCodeBlock().run(), <Code size={15} />)}
      <span className="toolbar-gap" />
      <button type="button" className="tool is-wide" onMouseDown={(event) => event.preventDefault()} onClick={onImage}>
        <ImagePlus size={16} />
        Add image
      </button>
    </div>
  );
}
