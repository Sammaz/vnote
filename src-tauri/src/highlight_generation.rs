//! 高光笔记生成模块
//!
//! 负责从视频字幕中提取高光片段：
//! - 默认高光 (default): 基于完整叙事与信息密度生成全片高光
//! - 情绪高点 (emotional): 抓取情绪爆点、语义冲突、破防片段
//! - 爆款片段 (viral): 挑选最有传播潜力的切片

use crate::ai_pool::{execute_non_streaming_with_abort, get_ai_pool_manager, NonStreamingRequest};
use crate::db::{AiConfig, Database};
use crate::subtitle::parse_subtitle_file;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use std::sync::OnceLock;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 高光类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HighlightType {
    Default,
    Emotional,
    Viral,
}

impl std::fmt::Display for HighlightType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HighlightType::Default => write!(f, "default"),
            HighlightType::Emotional => write!(f, "emotional"),
            HighlightType::Viral => write!(f, "viral"),
        }
    }
}

/// 高光片段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightSegment {
    pub id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub content: String,
    pub score: i32,
    pub highlight_type: HighlightType,
    pub topic_tags: Vec<String>,
}

/// 高光数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightData {
    pub highlights: Vec<HighlightSegment>,
    pub topic_tags: Vec<String>,
    pub total_duration: f64,
    pub generated_at: String,
}

/// 高光生成事件
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "status")]
pub enum HighlightGenerationEvent {
    Starting { total_segments: usize },
    SegmentStarted { segment_index: usize },
    SegmentCompleted { segment_index: usize, highlights: Vec<HighlightSegment> },
    SegmentFailed { segment_index: usize, error: String },
    AllCompleted { total_highlights: usize, topic_tags: Vec<String> },
    Aborted,
}

/// 高光生成请求
#[derive(Debug, Deserialize)]
pub struct GenerateHighlightsRequest {
    pub _note_id: i64,
    pub model_id: i64,
    pub subtitle_path: String,
    pub highlight_type: HighlightType,
    pub total_duration: f64,
}

// ============================================================================
// 全局中止标志管理
// ============================================================================

static HIGHLIGHT_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_abort_flags_lock() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    HIGHLIGHT_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn get_abort_flag(generation_id: &str) -> Arc<AtomicBool> {
    let pool_flag = get_ai_pool_manager().register_abort_flag(generation_id.to_string()).await;
    let mut flags = get_abort_flags_lock().lock().await;
    flags
        .entry(generation_id.to_string())
        .or_insert_with(|| pool_flag.clone())
        .clone()
}

async fn cleanup_abort_flag(generation_id: &str) {
    get_ai_pool_manager().cleanup_abort_flag(generation_id).await;
    let mut flags = get_abort_flags_lock().lock().await;
    flags.remove(generation_id);
}

// ============================================================================
// 提示词模板
// ============================================================================

struct HighlightPrompts;

impl HighlightPrompts {
    fn default_highlights(subtitle_content: &str, total_duration: f64) -> String {
        format!(
            r#"你是一个专业的视频内容分析师。请分析以下视频字幕片段，提取值得高光的精彩内容。

视频总时长：{:.0} 秒

要求：
1. 根据内容质量提取高光片段，数量不限（可以是0个、1个或多个）
2. 如果内容信息量不足或没有值得高光的内容，返回空数组 []
3. 每个片段应该是一个完整的知识点或观点
4. 评分标准：信息密度、观点独特性、实用价值

输出格式（JSON数组）：
```json
[
  {{
    "start_time": 开始时间（秒）,
    "end_time": 结束时间（秒）,
    "content": "高光内容摘要（50-100字）",
    "score": 评分（0-100）,
    "topic_tags": ["标签1", "标签2"]
  }}
]
```

只输出JSON数组，不要其他内容。如果没有值得高光的内容，直接输出 []

视频字幕：
{}"#,
            total_duration, subtitle_content
        )
    }

