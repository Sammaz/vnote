//! 笔记数据初始化模块
//!
//! 负责在创建笔记后按顺序调用6个接口生成笔记所需的全部数据：
//! 1. 推荐问题生成 (generate_questions_for_note)
//! 2. 全文总结 (generate_note_content - full_summary)
//! 3. 原文细读-章节生成 (generate_chapters)
//! 4. 字幕优化 (optimize_chapter_subtitles)
//! 5. 高光笔记 (generate_highlights)
//! 6. 闪记卡 (generate_flashcards)

use crate::chapter::ChapterData;
use crate::chat;
use crate::note_generation;
use crate::subtitle_optimizer::ChapterSubtitleInput;
use crate::DATABASE;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 初始化步骤枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitializationStep {
    /// 推荐问题生成
    Questions,
    /// 全文总结
    FullSummary,
    /// 章节生成
    Chapters,
    /// 字幕优化
    SubtitleOptimization,
    /// 高光笔记
    Highlights,
    /// 闪记卡
    Flashcards,
}

impl InitializationStep {
    /// 获取步骤的显示名称
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Questions => "推荐问题",
            Self::FullSummary => "全文总结",
            Self::Chapters => "章节生成",
            Self::SubtitleOptimization => "字幕优化",
            Self::Highlights => "高光笔记",
            Self::Flashcards => "闪记卡",
        }
    }

    /// 获取步骤索引（0-5）
    pub fn index(&self) -> usize {
        match self {
            Self::Questions => 0,
            Self::FullSummary => 1,
            Self::Chapters => 2,
            Self::SubtitleOptimization => 3,
            Self::Highlights => 4,
            Self::Flashcards => 5,
        }
    }

    /// 获取所有步骤列表
    pub fn all() -> Vec<Self> {
        vec![
            Self::Questions,
            Self::FullSummary,
            Self::Chapters,
            Self::SubtitleOptimization,
            Self::Highlights,
            Self::Flashcards,
        ]
    }
}

/// 初始化事件
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum NoteInitializationEvent {
    /// 初始化开始
    Starting {
        initialization_id: String,
        total_steps: usize,
        steps: Vec<String>,
    },
    /// 步骤开始
    StepStarting {
        step: InitializationStep,
        step_index: usize,
        step_name: String,
    },
    /// 步骤进度更新
    StepProgress {
        step: InitializationStep,
        message: String,
    },
    /// 步骤完成
    StepCompleted {
        step: InitializationStep,
        step_index: usize,
        step_name: String,
    },
    /// 步骤被跳过
    StepSkipped {
        step: InitializationStep,
        step_index: usize,
        step_name: String,
        reason: String,
    },
    /// 步骤失败
    StepFailed {
        step: InitializationStep,
        step_index: usize,
        step_name: String,
        error: String,
    },
    /// 全部完成
    Completed {
        completed: usize,
        skipped: usize,
        failed: usize,
        total: usize,
    },
    /// 致命错误（中止整个流程）
    Error {
        error: String,
    },
    /// 用户中止
    Aborted,
}

/// 初始化参数
#[derive(Debug, Clone, Deserialize)]
pub struct InitializationParams {
    pub note_id: i64,
    pub model_id: i64,
    pub video_path: String,
    pub subtitle_path: Option<String>,
    /// 从哪一步开始执行（用于断点恢复），0-5 对应 6 个步骤
    #[serde(default)]
    pub start_from_step: Option<usize>,
}

/// 步骤执行结果
#[derive(Debug, Clone)]
enum StepResult {
    Completed,
    Skipped(String),
    Failed(String),
}

// ============================================================================
// 全局中止标志管理
// ============================================================================

static INITIALIZATION_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    OnceLock::new();

fn get_abort_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    INITIALIZATION_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 注册中止标志
async fn register_abort_flag(initialization_id: &str) -> Arc<AtomicBool> {
    let mut flags = get_abort_flags().lock().await;
    let flag = Arc::new(AtomicBool::new(false));
    flags.insert(initialization_id.to_string(), flag.clone());
    flag
}

