use crate::db::{AiConfig, Database};
use crate::rag;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static ABORT_FLAGS: OnceLock<Mutex<std::collections::HashMap<String, bool>>> = OnceLock::new();

fn get_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client")
    })
}

fn get_abort_flags() -> &'static Mutex<std::collections::HashMap<String, bool>> {
    ABORT_FLAGS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

#[derive(Debug, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ImageData {
    pub data: String, // Base64 encoded with data URL prefix (e.g., "data:image/png;base64,...")
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub note_id: i64,
    pub messages: Vec<ChatMessage>,
    pub images: Option<Vec<ImageData>>,
    pub use_rag: bool,
    pub model_id: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum StreamEvent {
    Start { message_id: String },
    Delta { content: String },
    Done { success: bool, error: Option<String> },
}

/// Start a streaming chat request
/// Returns a request_id that can be used to listen for events
pub async fn chat_stream(
    app: AppHandle,
    db: &Database,
    request: ChatRequest,
) -> Result<String, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let event_name = format!("chat-stream-{}", request_id);

    // Get AI config
    let model_id = request.model_id.ok_or("No model selected")?;
    let ai_config = db
        .get_ai_config_by_id(model_id)
        .map_err(|e| e.to_string())?
        .ok_or("AI config not found")?;

    // Get note for RAG context if needed
    let note = if request.use_rag {
        db.get_note_by_id(request.note_id)
            .map_err(|e| e.to_string())?
    } else {
        None
    };

    // Clone data for the spawned task
    let event_name_clone = event_name.clone();
    let request_id_clone = request_id.clone();

    // Register abort flag
    {
        let mut flags = get_abort_flags().lock().await;
        flags.insert(request_id.clone(), false);
    }

    // Spawn async task for streaming
    tokio::spawn(async move {
        let result = execute_stream(
            &app,
            &event_name_clone,
            &request_id_clone,
            ai_config,
            request,
            note,
        )
        .await;

        // Send completion event
        let done_event = match result {
            Ok(_) => StreamEvent::Done {
                success: true,
                error: None,
            },
            Err(e) => StreamEvent::Done {
                success: false,
                error: Some(e),
            },
        };
        let _ = app.emit(&event_name_clone, done_event);

        // Clean up abort flag
        let mut flags = get_abort_flags().lock().await;
        flags.remove(&request_id_clone);
    });

    Ok(request_id)
}

/// Abort a streaming chat request
pub async fn abort_chat_stream(request_id: String) -> Result<(), String> {
    let mut flags = get_abort_flags().lock().await;
    if let Some(flag) = flags.get_mut(&request_id) {
        *flag = true;
        Ok(())
    } else {
        Err("Request not found".to_string())
    }
}

async fn execute_stream(
    app: &AppHandle,
    event_name: &str,
    request_id: &str,
    ai_config: AiConfig,
    request: ChatRequest,
    note: Option<crate::db::Note>,
) -> Result<(), String> {
    let client = get_client();

    // Build messages array
    let mut api_messages: Vec<Value> = Vec::new();

    // Add RAG context as system message if enabled
    if request.use_rag {
        if let Some(ref note) = note {
            if let Some(ref subtitle_path) = note.subtitle_path {
                // Get RAG context
                let rag_context = rag::get_rag_context(
                    subtitle_path,
                    request.note_id,
                    &request.messages.last().map(|m| m.content.clone()).unwrap_or_default(),
                )
                .await
                .unwrap_or_default();

                if !rag_context.is_empty() {
                    api_messages.push(json!({
                        "role": "system",
                        "content": format!(
                            "基于以下视频字幕片段回答用户问题。如果问题与字幕内容无关，可以根据你的知识回答。\n\n{}\n",
                            rag_context
                        )
                    }));
                }
            }
        }
    }

    // Add conversation history
    for (i, msg) in request.messages.iter().enumerate() {
        let is_last_user_message = i == request.messages.len() - 1 && msg.role == "user";

        // Check if this is the last user message and has images
        if is_last_user_message && request.images.is_some() {
            let images = request.images.as_ref().unwrap();
            if !images.is_empty() {
                // Build multimodal content
                let mut content: Vec<Value> = vec![json!({
                    "type": "text",
                    "text": msg.content
                })];

                for img in images {
                    content.push(json!({
                        "type": "image_url",
                        "image_url": {
                            "url": img.data
                        }
                    }));
                }

                api_messages.push(json!({
                    "role": "user",
                    "content": content
                }));
                continue;
            }
        }

        api_messages.push(json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    // Build API URL
    let base_url = ai_config.base_url.trim_end_matches('/');
    let api_url = format!("{}/chat/completions", base_url);

    // Build request body
    let body = json!({
        "model": ai_config.model,
        "messages": api_messages,
        "stream": true
    });

    // Send request
    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", ai_config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, error_text));
    }

    // Emit start event
    let message_id = uuid::Uuid::new_v4().to_string();
    let _ = app.emit(
        event_name,
        StreamEvent::Start {
            message_id: message_id.clone(),
        },
    );

    // Process SSE stream
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        // Check abort flag
        {
            let flags = get_abort_flags().lock().await;
            if flags.get(request_id).copied().unwrap_or(false) {
                return Err("Request aborted".to_string());
            }
        }

        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process complete lines
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        if !content.is_empty() {
                            let _ = app.emit(
                                event_name,
                                StreamEvent::Delta {
                                    content: content.to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Generate suggested questions based on subtitle content
pub async fn generate_suggested_questions(
    db: &Database,
    subtitle_path: &str,
    model_id: i64,
) -> Result<Vec<String>, String> {
    // 1. Get AI config
    let ai_config = db
        .get_ai_config_by_id(model_id)
        .map_err(|e| e.to_string())?
        .ok_or("AI 模型未找到")?;

    // 2. Read subtitle content (truncate to first 3000 chars to avoid token overflow)
    let entries = crate::subtitle::parse_subtitle_file(subtitle_path)?;
    let full_text: String = entries
        .iter()
        .map(|e| e.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let truncated_text = if full_text.chars().count() > 3000 {
        full_text.chars().take(3000).collect::<String>()
    } else {
        full_text
    };

    if truncated_text.trim().is_empty() {
        return Err("字幕内容为空".to_string());
    }

    // 3. Build prompt
    let system_prompt = "你是一个学习助手。根据视频字幕内容，生成3个最能帮助用户理解视频核心内容的问题。
只输出3个问题，每个问题一行，不要编号，不要其他内容。";

    let body = json!({
        "model": ai_config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": truncated_text}
        ],
        "temperature": 0.7
    });

    // 4. Call AI API (non-streaming)
    let client = get_client();
    let base_url = ai_config.base_url.trim_end_matches('/');
    let api_url = format!("{}/chat/completions", base_url);

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", ai_config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("AI API 错误 {}: {}", status, error_text));
    }

    // 5. Parse response
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("响应格式错误")?;

    // 6. Parse questions (split by lines, take first 3 non-empty lines)
    let questions: Vec<String> = content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .take(3)
        .map(String::from)
        .collect();

    if questions.is_empty() {
        return Err("未生成任何问题".to_string());
    }

    Ok(questions)
}
