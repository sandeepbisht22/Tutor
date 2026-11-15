import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "./styles/index.css";
import { getDb } from "./db";
import { windowKind } from "./platform";
import { loadSettings } from "./repo/settings";
import { AppProvider } from "./ui/app";
import { Shell } from "./ui/Shell";
import { StickyApp } from "./ui/StickyApp";
import { applyTheme, followThemeChanges, readTheme } from "./ui/theme";

const root = document.getElementById("root") as HTMLElement;

// colours first, so nothing flashes in the wrong theme while the database opens
applyTheme(readTheme());
followThemeChanges();

async function start() {
  const kind = await windowKind();
  document.documentElement.dataset.window = kind;
  const db = await getDb(kind);
  const settings = await loadSettings(db);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppProvider db={db} initialSettings={settings}>
        {kind === "sticky" ? <StickyApp /> : <Shell />}
      </AppProvider>
    </React.StrictMode>,
  );
}

start().catch((error: unknown) => {
  const fatal = document.createElement("div");
  fatal.className = "fatal";
  const title = document.createElement("h1");
  title.textContent = "Tutor could not start";
  const detail = document.createElement("p");
  detail.textContent = error instanceof Error ? error.message : String(error);
  fatal.append(title, detail);
  root.replaceChildren(fatal);
});
