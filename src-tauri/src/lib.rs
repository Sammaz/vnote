mod ai_pool;
mod chat;
mod chapter;
mod db;
pub mod error;
mod flashcard_generation;
mod blueprint_generation;
mod highlight_generation;
mod note_generation;
mod note_initialization;
mod prompts;
mod rag;
pub mod settings;
mod subtitle;
mod subtitle_optimizer;
pub mod validation;
mod keyring_manager;

use chat::ChatRequest;
use db::{AiConfig, AppSettings, Collection, CollectionItem, CreateCollectionRequest, CreateNoteRequest, Database, EmbeddingConfig, Note, NoteUiState, OptimizedSubtitle, PromptConfig, RerankerConfig, ScreenshotMarker};
use regex::Regex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
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

// 高光生成防重复：跟踪正在生成高光的 note_id
static HIGHLIGHT_GENERATING_NOTES: OnceLock<tokio::sync::Mutex<HashSet<i64>>> = OnceLock::new();

fn get_highlight_generating_notes() -> &'static tokio::sync::Mutex<HashSet<i64>> {
    HIGHLIGHT_GENERATING_NOTES.get_or_init(|| tokio::sync::Mutex::new(HashSet::new()))
}

fn get_db() -> &'static Database {
    DATABASE.get().expect("Database not initialized")
}

