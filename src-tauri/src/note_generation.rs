//! 笔记生成模块
//!
//! 负责根据视频字幕生成6个标签页的内容：
//! - 全文总结 (FullSummary)
//! - 原文细读 (DetailedReading)
//! - 高光笔记 (Highlights)
//! - 视觉化总结 (VisualSummary)
//! - 自定义总结 (CustomSummary)
//!
//! 以及辅助模式章节生成功能

use crate::ai_pool::{
    execute_streaming_and_collect, execute_streaming_and_collect_with_max_tokens,
    get_ai_pool_manager,
};
use crate::chapter::{
    analyze_subtitle_for_chapters, capture_video_screenshot, sanitize_filename,
    split_subtitle_into_chunks, format_timestamp_for_filename, Chapter, ChapterData, ChapterGenerationEvent,
    DetailedReadingChapter, DetailedReadingData,
};
use crate::db::{AiConfig, Database, ScreenshotMarker};
use crate::subtitle::{parse_subtitle_file, SubtitleEntry};
use crate::settings::{SettingsManager, keys, defaults};
use crate::storage_paths;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Semaphore};
use tauri::{AppHandle, Emitter};
use std::sync::OnceLock;
use futures::stream::{self, StreamExt};

// ============================================================================
// 数据结构定义
// ============================================================================

/// 笔记生成请求
#[derive(Debug, Deserialize)]
pub struct GenerateNoteRequest {
    pub note_id: String,
    pub model_id: String,
    pub options: GenerationOptions,
}

/// 生成选项
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerationOptions {
    /// 是否并发生成所有标签页（默认true，预留用于未来串行/并发切换）
    #[serde(default)]
    #[allow(dead_code)]
    pub concurrent: bool,
    /// 要生成的标签页列表（为空则生成全部）
    #[serde(default)]
    pub tabs_to_generate: Vec<TabType>,
    /// 是否重新生成已存在的内容
    #[serde(default)]
    pub regenerate: bool,
    /// 并发数限制（1-10，与 AiConfig.concurrent_limit / 模型池一致）
    #[serde(default = "default_concurrent_limit")]
    pub concurrent_limit: usize,
    /// AI 笔记样式（可选）
    #[serde(default)]
    pub style: Option<String>,
    /// 自定义提示词（可选）
    #[serde(default)]
    pub custom_prompt: Option<String>,
    /// AI 笔记截图密度（可选）
    #[serde(default)]
    pub screenshot_density: Option<String>,
    /// 严格失败模式：任一标签页失败时整体返回错误
    #[serde(default)]
    pub fail_on_any_tab_error: bool,
}

fn default_concurrent_limit() -> usize {
    if crate::DATABASE.get().is_some() {
        SettingsManager::get_int(keys::PROCESS_DEFAULT_CONCURRENT, defaults::PROCESS_DEFAULT_CONCURRENT)
    } else {
        2
    }
}

/// 标签页类型
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TabType {
    FullSummary,      // 全文总结
    DetailedReading,  // 原文细读
    Highlights,       // 高光笔记
    VisualSummary,    // 视觉化总结
    CustomSummary,    // 自定义总结
    AiNote,           // AI 笔记
}

/// 生成策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenerationStrategy {
    /// 直接发送全部字幕
    Direct,
    /// 分层递进生成（先框架后细节）
    Layered,
    /// 分段生成后合并
    Chunked,
    /// RAG检索生成（预留用于未来实现）
    #[allow(dead_code)]
    Rag,
}

/// 生成进度事件
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "status")]
pub enum GenerationEvent {
    Starting {
        total_tabs: usize,
        tabs_to_generate: Vec<String>,
    },
    TabStarted {
        tab_type: String,
        tab_name: String,
    },
    TabProgress {
        tab_type: String,
        current: usize,
        total: usize,
        message: String,
    },
    TabCompleted {
        tab_type: String,
        content: String,
    },
    /// 渐进式结果：标签页尚未全部完成，但已有可展示的部分内容
    #[allow(dead_code)]
    TabPartial {
        tab_type: String,
        content: String,
    },
    ChapterPartial {
        tab_type: String,
        index: usize,
        total: usize,
        chapter: DetailedReadingChapter,
        total_duration: f64,
    },
    TabError {
        tab_type: String,
        error: String,
    },
    AllCompleted {
        generated: usize,
        failed: usize,
        total: usize,
    },
    /// 中止事件（预留用于未来中止通知）
    #[allow(dead_code)]
    Aborted {
        reason: String,
    },
}

fn is_abort_error(err: &str) -> bool {
    err == "已中止"
        || err.contains("取消")
        || err.contains("中止")
        || err.contains("Aborted")
        || err.contains("aborted")
}

fn clamp_concurrent_limit(limit: usize) -> usize {
    limit.max(1).min(10)
}

fn fallback_chapter_content(subtitle_text: &str) -> String {
    let excerpt: String = subtitle_text.chars().take(80).collect();
    if excerpt.is_empty() {
        "该段生成失败，可稍后重试".to_string()
    } else {
        format!("{}…", excerpt)
    }
}

fn snapshot_completed_chapters(
    slots: &[Option<DetailedReadingChapter>],
    total_duration: f64,
) -> DetailedReadingData {
    DetailedReadingData {
        chapters: slots.iter().flatten().cloned().collect(),
        total_duration,
        generated_at: chrono::Local::now().to_rfc3339(),
    }
}

fn emit_detailed_reading_chapter_partial(
    app: &AppHandle,
    event_name: &str,
    index: usize,
    total: usize,
    chapter: &DetailedReadingChapter,
    total_duration: f64,
) {
    let _ = app.emit(
        event_name,
        GenerationEvent::ChapterPartial {
            tab_type: "DetailedReading".to_string(),
            index,
            total,
            chapter: chapter.clone(),
            total_duration,
        },
    );
}

fn persist_detailed_reading_snapshot(note_id: &str, model_id: &str, data: &DetailedReadingData) {
    let Ok(content) = serde_json::to_string(data) else {
        return;
    };
    if let Some(db) = crate::DATABASE.get() {
        if let Err(e) = update_note_tab(
            db,
            note_id,
            &TabType::DetailedReading,
            &content,
            model_id,
            None,
            None,
            None,
        ) {
            tracing::warn!("[detailed_reading] persist failed: {}", e);
        }
    }
}

const DETAILED_READING_DB_DEBOUNCE: Duration = Duration::from_millis(400);

fn persist_detailed_reading_snapshot_if_due(
    last_persist_at: &mut Instant,
    force: bool,
    note_id: &str,
    model_id: &str,
    data: &DetailedReadingData,
) {
    if !force && last_persist_at.elapsed() < DETAILED_READING_DB_DEBOUNCE {
        return;
    }
    persist_detailed_reading_snapshot(note_id, model_id, data);
    *last_persist_at = Instant::now();
}

/// 单个标签页的生成结果
#[derive(Debug)]
pub struct TabResult {
    pub tab_type: TabType,
    pub content: String,
    pub success: bool,
    /// 错误信息（用于调试和错误报告）
    #[allow(dead_code)]
    pub error: Option<String>,
}

// ============================================================================
// 全局中止标志管理
// ============================================================================

/// 全局生成任务中止标志（保持兼容，但现在委托给ai_pool）
static GENERATION_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    OnceLock::new();

/// 获取中止标志锁（保持向后兼容）
fn get_abort_flags_lock() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    GENERATION_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 获取或创建中止标志（保持向后兼容，同时注册到ai_pool）
async fn get_abort_flag(generation_id: &str) -> Arc<AtomicBool> {
    // 同时在ai_pool中注册
    let pool_flag: Arc<AtomicBool> = get_ai_pool_manager().register_abort_flag(generation_id.to_string()).await;

    // 也在本地注册以保持兼容
    let mut flags = get_abort_flags_lock().lock().await;
    flags
        .entry(generation_id.to_string())
        .or_insert_with(|| pool_flag.clone())
        .clone()
}

/// 清理中止标志
async fn cleanup_abort_flag(generation_id: &str) {
    // 清理ai_pool中的标志
    get_ai_pool_manager().cleanup_abort_flag(generation_id).await;

    // 清理本地标志
    let mut flags = get_abort_flags_lock().lock().await;
    flags.remove(generation_id);
}

// ============================================================================
// 提示词模板
// ============================================================================

/// 提示词模板
struct PromptTemplates;

