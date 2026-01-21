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
            // 依赖关系说明：
            // - 字幕优化依赖原文细读（需要章节数据）
            // - 其他任务都是独立的，直接使用字幕文件
            let default_configs = [
                ("full_summary", "全文总结", 1, 1, 0, None::<&str>),
                ("detailed_reading", "原文细读", 1, 2, 0, None),
                ("subtitle_optimization", "字幕优化", 0, 3, 0, Some("[\"detailed_reading\"]")),
                ("highlights", "高光笔记", 1, 4, 0, None),  // 直接使用字幕文件，无依赖
                ("suggested_questions", "推荐问题", 1, 5, 1, None),  // 直接使用字幕文件，无依赖
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

        // 迁移：修正任务依赖关系（v2）
        // - 原文细读：移除对全文总结的依赖（独立任务）
        // - 高光笔记：移除对原文细读的依赖（直接使用字幕文件）
        // - 推荐问题：移除对全文总结的依赖（直接使用字幕文件）
        // - 字幕优化：保持对原文细读的依赖（需要章节数据）
        conn.execute(
            "UPDATE init_task_configs SET depends_on = NULL WHERE task_type = 'detailed_reading'",
            [],
        )?;
        conn.execute(
            "UPDATE init_task_configs SET depends_on = NULL WHERE task_type = 'highlights'",
            [],
        )?;
        conn.execute(
            "UPDATE init_task_configs SET depends_on = NULL WHERE task_type = 'suggested_questions'",
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
///
/// 处理依赖关系的特殊情况：
/// 1. 字幕优化依赖原文细读，如果原文细读未启用则移除字幕优化
/// 2. 如果依赖项的顺序在当前任务之后，则自动调整当前任务到依赖项之后
#[tauri::command]
pub async fn get_enabled_init_task_configs() -> Result<Vec<InitTaskConfig>, String> {
    let db = crate::get_db();
    let configs = db.get_enabled_init_task_configs()
        .map_err(|e| format!("获取启用的任务配置失败: {}", e))?;

    // 检查依赖关系并处理
    let configs = process_task_dependencies(configs);

    // 打印完整的任务列表
    let task_names: Vec<&str> = configs.iter().map(|c| {
        match c.task_type.as_str() {
            "full_summary" => "全文总结",
            "detailed_reading" => "原文细读",
            "subtitle_optimization" => "字幕优化",
            "highlights" => "高光笔记",
            "suggested_questions" => "推荐问题",
            "flashcards" => "闪记卡",
            _ => c.task_type.as_str(),
        }
    }).collect();
    eprintln!("[初始化任务] 将按以下顺序执行 {} 个任务: {:?}", configs.len(), task_names);

    Ok(configs)
}

/// 处理任务依赖关系
///
/// 规则：
/// 1. 如果任务有依赖项且依赖项未启用，则移除该任务（如字幕优化依赖原文细读）
/// 2. 如果依赖项的顺序在当前任务之后，则自动调整当前任务到依赖项之后
fn process_task_dependencies(mut configs: Vec<InitTaskConfig>) -> Vec<InitTaskConfig> {
    // 构建任务类型到索引的映射
    let task_index_map: std::collections::HashMap<String, usize> = configs
        .iter()
        .enumerate()
        .map(|(i, c)| (c.task_type.clone(), i))
        .collect();

    // 收集需要移除的任务（有依赖且依赖项未启用）
    let mut tasks_to_remove: Vec<String> = Vec::new();

    // 收集需要调整顺序的任务
    let mut order_adjustments: Vec<(String, i32)> = Vec::new();

    for config in &configs {
        if let Some(ref depends_on) = config.depends_on {
            if depends_on.is_empty() {
                continue;
            }

            for dep in depends_on {
                // 检查依赖项是否存在于启用的任务中
                if let Some(&dep_index) = task_index_map.get(dep) {
                    // 依赖项存在，检查顺序
                    if let Some(&current_index) = task_index_map.get(&config.task_type) {
                        if current_index < dep_index {
                            // 当前任务在依赖项之前，需要调整顺序
                            let dep_sort_order = configs[dep_index].sort_order;
                            order_adjustments.push((config.task_type.clone(), dep_sort_order + 1));
                            eprintln!(
                                "[初始化任务] 任务 '{}' 依赖于 '{}'，但顺序在其之前，自动调整到其后面",
                                config.task_name, configs[dep_index].task_name
                            );
                        }
                    }
                } else {
                    // 依赖项不存在（未启用），移除当前任务
                    tasks_to_remove.push(config.task_type.clone());
                    eprintln!(
                        "[初始化任务] 任务 '{}' 的依赖项 '{}' 未启用，跳过该任务",
                        config.task_name, dep
                    );
                    break;
                }
            }
        }
    }

    // 移除依赖项未启用的任务
    configs.retain(|c| !tasks_to_remove.contains(&c.task_type));

    // 应用顺序调整
    for (task_type, new_sort_order) in order_adjustments {
        if let Some(config) = configs.iter_mut().find(|c| c.task_type == task_type) {
            config.sort_order = new_sort_order;
        }
    }

    // 按 sort_order 重新排序
    configs.sort_by_key(|c| c.sort_order);

    configs
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