/// Create ffmpeg command with hidden console window on Windows
#[cfg(windows)]
fn ffmpeg_command() -> Command {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = Command::new("ffmpeg");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn ffmpeg_command() -> Command {
    Command::new("ffmpeg")
}

/// Parse asset URLs from Markdown content
/// 
/// Extracts all `http://asset.localhost/...` format image links from Markdown content,
/// decodes URL-encoded paths, and returns a list of (asset_url, local_path, filename) tuples.
/// 
/// # Arguments
/// * `content` - Markdown content string to parse
/// 
/// # Returns
/// * `Vec<(String, PathBuf, String)>` - List of (asset_url, local_file_path, filename)
/// 
/// # Requirements
/// * 2.1: Identify all `http://asset.localhost/...` format image links
/// * 2.2: Correctly decode URL-encoded file paths (e.g., `%5C` to `\`)
/// * 2.3: Return mapping list of image links and local file paths
fn parse_asset_urls(content: &str) -> Vec<(String, PathBuf, String)> {
    let mut results = Vec::new();
    
    // Regex pattern to match Markdown image syntax with asset.localhost URLs
    // Pattern: ![alt text](http://asset.localhost/encoded_path)
    let re = Regex::new(r"!\[.*?\]\((http://asset\.localhost/[^)]+)\)").unwrap();
    
    for cap in re.captures_iter(content) {
        if let Some(url_match) = cap.get(1) {
            let asset_url = url_match.as_str().to_string();
            
            // Extract the encoded path from the URL (everything after "http://asset.localhost/")
            let encoded_path = asset_url
                .strip_prefix("http://asset.localhost/")
                .unwrap_or("");
            
            // Decode URL-encoded path (e.g., %5C -> \, %3A -> :)
            if let Ok(decoded_path) = urlencoding::decode(encoded_path) {
                let local_path = PathBuf::from(decoded_path.as_ref());
                
                // Extract filename from the path
                let filename = local_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("image")
                    .to_string();
                
                results.push((asset_url, local_path, filename));
            }
        }
    }
    
    results
}

/// Transform Markdown content by replacing asset URLs with relative paths
/// 
/// Replaces all `http://asset.localhost/...` format image links in Markdown content
/// with `./attachments/{filename}` format for portable export.
/// 
/// # Arguments
/// * `content` - Markdown content string to transform
/// * `url_mappings` - List of (asset_url, local_path, filename) tuples from parse_asset_urls
/// 
/// # Returns
/// * `String` - Transformed Markdown content with relative paths
/// 
/// # Example
/// Input: `![title](http://asset.localhost/C%3A%5C...%5C1.jpg)`
/// Output: `![title](./attachments/1.jpg)`
/// 
/// # Requirements
/// * 3.3: Replace `http://asset.localhost/...` format with `./attachments/xxx.jpg` format
fn transform_markdown_paths(
    content: &str,
    url_mappings: &[(String, PathBuf, String)], // (asset_url, local_path, filename)
) -> String {
    let mut result = content.to_string();
    
    for (asset_url, _local_path, filename) in url_mappings {
        // Replace the asset URL with the relative attachments path
        let relative_path = format!("./attachments/{}", filename);
        result = result.replace(asset_url, &relative_path);
    }
    
    result
}

/// Export visual summary as a zip file containing Markdown and images
/// 
/// This command creates a portable export package with:
/// - A Markdown file with transformed image paths
/// - An attachments directory containing all referenced images
/// 
/// # Arguments
/// * `content` - Markdown content string to export
/// * `save_path` - User-selected path for the zip file
/// * `note_title` - Note title, used for the Markdown filename inside zip
/// 
/// # Returns
/// * `Ok(())` - Export successful
/// * `Err(String)` - Error message
/// 
/// # Requirements
/// * 3.1: Create `attachments` subdirectory in temp directory
/// * 3.2: Copy all parsed images to `attachments` directory
/// * 3.4: Skip non-existent source image files and continue processing
/// * 4.1: Generate zip archive containing Markdown file
/// * 4.2: Include `attachments` directory and its contents in zip
/// * 4.3: Maintain `attachments/xxx.jpg` directory structure
#[tauri::command]
async fn export_visual_summary(
    content: String,
    save_path: String,
    note_title: String,
) -> Result<(), String> {
    use std::fs::{self, File};
    use std::io::{Read, Write};
    use zip::write::FileOptions;
    use zip::ZipWriter;

    // Create temporary directory for processing
    let temp_dir = std::env::temp_dir().join(format!("vnote_export_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("创建临时目录失败: {}", e))?;

    // Create attachments subdirectory (Requirement 3.1)
    let attachments_dir = temp_dir.join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|e| format!("创建 attachments 目录失败: {}", e))?;

    // Parse asset URLs from content
    let url_mappings = parse_asset_urls(&content);

    // Copy images to attachments directory (Requirement 3.2, 3.4)
    let mut successful_mappings: Vec<(String, PathBuf, String)> = Vec::new();
    for (asset_url, local_path, filename) in &url_mappings {
        // Skip non-existent files (Requirement 3.4)
        if !local_path.exists() {
            tracing::warn!("[export_visual_summary] 跳过不存在的文件: {:?}", local_path);
            continue;
        }

        let dest_path = attachments_dir.join(filename);
        if let Err(e) = fs::copy(local_path, &dest_path) {
            tracing::error!("[export_visual_summary] 复制文件失败 {:?}: {}", local_path, e);
            continue;
        }

        successful_mappings.push((asset_url.clone(), local_path.clone(), filename.clone()));
    }

    // Transform Markdown paths for successfully copied images
    let transformed_content = transform_markdown_paths(&content, &successful_mappings);

    // Create zip file (Requirement 4.1, 4.2, 4.3)
    let zip_file = File::create(&save_path)
        .map_err(|e| format!("创建 zip 文件失败: {}", e))?;
    let mut zip = ZipWriter::new(zip_file);

    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // Sanitize note title for filename (remove invalid characters)
    let safe_title: String = note_title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c > '\u{007F}' { c } else { '_' })
        .collect();
    let md_filename = format!("{}.md", safe_title);

    // Write Markdown file to zip (Requirement 4.1)
    zip.start_file(&md_filename, options)
        .map_err(|e| format!("写入 Markdown 文件失败: {}", e))?;
    zip.write_all(transformed_content.as_bytes())
        .map_err(|e| format!("写入 Markdown 内容失败: {}", e))?;

    // Write attachments directory and files to zip (Requirement 4.2, 4.3)
    for (_, _, filename) in &successful_mappings {
        let attachment_path = attachments_dir.join(filename);
        if attachment_path.exists() {
            let zip_path = format!("attachments/{}", filename);
            
            // Read file content
            let mut file = File::open(&attachment_path)
                .map_err(|e| format!("打开附件文件失败: {}", e))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("读取附件文件失败: {}", e))?;

            // Write to zip
            zip.start_file(&zip_path, options)
                .map_err(|e| format!("写入附件到 zip 失败: {}", e))?;
            zip.write_all(&buffer)
                .map_err(|e| format!("写入附件内容失败: {}", e))?;
        }
    }

    // Finish zip file
    zip.finish()
        .map_err(|e| format!("完成 zip 文件失败: {}", e))?;

    // Clean up temporary directory
    if let Err(e) = fs::remove_dir_all(&temp_dir) {
        tracing::warn!("[export_visual_summary] 清理临时目录失败: {}", e);
        // Don't fail the export if cleanup fails
    }

    Ok(())
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
    // 验证输入
    validation::validate_config_title(&config.title)?;
    validation::validate_url(&config.base_url)?;
    validation::validate_api_key(&config.api_key)?;
    validation::validate_model_name(&config.model)?;
    validation::validate_concurrent_limit(config.concurrent_limit)?;
    validation::validate_request_timeout(config.request_timeout)?;

    get_db().create_ai_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_ai_config(config: AiConfig) -> Result<(), String> {
    // 验证输入
    validation::validate_config_title(&config.title)?;
    validation::validate_url(&config.base_url)?;
    validation::validate_api_key(&config.api_key)?;
    validation::validate_model_name(&config.model)?;
    validation::validate_concurrent_limit(config.concurrent_limit)?;
    validation::validate_request_timeout(config.request_timeout)?;

    // 先更新数据库
    get_db().update_ai_config(&config).map_err(|e| e.to_string())?;

    // 动态更新 AI 线程池的并发限制
    crate::ai_pool::get_ai_pool_manager()
        .update_concurrent_limit(config.id, config.concurrent_limit)
        .await
        // 忽略控制器不存在的错误（可能是首次创建配置）
        .ok();

    // 动态更新 AI 线程池的超时配置
    crate::ai_pool::get_ai_pool_manager()
        .update_request_timeout(config.id, config.request_timeout)
        .await;

    Ok(())
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

/// Test API connection for AI/Embedding/Reranker configs
/// Sends a minimal request to verify the API is accessible
#[tauri::command]
async fn test_api_connection(
    base_url: String,
    api_key: String,
    model: String,
    config_type: String,
) -> Result<String, String> {
    use reqwest::Client;
    use serde_json::json;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let base_url = base_url.trim_end_matches('/');

    match config_type.as_str() {
        "ai" => {
            // Test chat completion API with minimal request
            let api_url = format!("{}/chat/completions", base_url);
            let body = json!({
                "model": model,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 1
            });

            let response = client
                .post(&api_url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("连接失败: {}", e))?;

            if response.status().is_success() {
                Ok("连接成功".to_string())
            } else {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                Err(format!("API错误 {}: {}", status, error_text))
            }
        }
        "embedding" => {
            // Test embedding API
            let api_url = format!("{}/embeddings", base_url);
            let body = json!({
                "model": model,
                "input": "test"
            });

            let response = client
                .post(&api_url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("连接失败: {}", e))?;

            if response.status().is_success() {
                Ok("连接成功".to_string())
            } else {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                Err(format!("API错误 {}: {}", status, error_text))
            }
        }
        "reranker" => {
            // Test reranker API (Cohere-style)
            let api_url = format!("{}/rerank", base_url);
            let body = json!({
                "model": model,
                "query": "test",
                "documents": ["test document"]
            });

            let response = client
                .post(&api_url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("连接失败: {}", e))?;

            if response.status().is_success() {
                Ok("连接成功".to_string())
            } else {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                Err(format!("API错误 {}: {}", status, error_text))
            }
        }
        _ => Err("未知的配置类型".to_string()),
    }
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

/// Validate and sanitize file path to prevent path traversal attacks
/// Returns the canonicalized path if valid, or an error if the path is suspicious
fn validate_file_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::Path::new(path);

    // Check for obvious path traversal patterns
    let path_str = path.to_string_lossy();
    if path_str.contains("..") {
        return Err("Path traversal detected: '..' is not allowed".to_string());
    }

    // Canonicalize the path to resolve any symbolic links and get absolute path
    let canonical = path.canonicalize()
        .map_err(|e| format!("Invalid path '{}': {}", path_str, e))?;

    // Ensure the path exists and is a file (not a directory)
    if !canonical.is_file() {
        return Err(format!("Path '{}' is not a valid file", path_str));
    }

    Ok(canonical)
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    // Validate the path first to prevent path traversal attacks
    let validated_path = validate_file_path(&path)?;

    std::fs::read_to_string(&validated_path)
        .map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

/// Save content to a file
#[tauri::command]
fn save_file_content(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

/// Convert TS file to MP4 using ffmpeg (fast remux, no re-encoding)
/// Returns the path to the converted MP4 file
#[tauri::command]
async fn convert_ts_to_mp4(app: AppHandle, ts_path: String, note_id: i64) -> Result<String, String> {
    let ts_path = Path::new(&ts_path);

    // Verify it's a .ts file
    if ts_path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) != Some("ts".to_string()) {
        return Err("Not a .ts file".to_string());
    }

    // Create output path in app cache directory, organized by note ID
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let note_cache_dir = cache_dir.join("notes").join(note_id.to_string());
    std::fs::create_dir_all(&note_cache_dir).map_err(|e| e.to_string())?;

    // Generate output filename based on input file hash
    let file_name = ts_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let mp4_path = note_cache_dir.join(format!("{}.mp4", file_name));

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
    let output = ffmpeg_command()
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
    match ffmpeg_command().arg("-version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// Get the total size of video cache (converted MP4 files only, excluding screenshots)
#[tauri::command]
fn get_video_cache_size(app: AppHandle) -> Result<u64, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let notes_cache_dir = cache_dir.join("notes");

    if !notes_cache_dir.exists() {
        return Ok(0);
    }

    let mut total_size: u64 = 0;

    // Recursively find and calculate size of MP4 files only
    fn calculate_mp4_size(dir: &std::path::Path, total: &mut u64) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in std::fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();

                // Skip screenshots directory
                if path.is_dir() && path.file_name().and_then(|n| n.to_str()) == Some("screenshots") {
                    continue;
                }

                if path.is_dir() {
                    calculate_mp4_size(&path, total)?;
                } else if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("mp4") {
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        *total += metadata.len();
                    }
                }
            }
        }
        Ok(())
    }

    let _ = calculate_mp4_size(&notes_cache_dir, &mut total_size);

    Ok(total_size)
}

