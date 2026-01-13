//! 章节生成模块
//!
//! 功能：
//! - AI 分析字幕生成章节
//! - ffmpeg 截图捕获
//! - 章节数据结构管理

use crate::ai_pool::{execute_non_streaming_with_abort, get_ai_pool_manager, NonStreamingRequest};
use crate::db::AiConfig;
use crate::subtitle::{parse_subtitle_file, SubtitleEntry};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

// ============================================================================
// 数据结构定义
// ============================================================================

/// 章节数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub start_time: f64,
    pub end_time: f64,
    pub content: String,
    pub screenshot_path: Option<String>,
}

/// 章节数据容器
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChapterData {
    pub chapters: Vec<Chapter>,
    pub total_duration: f64,
    pub generated_at: String,
}

/// 章节生成请求
#[derive(Debug, Deserialize)]
pub struct GenerateChaptersRequest {
    #[allow(dead_code)]
    pub note_id: i64,
    pub model_id: i64,
    pub video_path: String,
    pub subtitle_path: String,
    pub capture_screenshots: bool,
}

/// 章节生成进度事件
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "status")]
pub enum ChapterGenerationEvent {
    Starting,
    AnalyzingSubtitle { message: String },
    GeneratingChapters { current: usize, total: usize, message: String },
    CapturingScreenshots { current: usize, total: usize, message: String },
    Completed { chapter_data: ChapterData },
    #[allow(dead_code)]
    Error { error: String },
    #[allow(dead_code)]
    Aborted,
}

// ============================================================================
// AI 章节分割
// ============================================================================

/// AI 章节分析响应结构
#[derive(Debug, Deserialize)]
struct AIChapterResponse {
    chapters: Vec<AIChapter>,
}

#[derive(Debug, Deserialize)]
struct AIChapter {
    title: String,
    start_index: usize,
    end_index: usize,
    summary: String,
}

/// 生成章节分割提示词
fn build_chapter_prompt(subtitle_text: &str) -> String {
    format!(
        r#"你是一个专业的视频内容分析师。请分析以下视频字幕，将其分割为逻辑清晰的章节。

要求：
1. 根据内容主题变化分割章节
2. 每个章节要有明确的主题
3. 章节数量建议：5-15个（根据视频长度调整）
4. 为每个章节生成简洁的标题（10字以内）
5. 为每个章节生成简短的内容概要（50字以内）

输出格式（必须是有效的JSON，不要使用代码块标记）：
{{
  "chapters": [
    {{
      "title": "章节标题",
      "start_index": 0,
      "end_index": 50,
      "summary": "本章内容概要"
    }}
  ]
}}

视频字幕内容（每行格式为 [索引] 字幕内容）：
{}"#,
        subtitle_text
    )
}

