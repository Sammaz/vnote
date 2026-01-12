use crate::ai_pool::{execute_non_streaming, execute_streaming_chat, get_ai_pool_manager, NonStreamingRequest, StreamingChatRequest, StreamEvent};
use crate::db::{Database};
use crate::rag;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

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
    let rag_context = if request.use_rag {
        if let Some(ref note) = db.get_note_by_id(request.note_id)
            .map_err(|e| e.to_string())?
        {
            if let Some(ref subtitle_path) = note.subtitle_path {
                Some(rag::get_rag_context(
                    subtitle_path,
                    request.note_id,
                    &request.messages.last().map(|m| m.content.clone()).unwrap_or_default(),
                ).await.unwrap_or_default())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // Convert messages to ai_pool format
    let pool_messages: Vec<crate::ai_pool::ChatMessage> = request.messages
        .into_iter()
        .map(|m| crate::ai_pool::ChatMessage {
            role: m.role,
            content: m.content,
        })
        .collect();

    // Convert images to ai_pool format
    let pool_images: Option<Vec<crate::ai_pool::ImageData>> = request.images.map(|imgs| {
        imgs.into_iter()
            .map(|i| crate::ai_pool::ImageData { data: i.data })
            .collect()
    });

    // Build streaming request
    let stream_req = StreamingChatRequest {
        app: app.clone(),
        event_name: event_name.clone(),
        request_id: request_id.clone(),
        config: ai_config,
        messages: pool_messages,
        images: pool_images,
    };

    // Spawn async task for streaming
    tokio::spawn(async move {
        let result = execute_streaming_chat(stream_req, rag_context).await;

        // Send completion event if not already sent by execute_streaming_chat
        if let Err(e) = result {
            let done_event = StreamEvent::Done {
                success: false,
                error: Some(e),
            };
            let _ = app.emit(&event_name, done_event);
        }
    });

    Ok(request_id)
}

/// Abort a streaming chat request
pub async fn abort_chat_stream(request_id: String) -> Result<(), String> {
    get_ai_pool_manager().abort_request(&request_id).await
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
    let system_prompt = "你是一个专业的学习助手。根据视频字幕内容，生成3-10个最能帮助用户理解视频核心内容的重要问题。

要求：
1. 根据内容的复杂度和信息量，自动决定生成3-10个问题
2. 问题应该覆盖视频的核心概念、关键知识点和重要细节
3. 问题应该由浅入深，帮助用户逐步理解内容
4. 每个问题一行，不要编号，不要其他多余内容
5. 问题要具体、有针对性，避免过于宽泛";

    let prompt = format!("{}\n\n{}", system_prompt, truncated_text);

    // 4. Call AI API via ai_pool (non-streaming)
    let req = NonStreamingRequest {
        config: ai_config,
        prompt,
    };

    let response = execute_non_streaming(req).await?;
    let content = response.content;

    // 5. Parse questions (split by lines, take up to 10 non-empty lines)
    let questions: Vec<String> = content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .take(10)
        .map(String::from)
        .collect();

    if questions.is_empty() {
        return Err("未生成任何问题".to_string());
    }

    Ok(questions)
}
