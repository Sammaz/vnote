use crate::DATABASE;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::search;
use super::types::{KnowledgeChatEvent, KnowledgeChatRequest};

static CHAT_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_abort_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    CHAT_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Start a RAG chat session
pub async fn chat(
    app: AppHandle,
    request: KnowledgeChatRequest,
    request_id: String,
) -> Result<(), String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Create abort flag
    let abort_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = get_abort_flags().lock().await;
        flags.insert(request_id.clone(), abort_flag.clone());
    }

    let event_name = format!("knowledge-chat-{}", request_id);

    // Get the last user message
    let user_message = request
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .ok_or("没有用户消息")?;

    // Emit searching status
    let _ = app.emit(
        &event_name,
        KnowledgeChatEvent::Searching {
            message: "正在搜索相关知识...".to_string(),
        },
    );

    // Search for relevant context
    let search_results = search::search(&user_message, None).await?;

    if abort_flag.load(Ordering::Relaxed) {
        let _ = app.emit(&event_name, KnowledgeChatEvent::Aborted);
        cleanup_abort_flag(&request_id).await;
        return Ok(());
    }

    // Emit context found
    let _ = app.emit(
        &event_name,
        KnowledgeChatEvent::ContextFound {
            sources: search_results.clone(),
        },
    );

    // Build context string
    let context = if search_results.is_empty() {
        "未找到相关知识库内容。".to_string()
    } else {
        search_results
            .iter()
            .map(|r| {
                format!(
                    "笔记「{}」:\n{}",
                    r.note_title,
                    r.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n---\n\n")
    };

    // Get AI config
    let ai_config = if let Some(ref model_id) = request.model_id {
        db.get_ai_config_by_id(model_id)
            .map_err(|e| e.to_string())?
            .ok_or("指定的 AI 模型不存在")?
    } else {
        db.get_default_ai_config()
            .map_err(|e| e.to_string())?
            .ok_or("未配置默认 AI 模型，请在设置中配置")?
    };

    // Build messages for API call
    let custom_prompt = request.system_prompt.as_deref().unwrap_or("").trim();
    let extra_instruction = if custom_prompt.is_empty() {
        String::new()
    } else {
        format!("\n\n用户附加指令：\n{}", custom_prompt)
    };

    let system_prompt = format!(
        "你是一个专业的知识库助手，基于用户的视频笔记知识库回答问题。\n\n\
        以下是从知识库中检索到的相关内容：\n\n\
        {}\n\n\
        回答要求：\n\
        1. **全面性**：充分利用所有相关来源，给出详尽、完整的回答，不要过于简短。\n\
        2. **结构化**：使用标题、列表、分段等 Markdown 格式组织回答，使内容清晰易读。\n\
        3. **忠于原文**：基于知识库内容作答，不要编造知识库中不存在的信息。\n\
        4. **坦诚不足**：如果知识库中没有足够的信息来完整回答问题，请明确指出哪些部分缺乏依据。{}",
        context, extra_instruction
    );

    let mut api_messages = vec![serde_json::json!({
        "role": "system",
        "content": system_prompt
    })];

    // Add conversation history
    for (i, msg) in request.messages.iter().enumerate() {
        let is_last_user_message = i == request.messages.len() - 1 && msg.role == "user";

        // Check if this is the last user message and has images
        if is_last_user_message {
            if let Some(ref images) = request.images {
                if !images.is_empty() {
                    let mut content: Vec<serde_json::Value> = vec![serde_json::json!({
                        "type": "text",
                        "text": msg.content
                    })];

                    for img in images {
                        content.push(serde_json::json!({
                            "type": "image_url",
                            "image_url": {
                                "url": img.data
                            }
                        }));
                    }

                    api_messages.push(serde_json::json!({
                        "role": "user",
                        "content": content
                    }));
                    continue;
                }
            }
        }

        api_messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    // Make streaming API call
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(
            if ai_config.request_timeout > 0 {
                ai_config.request_timeout as u64
            } else {
                180
            },
        ))
        .build()
        .map_err(|e| e.to_string())?;

    let base_url = ai_config.base_url.trim_end_matches('/');
    let api_url = format!("{}/chat/completions", base_url);

    let body = serde_json::json!({
        "model": ai_config.model,
        "messages": api_messages,
        "stream": true
    });

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", ai_config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        let _ = app.emit(
            &event_name,
            KnowledgeChatEvent::Error {
                error: format!("API 错误 {}: {}", status, error_text),
            },
        );
        cleanup_abort_flag(&request_id).await;
        return Err(format!("API 错误 {}: {}", status, error_text));
    }

    // Process SSE stream
    let mut full_content = String::new();
    let mut stream = response.bytes_stream();

    use futures::StreamExt;
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if abort_flag.load(Ordering::Relaxed) {
            let _ = app.emit(&event_name, KnowledgeChatEvent::Aborted);
            cleanup_abort_flag(&request_id).await;
            return Ok(());
        }

        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete SSE lines
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];
            if data == "[DONE]" {
                break;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                    if !content.is_empty() {
                        full_content.push_str(content);
                        let _ = app.emit(
                            &event_name,
                            KnowledgeChatEvent::Streaming {
                                content: content.to_string(),
                            },
                        );
                    }
                }
            }
        }
    }

    // Emit completed
    let _ = app.emit(
        &event_name,
        KnowledgeChatEvent::Completed { full_content },
    );

    cleanup_abort_flag(&request_id).await;
    Ok(())
}

/// Abort a chat session
pub async fn abort_chat(request_id: &str) -> Result<(), String> {
    let flags = get_abort_flags().lock().await;
    if let Some(flag) = flags.get(request_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

async fn cleanup_abort_flag(request_id: &str) {
    let mut flags = get_abort_flags().lock().await;
    flags.remove(request_id);
}
