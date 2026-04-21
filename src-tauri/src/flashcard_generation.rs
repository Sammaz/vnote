//! 闪记卡生成模块
//!
//! 基于视频字幕内容生成问答闪记卡，帮助用户巩固知识点

use crate::ai_pool::execute_streaming_and_collect;
use crate::chapter::split_subtitle_into_chunks;
use crate::db::AiConfig;
use crate::subtitle::parse_subtitle_file;
use crate::DATABASE;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 闪记卡难度等级
#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum FlashcardDifficulty {
    Easy,
    Medium,
    Hard,
}

/// 单张闪记卡
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FlashcardItem {
    pub id: String,
    pub question: String,
    pub answer: String,
    pub difficulty: FlashcardDifficulty,
    pub tags: Vec<String>,
}

/// 闪记卡数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FlashcardData {
    pub cards: Vec<FlashcardItem>,
    pub total_count: usize,
    pub generated_at: String,
}

/// 闪记卡生成事件
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "status")]
pub enum FlashcardGenerationEvent {
    Starting,
    Progress {
        current: usize,
        total: usize,
        message: String,
    },
    Completed {
        flashcard_data: FlashcardData,
    },
    Error {
        error: String,
    },
    Aborted,
}

// ============================================================================
// 全局中止标志管理
// ============================================================================

static FLASHCARD_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_abort_flags_lock() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    FLASHCARD_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn create_abort_flag(generation_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut flags = get_abort_flags_lock().lock().await;
    flags.insert(generation_id.to_string(), flag.clone());
    flag
}

async fn remove_abort_flag(generation_id: &str) {
    let mut flags = get_abort_flags_lock().lock().await;
    flags.remove(generation_id);
}

// ============================================================================
// 提示词模板
// ============================================================================

fn flashcard_generation_prompt(subtitle_content: &str, chunk_index: usize, total_chunks: usize) -> String {
    let context = if total_chunks > 1 {
        format!("（这是视频的第 {}/{} 部分）", chunk_index + 1, total_chunks)
    } else {
        String::new()
    };

    format!(
        r#"你是一个专业的教育助手，擅长从视频内容中提取核心知识点并生成高质量的问答闪记卡。

## 任务
分析以下视频字幕内容{}，提取关键知识点，生成问答闪记卡。

## 要求
1. 问题应该清晰、具体，能够考察对知识点的理解
2. 答案应该简洁但完整，直接回答问题
3. 每张卡片都要标注难度等级和分类标签
4. 难度等级分为三档：easy（基础概念）、medium（理解应用）、hard（深度分析）
5. 标签用于分类知识点，如"概念理解"、"实践应用"、"原理分析"等
6. 根据内容的重要程度和知识密度，自行决定生成多少张卡片，确保覆盖所有重要知识点

## 输出格式
请严格按照以下JSON格式输出，不要包含任何其他内容：
```json
[
  {{
    "question": "问题内容",
    "answer": "答案内容",
    "difficulty": "easy|medium|hard",
    "tags": ["标签1", "标签2"]
  }}
]
```

## 视频字幕内容
{}

请开始生成闪记卡："#,
        context,
        subtitle_content
    )
}

// ============================================================================
// AI 调用
// ============================================================================

async fn call_ai_api(
    ai_config: &AiConfig,
    prompt: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    let response = execute_streaming_and_collect(ai_config.clone(), prompt.to_string(), abort_flag).await?;

    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    Ok(response)
}

// ============================================================================
// JSON 解析
// ============================================================================

fn parse_flashcards_response(response: &str) -> Result<Vec<FlashcardItem>, String> {
    // 尝试从响应中提取 JSON 数组
    let json_str = if let Some(start) = response.find('[') {
        if let Some(end) = response.rfind(']') {
            &response[start..=end]
        } else {
            return Err("无法找到JSON数组结束符".to_string());
        }
    } else {
        return Err("无法找到JSON数组".to_string());
    };

    // 解析 JSON
    let parsed: Vec<serde_json::Value> = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON解析失败: {}", e))?;

    // 转换为 FlashcardItem
    let mut cards = Vec::new();
    for item in parsed {
        let question = item.get("question")
            .and_then(|v| v.as_str())
            .ok_or("缺少question字段")?
            .to_string();

        let answer = item.get("answer")
            .and_then(|v| v.as_str())
            .ok_or("缺少answer字段")?
            .to_string();

        let difficulty_str = item.get("difficulty")
            .and_then(|v| v.as_str())
            .unwrap_or("medium");

        let difficulty = match difficulty_str.to_lowercase().as_str() {
            "easy" => FlashcardDifficulty::Easy,
            "hard" => FlashcardDifficulty::Hard,
            _ => FlashcardDifficulty::Medium,
        };

        let tags: Vec<String> = item.get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect())
            .unwrap_or_else(|| vec!["概念理解".to_string()]);

        cards.push(FlashcardItem {
            id: Uuid::new_v4().to_string(),
            question,
            answer,
            difficulty,
            tags,
        });
    }

    Ok(cards)
}

