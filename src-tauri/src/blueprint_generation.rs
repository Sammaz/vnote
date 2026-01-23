//! 全景深度重构蓝图生成模块
//!
//! 两阶段生成策略:
//! 1. 生成目录大纲 (ARCHITECT阶段)
//! 2. 逐章生成内容 (GENERATOR阶段)
//! 3. 拼接完整markdown

use crate::ai_pool::{execute_non_streaming_with_abort, NonStreamingRequest};
use crate::db::AiConfig;
use crate::subtitle::parse_subtitle_file;
use crate::DATABASE;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

// ============================================================================
// 数据结构定义
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChapterOutline {
    pub index: usize,
    pub title: String,
    pub objective: String,
    pub key_points: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlueprintOutline {
    pub video_title: String,
    pub core_fields: Vec<String>,
    pub knowledge_density: String,
    pub estimated_words: String,
    pub chapters: Vec<ChapterOutline>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlueprintData {
    pub content: String,
    pub word_count: usize,
    pub generated_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "status")]
pub enum BlueprintGenerationEvent {
    Starting,
    Progress { current: usize, total: usize, message: String },
    Completed { blueprint_data: BlueprintData },
    Error { error: String },
    Aborted,
}

// ============================================================================
// 全局中止标志管理
// ============================================================================

static BLUEPRINT_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_abort_flags_lock() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    BLUEPRINT_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
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
// Prompt构建函数
// ============================================================================

/// 阶段1: 生成目录大纲的prompt
fn build_outline_prompt(subtitle_content: &str, video_title: &str) -> String {
    format!(
        r#"你是一个知识重构专家。基于以下视频字幕,生成一份"全景深度重构蓝图"的目录大纲。

视频标题: {video_title}

视频字幕内容:
{subtitle_content}

请严格按照以下JSON格式输出(不要包含markdown代码块标记):

{{
  "video_title": "视频标题",
  "core_fields": ["领域标签1", "领域标签2"],
  "knowledge_density": "低/中/高/极高",
  "estimated_words": "8000+",
  "chapters": [
    {{
      "index": 1,
      "title": "章节标题",
      "objective": "模块目标描述",
      "key_points": ["关键子题1", "关键子题2"]
    }}
  ]
}}

要求:
1. 将视频内容重组为3-6个逻辑清晰的章节
2. 每个章节要有明确的模块目标
3. 提炼2-4个关键子题
4. 章节标题要体现核心概念,不超过15个字"#,
        video_title = video_title,
        subtitle_content = subtitle_content
    )
}

/// 阶段2: 生成单个章节内容的prompt
fn build_chapter_prompt(
    chapter: &ChapterOutline,
    subtitle_content: &str,
    total_chapters: usize,
) -> String {
    format!(
        r#"你是一个知识重构专家。基于以下信息,为第 {index}/{total} 章生成深度内容。

章节标题: {title}
模块目标: {objective}
关键子题: {key_points}

视频字幕参考:
{subtitle_content}

请生成包含以下5个标准模块块的完整章节内容:

## {index}. {title}

> [!info] ⏱️ 章节坐标
> * **🔑 核心概念**: #概念A #概念B (必须使用纯中文标签)
> * **🎯 本章目标**: {objective}

### {index}.1 深度理论层
(建立认知地基,给出教科书级定义,构建逻辑链条)

### {index}.2 AI智能增强层
(使用Obsidian Callouts: [!abstract]、[!example]、[!tip])

> [!abstract] 🧬 第一性原理
> (解释背后的基础原理)

> [!example] 🏛️ 场景具象化
> (创造具体案例: 背景→冲突→行动→结果)

> [!tip] 🔗 跨学科思维模型
> (链接到通用模型)

### {index}.3 批判性视界
(使用 [!warning] 或 [!failure],分析边界、反模式)

> [!warning] ⚠️ 边界与盲点
> (什么情况下此理论失效?)

### {index}.4 手把手SOP
(原子级步骤清单,使用checkbox)

- [ ] **步骤1**: 具体动作 -> *Success Metric: 判断标准*
- [ ] **步骤2**: ...

要求:
1. 输出纯Markdown格式(不要包含代码块标记)
2. 每个Block都要充实内容,不能省略
3. 使用Obsidian Callouts语法(> [!类型])
4. 专业术语替代口语化表达
5. 列表项超过5行要拆分
6. 字数: 1500-2500字"#,
        index = chapter.index,
        total = total_chapters,
        title = chapter.title,
        objective = chapter.objective,
        key_points = chapter.key_points.join("、"),
        subtitle_content = subtitle_content
    )
}

// ============================================================================
// 核心生成函数
// ============================================================================

/// 阶段1: 生成目录大纲
async fn generate_outline(
    ai_config: &AiConfig,
    subtitle_content: &str,
    video_title: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Result<BlueprintOutline, String> {
    let prompt = build_outline_prompt(subtitle_content, video_title);

    let req = NonStreamingRequest {
        config: ai_config.clone(),
        prompt,
    };

    let response = execute_non_streaming_with_abort(req, abort_flag).await?;

    // 解析JSON响应
    let outline: BlueprintOutline = serde_json::from_str(&response.content)
        .map_err(|e| format!("解析大纲JSON失败: {}. 原始响应: {}", e, response.content))?;

    Ok(outline)
}

/// 阶段2: 生成单个章节内容
async fn generate_chapter_content(
    ai_config: &AiConfig,
    chapter: &ChapterOutline,
    subtitle_content: &str,
    total_chapters: usize,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    let prompt = build_chapter_prompt(chapter, subtitle_content, total_chapters);

    let req = NonStreamingRequest {
        config: ai_config.clone(),
        prompt,
    };

    let response = execute_non_streaming_with_abort(req, abort_flag).await?;

    Ok(response.content)
}

/// 主生成流程
async fn generate_blueprint_internal(
    app: &AppHandle,
    event_name: &str,
    note_id: i64,
    model_id: i64,
    abort_flag: &Arc<AtomicBool>,
) -> Result<BlueprintData, String> {
    let db = DATABASE.get().ok_or("数据库未初始化")?;

    // 获取笔记
    let note = db.get_note_by_id(note_id)
        .map_err(|e| format!("获取笔记失败: {}", e))?
        .ok_or("笔记不存在")?;

    let subtitle_path = note.subtitle_path.ok_or("没有字幕文件")?;
    let ai_config = db.get_ai_config_by_id(model_id)
        .map_err(|e| format!("获取AI配置失败: {}", e))?
        .ok_or("AI配置不存在")?;

    // 解析字幕
    let _ = app.emit(event_name, BlueprintGenerationEvent::Progress {
        current: 1,
        total: 10,
        message: "正在解析字幕...".to_string(),
    });

    let subtitles = parse_subtitle_file(&subtitle_path)
        .map_err(|e| format!("解析字幕失败: {}", e))?;

    let subtitle_text: String = subtitles
        .iter()
        .map(|e| e.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 阶段1: 生成大纲
    let _ = app.emit(event_name, BlueprintGenerationEvent::Progress {
        current: 2,
        total: 10,
        message: "AI正在生成目录大纲...".to_string(),
    });

    let outline = generate_outline(&ai_config, &subtitle_text, &note.title, abort_flag).await?;

    tracing::info!("[全景蓝图] 大纲生成完成,章节数: {}", outline.chapters.len());

    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 构建markdown（不包含大纲部分，直接从章节内容开始）
    let mut final_markdown = String::new();

    // 阶段2: 逐章生成内容
    let total_chapters = outline.chapters.len();
    let mut chapter_contents = Vec::new();

    for (idx, chapter) in outline.chapters.iter().enumerate() {
        if abort_flag.load(Ordering::Relaxed) {
            return Err("已中止".to_string());
        }

        let current_step = 3 + idx;
        let total_steps = 3 + total_chapters;

        let _ = app.emit(event_name, BlueprintGenerationEvent::Progress {
            current: current_step,
            total: total_steps,
            message: format!("正在生成第{}/{}章: {}...", idx + 1, total_chapters, chapter.title),
        });

        let content = generate_chapter_content(
            &ai_config,
            chapter,
            &subtitle_text,
            total_chapters,
            abort_flag
        ).await?;

        chapter_contents.push(content);
    }

    // 阶段3: 拼接完整markdown
    for content in chapter_contents {
        final_markdown.push_str(&content);
        final_markdown.push_str("\n\n---\n\n");
    }

    let word_count = final_markdown.chars().count();

    tracing::info!("[全景蓝图] 生成完成,总字数: {}", word_count);

    let _ = app.emit(event_name, BlueprintGenerationEvent::Progress {
        current: 10,
        total: 10,
        message: "完成!".to_string(),
    });

    Ok(BlueprintData {
        content: final_markdown,
        word_count,
        generated_at: chrono::Local::now().to_rfc3339(),
    })
}

// ============================================================================
// Tauri 命令
// ============================================================================

#[tauri::command]
pub async fn generate_panoramic_blueprint(
    app: AppHandle,
    generation_id: String,
    note_id: i64,
    model_id: i64,
) -> Result<(), String> {
    let event_name = format!("blueprint-generation-{}", generation_id);
    let abort_flag = create_abort_flag(&generation_id).await;

    let _ = app.emit(&event_name, BlueprintGenerationEvent::Starting);

    let app_clone = app.clone();
    let event_name_clone = event_name.clone();
    let generation_id_clone = generation_id.clone();

    tokio::spawn(async move {
        let result = generate_blueprint_internal(
            &app_clone,
            &event_name_clone,
            note_id,
            model_id,
            &abort_flag,
        ).await;

        remove_abort_flag(&generation_id_clone).await;

        match result {
            Ok(blueprint_data) => {
                // 保存到数据库
                if let Some(db) = DATABASE.get() {
                    if let Ok(Some(mut note)) = db.get_note_by_id(note_id) {
                        note.panoramic_blueprint = Some(blueprint_data.content.clone());
                        let _ = db.update_note(&note);
                    }
                }

                let _ = app_clone.emit(
                    &event_name_clone,
                    BlueprintGenerationEvent::Completed { blueprint_data },
                );
            }
            Err(e) => {
                if e == "已中止" {
                    let _ = app_clone.emit(&event_name_clone, BlueprintGenerationEvent::Aborted);
                } else {
                    let _ = app_clone.emit(
                        &event_name_clone,
                        BlueprintGenerationEvent::Error { error: e },
                    );
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn abort_blueprint_generation(generation_id: String) -> Result<(), String> {
    let flags = get_abort_flags_lock().lock().await;
    if let Some(flag) = flags.get(&generation_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
