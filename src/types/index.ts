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
  id: string;
  title: string;
  video_path: string;
  subtitle_path: string | null;
  model_id: string | null; // AI model ID used for generating notes
  full_summary: string | null;
  detailed_reading: string | ChapterData | DetailedReadingData | null;  // 支持纯文本或章节数据
  highlights: string | null;
  visual_summary: string | null;
  visual_summary_mindmap: string | null; // Visual summary mindmap data (JSON)
  custom_summary: string | null;
  ai_note_markdown: string | null;
  ai_note_original_markdown: string | null;
  ai_note_meta: string | null;
  flashcards: string | null; // JSON string of FlashcardData
  panoramic_blueprint: string | null; // Panoramic depth reconstruction blueprint (markdown)
  quick_notes: string | null; // User's quick notes (markdown)
  quick_notes_mindmap: string | null; // User's mindmap data (JSON)
  quick_notes_canvas: string | null; // User's canvas data (JSON)
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
  model_id: string | null;
}

// 更新笔记元数据请求
export interface UpdateNoteMetadataRequest {
  id: string;
  title: string;
  video_path: string;
  subtitle_path: string | null;
  model_id: string | null;
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
  id: string;
  title: string;
  base_url: string;
  api_key: string;
  model: string;
  sort_order: number;
  is_default: boolean;
  concurrent_limit: number; // 并发生成数，范围1-10，默认5
  request_timeout: number; // 请求超时时间（秒），0表示不设置超时，范围0-600，默认180
  rate_limit: number; // 速率限制（每分钟请求次数），0表示不限制，范围0-1000，默认60
}

// Embedding 配置
export interface EmbeddingConfig {
  id: string;
  title: string;
  base_url: string;
  api_key: string;
  model: string;
  sort_order: number;
  is_default: boolean;
}

// Reranker 配置
export interface RerankerConfig {
  id: string;
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

// 批量上传视频项
export interface UploadedVideoItem {
  video: UploadedFile;
  subtitle: UploadedFile | null;
}

// 侧边栏状态
export interface SidebarState {
  collapsed: boolean;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
}

// 视图类型
export type ViewType = "home" | "settings" | "note" | "collection" | "recent-notes" | "knowledge-base";

// 视图类型常量（避免魔法字符串）
export const VIEW_TYPES = {
  HOME: "home",
  SETTINGS: "settings",
  NOTE: "note",
  COLLECTION: "collection",
  RECENT_NOTES: "recent-notes",
  KNOWLEDGE_BASE: "knowledge-base",
} as const;

// 可返回的视图类型（排除 settings，用于 previousView 状态）
export type NavigableViewType = Exclude<ViewType, "settings">;

// 合集（资源库）
export interface Collection {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  item_count: number;  // 查询时计算
  cover_image: string | null;  // 封面图片文件名
  first_item_cover: string | null;  // 第一个子合集或笔记的封面（用于无封面时的默认显示）
  created_at: string;
  updated_at: string;
}

// 创建合集请求
export interface CreateCollectionRequest {
  name: string;
  description?: string;
  parent_id?: string;
}

// 合集内容关联
export interface CollectionItem {
  id: string;
  collection_id: string;
  note_id: string;
  sort_order: number;
  created_at: string;
  note?: Note;  // 联表查询时填充
}

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
  id: string;
  title: string;
  description: string | null;
  content: string;
  category: PromptCategory;
  recommended_model_id: string | null;
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
  | "custom_summary"
  | "ai_note"
  | "flashcards";

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
  level?: number | null;           // 层级深度 (1=顶级, 2=子章节)
  parent_id?: string | null;       // 父章节ID（用于构建层级关系）
}

export interface ChapterData {
  chapters: Chapter[];
  total_duration: number;          // 总时长（秒）
  generated_at: string;            // 生成时间（ISO格式）
}

// 原文细读章节数据
export interface DetailedReadingChapter {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  content?: string;
  subtitle_entries: SubtitleEntry[];
  screenshot_path: string | null;
}

// 原文细读数据容器
export interface DetailedReadingData {
  chapters: DetailedReadingChapter[];
  total_duration: number;
  generated_at: string;
}