    fn emotional_highlights(subtitle_content: &str, total_duration: f64) -> String {
        format!(
            r#"你是一个专业的视频内容分析师，擅长捕捉情绪高点。请分析以下视频字幕片段，提取情绪爆点内容。

视频总时长：{:.0} 秒

重点关注：
1. 语义冲突、观点碰撞
2. 情绪转折、破防时刻
3. 真情流露、感人瞬间
4. 争议性观点、引发讨论的内容

要求：
1. 根据内容质量提取情绪高点片段，数量不限（可以是0个、1个或多个）
2. 如果内容没有明显的情绪高点，返回空数组 []
3. 评分标准：情绪强度、共鸣度、讨论潜力

输出格式（JSON数组）：
```json
[
  {{
    "start_time": 开始时间（秒）,
    "end_time": 结束时间（秒）,
    "content": "情绪高点内容摘要（50-100字）",
    "score": 评分（0-100）,
    "topic_tags": ["标签1", "标签2"]
  }}
]
```

只输出JSON数组，不要其他内容。如果没有情绪高点，直接输出 []

视频字幕：
{}"#,
            total_duration, subtitle_content
        )
    }

    fn viral_highlights(subtitle_content: &str, total_duration: f64) -> String {
        format!(
            r#"你是一个专业的短视频运营专家。请分析以下视频字幕片段，挑选有传播潜力的切片。

视频总时长：{:.0} 秒

评估维度：
1. 钩子强度：开头是否能抓住注意力
2. 情绪张力：是否能引发情绪共鸣
3. 反转/金句：是否有出人意料的观点或金句
4. 可复用性：是否适合二次创作

要求：
1. 根据内容质量提取有传播潜力的片段，数量不限（可以是0个、1个或多个）
2. 如果内容没有传播潜力，返回空数组 []
3. 每个片段时长建议 15-60 秒
4. 评分标准：传播潜力、完整性、独立性

输出格式（JSON数组）：
```json
[
  {{
    "start_time": 开始时间（秒）,
    "end_time": 结束时间（秒）,
    "content": "爆款片段内容摘要（50-100字）",
    "score": 评分（0-100）,
    "topic_tags": ["标签1", "标签2"]
  }}
]
```

只输出JSON数组，不要其他内容。如果没有传播潜力的内容，直接输出 []

视频字幕：
{}"#,
            total_duration, subtitle_content
        )
    }

    fn get_prompt(highlight_type: HighlightType, subtitle_content: &str, total_duration: f64) -> String {
        match highlight_type {
            HighlightType::Default => Self::default_highlights(subtitle_content, total_duration),
            HighlightType::Emotional => Self::emotional_highlights(subtitle_content, total_duration),
            HighlightType::Viral => Self::viral_highlights(subtitle_content, total_duration),
        }
    }
}

// ============================================================================
// 语义分段（复用 note_generation.rs 的逻辑）
// ============================================================================

const SEGMENT_SIZE: usize = 10000;

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

fn find_semantic_boundary_near(text: &str, around: usize, max_distance: usize) -> Option<usize> {
    let search_start = floor_char_boundary(text, around.saturating_sub(max_distance));
    let search_end = ceil_char_boundary(text, (around + max_distance).min(text.len()));

    if search_start >= search_end || search_start >= text.len() {
        return None;
    }

    let search_text = &text[search_start..search_end];

    for delimiter in ["。", "！", "？", "\n\n", "...\n", "；"] {
        if let Some(offset) = search_text.find(delimiter) {
            return Some(search_start + offset + delimiter.len());
        }
    }

    if let Some(pos) = search_text.rfind(' ') {
        return Some(search_start + pos + 1);
    }

    None
}

