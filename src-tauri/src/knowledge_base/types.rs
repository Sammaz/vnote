use crate::db::{
    KnowledgeAgentRun, KnowledgeAgentTraceStep, KnowledgeChatMessage, KnowledgeChatMessageSource,
    KnowledgeChatPreferences, KnowledgeChatSession,
};
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
#[serde(rename_all = "lowercase")]
pub enum KnowledgeChatMode {
    Standard,
    Agent,
}

impl KnowledgeChatMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Agent => "agent",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatRequest {
    pub session_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub model_id: Option<String>,
    pub system_prompt: Option<String>,
    pub prompt_id: Option<String>,
    pub images: Option<Vec<KnowledgeChatImageData>>,
    pub mode: Option<KnowledgeChatMode>,
    pub step_budget: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatImageData {
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatSessionDetail {
    pub session: KnowledgeChatSession,
    pub messages: Vec<KnowledgeChatMessageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatMessageRecord {
    pub message: KnowledgeChatMessage,
    pub sources: Vec<KnowledgeChatMessageSourceRecord>,
    pub agent_run: Option<KnowledgeAgentRunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatMessageSourceRecord {
    pub source: KnowledgeChatMessageSource,
    pub result: Option<KnowledgeSearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeAgentRunRecord {
    pub run: KnowledgeAgentRun,
    pub trace_steps: Vec<KnowledgeAgentTraceStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatSubmitResponse {
    pub request_id: String,
    pub session_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateKnowledgeChatSessionRequest {
    pub session_id: String,
    pub title: String,
    pub mode: KnowledgeChatMode,
    pub model_id: Option<String>,
    pub prompt_id: Option<String>,
    pub is_pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeChatPreferencesPayload {
    pub id: Option<String>,
    pub default_mode: KnowledgeChatMode,
    pub default_model_id: Option<String>,
    pub default_prompt_id: Option<String>,
    pub show_agent_trace: bool,
    pub show_sources_expanded: bool,
    pub compact_message_density: bool,
}

impl From<KnowledgeChatPreferences> for KnowledgeChatPreferencesPayload {
    fn from(value: KnowledgeChatPreferences) -> Self {
        Self {
            id: Some(value.id),
            default_mode: match value.default_mode.as_str() {
                "standard" => KnowledgeChatMode::Standard,
                _ => KnowledgeChatMode::Agent,
            },
            default_model_id: value.default_model_id,
            default_prompt_id: value.default_prompt_id,
            show_agent_trace: value.show_agent_trace,
            show_sources_expanded: value.show_sources_expanded,
            compact_message_density: value.compact_message_density,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum KnowledgeChatEvent {
    SessionReady {
        session_id: String,
        user_message_id: String,
        assistant_message_id: String,
        mode: KnowledgeChatMode,
    },
    Searching {
        message: String,
    },
    Planning {
        message: String,
    },
    Retrieving {
        message: String,
        queries: Vec<String>,
        iteration: i32,
        total_iterations: i32,
    },
    ContextFound {
        sources: Vec<KnowledgeSearchResult>,
    },
    TraceStep {
        run_id: String,
        step: KnowledgeAgentTraceStep,
    },
    Streaming {
        content: String,
    },
    Completed {
        full_content: String,
        session_id: String,
        assistant_message_id: String,
        run_id: Option<String>,
    },
    Error {
        error: String,
    },
    Aborted,
}