// ============================================================================
// 类型守卫函数 (Type Guards)
// ============================================================================

/**
 * 判断 detailed_reading 是否为 ChapterData 类型
 * @param value - Note.detailed_reading 字段值
 * @returns 如果是 ChapterData 返回 true
 */
export function isChapterData(value: unknown): value is ChapterData {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    chapters?: unknown;
    total_duration?: unknown;
    generated_at?: unknown;
  };

  if (!Array.isArray(candidate.chapters)) {
    return false;
  }

  if (candidate.chapters.length === 0) {
    return (
      typeof candidate.total_duration === "number" &&
      typeof candidate.generated_at === "string"
    );
  }

  const firstChapter = candidate.chapters[0] as Record<string, unknown>;
  const hasSubtitleEntries = Array.isArray(firstChapter?.subtitle_entries);

  return (
    !hasSubtitleEntries &&
    typeof candidate.total_duration === "number" &&
    typeof candidate.generated_at === "string"
  );
}

/**
 * 判断 detailed_reading 是否为 DetailedReadingData 类型
 */
export function isDetailedReadingData(value: unknown): value is DetailedReadingData {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    chapters?: unknown;
    total_duration?: unknown;
    generated_at?: unknown;
  };

  if (!Array.isArray(candidate.chapters)) {
    return false;
  }

  if (candidate.chapters.length === 0) {
    return (
      typeof candidate.total_duration === "number" &&
      typeof candidate.generated_at === "string"
    );
  }

  const firstChapter = candidate.chapters[0] as Record<string, unknown>;

  return (
    Array.isArray(firstChapter?.subtitle_entries) &&
    typeof candidate.total_duration === "number" &&
    typeof candidate.generated_at === "string"
  );
}

/**
 * 安全解析 detailed_reading 字段
 * @param value - Note.detailed_reading 字段值
 * @returns 解析后的 ChapterData 或 null
 */
export function parseDetailedReading(value: string | ChapterData | DetailedReadingData | null): ChapterData | null {
  if (value === null) {
    return null;
  }
  if (isChapterData(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isChapterData(parsed)) {
        return parsed;
      }
    } catch {
      // 解析失败，返回 null
    }
  }
  return null;
}

/**
 * 安全解析 detailed_reading 字段为 DetailedReadingData
 * @param value - Note.detailed_reading 字段值
 * @returns 解析后的 DetailedReadingData 或 null
 */
export function parseDetailedReadingData(value: string | ChapterData | DetailedReadingData | null): DetailedReadingData | null {
  if (value === null) {
    return null;
  }
  if (isDetailedReadingData(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isDetailedReadingData(parsed)) {
        return parsed;
      }
    } catch {
      // 解析失败，返回 null
    }
  }
  return null;
}

export type ChapterGenerationEvent =
  | { status: "Starting" }
  | { status: "AnalyzingSubtitle"; message: string }
  | { status: "ChapterCompleted"; completed: number; total: number; message: string }
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
  | { status: "ChapterCompleted"; chapter_id: string; optimized_text: string; completed: number; total: number }
  | { status: "ChapterFailed"; chapter_id: string; error: string; completed: number; failed: number; total: number }
  | { status: "AllCompleted"; succeeded: number; failed: number }
  | { status: "Aborted" };

// 单章节优化事件类型
export type SingleChapterOptimizationEvent =
  | { status: "Started" }
  | { status: "Completed"; optimized_text: string }
  | { status: "Failed"; error: string }
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

// ============================================================================
// 优化字幕缓存类型 (Optimized Subtitle Cache Types)
// ============================================================================

export interface OptimizedSubtitle {
  id: string;
  note_id: string;
  chapter_id: string;
  optimized_text: string;
  created_at: string;
}

// 笔记 UI 状态（用于恢复页面状态）
export interface NoteUiState {
  note_id: string;
  show_subtitles: boolean;
  subtitle_optimization_enabled: boolean;
}