impl PromptTemplates {
    fn ai_note_output_boundary_rules() -> &'static str {
        "直接输出最终可直接保存的 Markdown 笔记正文，并在正文结束处自然收尾；不要在结尾添加“如果你愿意”“如需我可以”“我还可以继续”等服务型话术；不要推荐再整理为极简版、树状层级版、问题清单版、思维导图版、复习卡片等其他格式；不要追加任何邀请继续提问、继续整理、继续改写的句子"
    }

    /// 全文总结提示词 - 返回 Markdown 格式
    fn full_summary(subtitle_content: &str) -> String {
        format!(
            r#"你是一个专业的视频内容分析师。请分析以下视频字幕，生成一份结构化的全文总结。

输出要求：
1. 使用 Markdown 格式输出（不要使用代码块标记）
2. 使用自然连贯的段落式写作，禁止逐行罗列或一行一句的碎片化风格
3. 包含以下结构：

# 摘要
用3-5句连贯的话概括视频的主题、核心论点和关键结论（100-150字），写成一个完整的自然段落。

# 核心亮点

## 🔥 亮点标题1
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

## 💡 亮点标题2
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

（继续提取3-5个最重要的亮点）

# 关键术语
- **术语1**：解释
- **术语2**：解释

---

视频字幕内容：
{}"#,
            subtitle_content
        )
    }

    /// 高光笔记提示词
    fn highlights(subtitle_content: &str) -> String {
        format!(
            r#"你是一个专业的笔记整理助手。请从视频字幕中提取值得高光的精彩片段。

高光类型包括：
1. **金句/名言**: 有启发性的句子
2. **关键数据**: 重要的数字和统计
3. **实操技巧**: 具体的操作方法
4. **对比分析**: 不同方案的比较
5. **常见误区**: 容易犯错的地方

输出格式（Markdown）：
### 金句
> "引用内容"

### 关键数据
- 数据点：[说明]

### 实操技巧
- 技巧1：[描述]

视频字幕内容：
{}"#,
            subtitle_content
        )
    }

    /// 视觉化总结提示词
    fn visual_summary(subtitle_content: &str) -> String {
        format!(
            r#"你是一个擅长用可视化方式表达内容的助手。请为视频内容创建视觉化的总结。

输出格式（使用Mermaid思维导图语法）：
```mermaid
mindmap
  root((视频主题))
    分支1
      子概念1
      子概念2
    分支2
      子概念3
```

如果内容不适合思维导图，可以用表格、时间线等其他形式。请在输出的开头说明你选择的格式类型。

视频字幕内容：
{}"#,
            subtitle_content
        )
    }

    /// 自定义总结提示词
    fn custom_summary(subtitle_content: &str) -> String {
        format!(
            r#"你是一个智能总结助手。请为视频内容生成一份简洁的自定义总结。

输出要求：
1. 结构清晰，便于快速浏览
2. 包含：核心观点、实用建议、延伸思考
3. 使用Markdown格式
4. 控制在500字以内

视频字幕内容：
{}"#,
            subtitle_content
        )
    }

    fn ai_note(
        transcript_content: &str,
        style: Option<&str>,
        screenshot_density: Option<&str>,
        custom_prompt: Option<&str>,
    ) -> String {
        let style_requirements = match style.unwrap_or("detailed") {
            "concise" => "简洁模式：每个主要章节使用 3-5 条要点总结核心信息，优先保留关键结论、概念和行动建议，避免冗长展开。",
            "outline" => "大纲模式：只输出标题、子标题和必要的极短要点，不展开成长段落，突出层级结构，便于直接转换为脑图。",
            _ => "详细模式：充分展开每个章节，保留关键概念、案例、方法步骤、因果关系与重要结论，但避免机械重复字幕原文。",
        };

        let (screenshot_requirements, screenshot_format_rule) = match screenshot_density {
            Some("off") => (
                "\n\n**关键帧截图要求：**\n- 不要在笔记中插入任何 `[[SCREENSHOT:...]]` 标记，仅生成纯文本笔记。",
                "",
            ),
            Some("few") => (
                "\n\n**关键帧截图要求：**\n- 在最重要的正文章节开头放置 `[[SCREENSHOT:hh:mm:ss]]` 标记。\n- 全篇控制在 3-5 个截图点。\n- 标记需独占一行，并使用 transcript 中出现的真实三段式时间。\n- 笔记末尾的 `## 总结` 下面禁止放置任何截图标记。",
                "\n- 截图标记格式严格为 `[[SCREENSHOT:HH:MM:SS]]`，SCREENSHOT 是一个完整单词，时间戳为零填充三段式。正确示例：`[[SCREENSHOT:00:13:25]]`、`[[SCREENSHOT:01:05:09]]`。禁止：`[[SCREENSCREENSHOT:...]]`、`[[Screenshot:...]]`、`[[SCREENSHOT:1:5:9]]`、`[[SCREENSHOT:01:36]]`。",
            ),
            Some("moderate") => (
                "\n\n**关键帧截图要求：**\n- 每个正文 `##` 主章节只保留 1 个截图标记，并且必须紧跟在该 `##` 标题下一行。\n- 如果该主章节下面有多个 `###` 子章节，不要为每个子章节分别插入截图，也不要在同一个 `##` 主章节下连续放置多张截图。\n- 请为这个 `##` 主章节选择 1 个最能代表整章内容的时间点作为截图时间。\n- 标记需独占一行，并使用 transcript 中出现的真实三段式时间。\n- 笔记末尾的 `## 总结` 下面禁止放置任何截图标记。",
                "\n- 截图标记格式严格为 `[[SCREENSHOT:HH:MM:SS]]`，SCREENSHOT 是一个完整单词，时间戳为零填充三段式。正确示例：`[[SCREENSHOT:00:13:25]]`、`[[SCREENSHOT:01:05:09]]`。禁止：`[[SCREENSCREENSHOT:...]]`、`[[Screenshot:...]]`、`[[SCREENSHOT:1:5:9]]`、`[[SCREENSHOT:01:36]]`。",
            ),
            Some("dense") => (
                "\n\n**关键帧截图要求：**\n- 在每个正文 `##` 章节标题后都放置 `[[SCREENSHOT:hh:mm:ss]]` 标记。\n- 对图表、界面、步骤演示、关键对比等视觉重点补充更多截图标记。\n- 标记需独占一行，并使用 transcript 中出现的真实三段式时间。\n- 笔记末尾的 `## 总结` 下面禁止放置任何截图标记。",
                "\n- 截图标记格式严格为 `[[SCREENSHOT:HH:MM:SS]]`，SCREENSHOT 是一个完整单词，时间戳为零填充三段式。正确示例：`[[SCREENSHOT:00:13:25]]`、`[[SCREENSHOT:01:05:09]]`。禁止：`[[SCREENSCREENSHOT:...]]`、`[[Screenshot:...]]`、`[[SCREENSHOT:1:5:9]]`、`[[SCREENSHOT:01:36]]`。",
            ),
            _ => ("", ""),
        };

        let user_requirements = custom_prompt
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("\n\n**用户附加指令：**\n{}", value))
            .unwrap_or_default();

        format!(
            r#"你是一个专业的视频内容笔记助手，擅长将视频逐字稿整理成结构清晰、内容完整、适合复习的学习笔记。

**笔记要求：**
1. 笔记必须使用中文输出，专有名词和技术术语可保留英文。
2. 使用 Markdown 标题组织内容，不要使用代码块包裹全文。
3. 每个正文 `##` 主章节标题必须统一使用 `## 章节名 ⏱ mm:ss` 格式；如果时间超过 1 小时，则使用 `## 章节名 ⏱ hh:mm:ss`，时间戳代表该章节在视频中的起始时刻。
4. 每个正文 `##` 主章节必须且只能包含 1 个显式起始时间；不要省略时间，也不要在同一标题中放多个时间。
5. `###` 子章节、正文说明、案例引用都不承担章节起始时间语义，不要用它们替代 `##` 主章节标题时间。
6. 忠实保留视频的核心信息、关键细节、案例、步骤、结论与注意事项，省略广告、寒暄和口头填充词。
7. 不要生成目录，不要输出 JSON，不要输出 Mermaid。
8. 在笔记末尾添加 `## 总结`，用 2-4 句话概括整支视频的核心观点，也不要为 `## 总结` 添加时间戳。
9. {}
10. {}

**时间戳输入说明：**
你收到的转写内容按行提供，格式为 `[hh:mm:ss] 文本内容`。
请严格根据这些时间信息生成时间戳，并遵守以下规则：
- 当 transcript 时间是 `[00:13:25]` 时，章节标题必须写成 `⏱ 13:25`，不能写成 `⏱ 00:13`。
- 当 transcript 时间是 `[01:13:25]` 时，章节标题必须写成 `⏱ 01:13:25`。
- 不要把正文中的引用时间、示例时间、回顾时间当成章节起始时间。
{}{}

**风格要求：**
{}
{}

视频转写全文：
{}"#,
            Self::ai_note_output_boundary_rules(),
            "直接输出最终可保存的 Markdown 笔记正文，不要在结尾追加继续提问或继续整理的邀请。",
            screenshot_format_rule,
            screenshot_requirements,
            style_requirements,
            user_requirements,
            transcript_content
        )
    }

    /// 生成分段摘要的提示词
    fn chunk_summary(chunk_content: &str) -> String {
        format!(
            r#"请为以下视频字幕片段生成简洁摘要（300字以内），保留核心内容和关键信息：

{}"#,
            chunk_content
        )
    }

    /// 基于框架生成完整总结的提示词（Markdown 格式）
    fn framework_expand(framework: &str) -> String {
        format!(
            r#"基于以下视频摘要框架，生成完整的结构化全文总结。

摘要框架：
{}

请严格按照以下 Markdown 格式输出（不要使用代码块标记），使用自然连贯的段落式写作，禁止逐行罗列：

# 摘要
用3-5句连贯的话概括视频的主题、核心论点和关键结论（100-150字），写成一个完整的自然段落。

# 核心亮点

## 🔥 亮点标题
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

## 💡 亮点标题
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

（继续提取3-5个亮点）

# 关键术语
- **术语**：解释"#,
            framework
        )
    }
}

// ============================================================================
// 策略选择
// ============================================================================

/// 智能选择生成策略
fn select_strategy(
    subtitle_length: usize,
    tab_type: TabType,
    model_context_size: usize,
    _has_custom_prompt: bool,
) -> GenerationStrategy {
    let truncation_limit = SettingsManager::get_int(keys::PROCESS_TRUNCATION_LIMIT, defaults::PROCESS_TRUNCATION_LIMIT);
    // 估算token数（中文约1.5字符/token，保守估计1:1）
    let estimated_tokens = subtitle_length + truncation_limit; // 加上prompt和输出预留

    match (subtitle_length, tab_type) {
        // 短字幕（< 10,000字符）：直接发送
        (len, _) if len < 10_000 => GenerationStrategy::Direct,

        // 中等长度 + 大上下文模型：直接发送
        (len, _) if estimated_tokens < model_context_size * 8 / 10
            && model_context_size >= 32_000 =>
        {
            GenerationStrategy::Direct
        }

        // 字幕 >= 10,000字符：使用分层递进策略（包括自定义总结）
        (len, TabType::FullSummary | TabType::CustomSummary) if len >= 10_000 => {
            GenerationStrategy::Layered
        }

        // 原文细读 + 长字幕：分段生成
        (_, TabType::DetailedReading) if subtitle_length >= 20_000 => GenerationStrategy::Chunked,

        // 默认：直接发送
        _ => GenerationStrategy::Direct,
    }
}

/// 获取模型上下文窗口大小（简化版，实际可以从配置读取）
fn get_model_context_size(model_name: &str) -> usize {
    // 常见模型的上下文窗口大小
    if model_name.contains("gpt-4") || model_name.contains("claude") {
        128_000 // 大上下文模型
    } else if model_name.contains("gpt-3.5") {
        16_000
    } else if model_name.contains("deepseek") {
        32_000
    } else {
        8_000 // 保守默认值
    }
}

// ============================================================================
// 语义分段
// ============================================================================

/// 找到最近的有效字符边界（向前查找）
fn floor_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut idx = index;
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

/// 找到最近的有效字符边界（向后查找）
fn ceil_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut idx = index;
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

/// 语义分段（按字幕时间戳和语义边界）
/// 分段策略：先计算段数 = 字数 / SEGMENT_SIZE + 1，再用字数 / 段数得到每段目标大小
fn split_subtitle_by_semantic(subtitle: &str) -> Vec<String> {
    let segment_size = SettingsManager::get_int(keys::PROCESS_SEGMENT_SIZE, defaults::PROCESS_SEGMENT_SIZE);

    if subtitle.len() < segment_size {
        // 内容少于 SEGMENT_SIZE，不需要分段
        return vec![subtitle.to_string()];
    }

    // 计算段数：字数 / SEGMENT_SIZE + 1
    let num_chunks = subtitle.len() / segment_size + 1;
    // 计算每段目标大小：字数 / 段数（确保各段大小均匀）
    let target_chunk_size = subtitle.len() / num_chunks;

    let mut chunks = Vec::new();
    let mut last_split = 0;

    while last_split + target_chunk_size < subtitle.len() {
        // 计算目标分割位置
        let target_pos = last_split + target_chunk_size;

        // 寻找最近的语义边界（限制搜索范围避免偏离太多）
        let split_pos = find_semantic_boundary_near(subtitle, target_pos, target_chunk_size / 10)
            .unwrap_or(target_pos);

        // 确保 split_pos 在字符边界上
        let split_pos = ceil_char_boundary(subtitle, split_pos);

        // 确保分段有效且有合理长度（至少 1000 字符）
        if split_pos > last_split && split_pos > last_split + 1000 {
            chunks.push(subtitle[last_split..split_pos].to_string());
            last_split = split_pos;
        } else {
            // 如果找不到合适的边界，强制按目标位置分割
            let forced_pos = ceil_char_boundary(subtitle, target_pos);
            chunks.push(subtitle[last_split..forced_pos].to_string());
            last_split = forced_pos;
        }
    }

    // 添加剩余内容作为最后一段
    if last_split < subtitle.len() {
        chunks.push(subtitle[last_split..].to_string());
    }

    // 如果分段失败，返回原始内容
    if chunks.is_empty() {
        return vec![subtitle.to_string()];
    }

    chunks
}

/// 寻找最近的语义边界（句号、换行等）
/// around: 目标位置
/// max_distance: 最大搜索距离（避免偏离太远）
fn find_semantic_boundary_near(text: &str, around: usize, max_distance: usize) -> Option<usize> {
    let search_start = floor_char_boundary(text, around.saturating_sub(max_distance));
    let search_end = ceil_char_boundary(text, (around + max_distance).min(text.len()));

    if search_start >= search_end || search_start >= text.len() {
        return None;
    }

    let search_text = &text[search_start..search_end];

    // 优先寻找句子结束标记
    for delimiter in ["。", "！", "？", "\n\n", "...\n", "；"] {
        if let Some(offset) = search_text.find(delimiter) {
            return Some(search_start + offset + delimiter.len());
        }
    }

    // 次选：寻找空格
    if let Some(pos) = search_text.rfind(' ') {
        return Some(search_start + pos + 1);
    }

    None
}

// ============================================================================
// AI API 调用（使用ai_pool统一管理）
// ============================================================================

static AI_NOTE_SCREENSHOT_REGEX: OnceLock<Regex> = OnceLock::new();
static AI_NOTE_SCREENSHOT_LOOSE_REGEX: OnceLock<Regex> = OnceLock::new();
static AI_NOTE_MAIN_HEADING_REGEX: OnceLock<Regex> = OnceLock::new();
static AI_NOTE_MAIN_HEADING_TIMESTAMP_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_ai_note_screenshot_regex() -> &'static Regex {
    AI_NOTE_SCREENSHOT_REGEX.get_or_init(|| {
        Regex::new(r"\[\[SCREENSHOT:(\d{2}:\d{2}:\d{2})\]\]").unwrap()
    })
}

fn get_ai_note_screenshot_loose_regex() -> &'static Regex {
    AI_NOTE_SCREENSHOT_LOOSE_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)[\[【]{1,2}\s*(?:SCREENSHOT|截图)\s*[:：]\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:\.\d+)?\s*[\]】]{1,2}",
        )
        .unwrap()
    })
}

fn get_ai_note_main_heading_regex() -> &'static Regex {
    AI_NOTE_MAIN_HEADING_REGEX.get_or_init(|| Regex::new(r"^\s{0,3}##\s+(.+?)\s*$").unwrap())
}

fn get_ai_note_main_heading_timestamp_regex() -> &'static Regex {
    AI_NOTE_MAIN_HEADING_TIMESTAMP_REGEX.get_or_init(|| {
        Regex::new(r"⏱\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$").unwrap()
    })
}

