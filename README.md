# Tutor

Tutor is a desktop app for learning things and keeping them. You write notes in your own
words, Tutor turns them into questions, and it asks each question again just before you
would forget the answer. Questions also appear one at a time on a small sticky note on
your desktop, so practice happens during the day without opening the app.

It runs on macOS and Windows, stores everything on your computer, and works with or
without an AI model.

## Words Tutor uses

| Word | Meaning |
|---|---|
| **Topic** | A subject you are learning. A topic can hold sub-topics. |
| **Note** | What you wrote about a topic: text and images. |
| **Question** | Something Tutor asks you. Made from a note, by you or by the AI. |
| **Suggested question** | A question the AI wrote that you have not kept or dismissed yet. |
| **Cover** | A patch you draw over part of an image. Tutor asks what is under it. |
| **Practice** | A session of answering the questions that are ready. |
| **Sticky question** | One question on a small always-on-top note on the desktop. |
| **Forgot / Barely / Got it / Easily** | How well you remembered. Decides when the question comes back. |

## What it does

- **Topics and sub-topics**, nested as deep as you like. You look at one topic at a time.
- **Notes** with headings, lists, quotes, code and images, saved as you type.
- **Images with labels**: add text labels, boxes, arrows and covers on top of an image, and
  a description. They stay editable; the original image is never changed.
- **Questions linked to their source**: each question remembers the paragraph or image it
  came from. If that paragraph changes or is deleted, the question is flagged.
- **Questions written for you**: with an AI model, Tutor suggests questions for paragraphs
  you added or changed. You keep, edit or dismiss each one, or let Tutor add them directly.
- **Cover questions without AI**: every cover with an answer becomes a question by itself.
- **Practice** with the FSRS scheduling algorithm. Type an answer if you like; with an AI
  model Tutor checks it, says what was missing and proposes a rating you can overrule.
- **Sticky questions** at a pace you choose, with snooze, pause, and a smaller mode.
- **Progress**: answers per day, days in a row, how much you remember, how well you know
  each topic, the questions you keep forgetting, and every answer you ever gave to a
  question.
- **Find anything** with Ctrl+K (⌘K on a Mac): topics, notes by title or text, and every
  place in the app. Recently edited notes are also listed in the sidebar.
- **Type `/` in a note** to add a heading, list, quote, code, an image, or a question about
  the paragraph you are writing.
- **Answer on the card**: in practice you write your answer on the index card's lines; the
  real answer is written beneath it, so you can compare them in place.
- **Topic colours**: every topic gets its own colour and letter, used wherever its questions
  appear. Questions can be shown as a list or as cards.
- **Light and dark colours**: follows the system, or choose one in Settings.
- **AI where you want it**: Tutor's built-in AI on your computer (one button to set up,
  nothing else to install), Claude or ChatGPT with your own API key, both, or none.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer, [Rust](https://rustup.rs), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system (Xcode
command line tools on macOS; WebView2 and the MSVC build tools on Windows).

```sh
npm install
npm run app          # the desktop app, with live reload
npm run tauri build  # installer for the system you are on (.dmg, or .msi / .exe)
```

Other commands:

```sh
npm test             # unit tests
npm run typecheck
npm run dev          # the interface alone in a browser, at http://localhost:1420
```

`npm run dev` is for quick interface work. It keeps its data in the browser, has no sticky
window, and is not included in the desktop build. Add `#sticky` to the address to see the
sticky question on its own.

### Installers for both systems

An installer has to be built on the system it is for. `.github/workflows/build.yml` does
that on GitHub: push the project to a GitHub repository, open the Actions tab, run
"Build installers", and download the macOS (Apple Silicon and Intel) and Windows installers
from the draft release it creates.

The installers are not code-signed, so macOS and Windows show a warning the first time the
app is opened. Signing needs an Apple Developer account and a Windows certificate; the
Tauri documentation explains how to add them.

## AI setup

Open Settings, then "AI help".

- **On this computer.** Choose "Set up AI on this computer". Tutor downloads its AI engine
  and a model (about 2.6 GB, once) into its own data folder and shows the progress. You can
  pause the download and continue it later. After that the AI works without internet and
  your notes never leave the computer. Tutor starts the engine by itself a few seconds
  after it opens (and again whenever it is needed), frees the model's memory after five
  idle minutes, and stops the engine when Tutor quits. "Remove the
  built-in AI" deletes it again.
- **Ollama or LM Studio.** If one of these is already running on the computer, Tutor uses
  its models instead of downloading anything.
- **In the cloud.** Paste an API key for Claude (Anthropic) or ChatGPT (OpenAI). An API key
  is a separate pay-per-use account, not part of a Claude or ChatGPT subscription. The key
  is stored in the system keychain. When the cloud model is used, the paragraph being
  worked on, or your typed answer, is sent to that provider.

"Automatic" uses the computer's own AI when there is one and the cloud model otherwise.

Tutor uses the model sparingly: one small request per paragraph you added or changed, after
you leave the note, and one per typed answer that is not a word-for-word match.