/// 语义分段（按字幕时间戳和语义边界）
/// 分段策略：先计算段数 = 字数 / SEGMENT_SIZE + 1，再用字数 / 段数得到每段目标大小
pub fn split_subtitle_by_semantic(subtitle: &str) -> Vec<String> {
    if subtitle.len() < SEGMENT_SIZE {
        return vec![subtitle.to_string()];
    }

    // 计算段数：字数 / SEGMENT_SIZE + 1
    let num_chunks = subtitle.len() / SEGMENT_SIZE + 1;
    // 计算每段目标大小：字数 / 段数（确保各段大小均匀）
    let target_chunk_size = subtitle.len() / num_chunks;

    let mut chunks = Vec::new();
    let mut last_split = 0;

    while last_split + target_chunk_size < subtitle.len() {
        let target_pos = last_split + target_chunk_size;
        let split_pos = find_semantic_boundary_near(subtitle, target_pos, target_chunk_size / 10)
            .unwrap_or(target_pos);
        let split_pos = ceil_char_boundary(subtitle, split_pos);

        if split_pos > last_split && split_pos > last_split + 1000 {
            chunks.push(subtitle[last_split..split_pos].to_string());
            last_split = split_pos;
        } else {
            let forced_pos = ceil_char_boundary(subtitle, target_pos);
            chunks.push(subtitle[last_split..forced_pos].to_string());
            last_split = forced_pos;
        }
    }

    if last_split < subtitle.len() {
        chunks.push(subtitle[last_split..].to_string());
    }

    if chunks.is_empty() {
        return vec![subtitle.to_string()];
    }

    chunks
}

// ============================================================================
// AI API 调用
// ============================================================================

async fn call_ai_api(
    ai_config: &AiConfig,
    prompt: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    let req = NonStreamingRequest {
        config: ai_config.clone(),
        prompt: prompt.to_string(),
    };

    let response = execute_non_streaming_with_abort(req, abort_flag).await?;

    if abort_flag.load(Ordering::Relaxed) {
        return Err("已中止".to_string());
    }

    Ok(response.content)
}

// ============================================================================
// 解析 AI 响应
// ============================================================================

