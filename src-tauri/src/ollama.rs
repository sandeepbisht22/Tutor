// Ollama, when it is installed but not running.
//
// Tutor uses Ollama's models whenever Ollama is running. But Ollama is often
// installed and stopped: installed with Homebrew (which does not start it at
// login unless asked), or with "open at login" switched off. Then Tutor starts
// `ollama serve` itself when AI is needed, and stops it again when Tutor
// quits. An Ollama that was already running is never touched.

use std::{
    env,
    fs::{self, File},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// Where Tutor looks for Ollama; src/llm/detect.ts uses the same address.
const ADDRESS: &str = "127.0.0.1:11434";
const START_TIMEOUT: Duration = Duration::from_secs(30);
/// How long Ollama gets to stop by itself (and stop its model process) before it is forced.
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const LOG_FILE: &str = "ollama.log";

#[derive(Default)]
pub struct Ollama {
    /// the `ollama serve` Tutor started, if any
    child: Mutex<Option<Child>>,
    /// only one caller at a time may start it
    starting: tokio::sync::Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OllamaState {
    /// it was running already
    Running,
    /// Tutor started it just now
    Started,
    /// it is not installed
    Missing,
}

/// Start Ollama if it is installed and not running, and wait until it answers.
#[tauri::command]
pub async fn ollama_start(app: AppHandle, ollama: State<'_, Ollama>) -> Result<OllamaState, String> {
    let _one_at_a_time = ollama.starting.lock().await;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    if responds(&client).await {
        return Ok(OllamaState::Running);
    }
    let Some(program) = find_program() else {
        return Ok(OllamaState::Missing);
    };

    let log = log_path(&app)?;
    if !child_alive(&ollama) {
        let child = spawn(&program, &log)?;
        *ollama.child.lock().map_err(|e| e.to_string())? = Some(child);
    }

    let started = Instant::now();
    loop {
        if responds(&client).await {
            return Ok(OllamaState::Started);
        }
        if !child_alive(&ollama) {
            return Err(format!("Ollama stopped while starting. {}", log_tail(&log)));
        }
        if started.elapsed() > START_TIMEOUT {
            stop(&ollama);
            return Err("Ollama took too long to start.".into());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

/// Called when Tutor quits: stop the Ollama that Tutor started, if any.
pub fn shutdown(app: &AppHandle) {
    if let Some(ollama) = app.try_state::<Ollama>() {
        stop(&ollama);
    }
}

async fn responds(client: &reqwest::Client) -> bool {
    match client.get(format!("http://{ADDRESS}/api/version")).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// Places Ollama's installers put the program. An app opened from the Finder
/// or the Start menu does not get the PATH a terminal has, so these are
/// checked by name first.
fn candidates() -> Vec<PathBuf> {
    let mut list: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        list.push("/opt/homebrew/bin/ollama".into());
        list.push("/usr/local/bin/ollama".into());
        list.push("/Applications/Ollama.app/Contents/Resources/ollama".into());
        if let Some(home) = env::var_os("HOME") {
            list.push(PathBuf::from(home).join("Applications/Ollama.app/Contents/Resources/ollama"));
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        list.push(PathBuf::from(local).join("Programs").join("Ollama").join("ollama.exe"));
    }
    #[cfg(target_os = "linux")]
    {
        list.push("/usr/local/bin/ollama".into());
        list.push("/usr/bin/ollama".into());
    }
    let name = if cfg!(windows) { "ollama.exe" } else { "ollama" };
    if let Some(path) = env::var_os("PATH") {
        list.extend(env::split_paths(&path).map(|dir| dir.join(name)));
    }
    list
}

fn find_program() -> Option<PathBuf> {
    candidates().into_iter().find(|path| path.is_file())
}

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(LOG_FILE))
}

fn spawn(program: &Path, log: &Path) -> Result<Child, String> {
    let out = File::create(log).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;

    let mut command = Command::new(program);
    command
        .arg("serve")
        // the address Tutor looks at, whatever OLLAMA_HOST says elsewhere
        .env("OLLAMA_HOST", ADDRESS)
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window flashing up
        command.creation_flags(0x0800_0000);
    }

    command
        .spawn()
        .map_err(|e| format!("Ollama could not be started: {e}"))
}

/// Is the Ollama Tutor started still running?
fn child_alive(ollama: &Ollama) -> bool {
    let Ok(mut guard) = ollama.child.lock() else {
        return false;
    };
    match guard.as_mut().map(|child| child.try_wait()) {
        Some(Ok(None)) => true,
        Some(_) => {
            *guard = None;
            false
        }
        None => false,
    }
}

/// Ask Ollama to stop, so it also ends the model process it started; force it
/// if it has not stopped after a few seconds.
fn stop(ollama: &Ollama) {
    let Some(mut child) = ollama.child.lock().ok().and_then(|mut guard| guard.take()) else {
        return;
    };
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status();
        let deadline = Instant::now() + STOP_TIMEOUT;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // /T: the model process Ollama started goes with it
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The last lines Ollama wrote, to explain a failed start.
fn log_tail(log: &Path) -> String {
    let text = fs::read_to_string(log).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(3)..].join(" ")
}
