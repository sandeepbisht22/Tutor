import { Brain, Database, Monitor, Moon, Palette, StickyNote, Sun, Target } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CLOUD_LABELS } from "../ai/provider";
import { listAnthropicModels } from "../llm/anthropic";
import { chatModels, detectLocalServers, pickModel, type DetectedServer } from "../llm/detect";
import { getFetch } from "../llm/http";
import { listOpenAiCompatibleModels } from "../llm/openaiCompatible";
import { startOfTomorrow } from "../lib/sticky";
import {
  deleteApiKey,
  desktop,
  engineCancel,
  engineInstall,
  engineRemove,
  engineStatus,
  getApiKey,
  launchAtLoginEnabled,
  onEvent,
  setApiKey,
  setLaunchAtLogin,
  totalMemoryGb,
  type EngineProgress,
  type EngineStatus,
} from "../platform";
import { clampRetention, STICKY_INTERVALS, type AiMode, type CloudProvider } from "../repo/settings";
import { errorText, useApp } from "./app";
import { readTheme, saveTheme, followThemeChanges, type ThemeChoice } from "./theme";

const MODES: { value: AiMode; label: string; detail: string }[] = [
  { value: "auto", label: "Automatic", detail: "Use a model on this computer when there is one. Otherwise use the cloud model, if you connected one." },
  { value: "device", label: "This computer only", detail: "Your notes never leave this computer." },
  { value: "cloud", label: "Cloud only", detail: "Always use the cloud model you connected." },
  { value: "off", label: "Off", detail: "No AI. You write every question and rate your own answers." },
];

const NOT_CHAT = /embed|whisper|tts|dall|image|audio|moderation|realtime|transcribe|speech|search|sora/i;

type Test = { state: "idle" | "running" } | { state: "ok" | "failed"; text: string };