fn parse_highlights_response(
    response: &str,
    highlight_type: HighlightType,
) -> Result<Vec<HighlightSegment>, String> {
    // 尝试提取 JSON 数组
    let json_str = extract_json_array(response)?;
    
    let raw_highlights: Vec<serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    let mut highlights = Vec::new();
    for item in raw_highlights {
        let segment = HighlightSegment {
            id: uuid::Uuid::new_v4().to_string(),
            start_time: item["start_time"].as_f64().unwrap_or(0.0),
            end_time: item["end_time"].as_f64().unwrap_or(0.0),
            content: item["content"].as_str().unwrap_or("").to_string(),
            score: item["score"].as_i64().unwrap_or(0) as i32,
            highlight_type,
            topic_tags: item["topic_tags"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
        };
        highlights.push(segment);
    }

    Ok(highlights)
}

fn extract_json_array(text: &str) -> Result<String, String> {
    // 尝试找到 JSON 数组
    if let Some(start) = text.find('[') {
        if let Some(end) = text.rfind(']') {
            if end > start {
                return Ok(text[start..=end].to_string());
            }
        }
    }
    
    // 尝试从代码块中提取
    if let Some(start) = text.find("```json") {
        let content_start = start + 7;
        if let Some(end) = text[content_start..].find("```") {
            let json_content = &text[content_start..content_start + end];
            if let Some(arr_start) = json_content.find('[') {
                if let Some(arr_end) = json_content.rfind(']') {
                    return Ok(json_content[arr_start..=arr_end].to_string());
                }
            }
        }
    }

    Err("无法从响应中提取 JSON 数组".to_string())
}

// ============================================================================
// 主生成函数
// ============================================================================

pub async fn generate_highlights(
    app: AppHandle,
    db: &Database,
    generation_id: String,
    request: GenerateHighlightsRequest,
) -> Result<HighlightData, String> {
    let event_name = format!("highlight-generation-{}", generation_id);
    let abort_flag = get_abort_flag(&generation_id).await;

    // 获取 AI 配置
    let ai_config = db
        .get_ai_config_by_id(request.model_id)
        .map_err(|e| e.to_string())?
        .ok_or("AI 模型未找到")?;

    // 解析字幕
    let entries = parse_subtitle_file(&request.subtitle_path)?;
    if entries.is_empty() {
        cleanup_abort_flag(&generation_id).await;
        return Err("字幕内容为空".to_string());
    }

    // 合并字幕文本
    let subtitle_text: String = entries
        .iter()
        .map(|e| format!("[{:.1}s] {}", e.start_time, e.text))
        .collect::<Vec<_>>()
        .join("\n");

    // 分段处理
    let chunks = split_subtitle_by_semantic(&subtitle_text);
    let total_segments = chunks.len();

    eprintln!("[高光生成] 开始生成 {:?} 类型高光", request.highlight_type);
    eprintln!("[高光生成] 字幕总长度: {} 字符，分为 {} 段", subtitle_text.len(), total_segments);

    // 发送开始事件
    let _ = app.emit(&event_name, HighlightGenerationEvent::Starting { total_segments });

    let mut all_highlights: Vec<HighlightSegment> = Vec::new();
    let mut all_topic_tags: Vec<String> = Vec::new();

    for (i, chunk) in chunks.iter().enumerate() {
        // 检查中止
        if abort_flag.load(Ordering::Relaxed) {
            let _ = app.emit(&event_name, HighlightGenerationEvent::Aborted);
            cleanup_abort_flag(&generation_id).await;
            return Err("已中止".to_string());
        }

        // 发送段开始事件
        let _ = app.emit(&event_name, HighlightGenerationEvent::SegmentStarted { segment_index: i });

        // 生成提示词
        let prompt = HighlightPrompts::get_prompt(request.highlight_type, chunk, request.total_duration);

        // 调用 AI
        match call_ai_api(&ai_config, &prompt, &abort_flag).await {
            Ok(response) => {
                match parse_highlights_response(&response, request.highlight_type) {
                    Ok(highlights) => {
                        // 收集主题标签
                        for h in &highlights {
                            for tag in &h.topic_tags {
                                if !all_topic_tags.contains(tag) {
                                    all_topic_tags.push(tag.clone());
                                }
                            }
                        }

                        let _ = app.emit(&event_name, HighlightGenerationEvent::SegmentCompleted {
                            segment_index: i,
                            highlights: highlights.clone(),
                        });

                        all_highlights.extend(highlights);
                    }
                    Err(e) => {
                        eprintln!("[高光生成] 段 {} 解析失败: {}", i, e);
                        let _ = app.emit(&event_name, HighlightGenerationEvent::SegmentFailed {
                            segment_index: i,
                            error: e,
                        });
                    }
                }
            }
            Err(e) => {
                eprintln!("[高光生成] 段 {} 生成失败: {}", i, e);
                let _ = app.emit(&event_name, HighlightGenerationEvent::SegmentFailed {
                    segment_index: i,
                    error: e.clone(),
                });

                if e.contains("已中止") {
                    let _ = app.emit(&event_name, HighlightGenerationEvent::Aborted);
                    cleanup_abort_flag(&generation_id).await;
                    return Err(e);
                }
            }
        }
    }

    // 按开始时间排序
    all_highlights.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap_or(std::cmp::Ordering::Equal));

    // 构建结果
    let highlight_data = HighlightData {
        highlights: all_highlights.clone(),
        topic_tags: all_topic_tags.clone(),
        total_duration: request.total_duration,
        generated_at: chrono::Utc::now().to_rfc3339(),
    };

    // 发送完成事件
    let _ = app.emit(&event_name, HighlightGenerationEvent::AllCompleted {
        total_highlights: all_highlights.len(),
        topic_tags: all_topic_tags,
    });

    cleanup_abort_flag(&generation_id).await;

    eprintln!("[高光生成] 完成，共生成 {} 个高光片段", all_highlights.len());

    Ok(highlight_data)
}

/// 中止高光生成
pub async fn abort_highlight_generation(generation_id: String) -> Result<(), String> {
    let flags = get_abort_flags_lock().lock().await;
    if let Some(flag) = flags.get(&generation_id) {
        flag.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("生成任务不存在".to_string())
    }
}
