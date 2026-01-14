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
  detailed_reading: string | ChapterData | null;  // 支持纯文本或章节数据
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
  concurrent_limit: number; // 并发生成数，范围1-10，默认5
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

// 视频工具栏设置（全局设置，跨笔记通用）
export interface VideoToolbarSettings {
  videoVisible: boolean;
  autoPlay: boolean;
  layoutSwapped: boolean;
  layoutPanelWidth: number; // 左侧面板宽度百分比 (30-70)，默认 40
  captionsEnabled: boolean; // 字幕开关状态，默认 true
}

// 提示词分类
export type PromptCategory =
  | "summary"    // 总结类
  | "analysis"   // 分析类
  | "qa"         // 问答类
  | "creative"   // 创作类
  | "other";     // 其他

// 提示词配置
export interface PromptConfig {
  id: number;
  title: string;
  description: string | null;
  content: string;
  category: PromptCategory;
  recommended_model_id: number | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 笔记生成相关类型
// ============================================================================

// 标签页类型
export type TabType =
  | "full_summary"
  | "detailed_reading"
  | "highlights"
  | "visual_summary"
  | "custom_summary";

// 全文总结结构化数据
export interface FullSummaryData {
  abstract: string;                    // 摘要
  highlights: HighlightItem[];         // 亮点
  tags: string[];                      // 标签
  qa_pairs?: QaPair[];                 // 疑问解答（可选）
  thoughts?: string[];                 // 思考问题（可选）
  glossary: GlossaryItem[];            // 术语表
}

export interface HighlightItem {
  emoji: string;
  title: string;
  description: string;
  timestamp?: string; // 视频时间戳，格式如 00:01:23
}

export interface QaPair {
  question: string;
  answer: string;
}

export interface GlossaryItem {
  term: string;
  explanation: string;
}

// 生成进度事件
export type GenerationEvent =
  | { status: "Starting"; total_tabs: number; tabs_to_generate: string[] }
  | { status: "TabStarted"; tab_type: string; tab_name: string }
  | { status: "TabProgress"; tab_type: string; current: number; total: number; message: string }
  | { status: "TabCompleted"; tab_type: string; content: string }
  | { status: "TabError"; tab_type: string; error: string }
  | { status: "AllCompleted"; generated: number; failed: number; total: number }
  | { status: "Aborted"; reason: string };

// 生成状态
export interface GenerationState {
  isGenerating: boolean;
  currentTab: TabType | null;
  progress: { current: number; total: number; message: string };
  completedTabs: Set<TabType>;
  failedTabs: Map<TabType, string>;
}

// ============================================================================
// 字幕相关类型 (Subtitle Types)
// ============================================================================

export interface SubtitleEntry {
  index: number;
  start_time: number; // 秒
  end_time: number;   // 秒
  text: string;
  second_language_text?: string | null; // 双语字幕的第二语言文本（可选）
}

// ============================================================================
// 章节相关类型 (Chapter Types)
// ============================================================================

export interface Chapter {
  id: string;                      // UUID
  title: string;                   // 章节标题（AI生成）
  start_time: number;              // 开始时间（秒）
  end_time: number;                // 结束时间（秒）
  content: string;                 // 章节内容概要
  screenshot_path: string | null;  // 截图文件路径
}

export interface ChapterData {
  chapters: Chapter[];
  total_duration: number;          // 总时长（秒）
  generated_at: string;            // 生成时间（ISO格式）
}

export type ChapterGenerationEvent =
  | { status: "Starting" }
  | { status: "AnalyzingSubtitle"; message: string }
  | { status: "GeneratingChapters"; current: number; total: number; message: string }
  | { status: "CapturingScreenshots"; current: number; total: number; message: string }
  | { status: "Completed"; chapter_data: ChapterData }
  | { status: "Error"; error: string }
  | { status: "Aborted" };


// ============================================================================
// 字幕优化相关类型 (Subtitle Optimization Types)
// ============================================================================

export type SubtitleOptimizationEvent =
  | { status: "Starting"; total: number }
  | { status: "ChapterStarted"; chapter_id: string }
  | { status: "ChapterCompleted"; chapter_id: string; optimized_text: string }
  | { status: "ChapterFailed"; chapter_id: string; error: string }
  | { status: "AllCompleted"; succeeded: number; failed: number }
  | { status: "Aborted" };

export interface SubtitleOptimizationState {
  enabled: boolean;                              // 优化开关状态
  optimizing: boolean;                           // 是否正在优化
  progress: { current: number; total: number } | null;  // 优化进度
  optimizedSubtitles: Map<string, string>;       // 章节ID -> 优化后字幕
  optimizingChapterIds: Set<string>;             // 正在优化的章节ID
  failedChapterIds: Set<string>;                 // 优化失败的章节ID
  abortFlag: string | null;                      // 中止标识（generation_id）
}
