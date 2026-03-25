mod ai_pool;
mod bcut_asr;
mod chat;
mod chapter;
mod data_management;
mod db;
pub mod error;
mod flashcard_generation;
mod blueprint_generation;
mod highlight_generation;
mod note_generation;
mod note_initialization;
mod prompts;
mod rag;
mod knowledge_base;
pub mod settings;
mod snowflake;
mod subtitle;
mod subtitle_optimizer;
pub mod validation;
mod keyring_manager;
mod video_server;
pub mod storage_paths;

use chat::ChatRequest;
use data_management::{CleanupPreview, CleanupRequest, CleanupResult, DataManagementOverview, DataManagementScanResult};
use db::{AiConfig, AppSettings, Collection, CollectionItem, CreateCollectionRequest, CreateNoteRequest, Database, EmbeddingConfig, Note, NoteUiState, OptimizedSubtitle, PromptConfig, RerankerConfig, ScreenshotMarker, UpdateNoteMetadataRequest};
use regex::Regex;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tokio::process::Command as TokioCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};


const TRAY_ICON: &[u8] = include_bytes!("../icons/icon.png");
static TRAY_ENABLED: AtomicBool = AtomicBool::new(false);
const TRAY_ID: &str = "vnote-tray";
pub static DATABASE: OnceLock<Database> = OnceLock::new();

// 高光生成防重复：跟踪正在生成高光的 note_id
static HIGHLIGHT_GENERATING_NOTES: OnceLock<tokio::sync::Mutex<HashSet<String>>> = OnceLock::new();

// TS 转 MP4 防重复：跟踪正在转换的 (note_id + ts_path)
static TS_CONVERTING_TASKS: OnceLock<tokio::sync::Mutex<HashSet<String>>> = OnceLock::new();

fn get_highlight_generating_notes() -> &'static tokio::sync::Mutex<HashSet<String>> {
    HIGHLIGHT_GENERATING_NOTES.get_or_init(|| tokio::sync::Mutex::new(HashSet::new()))
}

fn get_ts_converting_tasks() -> &'static tokio::sync::Mutex<HashSet<String>> {
    TS_CONVERTING_TASKS.get_or_init(|| tokio::sync::Mutex::new(HashSet::new()))
}

fn get_db() -> &'static Database {
    DATABASE.get().expect("Database not initialized")
}

