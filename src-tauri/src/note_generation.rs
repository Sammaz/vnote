//! 笔记生成模块
//!
//! 负责根据视频字幕生成6个标签页的内容：
//! - 全文总结 (FullSummary)
//! - 原文细读 (DetailedReading)
//! - 高光笔记 (Highlights)
//! - 视觉化总结 (VisualSummary)
//! - 自定义总结 (CustomSummary)

use crate::ai_pool::{execute_non_streaming_with_abort, get_ai_pool_manager, NonStreamingRequest};
use crate::db::{AiConfig, Database};
use crate::subtitle::parse_subtitle_file;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};
use tauri::{AppHandle, Emitter};
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

/// 全文总结结构化数据（JSON格式）
#[derive(Debug, Serialize, Deserialize)]
pub struct FullSummaryData {
    #[serde(rename = "abstract")]
    pub abstract_field: String,
    pub highlights: Vec<HighlightItem>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qa_pairs: Option<Vec<QaPair>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thoughts: Option<Vec<String>>,
    pub glossary: Vec<GlossaryItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HighlightItem {
    pub emoji: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>, // 视频时间戳，格式如 00:01:23
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QaPair {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GlossaryItem {
    pub term: String,
    pub explanation: String,
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
    /// 全文总结提示词 - 返回JSON格式
    fn full_summary(subtitle_content: &str) -> String {
        format!(
            r#"你是一个专业的视频内容分析师。请分析以下视频字幕，生成一份结构化的全文总结。

输出要求：
1. 必须以JSON格式输出，不要有任何其他文字（包括markdown代码块标记）
2. JSON结构如下：
{{
  "abstract": "100-150字的摘要段落，概括视频核心内容",
  "highlights": [
    {{"emoji": "表情符号", "title": "亮点标题", "description": "详细描述"}},
    ...
    （共5个亮点）
  ],
  "tags": ["标签1", "标签2", "标签3"],
  "qa_pairs": [
    {{"question": "问题", "answer": "回答"}},
    ...
    （3个Q&A，如果是技术教学类视频）
  ],
  "thoughts": [
    "引导性的思考问题",
    ...
    （2个思考问题，如果是应用介绍类视频）
  ],
  "glossary": [
    {{"term": "术语", "explanation": "解释"}},
    ...
    （5个关键术语）
  ]
}}

内容要求：
- abstract: 简洁概括视频核心内容，让读者快速了解视频讲什么
- highlights: 提取最重要的5个知识点/亮点，每个包含emoji、标题和详细描述
- tags: 3-5个相关标签，用于分类和搜索
- qa_pairs: 技术教学类视频需要3个常见问题及答案，应用介绍类可省略（设为null）
- thoughts: 应用介绍类视频需要2个引导性思考问题，技术教学类可省略（设为null）
- glossary: 提取5个关键术语并解释

视频字幕内容：
{}"#,
            subtitle_content
        )
    }

    /// 原文细读提示词
    fn detailed_reading(subtitle_content: &str) -> String {
        format!(
            r#"你是一个专业的学习助手。请对以下视频字幕进行详细的细读分析。

输出要求：
1. 按视频内容的时间逻辑组织内容
2. 提取每个知识点的详细说明
3. 保留关键信息和示例
4. 使用Markdown格式输出

格式示例：
## 开场介绍

视频开场介绍了...
- 要点1
- 要点2

## 核心概念

详细讲解了...

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

    /// 基于框架生成完整总结的提示词
    fn framework_expand(framework: &str) -> String {
        format!(
            r#"基于以下视频摘要框架，生成完整的结构化全文总结。

摘要框架：
{}

请严格按照以下JSON格式输出（不要有任何其他文字，不要有markdown代码块标记）：

{{
  "abstract": "100-150字的摘要段落，概括视频核心内容",
  "highlights": [
    {{"emoji": "🔥", "title": "亮点标题1", "description": "详细描述该亮点的内容"}},
    {{"emoji": "💡", "title": "亮点标题2", "description": "详细描述该亮点的内容"}},
    {{"emoji": "📊", "title": "亮点标题3", "description": "详细描述该亮点的内容"}},
    {{"emoji": "🎯", "title": "亮点标题4", "description": "详细描述该亮点的内容"}},
    {{"emoji": "⚡", "title": "亮点标题5", "description": "详细描述该亮点的内容"}}
  ],
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
  "qa_pairs": [
    {{"question": "问题1", "answer": "回答1"}},
    {{"question": "问题2", "answer": "回答2"}},
    {{"question": "问题3", "answer": "回答3"}}
  ],
  "glossary": [
    {{"term": "术语1", "explanation": "解释1"}},
    {{"term": "术语2", "explanation": "解释2"}},
    {{"term": "术语3", "explanation": "解释3"}},
    {{"term": "术语4", "explanation": "解释4"}},
    {{"term": "术语5", "explanation": "解释5"}}
  ]
}}

要求：
1. abstract: 根据框架内容写100-150字的摘要
2. highlights: 提取5个最重要的亮点，每个亮点配合适的emoji
3. tags: 提取3-5个关键标签
4. qa_pairs: 生成3个常见问题及回答（可选，如果内容适合）
5. glossary: 提取5个关键术语及解释"#,
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
) -> GenerationStrategy {
    // 估算token数（中文约1.5字符/token，保守估计1:1）
    let estimated_tokens = subtitle_length + 3000; // 加上prompt和输出预留

    match (subtitle_length, tab_type) {
        // 短字幕：直接发送（效果最好）
        (len, _) if len < 10_000 => GenerationStrategy::Direct,

        // 中等长度 + 高上下文模型：直接发送（效果好）
        (len, _) if estimated_tokens < model_context_size * 8 / 10
            && model_context_size >= 32_000 =>
        {
            GenerationStrategy::Direct
        }

        // 全文总结 + 长字幕：分层递进（推荐）
        (_, TabType::FullSummary) if subtitle_length >= 30_000 => GenerationStrategy::Layered,

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
/// num_chunks: 期望的分段数量，如果为0则根据内容长度自动计算
fn split_subtitle_by_semantic(subtitle: &str, num_chunks: usize) -> Vec<String> {
    // 动态计算分段数：每段约10000字符
    let actual_num_chunks = if num_chunks == 0 {
        // 根据字幕长度动态计算，最小3段，最大20段
        let calculated = subtitle.len() / 10000;
        calculated.max(3).min(20)
    } else {
        num_chunks
    };

    if subtitle.len() < actual_num_chunks * 500 {
        // 内容太短，不需要分段
        return vec![subtitle.to_string()];
    }

    let chars_per_chunk = subtitle.len() / actual_num_chunks;
    let mut chunks = Vec::new();
    let mut last_split = 0;

    for _i in 1..actual_num_chunks {
        let target_pos = last_split + chars_per_chunk;
        // 确保 target_pos 在字符边界上
        let target_pos = floor_char_boundary(subtitle, target_pos);

        // 寻找最近的语义边界
        let split_pos = find_semantic_boundary(subtitle, target_pos)
            .unwrap_or(target_pos);

        // 确保 split_pos 在字符边界上
        let split_pos = ceil_char_boundary(subtitle, split_pos);

        if split_pos > last_split && split_pos < subtitle.len() {
            chunks.push(subtitle[last_split..split_pos].to_string());
            last_split = split_pos;
        }
    }

    // 添加最后一段
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
fn find_semantic_boundary(text: &str, around: usize) -> Option<usize> {
    // 确保边界在字符边界上
    let search_start = floor_char_boundary(text, around.saturating_sub(500));
    let search_end = ceil_char_boundary(text, (around + 500).min(text.len()));

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
async fn generate_full_summary_layered(
    ai_config: &AiConfig,
    full_subtitle: &str,
    abort_flag: &Arc<AtomicBool>,
    event_name: &str,
    app: &AppHandle,
    concurrent_limit: usize,
    custom_prompt: Option<&str>,
) -> Result<String, String> {
    // 将 event_name 转换为 String 以便在异步任务中使用
    let event_name = event_name.to_string();

    // 如果有自定义提示词，直接使用（跳过分层生成）
    if let Some(custom) = custom_prompt {
        let prompt = format!("{}\n\n视频字幕内容：\n{}", custom, full_subtitle);
        return call_ai_api(ai_config, &prompt, abort_flag).await;
    }

    // 第一层：动态分段生成摘要框架（传入0自动计算段数）
    let chunks = split_subtitle_by_semantic(full_subtitle, 0);
    let total_chunks = chunks.len();

    // 并发生成各段摘要
    let semaphore = Arc::new(Semaphore::new(concurrent_limit));
    let mut tasks = Vec::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let semaphore = semaphore.clone();
        let app = app.clone();
        let event_name_for_task = event_name.clone();
        let ai_config = ai_config.clone();
        let chunk = chunk.clone();
        let abort_flag = abort_flag.clone();
        let chunk_index = i;

        let task = tokio::spawn(async move {
            // 获取信号量（限制并发数）
            let _permit = semaphore.acquire().await.unwrap();

            // 检查中止
            if abort_flag.load(Ordering::Relaxed) {
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

            let prompt = PromptTemplates::chunk_summary(&chunk);
            match call_ai_api(&ai_config, &prompt, &abort_flag).await {
                Ok(summary) => Ok((summary, chunk_index)),
                Err(e) => Err(e),
            }
        });

        tasks.push(task);
    }

    // 等待所有任务完成
    let mut results = Vec::new();
    for task in tasks {
        match task.await {
            Ok(Ok((summary, index))) => {
                results.push((index, summary));
            }
            Ok(Err(e)) => {
                return Err(format!("分段生成失败: {}", e));
            }
            Err(e) => {
                return Err(format!("任务执行出错: {}", e));
            }
        }
    }

    // 按原始顺序排序
    results.sort_by_key(|(index, _)| *index);
    let chunk_summaries: Vec<String> = results.into_iter().map(|(_, summary)| summary).collect();

    // 合并得到框架摘要
    let framework_prompt = format!(
        "以下是视频各片段的摘要，请整合成一份连贯的整体摘要框架（1000字以内）：\n\n{}",
        chunk_summaries.join("\n\n---\n\n")
    );

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

    // 第二层：基于框架生成完整的结构化全文总结
    let final_prompt = PromptTemplates::framework_expand(&framework);

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

    // 验证JSON格式
    let cleaned_content = clean_json_output(&final_content);

    match serde_json::from_str::<FullSummaryData>(&cleaned_content) {
        Ok(_) => Ok(cleaned_content),
        Err(e) => Err(format!("JSON格式错误: {}", e)),
    }
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

    // 并发生成（使用配置的并发数）
    let semaphore = Arc::new(Semaphore::new(request.options.concurrent_limit));
    let mut tasks = Vec::new();

    for tab_type in tabs_to_generate {
        let semaphore = semaphore.clone();
        let app = app.clone();
        let event_name = event_name.clone();
        let ai_config = ai_config.clone();
        let subtitle_text = subtitle_text.clone();
        let abort_flag = abort_flag.clone();
        let tab_name = get_tab_name(&tab_type);
        let custom_prompt = request.options.custom_prompt.clone();

        let task = tokio::spawn(async move {
            // 获取信号量许可
            let _permit = semaphore.acquire().await.unwrap();

            // 执行生成
            generate_single_tab(
                &app,
                &event_name,
                &tab_type,
                &ai_config,
                &subtitle_text,
                &abort_flag,
                model_context_size,
                request.options.concurrent_limit,
                tab_name,
                custom_prompt.as_deref(),
            ).await
        });

        tasks.push(task);
    }

    // 等待所有任务完成
    let mut generated_count = 0;
    let mut failed_count = 0;

    for task in tasks {
        let result = task.await.unwrap();

        if result.success {
            generated_count += 1;
            // 更新数据库
            update_note_tab(db, request.note_id, &result.tab_type, &result.content)?;
        } else {
            failed_count += 1;
        }
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

    cleanup_abort_flag(&generation_id).await;
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
    concurrent_limit: usize,
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
    let strategy = select_strategy(subtitle_text.len(), *tab_type, model_context_size);

    // 执行生成
    let content_result = match strategy {
        GenerationStrategy::Layered if matches!(tab_type, TabType::FullSummary) => {
            generate_full_summary_layered(ai_config, subtitle_text, abort_flag, event_name, app, concurrent_limit, custom_prompt).await
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
            // 尝试解析为JSON，如果失败则返回原始内容（可能是自定义提示词的结果）
            let cleaned = clean_json_output(content);
            if let Ok(parsed) = serde_json::from_str::<FullSummaryData>(&cleaned) {
                // 重新序列化确保格式正确
                serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())
            } else {
                // JSON解析失败，返回清理后的原始内容
                Ok(cleaned)
            }
        }
        _ => Ok(content.trim().to_string()),
    }
}

/// 清理JSON输出（移除可能的markdown代码块标记）
fn clean_json_output(content: &str) -> String {
    let mut cleaned = content.trim();

    // 移除开头的 ```json
    if cleaned.starts_with("```json") {
        cleaned = cleaned["```json".len()..].trim();
    } else if cleaned.starts_with("```") {
        cleaned = cleaned["```".len()..].trim();
    }

    // 移除结尾的 ```
    if cleaned.ends_with("```") {
        cleaned = &cleaned[..cleaned.len() - 3];
    }

    cleaned.trim().to_string()
}

/// 更新笔记的标签页内容到数据库
fn update_note_tab(
    db: &Database,
    note_id: i64,
    tab_type: &TabType,
    content: &str,
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
        TabType::DetailedReading => PromptTemplates::detailed_reading(subtitle_text),
        TabType::Highlights => PromptTemplates::highlights(subtitle_text),
        TabType::VisualSummary => PromptTemplates::visual_summary(subtitle_text),
        TabType::CustomSummary => PromptTemplates::custom_summary(subtitle_text),
    }
}