/// 清理中止标志
async fn cleanup_abort_flag(initialization_id: &str) {
    let mut flags = get_abort_flags().lock().await;
    flags.remove(initialization_id);
}

/// 检查是否已中止
fn is_aborted(abort_flag: &Arc<AtomicBool>) -> bool {
    abort_flag.load(Ordering::Relaxed)
}

/// 中止初始化
pub async fn abort_initialization(initialization_id: &str) -> Result<(), String> {
    let flags = get_abort_flags().lock().await;
    if let Some(flag) = flags.get(initialization_id) {
        flag.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("初始化任务不存在".to_string())
    }
}

// ============================================================================
// 主初始化函数
// ============================================================================

/// 启动笔记数据初始化
/// 返回 initialization_id 用于跟踪和中止
pub async fn start_initialization(
    app: AppHandle,
    params: InitializationParams,
) -> Result<String, String> {
    // 生成唯一ID
    let initialization_id = format!("init-{}-{}", params.note_id, uuid::Uuid::new_v4());
    let event_name = format!("note-initialization-{}", initialization_id);

    // 注册中止标志
    let abort_flag = register_abort_flag(&initialization_id).await;

    // 发送开始事件
    let steps: Vec<String> = InitializationStep::all()
        .iter()
        .map(|s| s.display_name().to_string())
        .collect();

    let _ = app.emit(
        &event_name,
        NoteInitializationEvent::Starting {
            initialization_id: initialization_id.clone(),
            total_steps: 6,
            steps,
        },
    );

    // 在后台执行初始化
    let init_id = initialization_id.clone();
    let event_name_clone = event_name.clone();

    tokio::spawn(async move {
        // 等待前端设置好事件监听器
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let result = run_initialization(
            app.clone(),
            &event_name_clone,
            params,
            abort_flag.clone(),
        )
        .await;

        // 清理中止标志
        cleanup_abort_flag(&init_id).await;

        // 如果有致命错误，发送错误事件
        if let Err(e) = result {
            let _ = app.emit(
                &event_name_clone,
                NoteInitializationEvent::Error { error: e },
            );
        }
    });

    Ok(initialization_id)
}

