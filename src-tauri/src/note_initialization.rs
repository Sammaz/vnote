//! 笔记初始化模块（item 级执行）
//!
//! 新语义：
//! - 基于初始化项目（item）而非固定步骤断点
//! - 状态持久化在 note_initialization_runs / note_initialization_items
//! - 应用重启后仅展示状态，不自动恢复执行

use crate::bcut_asr;
use crate::chapter::{Chapter, DetailedReadingData};
use crate::chat;
use crate::db::{
    NoteInitializationItem,
    NoteInitializationItemStatus,
    NoteInitializationRunStatus,
    UpsertNoteInitializationItemInput,
    UpsertNoteInitializationRunInput,
};
use crate::note_generation;
use crate::subtitle_optimizer::ChapterSubtitleInput;
use crate::DATABASE;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializationItemDefinition {
    pub item_key: String,
    pub display_name: String,
    pub description: String,
    pub dependencies: Vec<String>,
    pub output_target: String,
    pub default_config: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InitializationParams {
    pub note_id: String,
    pub model_id: String,
    pub video_path: String,
    pub subtitle_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum NoteInitializationEvent {
    Starting {
        initialization_id: String,
        total_steps: usize,
        steps: Vec<String>,
    },
    StepStarting {
        step: String,
        step_index: usize,
        step_name: String,
    },
    StepProgress {
        step: String,
        message: String,
    },
    StepCompleted {
        step: String,
        step_index: usize,
        step_name: String,
    },
    StepSkipped {
        step: String,
        step_index: usize,
        step_name: String,
        reason: String,
    },
    StepFailed {
        step: String,
        step_index: usize,
        step_name: String,
        error: String,
    },
    Completed {
        completed: usize,
        skipped: usize,
        failed: usize,
        total: usize,
    },
    Error {
        error: String,
    },
    Aborted,
}

#[derive(Debug, Clone)]
enum ItemExecutionResult {
    Completed,
    Skipped(String),
    Failed(String),
}

#[derive(Debug, Clone)]
struct ExecutionContext {
    note_id: String,
    model_id: String,
    video_path: String,
    subtitle_path: Option<String>,
}

// ============================================================================
// 注册表
// ============================================================================

pub fn get_initialization_registry() -> Vec<InitializationItemDefinition> {
    vec![
        InitializationItemDefinition {
            item_key: "subtitle_generation".to_string(),
            display_name: "字幕生成".to_string(),
            description: "自动转录视频生成字幕文件。".to_string(),
            dependencies: vec![],
            output_target: "notes.subtitle_path".to_string(),
            default_config: serde_json::json!({ "regenerate": false }),
        },
        InitializationItemDefinition {
            item_key: "suggested_questions".to_string(),
            display_name: "推荐问题".to_string(),
            description: "根据字幕生成推荐提问。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.suggested_questions".to_string(),
            default_config: serde_json::json!({ "regenerate": false }),
        },
        InitializationItemDefinition {
            item_key: "full_summary".to_string(),
            display_name: "全文总结".to_string(),
            description: "生成结构化全文总结。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.full_summary".to_string(),
            default_config: serde_json::json!({ "regenerate": false, "custom_prompt": null, "style": null }),
        },
        InitializationItemDefinition {
            item_key: "detailed_reading".to_string(),
            display_name: "原文细读".to_string(),
            description: "生成章节化原文细读。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.detailed_reading".to_string(),
            default_config: serde_json::json!({ "regenerate": false }),
        },
        InitializationItemDefinition {
            item_key: "subtitle_optimization".to_string(),
            display_name: "字幕优化".to_string(),
            description: "按章节优化字幕内容。".to_string(),
            dependencies: vec!["subtitle_generation".to_string(), "detailed_reading".to_string()],
            output_target: "optimized_subtitles".to_string(),
            default_config: serde_json::json!({ "regenerate": false }),
        },
        InitializationItemDefinition {
            item_key: "highlights".to_string(),
            display_name: "高光笔记".to_string(),
            description: "生成高光片段与摘要。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.highlights".to_string(),
            default_config: serde_json::json!({ "regenerate": false, "highlight_type": "default" }),
        },
        InitializationItemDefinition {
            item_key: "flashcards".to_string(),
            display_name: "闪记卡".to_string(),
            description: "生成记忆卡片内容。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.flashcards".to_string(),
            default_config: serde_json::json!({ "regenerate": false }),
        },
        InitializationItemDefinition {
            item_key: "visual_summary".to_string(),
            display_name: "视觉化总结".to_string(),
            description: "根据章节与字幕生成视觉化总结。".to_string(),
            dependencies: vec!["detailed_reading".to_string()],
            output_target: "notes.visual_summary".to_string(),
            default_config: serde_json::json!({ "regenerate": false, "show_timestamp": true, "prefer_optimized_subtitles": true }),
        },
        InitializationItemDefinition {
            item_key: "custom_summary".to_string(),
            display_name: "自定义总结".to_string(),
            description: "按自定义提示词生成总结。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.custom_summary".to_string(),
            default_config: serde_json::json!({
                "regenerate": false,
                "custom_prompt": "你是一位高效的学习笔记整理专家。请基于以下视频字幕，生成一份面向实际应用的精炼总结。\n\n输出要求：\n1. 使用 Markdown 格式，结构紧凑，适合快速回顾\n2. 使用中文输出，专有名词保留英文\n3. 严格按照以下格式：\n\n## 一句话概括\n用一句话（30字以内）说清这个视频讲了什么。\n\n## 核心要点\n用编号列表提炼 3-5 个最重要的观点或结论，每条 1-2 句话，前面加合适的 emoji。\n\n## 行动清单\n提炼出可以直接落地执行的建议或步骤，以任务清单（- [ ]）格式输出。\n\n## 值得深挖\n列出视频中提到但未展开、值得进一步学习的概念或资源（1-3 条）。"
            }),
        },
        InitializationItemDefinition {
            item_key: "ai_note".to_string(),
            display_name: "大纲笔记".to_string(),
            description: "生成大纲式 AI 笔记。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.ai_note_markdown".to_string(),
            default_config: serde_json::json!({ "regenerate": false, "style": "detailed", "custom_prompt": null, "screenshot_density": "moderate" }),
        },
        InitializationItemDefinition {
            item_key: "panoramic_blueprint".to_string(),
            display_name: "深度蓝图".to_string(),
            description: "生成全景式深度蓝图。".to_string(),
            dependencies: vec!["subtitle_generation".to_string()],
            output_target: "notes.panoramic_blueprint".to_string(),
            default_config: serde_json::json!({ "regenerate": false }),
        },
    ]
}

fn registry_map() -> HashMap<String, InitializationItemDefinition> {
    get_initialization_registry()
        .into_iter()
        .map(|d| (d.item_key.clone(), d))
        .collect()
}

// ============================================================================
// 状态同步
// ============================================================================

pub fn detect_output_presence(note: &crate::db::Note, item_key: &str, db: &crate::db::Database) -> bool {
    match item_key {
        "subtitle_generation" => note.subtitle_path.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "suggested_questions" => note.suggested_questions.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "full_summary" => note.full_summary.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "detailed_reading" => note.detailed_reading.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "subtitle_optimization" => db
            .get_optimized_subtitles(&note.id)
            .map(|items| !items.is_empty())
            .unwrap_or(false),
        "highlights" => note.highlights.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "flashcards" => note.flashcards.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "visual_summary" => note.visual_summary.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "custom_summary" => note.custom_summary.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "ai_note" => note.ai_note_markdown.as_ref().is_some_and(|s| !s.trim().is_empty()),
        "panoramic_blueprint" => note
            .panoramic_blueprint
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty()),
        _ => false,
    }
}

pub fn sync_note_initialization_outputs(note_id: &str) -> Result<Vec<NoteInitializationItem>, String> {
    let db = DATABASE.get().ok_or("数据库未初始化")?;
    let note = db
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "笔记不存在".to_string())?;

    let existing_items = db
        .get_note_initialization_items(note_id)
        .map_err(|e| e.to_string())?;
    let mut existing_map: HashMap<String, NoteInitializationItem> = existing_items
        .into_iter()
        .map(|item| (item.item_key.clone(), item))
        .collect();

    let mut next_items = Vec::new();
    for definition in get_initialization_registry() {
        let output_present = detect_output_presence(&note, &definition.item_key, db);
        let existing = existing_map.remove(&definition.item_key);

        let status = if output_present {
            NoteInitializationItemStatus::Completed
        } else {
            existing
                .as_ref()
                .map(|item| item.status.clone())
                .unwrap_or(NoteInitializationItemStatus::Pending)
        };

        next_items.push(UpsertNoteInitializationItemInput {
            note_id: note_id.to_string(),
            item_key: definition.item_key.clone(),
            status,
            depends_on: existing
                .as_ref()
                .map(|item| item.depends_on.clone())
                .unwrap_or_else(|| definition.dependencies.clone()),
            last_model_id: existing.as_ref().and_then(|item| item.last_model_id.clone()),
            last_error: existing.as_ref().and_then(|item| item.last_error.clone()),
            output_present,
            started_at: existing.as_ref().and_then(|item| item.started_at.clone()),
            completed_at: existing.as_ref().and_then(|item| item.completed_at.clone()),
        });
    }

    db.replace_note_initialization_items(note_id, &next_items)
        .map_err(|e| e.to_string())
}

