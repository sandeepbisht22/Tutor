// Tutor's built-in AI engine.
//
// Tutor does not ship a model inside the installer (it would add gigabytes).
// Instead, the first time the user asks for AI on this computer, Tutor
// downloads two things into its own data folder:
//
//   1. the engine: llama.cpp's `llama-server`, from the project's official
//      GitHub releases, for this operating system and processor
//   2. the model: one GGUF file from Hugging Face
//
// After that, Tutor starts the engine itself when AI is needed, talks to it
// over a local port, and stops it when Tutor quits. Nothing else has to be
// installed and nothing leaves the computer.
//
// The engine unloads the model from memory after a few idle minutes
// (`--sleep-idle-seconds`) and loads it again on the next request.

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// The model Tutor downloads. A 4-billion-parameter model in 4-bit form:
/// about 2.5 GB on disk, and it runs on a computer with 8 GB of memory.
/// To change it, point this at another GGUF file and update MODEL_NAME.
const MODEL_URL: &str =
    "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf";
const MODEL_NAME: &str = "Qwen3 4B";
const MODEL_FILE: &str = "model.gguf";

/// Where the newest engine build is listed.
const RELEASE_API: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";

/// File that remembers where the server program is inside the unpacked engine.
const SERVER_PATH_FILE: &str = "server-path.txt";
/// "<process id> <port>" of the engine Tutor started, so a later launch can
/// clean up if Tutor was closed without the chance to stop it.
const PID_FILE: &str = "engine.pid";

const CONTEXT_TOKENS: &str = "4096";
const IDLE_SECONDS: &str = "300";
const START_TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Default)]
pub struct Engine {
    running: Mutex<Option<Running>>,
    installing: AtomicBool,
    cancel: AtomicBool,
    /// only one caller at a time may start the engine
    starting: tokio::sync::Mutex<()>,
}

struct Running {
    child: Child,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// engine and model are both on disk
    installed: bool,
    installing: bool,
    running: bool,
    model_name: &'static str,
}

#[derive(Clone, Serialize)]
struct Progress {
    /// "engine" | "unpacking" | "model"
    stage: &'static str,
    received: u64,
    total: u64,
}

fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("engine");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn server_program(dir: &Path) -> Option<PathBuf> {
    let relative = fs::read_to_string(dir.join(SERVER_PATH_FILE)).ok()?;
    let path = dir.join(relative.trim());
    path.is_file().then_some(path)
}

fn model_file(dir: &Path) -> PathBuf {
    dir.join(MODEL_FILE)
}

/// The port of the engine, if its process is still alive.
fn alive_port(engine: &Engine) -> Option<u16> {
    let mut guard = engine.running.lock().ok()?;
    let running = guard.as_mut()?;
    match running.child.try_wait() {
        Ok(None) => Some(running.port),
        _ => {
            *guard = None;
            None
        }
    }
}