/// 执行初始化流程
async fn run_initialization(
    app: AppHandle,
    event_name: &str,
    params: InitializationParams,
    abort_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let db = DATABASE.get().ok_or("数据库未初始化")?;

    // 验证 AI 配置是否存在
    let _ai_config = db
        .get_ai_config_by_id(params.model_id)
        .map_err(|e| format!("获取 AI 配置失败: {}", e))?
        .ok_or_else(|| "AI 配置不存在".to_string())?;

    // 获取笔记信息
    let note = db
        .get_note_by_id(params.note_id)
        .map_err(|e| format!("获取笔记失败: {}", e))?
        .ok_or_else(|| "笔记不存在".to_string())?;

    let has_subtitle = params.subtitle_path.is_some();
    let mut completed = 0;
    let mut skipped = 0;
    let mut failed = 0;

    // 获取起始步骤（用于断点恢复）
    let start_step = params.start_from_step.unwrap_or(0);

    // 用于存储章节数据（步骤3的结果，步骤4需要）
    let mut chapter_data: Option<ChapterData> = None;

    // 如果从步骤4开始恢复，需要从数据库加载章节数据
    if start_step >= 3 {
        if let Some(detailed_reading) = &note.detailed_reading {
            if let Ok(data) = serde_json::from_str::<ChapterData>(detailed_reading) {
                chapter_data = Some(data);
            }
        }
    }

    // 按顺序执行6个步骤
    for step in InitializationStep::all() {
        let step_index = step.index();

        // 跳过已完成的步骤（断点恢复）
        if step_index < start_step {
            skipped += 1;
            let _ = app.emit(
                event_name,
                NoteInitializationEvent::StepSkipped {
                    step,
                    step_index,
                    step_name: step.display_name().to_string(),
                    reason: "已完成（断点恢复）".to_string(),
                },
            );
            continue;
        }

        // 检查中止
        if is_aborted(&abort_flag) {
            let _ = app.emit(event_name, NoteInitializationEvent::Aborted);
            return Ok(());
        }

        let step_name = step.display_name().to_string();

        // 发送步骤开始事件
        let _ = app.emit(
            event_name,
            NoteInitializationEvent::StepStarting {
                step,
                step_index,
                step_name: step_name.clone(),
            },
        );

        // 执行步骤
        let result = execute_step(
            &app,
            event_name,
            &params,
            &note,
            step,
            has_subtitle,
            &abort_flag,
            &mut chapter_data,
        )
        .await;

        // 处理结果
        match result {
            StepResult::Completed => {
                completed += 1;
                // 更新数据库中的 init_status
                let new_status = (step_index + 1) as i32;
                let _ = db.update_note_init_status(params.note_id, new_status);

                let _ = app.emit(
                    event_name,
                    NoteInitializationEvent::StepCompleted {
                        step,
                        step_index,
                        step_name,
                    },
                );
            }
            StepResult::Skipped(reason) => {
                skipped += 1;
                // 跳过也算完成该步骤，更新状态
                let new_status = (step_index + 1) as i32;
                let _ = db.update_note_init_status(params.note_id, new_status);

                let _ = app.emit(
                    event_name,
                    NoteInitializationEvent::StepSkipped {
                        step,
                        step_index,
                        step_name,
                        reason,
                    },
                );
            }
            StepResult::Failed(error) => {
                failed += 1;
                // 失败时不更新 init_status，允许下次从此步骤重试
                let _ = app.emit(
                    event_name,
                    NoteInitializationEvent::StepFailed {
                        step,
                        step_index,
                        step_name,
                        error,
                    },
                );
            }
        }
    }

    // 发送完成事件
    let _ = app.emit(
        event_name,
        NoteInitializationEvent::Completed {
            completed,
            skipped,
            failed,
            total: 6,
        },
    );

    Ok(())
}

/// 执行单个步骤
async fn execute_step(
    app: &AppHandle,
    event_name: &str,
    params: &InitializationParams,
    note: &crate::db::Note,
    step: InitializationStep,
    has_subtitle: bool,
    abort_flag: &Arc<AtomicBool>,
    chapter_data: &mut Option<ChapterData>,
) -> StepResult {
    match step {
        InitializationStep::Questions => {
            execute_questions_step(app, event_name, params, has_subtitle).await
        }
        InitializationStep::FullSummary => {
            execute_full_summary_step(app, event_name, params, has_subtitle, abort_flag).await
        }
        InitializationStep::Chapters => {
            execute_chapters_step(app, event_name, params, abort_flag, chapter_data).await
        }
        InitializationStep::SubtitleOptimization => {
            execute_subtitle_optimization_step(
                app,
                event_name,
                params,
                chapter_data,
                abort_flag,
            )
            .await
        }
        InitializationStep::Highlights => {
            execute_highlights_step(app, event_name, params, note, has_subtitle, abort_flag).await
        }
        InitializationStep::Flashcards => {
            execute_flashcards_step(app, event_name, params, has_subtitle, abort_flag).await
        }
    }
}

// ============================================================================
// 步骤实现
// ============================================================================

