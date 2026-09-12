use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

use crate::storage_paths;
use tokio::process::Command as TokioCommand;

const API_REQ_UPLOAD: &str = "https://member.bilibili.com/x/bcut/rubick-interface/resource/create";
const API_COMMIT_UPLOAD: &str =
    "https://member.bilibili.com/x/bcut/rubick-interface/resource/create/complete";
const API_CREATE_TASK: &str = "https://member.bilibili.com/x/bcut/rubick-interface/task";
const API_QUERY_RESULT: &str = "https://member.bilibili.com/x/bcut/rubick-interface/task/result";
const MAX_SEGMENT_DURATION_MS: i64 = 60 * 60 * 1000;

// 浏览器风格 UA + 预取 buvid3 Cookie，避免被 B 站网关 WAF 拦截（412）。
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BILIBILI_HOME: &str = "https://www.bilibili.com";

// 轮询采用渐进间隔：转录在前期不可能完成，高频轮询只会触发风控。
const POLL_MAX_ATTEMPTS: usize = 60;
const POLL_MAX_INTERVAL_SECS: u64 = 10;
// 查询接口被 WAF 拦截（412/429）时的退避重试参数。
const WAF_RETRY_MAX_ATTEMPTS: usize = 3;
const WAF_RETRY_BASE_DELAY_SECS: u64 = 30;
// WAF 惩罚期内请求全部失败，等待一段时间后再恢复。
const WAF_COOLDOWN_SECS: u64 = 60;

/// B 站接口返回的业务错误（HTTP 200 但 code != 0）。
#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    data: T,
}

#[derive(Debug, Deserialize)]
struct UploadData {
    in_boss_key: String,
    resource_id: String,
    upload_id: String,
    upload_urls: Vec<String>,
    per_size: usize,
}

#[derive(Debug, Deserialize)]
struct CommitData {
    download_url: String,
}

