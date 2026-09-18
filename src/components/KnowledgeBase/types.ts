// 知识库搜索结果
export interface KnowledgeSearchResult {
  chunk_id: string;
  note_id: string;
  note_title: string;
  content: string;
  score: number;
}

// 知识库索引状态
export interface KnowledgeIndexStatus {
  note_id: string;
  note_title: string;
  status: "indexing" | "completed" | "failed" | "none";
  chunk_count: number;
  has_visual_summary: boolean;
  completed_at: string | null;
  error_message: string | null;
  needs_reindex: boolean;
  init_completed: boolean;
}

// 知识库统计
export interface KnowledgeBaseStats {
  total_notes: number;
  indexed_notes: number;
  total_chunks: number;
  notes_with_summary: number;
}

// RAG 对话图片数据
export interface KnowledgeChatImageData {
  data: string; // Base64 encoded with data URL prefix
}

export type KnowledgeChatMode = "standard" | "agent";

// RAG 对话请求
export interface KnowledgeChatRequest {
  session_id?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model_id?: string;
  system_prompt?: string;
  prompt_id?: string;
  images?: KnowledgeChatImageData[];
  mode?: KnowledgeChatMode;
  step_budget?: number;
  enable_supplement?: boolean;
}

export interface KnowledgeChatSubmitResponse {
  request_id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
}

export interface KnowledgeChatSession {
  id: string;
  title: string;
  mode: KnowledgeChatMode;
  model_id: string | null;
  prompt_id: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface KnowledgeChatMessageSourceRecord {
  source: {
    id: string;
    message_id: string;
    chunk_id: string;
    note_id: string;
    rank: number;
    score: number | null;
    query_text: string | null;
    created_at: string;
  };
  result: KnowledgeSearchResult | null;
}

export interface KnowledgeAgentTraceStep {
  id: string;
  run_id: string;
  step_index: number;
  step_type: string;
  title: string;
  content: string;
  metadata_json: string | null;
  created_at: string;
}

export interface KnowledgeAgentRunRecord {
  run: {
    id: string;
    session_id: string;
    message_id: string;
    status: "running" | "completed" | "failed" | "aborted";
    iteration_count: number;
    plan_summary: string | null;
    final_summary: string | null;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
  };
  trace_steps: KnowledgeAgentTraceStep[];
}

export interface KnowledgeChatMessageRecord {
  message: {
    id: string;
    session_id: string;
    role: "user" | "assistant" | "system";
    content: string;
    status: "streaming" | "completed" | "error" | "aborted";
    request_id: string | null;
    parent_message_id: string | null;
    model_id: string | null;
    prompt_id: string | null;
    error_message: string | null;
    images_json: string | null;
    created_at: string;
    updated_at: string;
  };
  sources: KnowledgeChatMessageSourceRecord[];
  agent_run: KnowledgeAgentRunRecord | null;
}

export interface KnowledgeChatSessionDetail {
  session: KnowledgeChatSession;
  messages: KnowledgeChatMessageRecord[];
}

export interface KnowledgeChatPreferences {
  id?: string;
  default_mode: KnowledgeChatMode;
  default_model_id: string | null;
  default_prompt_id: string | null;
  show_agent_trace: boolean;
  show_sources_expanded: boolean;
  compact_message_density: boolean;
}

// RAG 对话流式事件
export type KnowledgeChatEvent =
  | {
      status: "SessionReady";
      session_id: string;
      user_message_id: string;
      assistant_message_id: string;
      mode: KnowledgeChatMode;
    }
  | { status: "Searching"; message: string }
  | { status: "Planning"; message: string }
  | {
      status: "Retrieving";
      message: string;
      queries: string[];
      iteration: number;
      total_iterations: number;
    }
  | { status: "ContextFound"; sources: KnowledgeSearchResult[] }
  | { status: "TraceStep"; run_id: string; step: KnowledgeAgentTraceStep }
  | { status: "Streaming"; content: string }
  | {
      status: "Completed";
      full_content: string;
      session_id: string;
      assistant_message_id: string;
      run_id: string | null;
    }
  | { status: "Error"; error: string }
  | { status: "Degraded"; message: string }
  | { status: "Aborted" };

// 索引进度事件
export type KnowledgeIndexEvent =
  | { status: "Started"; total: number }
  | { status: "Indexing"; note_id: string }
  | { status: "Progress"; completed: number; failed: number; total: number; note_title: string; note_id: string }
  | { status: "Completed"; completed: number; failed: number; total: number }
  | { status: "Aborted" };