/// AI 分析字幕生成章节
async fn analyze_subtitle_for_chapters(
    ai_config: &AiConfig,
    subtitle_entries: &[SubtitleEntry],
    abort_flag: &Arc<AtomicBool>,
) -> Result<Vec<AIChapter>, String> {
    // 合并字幕文本（带索引），每100条字幕为一组
    let chunk_size = 100;
    let mut chunks = Vec::new();

    for (chunk_idx, entry_chunk) in subtitle_entries.chunks(chunk_size).enumerate() {
        let chunk_text: String = entry_chunk
            .iter()
            .map(|e| format!("[{}] {}", e.index, e.text))
            .collect::<Vec<_>>()
            .join("\n");

        chunks.push((chunk_idx, chunk_text));
    }

    // 如果字幕较少，直接分析
    let subtitle_with_index: String = if chunks.len() <= 3 {
        chunks.iter().map(|(_, text)| text.as_str()).collect::<Vec<_>>().join("\n")
    } else {
        // 字幕较多，先采样分析
        chunks
            .iter()
            .step_by(2)
            .map(|(_, text)| text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt = build_chapter_prompt(&subtitle_with_index);

    let req = NonStreamingRequest {
        config: ai_config.clone(),
        prompt,
    };

    let response = execute_non_streaming_with_abort(req, abort_flag).await?;

    // 解析 AI 响应
    parse_chapter_ai_response(&response.content, subtitle_entries.len())
}

/// 解析 AI 响应
fn parse_chapter_ai_response(
    response: &str,
    _total_entries: usize,
) -> Result<Vec<AIChapter>, String> {
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

    let ai_response: AIChapterResponse = serde_json::from_str(clean_json)
        .map_err(|e| format!("JSON解析失败: {}, JSON内容: {}", e, clean_json))?;

    if ai_response.chapters.is_empty() {
        return Err("AI未生成任何章节".to_string());
    }

    Ok(ai_response.chapters)
}

// ============================================================================
// 截图捕获
// ============================================================================

/// 使用 ffmpeg 捕获视频截图
pub fn capture_video_screenshot(
    video_path: &str,
    timestamp: f64,
    output_path: &str,
) -> Result<(), String> {
    // 格式化时间戳为 HH:MM:SS.mmm
    let hours = (timestamp / 3600.0) as u32;
    let minutes = ((timestamp % 3600.0) / 60.0) as u32;
    let seconds = (timestamp % 60.0) as f64;
    let time_str = format!("{:02}:{:02}:{:06.3}", hours, minutes, seconds);

    let output = Command::new("ffmpeg")
        .args([
            "-y",                          // 覆盖输出
            "-ss", &time_str,              // 时间戳位置
            "-i", video_path,              // 输入文件
            "-frames:v", "1",              // 只截取一帧
            "-q:v", "2",                   // 高质量
            output_path,
        ])
        .output()
        .map_err(|e| format!("ffmpeg执行失败: {}。请确保已安装ffmpeg。", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg截图失败: {}", stderr));
    }

    Ok(())
}

/// 为所有章节生成截图
async fn capture_chapter_screenshots(
    video_path: &str,
    chapters: &mut [Chapter],
    app: &AppHandle,
    abort_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let screenshots_dir = cache_dir.join("chapter_screenshots");
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;

    for (i, chapter) in chapters.iter_mut().enumerate() {
        if abort_flag.load(Ordering::Relaxed) {
            return Err("已中止".to_string());
        }

        let screenshot_path = screenshots_dir.join(format!("chapter_{}.jpg", chapter.id));

        match capture_video_screenshot(&video_path, chapter.start_time, screenshot_path.to_str().unwrap()) {
            Ok(_) => {
                chapter.screenshot_path = Some(screenshot_path.to_string_lossy().to_string());
            }
            Err(e) => {
                eprintln!("[章节截图] 第 {} 张截图失败: {}", i + 1, e);
                // 继续处理下一张，不中断
            }
        }
    }

    Ok(())
}

// ============================================================================
// 主生成函数
// ============================================================================

/// 生成章节
pub async fn generate_chapters(
    app: AppHandle,
    _db: &crate::db::Database,
    generation_id: String,
    request: GenerateChaptersRequest,
) -> Result<ChapterData, String> {
    let event_name = format!("chapter-generation-{}", generation_id);

    // 注册中止标志
    let abort_flag = get_ai_pool_manager().register_abort_flag(generation_id.clone()).await;

    // 获取 AI 配置
    let ai_config = _db
        .get_ai_config_by_id(request.model_id)
        .map_err(|e| e.to_string())?
        .ok_or("AI模型未找到".to_string())?;

    // 发送开始事件
    let _ = app.emit(&event_name, ChapterGenerationEvent::Starting);

    // 检查视频文件是否存在
    if !Path::new(&request.video_path).exists() {
        get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
        return Err("视频文件不存在".to_string());
    }

    // 检查字幕文件是否存在
    if !Path::new(&request.subtitle_path).exists() {
        get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
        return Err("字幕文件不存在".to_string());
    }

    // 解析字幕
    let _ = app.emit(&event_name, ChapterGenerationEvent::AnalyzingSubtitle {
        message: "正在解析字幕文件...".to_string(),
    });

    let subtitle_entries = parse_subtitle_file(&request.subtitle_path)?;
    if subtitle_entries.is_empty() {
        get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
        return Err("字幕内容为空".to_string());
    }

    // 计算总时长
    let total_duration = subtitle_entries.last().unwrap().end_time;

    // AI 分析生成章节
    let _ = app.emit(&event_name, ChapterGenerationEvent::GeneratingChapters {
        current: 0,
        total: 1,
        message: "AI正在分析视频内容，生成章节...".to_string(),
    });

    let ai_chapters = analyze_subtitle_for_chapters(&ai_config, &subtitle_entries, &abort_flag).await?;

    // 转换为 Chapter 结构
    let mut chapters: Vec<Chapter> = ai_chapters
        .into_iter()
        .enumerate()
        .map(|(_i, ai_ch)| {
            let start_time = if ai_ch.start_index < subtitle_entries.len() {
                subtitle_entries[ai_ch.start_index].start_time
            } else {
                0.0
            };

            let end_index = if ai_ch.end_index + 1 < subtitle_entries.len() {
                ai_ch.end_index + 1
            } else {
                subtitle_entries.len().saturating_sub(1)
            };

            let end_time = if end_index < subtitle_entries.len() {
                subtitle_entries[end_index].end_time
            } else {
                total_duration
            };

            Chapter {
                id: uuid::Uuid::new_v4().to_string(),
                title: ai_ch.title,
                start_time,
                end_time,
                content: ai_ch.summary,
                screenshot_path: None,
            }
        })
        .collect();

    // 按开始时间排序
    chapters.sort_by(|a, b| a.start_time.partial_cmp(&b.start_time).unwrap());

    // 截图
    if request.capture_screenshots {
        let total = chapters.len();
        for (i, _) in chapters.iter().enumerate() {
            if abort_flag.load(Ordering::Relaxed) {
                get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;
                return Err("已中止".to_string());
            }

            let _ = app.emit(&event_name, ChapterGenerationEvent::CapturingScreenshots {
                current: i + 1,
                total,
                message: format!("正在截取第 {}/{} 章节的视频画面...", i + 1, total),
            });
        }

        capture_chapter_screenshots(&request.video_path, &mut chapters, &app, &abort_flag).await?;
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

/// 中止章节生成
pub async fn abort_chapter_generation(generation_id: String) -> Result<(), String> {
    get_ai_pool_manager().abort_request(&generation_id).await
}
