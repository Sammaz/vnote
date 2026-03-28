//! 全景深度重构蓝图生成模块
//!
//! 两阶段生成策略:
//! 1. 生成目录大纲 (ARCHITECT阶段)
//! 2. 逐章生成内容 (GENERATOR阶段)
//! 3. 拼接完整markdown

use crate::ai_pool::{execute_non_streaming_with_abort, NonStreamingRequest};
use crate::db::{AiConfig, Note};
use crate::subtitle::{parse_subtitle_file, format_timestamp};
use crate::DATABASE;
use futures::future::try_join_all;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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
    pub start_time: String,  // 章节开始时间戳 (HH:MM:SS)
    pub end_time: String,    // 章节结束时间戳 (HH:MM:SS)
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
        r##"YOU ARE THE "OMNISCIENT KNOWLEDGE RECONSTRUCTION ENGINE" (OKRE).
你的核心使命是对抗信息熵，通过高强度的逻辑重构，将碎片化信息转化为反脆弱的永久知识资产。

=== 🛑 绝对铁律 (THE IRON LAWS) ===
1. 反摘要法 (Anti-Summarization): 严禁缩减信息量，必须进行扩容 (Expansion) 和深度挖掘。
2. 逻辑高于时序 (Logic-Over-Chronology): 严禁按时间线复述。必须打碎原文，提取 MECE 逻辑树结构。
3. 深度优先 (Depth-First): 遇到抽象概念必须下钻三层 (What -> Why -> How)。

=== 任务 ===
基于以下视频内容，设计一份"全景深度重构蓝图"的 JSON 大纲。

视频标题: {video_title}
内容素材(每行格式为 [时间戳] 字幕内容):
{subtitle_content}

=== 输出规范 ===
请严格按照以下JSON格式输出(不要包含markdown代码块标记):

{{
  "video_title": "视频标题",
  "core_fields": ["#领域/子领域", "#核心概念"],
  "knowledge_density": "极高",
  "estimated_words": "8000+",
  "chapters": [
    {{
      "index": 1,
      "title": "章节标题(不含序号)",
      "objective": "本章核心解决的问题与认知目标",
      "key_points": ["关键子题1", "关键子题2", "关键子题3"],
      "start_time": "00:00:00",
      "end_time": "00:05:30"
    }}
  ]
}}

=== 架构要求 ===
1. 结构重构: 将内容重组为 4-7 个逻辑严密的深度章节 (Chapters)。
2. 标题策略: 标题必须体现核心洞察，拒绝平庸的描述（如"什么是X" -> "X的熵减本质与运行机制"）。
3. 颗粒度: 每个章节必须承载 1500 字以上的深度内容。
4. 时间戳要求: 每个章节必须标注 start_time 和 end_time，格式为 HH:MM:SS。时间戳必须基于内容素材中的实际时间戳，准确反映该章节内容在视频中的时间范围。章节之间的时间应该连续覆盖整个视频。
"##,
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
        r##"你是"全知知识重构引擎"(OKRE)，负责为第 {index}/{total} 章生成深度内容。

【输入信息】
- 章节标题: {title}
- 本章目标: {objective}
- 关键子题: {key_points}
- 章节时间范围: {start_time} - {end_time}
- 内容素材: {subtitle_content}

【输出格式 - 必须严格遵守】

你的输出必须且只能包含以下结构，按顺序输出：

1. 章节主标题 (H2)，格式必须精确为:
   ## 第 {index} 章 {title}

2. 紧跟章节元数据 Callout (无标题，直接输出):
   > [!info] ⏱️ 章节坐标
   > * **⏱️ 时间戳**: [{start_time} - {end_time}]
   > * **🔑 核心概念**: #概念A #概念B
   > * **🎯 本章目标**: {objective}

3. 理论核心部分 (H3):
   ### {index}.1 [核心理论名称]
   内容要求: 定义重构(用==高亮==标注核心术语)、归因链条、语境锚点

4. AI增强解析部分 (H3):
   ### {index}.2 AI 增强解析
   必须包含三个 Callout:
   > [!abstract] 🧬 第一性原理
   > [!example] 🏛️ 场景具象化
   > [!tip] 🔗 跨学科思维模型

5. 批判性思考部分 (H3):
   ### {index}.3 批判性思考
   必须包含:
   > [!warning] ⚠️ 边界与盲点

6. 实战SOP部分 (H3):
   ### {index}.4 实战执行 SOP
   格式:
   - [ ] **Step 1: [动作名称]** -> *Success Metric: ...*
   - [ ] **Step 2: [动作名称]** -> *Success Metric: ...*

