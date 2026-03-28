/**
 * ChatWindow 类型定义
 */

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageUrls?: string[];
}

export interface UploadedImage {
  id: string;
  file: File;
  previewUrl: string;
}

export interface StreamEvent {
  type: "Start" | "Delta" | "Done";
  message_id?: string;
  content?: string;
  success?: boolean;
  error?: string;
}

export interface ImageData {
  data: string; // Base64 encoded with data URL prefix
}

export interface ChatRequest {
  note_id: string;
  messages: Array<{ role: string; content: string }>;
  images?: ImageData[];
  use_rag: boolean;
  model_id: string | null;
}