#[derive(Debug, Deserialize)]
struct TaskData {
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct TaskResultData {
    state: i64,
    result: Option<String>,
}

#[cfg(windows)]
fn async_ffmpeg_command() -> TokioCommand {
    #[allow(unused_imports)]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = TokioCommand::new("ffmpeg");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn async_ffmpeg_command() -> TokioCommand {
    TokioCommand::new("ffmpeg")
}

#[cfg(windows)]
fn async_ffprobe_command() -> TokioCommand {
    #[allow(unused_imports)]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = TokioCommand::new("ffprobe");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn async_ffprobe_command() -> TokioCommand {
    TokioCommand::new("ffprobe")
}

fn is_aborted(abort_flag: &Arc<AtomicBool>) -> bool {
    abort_flag.load(Ordering::Relaxed)
}

/// 判断响应是否被 B 站网关 WAF 拦截（412 预校验失败 / 429 限流）。
fn is_waf_rejected(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::PRECONDITION_FAILED || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

/// 带退避地执行一次 API 调用；遇到 412/429 时等待重试而不是直接失败。
/// WAF 惩罚通常持续几十秒，退避后可恢复，因此调用方无需重新上传。
async fn with_waf_retry<T, F, Fut>(label: &str, call: F) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<(reqwest::StatusCode, T), String>>,
{
    let mut attempt = 0;
    loop {
        let (status, value) = call().await?;

        if !is_waf_rejected(status) {
            return Ok(value);
        }

        attempt += 1;
        if attempt > WAF_RETRY_MAX_ATTEMPTS {
            return Err(format!(
                "{}失败: {}（WAF 拦截，重试 {} 次后放弃）",
                label, status, WAF_RETRY_MAX_ATTEMPTS
            ));
        }

        let delay = WAF_RETRY_BASE_DELAY_SECS * attempt as u64;
        tracing::warn!("[BCut] {}被 WAF 拦截（{}），{} 秒后重试 {}/{}", label, status, delay, attempt, WAF_RETRY_MAX_ATTEMPTS);
        tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
    }
}

fn ms_to_srt_time(ms: i64) -> String {
    let total_seconds = ms / 1000;
    let milliseconds = ms % 1000;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    let hours = minutes / 60;
    let minutes = minutes % 60;
    format!(
        "{:02}:{:02}:{:02},{:03}",
        hours, minutes, seconds, milliseconds
    )
}

fn ms_to_ffmpeg_time(ms: i64) -> String {
    format!("{:.3}", ms as f64 / 1000.0)
}

fn base_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("subtitle")
        .to_string()
}

async fn extract_audio_to_mp3(video_path: &str, audio_path: &Path) -> Result<(), String> {
    let output = async_ffmpeg_command()
        .arg("-y")
        .arg("-i")
        .arg(video_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("mp3")
        .arg(audio_path)
        .output()
        .await
        .map_err(|e| format!("ffmpeg执行失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("音频提取失败: {}", stderr));
    }

    Ok(())
}

async fn probe_audio_duration_ms(audio_path: &Path) -> Result<i64, String> {
    let output = async_ffprobe_command()
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(audio_path)
        .output()
        .await
        .map_err(|e| format!("ffprobe执行失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("读取音频时长失败: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let duration_secs = stdout
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("解析音频时长失败: {}", e))?;
    let duration_ms = (duration_secs * 1000.0).round() as i64;

    if duration_ms <= 0 {
        return Err("音频时长无效".to_string());
    }

    Ok(duration_ms)
}

fn build_segment_plan(total_duration_ms: i64) -> Vec<(i64, i64)> {
    if total_duration_ms <= 0 {
        return Vec::new();
    }

    if total_duration_ms <= MAX_SEGMENT_DURATION_MS {
        return vec![(0, total_duration_ms)];
    }

    let segment_count = (total_duration_ms + MAX_SEGMENT_DURATION_MS - 1) / MAX_SEGMENT_DURATION_MS;
    let mut segments = Vec::with_capacity(segment_count as usize);

    for index in 0..segment_count {
        let start_ms = index * total_duration_ms / segment_count;
        let end_ms = (index + 1) * total_duration_ms / segment_count;
        segments.push((start_ms, end_ms));
    }

    segments
}

async fn extract_audio_segment_to_mp3(
    source_audio_path: &Path,
    segment_audio_path: &Path,
    start_ms: i64,
    duration_ms: i64,
) -> Result<(), String> {
    if duration_ms <= 0 {
        return Err("音频分段时长无效".to_string());
    }

    let output = async_ffmpeg_command()
        .arg("-y")
        .arg("-ss")
        .arg(ms_to_ffmpeg_time(start_ms))
        .arg("-t")
        .arg(ms_to_ffmpeg_time(duration_ms))
        .arg("-i")
        .arg(source_audio_path)
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("mp3")
        .arg(segment_audio_path)
        .output()
        .await
        .map_err(|e| format!("ffmpeg执行失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("音频切分失败: {}", stderr));
    }

    Ok(())
}

async fn upload_audio(
    client: &Client,
    audio_bytes: &[u8],
) -> Result<(UploadData, Vec<String>), String> {
    let payload = json!({
        "type": 2,
        "name": "audio.mp3",
        "size": audio_bytes.len(),
        "ResourceFileType": "mp3",
        "model_id": "8"
    });

    let upload_data: UploadData = with_waf_retry("申请上传", || async {
        let resp = client
            .post(API_REQ_UPLOAD)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("申请上传失败: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            return Ok((status, Err(format!("申请上传失败: {}", status))));
        }

        let body: ApiResponse<UploadData> = resp
            .json()
            .await
            .map_err(|e| format!("解析上传响应失败: {}", e))?;
        if body.code != 0 {
            return Ok((
                status,
                Err(format!("申请上传失败: code={} {}", body.code, body.message)),
            ));
        }

        Ok((status, Ok(body.data)))
    })
    .await??;

    let mut etags = Vec::new();
    for (clip, url) in upload_data.upload_urls.iter().enumerate() {
        let start = clip * upload_data.per_size;
        let end = std::cmp::min(start + upload_data.per_size, audio_bytes.len());
        let chunk = &audio_bytes[start..end];

        let resp = client
            .put(url)
            .body(chunk.to_vec())
            .send()
            .await
            .map_err(|e| format!("上传分片失败: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("上传分片失败: {}", resp.status()));
        }

        if let Some(etag) = resp.headers().get("etag") {
            if let Ok(etag_str) = etag.to_str() {
                etags.push(etag_str.to_string());
            }
        }
    }

    Ok((upload_data, etags))
}

async fn commit_upload(
    client: &Client,
    upload_data: &UploadData,
    etags: &[String],
) -> Result<String, String> {
    let payload = json!({
        "InBossKey": upload_data.in_boss_key,
        "ResourceId": upload_data.resource_id,
        "Etags": etags.join(","),
        "UploadId": upload_data.upload_id,
        "model_id": "8"
    });

    with_waf_retry("提交上传", || async {
        let resp = client
            .post(API_COMMIT_UPLOAD)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("提交上传失败: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            return Ok((status, Err(format!("提交上传失败: {}", status))));
        }

        let body: ApiResponse<CommitData> = resp
            .json()
            .await
            .map_err(|e| format!("解析提交响应失败: {}", e))?;
        if body.code != 0 {
            return Ok((
                status,
                Err(format!("提交上传失败: code={} {}", body.code, body.message)),
            ));
        }

        Ok((status, Ok(body.data.download_url)))
    })
    .await?
}

async fn create_task(client: &Client, download_url: &str) -> Result<String, String> {
    let payload = json!({
        "resource": download_url,
        "model_id": "8"
    });

    with_waf_retry("创建任务", || async {
        let resp = client
            .post(API_CREATE_TASK)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("创建任务失败: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            return Ok((status, Err(format!("创建任务失败: {}", status))));
        }

        let body: ApiResponse<TaskData> = resp
            .json()
            .await
            .map_err(|e| format!("解析任务响应失败: {}", e))?;
        if body.code != 0 {
            return Ok((
                status,
                Err(format!("创建任务失败: code={} {}", body.code, body.message)),
            ));
        }

        Ok((status, Ok(body.data.task_id)))
    })
    .await?
}

/// 查询一次转录结果。
/// 返回 `Ok(Some(data))` 表示查询成功；`Ok(None)` 表示被 WAF 拦截（由轮询循环退避后重试）。
async fn query_result(client: &Client, task_id: &str) -> Result<Option<TaskResultData>, String> {
    let resp = client
        .get(API_QUERY_RESULT)
        .query(&[("model_id", "7"), ("task_id", task_id)])
        .send()
        .await
        .map_err(|e| format!("查询结果失败: {}", e))?;

    let status = resp.status();
    if is_waf_rejected(status) {
        return Ok(None);
    }

    if !status.is_success() {
        return Err(format!("查询结果失败: {}", status));
    }

    let body: ApiResponse<TaskResultData> = resp
        .json()
        .await
        .map_err(|e| format!("解析结果响应失败: {}", e))?;
    if body.code != 0 {
        return Err(format!("查询结果失败: code={} {}", body.code, body.message));
    }

    Ok(Some(body.data))
}

fn parse_ms(value: &serde_json::Value) -> Option<i64> {
    if let Some(v) = value.as_i64() {
        return Some(v);
    }
    value.as_f64().map(|v| v as i64)
}

fn build_srt_from_result(result_json: &serde_json::Value) -> Result<String, String> {
    let utterances = result_json
        .get("utterances")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "转录结果缺少 utterances".to_string())?;

    let mut lines = Vec::new();
    let mut index = 1;

    for utterance in utterances {
        let text = utterance
            .get("transcript")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        if text.is_empty() {
            continue;
        }

        let start_ms = utterance
            .get("start_time")
            .and_then(parse_ms)
            .ok_or_else(|| "转录结果缺少 start_time".to_string())?;
        let end_ms = utterance
            .get("end_time")
            .and_then(parse_ms)
            .ok_or_else(|| "转录结果缺少 end_time".to_string())?;

        let time_line = format!(
            "{} --> {}",
            ms_to_srt_time(start_ms),
            ms_to_srt_time(end_ms)
        );

        lines.push(format!("{}\n{}\n{}\n", index, time_line, text));
        index += 1;
    }

    if lines.is_empty() {
        return Err("转录结果为空".to_string());
    }

    Ok(lines.join("\n"))
}

fn parse_srt_timestamp_to_ms(value: &str) -> Result<i64, String> {
    let parts: Vec<&str> = value.trim().split(':').collect();
    if parts.len() != 3 {
        return Err(format!("无效的 SRT 时间戳: {}", value));
    }

    let second_parts: Vec<&str> = parts[2].split(',').collect();
    if second_parts.len() != 2 {
        return Err(format!("无效的 SRT 时间戳: {}", value));
    }

    let hours = parts[0]
        .parse::<i64>()
        .map_err(|e| format!("解析小时失败: {}", e))?;
    let minutes = parts[1]
        .parse::<i64>()
        .map_err(|e| format!("解析分钟失败: {}", e))?;
    let seconds = second_parts[0]
        .parse::<i64>()
        .map_err(|e| format!("解析秒失败: {}", e))?;
    let milliseconds = second_parts[1]
        .parse::<i64>()
        .map_err(|e| format!("解析毫秒失败: {}", e))?;

    Ok((((hours * 60) + minutes) * 60 + seconds) * 1000 + milliseconds)
}

fn offset_srt_content(
    srt_content: &str,
    offset_ms: i64,
    start_index: usize,
) -> Result<(String, usize), String> {
    let normalized = srt_content.replace("\r\n", "\n");
    let mut blocks = Vec::new();
    let mut current_index = start_index;

    for block in normalized.split("\n\n") {
        let trimmed = block.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut lines = trimmed.lines();
        lines
            .next()
            .ok_or_else(|| "SRT 字幕块缺少序号".to_string())?;
        let time_line = lines
            .next()
            .ok_or_else(|| "SRT 字幕块缺少时间轴".to_string())?;
        let (start_text, end_text) = time_line
            .split_once(" --> ")
            .ok_or_else(|| format!("无效的 SRT 时间轴: {}", time_line))?;

        let start_ms = parse_srt_timestamp_to_ms(start_text)? + offset_ms;
        let end_ms = parse_srt_timestamp_to_ms(end_text)? + offset_ms;
        let text = lines.collect::<Vec<_>>().join("\n");

        blocks.push(format!(
            "{}\n{} --> {}\n{}\n",
            current_index,
            ms_to_srt_time(start_ms),
            ms_to_srt_time(end_ms),
            text
        ));
        current_index += 1;
    }

    if blocks.is_empty() {
        return Err("SRT 内容为空".to_string());
    }

    Ok((blocks.join("\n"), current_index))
}

fn merge_srt_segments(segments: &[String]) -> Result<String, String> {
    let merged = segments
        .iter()
        .map(|segment| segment.trim())
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    if merged.is_empty() {
        return Err("没有可合并的字幕分段".to_string());
    }

    Ok(format!("{}\n", merged))
}

async fn transcribe_audio_file_to_srt_content(
    client: &Client,
    audio_path: &Path,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    if is_aborted(abort_flag) {
        return Err("已中止".to_string());
    }

    let audio_bytes = tokio::fs::read(audio_path)
        .await
        .map_err(|e| format!("读取音频失败: {}", e))?;

    let (upload_data, etags) = upload_audio(client, &audio_bytes).await?;
    let download_url = commit_upload(client, &upload_data, &etags).await?;
    let task_id = create_task(client, &download_url).await?;

    // 渐进轮询：2s 起步、每次 +1s、封顶 10s。长音频转录需要几十秒到几分钟，
    // 前期高频轮询不会更快拿到结果，只会触发 WAF（412）导致整个任务失败。
    let mut interval_secs = 2u64;
    let mut consecutive_waf_rejects = 0u32;

    for _ in 0..POLL_MAX_ATTEMPTS {
        if is_aborted(abort_flag) {
            return Err("已中止".to_string());
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;

        let result = query_result(client, &task_id).await?;
        match result {
            None => {
                // 被 WAF 拦截：等待冷却时间后退避重试，连续多次则放弃。
                consecutive_waf_rejects += 1;
                if consecutive_waf_rejects > WAF_RETRY_MAX_ATTEMPTS as u32 {
                    return Err(format!(
                        "查询结果失败: 412 Precondition Failed（WAF 拦截，重试 {} 次后放弃）",
                        WAF_RETRY_MAX_ATTEMPTS
                    ));
                }
                tracing::warn!(
                    "[BCut] 查询被 WAF 拦截，{} 秒后重试 {}/{}",
                    WAF_COOLDOWN_SECS,
                    consecutive_waf_rejects,
                    WAF_RETRY_MAX_ATTEMPTS
                );
                interval_secs = WAF_COOLDOWN_SECS;
                continue;
            }
            Some(data) => {
                consecutive_waf_rejects = 0;
                interval_secs = std::cmp::min(interval_secs + 1, POLL_MAX_INTERVAL_SECS);

                if data.state == 4 {
                    let result_str = data
                        .result
                        .ok_or_else(|| "转录结果缺少 result".to_string())?;
                    let result_json: serde_json::Value = serde_json::from_str(&result_str)
                        .map_err(|e| format!("解析转录结果失败: {}", e))?;
                    return build_srt_from_result(&result_json);
                }

                if data.state == 3 {
                    return Err("转录失败: B 站服务端识别出错（state=3）".to_string());
                }
            }
        }
    }

    Err("转录超时".to_string())
}

fn build_subtitle_dir(app: &AppHandle, note_id: &str) -> Result<PathBuf, String> {
    storage_paths::subtitle_dir(app, note_id)
}

/// 创建携带 Cookie 的 HTTP 客户端，并预取 bilibili.com 的 buvid3 Cookie。
/// 不带 Cookie 直接请求 member.bilibili.com 容易被网关 WAF 以 412 拦截。
async fn build_bcut_client() -> Result<Client, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .cookie_store(true)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let warmup = client
        .get(BILIBILI_HOME)
        .send()
        .await
        .map_err(|e| format!("预热 Cookie 失败: {}", e))?;
    if !warmup.status().is_success() {
        tracing::warn!("[BCut] 预热 Cookie 返回非 2xx: {}", warmup.status());
    }

    Ok(client)
}

pub async fn transcribe_video_to_srt(
    app: &AppHandle,
    note_id: &str,
    video_path: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    let subtitle_dir = build_subtitle_dir(app, note_id)?;
    tokio::fs::create_dir_all(&subtitle_dir)
        .await
        .map_err(|e| format!("创建字幕目录失败: {}", e))?;

    let base_name = base_name_from_path(video_path);
    let srt_path = subtitle_dir.join(format!("{}.srt", base_name));
    if srt_path.exists() {
        return Ok(srt_path.to_string_lossy().to_string());
    }

    let audio_path = subtitle_dir.join(format!("{}.mp3", base_name));
    if !audio_path.exists() {
        extract_audio_to_mp3(video_path, &audio_path).await?;
    }

    if is_aborted(abort_flag) {
        return Err("已中止".to_string());
    }

    let total_duration_ms = probe_audio_duration_ms(&audio_path).await?;
    let segment_plan = build_segment_plan(total_duration_ms);
    if segment_plan.is_empty() {
        return Err("音频分段计划为空".to_string());
    }

    let client = build_bcut_client().await?;

    let srt_content = if segment_plan.len() == 1 {
        transcribe_audio_file_to_srt_content(&client, &audio_path, abort_flag).await?
    } else {
        let mut merged_segments = Vec::with_capacity(segment_plan.len());
        let mut next_index = 1;

        for (segment_index, (start_ms, end_ms)) in segment_plan.iter().copied().enumerate() {
            if is_aborted(abort_flag) {
                return Err("已中止".to_string());
            }

            let duration_ms = end_ms - start_ms;
            let segment_audio_path =
                subtitle_dir.join(format!("{}.part{}.mp3", base_name, segment_index + 1));

            if !segment_audio_path.exists() {
                extract_audio_segment_to_mp3(
                    &audio_path,
                    &segment_audio_path,
                    start_ms,
                    duration_ms,
                )
                .await?;
            }

            let segment_srt =
                transcribe_audio_file_to_srt_content(&client, &segment_audio_path, abort_flag)
                    .await?;
            let (offset_segment_srt, updated_index) =
                offset_srt_content(&segment_srt, start_ms, next_index)?;
            merged_segments.push(offset_segment_srt);
            next_index = updated_index;
        }

        merge_srt_segments(&merged_segments)?
    };

    if is_aborted(abort_flag) {
        return Err("已中止".to_string());
    }

    tokio::fs::write(&srt_path, srt_content)
        .await
        .map_err(|e| format!("保存字幕失败: {}", e))?;
    Ok(srt_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_segment_plan, merge_srt_segments, offset_srt_content, parse_srt_timestamp_to_ms,
        MAX_SEGMENT_DURATION_MS,
    };

    #[test]
    fn build_segment_plan_keeps_short_audio_as_single_segment() {
        let segments = build_segment_plan(59 * 60 * 1000);
        assert_eq!(segments, vec![(0, 59 * 60 * 1000)]);
    }

    #[test]
    fn build_segment_plan_keeps_exactly_one_hour_as_single_segment() {
        let segments = build_segment_plan(MAX_SEGMENT_DURATION_MS);
        assert_eq!(segments, vec![(0, MAX_SEGMENT_DURATION_MS)]);
    }

    #[test]
    fn build_segment_plan_splits_audio_slightly_over_one_hour() {
        let total_duration_ms = MAX_SEGMENT_DURATION_MS + 1000;
        let segments = build_segment_plan(total_duration_ms);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0], (0, 1_800_500));
        assert_eq!(segments[1], (1_800_500, total_duration_ms));
    }

    #[test]
    fn build_segment_plan_splits_seventy_minutes_into_two_equal_parts() {
        let total_duration_ms = 70 * 60 * 1000;
        let segments = build_segment_plan(total_duration_ms);
        assert_eq!(
            segments,
            vec![(0, 35 * 60 * 1000), (35 * 60 * 1000, total_duration_ms)]
        );
    }

    #[test]
    fn build_segment_plan_splits_one_hundred_twenty_five_minutes_into_three_parts() {
        let total_duration_ms = 125 * 60 * 1000;
        let segments = build_segment_plan(total_duration_ms);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0], (0, 2_500_000));
        assert_eq!(segments[1], (2_500_000, 5_000_000));
        assert_eq!(segments[2], (5_000_000, total_duration_ms));
    }

    #[test]
    fn parse_srt_timestamp_to_ms_parses_valid_timestamp() {
        let value = parse_srt_timestamp_to_ms("01:02:03,456").unwrap();
        assert_eq!(value, 3_723_456);
    }

    #[test]
    fn offset_srt_content_shifts_timestamps_and_renumbers_indices() {
        let srt = "1\n00:00:01,000 --> 00:00:03,000\n第一行\n\n2\n00:00:05,500 --> 00:00:06,250\n第二行\n";
        let (shifted, next_index) = offset_srt_content(srt, 35 * 60 * 1000, 7).unwrap();

        assert_eq!(next_index, 9);
        assert!(shifted.contains("7\n00:35:01,000 --> 00:35:03,000\n第一行"));
        assert!(shifted.contains("8\n00:35:05,500 --> 00:35:06,250\n第二行"));
    }

    #[test]
    fn merge_srt_segments_combines_non_empty_segments() {
        let merged = merge_srt_segments(&[
            "1\n00:00:00,000 --> 00:00:01,000\nA\n".to_string(),
            "2\n00:10:00,000 --> 00:10:01,000\nB\n".to_string(),
        ])
        .unwrap();

        assert!(merged.contains("1\n00:00:00,000 --> 00:00:01,000\nA"));
        assert!(merged.contains("2\n00:10:00,000 --> 00:10:01,000\nB"));
    }
}