pub fn ensure_note_initialization_state(note_id: &str) -> Result<(), String> {
    let db = DATABASE.get().ok_or("数据库未初始化")?;
    let _note = db
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "笔记不存在".to_string())?;

    let existing_run = db
        .get_note_initialization_run(note_id)
        .map_err(|e| e.to_string())?;
    let items = sync_note_initialization_outputs(note_id)?;

    let running_count = items
        .iter()
        .filter(|item| matches!(item.status, NoteInitializationItemStatus::Running))
        .count();
    let queued_count = items
        .iter()
        .filter(|item| matches!(item.status, NoteInitializationItemStatus::Queued))
        .count();
    let failed_count = items
        .iter()
        .filter(|item| {
            matches!(
                item.status,
                NoteInitializationItemStatus::Failed | NoteInitializationItemStatus::Blocked
            )
        })
        .count();
    let canceled_count = items
        .iter()
        .filter(|item| matches!(item.status, NoteInitializationItemStatus::Canceled))
        .count();
    let pending_count = items
        .iter()
        .filter(|item| {
            matches!(
                item.status,
                NoteInitializationItemStatus::Pending
                    | NoteInitializationItemStatus::Queued
                    | NoteInitializationItemStatus::Blocked
            )
        })
        .count();
    let has_any_run = items
        .iter()
        .any(|item| !matches!(item.status, NoteInitializationItemStatus::Pending));

    let status = if running_count > 0 {
        NoteInitializationRunStatus::Running
    } else if queued_count > 0 {
        NoteInitializationRunStatus::Queued
    } else if canceled_count > 0 {
        NoteInitializationRunStatus::Canceled
    } else if failed_count > 0 {
        NoteInitializationRunStatus::PartialFailed
    } else if has_any_run && pending_count == 0 {
        NoteInitializationRunStatus::Completed
    } else {
        NoteInitializationRunStatus::Idle
    };

    let preserved_last_error = existing_run.as_ref().and_then(|run| match status {
        NoteInitializationRunStatus::Failed
        | NoteInitializationRunStatus::PartialFailed
        | NoteInitializationRunStatus::Canceled => run.last_error.clone(),
        _ => None,
    });
    let preserved_started_at = existing_run.as_ref().and_then(|run| run.started_at.clone());
    let preserved_completed_at = existing_run.as_ref().and_then(|run| match status {
        NoteInitializationRunStatus::Completed
        | NoteInitializationRunStatus::Failed
        | NoteInitializationRunStatus::PartialFailed
        | NoteInitializationRunStatus::Canceled => run.completed_at.clone(),
        _ => None,
    });

    db.upsert_note_initialization_run(&UpsertNoteInitializationRunInput {
        note_id: note_id.to_string(),
        status,
        model_override_id: existing_run.and_then(|run| run.model_override_id),
        last_error: preserved_last_error,
        started_at: preserved_started_at,
        completed_at: preserved_completed_at,
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// 全局中止标志
// ============================================================================

static INITIALIZATION_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static ACTIVE_INITIALIZATION_NOTES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static PENDING_INITIALIZATIONS: OnceLock<Mutex<HashMap<String, PendingInitialization>>> = OnceLock::new();

#[derive(Clone)]
struct PendingInitialization {
    app: AppHandle,
    params: InitializationParams,
    event_name: String,
    abort_flag: Arc<AtomicBool>,
}

fn get_abort_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    INITIALIZATION_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_active_initialization_notes() -> &'static Mutex<HashMap<String, String>> {
    ACTIVE_INITIALIZATION_NOTES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_pending_initializations() -> &'static Mutex<HashMap<String, PendingInitialization>> {
    PENDING_INITIALIZATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn register_abort_flag(initialization_id: &str) -> Arc<AtomicBool> {
    let mut flags = get_abort_flags().lock().await;
    let flag = Arc::new(AtomicBool::new(false));
    flags.insert(initialization_id.to_string(), flag.clone());
    flag
}

async fn cleanup_abort_flag(initialization_id: &str) {
    let mut flags = get_abort_flags().lock().await;
    flags.remove(initialization_id);
}

async fn release_note_guard(initialization_id: &str) {
    let mut active = get_active_initialization_notes().lock().await;
    active.retain(|_, current_init_id| current_init_id != initialization_id);
}

fn is_aborted(abort_flag: &Arc<AtomicBool>) -> bool {
    abort_flag.load(Ordering::Relaxed)
}

pub async fn abort_initialization(initialization_id: &str) -> Result<(), String> {
    let removed_pending = {
        let mut pending_map = get_pending_initializations().lock().await;
        pending_map.remove(initialization_id).is_some()
    };

    if removed_pending {
        cleanup_abort_flag(initialization_id).await;
        release_note_guard(initialization_id).await;
        return Ok(());
    }

    let flags = get_abort_flags().lock().await;
    if let Some(flag) = flags.get(initialization_id) {
        flag.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("初始化任务不存在".to_string())
    }
}

// ============================================================================
// 主流程
// ============================================================================

pub async fn prepare_initialization(app: AppHandle, params: InitializationParams) -> Result<String, String> {
    ensure_note_initialization_state(&params.note_id)?;

    let initialization_id = format!("init-{}-{}", params.note_id, uuid::Uuid::new_v4());
    let event_name = format!("note-initialization-{}", initialization_id);

    {
        let mut active = get_active_initialization_notes().lock().await;
        if active.contains_key(&params.note_id) {
            return Err("该笔记已有初始化任务正在运行".to_string());
        }
        active.insert(params.note_id.clone(), initialization_id.clone());
    }

    let abort_flag = register_abort_flag(&initialization_id).await;

    let pending = PendingInitialization {
        app,
        params,
        event_name,
        abort_flag,
    };

    let mut pending_map = get_pending_initializations().lock().await;
    pending_map.insert(initialization_id.clone(), pending);
    drop(pending_map);

    Ok(initialization_id)
}

pub async fn start_initialization(initialization_id: &str) -> Result<(), String> {
    let pending = {
        let mut pending_map = get_pending_initializations().lock().await;
        pending_map.remove(initialization_id)
    }
    .ok_or_else(|| "初始化任务不存在或已启动".to_string())?;

    let init_id = initialization_id.to_string();
    let event_name_clone = pending.event_name.clone();
    let app = pending.app.clone();

    tokio::spawn(async move {
        let result = run_initialization(
            pending.app.clone(),
            &pending.event_name,
            &init_id,
            pending.params,
            pending.abort_flag,
        )
        .await;

        cleanup_abort_flag(&init_id).await;
        release_note_guard(&init_id).await;

        if let Err(error) = result {
            let _ = app.emit(&event_name_clone, NoteInitializationEvent::Error { error });
        }
    });

    Ok(())
}

async fn run_initialization(
    app: AppHandle,
    event_name: &str,
    initialization_id: &str,
    params: InitializationParams,
    abort_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let db = DATABASE.get().ok_or("数据库未初始化")?;

    let registry = get_initialization_registry();
    let registry_map = registry_map();

    let note = db
        .get_note_by_id(&params.note_id)
        .map_err(|e| format!("获取笔记失败: {}", e))?
        .ok_or_else(|| "笔记不存在".to_string())?;

    let mut detail = db
        .get_note_initialization_detail(&params.note_id)
        .map_err(|e| e.to_string())?;

    let model_override_id = detail.run.as_ref().and_then(|run| run.model_override_id.clone());
    let resolved_model_id = model_override_id
        .clone()
        .or_else(|| {
            if params.model_id.trim().is_empty() {
                None
            } else {
                Some(params.model_id.clone())
            }
        })
        .or_else(|| {
            db.get_default_ai_config()
                .ok()
                .flatten()
                .map(|config| config.id)
        })
        .ok_or_else(|| "未配置AI模型".to_string())?;

    let _ = db
        .get_ai_config_by_id(&resolved_model_id)
        .map_err(|e| format!("获取 AI 配置失败: {}", e))?
        .ok_or_else(|| "AI 配置不存在".to_string())?;

    let explicitly_selected: HashSet<String> = {
        let raw = db
            .get_setting("initialization_template_selected_keys")
            .map_err(|e| format!("读取初始化配置失败: {}", e))?
            .unwrap_or_default();
        if raw.trim().is_empty() {
            HashSet::new()
        } else {
            serde_json::from_str::<Vec<String>>(&raw)
                .unwrap_or_default()
                .into_iter()
                .filter(|key| registry_map.contains_key(key.as_str()))
                .collect()
        }
    };

    let dependency_map: HashMap<String, Vec<String>> = registry
        .iter()
        .map(|d| (d.item_key.clone(), d.dependencies.clone()))
        .collect();
    let expanded_selected = expand_dependencies(&explicitly_selected, &dependency_map);
    let _auto_locked: HashSet<String> = expanded_selected
        .difference(&explicitly_selected)
        .cloned()
        .collect();

    let execution_plan: Vec<InitializationItemDefinition> = registry
        .iter()
        .filter(|d| expanded_selected.contains(&d.item_key))
        .cloned()
        .collect();

    if execution_plan.is_empty() {
        return Err("没有可执行的初始化项目".to_string());
    }

    let plan_steps: Vec<String> = execution_plan
        .iter()
        .map(|item| item.display_name.clone())
        .collect();

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::Starting {
            initialization_id: initialization_id.to_string(),
            total_steps: execution_plan.len(),
            steps: plan_steps,
        },
    );

    let mut context = ExecutionContext {
        note_id: params.note_id.clone(),
        model_id: resolved_model_id.clone(),
        video_path: params.video_path.clone(),
        subtitle_path: params.subtitle_path.clone().or(note.subtitle_path.clone()),
    };

    let mut item_map: HashMap<String, NoteInitializationItem> = detail
        .items
        .drain(..)
        .map(|item| (item.item_key.clone(), item))
        .collect();

    // 新一轮运行前，将参与运行的 item 置为 queued
    for definition in &registry {
        let mut item = item_map
            .get(&definition.item_key)
            .cloned()
            .unwrap_or_else(|| create_default_item(&params.note_id, definition));

        if item.depends_on.is_empty() {
            item.depends_on = definition.dependencies.clone();
        }

        let latest_note = db
            .get_note_by_id(&params.note_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "笔记不存在".to_string())?;
        item.output_present = detect_output_presence(&latest_note, &definition.item_key, db);

        if expanded_selected.contains(&definition.item_key) {
            item.status = NoteInitializationItemStatus::Queued;
            item.last_error = None;
            item.started_at = None;
            item.completed_at = None;
            item.last_model_id = Some(resolved_model_id.clone());
        }

        item = upsert_item(db, &item)?;
        item_map.insert(item.item_key.clone(), item);
    }

    db.upsert_note_initialization_run(&UpsertNoteInitializationRunInput {
        note_id: params.note_id.clone(),
        status: NoteInitializationRunStatus::Running,
        model_override_id: model_override_id.clone(),
        last_error: None,
        started_at: Some(chrono::Local::now().to_rfc3339()),
        completed_at: None,
    })
    .map_err(|e| e.to_string())?;

    tracing::info!(
        note_id = %params.note_id,
        model_id = %resolved_model_id,
        selected_steps = ?execution_plan.iter().map(|item| item.item_key.clone()).collect::<Vec<_>>(),
        "[初始化] 启动初始化运行"
    );

    let mut completed = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    let mut runtime_status: HashMap<String, NoteInitializationItemStatus> = HashMap::new();
    for item in item_map.values() {
        runtime_status.insert(item.item_key.clone(), item.status.clone());
    }

    for (step_index, definition) in execution_plan.iter().enumerate() {
        if is_aborted(&abort_flag) {
            mark_remaining_as_canceled(
                db,
                &execution_plan,
                step_index,
                &mut item_map,
                &mut runtime_status,
                &resolved_model_id,
            )?;

            db.upsert_note_initialization_run(&UpsertNoteInitializationRunInput {
                note_id: params.note_id.clone(),
                status: NoteInitializationRunStatus::Canceled,
                model_override_id: model_override_id.clone(),
                last_error: Some("用户取消初始化任务".to_string()),
                started_at: None,
                completed_at: Some(chrono::Local::now().to_rfc3339()),
            })
            .map_err(|e| e.to_string())?;

            let _ = app.emit(event_name, NoteInitializationEvent::Aborted);
            return Ok(());
        }

        let step_key = definition.item_key.clone();
        let step_name = definition.display_name.clone();

        tracing::info!(
            note_id = %params.note_id,
            model_id = %resolved_model_id,
            step_index,
            step_key = %step_key,
            step_name = %step_name,
            depends_on = ?definition.dependencies,
            "[初始化] 开始执行步骤"
        );

        let _ = app.emit(
            event_name,
            NoteInitializationEvent::StepStarting {
                step: step_key.clone(),
                step_index,
                step_name: step_name.clone(),
            },
        );

        let mut item = item_map
            .get(&step_key)
            .cloned()
            .ok_or_else(|| format!("初始化项目不存在: {}", step_key))?;

        // 依赖失败时阻塞
        let blocking_dependencies: Vec<String> = item
            .depends_on
            .iter()
            .filter(|dep| {
                runtime_status
                    .get(*dep)
                    .is_some_and(is_failure_like_status)
            })
            .cloned()
            .collect();

        if !blocking_dependencies.is_empty() {
            let reason = format!("依赖项失败: {}", blocking_dependencies.join(", "));
            tracing::warn!(
                note_id = %params.note_id,
                model_id = %resolved_model_id,
                step_index,
                step_key = %step_key,
                step_name = %step_name,
                blocked_by = ?blocking_dependencies,
                "[初始化] 步骤因依赖失败被阻塞"
            );
            item.status = NoteInitializationItemStatus::Blocked;
            item.last_error = Some(reason.clone());
            item.started_at = Some(chrono::Local::now().to_rfc3339());
            item.completed_at = Some(chrono::Local::now().to_rfc3339());
            item.last_model_id = Some(resolved_model_id.clone());
            item = upsert_item(db, &item)?;
            item_map.insert(step_key.clone(), item);
            runtime_status.insert(step_key.clone(), NoteInitializationItemStatus::Blocked);

            failed += 1;
            let _ = app.emit(
                event_name,
                NoteInitializationEvent::StepFailed {
                    step: step_key,
                    step_index,
                    step_name,
                    error: reason,
                },
            );
            continue;
        }

        let config = get_item_config(definition);
        let regenerate = config_regenerate(&config);

        let latest_note = db
            .get_note_by_id(&params.note_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "笔记不存在".to_string())?;
        let output_present = detect_output_presence(&latest_note, &definition.item_key, db);

        if output_present && !regenerate {
            item.status = NoteInitializationItemStatus::Skipped;
            item.output_present = true;
            item.last_error = None;
            item.started_at = Some(chrono::Local::now().to_rfc3339());
            item.completed_at = Some(chrono::Local::now().to_rfc3339());
            item.last_model_id = Some(resolved_model_id.clone());
            item = upsert_item(db, &item)?;
            item_map.insert(step_key.clone(), item);
            runtime_status.insert(step_key.clone(), NoteInitializationItemStatus::Skipped);

            skipped += 1;
            let _ = app.emit(
                event_name,
                NoteInitializationEvent::StepSkipped {
                    step: step_key,
                    step_index,
                    step_name,
                    reason: "已有结果，已跳过".to_string(),
                },
            );
            continue;
        }

        item.status = NoteInitializationItemStatus::Running;
        item.started_at = Some(chrono::Local::now().to_rfc3339());
        item.completed_at = None;
        item.last_error = None;
        item.last_model_id = Some(resolved_model_id.clone());
        item = upsert_item(db, &item)?;
        item_map.insert(step_key.clone(), item.clone());
        runtime_status.insert(step_key.clone(), NoteInitializationItemStatus::Running);

        let _ = app.emit(
            event_name,
            NoteInitializationEvent::StepProgress {
                step: step_key.clone(),
                message: format!("正在执行{}...", step_name),
            },
        );

        let result = execute_item(
            &app,
            &mut context,
            &config,
            &definition.item_key,
            &abort_flag,
        )
        .await;

        let latest_note = db
            .get_note_by_id(&params.note_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "笔记不存在".to_string())?;
        let latest_output_present = detect_output_presence(&latest_note, &definition.item_key, db);

        match result {
            ItemExecutionResult::Completed => {
                tracing::info!(
                    note_id = %params.note_id,
                    model_id = %resolved_model_id,
                    step_index,
                    step_key = %step_key,
                    step_name = %step_name,
                    "[初始化] 步骤执行成功"
                );
                item.status = NoteInitializationItemStatus::Completed;
                item.output_present = latest_output_present;
                item.last_error = None;
                item.completed_at = Some(chrono::Local::now().to_rfc3339());
                item.last_model_id = Some(resolved_model_id.clone());
                item = upsert_item(db, &item)?;
                item_map.insert(step_key.clone(), item);
                runtime_status.insert(step_key.clone(), NoteInitializationItemStatus::Completed);

                completed += 1;
                let _ = app.emit(
                    event_name,
                    NoteInitializationEvent::StepCompleted {
                        step: step_key,
                        step_index,
                        step_name,
                    },
                );
            }
            ItemExecutionResult::Skipped(reason) => {
                tracing::info!(
                    note_id = %params.note_id,
                    model_id = %resolved_model_id,
                    step_index,
                    step_key = %step_key,
                    step_name = %step_name,
                    reason = %reason,
                    "[初始化] 步骤被跳过"
                );
                item.status = NoteInitializationItemStatus::Skipped;
                item.output_present = latest_output_present;
                item.last_error = None;
                item.completed_at = Some(chrono::Local::now().to_rfc3339());
                item.last_model_id = Some(resolved_model_id.clone());
                item = upsert_item(db, &item)?;
                item_map.insert(step_key.clone(), item);
                runtime_status.insert(step_key.clone(), NoteInitializationItemStatus::Skipped);

                skipped += 1;
                let _ = app.emit(
                    event_name,
                    NoteInitializationEvent::StepSkipped {
                        step: step_key,
                        step_index,
                        step_name,
                        reason,
                    },
                );
            }
            ItemExecutionResult::Failed(error) => {
                tracing::error!(
                    note_id = %params.note_id,
                    model_id = %resolved_model_id,
                    step_index,
                    step_key = %step_key,
                    step_name = %step_name,
                    error = %error,
                    "[初始化] 步骤执行失败"
                );
                item.status = NoteInitializationItemStatus::Failed;
                item.output_present = latest_output_present;
                item.last_error = Some(error.clone());
                item.completed_at = Some(chrono::Local::now().to_rfc3339());
                item.last_model_id = Some(resolved_model_id.clone());
                item = upsert_item(db, &item)?;
                item_map.insert(step_key.clone(), item);
                runtime_status.insert(step_key.clone(), NoteInitializationItemStatus::Failed);

                failed += 1;
                let _ = app.emit(
                    event_name,
                    NoteInitializationEvent::StepFailed {
                        step: step_key,
                        step_index,
                        step_name,
                        error,
                    },
                );
            }
        }
    }

    let final_run_status = if failed == 0 {
        NoteInitializationRunStatus::Completed
    } else if completed == 0 && skipped == 0 {
        NoteInitializationRunStatus::Failed
    } else {
        NoteInitializationRunStatus::PartialFailed
    };

    tracing::info!(
        note_id = %params.note_id,
        model_id = %resolved_model_id,
        completed,
        skipped,
        failed,
        final_run_status = ?final_run_status,
        "[初始化] 初始化运行结束"
    );

    db.upsert_note_initialization_run(&UpsertNoteInitializationRunInput {
        note_id: params.note_id.clone(),
        status: final_run_status,
        model_override_id: model_override_id,
        last_error: if failed > 0 {
            Some(format!("初始化完成，失败项: {}", failed))
        } else {
            None
        },
        started_at: None,
        completed_at: Some(chrono::Local::now().to_rfc3339()),
    })
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::Completed {
            completed,
            skipped,
            failed,
            total: execution_plan.len(),
        },
    );

    Ok(())
}