export function SettingsScreen() {
  const { settings, setSetting, getProvider, resetProvider } = useApp();
  const percent = Math.round(settings.retention * 100);
  const [test, setTest] = useState<Test>({ state: "idle" });
  const [autostart, setAutostart] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => void launchAtLoginEnabled().then(setAutostart), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const runTest = async () => {
    setTest({ state: "running" });
    resetProvider();
    const started = Date.now();
    try {
      const provider = await getProvider();
      if (!provider) {
        setTest({ state: "failed", text: "No AI model is available with the current choice." });
        return;
      }
      await provider.complete([{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 30 });
      const where = provider.kind === "local" ? "on this computer" : "in the cloud";
      setTest({ state: "ok", text: `Working. ${provider.model} ${where} answered in ${((Date.now() - started) / 1000).toFixed(1)} s.` });
    } catch (problem) {
      setTest({ state: "failed", text: errorText(problem) });
    }
  };

  const paused = settings.stickyPausedUntil > now;

  return (
    <div className="page settings">
      <h1 className="page-title">Settings</h1>

      <section>
        <SectionTitle icon={<Target size={17} />}>Practice</SectionTitle>
        <label htmlFor="retention" className="field-label">
          Remember <strong className="retention-value">{percent}%</strong> of questions when they come back
        </label>
        <input
          id="retention"
          type="range"
          min={70}
          max={97}
          value={percent}
          onChange={(event) => void setSetting("retention", clampRetention(Number(event.target.value) / 100))}
        />
        <p className="muted">Higher means you forget less but are asked more often. 90% suits most people.</p>
      </section>

      <section>
        <SectionTitle icon={<StickyNote size={17} />}>Sticky questions</SectionTitle>
        <p className="muted">
          A small note appears on your desktop with one question, on top of whatever you are doing. Answer it and it goes away
          until the next one. Tutor keeps running in the {desktop ? "system tray" : "background"} after you close its window so
          the notes can appear; choose Quit Tutor from the tray icon to stop it.
        </p>
        <Toggle checked={settings.stickyEnabled} onChange={(on) => void setSetting("stickyEnabled", on)}>
          Show sticky questions
        </Toggle>
        {settings.stickyEnabled && (
          <>
            <label className="field-row">
              A new one at most every
              <select
                value={settings.stickyEveryMinutes}
                onChange={(event) => void setSetting("stickyEveryMinutes", Number(event.target.value))}
              >
                {[...new Set([...STICKY_INTERVALS, settings.stickyEveryMinutes])]
                  .sort((a, b) => a - b)
                  .map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "hour" : `${minutes / 60} hours`}
                    </option>
                  ))}
              </select>
            </label>
            <div className="row">
              {paused ? (
                <>
                  <span>
                    Paused until{" "}
                    {new Date(settings.stickyPausedUntil).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.
                  </span>
                  <button className="btn" onClick={() => void setSetting("stickyPausedUntil", 0)}>
                    Resume now
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={() => void setSetting("stickyPausedUntil", Date.now() + 60 * 60_000)}>
                    Pause for 1 hour
                  </button>
                  <button className="btn" onClick={() => void setSetting("stickyPausedUntil", startOfTomorrow(Date.now()))}>
                    Pause until tomorrow
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {desktop && (
          <Toggle
            checked={autostart}
            onChange={(on) => {
              setAutostart(on);
              void setLaunchAtLogin(on).catch(() => setAutostart(!on));
            }}
          >
            Start Tutor when I sign in to this computer
          </Toggle>
        )}
      </section>

      <section>
        <SectionTitle icon={<Brain size={17} />}>AI help</SectionTitle>
        <p className="muted">
          An AI model lets Tutor write questions from your notes and check the answers you type. Everything else works without it.
        </p>
        <div className="choice-list" role="radiogroup" aria-label="Where AI runs">
          {MODES.map((mode) => (
            <label key={mode.value} className={`choice${settings.aiMode === mode.value ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="ai-mode"
                checked={settings.aiMode === mode.value}
                onChange={() => {
                  setTest({ state: "idle" });
                  void setSetting("aiMode", mode.value);
                }}
              />
              <span>
                <strong>{mode.label}</strong>
                <span className="muted">{mode.detail}</span>
              </span>
            </label>
          ))}
        </div>

        {settings.aiMode !== "off" && (
          <>
            {settings.aiMode !== "cloud" && <DeviceModel />}
            {settings.aiMode !== "device" && <CloudModel />}

            <div className="row">
              <button className="btn" onClick={() => void runTest()} disabled={test.state === "running"}>
                {test.state === "running" ? "Testing…" : "Test the AI model"}
              </button>
              {(test.state === "ok" || test.state === "failed") && (
                <span className={test.state === "failed" ? "form-error" : "muted"} role="status">
                  {test.text}
                </span>
              )}
            </div>

            <h3 className="subhead">What the AI does</h3>
            <Toggle checked={settings.autoSuggest} onChange={(on) => void setSetting("autoSuggest", on)}>
              Suggest questions from my notes after I edit them
            </Toggle>
            <Toggle checked={settings.autoAccept} onChange={(on) => void setSetting("autoAccept", on)}>
              Add suggested questions to practice without asking me first
            </Toggle>
            <Toggle checked={settings.checkAnswers} onChange={(on) => void setSetting("checkAnswers", on)}>
              Check the answers I type
            </Toggle>
          </>
        )}
      </section>

      <Appearance />

      <section>
        <SectionTitle icon={<Database size={17} />}>Your data</SectionTitle>
        <p className="muted">
          {desktop
            ? "Notes, images, questions and your answer history are stored in one file on this computer. Nothing is uploaded unless you connect a cloud model, and then only the text needed for a request."
            : "This is the browser preview: data is kept in this browser only."}
        </p>
      </section>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="section-title">
      <span className="section-icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </h2>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange(on: boolean): void; children: ReactNode }) {
  return (
    <label className="toggle">
      <span>{children}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: "system", label: "Same as the system", icon: <Monitor size={15} /> },
  { value: "light", label: "Light", icon: <Sun size={15} /> },
  { value: "dark", label: "Dark", icon: <Moon size={15} /> },
];

/** Light or dark colours. Applies to both windows straight away. */
function Appearance() {
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  useEffect(() => followThemeChanges(setTheme), []);
  return (
    <section>
      <SectionTitle icon={<Palette size={17} />}>Appearance</SectionTitle>
      <div className="segmented" role="radiogroup" aria-label="Colours">
        {THEMES.map((option) => (
          <label key={option.value} className={`segment${theme === option.value ? " is-selected" : ""}`}>
            <input
              type="radio"
              name="theme"
              checked={theme === option.value}
              onChange={() => {
                saveTheme(option.value);
                setTheme(option.value);
              }}
            />
            {option.icon}
            {option.label}
          </label>
        ))}
      </div>
      <p className="muted">Dark colours are easier on the eyes in the evening. The sticky note stays yellow either way.</p>
    </section>
  );
}

type Setup = { state: "idle" } | { state: "running"; progress: EngineProgress | null } | { state: "failed"; text: string };

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);

/** The model on this computer: an AI app that is already running, or Tutor's own built-in engine. */
function DeviceModel() {
  const { settings, setSetting, resetProvider } = useApp();
  const [servers, setServers] = useState<DetectedServer[] | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [memory, setMemory] = useState<number | null>(null);
  const [setup, setSetup] = useState<Setup>({ state: "idle" });
  const [confirmRemove, setConfirmRemove] = useState(false);

  const look = useCallback(async () => {
    setServers(null);
    resetProvider();
    const [found, status] = await Promise.all([detectLocalServers(await getFetch()), engineStatus()]);
    setServers(found);
    setEngine(status);
    // the download keeps going in the background if Settings was closed meanwhile
    if (status.installing) setSetup((current) => (current.state === "running" ? current : { state: "running", progress: null }));
  }, [resetProvider]);

  useEffect(() => void look(), [look]);
  useEffect(() => void totalMemoryGb().then(setMemory), []);
  useEffect(
    () =>
      onEvent<EngineProgress>("tutor://engine-progress", (progress) =>
        setSetup((current) => (current.state === "running" ? { state: "running", progress } : current)),
      ),
    [],
  );

  const external = servers?.find((server) => pickModel(server.models, settings.localModel) !== null);
  const model = external ? pickModel(external.models, settings.localModel) : null;

  const install = async () => {
    setSetup({ state: "running", progress: null });
    try {
      await engineInstall();
      setSetup({ state: "idle" });
    } catch (problem) {
      const text = errorText(problem);
      setSetup(text === "cancelled" ? { state: "idle" } : { state: "failed", text });
    }
    await look();
  };

  const remove = async () => {
    setConfirmRemove(false);
    try {
      await engineRemove();
    } catch (problem) {
      setSetup({ state: "failed", text: errorText(problem) });
    }
    await look();
  };

  const progress = setup.state === "running" ? setup.progress : null;
  const fraction = progress && progress.total > 0 ? progress.received / progress.total : null;

  return (
    <div className="panel">
      <h3>On this computer</h3>

      {servers === null || engine === null ? (
        <p>Looking for an AI model on this computer…</p>
      ) : external && model ? (
        <>
          <p>
            <strong>Ready.</strong> Using {model} through {external.label}, which is running on this computer.
          </p>
          {external.models.length > 1 && (
            <label className="field-row">
              Model
              <select value={model} onChange={(event) => void setSetting("localModel", event.target.value)}>
                {external.models.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : engine.installed ? (
        <p>
          <strong>Ready.</strong> Using Tutor's built-in AI ({engine.modelName}). It starts by itself when it is needed and
          frees its memory after a few idle minutes.
        </p>
      ) : !desktop ? (
        <p className="muted">The built-in AI is part of the desktop app. This browser preview only finds Ollama and LM Studio.</p>
      ) : setup.state === "running" ? (
        <div className="download">
          <p>
            <strong>
              {progress?.stage === "model"
                ? "Downloading the AI model…"
                : progress?.stage === "unpacking"
                  ? "Unpacking the AI engine…"
                  : "Downloading the AI engine…"}
            </strong>
          </p>
          <progress value={fraction ?? undefined} max={1} aria-label="Download progress" />
          <div className="row">
            <span className="muted">
              {progress && fraction !== null
                ? `${Math.round(fraction * 100)}% of ${gb(progress.total)} GB`
                : "Starting…"}
            </span>
            <button className="btn-quiet" onClick={() => void engineCancel()}>
              Pause download
            </button>
          </div>
          <p className="muted">You can keep using Tutor. The download continues if you leave this screen.</p>
        </div>
      ) : (
        <>
          <p>
            <strong>Tutor can set up AI on this computer for you.</strong> It is a one-time download of about 2.6 GB. After
            that it works without internet, and your notes never leave this computer. Nothing else needs to be installed.
          </p>
          {memory !== null && memory < 7 && (
            <p className="muted">
              This computer has {Math.round(memory)} GB of memory. The AI will work, but slowly; a cloud model may suit it better.
            </p>
          )}
          <div className="row">
            <button className="btn-primary" onClick={() => void install()}>
              Set up AI on this computer
            </button>
          </div>
          {setup.state === "failed" && (
            <p className="form-error">
              The setup did not finish: {setup.text} Choose the button again to continue where it stopped.
            </p>
          )}
        </>
      )}

      {servers !== null && engine !== null && setup.state !== "running" && (
        <div className="row">
          <button className="btn-quiet" onClick={() => void look()}>
            Look again
          </button>
          {engine.installed &&
            (confirmRemove ? (
              <>
                <span>Delete the built-in AI (about 2.6 GB)?</span>
                <button className="btn-danger" onClick={() => void remove()}>
                  Delete it
                </button>
                <button className="btn-quiet" onClick={() => setConfirmRemove(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button className="btn-quiet" onClick={() => setConfirmRemove(true)}>
                Remove the built-in AI
              </button>
            ))}
        </div>
      )}
      {servers !== null && !external && (
        <p className="hint">Already use Ollama or LM Studio? Tutor uses their models instead whenever one of them is running.</p>
      )}
    </div>
  );
}

/** Connecting Claude or ChatGPT with the user's own API key. */
function CloudModel() {
  const { settings, setSetting, resetProvider } = useApp();
  const [provider, setProvider] = useState<Exclude<CloudProvider, "">>(settings.cloudProvider || "anthropic");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const connected = settings.cloudProvider !== "";

  const loadModels = useCallback(async (which: Exclude<CloudProvider, "">, apiKey: string) => {
    const fetch = await getFetch();
    const list =
      which === "anthropic"
        ? await listAnthropicModels(apiKey, fetch)
        : chatModels(await listOpenAiCompatibleModels("https://api.openai.com/v1", fetch, { apiKey })).filter(
            (name) => !NOT_CHAT.test(name),
          );
    return list;
  }, []);

  // when already connected, fetch the model list for the picker
  useEffect(() => {
    if (!settings.cloudProvider) return;
    const which = settings.cloudProvider;
    let active = true;
    void getApiKey(which)
      .then((stored) => (stored ? loadModels(which, stored) : []))
      .then((list) => active && setModels(list))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadModels, settings.cloudProvider]);

  const connect = async () => {
    setState({ busy: true, error: null });
    try {
      const list = await loadModels(provider, key.trim()); // also proves the key works
      if (list.length === 0) throw new Error("That key works, but no usable model was found on the account.");
      await setApiKey(provider, key.trim());
      setModels(list);
      await setSetting("cloudModel", list[0]);
      await setSetting("cloudProvider", provider);
      setKey("");
      setState({ busy: false, error: null });
    } catch (problem) {
      setState({ busy: false, error: `Could not connect: ${errorText(problem)}` });
    }
  };

  const disconnect = async () => {
    if (settings.cloudProvider) await deleteApiKey(settings.cloudProvider);
    await setSetting("cloudProvider", "");
    await setSetting("cloudModel", "");
    setModels([]);
    resetProvider();
  };

  return (
    <div className="panel">
      <h3>In the cloud</h3>
      {connected && settings.cloudProvider ? (
        <>
          <p>
            <strong>Connected to {CLOUD_LABELS[settings.cloudProvider]}.</strong> When the cloud model is used, the paragraph
            being worked on, or your typed answer, is sent to that company.
          </p>
          <label className="field-row">
            Model
            <select value={settings.cloudModel} onChange={(event) => void setSetting("cloudModel", event.target.value)}>
              {[...new Set([settings.cloudModel, ...models])].filter(Boolean).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => void disconnect()}>
            Disconnect and delete the key
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Use Claude or ChatGPT instead of a model on this computer. This needs an API key, which is a separate, pay-per-use
            account with the provider and is not included in a Claude or ChatGPT subscription. The key is kept in your
            system's password store. Text from your notes is sent to the provider when the cloud model is used.
          </p>
          <div className="row">
            <select aria-label="Provider" value={provider} onChange={(event) => setProvider(event.target.value as "anthropic" | "openai")}>
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="openai">ChatGPT (OpenAI)</option>
            </select>
            <input
              className="text-input"
              type="password"
              aria-label="API key"
              placeholder="Paste your API key"
              autoComplete="off"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <button className="btn-primary" disabled={key.trim() === "" || state.busy} onClick={() => void connect()}>
              {state.busy ? "Connecting…" : "Connect"}
            </button>
          </div>
          {state.error && <p className="form-error">{state.error}</p>}
        </>
      )}
    </div>
  );
}
