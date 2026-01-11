mod chat;
mod db;
mod rag;
mod subtitle;

use chat::ChatRequest;
use db::{AiConfig, AppSettings, CreateNoteRequest, Database, EmbeddingConfig, Note, RerankerConfig};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

const TRAY_ICON: &[u8] = include_bytes!("../icons/icon.png");
static TRAY_ENABLED: AtomicBool = AtomicBool::new(false);
const TRAY_ID: &str = "vnote-tray";
pub static DATABASE: OnceLock<Database> = OnceLock::new();

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

#[tauri::command]
fn set_default_ai_config(id: i64) -> Result<(), String> {
    get_db().set_default_ai_config(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn unset_default_ai_config(id: i64) -> Result<(), String> {
    get_db().unset_default_ai_config(id).map_err(|e| e.to_string())
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

#[tauri::command]
fn get_setting(key: String) -> Result<Option<String>, String> {
    get_db()
        .get_setting(&key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(key: String, value: String) -> Result<(), String> {
    get_db()
        .set_setting(&key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

/// Convert TS file to MP4 using ffmpeg (fast remux, no re-encoding)
/// Returns the path to the converted MP4 file
#[tauri::command]
async fn convert_ts_to_mp4(app: AppHandle, ts_path: String) -> Result<String, String> {
    let ts_path = Path::new(&ts_path);

    // Verify it's a .ts file
    if ts_path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) != Some("ts".to_string()) {
        return Err("Not a .ts file".to_string());
    }

    // Create output path in app cache directory
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    // Generate output filename based on input file hash
    let file_name = ts_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let mp4_path = cache_dir.join(format!("{}.mp4", file_name));

    // If already converted, return existing file
    if mp4_path.exists() {
        // Check if the mp4 file is newer than the ts file
        let ts_modified = std::fs::metadata(&ts_path)
            .and_then(|m| m.modified())
            .ok();
        let mp4_modified = std::fs::metadata(&mp4_path)
            .and_then(|m| m.modified())
            .ok();

        if let (Some(ts_time), Some(mp4_time)) = (ts_modified, mp4_modified) {
            if mp4_time > ts_time {
                return Ok(mp4_path.to_string_lossy().to_string());
            }
        }
    }

    // Run ffmpeg to remux (copy streams, no re-encoding)
    let output = Command::new("ffmpeg")
        .args([
            "-y",                           // Overwrite output
            "-i", &ts_path.to_string_lossy(), // Input file
            "-c", "copy",                   // Copy all streams (no re-encoding)
            "-movflags", "+faststart",      // Enable fast start for streaming
            &mp4_path.to_string_lossy(),    // Output file
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}. Please ensure ffmpeg is installed.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg conversion failed: {}", stderr));
    }

    Ok(mp4_path.to_string_lossy().to_string())
}

/// Check if ffmpeg is available
#[tauri::command]
fn check_ffmpeg() -> Result<bool, String> {
    match Command::new("ffmpeg").arg("-version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// Get the total size of video cache (converted MP4 files)
#[tauri::command]
fn get_video_cache_size(app: AppHandle) -> Result<u64, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;

    if !cache_dir.exists() {
        return Ok(0);
    }

    let mut total_size: u64 = 0;

    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("mp4") {
                if let Ok(metadata) = std::fs::metadata(&path) {
                    total_size += metadata.len();
                }
            }
        }
    }

    Ok(total_size)
}

/// Clear video cache (delete all converted MP4 files)
#[tauri::command]
fn clear_video_cache(app: AppHandle) -> Result<u64, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;

    if !cache_dir.exists() {
        return Ok(0);
    }

    let mut cleared_size: u64 = 0;

    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("mp4") {
                if let Ok(metadata) = std::fs::metadata(&path) {
                    let file_size = metadata.len();
                    if std::fs::remove_file(&path).is_ok() {
                        cleared_size += file_size;
                    }
                }
            }
        }
    }

    Ok(cleared_size)
}

// Note commands
#[tauri::command]
fn get_notes() -> Result<Vec<Note>, String> {
    get_db().get_all_notes().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_note(id: i64) -> Result<Option<Note>, String> {
    get_db().get_note_by_id(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_note(req: CreateNoteRequest) -> Result<Note, String> {
    get_db().create_note(&req).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_note(note: Note) -> Result<(), String> {
    get_db().update_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(app: AppHandle, id: i64) -> Result<(), String> {
    let db = get_db();

    // Get note info before deleting to check if we need to clean up cache
    if let Ok(Some(note)) = db.get_note_by_id(id) {
        let video_path = Path::new(&note.video_path);

        // Check if this is a TS video file
        if video_path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) == Some("ts".to_string()) {
            // Calculate the cache file path
            if let Ok(cache_dir) = app.path().app_cache_dir() {
                if let Some(file_name) = video_path.file_stem().and_then(|s| s.to_str()) {
                    let cache_file = cache_dir.join(format!("{}.mp4", file_name));
                    // Delete the cache file if it exists
                    if cache_file.exists() {
                        let _ = std::fs::remove_file(&cache_file);
                    }
                }
            }
        }
    }

    db.delete_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_playback_position(note_id: i64, position: f64) -> Result<(), String> {
    get_db().update_playback_position(note_id, position).map_err(|e| e.to_string())
}

// Chat commands
#[tauri::command]
async fn chat_stream(app: AppHandle, request: ChatRequest) -> Result<String, String> {
    chat::chat_stream(app, get_db(), request).await
}

#[tauri::command]
async fn abort_chat(request_id: String) -> Result<(), String> {
    chat::abort_chat_stream(request_id).await
}

// Clear subtitle index (for re-indexing)
#[tauri::command]
fn clear_subtitle_index(note_id: i64) -> Result<(), String> {
    rag::clear_subtitle_index(note_id)
}

// Generate suggested questions for a note
#[tauri::command]
async fn generate_questions_for_note(note_id: i64) -> Result<Vec<String>, String> {
    let db = get_db();

    // Get note
    let note = db
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    // Default questions
    let default_questions = vec![
        "这个视频的核心内容是什么?".to_string(),
        "有哪些关键知识点?".to_string(),
        "如何在实际项目中应用?".to_string(),
    ];

    // Check if subtitle and model exist
    let subtitle_path = match &note.subtitle_path {
        Some(p) => p.clone(),
        None => {
            // No subtitle, save and return default
            let questions_json = serde_json::to_string(&default_questions).map_err(|e| e.to_string())?;
            db.update_note_questions(note_id, &questions_json).map_err(|e| e.to_string())?;
            return Ok(default_questions);
        }
    };
    let model_id = match note.model_id {
        Some(id) => id,
        None => {
            // No model, save and return default
            let questions_json = serde_json::to_string(&default_questions).map_err(|e| e.to_string())?;
            db.update_note_questions(note_id, &questions_json).map_err(|e| e.to_string())?;
            return Ok(default_questions);
        }
    };

    // Generate questions (use default on failure)
    let questions = chat::generate_suggested_questions(db, &subtitle_path, model_id)
        .await
        .unwrap_or_else(|e| {
            eprintln!("Failed to generate questions: {}", e);
            default_questions.clone()
        });

    // Save to database
    let questions_json = serde_json::to_string(&questions).map_err(|e| e.to_string())?;
    db.update_note_questions(note_id, &questions_json).map_err(|e| e.to_string())?;

    // Return questions to frontend
    Ok(questions)
}

// Embedding config commands
#[tauri::command]
fn get_embedding_configs() -> Result<Vec<EmbeddingConfig>, String> {
    get_db().get_all_embedding_configs().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_embedding_config(config: EmbeddingConfig) -> Result<i64, String> {
    get_db().create_embedding_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_embedding_config(config: EmbeddingConfig) -> Result<(), String> {
    get_db().update_embedding_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_embedding_config(id: i64) -> Result<(), String> {
    get_db().delete_embedding_config(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_default_embedding_config(id: i64) -> Result<(), String> {
    get_db().set_default_embedding_config(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn unset_default_embedding_config(id: i64) -> Result<(), String> {
    get_db().unset_default_embedding_config(id).map_err(|e| e.to_string())
}

// Reranker config commands
#[tauri::command]
fn get_reranker_configs() -> Result<Vec<RerankerConfig>, String> {
    get_db().get_all_reranker_configs().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_reranker_config(config: RerankerConfig) -> Result<i64, String> {
    get_db().create_reranker_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_reranker_config(config: RerankerConfig) -> Result<(), String> {
    get_db().update_reranker_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_reranker_config(id: i64) -> Result<(), String> {
    get_db().delete_reranker_config(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_default_reranker_config(id: i64) -> Result<(), String> {
    get_db().set_default_reranker_config(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn unset_default_reranker_config(id: i64) -> Result<(), String> {
    get_db().unset_default_reranker_config(id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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

            // 设置窗口大小为屏幕的90%
            if let Some(window) = app.get_webview_window("main") {
                let (width, height) = if let Some(monitor) = window.primary_monitor().ok().flatten() {
                    let screen_size = monitor.size();
                    let scale_factor = monitor.scale_factor();

                    // 计算90%的屏幕尺寸（考虑缩放因子）
                    let w = (screen_size.width as f64 / scale_factor * 0.9) as f64;
                    let h = (screen_size.height as f64 / scale_factor * 0.9) as f64;
                    (w, h)
                } else {
                    // 备用尺寸：如果无法获取屏幕尺寸
                    (1440.0, 1000.0)
                };

                // 设置窗口大小
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));

                // 居中显示
                let _ = window.center();
            }

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
            set_default_ai_config,
            unset_default_ai_config,
            get_app_settings,
            set_theme,
            get_setting,
            set_setting,
            read_file_content,
            convert_ts_to_mp4,
            check_ffmpeg,
            get_video_cache_size,
            clear_video_cache,
            get_notes,
            get_note,
            create_note,
            update_note,
            delete_note,
            update_playback_position,
            chat_stream,
            abort_chat,
            clear_subtitle_index,
            generate_questions_for_note,
            get_embedding_configs,
            create_embedding_config,
            update_embedding_config,
            delete_embedding_config,
            set_default_embedding_config,
            unset_default_embedding_config,
            get_reranker_configs,
            create_reranker_config,
            update_reranker_config,
            delete_reranker_config,
            set_default_reranker_config,
            unset_default_reranker_config,
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