/// 步骤1: 推荐问题生成
async fn execute_questions_step(
    app: &AppHandle,
    event_name: &str,
    params: &InitializationParams,
    has_subtitle: bool,
) -> StepResult {
    if !has_subtitle {
        return StepResult::Skipped("无字幕文件".to_string());
    }

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::StepProgress {
            step: InitializationStep::Questions,
            message: "正在生成推荐问题...".to_string(),
        },
    );

    let db = match DATABASE.get() {
        Some(db) => db,
        None => return StepResult::Failed("数据库未初始化".to_string()),
    };

    // 获取笔记
    let note = match db.get_note_by_id(params.note_id) {
        Ok(Some(n)) => n,
        Ok(None) => return StepResult::Failed("笔记不存在".to_string()),
        Err(e) => return StepResult::Failed(format!("获取笔记失败: {}", e)),
    };

    // 检查字幕和模型
    let subtitle_path = match &note.subtitle_path {
        Some(p) => p.clone(),
        None => return StepResult::Skipped("无字幕文件".to_string()),
    };

    let model_id = match note.model_id {
        Some(id) => id,
        None => return StepResult::Failed("未配置AI模型".to_string()),
    };

    // 生成问题
    match chat::generate_suggested_questions(db, &subtitle_path, model_id).await {
        Ok(questions) => {
            // 保存到数据库
            if let Ok(questions_json) = serde_json::to_string(&questions) {
                let _ = db.update_note_questions(params.note_id, &questions_json);
            }
            StepResult::Completed
        }
        Err(e) => {
            // 使用默认问题
            let default_questions = vec![
                "这个视频的核心内容是什么?".to_string(),
                "有哪些关键知识点?".to_string(),
                "如何在实际项目中应用?".to_string(),
            ];
            if let Ok(questions_json) = serde_json::to_string(&default_questions) {
                let _ = db.update_note_questions(params.note_id, &questions_json);
            }
            eprintln!("[初始化] 问题生成失败，使用默认问题: {}", e);
            StepResult::Completed // 使用默认问题也算完成
        }
    }
}

/// 步骤2: 全文总结
async fn execute_full_summary_step(
    app: &AppHandle,
    event_name: &str,
    params: &InitializationParams,
    has_subtitle: bool,
    abort_flag: &Arc<AtomicBool>,
) -> StepResult {
    if !has_subtitle {
        return StepResult::Skipped("无字幕文件".to_string());
    }

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::StepProgress {
            step: InitializationStep::FullSummary,
            message: "正在生成全文总结...".to_string(),
        },
    );

    let db = match DATABASE.get() {
        Some(db) => db,
        None => return StepResult::Failed("数据库未初始化".to_string()),
    };

    // 使用 note_generation 模块生成全文总结
    let generation_id = format!("init-summary-{}", uuid::Uuid::new_v4());

    // 默认配置提示词（与前端弹框默认配置一致：中文、显示Emoji、不显示时间戳、5个要点、30字句子）
    let default_prompt = r#"你是一个专业的视频内容分析师。请分析以下视频字幕，生成一份结构化的全文总结。

输出要求：
1. 使用 Markdown 格式输出（不要使用代码块标记）
2. 必须使用中文输出所有内容
3. 严格按照以下格式输出：

# 摘要
摘要段落，概括视频核心内容，每句话不超过30字

# 核心亮点
提取最重要的5个知识点/亮点，每个亮点标题前必须添加一个合适的 emoji 表情符号（如 🔥 💡 📊 🎯 ⚡）

## 🔥 亮点标题1
详细描述该亮点的内容

## 💡 亮点标题2
详细描述该亮点的内容

（继续提取5个亮点）

# 关键术语
- **术语1**：解释
- **术语2**：解释

视频字幕内容："#;

    let request = note_generation::GenerateNoteRequest {
        note_id: params.note_id,
        model_id: params.model_id,
        options: note_generation::GenerationOptions {
            concurrent: true,
            tabs_to_generate: vec![note_generation::TabType::FullSummary],
            regenerate: true,
            concurrent_limit: 1,
            custom_prompt: Some(default_prompt.to_string()),
        },
    };

    match note_generation::generate_note(
        app.clone(),
        db,
        generation_id.clone(),
        request,
    )
    .await
    {
        Ok(_) => StepResult::Completed,
        Err(e) => {
            if is_aborted(abort_flag) {
                StepResult::Failed("已中止".to_string())
            } else {
                StepResult::Failed(e)
            }
        }
    }
}

