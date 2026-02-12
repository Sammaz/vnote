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
}

// 知识库统计
export interface KnowledgeBaseStats {
  total_notes: number;
  indexed_notes: number;
  total_chunks: number;
  notes_with_summary: number;
}

// RAG 对话请求
export interface KnowledgeChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model_id?: string;
  system_prompt?: string;
}

// RAG 对话流式事件
export type KnowledgeChatEvent =
  | { status: "Searching"; message: string }
  | { status: "ContextFound"; sources: KnowledgeSearchResult[] }
  | { status: "Streaming"; content: string }
  | { status: "Completed"; full_content: string }
  | { status: "Error"; error: string }
  | { status: "Aborted" };

// 索引进度事件
export type KnowledgeIndexEvent =
  | { status: "Started"; total: number }
  | { status: "Progress"; completed: number; failed: number; total: number; note_title: string }
  | { status: "Completed"; completed: number; failed: number; total: number }
  | { status: "Aborted" };
