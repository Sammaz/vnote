/**
 * VNote 数据类型定义
 */

// 文件夹
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 笔记
export interface Note {
  id: number;
  title: string;
  video_path: string;
  subtitle_path: string | null;
  model_id: number | null; // AI model ID used for generating notes
  full_summary: string | null;
  detailed_reading: string | null;
  highlights: string | null;
  visual_summary: string | null;
  custom_summary: string | null;
  suggested_questions: string | null; // JSON array of questions
  last_playback_position: number | null; // Last playback position in seconds
  created_at: string;
  updated_at: string;
}

// 创建笔记请求
export interface CreateNoteRequest {
  title: string;
  video_path: string;
  subtitle_path: string | null;
  model_id: number | null;
}

// 应用统计
export interface AppStats {
  totalNotes: number;
  totalWatchTime: number; // 秒
  notesThisWeek: number;
  lastActivityDate: Date | null;
}

// AI 配置（与 SettingsPage 共享）
export interface AiConfig {
  id: number;
  title: string;
  base_url: string;
  api_key: string;
  model: string;
  sort_order: number;
  is_default: boolean;
}

// 上传文件信息
export interface UploadedFile {
  name: string;
  path: string;
  size: number;
  type: "video" | "subtitle";
}

// 侧边栏状态
export interface SidebarState {
  collapsed: boolean;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
}

// 视图类型
export type ViewType = "home" | "settings" | "note";

// 布局比例类型
export type LayoutRatio = "4:6" | "6:4";

// 视频工具栏设置（全局设置，跨笔记通用）
export interface VideoToolbarSettings {
  videoVisible: boolean;
  autoPlay: boolean;
  layoutSwapped: boolean;
  layoutRatio: LayoutRatio;
}
