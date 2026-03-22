use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static DATA_ROOT: OnceLock<Result<PathBuf, String>> = OnceLock::new();

fn executable_dir() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取可执行文件路径失败: {}", e))?;
    exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法获取可执行文件目录".to_string())
}

fn can_write_dir(path: &Path) -> bool {
    if std::fs::create_dir_all(path).is_err() {
        return false;
    }

    let probe = path.join(format!(".vnote_write_test_{}", std::process::id()));
    match std::fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn ensure_dir(path: PathBuf) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败 {}: {}", path.display(), e))?;
    Ok(path)
}

fn resolve_data_root_inner(app: &AppHandle) -> Result<PathBuf, String> {
    let install_data_root = executable_dir()?.join("data");
    if can_write_dir(&install_data_root) {
        return Ok(install_data_root);
    }

    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("data");

    if can_write_dir(&fallback) {
        tracing::warn!(
            "安装目录不可写，已降级到用户目录: {}",
            fallback.display()
        );
        return Ok(fallback);
    }

    Err("安装目录与用户目录均不可写".to_string())
}

pub fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    DATA_ROOT
        .get_or_init(|| resolve_data_root_inner(app))
        .clone()
}

pub fn db_dir(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_dir(data_root(app)?.join("db"))
}

pub fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_dir(data_root(app)?.join("notes"))
}

pub fn note_dir(app: &AppHandle, note_id: &str) -> Result<PathBuf, String> {
    ensure_dir(notes_dir(app)?.join(note_id))
}

pub fn chapter_screenshots_dir(app: &AppHandle, note_id: &str) -> Result<PathBuf, String> {
    ensure_dir(note_dir(app, note_id)?.join("chapter_screenshots"))
}

pub fn ai_note_screenshots_dir(app: &AppHandle, note_id: &str) -> Result<PathBuf, String> {
    ensure_dir(note_dir(app, note_id)?.join("ai_note_screenshots"))
}

pub fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_dir(data_root(app)?.join("cache"))
}

pub fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_dir(data_root(app)?.join("logs"))
}

fn fallback_bootstrap_logs_dir() -> PathBuf {
    if let Some(project_dirs) = directories::ProjectDirs::from("com", "vnote", "vnote") {
        return project_dirs.data_local_dir().join("data").join("logs");
    }

    std::env::temp_dir().join("vnote").join("logs")
}

pub fn logs_dir_bootstrap() -> PathBuf {
    let install_logs_dir = executable_dir()
        .map(|p| p.join("data").join("logs"))
        .unwrap_or_else(|_| PathBuf::from("data").join("logs"));

    if can_write_dir(&install_logs_dir) {
        return install_logs_dir;
    }

    let fallback = fallback_bootstrap_logs_dir();
    if can_write_dir(&fallback) {
        eprintln!(
            "VNote logging fallback: install directory not writable, using {}",
            fallback.display()
        );
        return fallback;
    }

    let temp_logs = std::env::temp_dir().join("vnote").join("logs");
    let _ = std::fs::create_dir_all(&temp_logs);
    eprintln!(
        "VNote logging fallback: using temp logs directory {}",
        temp_logs.display()
    );
    temp_logs
}
