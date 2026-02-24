use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeSearchResult {
    pub chunk_id: String,
    pub note_id: String,
    pub note_title: String,
    pub content: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeIndexStatusResponse {
    pub note_id: String,
    pub note_title: String,
    pub status: String,
    pub chunk_count: i32,
    pub has_visual_summary: bool,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub needs_reindex: bool,
    pub init_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeBaseStats {
    pub total_notes: i32,
    pub indexed_notes: i32,
    pub total_chunks: i32,
    pub notes_with_summary: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatRequest {
    pub messages: Vec<ChatMessage>,
    pub model_id: Option<String>,
    pub system_prompt: Option<String>,
    pub images: Option<Vec<KnowledgeChatImageData>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatImageData {
    pub data: String, // Base64 encoded with data URL prefix
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum KnowledgeChatEvent {
    Searching { message: String },
    ContextFound { sources: Vec<KnowledgeSearchResult> },
    Streaming { content: String },
    Completed { full_content: String },
    Error { error: String },
    Aborted,
}
