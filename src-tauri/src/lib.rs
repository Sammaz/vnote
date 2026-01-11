mod db;

use db::{AiConfig, AppSettings, Database};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

const TRAY_ICON: &[u8] = include_bytes!("../icons/icon.png");
static TRAY_ENABLED: AtomicBool = AtomicBool::new(false);
const TRAY_ID: &str = "vnote-tray";
static DATABASE: OnceLock<Database> = OnceLock::new();

fn get_db() -> &'static Database {
    DATABASE.get().expect("Database not initialized")
}

fn create_tray(app: &AppHandle) -> Result<(), String> {
    let show_item = MenuItemBuilder::with_id("show", "显示窗口")
        .build(app)
        .map_err(|e| e.to_string())?;

    let quit_item = MenuItemBuilder::with_id("quit", "退出")
        .build(app)
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|e| e.to_string())?;

    let icon = Image::from_bytes(TRAY_ICON).map_err(|e| e.to_string())?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("VNote - AI视频笔记")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn remove_tray(app: &AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(false).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_tray_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let was_enabled = TRAY_ENABLED.swap(enabled, Ordering::SeqCst);

    if enabled && !was_enabled {
        create_tray(&app)?;
    } else if !enabled && was_enabled {
        remove_tray(&app)?;
    }

    // Persist to database
    get_db()
        .set_setting("tray_enabled", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_tray_enabled() -> bool {
    TRAY_ENABLED.load(Ordering::SeqCst)
}

#[tauri::command]
fn show_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        {
            let _ = window.set_decorations(false);
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

// AI Config commands
#[tauri::command]
fn get_ai_configs() -> Result<Vec<AiConfig>, String> {
    get_db().get_all_ai_configs().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_ai_config(config: AiConfig) -> Result<i64, String> {
    get_db().create_ai_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_ai_config(config: AiConfig) -> Result<(), String> {
    get_db().update_ai_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_ai_config(id: i64) -> Result<(), String> {
    get_db().delete_ai_config(id).map_err(|e| e.to_string())
}

// App settings commands
#[tauri::command]
fn get_app_settings() -> Result<AppSettings, String> {
    get_db().get_app_settings().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_theme(theme: String) -> Result<(), String> {
    get_db()
        .set_setting("theme", &theme)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");

            let db = Database::new(app_data_dir).expect("Failed to initialize database");

            // Load tray setting from database
            if let Ok(settings) = db.get_app_settings() {
                TRAY_ENABLED.store(settings.tray_enabled, Ordering::SeqCst);
                if settings.tray_enabled {
                    let _ = create_tray(app.handle());
                }
            }

            DATABASE.set(db).expect("Database already initialized");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_tray_enabled,
            get_tray_enabled,
            show_window,
            get_ai_configs,
            create_ai_config,
            update_ai_config,
            delete_ai_config,
            get_app_settings,
            set_theme,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if TRAY_ENABLED.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