### What the built-in AI is

The engine is [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server` (MIT
license). Tutor asks GitHub for the project's newest release and downloads the build for
your system: Apple Silicon or Intel on macOS, x64 or ARM on Windows. The model is Qwen3 4B
(Apache 2.0 license) in 4-bit form, from the Qwen team's page on Hugging Face. It needs
about 4 GB of free memory while it is working.

Both choices are at the top of `src-tauri/src/engine.rs`. To use a different model, change
`MODEL_URL` and `MODEL_NAME` there. For development, the environment variables
`TUTOR_ENGINE_URL` and `TUTOR_MODEL_URL` override the two downloads.

## Where your data is

One SQLite file, `tutor.db`:

- macOS: `~/Library/Application Support/app.tutor.desktop/`
- Windows: `%APPDATA%\app.tutor.desktop\`

Copy that file to back everything up, images included.

The built-in AI, if you set it up, is in an `engine` folder in the app's data folder
(the same folder on macOS; `%LOCALAPPDATA%\app.tutor.desktop\` on Windows).

## What has and has not been tested

Tested: the logic (62 unit tests), the whole interface in a browser, and the real desktop
app on Linux, including the database, AI requests, the sticky window appearing on its
timer, answering on it, and the app staying alive in the tray after the window is closed.

The built-in AI was tested on Linux with the real `llama-server`, built from the
project's current source and packed the way its releases are packed: Tutor downloaded and
unpacked it, continued a half-finished model download, started the engine, got an answer
from it, and cleaned up an engine left running after a forced quit. The downloads came
from a local server, and the model was a tiny test model, because GitHub's release files
and Hugging Face cannot be reached from the machine this was built on.

Not yet tested, because it needs the real systems or accounts:

- running on macOS and Windows (expect small visual differences to fix)
- the built-in AI on macOS and Windows, and its two real downloads: the engine from
  GitHub and the 2.5 GB Qwen3 model from Hugging Face, including how good and how fast
  that model is at writing questions and checking answers
- the sticky window above full-screen apps and across macOS Spaces
- the tray icon, "start when I sign in", and the guard against opening two copies
- storing API keys in the macOS Keychain and Windows Credential Manager
- real cloud models: the Anthropic API and the OpenAI API
- the GitHub workflow that builds the installers

## Not included

- Automatic silence during meetings or full-screen apps. Use snooze or pause.
- Graphics-card acceleration for the built-in AI on Windows (it uses the processor; on a
  Mac it uses Apple's Metal).
- Importing from other apps, syncing between computers, and a phone app.
- Rewording a question each time it is asked.

## How the code is organized

```
src/
  db/        database interface, schema, and its three drivers
             (desktop SQLite, in-browser preview, tests)
  domain/    shared types and the vocabulary
  lib/       pure logic: note blocks and hashes, FSRS wrapper, sticky pacing
  repo/      all SQL: topics, notes, images, questions, attempts, settings
  llm/       talking to models: OpenAI-compatible servers, Anthropic, detection
  ai/        what the models are used for: suggestions, answer checks,
             the background queue, choosing a model
  ui/        React screens; Shell.tsx is the main window (with Sidebar.tsx),
             StickyApp.tsx the sticky one, theme.ts the light/dark choice
  styles/    the look, one CSS file per area. tokens.css holds every colour, radius,
             shadow and motion curve for light and dark (the structure and neutrals
             follow Anytype's: white islands on a tinted desk); reduced motion is
             in motion.css
  platform.ts  everything that differs between the desktop app and the browser preview
src-tauri/   the Rust shell: windows, tray, keychain, plugins (lib.rs) and
             the built-in AI engine: download, start, stop (engine.rs)
```

Things worth knowing before changing code:

- **A note is a list of blocks.** Each top-level block (paragraph, list, image) has a
  stable id and a hash of its text. A question points at one block
  (`questions.source_block_id`) and remembers the hash it was made from.
- **`note_blocks.suggested_hash`** records what the AI has already seen, so unchanged
  paragraphs are never sent twice.
- **Images** are stored once in the `images` table. Their description, labels and covers
  live in the note's document, so they are saved and undone with the text.
- **Schema changes are migrations.** Add an entry at the end of `src/db/schema.ts`.
- **No multi-call transactions.** The SQL plugin uses a connection pool, so `BEGIN` and
  `COMMIT` sent separately may land on different connections.
- **Two windows, one database.** Only the main window runs migrations. The windows tell
  each other about changes with events (see `platform.ts`).
- **The sticky window's clock is in Rust** (`src-tauri/src/lib.rs`), because a hidden
  window's own timers can be slowed down by the system.
- **Reachable addresses** for AI requests are listed in
  `src-tauri/capabilities/default.json`: any port on this computer, and the two cloud APIs.
- **The built-in engine is a separate program** that Tutor starts on a free local port.
  `engine_ensure_running` is called before every request, so a stopped engine comes back
  by itself.

## License

Not chosen yet. Pick one before publishing the project.
