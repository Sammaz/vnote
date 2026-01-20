//! 初始化任务执行器模块
//!
//! 管理笔记初始化任务的执行状态，包括：
//! - 任务进度跟踪
//! - 任务状态持久化
//! - 启动恢复功能

use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::init_task_config::InitTaskConfig;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 笔记初始化进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteInitProgress {
    pub id: i64,
    pub note_id: i64,
    pub config_snapshot: String,
    pub current_task_index: i32,
    pub overall_status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 单个任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteInitTask {
    pub id: i64,
    pub note_id: i64,
    pub task_type: String,
    pub status: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub progress_current: i32,
    pub progress_total: i32,
    pub generation_id: Option<String>,
}

/// 任务状态枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::Running => "running",
            TaskStatus::Completed => "completed",
            TaskStatus::Failed => "failed",
            TaskStatus::Skipped => "skipped",
        }
    }
}

/// 整体状态枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverallStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Paused,
}

impl OverallStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            OverallStatus::Pending => "pending",
            OverallStatus::Running => "running",
            OverallStatus::Completed => "completed",
            OverallStatus::Failed => "failed",
            OverallStatus::Paused => "paused",
        }
    }
}

// ============================================================================
// 数据库操作
// ============================================================================

impl Database {
    /// 初始化笔记的任务进度记录
    pub fn init_note_tasks(&self, note_id: i64, configs: &[InitTaskConfig]) -> rusqlite::Result<()> {
        let conn = self.connection();

        // 序列化配置快照
        let config_snapshot = serde_json::to_string(configs).unwrap_or_else(|_| "[]".to_string());

        // 创建或更新进度记录
        conn.execute(
            "INSERT OR REPLACE INTO note_init_progress (note_id, config_snapshot, current_task_index, overall_status)
             VALUES (?1, ?2, 0, 'pending')",
            (note_id, &config_snapshot),
        )?;

        // 为每个启用的任务创建状态记录
        for config in configs {
            if config.enabled {
                conn.execute(
                    "INSERT OR REPLACE INTO note_init_tasks (note_id, task_type, status)
                     VALUES (?1, ?2, 'pending')",
                    (note_id, &config.task_type),
                )?;
            }
        }

        Ok(())
    }

    /// 更新任务状态
    pub fn update_init_task_status(
        &self,
        note_id: i64,
        task_type: &str,
        status: TaskStatus,
        error_message: Option<&str>,
        generation_id: Option<&str>,
    ) -> rusqlite::Result<()> {
        let conn = self.connection();

        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        match status {
            TaskStatus::Running => {
                conn.execute(
                    "UPDATE note_init_tasks
                     SET status = ?1, started_at = ?2, generation_id = ?3, updated_at = ?2
                     WHERE note_id = ?4 AND task_type = ?5",
                    (status.as_str(), &now, generation_id, note_id, task_type),
                )?;
            }
            TaskStatus::Completed => {
                conn.execute(
                    "UPDATE note_init_tasks
                     SET status = ?1, completed_at = ?2, updated_at = ?2
                     WHERE note_id = ?3 AND task_type = ?4",
                    (status.as_str(), &now, note_id, task_type),
                )?;
            }
            TaskStatus::Failed => {
                conn.execute(
                    "UPDATE note_init_tasks
                     SET status = ?1, completed_at = ?2, error_message = ?3, updated_at = ?2
                     WHERE note_id = ?4 AND task_type = ?5",
                    (status.as_str(), &now, error_message, note_id, task_type),
                )?;
            }
            _ => {
                conn.execute(
                    "UPDATE note_init_tasks
                     SET status = ?1, updated_at = ?2
                     WHERE note_id = ?3 AND task_type = ?4",
                    (status.as_str(), &now, note_id, task_type),
                )?;
            }
        }

        Ok(())
    }