// ============================================================================
// item 执行器
// ============================================================================

async fn execute_item(
    app: &AppHandle,
    context: &mut ExecutionContext,
    config: &Value,
    item_key: &str,
    abort_flag: &Arc<AtomicBool>,
) -> ItemExecutionResult {
    if is_aborted(abort_flag) {
        return ItemExecutionResult::Failed("已中止".to_string());
    }

    match item_key {
        "subtitle_generation" => execute_subtitle_generation(app, context, abort_flag).await,
        "suggested_questions" => execute_suggested_questions(context, abort_flag).await,
        "full_summary" => {
            execute_note_tab_generation(
                app,
                context,
                config,
                note_generation::TabType::FullSummary,
                abort_flag,
            )
            .await
        }
        "detailed_reading" => {
            execute_note_tab_generation(
                app,
                context,
                config,
                note_generation::TabType::DetailedReading,
                abort_flag,
            )
            .await
        }
        "subtitle_optimization" => execute_subtitle_optimization(app, context, abort_flag).await,
        "highlights" => execute_highlights(app, context, config, abort_flag).await,
        "flashcards" => execute_flashcards(app, context, abort_flag).await,
        "visual_summary" => execute_visual_summary(context, config).await,
        "custom_summary" => {
            execute_note_tab_generation(
                app,
                context,
                config,
                note_generation::TabType::CustomSummary,
                abort_flag,
            )
            .await
        }
        "ai_note" => {
            execute_note_tab_generation(app, context, config, note_generation::TabType::AiNote, abort_flag).await
        }
        "panoramic_blueprint" => execute_panoramic_blueprint(app, context, abort_flag).await,
        _ => ItemExecutionResult::Failed(format!("未知初始化项目: {}", item_key)),
    }
}

