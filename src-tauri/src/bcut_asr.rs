use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::process::Command as TokioCommand;

const API_REQ_UPLOAD: &str = "https://member.bilibili.com/x/bcut/rubick-interface/resource/create";
const API_COMMIT_UPLOAD: &str = "https://member.bilibili.com/x/bcut/rubick-interface/resource/create/complete";
const API_CREATE_TASK: &str = "https://member.bilibili.com/x/bcut/rubick-interface/task";
const API_QUERY_RESULT: &str = "https://member.bilibili.com/x/bcut/rubick-interface/task/result";

const USER_AGENT: &str = "Bilibili/1.0.0 (https://www.bilibili.com)";

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
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

fn is_aborted(abort_flag: &Arc<AtomicBool>) -> bool {
    abort_flag.load(Ordering::Relaxed)
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

async fn upload_audio(client: &Client, audio_bytes: &[u8]) -> Result<(UploadData, Vec<String>), String> {
    let payload = json!({
        "type": 2,
        "name": "audio.mp3",
        "size": audio_bytes.len(),
        "ResourceFileType": "mp3",
        "model_id": "8"
    });

    let resp = client
        .post(API_REQ_UPLOAD)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("申请上传失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("申请上传失败: {}", resp.status()));
    }

    let upload_data: ApiResponse<UploadData> = resp
        .json()
        .await
        .map_err(|e| format!("解析上传响应失败: {}", e))?;

    let mut etags = Vec::new();
    for (clip, url) in upload_data.data.upload_urls.iter().enumerate() {
        let start = clip * upload_data.data.per_size;
        let end = std::cmp::min(start + upload_data.data.per_size, audio_bytes.len());
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

    Ok((upload_data.data, etags))
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

    let resp = client
        .post(API_COMMIT_UPLOAD)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("提交上传失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("提交上传失败: {}", resp.status()));
    }

    let commit_data: ApiResponse<CommitData> = resp
        .json()
        .await
        .map_err(|e| format!("解析提交响应失败: {}", e))?;

    Ok(commit_data.data.download_url)
}

async fn create_task(client: &Client, download_url: &str) -> Result<String, String> {
    let payload = json!({
        "resource": download_url,
        "model_id": "8"
    });

    let resp = client
        .post(API_CREATE_TASK)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("创建任务失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("创建任务失败: {}", resp.status()));
    }

    let task_data: ApiResponse<TaskData> = resp
        .json()
        .await
        .map_err(|e| format!("解析任务响应失败: {}", e))?;

    Ok(task_data.data.task_id)
}

async fn query_result(client: &Client, task_id: &str) -> Result<TaskResultData, String> {
    let resp = client
        .get(API_QUERY_RESULT)
        .query(&[("model_id", "7"), ("task_id", task_id)])
        .send()
        .await
        .map_err(|e| format!("查询结果失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("查询结果失败: {}", resp.status()));
    }

    let result_data: ApiResponse<TaskResultData> = resp
        .json()
        .await
        .map_err(|e| format!("解析结果响应失败: {}", e))?;

    Ok(result_data.data)
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

fn build_subtitle_dir(app: &AppHandle, note_id: &str) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    Ok(cache_dir.join("notes").join(note_id).join("subtitle"))
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

    let audio_bytes = tokio::fs::read(&audio_path)
        .await
        .map_err(|e| format!("读取音频失败: {}", e))?;

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let (upload_data, etags) = upload_audio(&client, &audio_bytes).await?;
    let download_url = commit_upload(&client, &upload_data, &etags).await?;
    let task_id = create_task(&client, &download_url).await?;

    for _ in 0..500 {
        if is_aborted(abort_flag) {
            return Err("已中止".to_string());
        }

        let result = query_result(&client, &task_id).await?;
        if result.state == 4 {
            let result_str = result
                .result
                .ok_or_else(|| "转录结果缺少 result".to_string())?;
            let result_json: serde_json::Value = serde_json::from_str(&result_str)
                .map_err(|e| format!("解析转录结果失败: {}", e))?;
            let srt_content = build_srt_from_result(&result_json)?;
            tokio::fs::write(&srt_path, srt_content)
                .await
                .map_err(|e| format!("保存字幕失败: {}", e))?;
            return Ok(srt_path.to_string_lossy().to_string());
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }

    Err("转录超时".to_string())
}
