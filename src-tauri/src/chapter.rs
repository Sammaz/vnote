//! 章节生成模块
//!
//! 功能：
//! - AI 分析字幕生成章节
//! - ffmpeg 截图捕获
//! - 章节数据结构管理

use crate::ai_pool::{execute_non_streaming_with_abort, get_ai_pool_manager, NonStreamingRequest};
use crate::db::AiConfig;
use crate::subtitle::{parse_subtitle_file, SubtitleEntry};
use crate::settings::{SettingsManager, keys, defaults};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

// ============================================================================
// 辅助函数
// ============================================================================

/// Create ffmpeg command with hidden console window on Windows
#[cfg(windows)]
fn ffmpeg_command() -> Command {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = Command::new("ffmpeg");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn ffmpeg_command() -> Command {
    Command::new("ffmpeg")
}

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
    /// 层级深度 (1 = 顶级章节, 2 = 子章节, 以此类推)
    #[serde(default)]
    pub level: Option<u32>,
    /// 父章节 ID (用于构建层级关系)
    #[serde(default)]
    pub parent_id: Option<String>,
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
    /// 章节生成进度事件
    /// - completed: 已完成的章节数（用于并发场景，递增显示）
    /// - total: 总章节数
    /// - message: 进度消息
    ChapterCompleted { completed: usize, total: usize, message: String },
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
pub struct AIChapterResponse {
    pub chapters: Vec<AIChapter>,
}

#[derive(Debug, Deserialize)]
pub struct AIChapter {
    pub title: String,
    pub start_index: usize,
    pub summary: String,
}

/// 生成章节分割提示词
pub fn build_chapter_prompt(subtitle_text: &str, is_chunk: bool, chunk_size: usize, chunk_info: Option<&str>) -> String {
    let chunk_hint = if is_chunk {
        format!("\n\n注意：这是视频的一个片段。{}", chunk_info.unwrap_or(""))
    } else {
        String::new()
    };

    format!(
        r#"你是一个专业的视频内容分析师。请分析以下视频字幕，将其分割为逻辑清晰的章节。

**核心要求**：

1. **章节定义**：每个章节是视频中的一个完整主题段落
2. **start_index 含义与限制**：
   - start_index 是该章节第一句字幕的索引（基于 0 开始）
   - **有效值范围**：必须严格在当前分段范围内，即 0 到 {} - 1
   - **绝对禁止**：start_index 不能等于或超过当前分段的字幕总数 {}
   - 例如：如果当前段有 {} 条字幕，有效的 start_index 是 0-{}，{} 是无效的
3. **章节结束**：每个章节的结束时间由**下一章节的开始时间**决定，最后一个章节到视频结束
4. **跳过开场白**：第一个章节不要从索引 0 或 1 开始，应该跳过：
   - 片头、标题、自我介绍
   - "大家好"、"欢迎来到"等客套话
   - 课程概述、 agenda 说明
   - 从**实质性内容**开始的地方划分第一个章节
5. **合理间隔**：章节之间要有足够的内容量，建议每章至少 30 秒以上的内容
6. **不限制数量**：根据视频内容自然划分，不要人为限制章节数量

**示例**（假设字幕前 100 行是开场白）：
{{
  "chapters": [
    {{
      "title": "核心概念介绍",
      "start_index": 120,    // 跳过前 120 行开场白，从实际内容开始
      "summary": "介绍课程的核心概念和基础知识"
    }},
    {{
      "title": "案例分析",
      "start_index": 285,    // 与上一章有少量间隔（字幕行）
      "summary": "通过具体案例讲解理论应用"
    }}
  ]
}}

**输出格式**（必须是有效的JSON，不要使用代码块标记）：
{{
  "chapters": [
    {{
      "title": "章节标题",
      "start_index": 数字，必须满足：0 ≤ start_index < {},
      "summary": "本章内容概要"
    }}
  ]
}}
{}
视频字幕内容（每行格式为 [索引] 字幕内容）：
{}"#,
        chunk_size, chunk_size, chunk_size, chunk_size - 1, chunk_size,
        chunk_size, chunk_hint, subtitle_text
    )
}

/// 字幕分段信息
pub struct SubtitleChunk {
    pub start_index: usize,  // 该段在原始字幕中的起始索引
    pub end_index: usize,    // 该段在原始字幕中的结束索引（不含）
    pub text: String,        // 该段的字幕文本（带索引）
}

/// 将字幕按字符数分段
/// 分段策略：先计算段数 = 总字数 / SEGMENT_SIZE + 1，再用总字数 / 段数得到每段目标大小
/// 每段的字幕索引从 0 开始（相对索引），便于 AI 处理和后续合并
pub fn split_subtitle_into_chunks(subtitle_entries: &[SubtitleEntry]) -> Vec<SubtitleChunk> {
    let segment_size = SettingsManager::get_int(keys::PROCESS_SEGMENT_SIZE, defaults::PROCESS_SEGMENT_SIZE);

    // 先计算总字符数
    let total_chars: usize = subtitle_entries.iter().map(|e| e.text.len() + 10).sum(); // +10 for "[idx] \n"

    // 如果总字符数小于 SEGMENT_SIZE，不分段
    if total_chars < segment_size {
        let text: String = subtitle_entries
            .iter()
            .enumerate()
            .map(|(i, e)| format!("[{}] {}\n", i, e.text))
            .collect();
        return vec![SubtitleChunk {
            start_index: 0,
            end_index: subtitle_entries.len(),
            text: text.trim().to_string(),
        }];
    }

    // 计算段数：总字数 / SEGMENT_SIZE + 1
    let num_chunks = total_chars / segment_size + 1;
    // 计算每段目标大小：总字数 / 段数（确保各段大小均匀）
    let target_chunk_size = total_chars / num_chunks;

    let mut chunks = Vec::new();
    let mut current_chunk_lines: Vec<String> = Vec::new();
    let mut current_chunk_char_count = 0;
    let mut current_chunk_start = 0;
    let mut relative_index = 0;  // 当前段内的相对索引

    for (i, entry) in subtitle_entries.iter().enumerate() {
        // 使用相对索引（从 0 开始），每段重新计数
        let line = format!("[{}] {}\n", relative_index, entry.text);
        let line_len = line.len();

        // 如果当前段加上新行会超过目标大小，且当前段不为空，则保存当前段
        if current_chunk_char_count + line_len > target_chunk_size && !current_chunk_lines.is_empty() {
            chunks.push(SubtitleChunk {
                start_index: current_chunk_start,
                end_index: i,
                text: current_chunk_lines.join("").trim().to_string(),
            });
            current_chunk_lines = Vec::new();
            current_chunk_char_count = 0;
            current_chunk_start = i;
            relative_index = 0;  // 新段重新从 0 开始
        }

        current_chunk_lines.push(line);
        current_chunk_char_count += line_len;
        relative_index += 1;
    }

    // 添加最后一段
    if !current_chunk_lines.is_empty() {
        chunks.push(SubtitleChunk {
            start_index: current_chunk_start,
            end_index: subtitle_entries.len(),
            text: current_chunk_lines.join("").trim().to_string(),
        });
    }

    chunks
}

/// AI 分析字幕生成章节（支持分段并发处理长字幕）
async fn analyze_subtitle_for_chapters(
    ai_config: &AiConfig,
    subtitle_entries: &[SubtitleEntry],
    abort_flag: &Arc<AtomicBool>,
    app: &AppHandle,
    event_name: &str,
) -> Result<Vec<AIChapter>, String> {
    // 将字幕分段
    let chunks = split_subtitle_into_chunks(subtitle_entries);
    let total_chunks = chunks.len();

    tracing::info!("[章节生成] 字幕总条数: {}, 分为 {} 段处理", subtitle_entries.len(), total_chunks);

    // 如果只有一段，直接处理
    if total_chunks == 1 {
        let chunk_size = chunks[0].end_index - chunks[0].start_index;
        let prompt = build_chapter_prompt(&chunks[0].text, false, chunk_size, None);
        let req = NonStreamingRequest {
            config: ai_config.clone(),
            prompt,
        };
        let response = execute_non_streaming_with_abort(req, abort_flag).await?;
        return parse_chapter_ai_response(&response.content, subtitle_entries.len());
    }

    // 多段并发处理：使用 tokio::spawn 并发生成章节（并发控制由 AI 线程池统一管理）
    let mut tasks = Vec::new();

    // 使用原子计数器跟踪已完成的任务数（用于并发场景下的递增进度显示）
    let completed_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for (chunk_idx, chunk) in chunks.into_iter().enumerate() {
        let ai_config = ai_config.clone();
        let abort_flag = abort_flag.clone();
        let app = app.clone();
        let event_name = event_name.to_string();
        let completed_count = completed_count.clone();

        let task = tokio::spawn(async move {
            // 检查中止
            if abort_flag.load(Ordering::Relaxed) {
                return Err::<(usize, usize, usize, Vec<AIChapter>), String>("已中止".to_string());
            }

            tracing::info!("[章节生成] 处理第 {}/{} 段，字幕索引范围: [{}, {})",
                chunk_idx + 1, total_chunks, chunk.start_index, chunk.end_index);

            let chunk_size = chunk.end_index - chunk.start_index;
            let chunk_info = format!(
                "这是第 {}/{} 段，共 {} 条字幕，索引从 0 到 {}。",
                chunk_idx + 1, total_chunks, chunk_size, chunk_size - 1
            );

            let prompt = build_chapter_prompt(&chunk.text, true, chunk_size, Some(&chunk_info));
            let req = NonStreamingRequest {
                config: ai_config,
                prompt,
            };

            let result = match execute_non_streaming_with_abort(req, &abort_flag).await {
                Ok(response) => {
                    match parse_chapter_ai_response(&response.content, chunk.end_index - chunk.start_index) {
                        Ok(chapters) => {
                            tracing::info!("[章节生成] 第 {} 段生成了 {} 个章节", chunk_idx + 1, chapters.len());
                            Ok((chunk_idx, chunk.start_index, chunk.end_index, chapters))
                        }
                        Err(e) => {
                            tracing::info!("[章节生成] 第 {} 段解析失败: {}", chunk_idx + 1, e);
                            Ok((chunk_idx, chunk.start_index, chunk.end_index, Vec::new()))
                        }
                    }
                }
                Err(e) => {
                    tracing::info!("[章节生成] 第 {} 段 AI 调用失败: {}", chunk_idx + 1, e);
                    Ok((chunk_idx, chunk.start_index, chunk.end_index, Vec::new()))
                }
            };

            // 任务完成后，递增完成计数并发送进度事件
            let completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = app.emit(&event_name, ChapterGenerationEvent::ChapterCompleted {
                completed,
                total: total_chunks,
                message: format!("已完成 {}/{} 段字幕分析", completed, total_chunks),
            });

            result
        });

        tasks.push(task);
    }

    // 等待所有任务完成并收集结果
    let mut results: Vec<(usize, usize, usize, Vec<AIChapter>)> = Vec::new();

    for task in tasks {
        match task.await {
            Ok(Ok(result)) => {
                results.push(result);
            }
            Ok(Err(e)) => {
                if e == "已中止" {
                    return Err(e);
                }
                // 其他错误继续处理
            }
            Err(e) => {
                tracing::info!("[章节生成] 任务执行出错: {}", e);
                // 继续处理其他任务
            }
        }
    }

    // 按 chunk_idx 排序结果
    results.sort_by_key(|(idx, _, _, _)| *idx);

    // 合并所有章节，调整索引偏移
    // 每个分段内的章节单独排序，然后按分段顺序拼接
    let mut all_chapters: Vec<AIChapter> = Vec::new();

    for (_chunk_idx, start_index, _end_index, mut chapters) in results {
        // 该分段内的章节按 start_index 排序
        chapters.sort_by_key(|c| c.start_index);

        for chapter in &mut chapters {
            // AI 返回的索引是基于当前段的，需要加上该段的起始偏移
            chapter.start_index += start_index;
        }
        all_chapters.extend(chapters);
    }

    if all_chapters.is_empty() {
        return Err("未能生成任何章节".to_string());
    }

    // 不再跨分段排序，保留分段顺序便于观察问题
    tracing::info!("[章节生成] 合并后共 {} 个章节（按分段顺序拼接）", all_chapters.len());

    Ok(all_chapters)
}

/// 解析 AI 响应
pub fn parse_chapter_ai_response(
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

    let output = ffmpeg_command()
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

/// 将特殊字符转换为下划线，生成安全的文件名
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        // 合并连续的下划线
        .split('_')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

/// 格式化时间戳为文件名格式（如 010130 表示 01:01:30）
pub fn format_timestamp_for_filename(seconds: f64) -> String {
    let total_seconds = seconds as u64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let secs = total_seconds % 60;

    format!("{:02}{:02}{:02}", hours, minutes, secs)
}

/// 为所有章节生成截图
async fn capture_chapter_screenshots(
    video_path: &str,
    chapters: &mut [Chapter],
    app: &AppHandle,
    abort_flag: &Arc<AtomicBool>,
    note_id: i64,
) -> Result<(), String> {
    // 按笔记 ID 组织截图目录：app_cache_dir/notes/{note_id}/screenshots/
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let screenshots_dir = cache_dir.join("notes").join(note_id.to_string()).join("screenshots");
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;

    // 从视频路径提取文件名（不含扩展名）
    let video_name = Path::new(video_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let safe_video_name = sanitize_filename(video_name);

    let total = chapters.len();
    tracing::info!("[章节截图] 开始为 {} 个章节生成截图，保存目录: {:?}", total, screenshots_dir);

    for (i, chapter) in chapters.iter_mut().enumerate() {
        if abort_flag.load(Ordering::Relaxed) {
            return Err("已中止".to_string());
        }

        // 截图命名：{视频名称}_{时间戳}.jpg
        let timestamp_str = format_timestamp_for_filename(chapter.start_time);
        let screenshot_filename = format!("{}_{}.jpg", safe_video_name, timestamp_str);
        let screenshot_path = screenshots_dir.join(&screenshot_filename);

        match capture_video_screenshot(video_path, chapter.start_time, screenshot_path.to_str().unwrap()) {
            Ok(_) => {
                chapter.screenshot_path = Some(screenshot_path.to_string_lossy().to_string());
                tracing::info!("[章节截图] 第 {}/{} 张截图成功: {}", i + 1, total, screenshot_filename);
            }
            Err(e) => {
                tracing::error!("[章节截图] 第 {}/{} 张截图失败: {}", i + 1, total, e);
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

    // AI 分析生成章节（进度事件在函数内部发送）
    let ai_chapters = analyze_subtitle_for_chapters(&ai_config, &subtitle_entries, &abort_flag, &app, &event_name).await?;

    // 转换为 Chapter 结构，end_time = 下一个章节的 start_time
    // 章节已按分段顺序拼接，直接按顺序设置结束时间
    let mut chapters: Vec<Chapter> = Vec::new();
    let chapter_count = ai_chapters.len();

    for i in 0..chapter_count {
        let ai_ch = &ai_chapters[i];
        
        // 第一个章节的开始时间强制设为 0（或第一条字幕的开始时间）
        // 这样可以确保不会丢失视频开头的字幕内容
        let start_time = if i == 0 {
            // 第一个章节从视频开头开始，使用第一条字幕的开始时间
            subtitle_entries.first().map(|e| e.start_time).unwrap_or(0.0)
        } else if ai_ch.start_index < subtitle_entries.len() {
            subtitle_entries[ai_ch.start_index].start_time
        } else {
            0.0
        };

        // 结束时间 = 下一个章节的开始时间，或视频总时长
        let end_time = if i + 1 < chapter_count {
            // 获取下一个章节的开始时间
            let next_ai_ch = &ai_chapters[i + 1];
            if next_ai_ch.start_index < subtitle_entries.len() {
                subtitle_entries[next_ai_ch.start_index].start_time
            } else {
                total_duration
            }
        } else {
            total_duration
        };

        chapters.push(Chapter {
            id: uuid::Uuid::new_v4().to_string(),
            title: ai_ch.title.clone(),
            start_time,
            end_time,
            content: ai_ch.summary.clone(),
            screenshot_path: None,
            level: None,
            parent_id: None,
        });
    }

    // 不再按时间排序，保留分段顺序便于观察问题

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

        capture_chapter_screenshots(&request.video_path, &mut chapters, &app, &abort_flag, request.note_id).await?;
    }

    // 构建结果
    let chapter_data = ChapterData {
        total_duration,
        generated_at: chrono::Local::now().to_rfc3339(),
        chapters,
    };

    // 发送完成事件
    tracing::info!("[章节生成] 准备发送 Completed 事件, event_name={}, 章节数={}", event_name, chapter_data.chapters.len());
    let emit_result = app.emit(&event_name, ChapterGenerationEvent::Completed {
        chapter_data: chapter_data.clone(),
    });
    tracing::info!("[章节生成] Completed 事件发送结果: {:?}", emit_result);

    // 清理
    get_ai_pool_manager().cleanup_abort_flag(&generation_id).await;

    Ok(chapter_data)
}

/// 中止章节生成
pub async fn abort_chapter_generation(generation_id: String) -> Result<(), String> {
    get_ai_pool_manager().abort_request(&generation_id).await
}