【禁止事项】
- 禁止输出任何指令文本、状态信息或元描述
- 禁止添加 "Block 0"、"Block A" 等标签作为标题
- 禁止在 H2/H3 标题中使用 [[双向链接]]
- 禁止输出 ```markdown``` 包裹标记

【文风规范】
- 高密度专业术语，拒绝废话
- 仅对动词和数据使用**加粗**
- 严禁超过5行的纯文本段落

字数要求: 2000字左右。直接输出 Markdown 内容。"##,
        index = chapter.index,
        total = total_chapters,
        title = chapter.title,
        objective = chapter.objective,
        key_points = chapter.key_points.join("、"),
        start_time = chapter.start_time,
        end_time = chapter.end_time,
        subtitle_content = subtitle_content
    )
}

/// 清洗 Markdown 字符串，去除可能的代码块包裹
fn clean_markdown_str(content: &str) -> String {
    let content = content.trim();
    if content.starts_with("```markdown") {
        content
            .trim_start_matches("```markdown")
            .trim_end_matches("```")
            .trim()
            .to_string()
    } else if content.starts_with("```") {
        content
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string()
    } else {
        content.to_string()
    }
}

/// 阶段3: 生成综合内容(摘要+Flashcards)的prompt
fn build_synthesizer_prompt(video_title: &str, chapter_summaries: &str, subtitle_content: &str) -> String {
    format!(
        r##"YOU ARE THE "OMNISCIENT KNOWLEDGE RECONSTRUCTION ENGINE" (OKRE).
当前状态: [SYNTHESIZER] (最终综合阶段)

任务: 为全景深度重构蓝图生成最终的综合模块。

视频标题: {video_title}

各章核心内容摘要:
{chapter_summaries}

原始内容素材(用于提取深度知识点):
{subtitle_content}

=== 🚨 输出规范 - 必须严格遵守以下格式 ===
请生成包含以下三个部分的 Markdown 内容，标题格式必须**完全一致**:

### Part 1: Executive Summary (全景深度重构蓝图)
使用 Markdown 列表树形结构，在一页内概括全书核心逻辑。
- 使用多级缩进列表展示知识层级
- 每个核心概念用 **加粗** 标注

### Part 2: Anki Flashcards
提取 5-10 个最核心的"反直觉"或"高价值"知识点，转化为 Anki 格式。

格式要求 (必须严格遵守，直接在 Part 2 标题下输出卡片，不要添加额外的子标题):

**Q: [核心问题]**

**A:** [深度解析，2-4句话]

⚠️ 重要: Q 和 A 必须分两行输出，中间空一行！每组卡片之间空两行。

### Part 3: Tag Index
格式: 在一行内列出所有标签，用空格分隔
#领域/子领域 #核心概念A #核心概念B #核心概念C

=== ⚠️ 注意事项 ===
1. 直接输出 Markdown 内容，不要包含```markdown```包裹标记
2. 不要重复章节正文内容
3. Part 标题必须使用 ### (H3) 级别"##,
        video_title = video_title,
        chapter_summaries = chapter_summaries,
        subtitle_content = subtitle_content
    )
}

// ============================================================================
// 核心生成函数
// ============================================================================

/// 清洗 JSON 字符串，智能提取第一个 '{' 和最后一个 '}' 之间的内容
fn clean_json_str(content: &str) -> String {
    let content = content.trim();

    // 寻找 JSON 对象的起始和结束位置
    let start = content.find('{');
    let end = content.rfind('}');

    match (start, end) {
        (Some(s), Some(e)) if s <= e => {
            // 提取从第一个 { 到最后一个 } 的内容
            content[s..=e].to_string()
        }
        _ => {
            // 如果找不到匹配的括号，退回到原始清洗逻辑（去除非 JSON 字符）
            content
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim()
                .to_string()
        }
    }
}

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

    // 清洗并解析JSON响应
    let cleaned_content = clean_json_str(&response.content);
    let outline: BlueprintOutline = serde_json::from_str(&cleaned_content)
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

    Ok(clean_markdown_str(&response.content))
}

/// 阶段3: 生成综合内容
async fn generate_synthesizer_content(
    ai_config: &AiConfig,
    video_title: &str,
    chapters: &[ChapterOutline],
    subtitle_content: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    // 构建章节摘要上下文
    let summaries: String = chapters.iter()
        .map(|c| format!("第{}章 [{}]: {} (关键点: {})", c.index, c.title, c.objective, c.key_points.join(", ")))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = build_synthesizer_prompt(video_title, &summaries, subtitle_content);

    let req = NonStreamingRequest {
        config: ai_config.clone(),
        prompt,
    };

    let response = execute_non_streaming_with_abort(req, abort_flag).await?;
    Ok(clean_markdown_str(&response.content))
}