    /// 更新任务进度
    pub fn update_init_task_progress(
        &self,
        note_id: i64,
        task_type: &str,
        current: i32,
        total: i32,
    ) -> rusqlite::Result<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE note_init_tasks
             SET progress_current = ?1, progress_total = ?2, updated_at = datetime('now', 'localtime')
             WHERE note_id = ?3 AND task_type = ?4",
            (current, total, note_id, task_type),
        )?;
        Ok(())
    }

    /// 更新当前任务索引
    pub fn update_current_task_index(&self, note_id: i64, index: i32) -> rusqlite::Result<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE note_init_progress
             SET current_task_index = ?1, updated_at = datetime('now', 'localtime')
             WHERE note_id = ?2",
            (index, note_id),
        )?;
        Ok(())
    }

    /// 更新整体状态
    pub fn update_overall_status(&self, note_id: i64, status: OverallStatus) -> rusqlite::Result<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE note_init_progress
             SET overall_status = ?1, updated_at = datetime('now', 'localtime')
             WHERE note_id = ?2",
            (status.as_str(), note_id),
        )?;
        Ok(())
    }

    /// 获取笔记的初始化进度
    pub fn get_note_init_progress(&self, note_id: i64) -> rusqlite::Result<Option<NoteInitProgress>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, config_snapshot, current_task_index, overall_status, created_at, updated_at
             FROM note_init_progress WHERE note_id = ?1"
        )?;

        let result = stmt.query_row([note_id], |row: &rusqlite::Row| {
            Ok(NoteInitProgress {
                id: row.get(0)?,
                note_id: row.get(1)?,
                config_snapshot: row.get(2)?,
                current_task_index: row.get(3)?,
                overall_status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        });

        match result {
            Ok(progress) => Ok(Some(progress)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 获取笔记的所有任务状态
    pub fn get_note_init_tasks(&self, note_id: i64) -> rusqlite::Result<Vec<NoteInitTask>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, task_type, status, started_at, completed_at, error_message,
                    progress_current, progress_total, generation_id
             FROM note_init_tasks WHERE note_id = ?1 ORDER BY id"
        )?;

        let tasks = stmt.query_map([note_id], |row: &rusqlite::Row| {
            Ok(NoteInitTask {
                id: row.get(0)?,
                note_id: row.get(1)?,
                task_type: row.get(2)?,
                status: row.get(3)?,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                error_message: row.get(6)?,
                progress_current: row.get(7)?,
                progress_total: row.get(8)?,
                generation_id: row.get(9)?,
            })
        })?;

        tasks.collect()
    }

    /// 检查启动时是否有待执行的任务
    pub fn get_pending_init_progress(&self) -> rusqlite::Result<Vec<NoteInitProgress>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, config_snapshot, current_task_index, overall_status, created_at, updated_at
             FROM note_init_progress
             WHERE overall_status IN ('running', 'paused', 'pending')
             ORDER BY created_at"
        )?;

        let progress_list = stmt.query_map([], |row: &rusqlite::Row| {
            Ok(NoteInitProgress {
                id: row.get(0)?,
                note_id: row.get(1)?,
                config_snapshot: row.get(2)?,
                current_task_index: row.get(3)?,
                overall_status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        progress_list.collect()
    }

    /// 标记笔记初始化完成
    pub fn complete_note_init(&self, note_id: i64) -> rusqlite::Result<()> {
        self.update_overall_status(note_id, OverallStatus::Completed)
    }

    /// 删除笔记的初始化记录
    pub fn delete_note_init_records(&self, note_id: i64) -> rusqlite::Result<()> {
        let conn = self.connection();
        conn.execute("DELETE FROM note_init_tasks WHERE note_id = ?1", [note_id])?;
        conn.execute("DELETE FROM note_init_progress WHERE note_id = ?1", [note_id])?;
        Ok(())
    }
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 初始化笔记的任务进度记录
#[tauri::command]
pub async fn init_note_init_tasks(note_id: i64) -> Result<(), String> {
    let db = crate::get_db();

    // 获取启用的任务配置
    let configs = db.get_enabled_init_task_configs()
        .map_err(|e| format!("获取任务配置失败: {}", e))?;

    // 初始化任务记录
    db.init_note_tasks(note_id, &configs)
        .map_err(|e| format!("初始化任务记录失败: {}", e))?;

    Ok(())
}

/// 更新任务状态
#[tauri::command]
pub async fn update_note_init_task_status(
    note_id: i64,
    task_type: String,
    status: String,
    error_message: Option<String>,
    generation_id: Option<String>,
) -> Result<(), String> {
    let db = crate::get_db();

    let task_status = match status.as_str() {
        "pending" => TaskStatus::Pending,
        "running" => TaskStatus::Running,
        "completed" => TaskStatus::Completed,
        "failed" => TaskStatus::Failed,
        "skipped" => TaskStatus::Skipped,
        _ => return Err(format!("无效的状态: {}", status)),
    };

    db.update_init_task_status(
        note_id,
        &task_type,
        task_status,
        error_message.as_deref(),
        generation_id.as_deref(),
    ).map_err(|e| format!("更新任务状态失败: {}", e))?;

    Ok(())
}

/// 更新任务进度
#[tauri::command]
pub async fn update_note_init_task_progress(
    note_id: i64,
    task_type: String,
    current: i32,
    total: i32,
) -> Result<(), String> {
    let db = crate::get_db();
    db.update_init_task_progress(note_id, &task_type, current, total)
        .map_err(|e| format!("更新任务进度失败: {}", e))
}

/// 更新当前任务索引
#[tauri::command]
pub async fn update_current_init_task_index(note_id: i64, index: i32) -> Result<(), String> {
    let db = crate::get_db();
    db.update_current_task_index(note_id, index)
        .map_err(|e| format!("更新任务索引失败: {}", e))
}

/// 更新整体状态
#[tauri::command]
pub async fn update_note_init_overall_status(note_id: i64, status: String) -> Result<(), String> {
    let db = crate::get_db();

    let overall_status = match status.as_str() {
        "pending" => OverallStatus::Pending,
        "running" => OverallStatus::Running,
        "completed" => OverallStatus::Completed,
        "failed" => OverallStatus::Failed,
        "paused" => OverallStatus::Paused,
        _ => return Err(format!("无效的状态: {}", status)),
    };

    db.update_overall_status(note_id, overall_status)
        .map_err(|e| format!("更新整体状态失败: {}", e))
}

/// 获取笔记的初始化进度
#[tauri::command]
pub async fn get_note_init_progress(note_id: i64) -> Result<Option<NoteInitProgress>, String> {
    let db = crate::get_db();
    db.get_note_init_progress(note_id)
        .map_err(|e| format!("获取初始化进度失败: {}", e))
}

/// 获取笔记的所有任务状态
#[tauri::command]
pub async fn get_note_init_tasks(note_id: i64) -> Result<Vec<NoteInitTask>, String> {
    let db = crate::get_db();
    db.get_note_init_tasks(note_id)
        .map_err(|e| format!("获取任务状态失败: {}", e))
}

/// 检查启动时是否有待执行的任务
#[tauri::command]
pub async fn check_pending_init_tasks() -> Result<Vec<NoteInitProgress>, String> {
    let db = crate::get_db();
    db.get_pending_init_progress()
        .map_err(|e| format!("检查待执行任务失败: {}", e))
}

/// 标记笔记初始化完成
#[tauri::command]
pub async fn complete_note_init(note_id: i64) -> Result<(), String> {
    let db = crate::get_db();
    db.complete_note_init(note_id)
        .map_err(|e| format!("标记完成失败: {}", e))
}
