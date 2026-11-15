// The desktop shell. Almost all of Tutor's logic lives in the TypeScript
// frontend; Rust provides what a web page cannot:
//   - the windows: the main one, and a small always-on-top "sticky" window
//     that shows one question at a time on the desktop
//   - a tray icon, so Tutor keeps running after the main window is closed
//   - the SQLite database and outbound HTTP for AI calls (plugins)
//   - the system keychain for cloud API keys
//   - the built-in AI engine (engine.rs)
mod engine;

use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const KEYCHAIN_SERVICE: &str = "app.tutor.desktop";
const STICKY_WIDTH: f64 = 360.0;
const STICKY_HEIGHT: f64 = 348.0;
const STICKY_COMPACT_HEIGHT: f64 = 44.0;

// ---------- keychain ----------

fn entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    entry(&name)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- system ----------

/// Installed memory in GB, used to recommend an AI model the computer can run.
#[tauri::command]
fn total_memory_gb() -> f64 {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    system.total_memory() as f64 / 1_073_741_824.0
}

// ---------- windows ----------

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn show_main(app: AppHandle) {
    show_main_window(&app);
}

/// Put the sticky window in the bottom-right corner of the main screen.
/// The size comes from the constants: a window that has never been shown may
/// not report its real size yet.
fn place_sticky(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let width = (STICKY_WIDTH * scale) as i32;
    let height = (STICKY_HEIGHT * scale) as i32;
    let margin = (24.0 * scale) as i32;
    // leave room for the taskbar / Dock
    let bottom = (88.0 * scale) as i32;
    let x = monitor.position().x + monitor.size().width as i32 - width - margin;
    let y = monitor.position().y + monitor.size().height as i32 - height - bottom;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

static STICKY_PLACED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn sticky_show(app: AppHandle) {
    if let Some(window) = app.get_webview_window("sticky") {
        let _ = window.show();
        // Position it the first time it appears; after that it stays where the user dragged it.
        if !STICKY_PLACED.swap(true, Ordering::Relaxed) {
            place_sticky(&window);
        }
    }
}

#[tauri::command]
fn sticky_hide(app: AppHandle) {
    if let Some(window) = app.get_webview_window("sticky") {
        let _ = window.hide();
    }
}

/// Shrink the sticky window to a small bar, or restore it. The bottom edge stays where it is.
#[tauri::command]
fn sticky_compact(app: AppHandle, compact: bool) {
    let Some(window) = app.get_webview_window("sticky") else {
        return;
    };
    let before = (window.outer_position(), window.outer_size());
    let height = if compact { STICKY_COMPACT_HEIGHT } else { STICKY_HEIGHT };
    let _ = window.set_size(LogicalSize::new(STICKY_WIDTH, height));
    if let ((Ok(position), Ok(old)), Ok(new)) = (before, window.outer_size()) {
        let y = position.y + old.height as i32 - new.height as i32;
        let _ = window.set_position(PhysicalPosition::new(position.x, y));
    }
}

fn build_sticky_window(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, "sticky", WebviewUrl::App("index.html".into()))
        .title("Tutor question")
        .inner_size(STICKY_WIDTH, STICKY_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    place_sticky(&window);
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Tutor", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause sticky questions for 1 hour", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Tutor", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &quit])?;

    let mut tray = TrayIconBuilder::with_id("tutor")
        .tooltip("Tutor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            // the sticky window owns the settings; it saves the pause and hides itself
            "pause" => {
                let _ = app.emit("tutor://pause-stickies", 60);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // must be registered first: a second launch just brings the running app forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(engine::Engine::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            engine::engine_install,
            engine::engine_cancel,
            engine::engine_ensure_running,
            engine::engine_stop,
            engine::engine_remove,
            secret_set,
            secret_get,
            secret_delete,
            total_memory_gb,
            show_main,
            sticky_show,
            sticky_hide,
            sticky_compact
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            engine::stop_leftover(&handle);
            // Neither of these may stop the app from starting: without them
            // Tutor still works as a normal window.
            if let Err(error) = build_sticky_window(&handle) {
                eprintln!("sticky window unavailable: {error}");
            }
            if let Err(error) = build_tray(&handle) {
                eprintln!("tray icon unavailable: {error}");
            }

            // A hidden window's own timers may be slowed down by the system, so the
            // clock for sticky questions lives here. The sticky window decides on
            // each tick whether a question should appear.
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(15));
                let _ = handle.emit_to("sticky", "tutor://tick", ());
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window keeps Tutor running in the tray so sticky
            // questions can still appear. "Quit Tutor" in the tray menu ends it.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while starting Tutor");

    app.run(|app, event| match event {
        // the built-in AI engine is a separate program: stop it with Tutor
        tauri::RunEvent::Exit => engine::shutdown(app),
        // macOS: clicking the Dock icon brings the main window back
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show_main_window(app),
        _ => {}
    });
}