async fn execute_subtitle_generation(
    app: &AppHandle,
    context: &mut ExecutionContext,
    abort_flag: &Arc<AtomicBool>,
) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    if let Some(subtitle_path) = resolve_subtitle_path(context, db) {
        if !subtitle_path.trim().is_empty() {
            return ItemExecutionResult::Skipped("已存在字幕".to_string());
        }
    }

    let subtitle_path = match bcut_asr::transcribe_video_to_srt(
        app,
        &context.note_id,
        &context.video_path,
        abort_flag,
    )
    .await
    {
        Ok(path) => path,
        Err(err) => {
            if is_aborted(abort_flag) {
                return ItemExecutionResult::Failed("已中止".to_string());
            }
            return ItemExecutionResult::Failed(format!("自动转录失败: {}", err));
        }
    };

    match db.get_note_by_id(&context.note_id) {
        Ok(Some(mut note)) => {
            note.subtitle_path = Some(subtitle_path.clone());
            if let Err(err) = db.update_note(&note) {
                return ItemExecutionResult::Failed(format!("更新字幕路径失败: {}", err));
            }
            context.subtitle_path = Some(subtitle_path);
            ItemExecutionResult::Completed
        }
        Ok(None) => ItemExecutionResult::Failed("笔记不存在".to_string()),
        Err(err) => ItemExecutionResult::Failed(format!("获取笔记失败: {}", err)),
    }
}