fn format_ai_note_timestamp(seconds: f64) -> String {
    let total_seconds = seconds.max(0.0).floor() as u64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let secs = total_seconds % 60;

    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

fn build_ai_note_transcript(entries: &[SubtitleEntry]) -> String {
    entries
        .iter()
        .filter_map(|entry| {
            let text = entry
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();

            if text.is_empty() {
                return None;
            }

            Some(format!("[{}] {}", format_ai_note_timestamp(entry.start_time), text))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_ai_note_timestamp_to_seconds(raw: &str) -> Option<f64> {
    let parts = raw
        .split(':')
        .map(|part| part.trim().parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()?;

    match parts.as_slice() {
        [hours, minutes, seconds] => Some((hours * 3600 + minutes * 60 + seconds) as f64),
        _ => None,
    }
}

fn build_ai_note_screenshot_asset_url(image_path: &str) -> String {
    format!("http://asset.localhost/{}", urlencoding::encode(image_path))
}

fn build_ai_note_screenshot_markdown(image_path: &str, timestamp: &str) -> String {
    format!("![⏱ {}]({})", timestamp, build_ai_note_screenshot_asset_url(image_path))
}

fn validate_ai_note_structure(content: &str) -> String {
    let heading_regex = get_ai_note_main_heading_regex();
    let timestamp_regex = get_ai_note_main_heading_timestamp_regex();

    let normalized = content.trim().to_string();
    for line in normalized.lines() {
        let Some(captures) = heading_regex.captures(line) else {
            continue;
        };
        let heading_text = captures.get(1).map(|m| m.as_str().trim()).unwrap_or_default();
        if heading_text == "总结" || heading_text == "总结：" || heading_text == "总结:" {
            continue;
        }
        if timestamp_regex.captures(heading_text).is_none() {
            tracing::warn!("[AiNote] 主章节缺少显式时间戳: {}", heading_text);
        }
    }

    normalized
}

fn extract_ai_note_screenshots(
    app: &AppHandle,
    note: &crate::db::Note,
    content: &str,
) -> Result<String, String> {
    let loose_re = get_ai_note_screenshot_loose_regex();

    if note.video_path.trim().is_empty() {
        let cleaned = loose_re.replace_all(content, "").to_string();
        return Ok(cleaned.trim().to_string());
    }

    let strict_re = get_ai_note_screenshot_regex();
    let has_any_placeholder =
        strict_re.is_match(content) || loose_re.is_match(content);
    if !has_any_placeholder {
        return Ok(content.trim().to_string());
    }

    let screenshots_dir = storage_paths::ai_note_screenshots_dir(app, &note.id)?;
    std::fs::create_dir_all(&screenshots_dir)
        .map_err(|e| format!("创建截图目录失败: {}", e))?;

    let video_name = Path::new(&note.video_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("video");
    let safe_video_name = sanitize_filename(video_name);

    let mut replaced = content.to_string();
    let mut processed: HashSet<String> = HashSet::new();

    // 阶段 1: 严格正则优先处理（保留原行为）
    let strict_markers: Vec<String> = strict_re
        .captures_iter(&replaced.clone())
        .filter_map(|capture| capture.get(1).map(|matched| matched.as_str().to_string()))
        .collect();

    for marker in strict_markers {
        if !processed.insert(format!("strict:{}", marker)) {
            continue;
        }

        let placeholder = format!("[[SCREENSHOT:{}]]", marker);
        let Some(seconds) = parse_ai_note_timestamp_to_seconds(&marker) else {
            replaced = replaced.replace(&placeholder, "");
            continue;
        };

        replaced = try_replace_ai_note_placeholder(
            &replaced,
            &placeholder,
            seconds,
            &marker,
            &screenshots_dir,
            &safe_video_name,
            &note.video_path,
        );
    }

    // 阶段 2: 宽松正则兜底处理（捕获 LLM 输出的格式变体）
    let loose_hits: Vec<(String, u64, u64, u64)> = loose_re
        .captures_iter(&replaced.clone())
        .filter_map(|capture| {
            let full = capture.get(0)?.as_str().to_string();
            let g_h = capture.get(1).and_then(|m| m.as_str().parse::<u64>().ok());
            let g_m = capture.get(2)?.as_str().parse::<u64>().ok()?;
            let g_s = capture.get(3)?.as_str().parse::<u64>().ok()?;
            Some((full, g_h.unwrap_or(0), g_m, g_s))
        })
        .collect();

    for (full, h, m, s) in loose_hits {
        if !processed.insert(format!("loose:{}", full)) {
            continue;
        }
        let normalized = format!("{:02}:{:02}:{:02}", h, m, s);
        let seconds = (h * 3600 + m * 60 + s) as f64;
        tracing::warn!(
            "[AiNote] 检测到非标准截图占位符 '{}'，按容错规则归一化为 {} 并截图",
            full,
            normalized
        );
        replaced = try_replace_ai_note_placeholder(
            &replaced,
            &full,
            seconds,
            &normalized,
            &screenshots_dir,
            &safe_video_name,
            &note.video_path,
        );
    }

    // 阶段 3: 最终扫尾，清掉所有残留的占位符样式文本
    let final_cleaned = loose_re.replace_all(&replaced, "").to_string();
    Ok(final_cleaned.trim().to_string())
}

/// 截图替换辅助：成功则替换占位符为 Markdown 图片语法，失败则删除占位符避免污染笔记。
fn try_replace_ai_note_placeholder(
    content: &str,
    placeholder: &str,
    seconds: f64,
    timestamp_label: &str,
    screenshots_dir: &Path,
    safe_video_name: &str,
    video_path: &str,
) -> String {
    let filename = format!(
        "{}_ai_note_{}.jpg",
        safe_video_name,
        format_timestamp_for_filename(seconds)
    );
    let screenshot_path = screenshots_dir.join(filename);
    let screenshot_path_str = screenshot_path.to_string_lossy().to_string();

    if !screenshot_path.exists() {
        if let Err(error) = capture_video_screenshot(video_path, seconds, &screenshot_path_str) {
            tracing::warn!("[AiNote] 关键帧截图失败 {}: {}", timestamp_label, error);
            return content.replace(placeholder, "");
        }
    }

    let markdown = build_ai_note_screenshot_markdown(&screenshot_path_str, timestamp_label);
    content.replace(placeholder, &markdown)
}

/// 调用AI API（流式收集，通过ai_pool统一管理并发）
async fn call_ai_api(
    ai_config: &AiConfig,
    prompt: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 通过ai_pool执行请求
    let response = execute_streaming_and_collect(ai_config.clone(), prompt.to_string(), abort_flag).await?;

    // 再次检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    Ok(response)
}

// ============================================================================
// 分层递进生成
// ============================================================================

/// 分层递进生成全文总结
/// 并发控制完全由 AI 线程池管理（ai_pool.rs）
async fn generate_full_summary_layered(
    ai_config: &AiConfig,
    full_subtitle: &str,
    abort_flag: &Arc<AtomicBool>,
    event_name: &str,
    app: &AppHandle,
    custom_prompt: Option<&str>,
    concurrent_limit: usize,
) -> Result<String, String> {
    const CHUNK_MAX_TOKENS: u32 = 768;
    // 分层生成的最终扩写输出较长且可能包含推理时间，放宽总超时；
    // 流式请求本身有 90 秒空闲超时兜底，这里只防极端卡死
    const LAYERED_REQUEST_TIMEOUT: u64 = 600;

    let mut layered_ai_config = ai_config.clone();
    layered_ai_config.request_timeout = LAYERED_REQUEST_TIMEOUT as i32;
    // 将 event_name 转换为 String 以便在异步任务中使用
    let event_name = event_name.to_string();

    let generation_type = if custom_prompt.is_some() { "自定义总结" } else { "全文总结" };
    tracing::info!("[笔记生成] ========================================");
    tracing::info!("[笔记生成] 开始生成: {}", generation_type);
    tracing::info!("[笔记生成] 字幕总长度: {} 字符", full_subtitle.len());
    tracing::info!("[笔记生成] 使用模型: {}", ai_config.model);

    // 第一层：动态分段生成摘要框架（按字数/SEGMENT_SIZE+1计算段数，再均分）
    let chunks = split_subtitle_by_semantic(full_subtitle);
    let total_chunks = chunks.len();

    tracing::info!("[笔记生成] 分段策略: 字数/10000+1 = {} 段", total_chunks);
    for (i, chunk) in chunks.iter().enumerate() {
        tracing::info!("[笔记生成]   段 {}: {} 字符", i + 1, chunk.len());
    }
    tracing::info!("[笔记生成] ========================================");

    // 槽位一空就跑下一段；失败只重试该段，不阻塞其它分段
    let generate_chunk = |chunk_index: usize, chunk: String| {
        let app = app.clone();
        let event_name_for_task = event_name.clone();
        let ai_config = layered_ai_config.clone();
        let abort_flag = abort_flag.clone();
        async move {
            tracing::info!("[笔记生成] 段 {}/{}: 开始执行...", chunk_index + 1, total_chunks);

            if abort_flag.load(Ordering::Relaxed) {
                tracing::info!("[笔记生成] 段 {}/{}: 已中止", chunk_index + 1, total_chunks);
                return Err::<(usize, String), String>("已中止".to_string());
            }

            let _ = app.emit(
                &event_name_for_task,
                GenerationEvent::TabProgress {
                    tab_type: "full_summary".to_string(),
                    current: chunk_index + 1,
                    total: total_chunks + 2,
                    message: format!("生成第 {}/{} 段摘要...", chunk_index + 1, total_chunks),
                },
            );

            let prompt = PromptTemplates::chunk_summary(&chunk);
            let mut last_error = None;
            for attempt in 0..2 {
                if abort_flag.load(Ordering::Relaxed) {
                    return Err("已中止".to_string());
                }
                match execute_streaming_and_collect_with_max_tokens(
                    ai_config.clone(),
                    prompt.clone(),
                    &abort_flag,
                    Some(CHUNK_MAX_TOKENS),
                )
                .await
                {
                    Ok(summary) => {
                        tracing::info!(
                            "[笔记生成] 段 {}/{}: 完成 (生成 {} 字符)",
                            chunk_index + 1,
                            total_chunks,
                            summary.len()
                        );
                        return Ok((chunk_index, summary));
                    }
                    Err(e) => {
                        if is_abort_error(&e) {
                            return Err(e);
                        }
                        tracing::warn!(
                            "[笔记生成] 段 {}/{}: {}失败 - {}",
                            chunk_index + 1,
                            total_chunks,
                            if attempt == 0 { "第1次" } else { "重试仍" },
                            e
                        );
                        last_error = Some(e);
                    }
                }
            }
            Err(last_error.unwrap_or_else(|| "分段摘要生成失败".to_string()))
        }
    };

    let task_concurrency = clamp_concurrent_limit(concurrent_limit).min(total_chunks.max(1));
    let mut chunk_summaries: Vec<Option<String>> = vec![None; total_chunks];
    let mut stream = stream::iter(chunks.into_iter().enumerate())
        .map(|(chunk_index, chunk)| generate_chunk(chunk_index, chunk))
        .buffer_unordered(task_concurrency);

    while let Some(result) = stream.next().await {
        if abort_flag.load(Ordering::Relaxed) {
            break;
        }
        match result {
            Ok((chunk_index, summary)) => {
                chunk_summaries[chunk_index] = Some(summary);
            }
            Err(e) => {
                if is_abort_error(&e) {
                    break;
                }
            }
        }
    }

    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    let success_count = chunk_summaries.iter().filter(|s| s.is_some()).count();
    let failed_count = total_chunks - success_count;
    tracing::info!("[笔记生成] 分段生成完成: 成功 {}, 失败 {}", success_count, failed_count);

    // 至少要有一个分段成功，否则无法整合框架
    if success_count == 0 {
        return Err("所有分段摘要均生成失败，请检查模型配置和网络后重试".to_string());
    }

    if failed_count > 0 {
        tracing::warn!("[笔记生成] {} 个分段跳过，将基于剩余分段继续生成", failed_count);
    }

    // 按原始顺序拼接成功的分段摘要（失败的段以占位提示替代，保持分段顺序完整）
    let chunk_summaries: Vec<String> = chunk_summaries
        .into_iter()
        .enumerate()
        .map(|(i, s)| s.unwrap_or_else(|| format!("（第 {} 段内容生成失败，已跳过）", i + 1)))
        .collect();

    // 合并得到框架摘要
    let framework_prompt = format!(
        "以下是视频各片段的摘要，请整合成一份连贯的整体摘要框架（1000字以内）：\n\n{}",
        chunk_summaries.join("\n\n---\n\n")
    );

    tracing::info!("[笔记生成] 开始整合摘要框架...");
    // 发送进度事件
    let _ = app.emit(
        &event_name,
        GenerationEvent::TabProgress {
            tab_type: "full_summary".to_string(),
            current: total_chunks + 1,
            total: total_chunks + 2,
            message: "整合整体框架...".to_string(),
        },
    );

    let framework = call_ai_api(&layered_ai_config, &framework_prompt, abort_flag).await?;
    tracing::info!("[笔记生成] 框架整合完成 (生成 {} 字符)", framework.len());

    // 第二层：基于框架生成完整的结构化全文总结
    let final_prompt = if let Some(custom) = custom_prompt {
        // 使用自定义提示词生成最终总结
        format!("{}\n\n请基于以下框架生成完整总结：\n{}", custom, framework)
    } else {
        PromptTemplates::framework_expand(&framework)
    };

    tracing::info!("[笔记生成] 开始生成最终总结...");
    // 发送进度事件
    let _ = app.emit(
        &event_name,
        GenerationEvent::TabProgress {
            tab_type: "full_summary".to_string(),
            current: total_chunks + 2,
            total: total_chunks + 2,
            message: "生成完整全文总结...".to_string(),
        },
    );

    let final_content = call_ai_api(&layered_ai_config, &final_prompt, abort_flag).await?;
    tracing::info!("[笔记生成] 最终总结完成 (生成 {} 字符)", final_content.len());
    tracing::info!("[笔记生成] ========================================");

    // 直接返回 Markdown 内容（不再验证 JSON 格式）
    Ok(final_content)
}

// ============================================================================
// 原文细读章节生成（非辅助模式）
// ============================================================================

/// 生成章节内容的提示词（用于原文细读）
fn build_detailed_reading_chapter_prompt(subtitle_text: &str) -> String {
    format!(
        r#"你是一个专业的视频内容分析师。请为以下视频字幕片段生成章节标题和内容摘要。

**输出要求**：
1. 必须输出有效的 JSON 格式（不要使用代码块标记）
2. 标题应简洁明了，概括该段落的核心主题（10-20字）
3. 内容摘要应简明扼要地描述该段落的主要内容（50-100字）

**输出格式**：
{{
  "title": "章节标题",
  "content": "章节内容摘要"
}}

**视频字幕片段**：
{}"#,
        subtitle_text
    )
}

/// 解析章节内容 AI 响应（用于原文细读）
fn parse_detailed_reading_chapter_response(response: &str) -> Result<(String, String), String> {
    // 提取 JSON（可能有代码块标记）
    let json_str = if let Some(start) = response.find("```json") {
        let start = start + 7;
        if let Some(end) = response[start..].find("```") {
            &response[start..start + end]
        } else {
            response
        }
    } else if let Some(start) = response.find("```") {
        let start = start + 3;
        if let Some(end) = response[start..].find("```") {
            &response[start..start + end]
        } else {
            response
        }
    } else {
        response
    };

    #[derive(Deserialize)]
    struct ChapterContentResponse {
        title: String,
        content: String,
    }

    // AI 有时会一次输出多个 JSON 对象（标题重复生成），逐个尝试解析取第一个有效对象
    let mut start = match json_str.find('{') {
        Some(pos) => pos,
        None => return Err("未找到有效的JSON响应".to_string()),
    };
    while start < json_str.len() {
        // 逐层匹配与 start 对应的闭合 }（跳过字符串内的花括号）
        let bytes = json_str.as_bytes();
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        let mut end = None;
        for (i, &b) in bytes.iter().enumerate().skip(start) {
            if escaped {
                escaped = false;
                continue;
            }
            match b {
                b'\\' if in_string => escaped = true,
                b'"' => in_string = !in_string,
                b'{' if !in_string => depth += 1,
                b'}' if !in_string => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        end = Some(i);
                        break;
                    }
                }
                _ => {}
            }
        }

        let end = match end {
            Some(pos) => pos,
            None => break,
        };

        if let Ok(parsed) = serde_json::from_str::<ChapterContentResponse>(&json_str[start..=end]) {
            return Ok((parsed.title, parsed.content));
        }

        // 该对象解析失败，尝试下一个 { 开始的对象
        start += 1;
        match json_str[start..].find('{') {
            Some(offset) => start += offset,
            None => break,
        }
    }

    Err("未找到有效的JSON响应".to_string())
}

// ============================================================================
// 标题优化（层级化）
// ============================================================================

/// 优化后的章节信息
#[derive(Debug, Deserialize)]
struct OptimizedChapter {
    /// 原始章节索引（从0开始）
    index: usize,
    /// 优化后的标题
    title: String,
    /// 层级深度 (1 = 顶级, 2 = 子章节)
    level: u32,
    /// 父章节索引（如果是子章节）
    #[serde(default)]
    parent_index: Option<usize>,
}

/// AI 标题优化响应
#[derive(Debug, Deserialize)]
struct TitleOptimizationResponse {
    chapters: Vec<OptimizedChapter>,
}

/// 构建标题优化提示词
fn build_title_optimization_prompt(chapters: &[Chapter]) -> String {
    // 构建章节列表 JSON
    let chapters_json: Vec<serde_json::Value> = chapters
        .iter()
        .enumerate()
        .map(|(idx, ch)| {
            serde_json::json!({
                "index": idx,
                "title": ch.title,
                "content": ch.content
            })
        })
        .collect();

    let chapters_str = serde_json::to_string_pretty(&chapters_json).unwrap_or_default();

    format!(
        r#"你是一个专业的内容编辑。请优化以下视频章节的标题，确保标题风格统一、层次分明。

**任务要求**：
1. **标题统一性**：所有标题应采用一致的命名风格（如都用动宾结构或名词短语）
2. **层级识别**：识别章节之间的逻辑关系，将相关的细节章节归类到主题章节下
   - level=1 表示主题章节（顶级）
   - level=2 表示子章节（属于某个主题）
3. **标题精炼**：标题应简洁有力，10-20字为宜
4. **保持原意**：优化标题但不改变原有内容的含义

**输出要求**：
- 必须输出有效的 JSON 格式（不要使用代码块标记）
- 每个章节必须包含 index（原始索引）、title（优化后标题）、level（层级）
- 如果是子章节（level=2），需要提供 parent_index（父章节的索引）

**输出格式**：
{{
  "chapters": [
    {{"index": 0, "title": "优化后的标题", "level": 1}},
    {{"index": 1, "title": "优化后的子标题", "level": 2, "parent_index": 0}},
    ...
  ]
}}

**章节列表**：
{}"#,
        chapters_str
    )
}

/// 解析标题优化响应
fn parse_title_optimization_response(response: &str) -> Result<TitleOptimizationResponse, String> {
    // 尝试提取 JSON（可能有代码块标记）
    let json_str = if let Some(start) = response.find("```json") {
        let start = start + 7;
        if let Some(end) = response[start..].find("```") {
            &response[start..start + end]
        } else {
            response
        }
    } else if let Some(start) = response.find("```") {
        let start = start + 3;
        if let Some(end) = response[start..].find("```") {
            &response[start..start + end]
        } else {
            response
        }
    } else {
        response
    };

    // 尝试找到第一个 { 和最后一个 }
    let json_start = json_str.find('{').unwrap_or(0);
    let json_end = json_str.rfind('}').unwrap_or(json_str.len());

    if json_start >= json_end {
        return Err("未找到有效的JSON响应".to_string());
    }

    let clean_json = &json_str[json_start..=json_end];

    serde_json::from_str(clean_json)
        .map_err(|e| format!("JSON解析失败: {}, JSON内容: {}", e, clean_json))
}

/// 优化章节标题（添加层级信息）
async fn optimize_chapter_titles(
    ai_config: &AiConfig,
    chapters: &mut Vec<Chapter>,
    abort_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    if chapters.is_empty() {
        return Ok(());
    }

    tracing::info!("[标题优化] 开始优化 {} 个章节的标题", chapters.len());

    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 构建提示词
    let prompt = build_title_optimization_prompt(chapters);

    // 调用 AI
    let response = execute_streaming_and_collect(ai_config.clone(), prompt, abort_flag).await?;

    // 解析响应
    match parse_title_optimization_response(&response) {
        Ok(optimized) => {
            // 创建 ID 映射（index -> chapter id）
            let id_map: Vec<String> = chapters.iter().map(|ch| ch.id.clone()).collect();

            // 应用优化结果
            for opt_ch in optimized.chapters {
                if opt_ch.index < chapters.len() {
                    let chapter = &mut chapters[opt_ch.index];
                    chapter.title = opt_ch.title;
                    chapter.level = Some(opt_ch.level);

                    // 设置父章节 ID
                    if let Some(parent_idx) = opt_ch.parent_index {
                        if parent_idx < id_map.len() {
                            chapter.parent_id = Some(id_map[parent_idx].clone());
                        }
                    }

                    tracing::info!(
                        "[标题优化] 章节 {}: \"{}\" (level={}, parent={:?})",
                        opt_ch.index,
                        chapter.title,
                        opt_ch.level,
                        chapter.parent_id
                    );
                }
            }

            tracing::info!("[标题优化] 标题优化完成");
            Ok(())
        }
        Err(e) => {
            tracing::warn!("[标题优化] 解析失败，保持原标题: {}", e);
            // 解析失败时，为所有章节设置默认层级
            for chapter in chapters.iter_mut() {
                chapter.level = Some(1);
                chapter.parent_id = None;
            }
            Ok(())
        }
    }
}

/// 生成原文细读章节数据（非辅助模式）
///
/// 该函数优先使用 AI 智能分段字幕，然后为每个分段生成标题和内容摘要，并截图。
/// 当智能分段失败时回退到 chunk 分段兜底，最终输出 DetailedReadingData。
pub async fn generate_detailed_reading_chapters(
    app: &AppHandle,
    event_name: &str,
    ai_config: &AiConfig,
    subtitle_entries: &[SubtitleEntry],
    video_path: &str,
    note_id: &str,
    abort_flag: &Arc<AtomicBool>,
    concurrent_limit: usize,
) -> Result<DetailedReadingData, String> {
    tracing::info!("[原文细读] ========================================");
    tracing::info!("[原文细读] 开始生成章节数据");
    tracing::info!("[原文细读] 字幕总条数: {}", subtitle_entries.len());
    tracing::info!("[原文细读] 使用模型: {}", ai_config.model);

    if subtitle_entries.is_empty() {
        return Err("字幕内容为空".to_string());
    }

    // 计算总时长
    let total_duration = subtitle_entries.last().map(|e| e.end_time).unwrap_or(0.0);

    // 第一步：使用 chapter.rs 的智能分段能力
    let _ = app.emit(
        event_name,
        GenerationEvent::TabProgress {
            tab_type: "DetailedReading".to_string(),
            current: 1,
            total: 3,
            message: "AI正在分析字幕结构...".to_string(),
        },
    );

    let planned_segments: Vec<(usize, usize)> = match analyze_subtitle_for_chapters(
        ai_config,
        subtitle_entries,
        abort_flag,
        app,
        event_name,
    ).await {
        Ok(ai_chapters) if !ai_chapters.is_empty() => {
            let total_entries = subtitle_entries.len();
            let mut starts = ai_chapters
                .iter()
                .map(|c| c.start_index)
                .filter(|&idx| idx < total_entries)
                .collect::<Vec<_>>();
            starts.push(0);
            starts.sort_unstable();
            starts.dedup();

            let mut segments = Vec::new();
            for i in 0..starts.len() {
                let start = starts[i];
                let end = if i + 1 < starts.len() {
                    starts[i + 1]
                } else {
                    total_entries
                };
                if end > start {
                    segments.push((start, end));
                }
            }

            if segments.is_empty() {
                split_subtitle_into_chunks(subtitle_entries)
                    .into_iter()
                    .map(|c| (c.start_index, c.end_index))
                    .collect()
            } else {
                segments
            }
        }
        Ok(_) => split_subtitle_into_chunks(subtitle_entries)
            .into_iter()
            .map(|c| (c.start_index, c.end_index))
            .collect(),
        Err(e) => {
            tracing::warn!("[原文细读] 智能分段失败，回退 chunk 分段: {}", e);
            split_subtitle_into_chunks(subtitle_entries)
                .into_iter()
                .map(|c| (c.start_index, c.end_index))
                .collect()
        }
    };

    if planned_segments.is_empty() {
        return Err("未能生成任何章节".to_string());
    }

    tracing::info!("[原文细读] 分段数: {}", planned_segments.len());

    // 第二步：信号量流水线生成章节内容。单段失败只重试该段，成功段立即可见。
    // 标题优化（原第四步）对原文细读无收益：DetailedReadingChapter 不含 level，故跳过。
    let total_chunks = planned_segments.len();
    let task_concurrency = clamp_concurrent_limit(concurrent_limit).min(total_chunks.max(1));
    let screenshots_dir = storage_paths::chapter_screenshots_dir(app, note_id)?;
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;
    let video_name = Path::new(video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let safe_video_name = sanitize_filename(video_name);
    let model_id = ai_config.id.clone();

    let slots = std::sync::Arc::new(std::sync::Mutex::new(vec![None; total_chunks]));
    let screenshot_sem = std::sync::Arc::new(Semaphore::new(4));
    let mut screenshot_set = tokio::task::JoinSet::new();
    let mut success_count = 0usize;
    let mut aborted = false;
    let mut last_persist_at = Instant::now() - DETAILED_READING_DB_DEBOUNCE;

    let mut ai_stream = stream::iter(planned_segments.into_iter().enumerate()).map(
        |(chunk_idx, (start_index, end_index))| {
            let ai_config = ai_config.clone();
            let abort_flag = abort_flag.clone();
            let app = app.clone();
            let event_name = event_name.to_string();
            let safe_start = start_index.min(subtitle_entries.len().saturating_sub(1));
            let safe_end = end_index.min(subtitle_entries.len());
            let segment_entries = if safe_end > safe_start {
                subtitle_entries[safe_start..safe_end].to_vec()
            } else {
                Vec::new()
            };
            async move {
                if abort_flag.load(Ordering::Relaxed) {
                    return Err("已中止".to_string());
                }
                if segment_entries.is_empty() {
                    return Ok((
                        chunk_idx,
                        format!("章节 {}", chunk_idx + 1),
                        "该段字幕为空".to_string(),
                        0.0,
                        0.0,
                        false,
                    ));
                }

                tracing::info!(
                    "[原文细读] 处理第 {}/{} 段，字幕索引范围: [{}, {})",
                    chunk_idx + 1,
                    total_chunks,
                    safe_start,
                    safe_end
                );

                let _ = app.emit(
                    &event_name,
                    GenerationEvent::TabProgress {
                        tab_type: "DetailedReading".to_string(),
                        current: chunk_idx + 1,
                        total: total_chunks + 1,
                        message: format!("AI正在生成第 {}/{} 章节内容...", chunk_idx + 1, total_chunks),
                    },
                );

                let start_time = segment_entries[0].start_time;
                let end_time = segment_entries
                    .last()
                    .map(|e| e.end_time)
                    .unwrap_or(start_time);
                let subtitle_text: String = segment_entries
                    .iter()
                    .map(|e| e.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                let prompt = build_detailed_reading_chapter_prompt(&subtitle_text);
                let mut last_error = None;

                for attempt in 0..2 {
                    if abort_flag.load(Ordering::Relaxed) {
                        return Err("已中止".to_string());
                    }
                    match execute_streaming_and_collect(ai_config.clone(), prompt.clone(), &abort_flag)
                        .await
                    {
                        Ok(response) => match parse_detailed_reading_chapter_response(&response) {
                            Ok((title, content)) => {
                                return Ok((chunk_idx, title, content, start_time, end_time, true));
                            }
                            Err(e) => last_error = Some(e),
                        },
                        Err(e) => {
                            if is_abort_error(&e) {
                                return Err(e);
                            }
                            last_error = Some(e);
                        }
                    }
                    if attempt == 0 {
                        tracing::warn!(
                            "[原文细读] 第 {} 段失败，重试一次: {}",
                            chunk_idx + 1,
                            last_error.as_deref().unwrap_or("")
                        );
                    }
                }

                tracing::error!(
                    "[原文细读] 第 {} 段最终失败: {}",
                    chunk_idx + 1,
                    last_error.as_deref().unwrap_or("未知错误")
                );
                Ok((
                    chunk_idx,
                    format!("章节 {}", chunk_idx + 1),
                    fallback_chapter_content(&subtitle_text),
                    start_time,
                    end_time,
                    false,
                ))
            }
        },
    )
    .buffer_unordered(task_concurrency);

    let mut ai_done = false;
    loop {
        if abort_flag.load(Ordering::Relaxed) {
            aborted = true;
            screenshot_set.abort_all();
            break;
        }

        tokio::select! {
            maybe_ai = ai_stream.next(), if !ai_done => {
                match maybe_ai {
                    Some(Ok((chunk_idx, title, content, start_time, end_time, succeeded))) => {
                        if succeeded {
                            success_count += 1;
                        }
                        let chapter = DetailedReadingChapter {
                            id: uuid::Uuid::new_v4().to_string(),
                            title,
                            start_time,
                            end_time,
                            content: Some(content),
                            subtitle_entries: Vec::new(),
                            screenshot_path: None,
                        };
                        {
                            let mut guard = slots.lock().unwrap();
                            guard[chunk_idx] = Some(chapter.clone());
                        }
                        emit_detailed_reading_chapter_partial(
                            app,
                            event_name,
                            chunk_idx,
                            total_chunks,
                            &chapter,
                            total_duration,
                        );
                        let data = {
                            let guard = slots.lock().unwrap();
                            snapshot_completed_chapters(&guard, total_duration)
                        };
                        persist_detailed_reading_snapshot_if_due(
                            &mut last_persist_at,
                            false,
                            note_id,
                            &model_id,
                            &data,
                        );

                        let sem = screenshot_sem.clone();
                        let abort = abort_flag.clone();
                        let vp = video_path.to_string();
                        let screenshot_filename = format!(
                            "{}_{}.jpg",
                            safe_video_name,
                            format_timestamp_for_filename(start_time)
                        );
                        let screenshot_path = screenshots_dir.join(&screenshot_filename);
                        let screenshot_path_str = screenshot_path.to_string_lossy().to_string();
                        screenshot_set.spawn(async move {
                            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
                            if abort.load(Ordering::Relaxed) {
                                return Err::<(usize, Option<String>), String>("已中止".to_string());
                            }
                            let captured = tokio::task::spawn_blocking(move || {
                                capture_video_screenshot(&vp, start_time, &screenshot_path_str)
                            })
                            .await;
                            match captured {
                                Ok(Ok(_)) => {
                                    tracing::info!(
                                        "[原文细读] 第 {}/{} 章截图成功: {}",
                                        chunk_idx + 1,
                                        total_chunks,
                                        screenshot_filename
                                    );
                                    Ok((chunk_idx, Some(screenshot_path.to_string_lossy().to_string())))
                                }
                                Ok(Err(e)) => {
                                    tracing::error!(
                                        "[原文细读] 第 {}/{} 章截图失败: {}",
                                        chunk_idx + 1,
                                        total_chunks,
                                        e
                                    );
                                    Ok((chunk_idx, None))
                                }
                                Err(e) => {
                                    tracing::error!(
                                        "[原文细读] 第 {}/{} 章截图任务异常: {}",
                                        chunk_idx + 1,
                                        total_chunks,
                                        e
                                    );
                                    Ok((chunk_idx, None))
                                }
                            }
                        });
                    }
                    Some(Err(e)) => {
                        if is_abort_error(&e) {
                            aborted = true;
                            screenshot_set.abort_all();
                            break;
                        }
                        tracing::error!("[原文细读] 分段任务失败: {}", e);
                    }
                    None => {
                        ai_done = true;
                    }
                }
            }
            maybe_shot = screenshot_set.join_next(), if !screenshot_set.is_empty() => {
                match maybe_shot {
                    Some(Ok(Ok((chunk_idx, Some(path))))) => {
                        let updated = {
                            let mut guard = slots.lock().unwrap();
                            if let Some(chapter) = guard[chunk_idx].as_mut() {
                                chapter.screenshot_path = Some(path);
                                Some(chapter.clone())
                            } else {
                                None
                            }
                        };
                        if let Some(chapter) = updated {
                            emit_detailed_reading_chapter_partial(
                                app,
                                event_name,
                                chunk_idx,
                                total_chunks,
                                &chapter,
                                total_duration,
                            );
                            let data = {
                                let guard = slots.lock().unwrap();
                                snapshot_completed_chapters(&guard, total_duration)
                            };
                            persist_detailed_reading_snapshot_if_due(
                                &mut last_persist_at,
                                false,
                                note_id,
                                &model_id,
                                &data,
                            );
                        }
                    }
                    Some(Ok(Err(e))) if is_abort_error(&e) => {
                        aborted = true;
                        screenshot_set.abort_all();
                        break;
                    }
                    Some(Err(e)) => {
                        tracing::error!("[原文细读] 截图任务异常: {}", e);
                    }
                    _ => {}
                }
            }
            else => break,
        }
    }

    if aborted || abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    if success_count == 0 {
        return Err("所有章节均生成失败，请检查模型配置和网络后重试".to_string());
    }

    let detailed_chapters = {
        let guard = slots.lock().unwrap();
        guard.iter().flatten().cloned().collect::<Vec<_>>()
    };
    let detailed_data = DetailedReadingData {
        chapters: detailed_chapters.clone(),
        total_duration,
        generated_at: chrono::Local::now().to_rfc3339(),
    };
    persist_detailed_reading_snapshot_if_due(
        &mut last_persist_at,
        true,
        note_id,
        &model_id,
        &detailed_data,
    );

    tracing::info!("[原文细读] ========================================");
    tracing::info!("[原文细读] 生成的章节数: {} (成功 {} 段)", detailed_chapters.len(), success_count);

    Ok(detailed_data)
}

// ============================================================================
// 主生成函数
// ============================================================================

/// 早期失败通知：生成尚未进入标签页阶段就失败时，补发 TabError + AllCompleted，
/// 让前端能复位 regeneratingTabs，避免 UI 永久卡在"生成中"
fn emit_early_failure(app: &AppHandle, event_name: &str, first_tab: &str, error: &str) {
    tracing::error!("[笔记生成] 生成启动失败: {}", error);
    let _ = app.emit(
        event_name,
        GenerationEvent::TabError {
            tab_type: first_tab.to_string(),
            error: error.to_string(),
        },
    );
    let _ = app.emit(
        event_name,
        GenerationEvent::AllCompleted {
            generated: 0,
            failed: 1,
            total: 1,
        },
    );
}

async fn generate_note_internal(
    app: AppHandle,
    db: &Database,
    generation_id: String,
    request: GenerateNoteRequest,
    abort_flag: Arc<AtomicBool>,
    cleanup_owned_abort_flag: bool,
) -> Result<(), String> {
    let event_name = format!("note-generation-{}", generation_id);

    // 早期失败统一补发事件，让前端能复位状态
    macro_rules! early_fail {
        ($err:expr) => {{
            let err: String = ($err).to_string();
            emit_early_failure(&app, &event_name, "full_summary", &err);
            return Err(err);
        }};
    }

    // 获取AI配置
    let ai_config = match db.get_ai_config_by_id(&request.model_id) {
        Ok(Some(config)) => config,
        Ok(None) => early_fail!("AI模型未找到"),
        Err(e) => early_fail!(e.to_string()),
    };

    // 获取笔记
    let note = match db.get_note_by_id(&request.note_id) {
        Ok(Some(note)) => note,
        Ok(None) => early_fail!("笔记未找到"),
        Err(e) => early_fail!(e.to_string()),
    };

    // 检查字幕
    let subtitle_path = match note.subtitle_path.clone() {
        Some(path) => path,
        None => early_fail!("未上传字幕文件，无法生成笔记"),
    };

    // 解析字幕
    let entries = match parse_subtitle_file(&subtitle_path) {
        Ok(entries) => entries,
        Err(e) => early_fail!(format!("字幕解析失败: {}", e)),
    };
    if entries.is_empty() {
        early_fail!("字幕内容为空");
    }

    // 合并字幕文本
    let subtitle_text: String = entries
        .iter()
        .map(|e| e.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let ai_note_transcript = build_ai_note_transcript(&entries);

    // 确定要生成的标签页
    // 如果用户指定了要生成的标签页，则使用用户指定的；否则使用默认的全文总结
    let tabs_to_generate = if request.options.tabs_to_generate.is_empty() {
        vec![
            TabType::FullSummary,
            // TabType::DetailedReading,
            // TabType::Highlights,
            // TabType::VisualSummary,
            // TabType::CustomSummary,
        ]
    } else {
        // 使用用户指定的标签页
        request.options.tabs_to_generate
    };

    // 检查是否需要重新生成
    let tabs_to_generate: Vec<_> = if request.options.regenerate {
        tabs_to_generate
    } else {
        tabs_to_generate
            .into_iter()
            .filter(|tab| {
                let has_content = match tab {
                    TabType::FullSummary => note.full_summary.is_some(),
                    TabType::DetailedReading => note.detailed_reading.is_some(),
                    TabType::Highlights => note.highlights.is_some(),
                    TabType::VisualSummary => note.visual_summary.is_some(),
                    TabType::CustomSummary => note.custom_summary.is_some(),
                    TabType::AiNote => note.ai_note_markdown.is_some(),
                };
                !has_content
            })
            .collect()
    };

    if tabs_to_generate.is_empty() {
        let _ = app.emit(
            &event_name,
            GenerationEvent::AllCompleted {
                generated: 0,
                failed: 0,
                total: 0,
            },
        );
        if cleanup_owned_abort_flag {
            cleanup_abort_flag(&generation_id).await;
        }
        return Ok(());
    }

    // 发送开始事件
    let _ = app.emit(
        &event_name,
        GenerationEvent::Starting {
            total_tabs: tabs_to_generate.len(),
            tabs_to_generate: tabs_to_generate.iter().map(|t| format!("{:?}", t)).collect(),
        },
    );

    // 获取模型上下文大小
    let model_context_size = get_model_context_size(&ai_config.model);

    let mut generated_count = 0;
    let mut failed_count = 0;
    let mut first_error: Option<String> = None;

    // 按顺序串行生成所有标签页（当 concurrent_limit = 1 时）
    if request.options.concurrent_limit == 1 {
        // 生成中文任务名称列表用于日志
        let tab_names: Vec<&str> = tabs_to_generate.iter().map(|t| match t {
            TabType::FullSummary => "全文总结",
            TabType::DetailedReading => "原文细读",
            TabType::Highlights => "高光笔记",
            TabType::VisualSummary => "视觉化总结",
            TabType::CustomSummary => "自定义总结",
            TabType::AiNote => "大纲笔记",
        }).collect();
        tracing::info!("[笔记生成] 开始串行生成，标签页顺序: {:?}", tab_names);
        for tab_type in &tabs_to_generate {
            let tab_name = get_tab_name(tab_type);
            tracing::info!("[笔记生成] 开始处理标签页: {}", tab_name);

            // 检查是否被中止
            if abort_flag.load(Ordering::Relaxed) {
                let _ = app.emit(&event_name, GenerationEvent::Aborted {
                    reason: "用户中止".to_string(),
                });
                if cleanup_owned_abort_flag {
                    cleanup_abort_flag(&generation_id).await;
                }
                return Err("生成已中止".to_string());
            }

            let tab_name = get_tab_name(tab_type);

            // 根据标签页类型选择生成方法
            if *tab_type == TabType::DetailedReading {
                // 原文细读：生成章节数据
                // 发送开始事件（DetailedReading 需要手动发送，因为不调用 generate_single_tab）
                let _ = app.emit(
                    &event_name,
                    GenerationEvent::TabStarted {
                        tab_type: format!("{:?}", tab_type),
                        tab_name: tab_name.clone(),
                    },
                );

                // 使用统一的 DetailedReadingData 生成链路
                match generate_detailed_reading_chapters(
                    &app,
                    &event_name,
                    &ai_config,
                    &entries,
                    &note.video_path,
                    &request.note_id,
                    &abort_flag,
                    request.options.concurrent_limit,
                ).await {
                    Ok(chapter_data) => {
                        tracing::info!("[笔记生成] {:?} 生成完成", tab_type);
                        let content = match serde_json::to_string(&chapter_data) {
                            Ok(c) => c,
                            Err(e) => {
                                let err = format!("序列化章节数据失败: {}", e);
                                tracing::error!("[笔记生成] {}", err);
                                let _ = app.emit(
                                    &event_name,
                                    GenerationEvent::TabError {
                                        tab_type: format!("{:?}", tab_type),
                                        error: err.clone(),
                                    },
                                );
                                if first_error.is_none() {
                                    first_error = Some(err.clone());
                                }
                                failed_count += 1;
                                continue;
                            }
                        };
                        if let Err(e) = update_note_tab(
                            db,
                            &request.note_id,
                            tab_type,
                            &content,
                            &request.model_id,
                            request.options.style.as_deref(),
                            request.options.custom_prompt.as_deref(),
                            request.options.screenshot_density.as_deref(),
                        ) {
                            tracing::error!("[笔记生成] 更新数据库失败: {}", e);
                            let err = format!("更新数据库失败: {}", e);
                            let _ = app.emit(
                                &event_name,
                                GenerationEvent::TabError {
                                    tab_type: format!("{:?}", tab_type),
                                    error: err.clone(),
                                },
                            );
                            if first_error.is_none() {
                                first_error = Some(err);
                            }
                            failed_count += 1;
                            continue;
                        }
                        let _ = app.emit(
                            &event_name,
                            GenerationEvent::TabCompleted {
                                tab_type: format!("{:?}", tab_type),
                                content,
                            },
                        );
                        generated_count += 1;
                    }
                    Err(e) => {
                        tracing::warn!("[笔记生成] {:?} 生成失败: {}", tab_type, e);
                        if first_error.is_none() {
                            first_error = Some(e.clone());
                        }
                        let _ = app.emit(
                            &event_name,
                            GenerationEvent::TabError {
                                tab_type: format!("{:?}", tab_type),
                                error: e,
                            },
                        );
                        failed_count += 1;
                    }
                }
            } else {
                // 其他标签页：生成文本内容
                let current_subtitle_text = if matches!(tab_type, TabType::AiNote) {
                    ai_note_transcript.as_str()
                } else {
                    subtitle_text.as_str()
                };
                let result = generate_single_tab(
                    &app,
                    &event_name,
                    tab_type,
                    &ai_config,
                    &note,
                    current_subtitle_text,
                    &abort_flag,
                    model_context_size,
                    request.options.concurrent_limit,
                    tab_name,
                    request.options.style.as_deref(),
                    request.options.custom_prompt.as_deref(),
                    request.options.screenshot_density.as_deref(),
                ).await;

                tracing::info!("[笔记生成] {:?} 生成结果: success={}", tab_type, result.success);

                if result.success {
                    generated_count += 1;
                    if let Err(e) = update_note_tab(
                        db,
                        &request.note_id,
                        tab_type,
                        &result.content,
                        &request.model_id,
                        request.options.style.as_deref(),
                        request.options.custom_prompt.as_deref(),
                        request.options.screenshot_density.as_deref(),
                    ) {
                        tracing::error!("[笔记生成] 更新数据库失败: {}", e);
                        if first_error.is_none() {
                            first_error = Some(format!("更新数据库失败: {}", e));
                        }
                        failed_count += 1;
                    }
                } else {
                    if first_error.is_none() {
                        first_error = result.error.clone();
                    }
                    failed_count += 1;
                }
            }
        }
    } else {
        // 并发生成（保留原有逻辑）
        // 分离 DetailedReading 和其他标签页（DetailedReading 需要特殊处理）
        let has_detailed_reading = tabs_to_generate.contains(&TabType::DetailedReading);
        let other_tabs: Vec<TabType> = tabs_to_generate
            .iter()
            .filter(|t| **t != TabType::DetailedReading)
            .copied()
            .collect();

        // 原文细读与其它标签页并行：细读内部走模型池限流，不再独占整段临界路径
        let detailed_handle = if has_detailed_reading {
            let _ = app.emit(
                &event_name,
                GenerationEvent::TabStarted {
                    tab_type: "DetailedReading".to_string(),
                    tab_name: "原文细读".to_string(),
                },
            );
            let app = app.clone();
            let event_name = event_name.clone();
            let ai_config = ai_config.clone();
            let entries = entries.clone();
            let video_path = note.video_path.clone();
            let note_id = request.note_id.clone();
            let abort_flag = abort_flag.clone();
            let concurrent_limit = request.options.concurrent_limit;
            Some(tokio::spawn(async move {
                generate_detailed_reading_chapters(
                    &app,
                    &event_name,
                    &ai_config,
                    &entries,
                    &video_path,
                    &note_id,
                    &abort_flag,
                    concurrent_limit,
                )
                .await
            }))
        } else {
            None
        };

        if !other_tabs.is_empty() {
            let semaphore = Arc::new(Semaphore::new(clamp_concurrent_limit(request.options.concurrent_limit)));
            let mut tasks = Vec::new();

            for tab_type in other_tabs {
                let semaphore = semaphore.clone();
                let app = app.clone();
                let event_name = event_name.clone();
                let ai_config = ai_config.clone();
                let note = note.clone();
                let subtitle_text = if tab_type == TabType::AiNote {
                    ai_note_transcript.clone()
                } else {
                    subtitle_text.clone()
                };
                let abort_flag = abort_flag.clone();
                let tab_name = get_tab_name(&tab_type);
                let style = request.options.style.clone();
                let custom_prompt = request.options.custom_prompt.clone();
                let screenshot_density = request.options.screenshot_density.clone();
                let concurrent_limit = request.options.concurrent_limit;

                let task = tokio::spawn(async move {
                    let _permit = match semaphore.acquire().await {
                        Ok(permit) => permit,
                        Err(e) => {
                            tracing::error!("[笔记生成] 获取信号量失败: {}", e);
                            return TabResult {
                                tab_type,
                                content: String::new(),
                                success: false,
                                error: Some(format!("获取信号量失败: {}", e)),
                            };
                        }
                    };

                    generate_single_tab(
                        &app,
                        &event_name,
                        &tab_type,
                        &ai_config,
                        &note,
                        &subtitle_text,
                        &abort_flag,
                        model_context_size,
                        concurrent_limit,
                        tab_name,
                        style.as_deref(),
                        custom_prompt.as_deref(),
                        screenshot_density.as_deref(),
                    ).await
                });

                tasks.push(task);
            }

            for task in tasks {
                match task.await {
                    Ok(result) => {
                        if result.success {
                            generated_count += 1;
                            if let Err(e) = update_note_tab(
                                db,
                                &request.note_id,
                                &result.tab_type,
                                &result.content,
                                &request.model_id,
                                request.options.style.as_deref(),
                                request.options.custom_prompt.as_deref(),
                                request.options.screenshot_density.as_deref(),
                            ) {
                                tracing::error!("[笔记生成] 更新数据库失败: {}", e);
                                if first_error.is_none() {
                                    first_error = Some(format!("更新数据库失败: {}", e));
                                }
                                failed_count += 1;
                            }
                        } else {
                            if first_error.is_none() {
                                first_error = result.error.clone();
                            }
                            failed_count += 1;
                        }
                    }
                    Err(e) => {
                        tracing::error!("[笔记生成] 任务执行异常: {}", e);
                        if first_error.is_none() {
                            first_error = Some(format!("任务执行异常: {}", e));
                        }
                        failed_count += 1;
                    }
                }
            }
        }

        if let Some(handle) = detailed_handle {
            match handle.await {
                Ok(Ok(chapter_data)) => {
                    match serde_json::to_string(&chapter_data) {
                        Ok(content) => {
                            if let Err(e) = update_note_tab(
                                db,
                                &request.note_id,
                                &TabType::DetailedReading,
                                &content,
                                &request.model_id,
                                request.options.style.as_deref(),
                                request.options.custom_prompt.as_deref(),
                                request.options.screenshot_density.as_deref(),
                            ) {
                                tracing::error!("[笔记生成] 更新数据库失败: {}", e);
                                let err = format!("更新数据库失败: {}", e);
                                let _ = app.emit(
                                    &event_name,
                                    GenerationEvent::TabError {
                                        tab_type: "DetailedReading".to_string(),
                                        error: err.clone(),
                                    },
                                );
                                if first_error.is_none() {
                                    first_error = Some(err);
                                }
                                failed_count += 1;
                            } else {
                                let _ = app.emit(
                                    &event_name,
                                    GenerationEvent::TabCompleted {
                                        tab_type: "DetailedReading".to_string(),
                                        content,
                                    },
                                );
                                generated_count += 1;
                            }
                        }
                        Err(e) => {
                            let err = format!("序列化章节数据失败: {}", e);
                            tracing::error!("[笔记生成] {}", err);
                            let _ = app.emit(
                                &event_name,
                                GenerationEvent::TabError {
                                    tab_type: "DetailedReading".to_string(),
                                    error: err.clone(),
                                },
                            );
                            if first_error.is_none() {
                                first_error = Some(err);
                            }
                            failed_count += 1;
                        }
                    }
                }
                Ok(Err(e)) => {
                    if first_error.is_none() {
                        first_error = Some(e.clone());
                    }
                    let _ = app.emit(
                        &event_name,
                        GenerationEvent::TabError {
                            tab_type: "DetailedReading".to_string(),
                            error: e,
                        },
                    );
                    failed_count += 1;
                }
                Err(e) => {
                    let err = format!("原文细读任务异常: {}", e);
                    tracing::error!("[笔记生成] {}", err);
                    if first_error.is_none() {
                        first_error = Some(err.clone());
                    }
                    let _ = app.emit(
                        &event_name,
                        GenerationEvent::TabError {
                            tab_type: "DetailedReading".to_string(),
                            error: err,
                        },
                    );
                    failed_count += 1;
                }
            }
        }

    } // 结束 else 分支（并发生成）

    if cleanup_owned_abort_flag {
        cleanup_abort_flag(&generation_id).await;
    }

    // 发送完成事件
    let _ = app.emit(
        &event_name,
        GenerationEvent::AllCompleted {
            generated: generated_count,
            failed: failed_count,
            total: generated_count + failed_count,
        },
    );

    if request.options.fail_on_any_tab_error && failed_count > 0 {
        return Err(first_error.unwrap_or_else(|| "存在标签页生成失败".to_string()));
    }

    Ok(())
}

/// 开始生成笔记内容
pub async fn generate_note(
    app: AppHandle,
    db: &Database,
    generation_id: String,
    request: GenerateNoteRequest,
) -> Result<(), String> {
    let abort_flag = get_abort_flag(&generation_id).await;
    generate_note_internal(app, db, generation_id, request, abort_flag, true).await
}

/// 直接复用外部 abort_flag 的笔记生成入口（供初始化流程使用）
pub async fn generate_note_with_abort(
    app: AppHandle,
    db: &Database,
    generation_id: String,
    request: GenerateNoteRequest,
    abort_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    generate_note_internal(app, db, generation_id, request, abort_flag, false).await
}

/// 生成单个标签页内容
async fn generate_single_tab(
    app: &AppHandle,
    event_name: &str,
    tab_type: &TabType,
    ai_config: &AiConfig,
    note: &crate::db::Note,
    subtitle_text: &str,
    abort_flag: &Arc<AtomicBool>,
    model_context_size: usize,
    concurrent_limit: usize,
    tab_name: String,
    style: Option<&str>,
    custom_prompt: Option<&str>,
    screenshot_density: Option<&str>,
) -> TabResult {
    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return TabResult {
            tab_type: *tab_type,
            content: String::new(),
            success: false,
            error: Some("已中止".to_string()),
        };
    }

    // 发送开始事件
    let _ = app.emit(
        event_name,
        GenerationEvent::TabStarted {
            tab_type: format!("{:?}", tab_type),
            tab_name,
        },
    );

    // 选择生成策略
    let strategy = select_strategy(
        subtitle_text.len(),
        *tab_type,
        model_context_size,
        custom_prompt.is_some(),
    );

    // 执行生成
    let content_result = match strategy {
        GenerationStrategy::Layered if matches!(tab_type, TabType::FullSummary | TabType::CustomSummary) => {
            generate_full_summary_layered(
                ai_config,
                subtitle_text,
                abort_flag,
                event_name,
                app,
                custom_prompt,
                concurrent_limit,
            ).await
        }
        _ => {
            // 使用自定义提示词或默认提示词
            let prompt = match tab_type {
                TabType::AiNote => get_prompt_for_tab(
                    tab_type,
                    subtitle_text,
                    style,
                    screenshot_density,
                    custom_prompt,
                ),
                _ => {
                    if let Some(custom) = custom_prompt {
                        format!("{}\n\n视频字幕内容：\n{}", custom, subtitle_text)
                    } else {
                        get_prompt_for_tab(tab_type, subtitle_text, style, None, None)
                    }
                }
            };
            call_ai_api(ai_config, &prompt, abort_flag).await
        }
    };

    let content = match content_result {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                event_name,
                GenerationEvent::TabError {
                    tab_type: format!("{:?}", tab_type),
                    error: e.clone(),
                },
            );
            return TabResult {
                tab_type: *tab_type,
                content: String::new(),
                success: false,
                error: Some(e),
            };
        }
    };

    let has_screenshots = matches!(tab_type, TabType::AiNote)
        && screenshot_density
            .map(|value| !value.trim().is_empty() && value != "off")
            .unwrap_or(false);

    // 后处理（如JSON解析验证）
    let processed_content = match post_process_content(app, tab_type, note, &content, has_screenshots) {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                event_name,
                GenerationEvent::TabError {
                    tab_type: format!("{:?}", tab_type),
                    error: e,
                },
            );
            return TabResult {
                tab_type: *tab_type,
                content: String::new(),
                success: false,
                error: Some("内容处理失败".to_string()),
            };
        }
    };

    // 发送完成事件
    let _ = app.emit(
        event_name,
        GenerationEvent::TabCompleted {
            tab_type: format!("{:?}", tab_type),
            content: processed_content.clone(),
        },
    );

    TabResult {
        tab_type: *tab_type,
        content: processed_content,
        success: true,
        error: None,
    }
}

/// 后处理生成的内容
fn post_process_content(
    app: &AppHandle,
    tab_type: &TabType,
    note: &crate::db::Note,
    content: &str,
    has_screenshots: bool,
) -> Result<String, String> {
    match tab_type {
        TabType::AiNote => {
            let validated = validate_ai_note_structure(content);
            if has_screenshots {
                extract_ai_note_screenshots(app, note, &validated)
            } else {
                Ok(validated)
            }
        }
        _ => Ok(content.trim().to_string()),
    }
}

/// 更新笔记的标签页内容到数据库
fn update_note_tab(
    db: &Database,
    note_id: &str,
    tab_type: &TabType,
    content: &str,
    model_id: &str,
    style: Option<&str>,
    custom_prompt: Option<&str>,
    screenshot_density: Option<&str>,
) -> Result<(), String> {
    let mut note = db
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    match tab_type {
        TabType::FullSummary => note.full_summary = Some(content.to_string()),
        TabType::DetailedReading => note.detailed_reading = Some(content.to_string()),
        TabType::Highlights => note.highlights = Some(content.to_string()),
        TabType::VisualSummary => note.visual_summary = Some(content.to_string()),
        TabType::CustomSummary => note.custom_summary = Some(content.to_string()),
        TabType::AiNote => {
            note.ai_note_markdown = Some(content.to_string());
            let screenshot_density = screenshot_density
                .map(str::trim)
                .filter(|value| !value.is_empty() && *value != "off");
            note.ai_note_meta = Some(
                serde_json::json!({
                    "style": style.unwrap_or(if custom_prompt.is_some() { "custom" } else { "default" }),
                    "custom_prompt": custom_prompt,
                    "model_id": model_id,
                    "screenshot_density": screenshot_density,
                    "has_screenshots": screenshot_density.is_some(),
                    "generated_at": chrono::Local::now().to_rfc3339(),
                })
                .to_string(),
            );
        }
    }

    db.update_note(&note).map_err(|e| e.to_string())
}

/// 中止生成任务
pub async fn abort_generation(generation_id: String) -> Result<(), String> {
    let flags = get_abort_flags_lock().lock().await;
    if let Some(flag) = flags.get(&generation_id) {
        flag.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("生成任务不存在".to_string())
    }
}

/// 获取标签页的中文名称
fn get_tab_name(tab_type: &TabType) -> String {
    match tab_type {
        TabType::FullSummary => "全文总结".to_string(),
        TabType::DetailedReading => "原文细读".to_string(),
        TabType::Highlights => "高光笔记".to_string(),
        TabType::VisualSummary => "视觉化总结".to_string(),
        TabType::CustomSummary => "自定义总结".to_string(),
        TabType::AiNote => "大纲笔记".to_string(),
    }
}

/// 获取标签页对应的提示词
fn get_prompt_for_tab(
    tab_type: &TabType,
    subtitle_text: &str,
    style: Option<&str>,
    screenshot_density: Option<&str>,
    custom_prompt: Option<&str>,
) -> String {
    match tab_type {
        TabType::FullSummary => PromptTemplates::full_summary(subtitle_text),
        TabType::DetailedReading => unreachable!("DetailedReading 已在 generate_note 中单独处理"),
        TabType::Highlights => PromptTemplates::highlights(subtitle_text),
        TabType::VisualSummary => PromptTemplates::visual_summary(subtitle_text),
        TabType::CustomSummary => PromptTemplates::custom_summary(subtitle_text),
        TabType::AiNote => PromptTemplates::ai_note(subtitle_text, style, screenshot_density, custom_prompt),
    }
}


// ============================================================================
// 辅助模式章节生成
// ============================================================================

/// 辅助模式章节分段
#[derive(Debug, Clone)]
struct AssistModeSegment {
    start_index: usize,           // 起始字幕索引
    end_index: usize,             // 结束字幕索引（不包含）
    screenshot_path: Option<String>, // 用户截图路径，None 表示需要自动截图
    start_time: f64,              // 起始时间
    end_time: f64,                // 结束时间
}

/// 根据截图标记计算章节分段
/// 
/// 分段算法：
/// 1. 如果 markers 为空，返回单个分段包含所有字幕
/// 2. 按 subtitle_index 排序 markers
/// 3. 每个 marker 位置作为新章节的起点
/// 4. 第一段无标记时需要自动截图
/// 5. 有标记的分段使用该标记的截图
fn calculate_segments_from_markers(
    subtitle_entries: &[SubtitleEntry],
    markers: &[ScreenshotMarker],
) -> Vec<AssistModeSegment> {
    if subtitle_entries.is_empty() {
        return vec![];
    }

    let total_subtitles = subtitle_entries.len();
    let total_duration = subtitle_entries.last().unwrap().end_time;

    // 如果没有标记，返回单个分段包含所有字幕
    if markers.is_empty() {
        return vec![AssistModeSegment {
            start_index: 0,
            end_index: total_subtitles,
            screenshot_path: None, // 需要自动截图
            start_time: subtitle_entries[0].start_time,
            end_time: total_duration,
        }];
    }

    // 按 subtitle_index 排序标记
    let mut sorted_markers = markers.to_vec();
    sorted_markers.sort_by_key(|m| m.subtitle_index);

    let mut segments = Vec::new();
    let mut current_start = 0;

    for marker in &sorted_markers {
        let marker_index = marker.subtitle_index as usize;

        // 如果标记位置大于当前起始位置，创建一个分段
        if marker_index > current_start {
            // 这是标记之前的分段
            let start_time = subtitle_entries[current_start].start_time;
            let end_time = if marker_index < total_subtitles {
                subtitle_entries[marker_index].start_time
            } else {
                total_duration
            };

            // 第一段（current_start == 0）使用第一个 marker 的截图作为封面
            let screenshot_path = if current_start == 0 {
                // 使用第一个 marker 的截图作为封面
                sorted_markers.first().map(|m| m.screenshot_path.clone())
            } else {
                // 查找前一个标记的截图
                sorted_markers
                    .iter()
                    .filter(|m| (m.subtitle_index as usize) == current_start)
                    .next()
                    .map(|m| m.screenshot_path.clone())
            };

            segments.push(AssistModeSegment {
                start_index: current_start,
                end_index: marker_index,
                screenshot_path,
                start_time,
                end_time,
            });
        }

        current_start = marker_index;
    }

    // 添加最后一个分段（从最后一个标记到字幕结尾）
    if current_start < total_subtitles {
        let start_time = subtitle_entries[current_start].start_time;
        let end_time = total_duration;

        // 最后一个分段使用最后一个标记的截图
        let screenshot_path = sorted_markers
            .iter()
            .filter(|m| (m.subtitle_index as usize) == current_start)
            .next()
            .map(|m| m.screenshot_path.clone());

        segments.push(AssistModeSegment {
            start_index: current_start,
            end_index: total_subtitles,
            screenshot_path,
            start_time,
            end_time,
        });
    }

    segments
}

/// 生成章节内容的提示词
fn build_chapter_content_prompt(subtitle_text: &str) -> String {
    format!(
        r#"你是一个专业的视频内容分析师。请为以下视频字幕片段生成章节标题和内容摘要。

**输出要求**：
1. 必须输出有效的 JSON 格式（不要使用代码块标记）
2. 标题应简洁明了，概括该段落的核心主题（10-20字）
3. 内容摘要应简明扼要地描述该段落的主要内容（50-100字）

**输出格式**：
{{
  "title": "章节标题",
  "content": "章节内容摘要"
}}

**视频字幕片段**：
{}"#,
        subtitle_text
    )
}

/// 解析章节内容 AI 响应
fn parse_chapter_content_response(response: &str) -> Result<(String, String), String> {
    // 提取 JSON（可能有代码块标记）
    let json_str = if let Some(start) = response.find("```json") {
        let start = start + 7;
        if let Some(end) = response[start..].find("```") {
            &response[start..start + end]
        } else {
            response
        }
    } else if let Some(start) = response.find("```") {
        let start = start + 3;
        if let Some(end) = response[start..].find("```") {
            &response[start..start + end]
        } else {
            response
        }
    } else {
        response
    };

    #[derive(Deserialize)]
    struct ChapterContentResponse {
        title: String,
        content: String,
    }

    // AI 有时会一次输出多个 JSON 对象（标题重复生成），逐个尝试解析取第一个有效对象
    let mut start = match json_str.find('{') {
        Some(pos) => pos,
        None => return Err("未找到有效的JSON响应".to_string()),
    };
    while start < json_str.len() {
        // 逐层匹配与 start 对应的闭合 }（跳过字符串内的花括号）
        let bytes = json_str.as_bytes();
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        let mut end = None;
        for (i, &b) in bytes.iter().enumerate().skip(start) {
            if escaped {
                escaped = false;
                continue;
            }
            match b {
                b'\\' if in_string => escaped = true,
                b'"' => in_string = !in_string,
                b'{' if !in_string => depth += 1,
                b'}' if !in_string => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        end = Some(i);
                        break;
                    }
                }
                _ => {}
            }
        }

        let end = match end {
            Some(pos) => pos,
            None => break,
        };

        if let Ok(parsed) = serde_json::from_str::<ChapterContentResponse>(&json_str[start..=end]) {
            return Ok((parsed.title, parsed.content));
        }

        // 该对象解析失败，尝试下一个 { 开始的对象
        start += 1;
        match json_str[start..].find('{') {
            Some(offset) => start += offset,
            None => break,
        }
    }

    Err("未找到有效的JSON响应".to_string())
}

