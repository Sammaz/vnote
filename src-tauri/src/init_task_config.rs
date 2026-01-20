//! 初始化任务配置管理模块
//!
//! 管理笔记创建后自动执行的初始化任务配置，包括：
//! - 任务启用/禁用
//! - 任务执行顺序
//! - 任务依赖关系

use serde::{Deserialize, Serialize};

use crate::db::Database;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 初始化任务配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitTaskConfig {
    pub id: i64,
    pub task_type: String,
    pub task_name: String,
    pub enabled: bool,
    pub sort_order: i32,
    pub is_required: bool,
    pub depends_on: Option<Vec<String>>,
}

/// 用于更新配置的请求结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInitTaskConfigRequest {
    pub task_type: String,
    pub enabled: bool,
    pub sort_order: i32,
}

// ============================================================================
// 数据库操作
// ============================================================================

impl Database {
    /// 初始化任务配置表
    pub fn init_task_config_tables(&self) -> rusqlite::Result<()> {
        let conn = self.connection();

        // 创建初始化任务配置表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS init_task_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_type TEXT NOT NULL UNIQUE,
                task_name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL,
                is_required INTEGER NOT NULL DEFAULT 0,
                depends_on TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )",
            [],
        )?;

        // 检查是否已有数据，没有则插入默认配置
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM init_task_configs",
            [],
            |row: &rusqlite::Row| row.get(0),
        )?;

        if count == 0 {
            // 插入默认任务配置
            let default_configs = [
                ("full_summary", "全文总结", 1, 1, 0, None::<&str>),
                ("detailed_reading", "原文细读", 1, 2, 0, Some("[\"full_summary\"]")),
                ("subtitle_optimization", "字幕优化", 0, 3, 0, Some("[\"detailed_reading\"]")),
                ("highlights", "高光笔记", 1, 4, 0, Some("[\"detailed_reading\"]")),
                ("suggested_questions", "推荐问题", 1, 5, 1, Some("[\"full_summary\"]")),
                ("flashcards", "闪记卡", 1, 6, 0, None),
            ];

            for (task_type, task_name, enabled, sort_order, is_required, depends_on) in default_configs {
                conn.execute(
                    "INSERT INTO init_task_configs (task_type, task_name, enabled, sort_order, is_required, depends_on)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    (task_type, task_name, enabled, sort_order, is_required, depends_on),
                )?;
            }
        }

        // 创建笔记初始化进度表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_init_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id INTEGER NOT NULL UNIQUE,
                config_snapshot TEXT NOT NULL,
                current_task_index INTEGER NOT NULL DEFAULT 0,
                overall_status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 创建笔记初始化任务状态表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_init_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id INTEGER NOT NULL,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                started_at TEXT,
                completed_at TEXT,
                error_message TEXT,
                progress_current INTEGER DEFAULT 0,
                progress_total INTEGER DEFAULT 0,
                generation_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                UNIQUE(note_id, task_type),
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 创建索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_init_progress_status ON note_init_progress(overall_status)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_init_tasks_note ON note_init_tasks(note_id)",
            [],
        )?;

        Ok(())
    }

    /// 获取所有任务配置（按 sort_order 排序）
    pub fn get_all_init_task_configs(&self) -> rusqlite::Result<Vec<InitTaskConfig>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, task_type, task_name, enabled, sort_order, is_required, depends_on
             FROM init_task_configs ORDER BY sort_order"
        )?;

        let configs = stmt.query_map([], |row: &rusqlite::Row| {
            let depends_on_str: Option<String> = row.get(6)?;
            let depends_on = depends_on_str.and_then(|s: String| {
                serde_json::from_str::<Vec<String>>(&s).ok()
            });

            Ok(InitTaskConfig {
                id: row.get(0)?,
                task_type: row.get(1)?,
                task_name: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                sort_order: row.get(4)?,
                is_required: row.get::<_, i64>(5)? != 0,
                depends_on,
            })
        })?;

        configs.collect()
    }

    /// 获取启用的任务配置（按执行顺序）
    pub fn get_enabled_init_task_configs(&self) -> rusqlite::Result<Vec<InitTaskConfig>> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, task_type, task_name, enabled, sort_order, is_required, depends_on
             FROM init_task_configs WHERE enabled = 1 ORDER BY sort_order"
        )?;

        let configs = stmt.query_map([], |row: &rusqlite::Row| {
            let depends_on_str: Option<String> = row.get(6)?;
            let depends_on = depends_on_str.and_then(|s: String| {
                serde_json::from_str::<Vec<String>>(&s).ok()
            });

            Ok(InitTaskConfig {
                id: row.get(0)?,
                task_type: row.get(1)?,
                task_name: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                sort_order: row.get(4)?,
                is_required: row.get::<_, i64>(5)? != 0,
                depends_on,
            })
        })?;

        configs.collect()
    }

    /// 批量更新任务配置
    pub fn update_init_task_configs(&self, updates: &[UpdateInitTaskConfigRequest]) -> rusqlite::Result<()> {
        let conn = self.connection();

        for update in updates {
            conn.execute(
                "UPDATE init_task_configs
                 SET enabled = ?1, sort_order = ?2, updated_at = datetime('now', 'localtime')
                 WHERE task_type = ?3",
                (update.enabled as i32, update.sort_order, &update.task_type),
            )?;
        }

        Ok(())
    }

    /// 更新单个任务配置
    pub fn update_single_init_task_config(&self, task_type: &str, enabled: bool, sort_order: i32) -> rusqlite::Result<()> {
        let conn = self.connection();
        conn.execute(
            "UPDATE init_task_configs
             SET enabled = ?1, sort_order = ?2, updated_at = datetime('now', 'localtime')
             WHERE task_type = ?3",
            (enabled as i32, sort_order, task_type),
        )?;
        Ok(())
    }
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 获取所有初始化任务配置
#[tauri::command]
pub async fn get_init_task_configs() -> Result<Vec<InitTaskConfig>, String> {
    let db = crate::get_db();
    db.get_all_init_task_configs()
        .map_err(|e| format!("获取任务配置失败: {}", e))
}

/// 获取启用的初始化任务配置
#[tauri::command]
pub async fn get_enabled_init_task_configs() -> Result<Vec<InitTaskConfig>, String> {
    let db = crate::get_db();
    db.get_enabled_init_task_configs()
        .map_err(|e| format!("获取启用的任务配置失败: {}", e))
}

/// 保存初始化任务配置（批量更新）
#[tauri::command]
pub async fn save_init_task_configs(configs: Vec<UpdateInitTaskConfigRequest>) -> Result<(), String> {
    let db = crate::get_db();
    db.update_init_task_configs(&configs)
        .map_err(|e| format!("保存任务配置失败: {}", e))
}

/// 更新单个任务配置
#[tauri::command]
pub async fn update_init_task_config(
    task_type: String,
    enabled: bool,
    sort_order: i32,
) -> Result<(), String> {
    let db = crate::get_db();
    db.update_single_init_task_config(&task_type, enabled, sort_order)
        .map_err(|e| format!("更新任务配置失败: {}", e))
}