/// 步骤3: 章节生成
async fn execute_chapters_step(
    app: &AppHandle,
    event_name: &str,
    params: &InitializationParams,
    abort_flag: &Arc<AtomicBool>,
    chapter_data_out: &mut Option<ChapterData>,
) -> StepResult {
    let subtitle_path = match &params.subtitle_path {
        Some(p) => p.clone(),
        None => return StepResult::Skipped("无字幕文件".to_string()),
    };

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::StepProgress {
            step: InitializationStep::Chapters,
            message: "正在生成章节...".to_string(),
        },
    );

    let db = match DATABASE.get() {
        Some(db) => db,
        None => return StepResult::Failed("数据库未初始化".to_string()),
    };

    let generation_id = format!("init-chapters-{}", uuid::Uuid::new_v4());

    let request = crate::chapter::GenerateChaptersRequest {
        note_id: params.note_id,
        model_id: params.model_id,
        video_path: params.video_path.clone(),
        subtitle_path,
        capture_screenshots: true,
    };

    match crate::chapter::generate_chapters(
        app.clone(),
        db,
        generation_id.clone(),
        request,
    )
    .await
    {
        Ok(data) => {
            // 保存章节数据到 detailed_reading 字段
            if let Ok(chapter_json) = serde_json::to_string(&data) {
                if let Ok(Some(mut note)) = db.get_note_by_id(params.note_id) {
                    note.detailed_reading = Some(chapter_json);
                    let _ = db.update_note(&note);
                }
            }
            *chapter_data_out = Some(data);
            StepResult::Completed
        }
        Err(e) => {
            if is_aborted(abort_flag) {
                StepResult::Failed("已中止".to_string())
            } else {
                StepResult::Failed(e)
            }
        }
    }
}

/// 步骤4: 字幕优化
async fn execute_subtitle_optimization_step(
    app: &AppHandle,
    event_name: &str,
    params: &InitializationParams,
    chapter_data: &Option<ChapterData>,
    abort_flag: &Arc<AtomicBool>,
) -> StepResult {
    // 需要章节数据作为输入
    let chapters = match chapter_data {
        Some(data) => &data.chapters,
        None => return StepResult::Skipped("无章节数据".to_string()),
    };

    if chapters.is_empty() {
        return StepResult::Skipped("章节列表为空".to_string());
    }

    // 需要字幕文件
    let subtitle_path = match &params.subtitle_path {
        Some(p) => p.clone(),
        None => return StepResult::Skipped("无字幕文件".to_string()),
    };

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::StepProgress {
            step: InitializationStep::SubtitleOptimization,
            message: "正在优化字幕...".to_string(),
        },
    );

    let db = match DATABASE.get() {
        Some(db) => db,
        None => return StepResult::Failed("数据库未初始化".to_string()),
    };

    // 获取 AI 配置
    let config = match db.get_ai_config_by_id(params.model_id) {
        Ok(Some(c)) => c,
        Ok(None) => return StepResult::Failed("AI配置不存在".to_string()),
        Err(e) => return StepResult::Failed(format!("获取AI配置失败: {}", e)),
    };

    // 解析原始字幕文件（与前端按钮使用相同的逻辑）
    let subtitle_entries = match crate::subtitle::parse_subtitle_file(&subtitle_path) {
        Ok(entries) => entries,
        Err(e) => return StepResult::Failed(format!("解析字幕失败: {}", e)),
    };

    if subtitle_entries.is_empty() {
        return StepResult::Skipped("字幕内容为空".to_string());
    }

    // 按章节时间范围过滤字幕，构建优化输入（与前端逻辑一致）
    let chapter_inputs: Vec<ChapterSubtitleInput> = chapters
        .iter()
        .filter_map(|ch| {
            // 过滤出当前章节时间范围内的字幕
            let filtered: Vec<_> = subtitle_entries
                .iter()
                .filter(|sub| sub.start_time >= ch.start_time && sub.start_time < ch.end_time)
                .collect();

            if filtered.is_empty() {
                return None;
            }

            // 检查是否有双语字幕
            let has_bilingual = filtered.iter().any(|sub| sub.second_language_text.is_some());

            let subtitle_text = if has_bilingual {
                // 双语字幕：合并两种语言
                let primary_text: String = filtered.iter().map(|sub| sub.text.as_str()).collect::<Vec<_>>().join(" ");
                let secondary_text: String = filtered
                    .iter()
                    .filter_map(|sub| sub.second_language_text.as_ref())
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                format!("{}\n\n{}", primary_text, secondary_text)
            } else {
                // 单语字幕：直接拼接
                filtered.iter().map(|sub| sub.text.as_str()).collect::<Vec<_>>().join(" ")
            };

            if subtitle_text.trim().is_empty() {
                return None;
            }

            Some(ChapterSubtitleInput {
                chapter_id: ch.id.clone(),
                subtitle_text,
                has_bilingual,
            })
        })
        .collect();

    if chapter_inputs.is_empty() {
        return StepResult::Skipped("没有需要优化的字幕内容".to_string());
    }

    let generation_id = format!("init-subtitle-opt-{}", uuid::Uuid::new_v4());

    // 直接调用优化函数（同步等待完成）
    match crate::subtitle_optimizer::optimize_chapters_direct(
        app.clone(),
        generation_id,
        params.note_id,
        config,
        chapter_inputs,
    )
    .await
    {
        Ok(_) => StepResult::Completed,
        Err(e) => {
            if is_aborted(abort_flag) {
                StepResult::Failed("已中止".to_string())
            } else {
                StepResult::Failed(e)
            }
        }
    }
}