/// 使用辅助模式标记生成章节
///
/// 该函数根据用户在辅助模式下添加的截图标记来分段生成章节，
/// 而不是使用 AI 自动分段。
pub async fn generate_chapters_with_markers(
    app: AppHandle,
    db: &Database,
    generation_id: String,
    note_id: String,
    model_id: String,
    video_path: String,
    subtitle_path: String,
    markers: Vec<ScreenshotMarker>,
) -> Result<ChapterData, String> {
    let event_name = format!("chapter-generation-{}", generation_id);

    // 注册中止标志
    let abort_flag = get_ai_pool_manager().register_abort_flag(generation_id.clone()).await;

    // 获取 AI 配置
    let ai_config = db
        .get_ai_config_by_id(&model_id)
        .map_err(|e| e.to_string())?
        .ok_or("AI模型未找到".to_string())?;

    // 发送开始事件
    let _ = app.emit(&event_name, ChapterGenerationEvent::Starting);

    // 检查视频文件是否存在
    if !Path::new(&video_path).exists() {
        get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
        return Err("视频文件不存在".to_string());
    }

    // 检查字幕文件是否存在
    if !Path::new(&subtitle_path).exists() {
        get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
        return Err("字幕文件不存在".to_string());
    }

    // 解析字幕
    let _ = app.emit(&event_name, ChapterGenerationEvent::AnalyzingSubtitle {
        message: "正在解析字幕文件...".to_string(),
    });

    let subtitle_entries = parse_subtitle_file(&subtitle_path)?;
    if subtitle_entries.is_empty() {
        get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
        return Err("字幕内容为空".to_string());
    }

    // 计算总时长
    let total_duration = subtitle_entries.last().unwrap().end_time;

    tracing::info!("[辅助模式章节生成] 字幕总条数: {}, 标记数: {}", subtitle_entries.len(), markers.len());

    // 根据标记计算分段
    let segments = calculate_segments_from_markers(&subtitle_entries, &markers);
    let total_segments = segments.len();

    tracing::info!("[辅助模式章节生成] 计算得到 {} 个分段", total_segments);

    // 准备截图目录
    let screenshots_dir = storage_paths::chapter_screenshots_dir(&app, &note_id)?;
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;

    // 从视频路径提取文件名
    let video_name = Path::new(&video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let safe_video_name = sanitize_filename(video_name);

    // 并发生成章节内容
    let mut tasks = Vec::new();

    // 使用原子计数器跟踪已完成的任务数（用于并发场景下的递增进度显示）
    let completed_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for (segment_idx, segment) in segments.iter().enumerate() {
        let ai_config = ai_config.clone();
        let abort_flag = abort_flag.clone();
        let app = app.clone();
        let event_name = event_name.clone();
        let subtitle_entries = subtitle_entries.clone();
        let segment = segment.clone();
        let video_path = video_path.clone();
        let screenshots_dir = screenshots_dir.clone();
        let safe_video_name = safe_video_name.clone();
        let completed_count = completed_count.clone();

        let task = tokio::spawn(async move {
            // 检查中止
            if abort_flag.load(Ordering::Relaxed) {
                return Err::<(usize, Chapter), String>("已中止".to_string());
            }

            tracing::info!("[辅助模式章节生成] 处理第 {}/{} 段，字幕索引范围: [{}, {})",
                segment_idx + 1, total_segments, segment.start_index, segment.end_index);

            // 提取该分段的字幕文本
            let segment_subtitles: Vec<&SubtitleEntry> = subtitle_entries
                .iter()
                .skip(segment.start_index)
                .take(segment.end_index - segment.start_index)
                .collect();

            let subtitle_text: String = segment_subtitles
                .iter()
                .map(|e| e.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");

            // 调用 AI 生成章节标题和内容
            let prompt = build_chapter_content_prompt(&subtitle_text);

            let (title, content) = match execute_streaming_and_collect(ai_config, prompt, &abort_flag).await {
                Ok(ref response) => {
                    match parse_chapter_content_response(response) {
                        Ok((t, c)) => (t, c),
                        Err(e) => {
                            tracing::error!("[辅助模式章节生成] 第 {} 段解析失败: {}", segment_idx + 1, e);
                            // 使用默认标题和内容
                            (format!("章节 {}", segment_idx + 1), subtitle_text.chars().take(200).collect())
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("[辅助模式章节生成] 第 {} 段 AI 调用失败: {}", segment_idx + 1, e);
                    // 使用默认标题和内容
                    (format!("章节 {}", segment_idx + 1), subtitle_text.chars().take(200).collect())
                }
            };

            // 处理截图
            let screenshot_path = if let Some(path) = &segment.screenshot_path {
                // 使用用户提供的截图
                Some(path.clone())
            } else {
                // 需要自动截图：使用第一个字幕的时间戳
                let timestamp = segment.start_time;
                let timestamp_str = format_timestamp_for_filename(timestamp);
                let screenshot_filename = format!("{}_{}.jpg", safe_video_name, timestamp_str);
                let screenshot_path = screenshots_dir.join(&screenshot_filename);

                match capture_video_screenshot(&video_path, timestamp, screenshot_path.to_str().unwrap()) {
                    Ok(_) => {
                        tracing::info!("[辅助模式章节生成] 第 {} 段自动截图成功: {}", segment_idx + 1, screenshot_filename);
                        Some(screenshot_path.to_string_lossy().to_string())
                    }
                    Err(e) => {
                        tracing::error!("[辅助模式章节生成] 第 {} 段自动截图失败: {}", segment_idx + 1, e);
                        None
                    }
                }
            };

            let chapter = Chapter {
                id: uuid::Uuid::new_v4().to_string(),
                title,
                start_time: segment.start_time,
                end_time: segment.end_time,
                content,
                screenshot_path,
                level: None,
                parent_id: None,
            };

            // 任务完成后，递增完成计数并发送进度事件
            let completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = app.emit(&event_name, ChapterGenerationEvent::ChapterCompleted {
                completed,
                total: total_segments,
                message: format!("已完成 {}/{} 章节", completed, total_segments),
            });

            Ok((segment_idx, chapter))
        });

        tasks.push(task);
    }

    // 等待所有任务完成并收集结果
    let mut results: Vec<(usize, Chapter)> = Vec::new();

    for task in tasks {
        match task.await {
            Ok(Ok(result)) => {
                results.push(result);
            }
            Ok(Err(e)) => {
                if e == "已中止" {
                    get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
                    return Err(e);
                }
                // 其他错误继续处理
            }
            Err(e) => {
                tracing::error!("[辅助模式章节生成] 任务执行出错: {}", e);
                // 继续处理其他任务
            }
        }
    }

    // 按分段索引排序
    results.sort_by_key(|(idx, _)| *idx);
    let mut chapters: Vec<Chapter> = results.into_iter().map(|(_, chapter)| chapter).collect();

    if chapters.is_empty() {
        get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
        return Err("未能生成任何章节".to_string());
    }

    tracing::info!("[辅助模式章节生成] 成功生成 {} 个章节", chapters.len());

    // 优化标题（添加层级信息）
    let _ = app.emit(&event_name, ChapterGenerationEvent::AnalyzingSubtitle {
        message: "AI正在优化章节标题...".to_string(),
    });

    if let Err(e) = optimize_chapter_titles(&ai_config, &mut chapters, &abort_flag).await {
        tracing::error!("[辅助模式章节生成] 标题优化失败: {}", e);
        // 标题优化失败不影响整体流程，继续返回结果
    }

    // 构建结果
    let chapter_data = ChapterData {
        total_duration,
        generated_at: chrono::Local::now().to_rfc3339(),
        chapters,
    };

    // 清理
    get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;

    Ok(chapter_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loose_regex_matches_standard_format() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[[SCREENSHOT:01:23:45]]"));
        assert!(re.is_match("[[SCREENSHOT:00:00:00]]"));
    }

    #[test]
    fn loose_regex_matches_single_bracket_variant() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[SCREENSHOT:01:23:45]"));
    }

    #[test]
    fn loose_regex_matches_full_width_brackets() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("【SCREENSHOT:01:23:45】"));
        assert!(re.is_match("【截图:01:23:45】"));
    }

    #[test]
    fn loose_regex_matches_case_variants() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[[Screenshot:01:23:45]]"));
        assert!(re.is_match("[[screenshot:01:23:45]]"));
    }

    #[test]
    fn loose_regex_matches_chinese_keyword() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[[截图:01:23:45]]"));
        assert!(re.is_match("[截图:01:23:45]"));
    }

    #[test]
    fn loose_regex_matches_unpadded_digits() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[[SCREENSHOT:1:5:9]]"));
        assert!(re.is_match("[[SCREENSHOT:1:23:45]]"));
    }

    #[test]
    fn loose_regex_matches_full_width_colon() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[[SCREENSHOT:01:23:45]]"));
    }

    #[test]
    fn loose_regex_matches_two_segment_format() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[[SCREENSHOT:23:45]]"));
    }

    #[test]
    fn loose_regex_matches_decimal_seconds() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(re.is_match("[[SCREENSHOT:01:23:45.5]]"));
    }

    #[test]
    fn loose_regex_does_not_match_unrelated_brackets() {
        let re = get_ai_note_screenshot_loose_regex();
        assert!(!re.is_match("[[NOTE:01:23:45]]"));
        assert!(!re.is_match("[图片:01:23:45]"));
        assert!(!re.is_match("01:23:45"));
        assert!(!re.is_match("[CHAPTER:01:23:45]"));
    }

    #[test]
    fn parse_detailed_reading_accepts_single_json_object() {
        let response = "{\n \"title\": \"章节标题\",\n \"content\": \"章节内容\"\n}";
        let (title, content) = parse_detailed_reading_chapter_response(response).unwrap();
        assert_eq!(title, "章节标题");
        assert_eq!(content, "章节内容");
    }

    #[test]
    fn parse_detailed_reading_takes_first_of_multiple_json_objects() {
        // AI 有时一次输出多个 JSON 对象，旧解析逻辑会因 trailing characters 失败
        let response = concat!(
            "{\n \"title\": \"第一个标题\",\n \"content\": \"第一个内容\"\n}\n\n",
            "{\n \"title\": \"第二个标题\",\n \"content\": \"第二个内容\"\n}"
        );
        let (title, content) = parse_detailed_reading_chapter_response(response).unwrap();
        assert_eq!(title, "第一个标题");
        assert_eq!(content, "第一个内容");
    }

    #[test]
    fn parse_detailed_reading_handles_braces_inside_strings() {
        let response = "{\n \"title\": \"标题\",\n \"content\": \"内容包含花括号 { 和 } 以及嵌套 {x}\"\n}";
        let (title, content) = parse_detailed_reading_chapter_response(response).unwrap();
        assert_eq!(title, "标题");
        assert_eq!(content, "内容包含花括号 { 和 } 以及嵌套 {x}");
    }

    #[test]
    fn parse_detailed_reading_extracts_from_code_block() {
        let response = "```json\n{\"title\": \"标题\", \"content\": \"内容\"}\n```";
        let (title, content) = parse_detailed_reading_chapter_response(response).unwrap();
        assert_eq!(title, "标题");
        assert_eq!(content, "内容");
    }

    #[test]
    fn parse_detailed_reading_rejects_invalid_json() {
        let response = "{ invalid json }";
        assert!(parse_detailed_reading_chapter_response(response).is_err());
    }

    #[test]
    fn loose_regex_does_not_match_replaced_markdown() {
        let re = get_ai_note_screenshot_loose_regex();
        // 替换后的 Markdown 不应被再次匹配
        assert!(!re.is_match("![⏱ 01:23:45](http://asset.localhost/foo)"));
    }

    #[test]
    fn loose_regex_extracts_three_segment_time() {
        let re = get_ai_note_screenshot_loose_regex();
        let cap = re.captures("[[SCREENSHOT:01:23:45]]").unwrap();
        assert_eq!(cap.get(1).unwrap().as_str(), "01");
        assert_eq!(cap.get(2).unwrap().as_str(), "23");
        assert_eq!(cap.get(3).unwrap().as_str(), "45");
    }

    #[test]
    fn loose_regex_extracts_two_segment_time() {
        let re = get_ai_note_screenshot_loose_regex();
        let cap = re.captures("[[SCREENSHOT:23:45]]").unwrap();
        // 两段格式：小时组缺省，分秒组应被填充
        assert!(cap.get(1).is_none());
        assert_eq!(cap.get(2).unwrap().as_str(), "23");
        assert_eq!(cap.get(3).unwrap().as_str(), "45");
    }

    #[test]
    fn strict_regex_still_matches_only_canonical_form() {
        let re = get_ai_note_screenshot_regex();
        assert!(re.is_match("[[SCREENSHOT:01:23:45]]"));
        assert!(!re.is_match("[[SCREENSHOT:1:23:45]]"));
        assert!(!re.is_match("[SCREENSHOT:01:23:45]"));
        assert!(!re.is_match("[[screenshot:01:23:45]]"));
    }

    #[test]
    fn abort_error_detects_cancel_and_abort_messages() {
        assert!(is_abort_error("已中止"));
        assert!(is_abort_error("请求已取消"));
        assert!(is_abort_error("Aborted by user"));
        assert!(!is_abort_error("JSON解析失败"));
    }

    #[test]
    fn concurrent_limit_is_clamped_to_model_pool_range() {
        assert_eq!(clamp_concurrent_limit(0), 1);
        assert_eq!(clamp_concurrent_limit(5), 5);
        assert_eq!(clamp_concurrent_limit(99), 10);
    }

    #[test]
    fn snapshot_completed_chapters_skips_empty_slots_and_keeps_order() {
        let mut slots = vec![None, None, None];
        slots[0] = Some(DetailedReadingChapter {
            id: "a".to_string(),
            title: "一".to_string(),
            start_time: 0.0,
            end_time: 1.0,
            content: Some("c1".to_string()),
            subtitle_entries: Vec::new(),
            screenshot_path: None,
        });
        slots[2] = Some(DetailedReadingChapter {
            id: "c".to_string(),
            title: "三".to_string(),
            start_time: 2.0,
            end_time: 3.0,
            content: Some("c3".to_string()),
            subtitle_entries: Vec::new(),
            screenshot_path: Some("shot.jpg".to_string()),
        });
        let data = snapshot_completed_chapters(&slots, 12.0);
        assert_eq!(data.total_duration, 12.0);
        assert_eq!(data.chapters.len(), 2);
        assert_eq!(data.chapters[0].id, "a");
        assert_eq!(data.chapters[1].id, "c");
        assert_eq!(data.chapters[1].screenshot_path.as_deref(), Some("shot.jpg"));
    }

    #[test]
    fn fallback_chapter_content_uses_excerpt_or_default() {
        assert_eq!(fallback_chapter_content(""), "该段生成失败，可稍后重试");
        let content = fallback_chapter_content("abcdefghij");
        assert!(content.starts_with("abcdefghij"));
        assert!(content.ends_with("…"));
    }
    #[test]
    fn chapter_partial_serializes_with_status_tag() {
        let event = GenerationEvent::ChapterPartial {
            tab_type: "DetailedReading".to_string(),
            index: 1,
            total: 3,
            chapter: DetailedReadingChapter {
                id: "c1".to_string(),
                title: "t".to_string(),
                start_time: 0.0,
                end_time: 1.0,
                content: Some("body".to_string()),
                subtitle_entries: Vec::new(),
                screenshot_path: None,
            },
            total_duration: 12.0,
        };
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["status"], "ChapterPartial");
        assert_eq!(value["index"], 1);
        assert_eq!(value["total"], 3);
        assert_eq!(value["chapter"]["id"], "c1");
        assert_eq!(value["total_duration"], 12.0);
    }

}