async fn execute_suggested_questions(
    context: &mut ExecutionContext,
    abort_flag: &Arc<AtomicBool>,
) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    let subtitle_path = match resolve_subtitle_path(context, db) {
        Some(path) if !path.trim().is_empty() => path,
        _ => return ItemExecutionResult::Skipped("无字幕文件".to_string()),
    };

    match chat::generate_suggested_questions(db, &subtitle_path, &context.model_id, abort_flag).await {
        Ok(questions) => {
            match serde_json::to_string(&questions) {
                Ok(questions_json) => {
                    if let Err(err) = db.update_note_questions(&context.note_id, &questions_json) {
                        ItemExecutionResult::Failed(format!("保存推荐问题失败: {}", err))
                    } else {
                        ItemExecutionResult::Completed
                    }
                }
                Err(err) => ItemExecutionResult::Failed(format!("序列化推荐问题失败: {}", err)),
            }
        }
        Err(err) => {
            if is_aborted(abort_flag) {
                return ItemExecutionResult::Failed("已中止".to_string());
            }

            // 与旧行为保持一致：失败时写入默认问题，按完成处理
            let default_questions = vec![
                "这个视频的核心内容是什么?".to_string(),
                "有哪些关键知识点?".to_string(),
                "如何在实际项目中应用?".to_string(),
            ];
            if let Ok(default_json) = serde_json::to_string(&default_questions) {
                let _ = db.update_note_questions(&context.note_id, &default_json);
            }
            tracing::warn!("[初始化] 推荐问题生成失败，已写入默认问题: {}", err);
            ItemExecutionResult::Completed
        }
    }
}

