//! 字幕AI优化模块
//!
//! 功能：
//! - 对章节字幕内容进行AI优化处理
//! - 去除语气词、添加标点、重组句子、合理分段
//! - 双语字幕统一输出为中文

use crate::ai_pool::{execute_non_streaming_with_abort, get_ai_pool_manager, NonStreamingRequest};
use crate::db::AiConfig;
use crate::get_db;
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ============================================================================
// 数据结构定义
// ============================================================================

/// 章节字幕输入
#[derive(Debug, Clone, Deserialize)]
pub struct ChapterSubtitleInput {
    pub chapter_id: String,
    pub subtitle_text: String,
    pub has_bilingual: bool,
}

/// 字幕优化进度事件
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status")]
pub enum SubtitleOptimizationEvent {
    Starting {
        total: usize,
    },
    ChapterStarted {
        chapter_id: String,
    },
    ChapterCompleted {
        chapter_id: String,
        optimized_text: String,
    },
    ChapterFailed {
        chapter_id: String,
        error: String,
    },
    AllCompleted {
        succeeded: usize,
        failed: usize,
    },
    Aborted,
}

// ============================================================================
// 提示词构建
// ============================================================================

/// 构建字幕优化提示词
pub fn build_subtitle_optimization_prompt(subtitle_text: &str, has_bilingual: bool) -> String {
    let language_instruction = if has_bilingual {
        "这是双语字幕内容，请仅输出中文部分。"
    } else {
        "如果内容不是中文，请翻译为中文。"
    };

    format!(
        r#"请优化以下视频字幕内容，要求：
1. 去除语气词（如"嗯"、"啊"、"那个"、"就是说"等）
2. 添加适当的标点符号
3. 将内容重组为通顺的句子
4. 根据内容逻辑合理分段
5. {language_instruction}
6. 保持原文的语义和信息完整性

原始字幕：
{subtitle_text}

请直接输出优化后的文本，不要添加任何解释或标记。"#,
        language_instruction = language_instruction,
        subtitle_text = subtitle_text
    )
}

// ============================================================================
// 优化执行
// ============================================================================

/// 优化单个章节的字幕
async fn optimize_single_chapter(
    config: &AiConfig,
    chapter: &ChapterSubtitleInput,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    let prompt = build_subtitle_optimization_prompt(&chapter.subtitle_text, chapter.has_bilingual);

    let request = NonStreamingRequest {
        config: config.clone(),
        prompt,
    };

    let response = execute_non_streaming_with_abort(request, abort_flag).await?;
    Ok(response.content)
}

/// 批量优化章节字幕
pub async fn optimize_chapters(
    app: AppHandle,
    generation_id: String,
    config: AiConfig,
    chapters: Vec<ChapterSubtitleInput>,
) -> Result<(), String> {
    let pool = get_ai_pool_manager();
    let abort_flag = pool.register_abort_flag(generation_id.clone()).await;
    let event_name = format!("subtitle-optimization-{}", generation_id);

    // 发送开始事件
    let _ = app.emit(
        &event_name,
        SubtitleOptimizationEvent::Starting {
            total: chapters.len(),
        },
    );

    let mut succeeded = 0usize;
    let mut failed = 0usize;

    // 使用 futures 并发处理所有章节
    let tasks: Vec<_> = chapters
        .iter()
        .map(|chapter| {
            let config = config.clone();
            let chapter = chapter.clone();
            let abort_flag = abort_flag.clone();
            let app = app.clone();
            let event_name = event_name.clone();

            async move {
                // 检查是否已中止
                if abort_flag.load(std::sync::atomic::Ordering::Relaxed) {
                    return (chapter.chapter_id, Err("请求已取消".to_string()));
                }

                // 发送章节开始事件
                let _ = app.emit(
                    &event_name,
                    SubtitleOptimizationEvent::ChapterStarted {
                        chapter_id: chapter.chapter_id.clone(),
                    },
                );

                // 执行优化
                let result = optimize_single_chapter(&config, &chapter, &abort_flag).await;

                // 发送结果事件
                match &result {
                    Ok(optimized_text) => {
                        let _ = app.emit(
                            &event_name,
                            SubtitleOptimizationEvent::ChapterCompleted {
                                chapter_id: chapter.chapter_id.clone(),
                                optimized_text: optimized_text.clone(),
                            },
                        );
                    }
                    Err(error) => {
                        let _ = app.emit(
                            &event_name,
                            SubtitleOptimizationEvent::ChapterFailed {
                                chapter_id: chapter.chapter_id.clone(),
                                error: error.clone(),
                            },
                        );
                    }
                }

                (chapter.chapter_id, result)
            }
        })
        .collect();

    // 并发执行所有任务
    let results = futures::future::join_all(tasks).await;

    // 统计结果
    for (_chapter_id, result) in results {
        match result {
            Ok(_) => succeeded += 1,
            Err(_) => failed += 1,
        }
    }

    // 检查是否被中止
    if abort_flag.load(std::sync::atomic::Ordering::Relaxed) {
        let _ = app.emit(&event_name, SubtitleOptimizationEvent::Aborted);
        pool.cleanup_abort_flag(&generation_id).await;
        return Err("请求已取消".to_string());
    }

    // 发送完成事件
    let _ = app.emit(
        &event_name,
        SubtitleOptimizationEvent::AllCompleted { succeeded, failed },
    );

    // 清理
    pool.cleanup_abort_flag(&generation_id).await;

    Ok(())
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 优化章节字幕
#[tauri::command]
pub async fn optimize_chapter_subtitles(
    app: AppHandle,
    generation_id: String,
    _note_id: i64,
    model_id: i64,
    chapters: Vec<ChapterSubtitleInput>,
) -> Result<(), String> {
    // 获取 AI 配置
    let config = get_db()
        .get_ai_config_by_id(model_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "AI配置不存在".to_string())?;

    // 过滤掉空字幕的章节
    let chapters_to_optimize: Vec<_> = chapters
        .into_iter()
        .filter(|c| !c.subtitle_text.trim().is_empty())
        .collect();

    if chapters_to_optimize.is_empty() {
        return Err("没有需要优化的字幕内容".to_string());
    }

    // 在后台执行优化
    let gen_id = generation_id.clone();
    tokio::spawn(async move {
        if let Err(e) = optimize_chapters(app, gen_id, config, chapters_to_optimize).await {
            eprintln!("[optimize_chapter_subtitles] 优化失败: {}", e);
        }
    });

    Ok(())
}

/// 中止字幕优化
#[tauri::command]
pub async fn abort_subtitle_optimization(generation_id: String) -> Result<(), String> {
    let pool = get_ai_pool_manager();
    pool.abort_request(&generation_id).await
}