/// Create async ffmpeg command with hidden console window on Windows
#[cfg(windows)]
fn async_ffmpeg_command() -> TokioCommand {
    #[allow(unused_imports)]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = TokioCommand::new("ffmpeg");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn async_ffmpeg_command() -> TokioCommand {
    TokioCommand::new("ffmpeg")
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
fn create_ai_config(config: AiConfig) -> Result<String, String> {
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
        .update_concurrent_limit(&config.id, config.concurrent_limit)
        .await
        // 忽略控制器不存在的错误（可能是首次创建配置）
        .ok();

    // 动态更新 AI 线程池的超时配置
    crate::ai_pool::get_ai_pool_manager()
        .update_request_timeout(&config.id, config.request_timeout)
        .await;

    Ok(())
}

#[tauri::command]
fn delete_ai_config(id: String) -> Result<(), String> {
    get_db().delete_ai_config(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_default_ai_config(id: String) -> Result<(), String> {
    get_db().set_default_ai_config(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn unset_default_ai_config(id: String) -> Result<(), String> {
    get_db().unset_default_ai_config(&id).map_err(|e| e.to_string())
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
async fn read_file_content(path: String) -> Result<String, String> {
    // Validate the path first to prevent path traversal attacks
    let validated_path = validate_file_path(&path)?;

    tokio::fs::read_to_string(&validated_path)
        .await
        .map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

/// Save content to a file
#[tauri::command]
async fn save_file_content(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

/// Event payload for TS to MP4 conversion result
#[derive(Clone, serde::Serialize)]
struct TsConversionResult {
    note_id: String,
    success: bool,
    mp4_path: Option<String>,
    error: Option<String>,
}

/// Start TS to MP4 conversion in background and emit event when done
/// This prevents GUI freezing by not blocking the IPC channel
#[tauri::command]
fn start_ts_conversion(app: AppHandle, ts_path: String, note_id: String) {
    // Spawn the conversion task in background and return immediately
    let note_id_clone = note_id.clone();
    let ts_path_clone = ts_path.clone();
    tauri::async_runtime::spawn(async move {
        let convert_key = format!("{}::{}", note_id_clone, ts_path_clone);

        // 防重复：同 note + 同 TS 路径仅允许一个转换任务
        {
            let mut converting = get_ts_converting_tasks().lock().await;
            if converting.contains(&convert_key) {
                tracing::warn!("[ts-convert] duplicated request ignored: {}", convert_key);
                return;
            }
            converting.insert(convert_key.clone());
        }

        let result = async {
            // Check ffmpeg availability first
            let ffmpeg_available = match async_ffmpeg_command().arg("-version").output().await {
                Ok(output) => output.status.success(),
                Err(_) => false,
            };

            if !ffmpeg_available {
                return Err("未检测到 ffmpeg。请安装 ffmpeg 以支持 TS 视频播放。".to_string());
            }

            convert_ts_to_mp4_internal(&app, &ts_path_clone, &note_id_clone).await
        }
        .await;

        let payload = match result {
            Ok(mp4_path) => TsConversionResult {
                note_id: note_id_clone.clone(),
                success: true,
                mp4_path: Some(mp4_path),
                error: None,
            },
            Err(e) => TsConversionResult {
                note_id: note_id_clone.clone(),
                success: false,
                mp4_path: None,
                error: Some(e),
            },
        };

        // Emit event to frontend
        let _ = app.emit("ts-conversion-complete", payload);

        let mut converting = get_ts_converting_tasks().lock().await;
        converting.remove(&convert_key);
    });
}

/// Internal function to perform TS to MP4 conversion
async fn convert_ts_to_mp4_internal(app: &AppHandle, ts_path: &str, note_id: &str) -> Result<String, String> {
    let ts_path = Path::new(ts_path);

    // Verify it's a .ts file
    if ts_path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) != Some("ts".to_string()) {
        return Err("Not a .ts file".to_string());
    }

    // Create output path in notes directory, organized by note ID
    let note_cache_dir = storage_paths::note_dir(app, note_id)?;
    tokio::fs::create_dir_all(&note_cache_dir).await.map_err(|e| e.to_string())?;

    // Build a stable cache key from full ts path + file size + modified time
    let ts_path_buf = ts_path.to_path_buf();
    let ts_path_string = ts_path.to_string_lossy().to_string();
    let cache_key = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let meta = std::fs::metadata(&ts_path_buf).map_err(|e| format!("读取 TS 文件元数据失败: {}", e))?;
        let size = meta.len();
        let modified = meta
            .modified()
            .map_err(|e| format!("读取 TS 文件修改时间失败: {}", e))?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("TS 文件修改时间无效: {}", e))?
            .as_nanos();

        let mut hasher = DefaultHasher::new();
        ts_path_string.hash(&mut hasher);
        size.hash(&mut hasher);
        modified.hash(&mut hasher);

        Ok(format!("{:016x}", hasher.finish()))
    })
    .await
    .map_err(|e| format!("转换缓存键任务失败: {}", e))??;

    let mp4_path = note_cache_dir.join(format!("{}.mp4", cache_key));

    // If already converted, return existing file
    if mp4_path.exists() {
        return Ok(mp4_path.to_string_lossy().to_string());
    }

    // Run ffmpeg to remux (copy streams, no re-encoding)
    let output = async_ffmpeg_command()
        .args([
            "-y",                           // Overwrite output
            "-i", &ts_path.to_string_lossy(), // Input file
            "-c", "copy",                   // Copy all streams (no re-encoding)
            "-movflags", "+faststart",      // Enable fast start for streaming
            &mp4_path.to_string_lossy(),    // Output file
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {}. Please ensure ffmpeg is installed.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg conversion failed: {}", stderr));
    }

    Ok(mp4_path.to_string_lossy().to_string())
}

/// Convert TS file to MP4 using ffmpeg (fast remux, no re-encoding)
/// Returns the path to the converted MP4 file
/// Note: For long-running conversions, prefer using start_ts_conversion with events
#[tauri::command]
async fn convert_ts_to_mp4(app: AppHandle, ts_path: String, note_id: String) -> Result<String, String> {
    convert_ts_to_mp4_internal(&app, &ts_path, &note_id).await
}

/// Check if ffmpeg is available
#[tauri::command]
async fn check_ffmpeg() -> Result<bool, String> {
    match async_ffmpeg_command().arg("-version").output().await {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// Get the total size of video cache (converted MP4 files only, excluding screenshots)
#[tauri::command]
async fn get_video_cache_size(app: AppHandle) -> Result<u64, String> {
    let notes_cache_dir = storage_paths::notes_dir(&app)?;

    if !notes_cache_dir.exists() {
        return Ok(0);
    }

    // Move the recursive operation to a blocking thread pool
    tokio::task::spawn_blocking(move || {
        let mut total_size: u64 = 0;

        // Recursively find and calculate size of MP4 files only
        fn calculate_mp4_size(dir: &std::path::Path, total: &mut u64) -> std::io::Result<()> {
            if dir.is_dir() {
                for entry in std::fs::read_dir(dir)? {
                    let entry = entry?;
                    let path = entry.path();

                    // Skip screenshot directories
                    if path.is_dir() {
                        let dir_name = path.file_name().and_then(|n| n.to_str());
                        if matches!(dir_name, Some("chapter_screenshots") | Some("ai_note_screenshots")) {
                            continue;
                        }
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
        Ok::<u64, String>(total_size)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Clear chapter screenshots for a specific note
#[tauri::command]
async fn clear_chapter_screenshots(app: AppHandle, note_id: String) -> Result<(), String> {
    let screenshots_dir = storage_paths::chapter_screenshots_dir(&app, &note_id)?;

    if screenshots_dir.exists() {
        tokio::task::spawn_blocking(move || {
            std::fs::remove_dir_all(&screenshots_dir)
                .map_err(|e| format!("Failed to clear screenshots: {}", e))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??;
    }

    Ok(())
}

#[tauri::command]
async fn clear_ai_note_screenshots(app: AppHandle, note_id: String) -> Result<(), String> {
    let screenshots_dir = storage_paths::ai_note_screenshots_dir(&app, &note_id)?;

    if screenshots_dir.exists() {
        tokio::task::spawn_blocking(move || {
            std::fs::remove_dir_all(&screenshots_dir)
                .map_err(|e| format!("Failed to clear ai note screenshots: {}", e))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??;
    }

    Ok(())
}

/// Clear video cache (delete MP4 files only, keep screenshots)
#[tauri::command]
async fn clear_video_cache(app: AppHandle) -> Result<u64, String> {
    let result = data_management::execute_cleanup(
        &app,
        get_db(),
        CleanupRequest {
            categories: vec!["video_mp4_cache".to_string()],
            integrity_targets: None,
            note_ids: None,
        },
    )?;
    Ok(result.cleared_bytes)
}

#[tauri::command]
fn get_data_management_overview(
    app: AppHandle,
    note_ids: Option<Vec<String>>,
) -> Result<DataManagementOverview, String> {
    data_management::get_overview(&app, get_db(), note_ids.as_deref())
}

#[tauri::command]
fn scan_data_management(
    app: AppHandle,
    note_ids: Option<Vec<String>>,
) -> Result<DataManagementScanResult, String> {
    data_management::scan(&app, get_db(), note_ids.as_deref())
}

#[tauri::command]
fn preview_data_cleanup(app: AppHandle, request: CleanupRequest) -> Result<CleanupPreview, String> {
    data_management::preview_cleanup(&app, get_db(), request)
}

#[tauri::command]
fn execute_data_cleanup(app: AppHandle, request: CleanupRequest) -> Result<CleanupResult, String> {
    data_management::execute_cleanup(&app, get_db(), request)
}

// Note commands
#[tauri::command]
fn get_notes() -> Result<Vec<Note>, String> {
    get_db().get_all_notes().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_note(id: String) -> Result<Option<Note>, String> {
    get_db().get_note_by_id(&id).map_err(|e| e.to_string())
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
fn update_note_metadata(req: UpdateNoteMetadataRequest) -> Result<(), String> {
    validation::validate_title(&req.title)?;
    get_db().update_note_metadata(&req).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    let db = get_db();

    // Delete entire note directory (includes TS cache, screenshots and subtitle files)
    let id_clone = id.clone();
    if let Ok(note_cache_dir) = storage_paths::note_dir(&app, &id_clone) {
        if note_cache_dir.exists() {
            tokio::task::spawn_blocking(move || {
                let _ = std::fs::remove_dir_all(&note_cache_dir);
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?;
        }
    }

    // Database operation in spawn_blocking
    tokio::task::spawn_blocking(move || {
        db.delete_note(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn update_playback_position(note_id: String, position: f64) -> Result<(), String> {
    get_db().update_playback_position(&note_id, position).map_err(|e| e.to_string())
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
fn clear_subtitle_index(note_id: String) -> Result<(), String> {
    rag::clear_subtitle_index(&note_id)
}

// Generate suggested questions for a note
#[tauri::command]
async fn generate_questions_for_note(note_id: String) -> Result<Vec<String>, String> {
    let db = get_db();

    // Get note
    let note = db
        .get_note_by_id(&note_id)
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
            db.update_note_questions(&note_id, &questions_json).map_err(|e| e.to_string())?;
            return Ok(default_questions);
        }
    };
    let model_id = match note.model_id {
        Some(id) => id,
        None => {
            // No model, save and return default
            let questions_json = serde_json::to_string(&default_questions).map_err(|e| e.to_string())?;
            db.update_note_questions(&note_id, &questions_json).map_err(|e| e.to_string())?;
            return Ok(default_questions);
        }
    };

    // Generate questions (use default on failure)
    let abort_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let questions = chat::generate_suggested_questions(db, &subtitle_path, &model_id, &abort_flag)
        .await
        .unwrap_or_else(|e| {
            tracing::error!("Failed to generate questions: {}", e);
            default_questions.clone()
        });

    // Save to database
    let questions_json = serde_json::to_string(&questions).map_err(|e| e.to_string())?;
    db.update_note_questions(&note_id, &questions_json).map_err(|e| e.to_string())?;

    // Return questions to frontend
    Ok(questions)
}

// Embedding config commands
#[tauri::command]
fn get_embedding_configs() -> Result<Vec<EmbeddingConfig>, String> {
    get_db().get_all_embedding_configs().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_embedding_config(config: EmbeddingConfig) -> Result<String, String> {
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
fn delete_embedding_config(id: String) -> Result<(), String> {
    get_db().delete_embedding_config(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_default_embedding_config(id: String) -> Result<(), String> {
    get_db().set_default_embedding_config(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn unset_default_embedding_config(id: String) -> Result<(), String> {
    get_db().unset_default_embedding_config(&id).map_err(|e| e.to_string())
}

// Reranker config commands
#[tauri::command]
fn get_reranker_configs() -> Result<Vec<RerankerConfig>, String> {
    get_db().get_all_reranker_configs().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_reranker_config(config: RerankerConfig) -> Result<String, String> {
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
fn delete_reranker_config(id: String) -> Result<(), String> {
    get_db().delete_reranker_config(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_default_reranker_config(id: String) -> Result<(), String> {
    get_db().set_default_reranker_config(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn unset_default_reranker_config(id: String) -> Result<(), String> {
    get_db().unset_default_reranker_config(&id).map_err(|e| e.to_string())
}

// Prompt config commands
#[tauri::command]
fn get_prompt_configs() -> Result<Vec<PromptConfig>, String> {
    get_db().get_all_prompt_configs().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_prompt_config(config: PromptConfig) -> Result<String, String> {
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
fn delete_prompt_config(id: String) -> Result<(), String> {
    get_db().delete_prompt_config(&id).map_err(|e| e.to_string())
}

// Note generation commands
#[tauri::command]
async fn generate_note_content(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: String,
    model_id: String,
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
            "ai_note" => Some(TabType::AiNote),
            _ => None,
        })
        .collect();

    // 使用前端传入的 concurrent_limit，或从AI配置中获取
    let concurrent_limit = concurrent_limit.unwrap_or_else(|| {
        if let Ok(Some(ai_config)) = get_db().get_ai_config_by_id(&model_id) {
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
        style: None,
        custom_prompt,
        screenshot_density: None,
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

#[tauri::command]
async fn generate_ai_note_content(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: String,
    model_id: String,
    regenerate: bool,
    concurrent_limit: Option<usize>,
    style: Option<String>,
    custom_prompt: Option<String>,
    screenshot_density: Option<String>,
) -> Result<String, String> {
    use note_generation::{GenerateNoteRequest, GenerationOptions, TabType};

    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();

    let concurrent_limit = concurrent_limit.unwrap_or_else(|| {
        if let Ok(Some(ai_config)) = get_db().get_ai_config_by_id(&model_id) {
            ai_config.concurrent_limit as usize
        } else {
            5
        }
    });

    let request = GenerateNoteRequest {
        note_id,
        model_id,
        options: GenerationOptions {
            concurrent: true,
            tabs_to_generate: vec![TabType::AiNote],
            regenerate,
            concurrent_limit,
            style,
            custom_prompt,
            screenshot_density,
        },
    };

    tokio::spawn(async move {
        if let Err(e) = note_generation::generate_note(app, get_db(), generation_id, request).await {
            tracing::error!("[generate_ai_note_content] 生成失败: {}", e);
        }
    });

    Ok(return_id)
}

// Chapter generation commands
#[tauri::command]
async fn generate_chapters(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: String,
    model_id: String,
    video_path: String,
    subtitle_path: String,
    capture_screenshots: bool,
) -> Result<String, String> {
    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();
    let note_id_for_save = note_id.clone();
    let subtitle_path_for_save = subtitle_path.clone();

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
                let subtitle_entries = match subtitle::parse_subtitle_file(&subtitle_path_for_save) {
                    Ok(entries) => entries,
                    Err(e) => {
                        tracing::error!("[generate_chapters] 解析字幕失败，无法转换 detailed_reading: {}", e);
                        return;
                    }
                };

                let detailed_reading = chapter_data_to_detailed_reading_data(&chapter_data, &subtitle_entries);
                let detailed_reading_json = match serde_json::to_string(&detailed_reading) {
                    Ok(json) => json,
                    Err(e) => {
                        tracing::error!("[generate_chapters] 序列化 detailed_reading 失败: {}", e);
                        return;
                    }
                };

                let conn = get_db().connection();
                if let Err(e) = conn.execute(
                    "UPDATE notes SET detailed_reading = ?1, updated_at = datetime('now', 'localtime') WHERE id = ?2",
                    (&detailed_reading_json, &note_id_for_save),
                ) {
                    tracing::error!("[generate_chapters] 保存章节数据失败: {}", e);
                } else {
                    tracing::info!("[generate_chapters] 章节数据已保存到数据库, note_id={}", note_id_for_save);
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
async fn parse_subtitle_file(path: String) -> Result<Vec<subtitle::SubtitleEntry>, String> {
    tokio::task::spawn_blocking(move || {
        subtitle::parse_subtitle_file(&path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn save_chapters_to_note(
    note_id: String,
    chapter_data: serde_json::Value,
) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到".to_string())?;

    // 兼容旧 ChapterData 写入：统一转换为 DetailedReadingData 再存储
    let detailed_reading = if let Ok(data) = serde_json::from_value::<chapter::DetailedReadingData>(chapter_data.clone()) {
        data
    } else {
        let legacy = serde_json::from_value::<chapter::ChapterData>(chapter_data)
            .map_err(|e| format!("解析章节数据失败: {}", e))?;

        let subtitle_entries = note
            .subtitle_path
            .as_ref()
            .and_then(|path| subtitle::parse_subtitle_file(path).ok())
            .unwrap_or_default();

        chapter_data_to_detailed_reading_data(&legacy, &subtitle_entries)
    };

    let chapter_json = serde_json::to_string(&detailed_reading).map_err(|e| e.to_string())?;
    note.detailed_reading = Some(chapter_json);

    get_db().update_note(&note).map_err(|e| e.to_string())
}

/// Update a specific content field of a note
#[tauri::command]
fn update_note_content(
    note_id: String,
    tab_type: String,
    content: String,
) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    match tab_type.as_str() {
        "full_summary" => note.full_summary = Some(content),
        "detailed_reading" => note.detailed_reading = Some(content),
        "highlights" => note.highlights = Some(content),
        "visual_summary" => note.visual_summary = Some(content),
        "custom_summary" => note.custom_summary = Some(content),
        "ai_note_markdown" | "ai_note" => note.ai_note_markdown = Some(content),
        "ai_note_meta" => note.ai_note_meta = Some(content),
        "quick_notes" => note.quick_notes = Some(content),
        "quick_notes_mindmap" => note.quick_notes_mindmap = Some(content),
        "quick_notes_canvas" => note.quick_notes_canvas = Some(content),
        "panoramic_blueprint" => note.panoramic_blueprint = Some(content),
        _ => return Err("无效的标签页类型".to_string()),
    }

    get_db().update_note(&note).map_err(|e| e.to_string())
}

/// Assemble visual_summary markdown for a note from detailed_reading + optimized subtitles + original subtitles.
/// Returns Ok(true) if saved, Ok(false) if skipped (already has visual_summary or no chapter data).
pub fn assemble_and_save_visual_summary(db: &Database, note: &mut Note) -> Result<bool, String> {
    // Skip if already has visual_summary
    if note.visual_summary.as_ref().map_or(false, |s| !s.trim().is_empty()) {
        return Ok(false);
    }
    // Parse detailed_reading
    let dr = match &note.detailed_reading {
        Some(s) if !s.trim().is_empty() => s,
        _ => return Ok(false),
    };
    let detailed_reading: chapter::DetailedReadingData = serde_json::from_str(dr).map_err(|e| e.to_string())?;
    if detailed_reading.chapters.is_empty() {
        return Ok(false);
    }
    // Load optimized subtitles
    let opt_subs = db.get_optimized_subtitles(&note.id).unwrap_or_default();
    let opt_map: std::collections::HashMap<String, String> = opt_subs
        .into_iter()
        .map(|s| (s.chapter_id, s.optimized_text))
        .collect();
    // Load original subtitles
    let original_subs = note.subtitle_path.as_ref()
        .and_then(|p| subtitle::parse_subtitle_file(p).ok())
        .unwrap_or_default();
    // Assemble markdown
    let mut sections = Vec::new();
    for ch in &detailed_reading.chapters {
        let heading = "#";
        let time_range = format!("{} - {}", format_seconds(ch.start_time), format_seconds(ch.end_time));
        let mut lines = vec![
            format!("{} {} ({})", heading, ch.title, time_range),
            String::new(),
        ];
        // Screenshot image (matching frontend convertFileSrc format)
        if let Some(ref path) = ch.screenshot_path {
            let encoded = urlencoding::encode(path);
            lines.push(format!("![{}](http://asset.localhost/{})", ch.title, encoded));
            lines.push(String::new());
        }
        // Subtitle content: prefer optimized, fallback to original
        let subtitle_content = if let Some(opt) = opt_map.get(&ch.id) {
            opt.clone()
        } else {
            original_subs.iter()
                .filter(|sub| sub.start_time >= ch.start_time && sub.start_time < ch.end_time)
                .map(|sub| sub.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        };
        if !subtitle_content.trim().is_empty() {
            lines.push(subtitle_content);
            lines.push(String::new());
        }
        lines.push("---".to_string());
        lines.push(String::new());
        sections.push(lines.join("\n"));
    }
    let mut result = sections.join("");
    if result.ends_with("---\n\n") {
        result.truncate(result.len() - 5);
    }
    let result = result.trim().to_string();
    if result.is_empty() {
        return Ok(false);
    }
    note.visual_summary = Some(result);
    db.update_note(note).map_err(|e| e.to_string())?;
    Ok(true)
}

fn format_seconds(seconds: f64) -> String {
    let total = seconds as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, s)
    } else {
        format!("{}:{:02}", m, s)
    }
}

// Optimized subtitles commands
#[tauri::command]
fn get_optimized_subtitles(note_id: String) -> Result<Vec<OptimizedSubtitle>, String> {
    get_db().get_optimized_subtitles(&note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_optimized_subtitle(note_id: String, chapter_id: String, optimized_text: String) -> Result<String, String> {
    get_db().save_optimized_subtitle(&note_id, &chapter_id, &optimized_text).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_optimized_subtitles(note_id: String) -> Result<(), String> {
    get_db().delete_optimized_subtitles(&note_id).map_err(|e| e.to_string())
}

// Note UI state commands
#[tauri::command]
fn get_note_ui_state(note_id: String) -> Result<Option<NoteUiState>, String> {
    get_db().get_note_ui_state(&note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_note_ui_state(note_id: String, show_subtitles: bool, subtitle_optimization_enabled: bool) -> Result<(), String> {
    get_db().save_note_ui_state(&note_id, show_subtitles, subtitle_optimization_enabled).map_err(|e| e.to_string())
}

// Screenshot marker commands
#[tauri::command]
async fn save_screenshot_marker(
    app: AppHandle,
    note_id: String,
    subtitle_index: i32,
    timestamp: f64,
    screenshot_data: Vec<u8>,
) -> Result<ScreenshotMarker, String> {
    // Create screenshot directory for this note
    let screenshots_dir = storage_paths::assist_screenshots_dir(&app, &note_id)?;
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
    note_id: String,
    marker_id: String,
) -> Result<(), String> {
    // Delete from database and get marker data for file cleanup
    let marker = get_db()
        .delete_screenshot_marker(&note_id, &marker_id)
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
fn get_screenshot_markers(note_id: String) -> Result<Vec<ScreenshotMarker>, String> {
    get_db()
        .get_screenshot_markers(&note_id)
        .map_err(|e| e.to_string())
}

/// Generate chapters using assist mode markers
/// This uses user-defined screenshot markers for chapter segmentation
/// instead of AI-based automatic segmentation
#[tauri::command]
async fn generate_chapters_with_markers(
    app: AppHandle,
    generation_id: Option<String>,
    note_id: String,
    model_id: String,
    video_path: String,
    subtitle_path: String,
    markers: Vec<ScreenshotMarker>,
) -> Result<String, String> {
    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();
    let note_id_for_save = note_id.clone();
    let subtitle_path_for_save = subtitle_path.clone();

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
                let subtitle_entries = match subtitle::parse_subtitle_file(&subtitle_path_for_save) {
                    Ok(entries) => entries,
                    Err(e) => {
                        tracing::error!("[generate_chapters_with_markers] 解析字幕失败，无法转换 detailed_reading: {}", e);
                        return;
                    }
                };
                let detailed_reading = chapter_data_to_detailed_reading_data(&chapter_data, &subtitle_entries);

                // 保存章节数据到笔记
                if let Err(e) = save_chapters_to_note_internal(&note_id_for_save, &detailed_reading) {
                    tracing::error!("[generate_chapters_with_markers] 保存章节数据失败: {}", e);
                } else {
                    let event_name = format!("chapter-generation-{}", generation_id);
                    let _ = app.emit(&event_name, chapter::ChapterGenerationEvent::Completed {
                        chapter_data,
                    });
                }
            }
            Err(e) => {
                tracing::error!("[generate_chapters_with_markers] 生成失败: {}", e);
            }
        }
    });

    Ok(return_id)
}

fn chapter_data_to_detailed_reading_data(
    chapter_data: &chapter::ChapterData,
    subtitle_entries: &[subtitle::SubtitleEntry],
) -> chapter::DetailedReadingData {
    let chapters = chapter_data
        .chapters
        .iter()
        .map(|ch| {
            let chapter_subtitles = subtitle_entries
                .iter()
                .filter(|sub| sub.start_time >= ch.start_time && sub.start_time < ch.end_time)
                .cloned()
                .collect::<Vec<_>>();

            chapter::DetailedReadingChapter {
                id: ch.id.clone(),
                title: ch.title.clone(),
                start_time: ch.start_time,
                end_time: ch.end_time,
                content: Some(ch.content.clone()),
                subtitle_entries: chapter_subtitles,
                screenshot_path: ch.screenshot_path.clone(),
            }
        })
        .collect::<Vec<_>>();

    chapter::DetailedReadingData {
        chapters,
        total_duration: chapter_data.total_duration,
        generated_at: chapter_data.generated_at.clone(),
    }
}

/// Internal function to save chapter data to note
fn save_chapters_to_note_internal(note_id: &str, chapter_data: &chapter::DetailedReadingData) -> Result<(), String> {
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
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    // Run FFmpeg to capture frame at specified timestamp
    // -ss: seek to timestamp (placed before -i for faster seeking)
    // -i: input file
    // -frames:v 1: capture only 1 frame
    // -q:v 2: high quality JPEG (lower number = higher quality, range 2-31)
    let output = async_ffmpeg_command()
        .args([
            "-y",                              // Overwrite output file if exists
            "-ss", &format!("{:.3}", timestamp), // Seek to timestamp (in seconds)
            "-i", &video_path,                 // Input video file
            "-frames:v", "1",                  // Capture only 1 frame
            "-q:v", "2",                       // High quality
            &output_path,                      // Output file path
        ])
        .output()
        .await
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
    note_id: String,
    model_id: String,
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
        generating_notes.insert(note_id.clone());
    }

    let generation_id = generation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let return_id = generation_id.clone();
    let note_id_for_save = note_id.clone();

    // 转换高光类型
    let highlight_type = match highlight_type.as_str() {
        "default" => HighlightType::Default,
        "emotional" => HighlightType::Emotional,
        "viral" => HighlightType::Viral,
        _ => HighlightType::Default,
    };

    let request = GenerateHighlightsRequest {
        _note_id: note_id.clone(),
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
                if let Err(e) = save_highlights_to_note_internal(&note_id_for_save, &highlight_data) {
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
fn save_highlights_to_note(note_id: String, highlight_data: serde_json::Value) -> Result<(), String> {
    let mut note = get_db()
        .get_note_by_id(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    let highlight_json = serde_json::to_string(&highlight_data).map_err(|e| e.to_string())?;
    note.highlights = Some(highlight_json);

    get_db().update_note(&note).map_err(|e| e.to_string())
}

fn save_highlights_to_note_internal(note_id: &str, highlight_data: &highlight_generation::HighlightData) -> Result<(), String> {
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
    note_id: String,
    model_id: String,
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
    note_id: String,
) -> Result<String, String> {
    let db = get_db();
    let note = db
        .get_note_by_id(&note_id)
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
fn get_collection(id: String) -> Result<Option<Collection>, String> {
    get_db().get_collection_by_id(&id).map_err(|e| e.to_string())
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
fn update_collections_order(collection_ids: Vec<String>) -> Result<(), String> {
    get_db().update_collections_order(&collection_ids).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_collection(app: AppHandle, id: String) -> Result<(), String> {
    let db = get_db();

    // Get all note IDs in this collection and its sub-collections
    let note_ids = db.get_all_note_ids_in_collection_tree(&id).map_err(|e| e.to_string())?;

    // Delete directories for all notes
    for note_id in &note_ids {
        if let Ok(note_cache_dir) = storage_paths::note_dir(&app, note_id) {
            if note_cache_dir.exists() {
                let dir_to_delete = note_cache_dir.clone();
                tokio::task::spawn_blocking(move || {
                    let _ = std::fs::remove_dir_all(&dir_to_delete);
                })
                .await
                .map_err(|e| format!("Task join error: {}", e))?;
            }
        }
    }

    // Delete all notes from database
    for note_id in &note_ids {
        db.delete_note(note_id).map_err(|e| e.to_string())?;
    }

    // Delete the collection (cascade will handle collection_items)
    db.delete_collection(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_note_to_collection(collection_id: String, note_id: String) -> Result<(), String> {
    get_db().add_note_to_collection(&collection_id, &note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_note_from_collection(collection_id: String, note_id: String) -> Result<(), String> {
    get_db().remove_note_from_collection(&collection_id, &note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_collection_items(collection_id: String) -> Result<Vec<CollectionItem>, String> {
    get_db().get_collection_items(&collection_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_collection_items_order(collection_id: String, note_ids: Vec<String>) -> Result<(), String> {
    get_db().update_collection_items_order(&collection_id, &note_ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_collection_mixed_order(parent_id: String, items: Vec<(String, String)>) -> Result<(), String> {
    get_db().update_collection_mixed_order(&parent_id, &items).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_collections_for_note(note_id: String) -> Result<Vec<Collection>, String> {
    get_db().get_collections_for_note(&note_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_notes_in_collections() -> Result<Vec<String>, String> {
    get_db().get_all_notes_in_collections().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_note_collection_id(note_id: String) -> Result<Option<String>, String> {
    get_db().get_note_collection_id(&note_id).map_err(|e| e.to_string())
}

// ============================================================================
// 批量操作 API - 性能优化
// ============================================================================

/// 批量从合集中移除笔记
#[tauri::command]
fn batch_remove_notes_from_collection(collection_id: String, note_ids: Vec<String>) -> Result<(), String> {
    let db = get_db();
    for note_id in note_ids {
        db.remove_note_from_collection(&collection_id, &note_id)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 批量移动笔记到另一个合集
#[tauri::command]
fn batch_move_notes_to_collection(
    from_collection_id: String,
    to_collection_id: String,
    note_ids: Vec<String>,
) -> Result<(), String> {
    let db = get_db();
    for note_id in note_ids {
        db.remove_note_from_collection(&from_collection_id, &note_id)
            .map_err(|e| e.to_string())?;
        db.add_note_to_collection(&to_collection_id, &note_id)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 批量删除笔记
#[tauri::command]
fn batch_delete_notes(app: AppHandle, note_ids: Vec<String>) -> Result<(), String> {
    let db = get_db();

    for id in note_ids {
        // 删除笔记目录
        if let Ok(note_cache_dir) = storage_paths::note_dir(&app, &id) {
            if note_cache_dir.exists() {
                let _ = std::fs::remove_dir_all(&note_cache_dir);
            }
        }

        db.delete_note(&id).map_err(|e| e.to_string())?;
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
        .register_uri_scheme_protocol("video-stream", video_server::handle_video_protocol)
        .setup(|app| {
            // Initialize database
            let db_dir = storage_paths::db_dir(&app.handle())
                .expect("Failed to resolve db directory");

            let db = Database::new(db_dir).expect("Failed to initialize database");

            // Load tray setting from database
            if let Ok(settings) = db.get_app_settings() {
                TRAY_ENABLED.store(settings.tray_enabled, Ordering::SeqCst);
                if settings.tray_enabled {
                    let _ = create_tray(app.handle());
                }
            }

            DATABASE.set(db).expect("Database already initialized");

            // 设置窗口图标和大小
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = Image::from_bytes(TRAY_ICON) {
                    let _ = window.set_icon(icon);
                }
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
            start_ts_conversion,
            check_ffmpeg,
            get_video_cache_size,
            clear_video_cache,
            get_data_management_overview,
            scan_data_management,
            preview_data_cleanup,
            execute_data_cleanup,
            clear_chapter_screenshots,
            clear_ai_note_screenshots,
            get_notes,
            get_note,
            create_note,
            update_note,
            update_note_metadata,
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
            generate_ai_note_content,
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
            get_note_collection_id,
            // Batch operations (性能优化)
            batch_remove_notes_from_collection,
            batch_move_notes_to_collection,
            batch_delete_notes,
            // Knowledge base commands
            knowledge_base::knowledge_base_index_note,
            knowledge_base::knowledge_base_index_all_notes,
            knowledge_base::knowledge_base_index_outdated_notes,
            knowledge_base::knowledge_base_remove_index,
            knowledge_base::knowledge_base_get_index_status,
            knowledge_base::knowledge_base_abort_indexing,
            knowledge_base::knowledge_base_backfill_visual_summaries,
            knowledge_base::knowledge_base_search,
            knowledge_base::knowledge_base_chat,
            knowledge_base::knowledge_base_abort_chat,
            knowledge_base::knowledge_base_get_stats,
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