// ============================================================================
// Tauri 命令
// ============================================================================

#[tauri::command]
pub async fn generate_flashcards(
    app: AppHandle,
    generation_id: String,
    note_id: String,
    model_id: String,
) -> Result<(), String> {
    let abort_flag = create_abort_flag(&generation_id).await;

    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Err(e) = generate_flashcards_direct_internal(
            app_clone,
            generation_id,
            note_id,
            model_id,
            abort_flag,
            true,
        ).await {
            tracing::error!("[generate_flashcards] 生成失败: {}", e);
        }
    });

    Ok(())
}

async fn generate_flashcards_internal(
    app: &AppHandle,
    event_name: &str,
    note_id: &str,
    model_id: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Result<FlashcardData, String> {
    // 获取数据库
    let db = DATABASE.get()
        .ok_or("数据库未初始化")?;

    // 获取笔记
    let note = db.get_note_by_id(note_id)
        .map_err(|e| format!("获取笔记失败: {}", e))?
        .ok_or("笔记不存在")?;

    // 检查字幕文件
    let subtitle_path = note.subtitle_path
        .ok_or("没有字幕文件")?;

    // 获取AI配置
    let ai_config = db.get_ai_config_by_id(model_id)
        .map_err(|e| format!("获取AI配置失败: {}", e))?
        .ok_or("AI配置不存在")?;

    // 发送进度事件
    let _ = app.emit(event_name, FlashcardGenerationEvent::Progress {
        current: 1,
        total: 3,
        message: "正在解析字幕...".to_string(),
    });

    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 解析字幕
    let subtitles = parse_subtitle_file(&subtitle_path)
        .map_err(|e| format!("解析字幕失败: {}", e))?;

    tracing::info!("[闪记卡] ========================================");
    tracing::info!("[闪记卡] 开始生成闪记卡");
    tracing::info!("[闪记卡] 字幕总条数: {}", subtitles.len());
    tracing::info!("[闪记卡] 使用模型: {}", ai_config.model);

    // 使用与原文细读相同的分段逻辑
    let chunks = split_subtitle_into_chunks(&subtitles);
    let total_chunks = chunks.len();

    tracing::info!("[闪记卡] 分段数: {}", total_chunks);

    // 发送进度事件
    let _ = app.emit(event_name, FlashcardGenerationEvent::Progress {
        current: 1,
        total: total_chunks + 1,
        message: format!("共 {} 个分段，开始生成...", total_chunks),
    });

    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 并发生成每个分段的闪记卡
    let mut tasks = Vec::new();

    for (chunk_idx, chunk) in chunks.iter().enumerate() {
        let ai_config = ai_config.clone();
        let abort_flag = abort_flag.clone();
        let app = app.clone();
        let event_name = event_name.to_string();
        let chunk_text = chunk.text.clone();

        let task = tokio::spawn(async move {
            // 检查中止
            if abort_flag.load(Ordering::Relaxed) {
                return Err::<(Vec<FlashcardItem>, usize), String>("已中止".to_string());
            }

            tracing::info!("[闪记卡] 段 {}/{}: 开始生成...", chunk_idx + 1, total_chunks);

            // 发送进度事件
            let _ = app.emit(
                &event_name,
                FlashcardGenerationEvent::Progress {
                    current: chunk_idx + 1,
                    total: total_chunks + 1,
                    message: format!("正在生成第 {}/{} 段闪记卡...", chunk_idx + 1, total_chunks),
                },
            );

            // 生成闪记卡
            let prompt = flashcard_generation_prompt(&chunk_text, chunk_idx, total_chunks);
            let response = call_ai_api(&ai_config, &prompt, &abort_flag).await?;

            // 检查中止
            if abort_flag.load(Ordering::Relaxed) {
                return Err("已中止".to_string());
            }

            // 解析响应
            match parse_flashcards_response(&response) {
                Ok(cards) => {
                    tracing::info!("[闪记卡] 段 {}/{}: 完成，生成 {} 张卡片", chunk_idx + 1, total_chunks, cards.len());
                    Ok((cards, chunk_idx))
                }
                Err(e) => {
                    tracing::warn!("[闪记卡] 段 {}/{}: 解析失败 - {}", chunk_idx + 1, total_chunks, e);
                    // 解析失败时返回空数组，不中断整个流程
                    Ok((Vec::new(), chunk_idx))
                }
            }
        });

        tasks.push(task);
    }

    // 等待所有任务完成并收集结果
    let mut all_cards: Vec<(Vec<FlashcardItem>, usize)> = Vec::new();
    let mut has_error = false;

    for task in tasks {
        match task.await {
            Ok(Ok(result)) => {
                all_cards.push(result);
            }
            Ok(Err(e)) => {
                if e == "已中止" {
                    return Err("已中止".to_string());
                }
                tracing::error!("[闪记卡] 任务失败: {}", e);
                has_error = true;
            }
            Err(e) => {
                tracing::error!("[闪记卡] 任务执行错误: {}", e);
                has_error = true;
            }
        }
    }

    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 如果所有任务都失败了
    if all_cards.is_empty() && has_error {
        return Err("所有分段生成失败".to_string());
    }

    // 按段落顺序排序并合并卡片
    all_cards.sort_by_key(|(_, idx)| *idx);
    let cards: Vec<FlashcardItem> = all_cards
        .into_iter()
        .flat_map(|(cards, _)| cards)
        .collect();

    tracing::info!("[闪记卡] ========================================");
    tracing::info!("[闪记卡] 生成完成，共 {} 张卡片", cards.len());

    // 发送完成进度事件
    let _ = app.emit(event_name, FlashcardGenerationEvent::Progress {
        current: total_chunks + 1,
        total: total_chunks + 1,
        message: "完成!".to_string(),
    });

    // 构建结果
    let flashcard_data = FlashcardData {
        total_count: cards.len(),
        cards,
        generated_at: chrono::Local::now().to_rfc3339(),
    };

    Ok(flashcard_data)
}

async fn generate_flashcards_direct_internal(
    app: AppHandle,
    generation_id: String,
    note_id: String,
    model_id: String,
    abort_flag: Arc<AtomicBool>,
    cleanup_owned_abort_flag: bool,
) -> Result<(), String> {
    let event_name = format!("flashcard-generation-{}", generation_id);

    // 发送开始事件
    let _ = app.emit(&event_name, FlashcardGenerationEvent::Starting);

    let result = generate_flashcards_internal(
        &app,
        &event_name,
        &note_id,
        &model_id,
        &abort_flag,
    ).await;

    if cleanup_owned_abort_flag {
        remove_abort_flag(&generation_id).await;
    }

    match result {
        Ok(flashcard_data) => {
            // 保存到数据库
            if let Some(db) = DATABASE.get() {
                if let Ok(Some(mut note)) = db.get_note_by_id(&note_id) {
                    note.flashcards = Some(serde_json::to_string(&flashcard_data).unwrap_or_default());
                    let _ = db.update_note(&note);
                }
            }

            let _ = app.emit(
                &event_name,
                FlashcardGenerationEvent::Completed { flashcard_data },
            );
            Ok(())
        }
        Err(e) => {
            if e == "已中止" {
                let _ = app.emit(&event_name, FlashcardGenerationEvent::Aborted);
            } else {
                let _ = app.emit(
                    &event_name,
                    FlashcardGenerationEvent::Error { error: e.clone() },
                );
            }
            Err(e)
        }
    }
}

/// 直接调用的闪记卡生成函数（同步等待完成，供 note_initialization 使用）
pub async fn generate_flashcards_direct(
    app: AppHandle,
    generation_id: String,
    note_id: String,
    model_id: String,
    abort_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    generate_flashcards_direct_internal(app, generation_id, note_id, model_id, abort_flag, false).await
}

#[tauri::command]
pub async fn abort_flashcard_generation(generation_id: String) -> Result<(), String> {
    let flags = get_abort_flags_lock().lock().await;
    if let Some(flag) = flags.get(&generation_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