async fn execute_note_tab_generation(
    app: &AppHandle,
    context: &mut ExecutionContext,
    config: &Value,
    tab_type: note_generation::TabType,
    abort_flag: &Arc<AtomicBool>,
) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    // 依赖字幕的项目在入口层再保险
    if matches!(
        tab_type,
        note_generation::TabType::FullSummary
            | note_generation::TabType::DetailedReading
            | note_generation::TabType::CustomSummary
            | note_generation::TabType::AiNote
    ) {
        if resolve_subtitle_path(context, db).is_none() {
            return ItemExecutionResult::Skipped("无字幕文件".to_string());
        }
    }

    let request = note_generation::GenerateNoteRequest {
        note_id: context.note_id.clone(),
        model_id: context.model_id.clone(),
        options: note_generation::GenerationOptions {
            concurrent: true,
            tabs_to_generate: vec![tab_type],
            regenerate: config_regenerate(config),
            concurrent_limit: 1,
            style: config_string(config, "style"),
            custom_prompt: config_string(config, "custom_prompt"),
            screenshot_density: config_string(config, "screenshot_density"),
            fail_on_any_tab_error: true,
        },
    };

    let generation_id = format!("init-tab-{}", uuid::Uuid::new_v4());
    match note_generation::generate_note_with_abort(app.clone(), db, generation_id, request, abort_flag.clone()).await {
        Ok(_) => ItemExecutionResult::Completed,
        Err(err) => ItemExecutionResult::Failed(err),
    }
}

