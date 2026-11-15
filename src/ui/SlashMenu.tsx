import type { Editor } from "@tiptap/react";
import { Code, Heading2, Heading3, ImagePlus, List, ListOrdered, MessageCircleQuestion, Minus, TextQuote, Type } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  editor: Editor;
  onImage(): void;
  onQuestion(): void;
}

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  words: string;
  run(editor: Editor): void;
}

interface Slash {
  /** where the "/" is in the document */
  from: number;
  query: string;
  left: number;
  top: number;
}

const MENU_WIDTH = 288;
const MENU_ROOM = 340;

/**
 * Type "/" in a paragraph to turn it into something else, add an image, or ask
 * a question about it. Arrow keys move, Enter picks, Escape closes; typing
 * after the "/" filters the list.
 */
export function SlashMenu({ editor, onImage, onQuestion }: Props) {
  const [slash, setSlash] = useState<Slash | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // the "/" the menu was closed on with Escape: it stays closed for that "/" until it is deleted
  const dismissed = useRef<number | null>(null);

  const commands: Command[] = [
    { id: "question", label: "Ask a question about this", hint: "Write a question linked to this paragraph", icon: <MessageCircleQuestion size={17} />, words: "question ask quiz card", run: () => onQuestion() },
    { id: "text", label: "Text", hint: "A plain paragraph", icon: <Type size={17} />, words: "text paragraph plain", run: (e) => e.chain().focus().setParagraph().run() },
    { id: "h2", label: "Heading", hint: "A section title", icon: <Heading2 size={17} />, words: "heading title h2", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { id: "h3", label: "Subheading", hint: "A smaller title", icon: <Heading3 size={17} />, words: "subheading heading h3", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { id: "bullets", label: "Bulleted list", hint: "A list of points", icon: <List size={17} />, words: "bullet list unordered points", run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: "numbers", label: "Numbered list", hint: "Steps in order", icon: <ListOrdered size={17} />, words: "numbered ordered list steps", run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: "quote", label: "Quote", hint: "Someone else's words", icon: <TextQuote size={17} />, words: "quote citation blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
    { id: "code", label: "Code", hint: "A block of code", icon: <Code size={17} />, words: "code snippet program", run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { id: "divider", label: "Divider", hint: "A line between sections", icon: <Minus size={17} />, words: "divider line rule separator", run: (e) => e.chain().focus().setHorizontalRule().run() },
    { id: "image", label: "Image", hint: "From your computer", icon: <ImagePlus size={17} />, words: "image picture photo figure", run: () => onImage() },
  ];
  const needle = slash?.query.toLowerCase() ?? "";
  const shown = commands.filter((command) => !needle || command.label.toLowerCase().includes(needle) || command.words.includes(needle));

  // follow the text before the cursor: open when it ends with "/" and a word
  useEffect(() => {
    const look = () => {
      const { state, view } = editor;
      const { selection } = state;
      const $from = selection.$from;
      if (!selection.empty || !editor.isFocused || $from.parent.type.name === "codeBlock" || !$from.parent.isTextblock) {
        setSlash(null);
        return;
      }
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
      const match = /(?:^|\s)\/([\p{L}\p{N}]{0,24})$/u.exec(before);
      if (!match) {
        dismissed.current = null;
        setSlash(null);
        return;
      }
      const from = $from.pos - match[1].length - 1;
      if (from === dismissed.current) {
        setSlash(null);
        return;
      }
      const at = view.coordsAtPos(from);
      const below = window.innerHeight - at.bottom > MENU_ROOM;
      setSlash({
        from,
        query: match[1],
        left: Math.min(at.left, window.innerWidth - MENU_WIDTH - 12),
        top: below ? at.bottom + 6 : Math.max(12, at.top - MENU_ROOM - 6),
      });
    };
    const close = () => setSlash(null);
    editor.on("transaction", look);
    editor.on("blur", close);
    return () => {
      editor.off("transaction", look);
      editor.off("blur", close);
    };
  }, [editor]);

  // every time the menu opens, and every time the filter changes, start at the top
  const open = slash !== null;
  useEffect(() => setActive(0), [needle, open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = useCallback(
    (command: Command) => {
      if (!slash) return;
      // remove the "/query" that opened the menu, then do the thing
      editor.chain().focus().deleteRange({ from: slash.from, to: editor.state.selection.from }).run();
      setSlash(null);
      command.run(editor);
    },
    [editor, slash],
  );

  // the editor keeps the keyboard; while the menu is open it steers the menu instead
  useEffect(() => {
    if (!slash) return;
    const dom = editor.view.dom;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (shown.length === 0 ? 0 : (index + step + shown.length) % shown.length));
      } else if ((event.key === "Enter" || event.key === "Tab") && shown.length > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pick(shown[Math.min(active, shown.length - 1)]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissed.current = slash.from;
        setSlash(null);
      }
    };
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
  }, [active, editor, pick, shown, slash]);

  if (!slash || shown.length === 0) return null;
  return createPortal(
    <div className="slash-menu" role="listbox" aria-label="Insert" ref={list} style={{ left: slash.left, top: slash.top }}>
      {shown.map((command, index) => (
        <div
          key={command.id}
          data-index={index}
          role="option"
          aria-selected={index === active}
          className={`slash-item${index === active ? " is-active" : ""}${command.id === "question" ? " is-question" : ""}`}
          onMouseMove={() => index !== active && setActive(index)}
          onMouseDown={(event) => {
            event.preventDefault(); // keep the editor focused
            pick(command);
          }}
        >
          <span className="slash-icon">{command.icon}</span>
          <span className="slash-text">
            <span className="slash-label">{command.label}</span>
            <span className="slash-hint">{command.hint}</span>
          </span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