/// 主生成流程
async fn generate_blueprint_internal(
    app: &AppHandle,
    event_name: &str,
    note_id: &str,
    model_id: &str,
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
        .map(|e| format!("[{}] {}", format_timestamp(e.start_time), e.text))
        .collect::<Vec<_>>()
        .join("\n");

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

    // 阶段2: 逐章生成内容 (并发执行)
    let total_chapters = outline.chapters.len();
    let completed_counter = Arc::new(AtomicUsize::new(0));

    // 更新初始状态
    let _ = app.emit(event_name, BlueprintGenerationEvent::Progress {
        current: 3,
        total: 3 + total_chapters + 1,
        message: format!("开始并发生成 {} 个章节...", total_chapters),
    });

    let chapter_futures = outline.chapters.iter().map(|chapter| {
        let ai_config = ai_config.clone();
        let chapter = chapter.clone();
        let subtitle_text = subtitle_text.clone();
        let abort_flag = abort_flag.clone();
        let app = app.clone();
        let event_name = event_name.to_string();
        let completed_counter = completed_counter.clone();

        async move {
            if abort_flag.load(Ordering::Relaxed) {
                return Err("已中止".to_string());
            }

            let result = generate_chapter_content(
                &ai_config,
                &chapter,
                &subtitle_text,
                total_chapters,
                &abort_flag
            ).await;

            // 无论成功失败，只要完成了一个，我们就更新一下进度（如果是成功的话）
            // 如果失败了，try_join_all 会直接抛出错误，所以这里其实只需要处理成功的计数
            if result.is_ok() {
                let completed = completed_counter.fetch_add(1, Ordering::Relaxed) + 1;
                let current_step = 3 + completed;
                let total_steps = 3 + total_chapters + 1;

                let _ = app.emit(&event_name, BlueprintGenerationEvent::Progress {
                    current: current_step,
                    total: total_steps,
                    message: format!("正在生成章节 ({}/{}): {}...", completed, total_chapters, chapter.title),
                });
            }

            result
        }
    });

    // 使用 try_join_all 并发执行所有章节生成任务
    // 任何一个失败都会立即返回错误
    // 这里的并发控制由 AiPoolManager 内部处理
    let chapter_contents = try_join_all(chapter_futures).await?;

    // 再次检查中止状态
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 阶段3: 生成综合内容 (Synthesizer)
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    let total_steps = 3 + total_chapters + 1;
    let _ = app.emit(event_name, BlueprintGenerationEvent::Progress {
        current: total_steps,
        total: total_steps,
        message: "正在生成全局总结与记忆卡片...".to_string(),
    });

    let synthesizer_content = generate_synthesizer_content(
        &ai_config,
        &note.title,
        &outline.chapters,
        &subtitle_text,
        abort_flag
    ).await?;

    // 阶段4: 拼接完整markdown
    for content in chapter_contents {
        final_markdown.push_str(&content);
        final_markdown.push_str("\n\n---\n\n");
    }

    // 为 Part 1/2/3 添加上级目录
    final_markdown.push_str("## 📑 附录\n\n");
    final_markdown.push_str(&synthesizer_content);

    let word_count = final_markdown.chars().count();

    tracing::info!("[全景蓝图] 生成完成,总字数: {}", word_count);

    let _ = app.emit(event_name, BlueprintGenerationEvent::Progress {
        current: total_steps,
        total: total_steps,
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
    note_id: String,
    model_id: String,
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
            &note_id,
            &model_id,
            &abort_flag,
        ).await;

        remove_abort_flag(&generation_id_clone).await;

        match result {
            Ok(blueprint_data) => {
                // 保存到数据库
                if let Some(db) = DATABASE.get() {
                    if let Ok(Some(mut note)) = db.get_note_by_id(&note_id) {
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

pub async fn generate_panoramic_blueprint_direct(
    app: AppHandle,
    note_id: String,
    model_id: String,
    abort_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let blueprint_data = generate_blueprint_internal(
        &app,
        "initialization-blueprint-direct",
        &note_id,
        &model_id,
        &abort_flag,
    )
    .await?;

    let db = DATABASE.get().ok_or("数据库未初始化")?;
    let mut note: Note = db
        .get_note_by_id(&note_id)
        .map_err(|e| format!("获取笔记失败: {}", e))?
        .ok_or("笔记不存在")?;

    note.panoramic_blueprint = Some(blueprint_data.content);
    db.update_note(&note)
        .map_err(|e| format!("保存深度蓝图失败: {}", e))?;

    Ok(())
}