// 字幕优化任务状态（用于恢复进行中的任务）
export interface SubtitleOptimizationTaskState {
  note_id: string;
  generation_id: string;
  total: number;
  completed: number;
  failed: number;
  optimizing_chapter_ids: string[];
  is_running: boolean;
}

// ============================================================================
// 高光笔记相关类型 (Highlight Notes Types)
// ============================================================================

// 高光类型
export type HighlightType = "default" | "emotional" | "viral";

// 高光片段
export interface HighlightSegment {
  id: string;                    // UUID
  start_time: number;            // 开始时间（秒）
  end_time: number;              // 结束时间（秒）
  content: string;               // 高光内容摘要
  score: number;                 // 评分 (0-100)
  highlight_type: HighlightType; // 高光类型
  topic_tags: string[];          // 主题标签
}

// 高光数据
export interface HighlightData {
  highlights: HighlightSegment[];
  topic_tags: string[];          // AI 提炼的所有主题标签
  total_duration: number;        // 视频总时长（秒）
  generated_at: string;          // 生成时间（ISO 格式）
}

// 高光生成事件
export type HighlightGenerationEvent =
  | { status: "Starting"; total_segments: number }
  | { status: "SegmentStarted"; segment_index: number }
  | { status: "SegmentCompleted"; segment_index: number; highlights: HighlightSegment[] }
  | { status: "SegmentFailed"; segment_index: number; error: string }
  | { status: "AllCompleted"; total_highlights: number; topic_tags: string[] }
  | { status: "Aborted" };

// 高光类型描述
export const HIGHLIGHT_TYPE_DESCRIPTIONS: Record<HighlightType, string> = {
  default: "基于完整叙事与信息密度生成全片高光，覆盖开头/中段/结尾的关键观点。",
  emotional: "额外抓取情绪爆点：语义冲突、摩擦、破防/真情流露或评论引爆的高潜片段。",
  viral: "挑选最有传播潜力的切片并打分：钩子强度、情绪张力、反转/金句、可复用性。",
};

// 高光类型标签
export const HIGHLIGHT_TYPE_LABELS: Record<HighlightType, string> = {
  default: "默认高光",
  emotional: "情绪高点",
  viral: "爆款片段",
};

// ============================================================================
// 辅助模式相关类型 (Assist Mode Types)
// ============================================================================

// 截图标记
export interface ScreenshotMarker {
  id: string;                    // UUID
  note_id: string;               // 关联的笔记ID
  subtitle_index: number;        // 字幕行索引（标记在此行上方）
  timestamp: number;             // 截图时的视频时间戳
  screenshot_path: string;       // 截图文件路径
  created_at: string;            // 创建时间 (ISO格式)
}

// 辅助模式下的章节分段
export interface AssistModeChapterSegment {
  start_index: number;           // 起始字幕索引
  end_index: number;             // 结束字幕索引（不包含）
  screenshot_path: string | null; // 用户截图路径，null 表示需要自动截图
  start_time: number;            // 起始时间
  end_time: number;              // 结束时间
}

// ============================================================================
// 闪记卡相关类型 (Flashcard Types)
// ============================================================================

// 闪记卡难度等级
export type FlashcardDifficulty = "easy" | "medium" | "hard";

// 单张闪记卡
export interface FlashcardItem {
  id: string;                    // UUID
  question: string;              // 问题
  answer: string;                // 答案
  difficulty: FlashcardDifficulty; // 难度等级
  tags: string[];                // 标签（如"概念理解"、"实践应用"等）
}

// 闪记卡数据
export interface FlashcardData {
  cards: FlashcardItem[];        // 闪记卡列表
  total_count: number;           // 总数
  generated_at: string;          // 生成时间（ISO格式）
}

// 闪记卡难度标签
export const FLASHCARD_DIFFICULTY_LABELS: Record<FlashcardDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

// 闪记卡生成事件
export type FlashcardGenerationEvent =
  | { status: "Starting" }
  | { status: "Progress"; current: number; total: number; message: string }
  | { status: "Completed"; flashcard_data: FlashcardData }
  | { status: "Error"; error: string }
  | { status: "Aborted" };

// ============================================================================