async fn execute_subtitle_optimization(
    app: &AppHandle,
    context: &mut ExecutionContext,
    abort_flag: &Arc<AtomicBool>,
) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    let subtitle_path = match resolve_subtitle_path(context, db) {
        Some(path) if !path.trim().is_empty() => path,
        _ => return ItemExecutionResult::Skipped("无字幕文件".to_string()),
    };

    let note = match db.get_note_by_id(&context.note_id) {
        Ok(Some(note)) => note,
        Ok(None) => return ItemExecutionResult::Failed("笔记不存在".to_string()),
        Err(err) => return ItemExecutionResult::Failed(format!("读取笔记失败: {}", err)),
    };

    let detailed_reading_json = match &note.detailed_reading {
        Some(value) if !value.trim().is_empty() => value,
        _ => return ItemExecutionResult::Skipped("无章节数据".to_string()),
    };

    let detailed_reading = match serde_json::from_str::<DetailedReadingData>(detailed_reading_json) {
        Ok(data) => data,
        Err(_) => return ItemExecutionResult::Skipped("章节数据格式无效".to_string()),
    };

    let chapters: Vec<Chapter> = detailed_reading
        .chapters
        .iter()
        .map(|dc| Chapter {
            id: dc.id.clone(),
            title: dc.title.clone(),
            start_time: dc.start_time,
            end_time: dc.end_time,
            content: String::new(),
            screenshot_path: dc.screenshot_path.clone(),
            level: None,
            parent_id: None,
        })
        .collect();

    if chapters.is_empty() {
        return ItemExecutionResult::Skipped("章节列表为空".to_string());
    }

    let ai_config = match db.get_ai_config_by_id(&context.model_id) {
        Ok(Some(config)) => config,
        Ok(None) => return ItemExecutionResult::Failed("AI配置不存在".to_string()),
        Err(err) => return ItemExecutionResult::Failed(format!("获取AI配置失败: {}", err)),
    };

    let subtitle_entries = match crate::subtitle::parse_subtitle_file(&subtitle_path) {
        Ok(entries) => entries,
        Err(err) => return ItemExecutionResult::Failed(format!("解析字幕失败: {}", err)),
    };

    if subtitle_entries.is_empty() {
        return ItemExecutionResult::Skipped("字幕内容为空".to_string());
    }

    let chapter_inputs: Vec<ChapterSubtitleInput> = chapters
        .iter()
        .filter_map(|chapter| {
            let filtered: Vec<_> = subtitle_entries
                .iter()
                .filter(|sub| {
                    sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
                })
                .collect();

            if filtered.is_empty() {
                return None;
            }

            let has_bilingual = filtered
                .iter()
                .any(|sub| sub.second_language_text.is_some());

            let subtitle_text = if has_bilingual {
                let primary_text = filtered
                    .iter()
                    .map(|sub| sub.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                let secondary_text = filtered
                    .iter()
                    .filter_map(|sub| sub.second_language_text.as_ref())
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                format!("{}\n\n{}", primary_text, secondary_text)
            } else {
                filtered
                    .iter()
                    .map(|sub| sub.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            };

            if subtitle_text.trim().is_empty() {
                return None;
            }

            Some(ChapterSubtitleInput {
                chapter_id: chapter.id.clone(),
                subtitle_text,
                has_bilingual,
            })
        })
        .collect();

    if chapter_inputs.is_empty() {
        return ItemExecutionResult::Skipped("没有需要优化的字幕内容".to_string());
    }

    let generation_id = format!("init-subtitle-opt-{}", uuid::Uuid::new_v4());
    match crate::subtitle_optimizer::optimize_chapters_direct(
        app.clone(),
        generation_id,
        context.note_id.clone(),
        ai_config,
        chapter_inputs,
        abort_flag.clone(),
    )
    .await
    {
        Ok(_) => ItemExecutionResult::Completed,
        Err(err) => ItemExecutionResult::Failed(err),
    }
}

async fn execute_highlights(
    app: &AppHandle,
    context: &mut ExecutionContext,
    config: &Value,
    abort_flag: &Arc<AtomicBool>,
) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    let subtitle_path = match resolve_subtitle_path(context, db) {
        Some(path) if !path.trim().is_empty() => path,
        _ => return ItemExecutionResult::Skipped("无字幕文件".to_string()),
    };

    let total_duration = crate::subtitle::parse_subtitle_file(&subtitle_path)
        .ok()
        .and_then(|entries| entries.last().map(|e| e.end_time))
        .unwrap_or(3600.0);

    let highlight_type = config_string(config, "highlight_type").unwrap_or_else(|| "default".to_string());
    let generation_id = format!("init-highlights-{}", uuid::Uuid::new_v4());

    match crate::highlight_generation::generate_highlights_direct(
        app.clone(),
        db,
        generation_id,
        context.note_id.clone(),
        context.model_id.clone(),
        subtitle_path,
        highlight_type,
        total_duration,
        abort_flag.clone(),
    )
    .await
    {
        Ok(_) => ItemExecutionResult::Completed,
        Err(err) => ItemExecutionResult::Failed(err),
    }
}

async fn execute_flashcards(app: &AppHandle, context: &mut ExecutionContext, abort_flag: &Arc<AtomicBool>) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    if resolve_subtitle_path(context, db).is_none() {
        return ItemExecutionResult::Skipped("无字幕文件".to_string());
    }

    let generation_id = format!("init-flashcards-{}", uuid::Uuid::new_v4());
    match crate::flashcard_generation::generate_flashcards_direct(
        app.clone(),
        generation_id,
        context.note_id.clone(),
        context.model_id.clone(),
        abort_flag.clone(),
    )
    .await
    {
        Ok(_) => ItemExecutionResult::Completed,
        Err(err) => ItemExecutionResult::Failed(err),
    }
}