fn stop(engine: &Engine) {
    if let Ok(mut guard) = engine.running.lock() {
        if let Some(mut running) = guard.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

/// Called when Tutor quits.
pub fn shutdown(app: &AppHandle) {
    if let Some(engine) = app.try_state::<Engine>() {
        stop(&engine);
    }
    if let Ok(dir) = engine_dir(app) {
        let _ = fs::remove_file(dir.join(PID_FILE));
    }
}

/// Called when Tutor starts. If the last run ended abruptly (crash, forced
/// quit, power loss while asleep), its engine may still be running and holding
/// memory. Stop it. The port check makes sure the recorded process id still
/// belongs to an engine and was not reused by something else.
pub fn stop_leftover(app: &AppHandle) {
    let Ok(dir) = engine_dir(app) else { return };
    let file = dir.join(PID_FILE);
    let Ok(text) = fs::read_to_string(&file) else { return };
    let _ = fs::remove_file(&file);
    let mut parts = text.split_whitespace();
    let (Some(pid), Some(port)) = (
        parts.next().and_then(|p| p.parse::<u32>().ok()),
        parts.next().and_then(|p| p.parse::<u16>().ok()),
    ) else {
        return;
    };
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    if std::net::TcpStream::connect_timeout(&address, Duration::from_millis(400)).is_ok() {
        kill_process(pid);
    }
}

fn kill_process(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("kill").arg(pid.to_string()).status();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
}

#[tauri::command]
pub fn engine_status(app: AppHandle, engine: State<'_, Engine>) -> Result<EngineStatus, String> {
    let dir = engine_dir(&app)?;
    Ok(EngineStatus {
        installed: server_program(&dir).is_some() && model_file(&dir).is_file(),
        installing: engine.installing.load(Ordering::Relaxed),
        running: alive_port(&engine).is_some(),
        model_name: MODEL_NAME,
    })
}

// ---------- installing ----------

/// Download whatever is missing (engine, model). Progress is sent to the
/// windows as `tutor://engine-progress` events. Safe to call again after a
/// failure or a cancel: finished parts are kept and a half-downloaded model
/// continues where it stopped.
#[tauri::command]
pub async fn engine_install(app: AppHandle, engine: State<'_, Engine>) -> Result<(), String> {
    if engine.installing.swap(true, Ordering::SeqCst) {
        return Err("The download is already running.".into());
    }
    engine.cancel.store(false, Ordering::SeqCst);
    let result = install(&app, &engine).await;
    engine.installing.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn engine_cancel(engine: State<'_, Engine>) {
    engine.cancel.store(true, Ordering::SeqCst);
}

async fn install(app: &AppHandle, engine: &Engine) -> Result<(), String> {
    let dir = engine_dir(app)?;
    let client = reqwest::Client::builder()
        .user_agent(concat!("Tutor/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    if server_program(&dir).is_none() {
        let url = engine_archive_url(&client).await?;
        let name = url.rsplit('/').next().unwrap_or("engine.tar.gz").to_string();
        let archive = dir.join(&name);
        download(&client, &url, &archive, "engine", app, engine).await?;

        let _ = app.emit("tutor://engine-progress", Progress { stage: "unpacking", received: 0, total: 0 });
        let unpack_dir = dir.clone();
        let unpack_archive = archive.clone();
        tauri::async_runtime::spawn_blocking(move || unpack_engine(&unpack_archive, &unpack_dir))
            .await
            .map_err(|e| e.to_string())??;
        let _ = fs::remove_file(&archive);
    }

    let model = model_file(&dir);
    if !model.is_file() {
        let url = std::env::var("TUTOR_MODEL_URL").unwrap_or_else(|_| MODEL_URL.to_string());
        download(&client, &url, &model, "model", app, engine).await?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// The end of the engine download's file name for this computer, as the
/// llama.cpp project names its release files.
fn archive_suffix() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("-bin-macos-arm64.tar.gz"),
        ("macos", "x86_64") => Ok("-bin-macos-x64.tar.gz"),
        ("windows", "x86_64") => Ok("-bin-win-cpu-x64.zip"),
        ("windows", "aarch64") => Ok("-bin-win-cpu-arm64.zip"),
        ("linux", "x86_64") => Ok("-bin-ubuntu-x64.tar.gz"),
        ("linux", "aarch64") => Ok("-bin-ubuntu-arm64.tar.gz"),
        (os, arch) => Err(format!("There is no AI engine build for this computer ({os}, {arch}).")),
    }
}

async fn engine_archive_url(client: &reqwest::Client) -> Result<String, String> {
    // lets developers and tests point at a specific build
    if let Ok(url) = std::env::var("TUTOR_ENGINE_URL") {
        return Ok(url);
    }
    let suffix = archive_suffix()?;
    let response = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("The list of engine builds could not be loaded: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("The list of engine builds could not be loaded (status {}).", response.status().as_u16()));
    }
    let release: Release = response.json().await.map_err(|e| e.to_string())?;
    release
        .assets
        .into_iter()
        .find(|asset| asset.name.starts_with("llama-") && asset.name.ends_with(suffix))
        .map(|asset| asset.browser_download_url)
        .ok_or_else(|| "The newest engine release has no build for this computer.".to_string())
}

/// Download `url` to `dest`, through a `.part` file that is continued if it
/// already exists and the server supports it.
async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    stage: &'static str,
    app: &AppHandle,
    engine: &Engine,
) -> Result<(), String> {
    let part = PathBuf::from(format!("{}.part", dest.display()));
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);

    let mut request = client.get(url);
    if have > 0 {
        request = request.header("Range", format!("bytes={have}-"));
    }
    let mut response = request.send().await.map_err(|e| format!("The download could not start: {e}"))?;

    // The server ignored or refused the range: start over.
    if have > 0 && response.status().as_u16() != 206 {
        have = 0;
        if !response.status().is_success() {
            response = client.get(url).send().await.map_err(|e| e.to_string())?;
        }
    }
    if !response.status().is_success() {
        return Err(format!("The download failed (status {}).", response.status().as_u16()));
    }

    let total = have + response.content_length().unwrap_or(0);
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(have > 0)
        .truncate(have == 0)
        .open(&part)
        .map_err(|e| e.to_string())?;

    let mut received = have;
    let mut last_report = Instant::now() - Duration::from_secs(1);
    loop {
        if engine.cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let chunk = response
            .chunk()
            .await
            .map_err(|e| format!("The download was interrupted: {e}"))?;
        let Some(chunk) = chunk else { break };
        file.write_all(&chunk).map_err(|e| format!("The file could not be written: {e}"))?;
        received += chunk.len() as u64;
        if last_report.elapsed() >= Duration::from_millis(200) {
            last_report = Instant::now();
            let _ = app.emit("tutor://engine-progress", Progress { stage, received, total });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    if total > 0 && received < total {
        return Err("The download stopped before it finished.".into());
    }
    let _ = app.emit("tutor://engine-progress", Progress { stage, received, total: received });
    fs::rename(&part, dest).map_err(|e| e.to_string())
}

/// Unpack the engine archive into `<dir>/bin` and note where the server program is.
fn unpack_engine(archive: &Path, dir: &Path) -> Result<(), String> {
    let fresh = dir.join("bin-new");
    let _ = fs::remove_dir_all(&fresh);
    fs::create_dir_all(&fresh).map_err(|e| e.to_string())?;

    let file = File::open(archive).map_err(|e| e.to_string())?;
    let is_zip = archive.extension().is_some_and(|ext| ext == "zip");
    if is_zip {
        zip::ZipArchive::new(file)
            .and_then(|mut z| z.extract(&fresh))
            .map_err(|e| format!("The engine could not be unpacked: {e}"))?;
    } else {
        tar::Archive::new(flate2::read::GzDecoder::new(file))
            .unpack(&fresh)
            .map_err(|e| format!("The engine could not be unpacked: {e}"))?;
    }

    let server = find_server(&fresh).ok_or("The download did not contain the engine program.")?;
    let relative = server
        .strip_prefix(&fresh)
        .map_err(|e| e.to_string())?
        .to_path_buf();

    let bin = dir.join("bin");
    let _ = fs::remove_dir_all(&bin);
    fs::rename(&fresh, &bin).map_err(|e| e.to_string())?;
    fs::write(
        dir.join(SERVER_PATH_FILE),
        Path::new("bin").join(relative).to_string_lossy().as_bytes(),
    )
    .map_err(|e| e.to_string())
}

fn find_server(dir: &Path) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_server(&path) {
                return Some(found);
            }
        } else if matches!(
            path.file_name().and_then(|n| n.to_str()),
            Some("llama-server") | Some("llama-server.exe")
        ) {
            return Some(path);
        }
    }
    None
}

// ---------- running ----------

/// Make sure the engine is running and has the model loaded. Returns the
/// local port it listens on.
#[tauri::command]
pub async fn engine_ensure_running(app: AppHandle, engine: State<'_, Engine>) -> Result<u16, String> {
    let _one_at_a_time = engine.starting.lock().await;
    let dir = engine_dir(&app)?;

    let port = match alive_port(&engine) {
        Some(port) => port,
        None => {
            let server = server_program(&dir).ok_or("The AI engine is not installed.")?;
            let model = model_file(&dir);
            if !model.is_file() {
                return Err("The AI model is not installed.".into());
            }
            let port = free_port()?;
            let child = spawn_server(&server, &model, port, &dir)?;
            let _ = fs::write(dir.join(PID_FILE), format!("{} {}", child.id(), port));
            *engine.running.lock().map_err(|e| e.to_string())? = Some(Running { child, port });
            port
        }
    };

    // Wait until the model is loaded.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let health = format!("http://127.0.0.1:{port}/health");
    let started = Instant::now();
    loop {
        if alive_port(&engine).is_none() {
            return Err(format!("The AI engine stopped while starting. {}", log_tail(&dir)));
        }
        if let Ok(response) = client.get(&health).send().await {
            if response.status().is_success() {
                return Ok(port);
            }
        }
        if started.elapsed() > START_TIMEOUT {
            stop(&engine);
            return Err("The AI engine took too long to start.".into());
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

fn spawn_server(server: &Path, model: &Path, port: u16, dir: &Path) -> Result<Child, String> {
    let log = File::create(dir.join("engine.log")).map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let home = server.parent().unwrap_or(dir);

    let mut command = Command::new(server);
    command
        .arg("--model")
        .arg(model)
        .args(["--host", "127.0.0.1"])
        .args(["--port", &port.to_string()])
        .args(["--ctx-size", CONTEXT_TOKENS])
        .args(["--parallel", "1"])
        // Tutor's requests are short and need answers, not visible reasoning
        .args(["--reasoning-budget", "0"])
        // free the model's memory when Tutor has not asked anything for a while
        .args(["--sleep-idle-seconds", IDLE_SECONDS])
        .current_dir(home)
        // the engine's own libraries sit next to the program
        .env("LD_LIBRARY_PATH", home)
        .env("DYLD_LIBRARY_PATH", home)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window flashing up
        command.creation_flags(0x0800_0000);
    }

    command
        .spawn()
        .map_err(|e| format!("The AI engine could not be started: {e}"))
}

/// The last lines the engine wrote, to explain a failed start.
fn log_tail(dir: &Path) -> String {
    let text = fs::read_to_string(dir.join("engine.log")).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(3)..].join(" ")
}

#[tauri::command]
pub fn engine_stop(engine: State<'_, Engine>) {
    stop(&engine);
}

/// Stop the engine and delete it and the model from disk.
#[tauri::command]
pub fn engine_remove(app: AppHandle, engine: State<'_, Engine>) -> Result<(), String> {
    if engine.installing.load(Ordering::Relaxed) {
        return Err("Wait for the download to finish or cancel it first.".into());
    }
    stop(&engine);
    let dir = engine_dir(&app)?;
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}