/// 步骤5: 高光笔记
async fn execute_highlights_step(
    app: &AppHandle,
    event_name: &str,
    params: &InitializationParams,
    _note: &crate::db::Note,
    has_subtitle: bool,
    abort_flag: &Arc<AtomicBool>,
) -> StepResult {
    if !has_subtitle {
        return StepResult::Skipped("无字幕文件".to_string());
    }

    let subtitle_path = match &params.subtitle_path {
        Some(p) => p.clone(),
        None => return StepResult::Skipped("无字幕文件".to_string()),
    };

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::StepProgress {
            step: InitializationStep::Highlights,
            message: "正在生成高光笔记...".to_string(),
        },
    );

    let db = match DATABASE.get() {
        Some(db) => db,
        None => return StepResult::Failed("数据库未初始化".to_string()),
    };

    let generation_id = format!("init-highlights-{}", uuid::Uuid::new_v4());

    // 使用传入的时长参数，默认 3600 秒
    let total_duration = 3600.0;

    match crate::highlight_generation::generate_highlights_direct(
        app.clone(),
        db,
        generation_id,
        params.note_id,
        params.model_id,
        subtitle_path,
        "default".to_string(),
        total_duration,
    )
    .await
    {
        Ok(_) => StepResult::Completed,
        Err(e) => {
            if is_aborted(abort_flag) {
                StepResult::Failed("已中止".to_string())
            } else {
                StepResult::Failed(e)
            }
        }
    }
}

/// 步骤6: 闪记卡
async fn execute_flashcards_step(
    app: &AppHandle,
    event_name: &str,
    params: &InitializationParams,
    has_subtitle: bool,
    abort_flag: &Arc<AtomicBool>,
) -> StepResult {
    if !has_subtitle {
        return StepResult::Skipped("无字幕文件".to_string());
    }

    let _ = app.emit(
        event_name,
        NoteInitializationEvent::StepProgress {
            step: InitializationStep::Flashcards,
            message: "正在生成闪记卡...".to_string(),
        },
    );

    let generation_id = format!("init-flashcards-{}", uuid::Uuid::new_v4());

    match crate::flashcard_generation::generate_flashcards_direct(
        app.clone(),
        generation_id,
        params.note_id,
        params.model_id,
    )
    .await
    {
        Ok(_) => StepResult::Completed,
        Err(e) => {
            if is_aborted(abort_flag) {
                StepResult::Failed("已中止".to_string())
            } else {
                StepResult::Failed(e)
            }
        }
    }
}
