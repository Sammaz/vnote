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

use crate::ai_pool::{execute_non_streaming_with_abort, get_ai_pool_manager, NonStreamingRequest};
use crate::chapter::{
    capture_video_screenshot, split_subtitle_into_chunks, sanitize_filename,
    format_timestamp_for_filename, Chapter, ChapterData, ChapterGenerationEvent,
};
use crate::db::{AiConfig, Database, ScreenshotMarker};
use crate::subtitle::{parse_subtitle_file, SubtitleEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};
use tauri::{AppHandle, Emitter, Manager};
use std::sync::OnceLock;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 笔记生成请求
#[derive(Debug, Deserialize)]
pub struct GenerateNoteRequest {
    pub note_id: i64,
    pub model_id: i64,
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
    /// 并发数限制（1-5，默认3）
    #[serde(default = "default_concurrent_limit")]
    pub concurrent_limit: usize,
    /// 自定义提示词（可选）
    #[serde(default)]
    pub custom_prompt: Option<String>,
}

fn default_concurrent_limit() -> usize {
    3
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
    /// 全文总结提示词 - 返回 Markdown 格式
    fn full_summary(subtitle_content: &str) -> String {
        format!(
            r#"你是一个专业的视频内容分析师。请分析以下视频字幕，生成一份结构化的全文总结。

输出要求：
1. 使用 Markdown 格式输出（不要使用代码块标记）
2. 包含以下结构：

# 摘要
100-150字的摘要段落，概括视频核心内容

# 核心亮点

## 🔥 亮点标题1
详细描述该亮点的内容

## 💡 亮点标题2
详细描述该亮点的内容

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

请严格按照以下 Markdown 格式输出（不要使用代码块标记）：

# 摘要
100-150字的摘要段落

# 核心亮点

## 🔥 亮点标题
详细描述

## 💡 亮点标题
详细描述

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
    // 估算token数（中文约1.5字符/token，保守估计1:1）
    let estimated_tokens = subtitle_length + 3000; // 加上prompt和输出预留

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
const SEGMENT_SIZE: usize = 10000;

fn split_subtitle_by_semantic(subtitle: &str) -> Vec<String> {
    if subtitle.len() < SEGMENT_SIZE {
        // 内容少于 SEGMENT_SIZE，不需要分段
        return vec![subtitle.to_string()];
    }

    // 计算段数：字数 / SEGMENT_SIZE + 1
    let num_chunks = subtitle.len() / SEGMENT_SIZE + 1;
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

/// 调用AI API（非流式，通过ai_pool统一管理并发）
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
    let req = NonStreamingRequest {
        config: ai_config.clone(),
        prompt: prompt.to_string(),
    };

    let response = execute_non_streaming_with_abort(req, abort_flag).await?;

    // 再次检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    Ok(response.content)
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
) -> Result<String, String> {
    // 将 event_name 转换为 String 以便在异步任务中使用
    let event_name = event_name.to_string();

    let generation_type = if custom_prompt.is_some() { "自定义总结" } else { "全文总结" };
    eprintln!("[笔记生成] ========================================");
    eprintln!("[笔记生成] 开始生成: {}", generation_type);
    eprintln!("[笔记生成] 字幕总长度: {} 字符", full_subtitle.len());
    eprintln!("[笔记生成] 使用模型: {}", ai_config.model);

    // 第一层：动态分段生成摘要框架（按字数/SEGMENT_SIZE+1计算段数，再均分）
    let chunks = split_subtitle_by_semantic(full_subtitle);
    let total_chunks = chunks.len();

    eprintln!("[笔记生成] 分段策略: 字数/10000+1 = {} 段", total_chunks);
    for (i, chunk) in chunks.iter().enumerate() {
        eprintln!("[笔记生成]   段 {}: {} 字符", i + 1, chunk.len());
    }
    eprintln!("[笔记生成] ========================================");

    // 并发生成各段摘要（并发控制由 AI 线程池统一管理）
    let mut tasks = Vec::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let app = app.clone();
        let event_name_for_task = event_name.clone();
        let ai_config = ai_config.clone();
        let chunk = chunk.clone();
        let abort_flag = abort_flag.clone();
        let chunk_index = i;
        let custom_prompt_for_task = custom_prompt.map(|p| p.to_string());

        let task = tokio::spawn(async move {
            eprintln!("[笔记生成] 段 {}/{}: 开始执行...", chunk_index + 1, total_chunks);

            // 检查中止
            if abort_flag.load(Ordering::Relaxed) {
                eprintln!("[笔记生成] 段 {}/{}: 已中止", chunk_index + 1, total_chunks);
                return Err::<(String, usize), String>("已中止".to_string());
            }

            // 发送进度事件
            let _ = app.emit(
                &event_name_for_task,
                GenerationEvent::TabProgress {
                    tab_type: "full_summary".to_string(),
                    current: chunk_index + 1,
                    total: total_chunks + 2,
                    message: format!("生成第 {}/{} 段摘要...", chunk_index + 1, total_chunks),
                },
            );

            // 使用自定义提示词或默认提示词生成分段摘要
            // 并发控制由 call_ai_api 内部的 AI 线程池管理
            let prompt = if let Some(custom) = &custom_prompt_for_task {
                // 自定义提示词：为每段字幕生成摘要
                format!("{}\n\n视频字幕片段：\n{}", custom, chunk)
            } else {
                PromptTemplates::chunk_summary(&chunk)
            };

            match call_ai_api(&ai_config, &prompt, &abort_flag).await {
                Ok(summary) => {
                    eprintln!("[笔记生成] 段 {}/{}: 完成 (生成 {} 字符)", chunk_index + 1, total_chunks, summary.len());
                    Ok((summary, chunk_index))
                }
                Err(e) => {
                    eprintln!("[笔记生成] 段 {}/{}: 失败 - {}", chunk_index + 1, total_chunks, e);
                    Err(e)
                }
            }
        });

        tasks.push(task);
    }

    // 等待所有任务完成
    let mut results = Vec::new();
    let mut success_count = 0;

    for task in tasks {
        match task.await {
            Ok(Ok((summary, index))) => {
                results.push((index, summary));
                success_count += 1;
            }
            Ok(Err(e)) => {
                return Err(format!("分段生成失败: {}", e));
            }
            Err(e) => {
                return Err(format!("任务执行出错: {}", e));
            }
        }
    }

    let failed_count = total_chunks - success_count;
    eprintln!("[笔记生成] 分段生成完成: 成功 {}, 失败 {}", success_count, failed_count);

    // 按原始顺序排序
    results.sort_by_key(|(index, _)| *index);
    let chunk_summaries: Vec<String> = results.into_iter().map(|(_, summary)| summary).collect();

    // 合并得到框架摘要
    let framework_prompt = format!(
        "以下是视频各片段的摘要，请整合成一份连贯的整体摘要框架（1000字以内）：\n\n{}",
        chunk_summaries.join("\n\n---\n\n")
    );

    eprintln!("[笔记生成] 开始整合摘要框架...");
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

    let framework = call_ai_api(ai_config, &framework_prompt, abort_flag).await?;
    eprintln!("[笔记生成] 框架整合完成 (生成 {} 字符)", framework.len());

    // 第二层：基于框架生成完整的结构化全文总结
    let final_prompt = if let Some(custom) = custom_prompt {
        // 使用自定义提示词生成最终总结
        format!("{}\n\n请基于以下框架生成完整总结：\n{}", custom, framework)
    } else {
        PromptTemplates::framework_expand(&framework)
    };

    eprintln!("[笔记生成] 开始生成最终总结...");
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

    let final_content = call_ai_api(ai_config, &final_prompt, abort_flag).await?;
    eprintln!("[笔记生成] 最终总结完成 (生成 {} 字符)", final_content.len());
    eprintln!("[笔记生成] ========================================");

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

    #[derive(Deserialize)]
    struct ChapterContentResponse {
        title: String,
        content: String,
    }

    let parsed: ChapterContentResponse = serde_json::from_str(clean_json)
        .map_err(|e| format!("JSON解析失败: {}, JSON内容: {}", e, clean_json))?;

    Ok((parsed.title, parsed.content))
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

    eprintln!("[标题优化] 开始优化 {} 个章节的标题", chapters.len());

    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    // 构建提示词
    let prompt = build_title_optimization_prompt(chapters);

    // 调用 AI
    let req = NonStreamingRequest {
        config: ai_config.clone(),
        prompt,
    };

    let response = execute_non_streaming_with_abort(req, abort_flag).await?;

    // 解析响应
    match parse_title_optimization_response(&response.content) {
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

                    eprintln!(
                        "[标题优化] 章节 {}: \"{}\" (level={}, parent={:?})",
                        opt_ch.index,
                        chapter.title,
                        opt_ch.level,
                        chapter.parent_id
                    );
                }
            }

            eprintln!("[标题优化] 标题优化完成");
            Ok(())
        }
        Err(e) => {
            eprintln!("[标题优化] 解析失败，保持原标题: {}", e);
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
/// 该函数使用 AI 自动分段字幕，然后为每个分段生成标题和内容摘要，并截图。
/// 输出格式与辅助模式一致，都是 ChapterData。
async fn generate_detailed_reading_chapters(
    app: &AppHandle,
    event_name: &str,
    ai_config: &AiConfig,
    subtitle_entries: &[SubtitleEntry],
    video_path: &str,
    note_id: i64,
    abort_flag: &Arc<AtomicBool>,
) -> Result<ChapterData, String> {
    eprintln!("[原文细读] ========================================");
    eprintln!("[原文细读] 开始生成章节数据");
    eprintln!("[原文细读] 字幕总条数: {}", subtitle_entries.len());
    eprintln!("[原文细读] 使用模型: {}", ai_config.model);

    // 计算总时长
    let total_duration = subtitle_entries.last().map(|e| e.end_time).unwrap_or(0.0);

    // 第一步：使用 AI 分段字幕
    let _ = app.emit(
        event_name,
        GenerationEvent::TabProgress {
            tab_type: "DetailedReading".to_string(),
            current: 1,
            total: 3,
            message: "AI正在分析字幕结构...".to_string(),
        },
    );

    let chunks = split_subtitle_into_chunks(subtitle_entries);
    let total_chunks = chunks.len();
    eprintln!("[原文细读] 分段数: {}", total_chunks);

    // 第二步：并发生成每个分段的章节内容
    let mut tasks = Vec::new();

    for (chunk_idx, chunk) in chunks.iter().enumerate() {
        let ai_config = ai_config.clone();
        let abort_flag = abort_flag.clone();
        let app = app.clone();
        let event_name = event_name.to_string();
        let subtitle_entries = subtitle_entries.to_vec();
        let chunk_start = chunk.start_index;
        let chunk_end = chunk.end_index;

        // 提取该分段的字幕文本（用于生成内容）
        let segment_subtitles: Vec<&SubtitleEntry> = subtitle_entries
            .iter()
            .skip(chunk_start)
            .take(chunk_end - chunk_start)
            .collect();

        let subtitle_text: String = segment_subtitles
            .iter()
            .map(|e| e.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");

        // 计算时间范围
        let start_time = subtitle_entries.get(chunk_start).map(|e| e.start_time).unwrap_or(0.0);
        let end_time = subtitle_entries.get(chunk_end.saturating_sub(1)).map(|e| e.end_time).unwrap_or(total_duration);

        let task = tokio::spawn(async move {
            // 检查中止
            if abort_flag.load(Ordering::Relaxed) {
                return Err::<(usize, String, String, f64, f64), String>("已中止".to_string());
            }

            eprintln!("[原文细读] 处理第 {}/{} 段，字幕索引范围: [{}, {})",
                chunk_idx + 1, total_chunks, chunk_start, chunk_end);

            // 发送进度事件
            let _ = app.emit(&event_name, GenerationEvent::TabProgress {
                tab_type: "DetailedReading".to_string(),
                current: chunk_idx + 1,
                total: total_chunks + 1,
                message: format!("AI正在生成第 {}/{} 章节内容...", chunk_idx + 1, total_chunks),
            });

            // 调用 AI 生成章节标题和内容
            let prompt = build_detailed_reading_chapter_prompt(&subtitle_text);
            let req = NonStreamingRequest {
                config: ai_config,
                prompt,
            };

            let (title, content) = match execute_non_streaming_with_abort(req, &abort_flag).await {
                Ok(response) => {
                    match parse_detailed_reading_chapter_response(&response.content) {
                        Ok((t, c)) => (t, c),
                        Err(e) => {
                            eprintln!("[原文细读] 第 {} 段解析失败: {}", chunk_idx + 1, e);
                            // 使用默认标题和内容
                            (format!("章节 {}", chunk_idx + 1), subtitle_text.chars().take(200).collect())
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[原文细读] 第 {} 段 AI 调用失败: {}", chunk_idx + 1, e);
                    // 使用默认标题和内容
                    (format!("章节 {}", chunk_idx + 1), subtitle_text.chars().take(200).collect())
                }
            };

            Ok((chunk_idx, title, content, start_time, end_time))
        });

        tasks.push(task);
    }

    // 等待所有任务完成并收集结果
    let mut results: Vec<(usize, String, String, f64, f64)> = Vec::new();

    for task in tasks {
        match task.await {
            Ok(Ok(result)) => {
                results.push(result);
            }
            Ok(Err(e)) => {
                if e == "已中止" {
                    return Err(e);
                }
            }
            Err(e) => {
                eprintln!("[原文细读] 任务执行出错: {}", e);
            }
        }
    }

    // 按分段索引排序
    results.sort_by_key(|(idx, _, _, _, _)| *idx);

    if results.is_empty() {
        return Err("未能生成任何章节".to_string());
    }

    // 第三步：为每个章节截图
    let _ = app.emit(
        event_name,
        GenerationEvent::TabProgress {
            tab_type: "DetailedReading".to_string(),
            current: total_chunks,
            total: total_chunks + 1,
            message: "正在截取章节画面...".to_string(),
        },
    );

    // 准备截图目录
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let screenshots_dir = cache_dir.join("notes").join(note_id.to_string()).join("screenshots");
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;

    // 从视频路径提取文件名
    let video_name = Path::new(video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let safe_video_name = sanitize_filename(video_name);

    // 构建章节列表
    let mut chapters: Vec<Chapter> = Vec::new();

    for (idx, title, content, start_time, end_time) in results {
        // 截图
        let timestamp_str = format_timestamp_for_filename(start_time);
        let screenshot_filename = format!("{}_{}.jpg", safe_video_name, timestamp_str);
        let screenshot_path = screenshots_dir.join(&screenshot_filename);

        let screenshot_result = capture_video_screenshot(video_path, start_time, screenshot_path.to_str().unwrap());
        let screenshot_path_str = match screenshot_result {
            Ok(_) => {
                eprintln!("[原文细读] 第 {} 章截图成功: {}", idx + 1, screenshot_filename);
                Some(screenshot_path.to_string_lossy().to_string())
            }
            Err(e) => {
                eprintln!("[原文细读] 第 {} 章截图失败: {}", idx + 1, e);
                None
            }
        };

        chapters.push(Chapter {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            start_time,
            end_time,
            content,
            screenshot_path: screenshot_path_str,
            level: None,
            parent_id: None,
        });
    }

    eprintln!("[原文细读] 成功生成 {} 个章节", chapters.len());

    // 第四步：优化标题（添加层级信息）
    let _ = app.emit(
        event_name,
        GenerationEvent::TabProgress {
            tab_type: "DetailedReading".to_string(),
            current: total_chunks + 1,
            total: total_chunks + 2,
            message: "AI正在优化章节标题...".to_string(),
        },
    );

    if let Err(e) = optimize_chapter_titles(ai_config, &mut chapters, abort_flag).await {
        eprintln!("[原文细读] 标题优化失败: {}", e);
        // 标题优化失败不影响整体流程，继续返回结果
    }

    eprintln!("[原文细读] ========================================");

    Ok(ChapterData {
        chapters,
        total_duration,
        generated_at: chrono::Local::now().to_rfc3339(),
    })
}

// ============================================================================
// 主生成函数
// ============================================================================

/// 开始生成笔记内容
pub async fn generate_note(
    app: AppHandle,
    db: &Database,
    generation_id: String,
    request: GenerateNoteRequest,
) -> Result<(), String> {
    let event_name = format!("note-generation-{}", generation_id);
    let abort_flag = get_abort_flag(&generation_id).await;

    // 获取AI配置
    let ai_config = db
        .get_ai_config_by_id(request.model_id)
        .map_err(|e| e.to_string())?
        .ok_or("AI模型未找到")?;

    // 获取笔记
    let note = db
        .get_note_by_id(request.note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    // 检查字幕
    let subtitle_path = note
        .subtitle_path
        .ok_or("未上传字幕文件，无法生成笔记")?;

    // 解析字幕
    let entries = parse_subtitle_file(&subtitle_path)?;
    if entries.is_empty() {
        return Err("字幕内容为空".to_string());
    }

    // 合并字幕文本
    let subtitle_text: String = entries
        .iter()
        .map(|e| e.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

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
        cleanup_abort_flag(&generation_id).await;
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

    // 按顺序串行生成所有标签页（当 concurrent_limit = 1 时）
    if request.options.concurrent_limit == 1 {
        eprintln!("[笔记生成] 开始串行生成，标签页顺序: {:?}", tabs_to_generate);
        for tab_type in &tabs_to_generate {
            eprintln!("[笔记生成] 开始处理标签页: {:?}", tab_type);

            // 检查是否被中止
            if abort_flag.load(Ordering::Relaxed) {
                let _ = app.emit(&event_name, GenerationEvent::Aborted {
                    reason: "用户中止".to_string(),
                });
                cleanup_abort_flag(&generation_id).await;
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

                // 使用与手动重新生成相同的高质量章节生成方法
                match crate::chapter::generate_chapters(
                    app.clone(),
                    db,
                    generation_id.clone(),
                    crate::chapter::GenerateChaptersRequest {
                        note_id: request.note_id,
                        model_id: request.model_id,
                        video_path: note.video_path.clone(),
                        subtitle_path: subtitle_path.clone(),
                        capture_screenshots: true,
                    },
                ).await {
                    Ok(chapter_data) => {
                        eprintln!("[笔记生成] {:?} 生成完成", tab_type);
                        let content = serde_json::to_string(&chapter_data)
                            .map_err(|e| format!("序列化章节数据失败: {}", e))?;
                        update_note_tab(db, request.note_id, tab_type, &content, request.model_id)?;
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
                        eprintln!("[笔记生成] {:?} 生成失败: {}", tab_type, e);
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
                let result = generate_single_tab(
                    &app,
                    &event_name,
                    tab_type,
                    &ai_config,
                    &subtitle_text,
                    &abort_flag,
                    model_context_size,
                    tab_name,
                    request.options.custom_prompt.as_deref(),
                ).await;

                eprintln!("[笔记生成] {:?} 生成结果: success={}", tab_type, result.success);

                if result.success {
                    generated_count += 1;
                    if let Err(e) = update_note_tab(db, request.note_id, tab_type, &result.content, request.model_id) {
                        eprintln!("[笔记生成] 更新数据库失败: {}", e);
                        failed_count += 1;
                    }
                } else {
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

        // 处理 DetailedReading（生成章节数据）
        if has_detailed_reading {
        let _ = app.emit(
            &event_name,
            GenerationEvent::TabStarted {
                tab_type: "DetailedReading".to_string(),
                tab_name: "原文细读".to_string(),
            },
        );

        match generate_detailed_reading_chapters(
            &app,
            &event_name,
            &ai_config,
            &entries,
            &note.video_path,
            request.note_id,
            &abort_flag,
        ).await {
            Ok(chapter_data) => {
                // 序列化为 JSON 存储
                let content = serde_json::to_string(&chapter_data)
                    .map_err(|e| format!("序列化章节数据失败: {}", e))?;

                update_note_tab(db, request.note_id, &TabType::DetailedReading, &content, request.model_id)?;

                let _ = app.emit(
                    &event_name,
                    GenerationEvent::TabCompleted {
                        tab_type: "DetailedReading".to_string(),
                        content,
                    },
                );
                generated_count += 1;
            }
            Err(e) => {
                let _ = app.emit(
                    &event_name,
                    GenerationEvent::TabError {
                        tab_type: "DetailedReading".to_string(),
                        error: e,
                    },
                );
                failed_count += 1;
            }
        }
    }

    // 并发生成其他标签页（使用配置的并发数）
    if !other_tabs.is_empty() {
        let semaphore = Arc::new(Semaphore::new(request.options.concurrent_limit));
        let mut tasks = Vec::new();

        for tab_type in other_tabs {
            let semaphore = semaphore.clone();
            let app = app.clone();
            let event_name = event_name.clone();
            let ai_config = ai_config.clone();
            let subtitle_text = subtitle_text.clone();
            let abort_flag = abort_flag.clone();
            let tab_name = get_tab_name(&tab_type);
            let custom_prompt = request.options.custom_prompt.clone();

            let task = tokio::spawn(async move {
                // 获取信号量许可（控制标签页级别的并发）
                let _permit = match semaphore.acquire().await {
                    Ok(permit) => permit,
                    Err(e) => {
                        eprintln!("[笔记生成] 获取信号量失败: {}", e);
                        return TabResult {
                            tab_type,
                            content: String::new(),
                            success: false,
                            error: Some(format!("获取信号量失败: {}", e)),
                        };
                    }
                };

                // 执行生成
                generate_single_tab(
                    &app,
                    &event_name,
                    &tab_type,
                    &ai_config,
                    &subtitle_text,
                    &abort_flag,
                    model_context_size,
                    tab_name,
                    custom_prompt.as_deref(),
                ).await
            });

            tasks.push(task);
        }

        // 等待所有任务完成
        for task in tasks {
            match task.await {
                Ok(result) => {
                    if result.success {
                        generated_count += 1;
                        // 更新数据库
                        if let Err(e) = update_note_tab(db, request.note_id, &result.tab_type, &result.content, request.model_id) {
                            eprintln!("[笔记生成] 更新数据库失败: {}", e);
                            failed_count += 1;
                        }
                    } else {
                        failed_count += 1;
                    }
                }
                Err(e) => {
                    // 任务 panic 或被取消，记录错误但继续处理其他任务
                    eprintln!("[笔记生成] 任务执行异常: {}", e);
                    failed_count += 1;
                }
            }
        }
    }
    } // 结束 else 分支（并发生成）

    // 发送完成事件
    let _ = app.emit(
        &event_name,
        GenerationEvent::AllCompleted {
            generated: generated_count,
            failed: failed_count,
            total: generated_count + failed_count,
        },
    );

    cleanup_abort_flag(&generation_id).await;

    // 生成建议问题（在所有标签页完成后）
    eprintln!("[笔记生成] 开始生成建议问题: note_id={}", request.note_id);
    if let Err(e) = generate_questions_for_note_internal(db, request.note_id).await {
        eprintln!("[笔记生成] 生成建议问题失败: {}", e);
    } else {
        eprintln!("[笔记生成] 建议问题生成完成: note_id={}", request.note_id);
    }

    // 通知任务队列：任务完成
    if let Err(e) = crate::init_task_queue::complete_init_task(app.clone(), request.note_id).await {
        eprintln!("[笔记生成] 通知任务队列失败: {}", e);
    }

    Ok(())
}

/// 生成单个标签页内容
async fn generate_single_tab(
    app: &AppHandle,
    event_name: &str,
    tab_type: &TabType,
    ai_config: &AiConfig,
    subtitle_text: &str,
    abort_flag: &Arc<AtomicBool>,
    model_context_size: usize,
    tab_name: String,
    custom_prompt: Option<&str>,
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
            generate_full_summary_layered(ai_config, subtitle_text, abort_flag, event_name, app, custom_prompt).await
        }
        _ => {
            // 使用自定义提示词或默认提示词
            let prompt = if let Some(custom) = custom_prompt {
                // 自定义提示词需要包含字幕内容
                format!("{}\n\n视频字幕内容：\n{}", custom, subtitle_text)
            } else {
                get_prompt_for_tab(tab_type, subtitle_text)
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

    // 后处理（如JSON解析验证）
    let processed_content = match post_process_content(tab_type, &content) {
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
fn post_process_content(tab_type: &TabType, content: &str) -> Result<String, String> {
    match tab_type {
        TabType::FullSummary => {
            // 直接返回清理后的 Markdown 内容
            Ok(content.trim().to_string())
        }
        _ => Ok(content.trim().to_string()),
    }
}

/// 更新笔记的标签页内容到数据库
fn update_note_tab(
    db: &Database,
    note_id: i64,
    tab_type: &TabType,
    content: &str,
    model_id: i64,
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
    }

    // 同时更新 model_id，确保使用的模型被记录
    note.model_id = Some(model_id);

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
    }
}

/// 获取标签页对应的提示词
fn get_prompt_for_tab(tab_type: &TabType, subtitle_text: &str) -> String {
    match tab_type {
        TabType::FullSummary => PromptTemplates::full_summary(subtitle_text),
        TabType::DetailedReading => unreachable!("DetailedReading 已在 generate_note 中单独处理"),
        TabType::Highlights => PromptTemplates::highlights(subtitle_text),
        TabType::VisualSummary => PromptTemplates::visual_summary(subtitle_text),
        TabType::CustomSummary => PromptTemplates::custom_summary(subtitle_text),
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

            // 第一段（current_start == 0）且没有前置标记时，screenshot_path 为 None
            let screenshot_path = if current_start == 0 {
                None // 第一段需要自动截图
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

    #[derive(Deserialize)]
    struct ChapterContentResponse {
        title: String,
        content: String,
    }

    let parsed: ChapterContentResponse = serde_json::from_str(clean_json)
        .map_err(|e| format!("JSON解析失败: {}, JSON内容: {}", e, clean_json))?;

    Ok((parsed.title, parsed.content))
}

/// 使用辅助模式标记生成章节
/// 
/// 该函数根据用户在辅助模式下添加的截图标记来分段生成章节，
/// 而不是使用 AI 自动分段。
pub async fn generate_chapters_with_markers(
    app: AppHandle,
    db: &Database,
    generation_id: String,
    note_id: i64,
    model_id: i64,
    video_path: String,
    subtitle_path: String,
    markers: Vec<ScreenshotMarker>,
) -> Result<ChapterData, String> {
    let event_name = format!("chapter-generation-{}", generation_id);

    // 注册中止标志
    let abort_flag = get_ai_pool_manager().register_abort_flag(generation_id.clone()).await;

    // 获取 AI 配置
    let ai_config = db
        .get_ai_config_by_id(model_id)
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

    eprintln!("[辅助模式章节生成] 字幕总条数: {}, 标记数: {}", subtitle_entries.len(), markers.len());

    // 根据标记计算分段
    let segments = calculate_segments_from_markers(&subtitle_entries, &markers);
    let total_segments = segments.len();

    eprintln!("[辅助模式章节生成] 计算得到 {} 个分段", total_segments);

    // 准备截图目录
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let screenshots_dir = cache_dir.join("notes").join(note_id.to_string()).join("screenshots");
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

            eprintln!("[辅助模式章节生成] 处理第 {}/{} 段，字幕索引范围: [{}, {})",
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
            let req = NonStreamingRequest {
                config: ai_config,
                prompt,
            };

            let (title, content) = match execute_non_streaming_with_abort(req, &abort_flag).await {
                Ok(response) => {
                    match parse_chapter_content_response(&response.content) {
                        Ok((t, c)) => (t, c),
                        Err(e) => {
                            eprintln!("[辅助模式章节生成] 第 {} 段解析失败: {}", segment_idx + 1, e);
                            // 使用默认标题和内容
                            (format!("章节 {}", segment_idx + 1), subtitle_text.chars().take(200).collect())
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[辅助模式章节生成] 第 {} 段 AI 调用失败: {}", segment_idx + 1, e);
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
                        eprintln!("[辅助模式章节生成] 第 {} 段自动截图成功: {}", segment_idx + 1, screenshot_filename);
                        Some(screenshot_path.to_string_lossy().to_string())
                    }
                    Err(e) => {
                        eprintln!("[辅助模式章节生成] 第 {} 段自动截图失败: {}", segment_idx + 1, e);
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
                eprintln!("[辅助模式章节生成] 任务执行出错: {}", e);
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

    eprintln!("[辅助模式章节生成] 成功生成 {} 个章节", chapters.len());

    // 优化标题（添加层级信息）
    let _ = app.emit(&event_name, ChapterGenerationEvent::AnalyzingSubtitle {
        message: "AI正在优化章节标题...".to_string(),
    });

    if let Err(e) = optimize_chapter_titles(&ai_config, &mut chapters, &abort_flag).await {
        eprintln!("[辅助模式章节生成] 标题优化失败: {}", e);
        // 标题优化失败不影响整体流程，继续返回结果
    }

    // 构建结果
    let chapter_data = ChapterData {
        total_duration,
        generated_at: chrono::Local::now().to_rfc3339(),
        chapters,
    };

    // 发送完成事件
    let _ = app.emit(&event_name, ChapterGenerationEvent::Completed {
        chapter_data: chapter_data.clone(),
    });

    // 清理
    get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;

    Ok(chapter_data)
}

// ============================================================================
// 建议问题生成（内部函数）
// ============================================================================

/// 为笔记生成建议问题（内部函数，供 generate_note 调用）
async fn generate_questions_for_note_internal(
    db: &Database,
    note_id: i64,
) -> Result<(), String> {
    // 获取笔记
    let note = db
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记未找到")?;

    // 默认问题
    let default_questions = vec![
        "这个视频的核心内容是什么?".to_string(),
        "有哪些关键知识点?".to_string(),
        "如何在实际项目中应用?".to_string(),
    ];

    // 检查字幕和模型是否存在
    let subtitle_path = match &note.subtitle_path {
        Some(p) => p.clone(),
        None => {
            // 没有字幕，保存并返回默认问题
            let questions_json = serde_json::to_string(&default_questions)
                .map_err(|e| e.to_string())?;
            db.update_note_questions(note_id, &questions_json)
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    let model_id = match note.model_id {
        Some(id) => id,
        None => {
            // 没有模型，保存并返回默认问题
            let questions_json = serde_json::to_string(&default_questions)
                .map_err(|e| e.to_string())?;
            db.update_note_questions(note_id, &questions_json)
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    // 生成问题（失败时使用默认问题）
    let questions = crate::chat::generate_suggested_questions(db, &subtitle_path, model_id)
        .await
        .unwrap_or_else(|e| {
            eprintln!("[建议问题生成] 生成失败: {}", e);
            default_questions.clone()
        });

    // 保存到数据库
    let questions_json = serde_json::to_string(&questions)
        .map_err(|e| e.to_string())?;
    db.update_note_questions(note_id, &questions_json)
        .map_err(|e| e.to_string())?;

    Ok(())
}