/// Clear chapter screenshots for a specific note
#[tauri::command]
fn clear_chapter_screenshots(app: AppHandle, note_id: i64) -> Result<(), String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let screenshots_dir = cache_dir.join("notes").join(note_id.to_string()).join("screenshots");

    if screenshots_dir.exists() {
        std::fs::remove_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Clear video cache (delete MP4 files only, keep screenshots)
#[tauri::command]
fn clear_video_cache(app: AppHandle) -> Result<u64, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let notes_cache_dir = cache_dir.join("notes");

    if !notes_cache_dir.exists() {
        return Ok(0);
    }

    let mut cleared_size: u64 = 0;

    // Recursively find and delete MP4 files only
    fn delete_mp4_files(dir: &std::path::Path, cleared: &mut u64) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in std::fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();

                // Skip screenshots directory
                if path.is_dir() && path.file_name().and_then(|n| n.to_str()) == Some("screenshots") {
                    continue;
                }

                if path.is_dir() {
                    delete_mp4_files(&path, cleared)?;
                } else if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("mp4") {
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        let file_size = metadata.len();
                        if std::fs::remove_file(&path).is_ok() {
                            *cleared += file_size;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    let _ = delete_mp4_files(&notes_cache_dir, &mut cleared_size);

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
    // 验证输入
    validation::validate_title(&req.title)?;

    get_db().create_note(&req).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_note(note: Note) -> Result<(), String> {
    // 验证输入
    validation::validate_title(&note.title)?;
    get_db().update_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(app: AppHandle, id: i64) -> Result<(), String> {
    let db = get_db();

    // Delete entire note cache directory (includes TS video cache and chapter screenshots)
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let note_cache_dir = cache_dir.join("notes").join(id.to_string());
        if note_cache_dir.exists() {
            let _ = std::fs::remove_dir_all(&note_cache_dir);
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
    let abort_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let questions = chat::generate_suggested_questions(db, &subtitle_path, model_id, &abort_flag)
        .await
        .unwrap_or_else(|e| {
            tracing::error!("Failed to generate questions: {}", e);
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
    // 验证输入
    validation::validate_config_title(&config.title)?;
    validation::validate_url(&config.base_url)?;
    validation::validate_api_key(&config.api_key)?;
    validation::validate_model_name(&config.model)?;

    get_db().create_embedding_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_embedding_config(config: EmbeddingConfig) -> Result<(), String> {
    // 验证输入
    validation::validate_config_title(&config.title)?;
    validation::validate_url(&config.base_url)?;
    validation::validate_api_key(&config.api_key)?;
    validation::validate_model_name(&config.model)?;

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
    // 验证输入
    validation::validate_config_title(&config.title)?;
    validation::validate_url(&config.base_url)?;
    validation::validate_api_key(&config.api_key)?;
    validation::validate_model_name(&config.model)?;

    get_db().create_reranker_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_reranker_config(config: RerankerConfig) -> Result<(), String> {
    // 验证输入
    validation::validate_config_title(&config.title)?;
    validation::validate_url(&config.base_url)?;
    validation::validate_api_key(&config.api_key)?;
    validation::validate_model_name(&config.model)?;

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

// Prompt config commands
#[tauri::command]
fn get_prompt_configs() -> Result<Vec<PromptConfig>, String> {
    get_db().get_all_prompt_configs().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_prompt_config(config: PromptConfig) -> Result<i64, String> {
    // 验证输入
    validation::validate_config_title(&config.title)?;
    if let Some(ref desc) = config.description {
        validation::validate_description(desc)?;
    }
    validation::validate_prompt(&config.content)?;

    get_db().create_prompt_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_prompt_config(config: PromptConfig) -> Result<(), String> {
    // 验证输入
    validation::validate_config_title(&config.title)?;
    if let Some(ref desc) = config.description {
        validation::validate_description(desc)?;
    }
    validation::validate_prompt(&config.content)?;

    get_db().update_prompt_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_prompt_config(id: i64) -> Result<(), String> {
    get_db().delete_prompt_config(id).map_err(|e| e.to_string())
}

// Note generation commands
#[tauri::command]
async fn generate_note_content(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: i64,
    model_id: i64,
    concurrent: bool,
    regenerate: bool,
    tabs_to_generate: Vec<String>,
    concurrent_limit: Option<usize>,
    custom_prompt: Option<String>,
) -> Result<String, String> {
    use note_generation::{GenerateNoteRequest, GenerationOptions, TabType};

    // 使用前端传入的 generationId，或生成新的
    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();

    // 转换标签页类型
    let tabs: Vec<TabType> = tabs_to_generate
        .into_iter()
        .filter_map(|t| match t.as_str() {
            "full_summary" => Some(TabType::FullSummary),
            "detailed_reading" => Some(TabType::DetailedReading),
            "highlights" => Some(TabType::Highlights),
            "visual_summary" => Some(TabType::VisualSummary),
            "custom_summary" => Some(TabType::CustomSummary),
            _ => None,
        })
        .collect();

    // 使用前端传入的 concurrent_limit，或从AI配置中获取
    let concurrent_limit = concurrent_limit.unwrap_or_else(|| {
        if let Ok(Some(ai_config)) = get_db().get_ai_config_by_id(model_id) {
            ai_config.concurrent_limit as usize
        } else {
            5 // 默认5个
        }
    });

    let options = GenerationOptions {
        concurrent,
        tabs_to_generate: tabs,
        regenerate,
        concurrent_limit,
        custom_prompt,
    };

    let request = GenerateNoteRequest {
        note_id,
        model_id,
        options,
    };

    // 在后台任务中执行生成，立即返回 generation_id
    tokio::spawn(async move {
        if let Err(e) = note_generation::generate_note(app, get_db(), generation_id, request).await {
            tracing::error!("[generate_note_content] 生成失败: {}", e);
        }
    });

    // 立即返回 generation_id，前端通过事件监听进度
    Ok(return_id)
}

#[tauri::command]
async fn abort_note_generation(generation_id: String) -> Result<(), String> {
    note_generation::abort_generation(generation_id).await
}

// Chapter generation commands
#[tauri::command]
async fn generate_chapters(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: i64,
    model_id: i64,
    video_path: String,
    subtitle_path: String,
    capture_screenshots: bool,
) -> Result<String, String> {
    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();

    tracing::info!("[原文细读] 开始执行, note_id={}, generation_id={}", note_id, return_id);

    let request = chapter::GenerateChaptersRequest {
        note_id,
        model_id,
        video_path,
        subtitle_path,
        capture_screenshots,
    };

    // 在后台任务中执行
    tokio::spawn(async move {
        match chapter::generate_chapters(app, get_db(), generation_id, request).await {
            Ok(chapter_data) => {
                // 保存章节数据到数据库
                let chapter_json = serde_json::to_string(&chapter_data).unwrap_or_default();
                let conn = get_db().connection();
                if let Err(e) = conn.execute(
                    "UPDATE notes SET detailed_reading = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
                    (&chapter_json, note_id),
                ) {
                    tracing::error!("[generate_chapters] 保存章节数据失败: {}", e);
                } else {
                    tracing::info!("[generate_chapters] 章节数据已保存到数据库, note_id={}", note_id);
                }
            }
            Err(e) => {
                tracing::error!("[generate_chapters] 生成失败: {}", e);
            }
        }
    });

    Ok(return_id)
}

#[tauri::command]
async fn abort_chapter_generation(generation_id: String) -> Result<(), String> {
    chapter::abort_chapter_generation(generation_id).await
}

#[tauri::command]
fn parse_subtitle_file(path: String) -> Result<Vec<subtitle::SubtitleEntry>, String> {
    subtitle::parse_subtitle_file(&path)
}

#[tauri::command]
async fn save_chapters_to_note(
    note_id: i64,
    chapter_data: serde_json::Value,
) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到".to_string())?;

    // 将章节数据序列化为JSON字符串存储
    let chapter_json = serde_json::to_string(&chapter_data).map_err(|e| e.to_string())?;
    note.detailed_reading = Some(chapter_json);

    get_db().update_note(&note).map_err(|e| e.to_string())
}

/// Update a specific content field of a note
#[tauri::command]
fn update_note_content(
    note_id: i64,
    tab_type: String,
    content: String,
) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    match tab_type.as_str() {
        "full_summary" => note.full_summary = Some(content),
        "detailed_reading" => note.detailed_reading = Some(content),
        "highlights" => note.highlights = Some(content),
        "visual_summary" => note.visual_summary = Some(content),
        "custom_summary" => note.custom_summary = Some(content),
        "quick_notes" => note.quick_notes = Some(content),
        "quick_notes_mindmap" => note.quick_notes_mindmap = Some(content),
        "quick_notes_canvas" => note.quick_notes_canvas = Some(content),
        "panoramic_blueprint" => note.panoramic_blueprint = Some(content),
        _ => return Err("无效的标签页类型".to_string()),
    }

    get_db().update_note(&note).map_err(|e| e.to_string())
}

// Optimized subtitles commands
#[tauri::command]
fn get_optimized_subtitles(note_id: i64) -> Result<Vec<OptimizedSubtitle>, String> {
    get_db().get_optimized_subtitles(note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_optimized_subtitle(note_id: i64, chapter_id: String, optimized_text: String) -> Result<i64, String> {
    get_db().save_optimized_subtitle(note_id, &chapter_id, &optimized_text).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_optimized_subtitles(note_id: i64) -> Result<(), String> {
    get_db().delete_optimized_subtitles(note_id).map_err(|e| e.to_string())
}

// Note UI state commands
#[tauri::command]
fn get_note_ui_state(note_id: i64) -> Result<Option<NoteUiState>, String> {
    get_db().get_note_ui_state(note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_note_ui_state(note_id: i64, show_subtitles: bool, subtitle_optimization_enabled: bool) -> Result<(), String> {
    get_db().save_note_ui_state(note_id, show_subtitles, subtitle_optimization_enabled).map_err(|e| e.to_string())
}

// Screenshot marker commands
#[tauri::command]
async fn save_screenshot_marker(
    app: AppHandle,
    note_id: i64,
    subtitle_index: i32,
    timestamp: f64,
    screenshot_data: Vec<u8>,
) -> Result<ScreenshotMarker, String> {
    // Create screenshot directory for this note
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let screenshots_dir = cache_dir
        .join("notes")
        .join(note_id.to_string())
        .join("assist_screenshots");
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;

    // Generate unique ID and filename
    let marker_id = uuid::Uuid::new_v4().to_string();
    let screenshot_filename = format!("marker_{}_{}.png", subtitle_index, &marker_id[..8]);
    let screenshot_path = screenshots_dir.join(&screenshot_filename);

    // Save screenshot data to file
    std::fs::write(&screenshot_path, &screenshot_data)
        .map_err(|e| format!("Failed to save screenshot: {}", e))?;

    // Create marker record
    let marker = ScreenshotMarker {
        id: marker_id,
        note_id,
        subtitle_index,
        timestamp,
        screenshot_path: screenshot_path.to_string_lossy().to_string(),
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    // Save to database
    get_db()
        .save_screenshot_marker(&marker)
        .map_err(|e| e.to_string())?;

    Ok(marker)
}

#[tauri::command]
async fn delete_screenshot_marker(
    note_id: i64,
    marker_id: String,
) -> Result<(), String> {
    // Delete from database and get marker data for file cleanup
    let marker = get_db()
        .delete_screenshot_marker(note_id, &marker_id)
        .map_err(|e| e.to_string())?;

    // Delete screenshot file if marker existed
    if let Some(m) = marker {
        let path = std::path::Path::new(&m.screenshot_path);
        if path.exists() {
            std::fs::remove_file(path)
                .map_err(|e| format!("Failed to delete screenshot file: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
fn get_screenshot_markers(note_id: i64) -> Result<Vec<ScreenshotMarker>, String> {
    get_db()
        .get_screenshot_markers(note_id)
        .map_err(|e| e.to_string())
}

/// Generate chapters using assist mode markers
/// This uses user-defined screenshot markers for chapter segmentation
/// instead of AI-based automatic segmentation
#[tauri::command]
async fn generate_chapters_with_markers(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: i64,
    model_id: i64,
    video_path: String,
    subtitle_path: String,
    markers: Vec<ScreenshotMarker>,
) -> Result<String, String> {
    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();

    // 在后台任务中执行
    tokio::spawn(async move {
        match note_generation::generate_chapters_with_markers(
            app.clone(),
            get_db(),
            generation_id.clone(),
            note_id,
            model_id,
            video_path,
            subtitle_path,
            markers,
        ).await {
            Ok(chapter_data) => {
                // 保存章节数据到笔记
                if let Err(e) = save_chapters_to_note_internal(note_id, &chapter_data) {
                    tracing::error!("[generate_chapters_with_markers] 保存章节数据失败: {}", e);
                }
            }
            Err(e) => {
                tracing::error!("[generate_chapters_with_markers] 生成失败: {}", e);
            }
        }
    });

    Ok(return_id)
}

/// Internal function to save chapter data to note
fn save_chapters_to_note_internal(note_id: i64, chapter_data: &chapter::ChapterData) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    let chapter_json = serde_json::to_string(chapter_data).map_err(|e| e.to_string())?;
    note.detailed_reading = Some(chapter_json);

    get_db().update_note(&note).map_err(|e| e.to_string())
}

/// Capture a video frame at a specific timestamp using FFmpeg
/// Returns the path to the saved screenshot file
#[tauri::command]
async fn capture_video_frame(
    video_path: String,
    timestamp: f64,
    output_path: String,
) -> Result<String, String> {
    // Verify video file exists
    let video_path_obj = Path::new(&video_path);
    if !video_path_obj.exists() {
        return Err(format!("Video file not found: {}", video_path));
    }

    // Ensure output directory exists
    let output_path_obj = Path::new(&output_path);
    if let Some(parent) = output_path_obj.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    // Run FFmpeg to capture frame at specified timestamp
    // -ss: seek to timestamp (placed before -i for faster seeking)
    // -i: input file
    // -frames:v 1: capture only 1 frame
    // -q:v 2: high quality JPEG (lower number = higher quality, range 2-31)
    let output = ffmpeg_command()
        .args([
            "-y",                              // Overwrite output file if exists
            "-ss", &format!("{:.3}", timestamp), // Seek to timestamp (in seconds)
            "-i", &video_path,                 // Input video file
            "-frames:v", "1",                  // Capture only 1 frame
            "-q:v", "2",                       // High quality
            &output_path,                      // Output file path
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}. Please ensure ffmpeg is installed.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg frame capture failed: {}", stderr));
    }

    // Verify output file was created
    if !output_path_obj.exists() {
        return Err("Screenshot file was not created".to_string());
    }

    Ok(output_path)
}

// Highlight generation commands
#[tauri::command]
async fn generate_highlights(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: i64,
    model_id: i64,
    subtitle_path: String,
    highlight_type: String,
    total_duration: f64,
) -> Result<String, String> {
    use highlight_generation::{GenerateHighlightsRequest, HighlightType};

    // 防重复检查：如果该 note_id 已经在生成中，直接返回
    {
        let generating_notes = get_highlight_generating_notes().lock().await;
        if generating_notes.contains(&note_id) {
            tracing::warn!("[generate_highlights] note_id={} 已在生成中，跳过重复调用", note_id);
            return Err("该笔记的高光正在生成中".to_string());
        }
    }

    // 标记开始生成
    {
        let mut generating_notes = get_highlight_generating_notes().lock().await;
        generating_notes.insert(note_id);
    }

    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();

    // 转换高光类型
    let highlight_type = match highlight_type.as_str() {
        "default" => HighlightType::Default,
        "emotional" => HighlightType::Emotional,
        "viral" => HighlightType::Viral,
        _ => HighlightType::Default,
    };

    let request = GenerateHighlightsRequest {
        _note_id: note_id,
        model_id,
        subtitle_path,
        highlight_type,
        total_duration,
    };

    // 在后台任务中执行
    tokio::spawn(async move {
        match highlight_generation::generate_highlights(app.clone(), get_db(), generation_id.clone(), request).await {
            Ok(highlight_data) => {
                // 保存到数据库
                if let Err(e) = save_highlights_to_note_internal(note_id, &highlight_data) {
                    tracing::error!("[generate_highlights] 保存高光数据失败: {}", e);
                }
            }
            Err(e) => {
                tracing::error!("[generate_highlights] 生成失败: {}", e);
            }
        }
        // 生成完成，移除标记
        let mut generating_notes = get_highlight_generating_notes().lock().await;
        generating_notes.remove(&note_id);
    });

    Ok(return_id)
}

#[tauri::command]
async fn abort_highlight_generation(generation_id: String) -> Result<(), String> {
    highlight_generation::abort_highlight_generation(generation_id).await
}

#[tauri::command]
fn save_highlights_to_note(note_id: i64, highlight_data: serde_json::Value) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    let highlight_json = serde_json::to_string(&highlight_data).map_err(|e| e.to_string())?;
    note.highlights = Some(highlight_json);

    get_db().update_note(&note).map_err(|e| e.to_string())
}

fn save_highlights_to_note_internal(note_id: i64, highlight_data: &highlight_generation::HighlightData) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    let highlight_json = serde_json::to_string(highlight_data).map_err(|e| e.to_string())?;
    note.highlights = Some(highlight_json);

    get_db().update_note(&note).map_err(|e| e.to_string())
}

// Note initialization commands (笔记初始化)
#[tauri::command]
async fn initialize_note_data(
    app: AppHandle,
    note_id: i64,
    model_id: i64,
    video_path: String,
    subtitle_path: Option<String>,
    start_from_step: Option<usize>,
) -> Result<String, String> {
    let params = note_initialization::InitializationParams {
        note_id,
        model_id,
        video_path,
        subtitle_path,
        start_from_step,
    };
    note_initialization::start_initialization(app, params).await
}

#[tauri::command]
async fn abort_note_initialization(initialization_id: String) -> Result<(), String> {
    note_initialization::abort_initialization(&initialization_id).await
}

/// 获取未完成初始化的笔记列表（用于断点恢复）
#[tauri::command]
fn get_incomplete_initializations() -> Result<Vec<Note>, String> {
    get_db().get_incomplete_notes().map_err(|e| e.to_string())
}

/// 恢复笔记初始化（从断点继续）
#[tauri::command]
async fn resume_note_initialization(
    app: AppHandle,
    note_id: i64,
) -> Result<String, String> {
    let db = get_db();
    let note = db
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记不存在")?;

    let model_id = note.model_id.ok_or("笔记未配置AI模型")?;

    let params = note_initialization::InitializationParams {
        note_id,
        model_id,
        video_path: note.video_path,
        subtitle_path: note.subtitle_path,
        start_from_step: Some(note.init_status as usize),
    };

    note_initialization::start_initialization(app, params).await
}

// Collection commands (合集/资源库)
#[tauri::command]
fn get_collections() -> Result<Vec<Collection>, String> {
    get_db().get_all_collections().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_collection(id: i64) -> Result<Option<Collection>, String> {
    get_db().get_collection_by_id(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_collection(req: CreateCollectionRequest) -> Result<Collection, String> {
    // 验证输入
    validation::validate_collection_name(&req.name)?;
    if let Some(ref desc) = req.description {
        validation::validate_description(desc)?;
    }

    get_db().create_collection(&req).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_collection(collection: Collection) -> Result<(), String> {
    // 验证输入
    validation::validate_collection_name(&collection.name)?;
    if let Some(ref desc) = collection.description {
        validation::validate_description(desc)?;
    }

    get_db().update_collection(&collection).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_collections_order(collection_ids: Vec<i64>) -> Result<(), String> {
    get_db().update_collections_order(&collection_ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_collection(id: i64) -> Result<(), String> {
    get_db().delete_collection(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_note_to_collection(collection_id: i64, note_id: i64) -> Result<(), String> {
    get_db().add_note_to_collection(collection_id, note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_note_from_collection(collection_id: i64, note_id: i64) -> Result<(), String> {
    get_db().remove_note_from_collection(collection_id, note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_collection_items(collection_id: i64) -> Result<Vec<CollectionItem>, String> {
    get_db().get_collection_items(collection_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_collection_items_order(collection_id: i64, note_ids: Vec<i64>) -> Result<(), String> {
    get_db().update_collection_items_order(collection_id, &note_ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_collection_mixed_order(parent_id: i64, items: Vec<(String, i64)>) -> Result<(), String> {
    get_db().update_collection_mixed_order(parent_id, &items).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_collections_for_note(note_id: i64) -> Result<Vec<Collection>, String> {
    get_db().get_collections_for_note(note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_notes_in_collections() -> Result<Vec<i64>, String> {
    get_db().get_all_notes_in_collections().map_err(|e| e.to_string())
}

// ============================================================================
// 批量操作 API - 性能优化
// ============================================================================

/// 批量从合集中移除笔记
#[tauri::command]
fn batch_remove_notes_from_collection(collection_id: i64, note_ids: Vec<i64>) -> Result<(), String> {
    let db = get_db();
    for note_id in note_ids {
        db.remove_note_from_collection(collection_id, note_id)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 批量移动笔记到另一个合集
#[tauri::command]
fn batch_move_notes_to_collection(
    from_collection_id: i64,
    to_collection_id: i64,
    note_ids: Vec<i64>,
) -> Result<(), String> {
    let db = get_db();
    for note_id in note_ids {
        db.remove_note_from_collection(from_collection_id, note_id)
            .map_err(|e| e.to_string())?;
        db.add_note_to_collection(to_collection_id, note_id)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 批量删除笔记
#[tauri::command]
fn batch_delete_notes(app: AppHandle, note_ids: Vec<i64>) -> Result<(), String> {
    let db = get_db();

    for id in note_ids {
        // 删除笔记缓存目录
        if let Ok(cache_dir) = app.path().app_cache_dir() {
            let note_cache_dir = cache_dir.join("notes").join(id.to_string());
            if note_cache_dir.exists() {
                let _ = std::fs::remove_dir_all(&note_cache_dir);
            }
        }

        db.delete_note(id).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 当第二个实例启动时，聚焦到已有窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
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
            test_api_connection,
            get_app_settings,
            set_theme,
            get_setting,
            set_setting,
            read_file_content,
            save_file_content,
            convert_ts_to_mp4,
            check_ffmpeg,
            get_video_cache_size,
            clear_video_cache,
            clear_chapter_screenshots,
            get_notes,
            get_note,
            create_note,
            update_note,
            delete_note,
            update_playback_position,
            update_note_content,
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
            get_prompt_configs,
            create_prompt_config,
            update_prompt_config,
            delete_prompt_config,
            generate_note_content,
            abort_note_generation,
            generate_chapters,
            abort_chapter_generation,
            parse_subtitle_file,
            save_chapters_to_note,
            subtitle_optimizer::optimize_chapter_subtitles,
            subtitle_optimizer::abort_subtitle_optimization,
            subtitle_optimizer::get_subtitle_optimization_task_state,
            subtitle_optimizer::optimize_single_chapter_subtitle,
            get_optimized_subtitles,
            save_optimized_subtitle,
            delete_optimized_subtitles,
            get_note_ui_state,
            save_note_ui_state,
            save_screenshot_marker,
            delete_screenshot_marker,
            get_screenshot_markers,
            generate_chapters_with_markers,
            capture_video_frame,
            generate_highlights,
            abort_highlight_generation,
            save_highlights_to_note,
            export_visual_summary,
            flashcard_generation::generate_flashcards,
            flashcard_generation::abort_flashcard_generation,
            blueprint_generation::generate_panoramic_blueprint,
            blueprint_generation::abort_blueprint_generation,
            // Note initialization commands
            initialize_note_data,
            abort_note_initialization,
            get_incomplete_initializations,
            resume_note_initialization,
            // Collection commands
            get_collections,
            get_collection,
            create_collection,
            update_collection,
            update_collections_order,
            delete_collection,
            add_note_to_collection,
            remove_note_from_collection,
            get_collection_items,
            update_collection_items_order,
            update_collection_mixed_order,
            get_collections_for_note,
            get_all_notes_in_collections,
            // Batch operations (性能优化)
            batch_remove_notes_from_collection,
            batch_move_notes_to_collection,
            batch_delete_notes,
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