async fn execute_visual_summary(context: &ExecutionContext, config: &Value) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    let mut note = match db.get_note_by_id(&context.note_id) {
        Ok(Some(note)) => note,
        Ok(None) => return ItemExecutionResult::Failed("笔记不存在".to_string()),
        Err(err) => return ItemExecutionResult::Failed(format!("读取笔记失败: {}", err)),
    };

    if config_regenerate(config)
        && note
            .visual_summary
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        note.visual_summary = None;
        if let Err(err) = db.update_note(&note) {
            return ItemExecutionResult::Failed(format!("重置视觉化总结失败: {}", err));
        }
    }

    match crate::assemble_and_save_visual_summary(db, &mut note) {
        Ok(true) => ItemExecutionResult::Completed,
        Ok(false) => ItemExecutionResult::Skipped("缺少原文细读或可用章节内容".to_string()),
        Err(err) => ItemExecutionResult::Failed(err),
    }
}

async fn execute_panoramic_blueprint(
    app: &AppHandle,
    context: &mut ExecutionContext,
    abort_flag: &Arc<AtomicBool>,
) -> ItemExecutionResult {
    let db = match DATABASE.get() {
        Some(db) => db,
        None => return ItemExecutionResult::Failed("数据库未初始化".to_string()),
    };

    if resolve_subtitle_path(context, db).is_none() {
        return ItemExecutionResult::Skipped("无字幕文件".to_string());
    }

    match crate::blueprint_generation::generate_panoramic_blueprint_direct(
        app.clone(),
        context.note_id.clone(),
        context.model_id.clone(),
        abort_flag.clone(),
    )
    .await
    {
        Ok(_) => ItemExecutionResult::Completed,
        Err(err) => ItemExecutionResult::Failed(err),
    }
}

// ============================================================================
// 工具函数
// ============================================================================

fn create_default_item(note_id: &str, definition: &InitializationItemDefinition) -> NoteInitializationItem {
    NoteInitializationItem {
        id: String::new(),
        note_id: note_id.to_string(),
        item_key: definition.item_key.clone(),
        status: NoteInitializationItemStatus::Pending,
        depends_on: definition.dependencies.clone(),
        last_model_id: None,
        last_error: None,
        output_present: false,
        started_at: None,
        completed_at: None,
        updated_at: String::new(),
    }
}

fn upsert_item(db: &crate::db::Database, item: &NoteInitializationItem) -> Result<NoteInitializationItem, String> {
    db.upsert_note_initialization_item(&UpsertNoteInitializationItemInput {
        note_id: item.note_id.clone(),
        item_key: item.item_key.clone(),
        status: item.status.clone(),
        depends_on: item.depends_on.clone(),
        last_model_id: item.last_model_id.clone(),
        last_error: item.last_error.clone(),
        output_present: item.output_present,
        started_at: item.started_at.clone(),
        completed_at: item.completed_at.clone(),
    })
    .map_err(|e| e.to_string())
}

fn get_item_config(definition: &InitializationItemDefinition) -> Value {
    definition.default_config.clone()
}

fn config_regenerate(config: &Value) -> bool {
    config
        .get("regenerate")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn config_string(config: &Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn resolve_subtitle_path(
    context: &mut ExecutionContext,
    db: &crate::db::Database,
) -> Option<String> {
    if let Some(path) = &context.subtitle_path {
        if !path.trim().is_empty() {
            return Some(path.clone());
        }
    }

    if let Ok(Some(note)) = db.get_note_by_id(&context.note_id) {
        if let Some(path) = note.subtitle_path {
            if !path.trim().is_empty() {
                context.subtitle_path = Some(path.clone());
                return Some(path);
            }
        }
    }

    None
}

fn expand_dependencies(
    explicitly_selected: &HashSet<String>,
    dependency_map: &HashMap<String, Vec<String>>,
) -> HashSet<String> {
    let mut expanded = explicitly_selected.clone();
    let mut stack: Vec<String> = explicitly_selected.iter().cloned().collect();

    while let Some(item_key) = stack.pop() {
        if let Some(deps) = dependency_map.get(&item_key) {
            for dep in deps {
                if expanded.insert(dep.clone()) {
                    stack.push(dep.clone());
                }
            }
        }
    }

    expanded
}

fn is_failure_like_status(status: &NoteInitializationItemStatus) -> bool {
    matches!(
        status,
        NoteInitializationItemStatus::Failed
            | NoteInitializationItemStatus::Blocked
            | NoteInitializationItemStatus::Canceled
    )
}

fn mark_remaining_as_canceled(
    db: &crate::db::Database,
    execution_plan: &[InitializationItemDefinition],
    from_index: usize,
    item_map: &mut HashMap<String, NoteInitializationItem>,
    runtime_status: &mut HashMap<String, NoteInitializationItemStatus>,
    model_id: &str,
) -> Result<(), String> {
    for definition in execution_plan.iter().skip(from_index) {
        if let Some(mut item) = item_map.get(&definition.item_key).cloned() {
            if matches!(
                item.status,
                NoteInitializationItemStatus::Queued | NoteInitializationItemStatus::Running
            ) {
                item.status = NoteInitializationItemStatus::Canceled;
                item.last_error = Some("用户取消".to_string());
                if item.started_at.is_none() {
                    item.started_at = Some(chrono::Local::now().to_rfc3339());
                }
                item.completed_at = Some(chrono::Local::now().to_rfc3339());
                item.last_model_id = Some(model_id.to_string());
                item = upsert_item(db, &item)?;
                item_map.insert(definition.item_key.clone(), item);
                runtime_status.insert(definition.item_key.clone(), NoteInitializationItemStatus::Canceled);
            }
        }
    }

    Ok(())
}
