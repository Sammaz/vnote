import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { subscribeVideoTime } from "../../hooks/useVideoTime";
import {
  FileText,
  BookOpen,
  Highlighter,
  Captions,
  BarChart3,
  Sparkles,
  Copy,
  Download,
  Edit3,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
  Check,
  List,
  Clock,
  Subtitles as SubtitlesIcon,
  Loader2,
  MousePointer2,
  Package,
  GitBranch,
  Zap,
  StickyNote,
  GraduationCap,
  Network,
  Palette,
  Map as MapIcon,
  type LucideIcon,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Note, GenerationEvent, TabType, AiConfig, PromptConfig, ChapterData, SubtitleOptimizationEvent, SingleChapterOptimizationEvent, SubtitleEntry, OptimizedSubtitle, NoteUiState, SubtitleOptimizationTaskState, HighlightData, ScreenshotMarker, FlashcardData, FlashcardGenerationEvent, DetailedReadingData, DetailedReadingChapter, ChapterGenerationEvent } from "../../types";
import { parseDetailedReadingData } from "../../types";
import { ResponsiveTabs } from "./ResponsiveTabs";
import { EditableMarkdown } from "./EditableMarkdown";
import { DetailedReadingView } from "./DetailedReadingView";
import { VirtualizedSubtitleList } from "./VirtualizedSubtitleList";
import { HighlightGrid, type HighlightGridRef } from "./Highlight";
import { VisualSummaryContent } from "./VisualSummaryContent";
import {
  extractMarkdownHeadings,
  getMarkdownContainer,
  getMarkdownHeadingElements,
  getMarkdownScrollContainer,
  scrollToMarkdownHeading,
  type TOCItem,
} from "./TableOfContents";
import { FlashcardContent } from "./FlashcardContent";
import { QuickNotesContainer } from "./QuickNotesContainer";
import { AiNoteContent } from "./AiNoteContent";
import { AssistModeView } from "./AssistModeView";
import { message } from "../../utils/message";
import { copyText } from "../../utils/clipboard";
import { assembleChapterMarkdown } from "../../utils/markdownAssembler";
import { stripHeadingTimestamps } from "../../utils/markdownUtils";
import { findCurrentDetailedReadingChapter } from "../../utils/detailedReadingChapters";
import { ConfirmDialog } from "../common/ConfirmDialog";
import {
  getNoteGenerationState,
  setNoteGenerationState,
  subscribeNoteGenerationState,
  activeListeners,
  registerActiveGenerationId,
  unregisterActiveGenerationId,
  setHighlightGenerating,
  setFlashcardGenerating,
  setChapterGenerating,
} from "../../utils/noteGenerationState";

type TabId = "summary" | "original" | "highlights" | "script" | "visual" | "custom" | "ai_note" | "flashcard" | "panoramic_blueprint" | "quicknotes" | "mindmap" | "canvas";
type TabGroupId = "summary" | "study";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

interface TabGroup {
  id: TabGroupId;
  label: string;
  icon: React.ReactNode;
  tabs: Tab[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    id: "summary",
    label: "总结",
    icon: <FileText className="w-4 h-4" />,
    tabs: [
      { id: "summary", label: "全文总结", icon: <FileText className="w-4 h-4" /> },
      { id: "original", label: "原文细读", icon: <BookOpen className="w-4 h-4" /> },
      { id: "highlights", label: "高光笔记", icon: <Highlighter className="w-4 h-4" /> },
      { id: "script", label: "字幕脚本", icon: <Captions className="w-4 h-4" /> },
      { id: "visual", label: "视觉化总结", icon: <BarChart3 className="w-4 h-4" /> },
      { id: "custom", label: "自定义总结", icon: <Sparkles className="w-4 h-4" /> },
    ]
  },
  {
    id: "study",
    label: "学习",
    icon: <GraduationCap className="w-4 h-4" />,
    tabs: [
      { id: "ai_note", label: "大纲笔记", icon: <GitBranch className="w-4 h-4" /> },
      { id: "quicknotes", label: "随手笔记", icon: <StickyNote className="w-4 h-4" /> },
      { id: "mindmap", label: "思维导图", icon: <Network className="w-4 h-4" /> },
      { id: "canvas", label: "无限画布", icon: <Palette className="w-4 h-4" /> },
      { id: "flashcard", label: "闪记卡", icon: <Zap className="w-4 h-4" /> },
      { id: "panoramic_blueprint", label: "深度蓝图", icon: <MapIcon className="w-4 h-4" /> },
    ]
  }
];

// 标签页类型映射
const TAB_TYPE_MAPPING: Record<string, TabType> = {
  summary: "full_summary",
  original: "detailed_reading",
  highlights: "highlights",
  visual: "visual_summary",
  custom: "custom_summary",
  ai_note: "ai_note",
  flashcard: "flashcards",
};

const USER_CHAPTER_SEEK_SUPPRESSION_MS = 800;

// ============================================================================
// 全局生成状态管理器（跨组件实例持久化）
// 工具函数已移至 src/utils/noteGenerationState.ts 以避免 Fast Refresh 警告
// ============================================================================

interface NoteContentPanelProps {
  note: Note;
  onGenerationComplete?: () => void;
  aiConfigs: AiConfig[];
  currentModelId?: string | null;
  defaultAiConfigId?: string | null;
  promptConfigs?: PromptConfig[];
}

// 解析高光数据
function parseHighlightData(highlightsJson: string | null): HighlightData | null {
  if (!highlightsJson) return null;
  try {
    return JSON.parse(highlightsJson) as HighlightData;
  } catch {
    return null;
  }
}

// 解析闪记卡数据
function parseFlashcardData(flashcardsJson: string | null): FlashcardData | null {
  if (!flashcardsJson) return null;
  try {
    return JSON.parse(flashcardsJson) as FlashcardData;
  } catch {
    return null;
  }
}

interface SharedEmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  cardClassName?: string;
  iconWrapClassName?: string;
}

function SharedEmptyState({
  icon,
  title,
  description,
  hint,
  action,
  cardClassName,
  iconWrapClassName,
}: SharedEmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className={cn("mx-auto flex w-full max-w-lg flex-col items-center rounded-3xl border border-slate-200/80 bg-white/70 px-6 py-8 text-center shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-vnote-border/80 dark:bg-white/5 sm:px-8 sm:py-10", cardClassName)}>
        <div className={cn("mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-100/90 shadow-sm dark:border-vnote-border/80 dark:bg-slate-800/80", iconWrapClassName)}>
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {description ? (
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
        ) : null}
        {action ? <div className="mt-6 flex w-full justify-center">{action}</div> : null}
        {hint ? <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">{hint}</div> : null}
      </div>
    </div>
  );
}

interface ToolbarIconButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  spinning?: boolean;
  compact?: boolean;
  className?: string;
  onClick: () => void;
  children?: React.ReactNode;
}

function getElementContentWidth(element: HTMLElement | null): number {
  if (!element) return 0;
  return Math.max(element.scrollWidth, element.offsetWidth);
}

function ToolbarIconButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  spinning = false,
  compact = false,
  className,
  onClick,
  children,
}: ToolbarIconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        compact ? "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent bg-white/55 text-slate-600 shadow-sm shadow-transparent transition-all cursor-pointer hover:border-slate-200/90 hover:bg-white hover:text-slate-800 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:border-transparent dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-white/8 dark:hover:bg-white/8 dark:hover:text-slate-100" : undefined,
        active && "border-blue-200/80 bg-blue-50/90 text-blue-600 shadow-sm shadow-blue-100/60 dark:border-blue-500/30 dark:bg-blue-500/14 dark:text-blue-400 dark:shadow-transparent",
        disabled && "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none",
        className,
      )}
      title={label}
      aria-label={label}
    >
      <Icon className={cn("w-4 h-4", spinning && "animate-spin")} />
      {!compact && children}
    </button>
  );
}

export function NoteContentPanel({ note, onGenerationComplete, aiConfigs, currentModelId, defaultAiConfigId, promptConfigs = [] }: NoteContentPanelProps) {

  const glassPanel = useGlassBg("panel");
  const glassModal = useGlassBg("modal");
  const glassInput = useGlassBg("input");
  const glassMenu = useGlassBg("menu");

  // 当前激活的标签页
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  // 当前激活的标签组
  const [activeGroup, setActiveGroup] = useState<TabGroupId>("summary");

  // HighlightGrid 组件的 ref
  const highlightGridRef = useRef<HighlightGridRef>(null);

  // 原文细读相关状态
  const [detailedReadingData, setDetailedReadingData] = useState<DetailedReadingData | null>(null);

  // 章节下拉框状态
  const [showChapterDropdown, setShowChapterDropdown] = useState(false);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);
  const originalToolbarRef = useRef<HTMLDivElement>(null);
  const originalToolbarLeftRef = useRef<HTMLDivElement>(null);
  const originalToolbarRightRef = useRef<HTMLDivElement>(null);
  const originalToolbarMeasureLeftExpandedRef = useRef<HTMLDivElement>(null);
  const originalToolbarMeasureRightCompactRef = useRef<HTMLDivElement>(null);
  const originalToolbarMeasureRightExpandedRef = useRef<HTMLDivElement>(null);
  const visualToolbarRef = useRef<HTMLDivElement>(null);
  const visualToolbarLeftRef = useRef<HTMLDivElement>(null);
  const visualToolbarRightRef = useRef<HTMLDivElement>(null);
  const visualToolbarMeasureLeftExpandedRef = useRef<HTMLDivElement>(null);
  const visualToolbarMeasureRightCompactRef = useRef<HTMLDivElement>(null);
  const visualToolbarMeasureRightExpandedRef = useRef<HTMLDivElement>(null);

  const getCurrentChapter = useCallback((time: number): DetailedReadingChapter | null => {
    if (!detailedReadingData) return null;
    return findCurrentDetailedReadingChapter(detailedReadingData.chapters, time);
  }, [detailedReadingData]);

  // 字幕滚动状态
  const [autoScroll, setAutoScroll] = useState(true);
  // 当前播放章节 ID（仅在章节切换时更新，避免每帧重渲染）
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  // 用户点击章节的时间戳（用于忽略视频时间更新）
  const userClickTimeRef = useRef<number>(0);
  // 自动滚动控制
  const lastChapterIdRef = useRef<string | null>(null);
  const { shouldAutoScroll, handleUserScroll, isAutoScrollingRef } = useAutoScroll(autoScroll);
  // 显示章节字幕开关
  const [showChapterSubtitles, setShowChapterSubtitles] = useState(false);
  const [isCompactOriginalToolbarLeft, setIsCompactOriginalToolbarLeft] = useState(false);
  const [isCompactOriginalToolbarRight, setIsCompactOriginalToolbarRight] = useState(true);
  const originalToolbarCompactStateRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: true });
  const [isCompactVisualToolbarLeft, setIsCompactVisualToolbarLeft] = useState(false);
  const [isCompactVisualToolbarRight, setIsCompactVisualToolbarRight] = useState(true);
  const visualToolbarCompactStateRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: true });

  const handleOriginalChapterJump = useCallback((chapter: DetailedReadingChapter) => {
    userClickTimeRef.current = Date.now();
    setCurrentChapterId(chapter.id);
    lastChapterIdRef.current = chapter.id;
    window.dispatchEvent(new CustomEvent("seek-video", { detail: { time: chapter.start_time } }));

    const chapterElement = document.getElementById(`chapter-${chapter.id}`);
    if (chapterElement) {
      isAutoScrollingRef.current = true;
      chapterElement.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, USER_CHAPTER_SEEK_SUPPRESSION_MS);
    }

    setShowChapterDropdown(false);
  }, [isAutoScrollingRef]);

  // 辅助模式状态
  const [isAssistModeActive, setIsAssistModeActive] = useState(false);
  // 辅助模式下的截图标记（从 AssistModeView 同步）
  const [assistModeMarkers, setAssistModeMarkers] = useState<ScreenshotMarker[]>([]);
  // 辅助模式生成状态
  const [assistModeGenerating, setAssistModeGenerating] = useState(false);
  const [assistModeProgress, setAssistModeProgress] = useState<{ current: number; total: number; message: string } | null>(null);

  // 字幕优化相关状态
  const [subtitleOptimizationEnabled, setSubtitleOptimizationEnabled] = useState(false);
  const [subtitleOptimizing, setSubtitleOptimizing] = useState(false);
  const [, setSubtitleOptimizationProgress] = useState<{ current: number; total: number } | null>(null);
  const [optimizedSubtitles, setOptimizedSubtitles] = useState<Map<string, string>>(new Map());
  // 标记优化字幕是否已从数据库加载完成（防止迁移保存时的竞态条件）
  const [, setOptimizedSubtitlesLoaded] = useState(false);
  const [optimizingChapterIds, setOptimizingChapterIds] = useState<Set<string>>(new Set());
  const [failedChapterIds, setFailedChapterIds] = useState<Set<string>>(new Set());
  const subtitleOptimizationIdRef = useRef<string | null>(null);
  // 使用 ref 来存储 subtitleOptimizing 的最新值，避免闭包问题
  const subtitleOptimizingRef = useRef(subtitleOptimizing);
  // 字幕数据（用于优化）
  const [subtitleEntries, setSubtitleEntries] = useState<Array<{ index: number; start_time: number; end_time: number; text: string; second_language_text?: string | null }>>([]);

  // 同步 subtitleOptimizing 到 ref
  useEffect(() => {
    subtitleOptimizingRef.current = subtitleOptimizing;
  }, [subtitleOptimizing]);

  // 高光笔记相关状态
  const [highlightIsGenerating, setHighlightIsGenerating] = useState(false);

  // 章节生成状态（用于显示闪烁小点）
  const [chapterIsGenerating, setChapterIsGenerating] = useState(false);

  // 闪记卡生成状态（用于显示闪烁小点）
  const [flashcardIsGenerating, setFlashcardIsGenerating] = useState(false);

  // 全景深度重构蓝图生成状态
  const [blueprintIsGenerating, setBlueprintIsGenerating] = useState(false);
  const [blueprintProgress, setBlueprintProgress] = useState<{current: number; total: number} | null>(null);
  const [blueprintEditMode, setBlueprintEditMode] = useState(false);

  // 确认对话框状态
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmDialogConfig, setConfirmDialogConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ title: "", message: "", onConfirm: () => {} });

  // 解析 detailed_reading 为 DetailedReadingData
  useEffect(() => {
    const parsed = parseDetailedReadingData(note.detailed_reading);
    if (parsed) {
      setDetailedReadingData(parsed);
    } else {
      setDetailedReadingData(null);
    }
  }, [note.id, note.detailed_reading]);

  // 加载字幕数据（用于字幕优化）
  useEffect(() => {
    const loadSubtitles = async () => {
      if (!note.subtitle_path) {
        setSubtitleEntries([]);
        return;
      }
      try {
        const result = await invoke<Array<{ index: number; start_time: number; end_time: number; text: string; second_language_text?: string | null }>>("parse_subtitle_file", {
          path: note.subtitle_path,
        });
        setSubtitleEntries(result);
      } catch (error) {
        console.error("[NoteContentPanel] 加载字幕失败:", error);
        setSubtitleEntries([]);
      }
    };
    loadSubtitles();
  }, [note.subtitle_path]);

  // 用于存储事件监听器的清理函数
  const subtitleOptimizationUnlistenRef = useRef<(() => void) | null>(null);

  // 设置字幕优化事件监听器
  const setupSubtitleOptimizationListener = useCallback(async (generationId: string) => {
    // 清理旧的监听器
    if (subtitleOptimizationUnlistenRef.current) {
      subtitleOptimizationUnlistenRef.current();
      subtitleOptimizationUnlistenRef.current = null;
    }

    const eventName = `subtitle-optimization-${generationId}`;
    const unlisten = await listen<SubtitleOptimizationEvent>(eventName, (event) => {
      const data = event.payload;

      switch (data.status) {
        case "Starting":
          setSubtitleOptimizationProgress({ current: 0, total: data.total });
          break;

        case "ChapterStarted":
          // 章节开始优化
          break;

        case "ChapterCompleted":
          setOptimizedSubtitles(prev => {
            const newMap = new Map(prev);
            newMap.set(data.chapter_id, data.optimized_text);
            return newMap;
          });
          setOptimizingChapterIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.chapter_id);
            return newSet;
          });
          // 使用后端返回的计数，避免并发导致的顺序问题
          setSubtitleOptimizationProgress({
            current: data.completed,
            total: data.total,
          });
          // 保存优化后的字幕到数据库
          invoke("save_optimized_subtitle", {
            noteId: note.id,
            chapterId: data.chapter_id,
            optimizedText: data.optimized_text,
          }).catch(err => {
            console.error("[SubtitleOptimization] 保存字幕到数据库失败:", err);
          });
          break;

        case "ChapterFailed":
          console.error(`[SubtitleOptimization] 章节 ${data.chapter_id} 优化失败:`, data.error);
          setOptimizingChapterIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.chapter_id);
            return newSet;
          });
          setFailedChapterIds(prev => {
            const newSet = new Set(prev);
            newSet.add(data.chapter_id);
            return newSet;
          });
          // 使用后端返回的计数，避免并发导致的顺序问题
          setSubtitleOptimizationProgress({
            current: data.completed + data.failed,
            total: data.total,
          });
          break;

        case "AllCompleted":
          setSubtitleOptimizing(false);
          setSubtitleOptimizationProgress(null);
          setOptimizingChapterIds(new Set());
          // 如果全部失败，自动禁用开关
          if (data.succeeded === 0 && data.failed > 0) {
            message.error("所有章节字幕优化失败");
            setSubtitleOptimizationEnabled(false);
          } else {
            // 清除视觉化总结缓存，使其回退到动态组装（会使用优化后的字幕）
            invoke("clear_visual_summary", { noteId: note.id }).catch(err => {
              console.error("[SubtitleOptimization] 清除视觉化总结缓存失败:", err);
            });
          }
          // 刷新笔记数据以确保视觉化总结能正确显示
          onGenerationComplete?.();
          break;

        case "Aborted":
          setSubtitleOptimizing(false);
          setSubtitleOptimizationProgress(null);
          setOptimizingChapterIds(new Set());
          break;
      }
    });

    subtitleOptimizationUnlistenRef.current = unlisten;
    return unlisten;
  }, [note.id]);

  // 切换笔记时从数据库加载 UI 状态和优化后的字幕，并恢复进行中的任务
  useEffect(() => {
    setOptimizedSubtitlesLoaded(false);
    let stale = false;
    const loadSavedState = async () => {
      try {
        // 加载 UI 状态
        const uiState = await invoke<NoteUiState | null>("get_note_ui_state", { noteId: note.id });
        if (stale) return;
        if (uiState) {
          setShowChapterSubtitles(uiState.show_subtitles);
          setSubtitleOptimizationEnabled(uiState.subtitle_optimization_enabled);
        } else {
          setShowChapterSubtitles(false);
          setSubtitleOptimizationEnabled(false);
        }

        // 加载优化后的字幕缓存
        const savedSubtitles = await invoke<OptimizedSubtitle[]>("get_optimized_subtitles", { noteId: note.id });
        if (stale) return;
        if (savedSubtitles && savedSubtitles.length > 0) {
          const subtitleMap = new Map<string, string>();
          savedSubtitles.forEach(s => subtitleMap.set(s.chapter_id, s.optimized_text));
          setOptimizedSubtitles(subtitleMap);
        } else {
          setOptimizedSubtitles(new Map());
        }

        // 检查是否有进行中的字幕优化任务
        const taskState = await invoke<SubtitleOptimizationTaskState | null>("get_subtitle_optimization_task_state", { noteId: note.id });
        if (stale) return;
        if (taskState && taskState.is_running) {
          // 恢复进行中的任务状态
          subtitleOptimizationIdRef.current = taskState.generation_id;
          setSubtitleOptimizing(true);
          setSubtitleOptimizationEnabled(true);
          setSubtitleOptimizationProgress({
            current: taskState.completed + taskState.failed,
            total: taskState.total,
          });
          setOptimizingChapterIds(new Set(taskState.optimizing_chapter_ids));
          setFailedChapterIds(new Set());

          // 重新订阅事件
          await setupSubtitleOptimizationListener(taskState.generation_id);
          if (stale) return;
        } else {
          // 没有进行中的任务，重置临时状态
          setSubtitleOptimizing(false);
          setSubtitleOptimizationProgress(null);
          setOptimizingChapterIds(new Set());
          setFailedChapterIds(new Set());
          subtitleOptimizationIdRef.current = null;
        }
        setOptimizedSubtitlesLoaded(true);
      } catch (error) {
        if (stale) return;
        console.error("[NoteContentPanel] 加载保存的状态失败:", error);
        setShowChapterSubtitles(false);
        setSubtitleOptimizationEnabled(false);
        setOptimizedSubtitles(new Map());
        setSubtitleOptimizing(false);
        setSubtitleOptimizationProgress(null);
        setOptimizingChapterIds(new Set());
        setFailedChapterIds(new Set());
        subtitleOptimizationIdRef.current = null;
        setOptimizedSubtitlesLoaded(true);
      }
    };

    loadSavedState();

    // 清理函数：笔记切换时标记当前异步操作已过期
    return () => {
      stale = true;
      if (subtitleOptimizationUnlistenRef.current) {
        subtitleOptimizationUnlistenRef.current();
        subtitleOptimizationUnlistenRef.current = null;
      }
    };
  }, [note.id, setupSubtitleOptimizationListener]);

  // 保存 UI 状态到数据库（防抖）
  const saveUiStateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // 清除之前的定时器
    if (saveUiStateTimeoutRef.current) {
      clearTimeout(saveUiStateTimeoutRef.current);
    }

    // 延迟保存，避免频繁写入
    saveUiStateTimeoutRef.current = setTimeout(async () => {
      try {
        await invoke("save_note_ui_state", {
          noteId: note.id,
          showSubtitles: showChapterSubtitles,
          subtitleOptimizationEnabled: subtitleOptimizationEnabled,
        });
      } catch (error) {
        console.error("[NoteContentPanel] 保存 UI 状态失败:", error);
      }
    }, 500);

    return () => {
      if (saveUiStateTimeoutRef.current) {
        clearTimeout(saveUiStateTimeoutRef.current);
      }
    };
  }, [note.id, showChapterSubtitles, subtitleOptimizationEnabled]);

  // 编辑模式状态
  const [isEditMode, setIsEditMode] = useState(false);
  const [isVisualEditMode, setIsVisualEditMode] = useState(false);
  const [visualEditContent, setVisualEditContent] = useState<string>("");
  const [showVisualChapterDropdown, setShowVisualChapterDropdown] = useState(false);
  const [activeVisualChapterIndex, setActiveVisualChapterIndex] = useState(-1);
  const visualChapterDropdownRef = useRef<HTMLDivElement>(null);
  const visualManualScrollingRef = useRef(false);
  const visualManualScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 从全局状态同步组件state
  const syncStateFromGlobal = useCallback(() => {
    const globalState = getNoteGenerationState(note.id);
    return globalState;
  }, [note.id]);

  // 生成状态（从全局状态同步）
  // 注意：isGenerating / progress / generationId 仅用于触发组件重渲染，
  // 实际读取通过 getNoteGenerationState 即时获取，所以不绑定状态值。
  const [, setIsGenerating] = useState(() => syncStateFromGlobal().isGenerating);
  const [, setRegeneratingTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().regeneratingTabs) as Set<TabType>);
  const [, setProgress] = useState<{ current: number; total: number; message: string }>(() => ({ ...syncStateFromGlobal().progress }));
  const [, setCompletedTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().completedTabs) as Set<TabType>);
  const [failedTabs, setFailedTabs] = useState<Map<TabType, string>>(() => new Map(syncStateFromGlobal().failedTabs) as Map<TabType, string>);
  const [, setGenerationId] = useState<string | null>(() => syncStateFromGlobal().generationId);

  // 切换笔记时从全局状态恢复，而不是盲目重置
  useEffect(() => {
    // 从全局状态恢复当前笔记的生成状态
    const globalState = getNoteGenerationState(note.id);

    setIsGenerating(globalState.isGenerating);
    setGenerationId(globalState.generationId);
    setProgress({ ...globalState.progress });
    setCompletedTabs(new Set(globalState.completedTabs) as Set<TabType>);
    setFailedTabs(new Map(globalState.failedTabs) as Map<TabType, string>);
    setRegeneratingTabs(new Set(globalState.regeneratingTabs) as Set<TabType>);

    // 从全局状态恢复高光笔记、闪记卡、章节的生成状态（每个笔记独立）
    setHighlightIsGenerating(globalState.isGeneratingHighlights);
    setFlashcardIsGenerating(globalState.isGeneratingFlashcards);
    setChapterIsGenerating(globalState.isGeneratingChapters);

    // 重置或恢复深度蓝图生成状态（每个笔记独立）
    // 如果该笔记之前正在生成深度蓝图，则恢复其进度
    if (globalState.blueprintIsGenerating) {
      setBlueprintIsGenerating(true);
      setBlueprintProgress(globalState.blueprintProgress);
      // 如果有活动的生成ID，恢复监听
      if (globalState.blueprintGenerationId) {
        setupBlueprintListener(note.id, globalState.blueprintGenerationId);
      }
    } else {
      // 否则确保重置为初始状态
      setBlueprintIsGenerating(false);
      setBlueprintProgress(null);
    }

    // 如果该笔记正在生成中，确保事件监听器已设置
    if (globalState.generationId && globalState.isGenerating) {
      setupGenerationListener(note.id, globalState.generationId);
    }
  }, [note.id]);

  // 视觉化总结页面直接复用原文细读的字幕优化结果
  // 不再自动触发字幕优化，用户需要先在原文细读页面开启"字幕优化"

  // 转换后端的驼峰格式到前端的下划线格式
  const convertTabType = useCallback((backendTabType: string): TabType => {
    // FullSummary -> full_summary
    // DetailedReading -> detailed_reading
    return backendTabType
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '') as TabType;
  }, []);

  // 笔记内容变化时 React 会因 props 变化自动重渲染，
  // 此处之前用 forceUpdate 强制双重渲染纯属冗余（已移除）。

  // 设置深度蓝图生成监听器
  const setupBlueprintListener = useCallback(async (noteId: string, genId: string) => {
    // 避免重复监听
    const eventName = `blueprint-generation-${genId}`;
    if (activeListeners.has(eventName)) {
       // 已经有监听器了，可能需要重新绑定UI更新逻辑?
       // 这里 activeListeners 存储的是 unlisten 函数
       // 如果我们切换了组件实例（比如切走再切回来），之前的 unlisten 可能已经失效或者需要清除
       // 实际上 activeListeners 是全局 Map，所以如果已经有了，说明还在监听。
       // 但问题是，之前的监听器闭包中的 setBlueprintIsGenerating 是属于之前那个组件实例的（?）
       // React 组件重新渲染或卸载重装，闭包引用的 state setter 会变吗？
       // 如果 NoteContentPanel 在切换笔记时是被卸载重载的，那么旧的 setter 就失效了。
       // 应该先清除旧的，再注册新的。
        const oldUnlisten = activeListeners.get(eventName);
        if (oldUnlisten) oldUnlisten();
        activeListeners.delete(eventName);
    }

    const unlisten = await listen(eventName, (event: any) => {
        const payload = event.payload;

        // 更新 UI 状态
        // 只有当当前显示的笔记是正在生成的这个笔记时，才更新UI
        if (noteId === note.id) {
            if (payload.status === 'Progress') {
                setBlueprintProgress({ current: payload.current, total: payload.total });
            } else if (payload.status === 'Completed') {
                setBlueprintIsGenerating(false);
                setBlueprintProgress(null);
                onGenerationComplete?.();
                message.success('全景深度重构蓝图生成完成');
            } else if (payload.status === 'Error') {
                setBlueprintIsGenerating(false);
                setBlueprintProgress(null);
                message.error(`生成失败: ${payload.error}`);
            } else if (payload.status === 'Aborted') {
                setBlueprintIsGenerating(false);
                setBlueprintProgress(null);
                message.info('生成已中止');
            }
        }

        // 更新全局状态
        if (payload.status === 'Progress') {
            setNoteGenerationState(noteId, {
                blueprintProgress: { current: payload.current, total: payload.total }
            });
        } else if (payload.status === 'Completed' || payload.status === 'Error' || payload.status === 'Aborted') {
            setNoteGenerationState(noteId, {
                blueprintIsGenerating: false,
                blueprintProgress: null,
                blueprintGenerationId: null
            });

            // 清理监听器记录
             if (activeListeners.has(eventName)) {
                 activeListeners.delete(eventName);
                 // 注意：这里我们不需要调用 unlisten，因为事件本身是一次性的（或者我们不再需要监听它）
                 // 但为了严谨，我们应该在清理时移除监听器。
                 // 由于我们在回调内部，取消监听也是可以的
             }
        }
    });

    // 注册到全局监听器Map
    activeListeners.set(eventName, unlisten);

    return unlisten;
  }, [note.id, onGenerationComplete]);

  // 设置生成事件监听器
  const setupGenerationListener = useCallback((noteId: string, genId: string) => {
    // 如果已经监听过这个generationId，先清理旧的监听器
    if (activeListeners.has(genId)) {
      const oldUnlisten = activeListeners.get(genId);
      if (oldUnlisten) {
        oldUnlisten();
      }
      activeListeners.delete(genId);
    }

    const unlistenPromise = listen<GenerationEvent>(`note-generation-${genId}`, (event) => {
      const data = event.payload;
      const state = getNoteGenerationState(noteId);

      switch (data.status) {
        case "Starting":
          setNoteGenerationState(noteId, {
            progress: { current: 0, total: data.total_tabs, message: "准备生成..." },
          });
          break;

        case "TabStarted":
          const startedTab = convertTabType(data.tab_type);
          const newRegeneratingOnStart = new Set([...state.regeneratingTabs, startedTab]);
          setNoteGenerationState(noteId, {
            regeneratingTabs: newRegeneratingOnStart,
            progress: { ...state.progress, message: `正在生成 ${data.tab_name}...` },
          });
          break;

        case "TabProgress":
          setNoteGenerationState(noteId, {
            progress: { current: data.current, total: data.total, message: data.message },
          });
          break;

        case "TabCompleted":
          const completedTab = convertTabType(data.tab_type);
          const newCompleted = new Set([...state.completedTabs, completedTab]);
          const newRegenerating = new Set([...state.regeneratingTabs].filter(t => t !== completedTab));
          setNoteGenerationState(noteId, {
            completedTabs: newCompleted,
            regeneratingTabs: newRegenerating,
          });

          // 刷新笔记数据以显示新生成的内容
          setTimeout(() => {
            onGenerationComplete?.();
          }, 500);
          break;

        case "TabError":
          const failedTab = convertTabType(data.tab_type);
          const newFailed = new Map([...state.failedTabs, [failedTab, data.error]]);
          const newRegenerating2 = new Set([...state.regeneratingTabs].filter(t => t !== failedTab));
          setNoteGenerationState(noteId, {
            failedTabs: newFailed,
            regeneratingTabs: newRegenerating2,
          });

          // 如果是取消操作，不显示错误提示
          const isCancelled = data.error.includes("取消") || data.error.includes("中止") || data.error.includes("Aborted");
          if (!isCancelled) {
            // 显示错误提示
            const tabName = failedTab === "full_summary" ? "全文总结" :
              failedTab === "detailed_reading" ? "原文细读" :
              failedTab === "highlights" ? "高光笔记" :
              failedTab === "visual_summary" ? "视觉化总结" :
              failedTab === "ai_note" ? "大纲笔记" :
              "自定义总结";
            message.error(`${tabName}生成失败: ${data.error}`);
          }
          console.error(`[TabError] ${failedTab} 生成失败:`, data.error);
          break;

        case "AllCompleted":
          const newCompletedTabs = new Set([...state.completedTabs]);

          setNoteGenerationState(noteId, {
            isGenerating: false,
            generationId: null,
            regeneratingTabs: new Set(),
            progress: { current: data.total, total: data.total, message: "生成完成!" },
            completedTabs: newCompletedTabs,
          });
          // 清理事件监听器
          const unlisten = activeListeners.get(genId);
          if (unlisten) {
            unlisten();
            activeListeners.delete(genId);
          }
          // 注销 generation_id
          unregisterActiveGenerationId(noteId, genId);

          // 延迟刷新笔记数据，避免与事件处理冲突
          setTimeout(() => {
            onGenerationComplete?.();
          }, 200);
          break;

        case "Aborted":
          setNoteGenerationState(noteId, {
            isGenerating: false,
            generationId: null,
            regeneratingTabs: new Set(),
            progress: { ...state.progress, message: "已中止" },
          });
          const unlisten2 = activeListeners.get(genId);
          if (unlisten2) {
            unlisten2();
            activeListeners.delete(genId);
          }
          // 注销 generation_id
          unregisterActiveGenerationId(noteId, genId);
          break;
      }

      // 通知当前显示的笔记更新UI（如果是当前笔记）
      if (noteId === note.id) {
        const updatedState = getNoteGenerationState(noteId);
        setIsGenerating(updatedState.isGenerating);
        setGenerationId(updatedState.generationId);
        setProgress({ ...updatedState.progress });
        setCompletedTabs(new Set(updatedState.completedTabs) as Set<TabType>);
        setFailedTabs(new Map(updatedState.failedTabs) as Map<TabType, string>);
        setRegeneratingTabs(new Set(updatedState.regeneratingTabs) as Set<TabType>);
      }
    });

    unlistenPromise.then((unlisten) => {
      activeListeners.set(genId, unlisten);
    });
  }, [note.id, convertTabType]);

  // 订阅全局生成状态变更（替代 200ms 轮询，避免长时间运行时持续重渲染）
  useEffect(() => {
    const sync = () => {
      const globalState = getNoteGenerationState(note.id);
      setIsGenerating(globalState.isGenerating);
      setGenerationId(globalState.generationId);
      setProgress({ ...globalState.progress });
      setCompletedTabs(new Set(globalState.completedTabs) as Set<TabType>);
      setFailedTabs(new Map(globalState.failedTabs) as Map<TabType, string>);
      setRegeneratingTabs(new Set(globalState.regeneratingTabs) as Set<TabType>);
      setChapterIsGenerating(globalState.isGeneratingChapters);
    };

    // 挂载时同步一次当前快照
    sync();

    return subscribeNoteGenerationState(note.id, sync);
  }, [note.id]);

  // 自定义提示词弹窗状态
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [dialogTab, setDialogTab] = useState<"default" | "custom">("default");
  const [dialogMode, setDialogMode] = useState<"full" | "custom">("full"); // "full" = 全文总结（可切换标签），"custom" = 自定义总结（仅自定义）
  const [selectedModelId, setSelectedModelId] = useState("");

  // 获取默认 AI 配置
  const getDefaultModelId = useCallback(() => {
    if (currentModelId) return currentModelId;
    if (defaultAiConfigId) return defaultAiConfigId;

    if (aiConfigs.length > 0) return aiConfigs[0].id;

    return "";
  }, [currentModelId, defaultAiConfigId, aiConfigs]);

  const customSummaryPromptConfigs = promptConfigs;

  // 自定义下拉框状态
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);
  const [showSubtitleModeDropdown, setShowSubtitleModeDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const promptDropdownRef = useRef<HTMLDivElement>(null);
  const subtitleModeDropdownRef = useRef<HTMLDivElement>(null);

  // 默认配置参数
  const [configLanguage, setConfigLanguage] = useState<"zh" | "en">("zh");
  const [configShowEmoji, setConfigShowEmoji] = useState(true);
  const [configShowTimestamp, setConfigShowTimestamp] = useState(false);
  const [configHighlightCount, setConfigHighlightCount] = useState(5);
  const [configSentenceLength, setConfigSentenceLength] = useState(30);

  // 自定义输入
  const [customPrompt, setCustomPrompt] = useState("");

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setShowLanguageDropdown(false);
      }
      if (promptDropdownRef.current && !promptDropdownRef.current.contains(event.target as Node)) {
        setShowPromptDropdown(false);
      }
      if (chapterDropdownRef.current && !chapterDropdownRef.current.contains(event.target as Node)) {
        setShowChapterDropdown(false);
      }
      if (visualChapterDropdownRef.current && !visualChapterDropdownRef.current.contains(event.target as Node)) {
        setShowVisualChapterDropdown(false);
      }
      if (subtitleModeDropdownRef.current && !subtitleModeDropdownRef.current.contains(event.target as Node)) {
        setShowSubtitleModeDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeTab !== "original" || !detailedReadingData) return;

    const handleSeekVideo = (event: Event) => {
      const customEvent = event as CustomEvent<{ time: number }>;
      const targetTime = customEvent.detail?.time;
      if (typeof targetTime !== "number") return;

      const chapter = getCurrentChapter(targetTime);
      if (!chapter) return;

      userClickTimeRef.current = Date.now();
      setCurrentChapterId(chapter.id);
      lastChapterIdRef.current = chapter.id;
    };

    window.addEventListener("seek-video", handleSeekVideo);
    return () => window.removeEventListener("seek-video", handleSeekVideo);
  }, [activeTab, detailedReadingData, getCurrentChapter]);

  // 监听视频播放时间变化（仅在章节切换时更新 state，避免每帧重渲染）
  useEffect(() => {
    if (activeTab !== "original") return;

    return subscribeVideoTime((time) => {
      if (Date.now() - userClickTimeRef.current < USER_CHAPTER_SEEK_SUPPRESSION_MS) {
        return;
      }

      const chapter = getCurrentChapter(time);
      const nextId = chapter?.id ?? null;
      setCurrentChapterId((prev) => (prev === nextId ? prev : nextId));
    });
  }, [activeTab, getCurrentChapter]);

  // 字幕滚动自动跳转卡片
  useEffect(() => {
    if (!autoScroll || activeTab !== "original" || !detailedReadingData) return;

    return subscribeVideoTime((currentTime) => {
      // 如果用户刚刚点击过章节，忽略 seek 期间旧时间带来的滚动
      if (Date.now() - userClickTimeRef.current < USER_CHAPTER_SEEK_SUPPRESSION_MS) {
        return;
      }

      // 找到当前时间对应的章节
      const currentChapter = getCurrentChapter(currentTime);

      if (currentChapter && currentChapter.id !== lastChapterIdRef.current) {
        if (shouldAutoScroll) {
          // 滚动到对应的章节卡片
          const chapterElement = document.getElementById(`chapter-${currentChapter.id}`);
          if (chapterElement) {
            isAutoScrollingRef.current = true;
            chapterElement.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => {
              isAutoScrollingRef.current = false;
            }, USER_CHAPTER_SEEK_SUPPRESSION_MS);
          }
        }
        lastChapterIdRef.current = currentChapter.id;
      }
    });
  }, [autoScroll, activeTab, detailedReadingData, shouldAutoScroll, isAutoScrollingRef, getCurrentChapter]);



  // 检查标签页是否正在生成
  const isTabGenerating = (tabId: TabId): boolean => {
    const tabType = TAB_TYPE_MAPPING[tabId];
    if (!tabType) return false;

    // 检查全局状态中是否正在生成该标签页
    const globalState = getNoteGenerationState(note.id);
    if (globalState.regeneratingTabs.has(tabType)) return true;

    // 原文细读（detailed_reading）优先使用全局状态，其次使用组件 state
    if (tabType === "detailed_reading") {
      if (globalState.isGeneratingChapters || chapterIsGenerating) return true;
    }

    // 高光笔记使用单独的生成状态
    if (tabType === "highlights" && highlightIsGenerating) return true;

    // 视觉化总结使用字幕优化状态
    if (tabType === "visual_summary" && subtitleOptimizing) return true;

    // 闪记卡使用单独的生成状态
    if (tabType === "flashcards" && flashcardIsGenerating) return true;

    return false;
  };

  // 检查标签页是否生成失败
  const getTabError = (tabId: TabId): string | undefined => {
    const tabType = TAB_TYPE_MAPPING[tabId];
    if (!tabType) return undefined;
    return failedTabs.get(tabType);
  };

  // 打开自定义提示词弹窗
  const openPromptDialog = () => {
    setSelectedModelId(getDefaultModelId());
    setDialogTab("default");
    setDialogMode("full"); // 全文总结模式，可切换标签
    setConfigLanguage("zh");
    setConfigShowEmoji(true);
    setConfigShowTimestamp(false);
    setConfigHighlightCount(5);
    setConfigSentenceLength(30);
    setCustomPrompt("");
    setShowPromptDialog(true);
  };

  const openCustomPromptDialog = () => {
    setSelectedModelId(getDefaultModelId());
    setDialogTab("custom");
    setDialogMode("custom"); // 自定义总结模式，仅显示自定义输入
    setCustomPrompt("");
    setShowPromptDialog(true);
  };

  // 获取当前标签页的内容
  const getCurrentContent = useCallback((): string | null => {
    const tabType = TAB_TYPE_MAPPING[activeTab];
    if (!tabType) return null;
    if (tabType === "ai_note") {
      return note.ai_note_markdown || null;
    }
    const content = note[tabType];
    if (typeof content === "object" && content !== null) {
      return null;
    }
    return content || null;
  }, [activeTab, note]);

  // 复制当前内容到剪贴板
  const handleCopy = async () => {
    const content = getCurrentContent();
    if (!content) {
      message.warning("暂无内容可复制");
      return;
    }
    try {
      await copyText(content);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  };

  // 下载当前内容为 Markdown 文件
  const handleDownload = async () => {
    const content = getCurrentContent();
    if (!content) {
      message.warning("暂无内容可下载");
      return;
    }
    try {
      // 弹出保存文件对话框
      const filePath = await save({
        defaultPath: note.title,
        filters: [
          {
            name: "Markdown",
            extensions: ["md"],
          },
        ],
      });

      if (!filePath) {
        // 用户取消了选择
        return;
      }

      // 调用 Rust 端保存文件
      await invoke("save_file_content", { path: filePath, content });
      message.success("下载成功");
    } catch (error) {
      console.error("下载失败:", error);
      message.error(`下载失败: ${error}`);
    }
  };

  // 切换标签分组
  const handleGroupChange = (groupId: TabGroupId) => {
    setActiveGroup(groupId);
    // 切换到新组的第一个标签
    const group = TAB_GROUPS.find(g => g.id === groupId);
    if (group && group.tabs.length > 0) {
      setActiveTab(group.tabs[0].id);
    }
  };


  const visualChaptersForMarkdown = useCallback((): ChapterData | null => {
    if (!detailedReadingData) return null;
    return {
      chapters: detailedReadingData.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        start_time: chapter.start_time,
        end_time: chapter.end_time,
        content: "",
        screenshot_path: chapter.screenshot_path,
        level: 1,
        parent_id: null,
      })),
      total_duration: detailedReadingData.total_duration,
      generated_at: detailedReadingData.generated_at,
    };
  }, [detailedReadingData]);

  // 获取视觉化总结的 Markdown 内容（动态生成）
  const getVisualSummaryContent = useCallback((): string => {
    const chapterDataForMarkdown = visualChaptersForMarkdown();
    if (!chapterDataForMarkdown || chapterDataForMarkdown.chapters.length === 0) {
      return "";
    }
    return assembleChapterMarkdown({
      chapters: chapterDataForMarkdown.chapters,
      optimizedSubtitles,
      originalSubtitles: subtitleEntries,
      showTimestamp: true,
    });
  }, [visualChaptersForMarkdown, optimizedSubtitles, subtitleEntries]);

  const getSavedVisualMarkdown = useCallback((): string | null => {
    return note.visual_summary || null;
  }, [note.visual_summary]);

  const getVisualSummaryDisplayMarkdown = useCallback((): string => {
    return getSavedVisualMarkdown() || getVisualSummaryContent();
  }, [getSavedVisualMarkdown, getVisualSummaryContent]);

  const visualSummaryDisplayMarkdown = useMemo(() => {
    return getVisualSummaryDisplayMarkdown();
  }, [getVisualSummaryDisplayMarkdown]);

  const getVisualExportContent = useCallback((): string => {
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryDisplayMarkdown();
    return stripHeadingTimestamps(content);
  }, [getVisualSummaryDisplayMarkdown, isVisualEditMode, visualEditContent]);

  const visualChapterItems = useMemo<TOCItem[]>(() => {
    return extractMarkdownHeadings(visualSummaryDisplayMarkdown);
  }, [visualSummaryDisplayMarkdown]);

  useEffect(() => {
    const toolbarElement = originalToolbarRef.current;
    const leftElement = originalToolbarLeftRef.current;
    const rightElement = originalToolbarRightRef.current;
    const measureLeftExpandedElement = originalToolbarMeasureLeftExpandedRef.current;
    const measureRightCompactElement = originalToolbarMeasureRightCompactRef.current;
    const measureRightExpandedElement = originalToolbarMeasureRightExpandedRef.current;
    if (!toolbarElement || !measureLeftExpandedElement || !measureRightCompactElement || !measureRightExpandedElement) return;

    const updateCompactMode = () => {
      const toolbarWidth = toolbarElement.clientWidth;
      const leftExpandedWidth = getElementContentWidth(measureLeftExpandedElement);
      const rightCompactWidth = getElementContentWidth(measureRightCompactElement);
      const rightExpandedWidth = getElementContentWidth(measureRightExpandedElement);

      const nextLeftCompact = leftExpandedWidth + rightCompactWidth > toolbarWidth + 1;
      const nextRightCompact = nextLeftCompact || leftExpandedWidth + rightExpandedWidth > toolbarWidth + 1;
      const prevState = originalToolbarCompactStateRef.current;

      if (prevState.left !== nextLeftCompact) {
        originalToolbarCompactStateRef.current.left = nextLeftCompact;
        setIsCompactOriginalToolbarLeft(nextLeftCompact);
      }

      if (prevState.right !== nextRightCompact) {
        originalToolbarCompactStateRef.current.right = nextRightCompact;
        setIsCompactOriginalToolbarRight(nextRightCompact);
      }
    };

    updateCompactMode();

    const observer = new ResizeObserver(() => {
      updateCompactMode();
    });

    observer.observe(toolbarElement);
    if (leftElement) observer.observe(leftElement);
    if (rightElement) observer.observe(rightElement);
    observer.observe(measureLeftExpandedElement);
    observer.observe(measureRightCompactElement);
    observer.observe(measureRightExpandedElement);

    return () => observer.disconnect();
  }, [activeTab, isAssistModeActive, showChapterSubtitles, subtitleOptimizationEnabled, subtitleOptimizing, detailedReadingData?.chapters.length, assistModeGenerating, assistModeProgress?.current, assistModeProgress?.total]);

  useEffect(() => {
    const toolbarElement = visualToolbarRef.current;
    const leftElement = visualToolbarLeftRef.current;
    const rightElement = visualToolbarRightRef.current;
    const measureLeftExpandedElement = visualToolbarMeasureLeftExpandedRef.current;
    const measureRightCompactElement = visualToolbarMeasureRightCompactRef.current;
    const measureRightExpandedElement = visualToolbarMeasureRightExpandedRef.current;
    if (!toolbarElement || !measureLeftExpandedElement || !measureRightCompactElement || !measureRightExpandedElement) return;

    const updateCompactMode = () => {
      const toolbarWidth = toolbarElement.clientWidth;
      const leftExpandedWidth = getElementContentWidth(measureLeftExpandedElement);
      const rightCompactWidth = getElementContentWidth(measureRightCompactElement);
      const rightExpandedWidth = getElementContentWidth(measureRightExpandedElement);

      const nextLeftCompact = leftExpandedWidth + rightCompactWidth > toolbarWidth + 1;
      const nextRightCompact = nextLeftCompact || leftExpandedWidth + rightExpandedWidth > toolbarWidth + 1;
      const prevState = visualToolbarCompactStateRef.current;

      if (prevState.left !== nextLeftCompact) {
        visualToolbarCompactStateRef.current.left = nextLeftCompact;
        setIsCompactVisualToolbarLeft(nextLeftCompact);
      }

      if (prevState.right !== nextRightCompact) {
        visualToolbarCompactStateRef.current.right = nextRightCompact;
        setIsCompactVisualToolbarRight(nextRightCompact);
      }
    };

    updateCompactMode();

    const observer = new ResizeObserver(() => {
      updateCompactMode();
    });

    observer.observe(toolbarElement);
    if (leftElement) observer.observe(leftElement);
    if (rightElement) observer.observe(rightElement);
    observer.observe(measureLeftExpandedElement);
    observer.observe(measureRightCompactElement);
    observer.observe(measureRightExpandedElement);

    return () => observer.disconnect();
  }, [activeTab, isVisualEditMode, visualChapterItems.length]);

  const handleVisualChapterJump = useCallback((index: number) => {
    const didScroll = scrollToMarkdownHeading(index);
    if (!didScroll) return;

    visualManualScrollingRef.current = true;
    if (visualManualScrollTimerRef.current) {
      clearTimeout(visualManualScrollTimerRef.current);
    }

    setActiveVisualChapterIndex(index);
    setShowVisualChapterDropdown(false);

    visualManualScrollTimerRef.current = setTimeout(() => {
      visualManualScrollingRef.current = false;
    }, 800);
  }, []);

  useEffect(() => {
    if (activeTab !== "visual" || isVisualEditMode || visualChapterItems.length === 0) {
      setShowVisualChapterDropdown(false);
    }
  }, [activeTab, isVisualEditMode, visualChapterItems.length]);

  useEffect(() => {
    visualManualScrollingRef.current = false;
    if (visualManualScrollTimerRef.current) {
      clearTimeout(visualManualScrollTimerRef.current);
      visualManualScrollTimerRef.current = null;
    }
    setShowVisualChapterDropdown(false);
    setActiveVisualChapterIndex(visualChapterItems.length > 0 ? 0 : -1);
  }, [note.id, visualSummaryDisplayMarkdown, visualChapterItems.length]);

  useEffect(() => {
    if (activeTab !== "visual" || isVisualEditMode || visualChapterItems.length === 0) return;

    let observer: IntersectionObserver | null = null;

    const timer = window.setTimeout(() => {
      const container = getMarkdownContainer();
      const headers = getMarkdownHeadingElements();
      if (!container || headers.length === 0) {
        setActiveVisualChapterIndex(-1);
        return;
      }

      const count = Math.min(headers.length, visualChapterItems.length);
      const scrollContainer = getMarkdownScrollContainer(container);

      const syncActiveIndex = () => {
        if (visualManualScrollingRef.current) return;

        const referenceTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
        let nextActiveIndex = 0;

        for (let i = 0; i < count; i++) {
          const top = headers[i].getBoundingClientRect().top - referenceTop;
          if (top <= 48) {
            nextActiveIndex = i;
          } else {
            break;
          }
        }

        setActiveVisualChapterIndex(nextActiveIndex);
      };

      observer = new IntersectionObserver(
        () => {
          syncActiveIndex();
        },
        {
          root: scrollContainer,
          rootMargin: "-10% 0px -80% 0px",
          threshold: [0, 1],
        }
      );

      for (let i = 0; i < count; i++) {
        observer.observe(headers[i]);
      }

      syncActiveIndex();
    }, 300);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [activeTab, isVisualEditMode, note.id, visualChapterItems]);

  useEffect(() => {
    return () => {
      if (visualManualScrollTimerRef.current) {
        clearTimeout(visualManualScrollTimerRef.current);
      }
    };
  }, []);

  // 视觉化总结复制
  const handleVisualCopy = async () => {
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryDisplayMarkdown();
    if (!content) {
      message.warning("暂无内容可复制");
      return;
    }
    try {
      await copyText(content);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  };

  // 视觉化总结下载
  const handleVisualDownload = async () => {
    const content = getVisualExportContent();
    if (!content) {
      message.warning("暂无内容可下载");
      return;
    }
    try {
      const filePath = await save({
        defaultPath: note.title,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!filePath) return;
      await invoke("save_file_content", { path: filePath, content });
      message.success("下载成功");
    } catch (error) {
      console.error("下载失败:", error);
      message.error(`下载失败: ${error}`);
    }
  };

  // 视觉化总结导出（打包 Markdown 和图片为 zip）
  const handleVisualExport = async () => {
    const content = getVisualExportContent();
    if (!content) {
      message.warning("暂无内容可导出");
      return;
    }
    try {
      const filePath = await save({
        defaultPath: `${note.title}.zip`,
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });
      if (!filePath) return;
      await invoke("export_visual_summary", {
        content,
        savePath: filePath,
        noteTitle: note.title,
      });
      message.success("导出成功");
    } catch (error) {
      console.error("导出失败:", error);
      message.error(`导出失败: ${error}`);
    }
  };

  // 视觉化总结编辑模式切换（进入时初始化内容，退出时保存）
  const handleVisualEditToggle = async () => {
    setShowVisualChapterDropdown(false);

    if (!isVisualEditMode) {
      // 进入编辑模式，优先使用已保存的编辑内容
      const savedMarkdown = getSavedVisualMarkdown();
      setVisualEditContent(savedMarkdown || getVisualSummaryDisplayMarkdown());
    } else {
      // 退出编辑模式，保存内容
      const generatedContent = getVisualSummaryDisplayMarkdown();
      const savedMarkdown = getSavedVisualMarkdown();
      const originalContent = savedMarkdown || generatedContent;
      if (visualEditContent && visualEditContent !== originalContent) {
        try {
          await invoke("update_note_content", {
            noteId: note.id,
            tabType: "visual_summary",
            content: visualEditContent,
          });
          onGenerationComplete?.();
        } catch (error) {
          console.error("保存视觉化总结失败:", error);
          message.error("保存失败");
        }
      }
    }
    setIsVisualEditMode(!isVisualEditMode);
  };

  // 辅助模式下使用截图标记生成章节
  const generateChaptersWithMarkers = useCallback(async (markers: ScreenshotMarker[]) => {
    const effectiveModelId = currentModelId || defaultAiConfigId;
    if (!effectiveModelId || !note.subtitle_path) {
      message.error("缺少必要参数：模型ID或字幕路径");
      console.error("[generateChaptersWithMarkers] 缺少必要参数");
      return;
    }

    if (markers.length === 0) {
      message.warning("请先添加至少一个截图标记");
      return;
    }

    const generationId = crypto.randomUUID();

    // 先注册 generation_id，确保 catch 里可安全清理
    registerActiveGenerationId(note.id, generationId);

    try {
      setAssistModeGenerating(true);
      setChapterIsGenerating(true);
      setChapterGenerating(note.id, true);
      setAssistModeProgress({ current: 0, total: markers.length, message: "准备生成章节..." });

      // 设置事件监听
      const unlisten = await listen<ChapterGenerationEvent>(
        `chapter-generation-${generationId}`,
        (event) => {
          const data = event.payload;
          switch (data.status) {
            case "Starting":
              setAssistModeProgress({ current: 0, total: markers.length, message: "开始生成章节..." });
              break;
            case "AnalyzingSubtitle":
              setAssistModeProgress(prev => prev ? { ...prev, message: data.message } : null);
              break;
            case "ChapterCompleted":
              // 使用后端返回的 completed 计数（并发场景下递增显示）
              setAssistModeProgress({ current: data.completed, total: data.total, message: data.message });
              break;
            case "CapturingScreenshots":
              setAssistModeProgress({ current: data.current, total: data.total, message: data.message });
              break;
            case "Completed":
              setAssistModeProgress({ current: markers.length, total: markers.length, message: "生成完成!" });
              // 刷新笔记数据
              onGenerationComplete?.();
              message.success("章节生成完成");
              setChapterIsGenerating(false);
              setChapterGenerating(note.id, false);
              unregisterActiveGenerationId(note.id, generationId);
              setTimeout(() => {
                setAssistModeGenerating(false);
                setAssistModeProgress(null);
                // 自动退出辅助模式
                setIsAssistModeActive(false);
              }, 1000);
              unlisten();
              break;
            case "Error":
              message.error(`生成失败: ${data.error}`);
              setAssistModeGenerating(false);
              setAssistModeProgress(null);
              setChapterIsGenerating(false);
              setChapterGenerating(note.id, false);
              unregisterActiveGenerationId(note.id, generationId);
              unlisten();
              break;
            case "Aborted":
              setAssistModeGenerating(false);
              setAssistModeProgress(null);
              setChapterIsGenerating(false);
              setChapterGenerating(note.id, false);
              unregisterActiveGenerationId(note.id, generationId);
              unlisten();
              break;
          }
        }
      );

      // 清除字幕优化缓存（内存和数据库）
      setOptimizedSubtitles(new Map());
      setSubtitleOptimizationEnabled(false);
      setFailedChapterIds(new Set());
      try {
        await invoke("delete_optimized_subtitles", { noteId: note.id });
      } catch (err) {
        console.error("[generateChaptersWithMarkers] 清除数据库字幕缓存失败:", err);
      }

      // 清除之前生成的截图
      try {
        await invoke("clear_chapter_screenshots", { noteId: note.id });
      } catch (err) {
        console.error("[generateChaptersWithMarkers] 清除截图缓存失败:", err);
      }

      // 清除视觉化总结缓存，使其在章节重新生成后回退到动态组装
      try {
        await invoke("clear_visual_summary", { noteId: note.id });
      } catch (err) {
        console.error("[generateChaptersWithMarkers] 清除视觉化总结缓存失败:", err);
      }

      // 调用后端生成章节（使用截图标记）
      await invoke("generate_chapters_with_markers", {
        generationId,
        noteId: note.id,
        modelId: effectiveModelId,
        videoPath: note.video_path,
        subtitlePath: note.subtitle_path,
        markers,
      });
    } catch (error) {
      console.error("[generateChaptersWithMarkers] 生成失败:", error);
      message.error(`生成失败: ${error}`);
      setAssistModeGenerating(false);
      setAssistModeProgress(null);
      setChapterIsGenerating(false);
      setChapterGenerating(note.id, false);
      unregisterActiveGenerationId(note.id, generationId);
    }
  }, [note.id, note.video_path, note.subtitle_path, currentModelId, defaultAiConfigId, onGenerationComplete]);

  // 用于存储 generateHighlightsDirectly 的 ref，避免循环依赖
  const generateHighlightsDirectlyRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // 直接调用后端 API 生成高光笔记（用于自动生成流程，不需要切换标签页）
  const generateHighlightsDirectly = useCallback(async () => {
    // 防止重复生成
    if (highlightIsGenerating) {
      return;
    }

    const effectiveModelId = currentModelId || defaultAiConfigId;
    if (!effectiveModelId || !note.subtitle_path) {
      return;
    }

    setHighlightIsGenerating(true);
    setHighlightGenerating(note.id, true);
    try {
      const generationId = await invoke<string>("generate_highlights", {
        noteId: note.id,
        modelId: effectiveModelId,
        subtitlePath: note.subtitle_path,
        highlightType: "default",
        totalDuration: detailedReadingData?.total_duration || 0,
      });

      // 注册 generation_id 以便删除时可以中止
      registerActiveGenerationId(note.id, generationId);

      // 等待生成完成
      const eventName = `highlight-generation-${generationId}`;
      const unlisten = await listen<any>(eventName, (event) => {
        const data = event.payload;
        if (data.status === "AllCompleted") {
          setHighlightIsGenerating(false);
          setHighlightGenerating(note.id, false);
          // 注销 generation_id
          unregisterActiveGenerationId(note.id, generationId);
          onGenerationComplete?.();
          unlisten();
        } else if (data.status === "Aborted") {
          setHighlightIsGenerating(false);
          setHighlightGenerating(note.id, false);
          // 注销 generation_id
          unregisterActiveGenerationId(note.id, generationId);
          unlisten();
        }
      });
    } catch (error) {
      console.error("[generateHighlightsDirectly] 生成失败:", error);
      setHighlightIsGenerating(false);
      setHighlightGenerating(note.id, false);
    }
  }, [note.id, note.subtitle_path, currentModelId, defaultAiConfigId, detailedReadingData?.total_duration, onGenerationComplete, highlightIsGenerating]);

  // 用于存储 triggerVisualSummaryOptimizationSilent 的 ref，避免循环依赖
  const triggerVisualSummaryOptimizationSilentRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // 用于存储 generateFlashcardsDirectly 的 ref，避免循环依赖
  const generateFlashcardsDirectlyRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // 更新 ref 以避免循环依赖
  useEffect(() => {
    generateHighlightsDirectlyRef.current = generateHighlightsDirectly;
  }, [generateHighlightsDirectly]);

  // 触发视觉化总结的字幕优化（静默执行，不切换标签页）
  const triggerVisualSummaryOptimizationSilent = useCallback(async () => {
    // 如果已有缓存或正在优化，则不重复触发
    if (optimizedSubtitles.size > 0 || subtitleOptimizing) {
      return;
    }

    // 检查必要条件
    if (!detailedReadingData || !note.subtitle_path) {
      return;
    }

    // 静默执行字幕优化
    const effectiveModelId = currentModelId || defaultAiConfigId;
    if (!effectiveModelId) {
      return;
    }

    let currentSubtitleEntries = subtitleEntries;
    if (currentSubtitleEntries.length === 0) {
      try {
        currentSubtitleEntries = await invoke<Array<{ index: number; start_time: number; end_time: number; text: string; second_language_text?: string | null }>>("parse_subtitle_file", {
          path: note.subtitle_path,
        });
        setSubtitleEntries(currentSubtitleEntries);
      } catch (error) {
        console.error("[triggerVisualSummaryOptimizationSilent] 加载字幕失败:", error);
        return;
      }
    }

    if (currentSubtitleEntries.length === 0) {
      return;
    }

    const generationId = crypto.randomUUID();
    subtitleOptimizationIdRef.current = generationId;

    const chaptersToOptimize = detailedReadingData.chapters
      .filter(chapter => chapter.id)
      .map(chapter => {
        const filtered = currentSubtitleEntries.filter(
          sub => sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
        );
        
        if (filtered.length === 0) {
          return { chapter_id: chapter.id, subtitle_text: "", has_bilingual: false };
        }
        
        const hasBilingual = filtered.some(sub => sub.second_language_text);
        
        let subtitleText: string;
        if (hasBilingual) {
          const primaryText = filtered.map(sub => sub.text).join(" ");
          const secondaryText = filtered
            .filter(sub => sub.second_language_text)
            .map(sub => sub.second_language_text!)
            .join(" ");
          subtitleText = `${primaryText}\n\n${secondaryText}`;
        } else {
          subtitleText = filtered.map(sub => sub.text).join(" ");
        }
        
        return {
          chapter_id: chapter.id,
          subtitle_text: subtitleText,
          has_bilingual: hasBilingual,
        };
      })
      .filter(c => c.subtitle_text.trim().length > 0);

    if (chaptersToOptimize.length === 0) {
      // 如果是自动生成流程，仍需触发闪记卡生成
      return;
    }

    setSubtitleOptimizing(true);
    setSubtitleOptimizationProgress({ current: 0, total: chaptersToOptimize.length });
    setOptimizingChapterIds(new Set(chaptersToOptimize.map(c => c.chapter_id)));
    setFailedChapterIds(new Set());

    await setupSubtitleOptimizationListener(generationId);

    try {
      await invoke("optimize_chapter_subtitles", {
        generationId,
        noteId: note.id,
        modelId: effectiveModelId,
        chapters: chaptersToOptimize,
      });
    } catch (error) {
      console.error("[triggerVisualSummaryOptimizationSilent] 字幕优化失败:", error);
      setSubtitleOptimizing(false);
      setSubtitleOptimizationProgress(null);
      setOptimizingChapterIds(new Set());
    }
  }, [note.id, note.subtitle_path, currentModelId, defaultAiConfigId, detailedReadingData, subtitleEntries, optimizedSubtitles.size, subtitleOptimizing, setupSubtitleOptimizationListener]);

  // 更新 triggerVisualSummaryOptimizationSilent ref
  useEffect(() => {
    triggerVisualSummaryOptimizationSilentRef.current = triggerVisualSummaryOptimizationSilent;
  }, [triggerVisualSummaryOptimizationSilent]);

  // 直接调用后端 API 生成闪记卡（仅用于手动触发，不需要切换标签页）
  const generateFlashcardsDirectly = useCallback(async () => {
    // 防止重复生成
    if (flashcardIsGenerating) {
      return;
    }

    const effectiveModelId = currentModelId || defaultAiConfigId;
    if (!effectiveModelId || !note.subtitle_path) {
      return;
    }

    try {
      const generationId = crypto.randomUUID();

      // 设置生成状态（让标签页显示闪烁动画）
      setFlashcardIsGenerating(true);
      setFlashcardGenerating(note.id, true);

      // 注册 generation_id 以便删除时可以中止
      registerActiveGenerationId(note.id, generationId);

      // 设置事件监听
      const unlisten = await listen<FlashcardGenerationEvent>(
        `flashcard-generation-${generationId}`,
        (event) => {
          const data = event.payload;
          switch (data.status) {
            case "Completed":
              onGenerationComplete?.();
              // 清除生成状态
              setFlashcardIsGenerating(false);
              setFlashcardGenerating(note.id, false);
              // 注销 generation_id
              unregisterActiveGenerationId(note.id, generationId);
                  unlisten();
              break;
            case "Error":
            case "Aborted":
              // 清除生成状态
              setFlashcardIsGenerating(false);
              setFlashcardGenerating(note.id, false);
              // 注销 generation_id
              unregisterActiveGenerationId(note.id, generationId);
                  unlisten();
              break;
          }
        }
      );

      // 开始生成
      await invoke("generate_flashcards", {
        generationId,
        noteId: note.id,
        modelId: effectiveModelId,
      });
    } catch (error) {
      console.error("[generateFlashcardsDirectly] 生成失败:", error);
      // 清除生成状态
      setFlashcardIsGenerating(false);
      setFlashcardGenerating(note.id, false);
    }
  }, [note.id, note.subtitle_path, currentModelId, defaultAiConfigId, onGenerationComplete, flashcardIsGenerating]);

  // 更新 generateFlashcardsDirectly ref
  useEffect(() => {
    generateFlashcardsDirectlyRef.current = generateFlashcardsDirectly;
  }, [generateFlashcardsDirectly]);

  // 生成全景深度重构蓝图
  const generatePanoramicBlueprint = useCallback(async () => {
    const effectiveModelId = currentModelId || defaultAiConfigId;
    if (blueprintIsGenerating || !effectiveModelId) return;

    const generationId = crypto.randomUUID();

    // 设置本地状态
    setBlueprintIsGenerating(true);
    setBlueprintProgress({ current: 0, total: 10 });

    // 设置全局状态
    setNoteGenerationState(note.id, {
        blueprintIsGenerating: true,
        blueprintGenerationId: generationId,
        blueprintProgress: { current: 0, total: 10 }
    });

    // 设置监听器
    await setupBlueprintListener(note.id, generationId);

    try {
      await invoke('generate_panoramic_blueprint', {
        generationId,
        noteId: note.id,
        modelId: effectiveModelId,
      });
    } catch (error) {
      console.error('生成全景蓝图失败:', error);
      message.error('生成失败');
      setBlueprintIsGenerating(false);
      setBlueprintProgress(null);

      // 更新全局状态为失败
      setNoteGenerationState(note.id, {
          blueprintIsGenerating: false,
          blueprintProgress: null,
          blueprintGenerationId: null
      });
    }
  }, [note.id, currentModelId, defaultAiConfigId, blueprintIsGenerating, setupBlueprintListener]);

  // 字幕优化开关处理
  const handleSubtitleOptimizationToggle = useCallback(async () => {
    // 如果正在优化中且开关是关闭的，说明是视觉化总结触发的优化
    // 此时用户点击开关，应该启用显示，同步显示优化进度
    if (subtitleOptimizing && !subtitleOptimizationEnabled) {
      setSubtitleOptimizationEnabled(true);
      return;
    }

    // 如果正在优化中且开关已开启，不做任何操作
    if (subtitleOptimizing) return;

    if (subtitleOptimizationEnabled) {
      // 关闭优化：中止请求并重置状态
      if (subtitleOptimizationIdRef.current) {
        try {
          await invoke("abort_subtitle_optimization", {
            generationId: subtitleOptimizationIdRef.current,
            noteId: note.id,
          });
        } catch (e) {
          console.error("[SubtitleOptimization] 中止失败:", e);
        }
      }
      setSubtitleOptimizationEnabled(false);
      setSubtitleOptimizing(false);
      setSubtitleOptimizationProgress(null);
      setOptimizingChapterIds(new Set());
      return;
    }

    // 开启优化：检查是否有缓存
    if (optimizedSubtitles.size > 0) {
      // 检查缓存的章节ID是否与当前章节匹配
      const currentChapterIds = new Set(detailedReadingData?.chapters.map(c => c.id) || []);
      const cachedChapterIds = Array.from(optimizedSubtitles.keys());
      const isMatch = cachedChapterIds.some(id => currentChapterIds.has(id));

      if (isMatch) {
        // 有匹配的缓存，直接启用显示
        setSubtitleOptimizationEnabled(true);
        return;
      } else {
        // 缓存的章节ID与当前不匹配（章节已重新生成），清除旧缓存
        setOptimizedSubtitles(new Map());
      }
    }

    // 尝试从数据库加载缓存（可能是初始化时生成的）
    try {
      const savedSubtitles = await invoke<OptimizedSubtitle[]>("get_optimized_subtitles", { noteId: note.id });
      if (savedSubtitles && savedSubtitles.length > 0) {
        // 检查数据库缓存的章节ID是否与当前章节匹配
        const currentChapterIds = new Set(detailedReadingData?.chapters.map(c => c.id) || []);
        const matchedSubtitles = savedSubtitles.filter(s => currentChapterIds.has(s.chapter_id));

        if (matchedSubtitles.length > 0) {
          const subtitleMap = new Map<string, string>();
          matchedSubtitles.forEach(s => subtitleMap.set(s.chapter_id, s.optimized_text));
          setOptimizedSubtitles(subtitleMap);
          setSubtitleOptimizationEnabled(true);
          return;
        }
        // 如果没有匹配的，继续执行重新生成
      }
    } catch (error) {
      console.error("[SubtitleOptimization] 加载缓存失败:", error);
    }

    // 无缓存或缓存不匹配，开始优化
    // 优先使用视频播放器右上角选择的模型
    const effectiveModelId = currentModelId || defaultAiConfigId;
    if (!detailedReadingData || !effectiveModelId || !note.subtitle_path) {
      message.warning("缺少必要的数据，无法进行字幕优化");
      return;
    }

    // 确保字幕数据已加载
    let currentSubtitleEntries = subtitleEntries;
    if (currentSubtitleEntries.length === 0) {
      try {
        message.info("正在加载字幕数据...");
        currentSubtitleEntries = await invoke<Array<{ index: number; start_time: number; end_time: number; text: string; second_language_text?: string | null }>>("parse_subtitle_file", {
          path: note.subtitle_path,
        });
        setSubtitleEntries(currentSubtitleEntries);
      } catch (error) {
        console.error("[SubtitleOptimization] 加载字幕失败:", error);
        message.error("加载字幕数据失败");
        return;
      }
    }

    if (currentSubtitleEntries.length === 0) {
      message.warning("没有可用的字幕数据");
      return;
    }

    const generationId = crypto.randomUUID();
    subtitleOptimizationIdRef.current = generationId;

    // 准备章节字幕数据
    const chaptersToOptimize = detailedReadingData.chapters
      .filter(chapter => chapter.id)
      .map(chapter => {
        // 过滤出当前章节时间范围内的字幕
        const filtered = currentSubtitleEntries.filter(
          sub => sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
        );
        
        if (filtered.length === 0) {
          return { chapter_id: chapter.id, subtitle_text: "", has_bilingual: false };
        }
        
        // 检查是否有双语字幕
        const hasBilingual = filtered.some(sub => sub.second_language_text);
        
        let subtitleText: string;
        if (hasBilingual) {
          // 双语字幕：合并两种语言
          const primaryText = filtered.map(sub => sub.text).join(" ");
          const secondaryText = filtered
            .filter(sub => sub.second_language_text)
            .map(sub => sub.second_language_text!)
            .join(" ");
          subtitleText = `${primaryText}\n\n${secondaryText}`;
        } else {
          // 单语字幕：直接拼接
          subtitleText = filtered.map(sub => sub.text).join(" ");
        }
        
        return {
          chapter_id: chapter.id,
          subtitle_text: subtitleText,
          has_bilingual: hasBilingual,
        };
      })
      .filter(c => c.subtitle_text.trim().length > 0);

    if (chaptersToOptimize.length === 0) {
      message.warning("没有可优化的字幕内容");
      return;
    }

    setSubtitleOptimizationEnabled(true);
    setSubtitleOptimizing(true);
    setSubtitleOptimizationProgress({ current: 0, total: chaptersToOptimize.length });
    setOptimizingChapterIds(new Set(chaptersToOptimize.map(c => c.chapter_id)));
    setFailedChapterIds(new Set());

    // 设置事件监听（使用共享的监听器设置函数）
    await setupSubtitleOptimizationListener(generationId);

    try {
      await invoke("optimize_chapter_subtitles", {
        generationId,
        noteId: note.id,
        modelId: effectiveModelId,
        chapters: chaptersToOptimize,
      });
    } catch (error) {
      console.error("[SubtitleOptimization] 调用失败:", error);
      message.error(`字幕优化失败: ${error}`);
      setSubtitleOptimizing(false);
      setSubtitleOptimizationEnabled(false);
      setSubtitleOptimizationProgress(null);
      setOptimizingChapterIds(new Set());
    }
  }, [subtitleOptimizing, subtitleOptimizationEnabled, optimizedSubtitles, detailedReadingData, note.subtitle_path, note.id, subtitleEntries, setupSubtitleOptimizationListener, currentModelId, defaultAiConfigId]);

  // 高光笔记重新生成处理
  const handleHighlightRegenerate = useCallback(async () => {
    // 显示确认对话框
    setConfirmDialogConfig({
      title: "确认重新生成",
      message: "重新生成将覆盖当前的高光笔记，此操作不可撤销。是否继续？",
      onConfirm: async () => {
        setShowConfirmDialog(false);

        if (!note.subtitle_path || !(currentModelId || defaultAiConfigId)) {
          message.warning("缺少字幕文件或 AI 模型配置");
          return;
        }

        setHighlightIsGenerating(true);
        setHighlightGenerating(note.id, true);
        try {
          const generationId = await invoke<string>("generate_highlights", {
            noteId: note.id,
            modelId: currentModelId || defaultAiConfigId,
            subtitlePath: note.subtitle_path,
            highlightType: "default",
            totalDuration: detailedReadingData?.total_duration || 0,
          });

      // 等待生成完成
      const eventName = `highlight-generation-${generationId}`;
      const unlisten = await listen<any>(eventName, (event) => {
        const data = event.payload;
        if (data.status === "AllCompleted") {
          setHighlightIsGenerating(false);
          setHighlightGenerating(note.id, false);
          onGenerationComplete?.();
          unlisten();
        } else if (data.status === "Aborted") {
          setHighlightIsGenerating(false);
          setHighlightGenerating(note.id, false);
          unlisten();
        }
      });
    } catch (error) {
      console.error("[NoteContentPanel] 高光笔记生成失败:", error);
      message.error(`生成失败: ${error}`);
      setHighlightIsGenerating(false);
      setHighlightGenerating(note.id, false);
    }
      }
    });
    setShowConfirmDialog(true);
  }, [note.id, note.subtitle_path, currentModelId, defaultAiConfigId, detailedReadingData?.total_duration, onGenerationComplete, highlightIsGenerating]);

  // 单章节重新优化字幕
  const handleReoptimizeChapter = useCallback(async (chapterId: string) => {
    // 检查是否有正在进行的优化
    if (optimizingChapterIds.has(chapterId)) {
      return;
    }

    // 获取当前选择的模型
    const effectiveModelId = currentModelId || defaultAiConfigId;
    if (!effectiveModelId) {
      message.warning("请先选择 AI 模型");
      return;
    }

    // 获取章节数据
    const chapter = detailedReadingData?.chapters.find(c => c.id === chapterId);
    if (!chapter) {
      message.error("找不到章节数据");
      return;
    }

    // 确保字幕数据已加载
    let currentSubtitleEntries = subtitleEntries;
    if (currentSubtitleEntries.length === 0 && note.subtitle_path) {
      try {
        currentSubtitleEntries = await invoke<SubtitleEntry[]>("parse_subtitle_file", {
          path: note.subtitle_path,
        });
        setSubtitleEntries(currentSubtitleEntries);
      } catch (error) {
        console.error("[ReoptimizeChapter] 加载字幕失败:", error);
        message.error("加载字幕数据失败");
        return;
      }
    }

    // 获取章节字幕文本
    const filtered = currentSubtitleEntries.filter(
      sub => sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
    );
    
    if (filtered.length === 0) {
      message.warning("该章节没有字幕内容");
      return;
    }

    const hasBilingual = filtered.some(sub => sub.second_language_text);
    let subtitleText: string;
    if (hasBilingual) {
      const primaryText = filtered.map(sub => sub.text).join(" ");
      const secondaryText = filtered
        .filter(sub => sub.second_language_text)
        .map(sub => sub.second_language_text!)
        .join(" ");
      subtitleText = `${primaryText}\n\n${secondaryText}`;
    } else {
      subtitleText = filtered.map(sub => sub.text).join(" ");
    }

    if (!subtitleText.trim()) {
      message.warning("该章节没有字幕内容");
      return;
    }

    const generationId = crypto.randomUUID();

    // 标记章节为正在优化
    setOptimizingChapterIds(prev => {
      const newSet = new Set(prev);
      newSet.add(chapterId);
      return newSet;
    });
    // 清除失败状态
    setFailedChapterIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(chapterId);
      return newSet;
    });

    // 设置事件监听
    const eventName = `single-chapter-optimization-${generationId}`;
    const unlisten = await listen<SingleChapterOptimizationEvent>(eventName, (event) => {
      const data = event.payload;

      switch (data.status) {
        case "Started":
          // 已经在上面标记了
          break;

        case "Completed":
          // 更新优化后的字幕
          setOptimizedSubtitles(prev => {
            const newMap = new Map(prev);
            newMap.set(chapterId, data.optimized_text);
            return newMap;
          });
          setOptimizingChapterIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(chapterId);
            return newSet;
          });
          // 清除视觉化总结缓存，使其回退到动态组装（会使用优化后的字幕）
          invoke("clear_visual_summary", { noteId: note.id }).catch(err => {
            console.error("[ReoptimizeChapter] 清除视觉化总结缓存失败:", err);
          });
          message.success("字幕优化完成");
          unlisten();
          break;

        case "Failed":
          console.error(`[ReoptimizeChapter] 章节 ${chapterId} 优化失败:`, data.error);
          setOptimizingChapterIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(chapterId);
            return newSet;
          });
          setFailedChapterIds(prev => {
            const newSet = new Set(prev);
            newSet.add(chapterId);
            return newSet;
          });
          message.error(`字幕优化失败: ${data.error}`);
          unlisten();
          break;

        case "Aborted":
          setOptimizingChapterIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(chapterId);
            return newSet;
          });
          unlisten();
          break;
      }
    });

    // 调用后端
    try {
      await invoke("optimize_single_chapter_subtitle", {
        generationId,
        noteId: note.id,
        modelId: effectiveModelId,
        chapterId,
        subtitleText,
        hasBilingual,
      });
    } catch (error) {
      console.error("[ReoptimizeChapter] 调用失败:", error);
      message.error(`字幕优化失败: ${error}`);
      setOptimizingChapterIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(chapterId);
        return newSet;
      });
      unlisten();
    }
  }, [detailedReadingData, currentModelId, defaultAiConfigId, note.id, note.subtitle_path, subtitleEntries, optimizingChapterIds]);

  // 根据配置生成动态提示词（Markdown 格式）
  const generateDynamicPrompt = useCallback((): string => {
    const isEnglish = configLanguage === "en";
    const showEmoji = configShowEmoji;
    const emojiExample = showEmoji ? "🔥 " : "";
    const emojiExample2 = showEmoji ? "💡 " : "";
    const timestampExample = configShowTimestamp ? " [00:01:23]" : "";

    if (isEnglish) {
      // 英文提示词
      return `You are a professional video content analyst. Analyze the following video subtitles and generate a structured summary.

Output Requirements:
1. Use Markdown format (do not use code block markers)
2. Must output ALL content in English
3. Use natural, coherent paragraph-style writing. Do NOT use line-by-line listing or fragmented one-sentence-per-line style.
4. Follow this exact format:

# Summary
Summarize the video's topic, core arguments, and key conclusions in 3-5 coherent sentences (each sentence no more than ${configSentenceLength} words). Write as a complete natural paragraph.

# Key Highlights
Extract the most important ${configHighlightCount} key points/highlights${configShowTimestamp ? ", and add the video timestamp (format: [00:01:23]) after each highlight title" : ""}${configShowEmoji ? ", and add an appropriate emoji symbol before each highlight title" : ""}

## ${emojiExample}Highlight Title 1${timestampExample}
Describe in 3-5 sentences: what this highlight covers, why it matters, and what practical significance or insight it offers. Write as a natural paragraph, not a bullet list.

## ${emojiExample2}Highlight Title 2
Describe in 3-5 sentences: what this highlight covers, why it matters, and what practical significance or insight it offers. Write as a natural paragraph, not a bullet list.

(Continue with ${configHighlightCount} highlights)

# Key Terms
- **Term 1**: Explanation
- **Term 2**: Explanation

Video subtitles content:`;
    } else {
      // 中文提示词
      return `你是一个专业的视频内容分析师。请分析以下视频字幕，生成一份结构化的全文总结。

输出要求：
1. 使用 Markdown 格式输出（不要使用代码块标记）
2. 必须使用中文输出所有内容
3. 使用自然连贯的段落式写作，禁止逐行罗列或一行一句的碎片化风格
4. 严格按照以下格式输出：

# 摘要
用3-5句连贯的话概括视频的主题、核心论点和关键结论，每句话不超过${configSentenceLength}字，写成一个完整的自然段落。

# 核心亮点
提取最重要的${configHighlightCount}个知识点/亮点${configShowEmoji ? "，每个亮点标题前必须添加一个合适的 emoji 表情符号（如 🔥 💡 📊 🎯 ⚡）" : ""}${configShowTimestamp ? "，并在每个亮点标题后标注该亮点对应的视频时间戳（格式如 [00:01:23]）" : ""}

## ${emojiExample}亮点标题1${timestampExample}
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

## ${emojiExample2}亮点标题2
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

（继续提取${configHighlightCount}个亮点）

# 关键术语
- **术语1**：解释
- **术语2**：解释

视频字幕内容：`;
    }
  }, [configLanguage, configShowEmoji, configShowTimestamp, configHighlightCount, configSentenceLength]);

  // 使用默认配置直接生成全文总结（空状态下的按钮使用）
  const handleGenerateFullSummaryWithDefaults = useCallback(async () => {
    // 获取有效的模型ID
    const effectiveModelId = currentModelId || defaultAiConfigId || aiConfigs.find(c => c.is_default)?.id || aiConfigs[0]?.id;
    if (!effectiveModelId) {
      message.warning("请先配置 AI 模型");
      return;
    }

    // 全文总结独立生成，只检查自身的生成状态
    const globalState = getNoteGenerationState(note.id);
    if (globalState.regeneratingTabs.has("full_summary")) {
      message.warning("全文总结正在生成中，请稍后再试");
      return;
    }

    // 使用默认配置标签页的当前配置生成提示词
    const defaultPrompt = generateDynamicPrompt();

    try {
      const id = crypto.randomUUID();

      // 只更新 regeneratingTabs 用于 UI 显示，不设置全局 isGenerating
      const currentTabs = new Set(globalState.regeneratingTabs);
      currentTabs.add("full_summary");
      setNoteGenerationState(note.id, {
        regeneratingTabs: currentTabs,
      });

      // 更新组件state
      setRegeneratingTabs(currentTabs as Set<TabType>);

      // 设置事件监听器
      setupGenerationListener(note.id, id);

      // 等待状态更新和事件监听器设置完成
      await new Promise(resolve => setTimeout(resolve, 100));

      // 后端会立即返回 generation_id，实际生成在后台进行
      await invoke("generate_note_content", {
        generationId: id,
        noteId: note.id,
        modelId: effectiveModelId,
        concurrent: true,
        regenerate: true,
        tabsToGenerate: ["full_summary"],
        customPrompt: defaultPrompt,
      });
    } catch (error) {
      // 出错时重置状态
      const currentTabs = new Set(getNoteGenerationState(note.id).regeneratingTabs);
      currentTabs.delete("full_summary");
      setNoteGenerationState(note.id, {
        regeneratingTabs: currentTabs,
      });
      setRegeneratingTabs(currentTabs as Set<TabType>);
      message.error(`生成失败: ${error}`);
    }
  }, [note.id, currentModelId, defaultAiConfigId, aiConfigs, setupGenerationListener, generateDynamicPrompt]);

  // 执行生成（弹框中的重新生成）
  const handleCustomGenerate = async () => {
    if (!selectedModelId) {
      message.warning("请选择AI模型");
      return;
    }

    const currentTabType = TAB_TYPE_MAPPING[activeTab] as TabType;

    // 独立生成，只检查当前标签页的生成状态
    const globalState = getNoteGenerationState(note.id);
    if (currentTabType && globalState.regeneratingTabs.has(currentTabType)) {
      message.warning("当前内容正在生成中，请稍后再试");
      return;
    }

    let finalPrompt = "";

    if (dialogTab === "custom") {
      finalPrompt = customPrompt;
      if (!finalPrompt) {
        message.warning("请输入自定义提示词");
        return;
      }
    } else {
      finalPrompt = generateDynamicPrompt();
    }

    setShowPromptDialog(false);

    try {
      const id = crypto.randomUUID();

      // 只更新 regeneratingTabs 用于 UI 显示，不设置全局 isGenerating
      const currentTabs = new Set(globalState.regeneratingTabs);
      if (currentTabType) {
        currentTabs.add(currentTabType);
      }
      setNoteGenerationState(note.id, {
        regeneratingTabs: currentTabs,
      });

      // 更新组件state
      setRegeneratingTabs(currentTabs as Set<TabType>);

      // 设置事件监听器
      setupGenerationListener(note.id, id);

      // 等待状态更新和事件监听器设置完成
      await new Promise(resolve => setTimeout(resolve, 100));

      // 后端会立即返回 generation_id，实际生成在后台进行
      await invoke("generate_note_content", {
        generationId: id,
        noteId: note.id,
        modelId: selectedModelId,
        concurrent: true,
        regenerate: true,
        tabsToGenerate: [TAB_TYPE_MAPPING[activeTab]],
        customPrompt: finalPrompt,
      });
    } catch (error) {
      // 出错时重置状态
      const currentTabs = new Set(getNoteGenerationState(note.id).regeneratingTabs);
      if (currentTabType) {
        currentTabs.delete(currentTabType);
      }
      setNoteGenerationState(note.id, {
        regeneratingTabs: currentTabs,
      });
      setRegeneratingTabs(currentTabs as Set<TabType>);
      message.error(`生成失败: ${error}`);
    }
  };

  const toolbarButtonClass = "inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-1.5 rounded-xl border border-transparent bg-white/55 px-3 text-sm font-medium text-slate-600 shadow-sm shadow-transparent transition-all cursor-pointer hover:border-slate-200/90 hover:bg-white hover:text-slate-800 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:border-transparent dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-white/8 dark:hover:bg-white/8 dark:hover:text-slate-100 sm:justify-start";
  const toolbarButtonActiveClass = "border-blue-200/80 bg-blue-50/90 text-blue-600 shadow-sm shadow-blue-100/60 dark:border-blue-500/30 dark:bg-blue-500/14 dark:text-blue-400 dark:shadow-transparent";
  const toolbarButtonDisabledClass = "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none";
  const toolbarBarClass = "relative z-40 flex flex-wrap items-center gap-2.5 border-b border-slate-200/80 bg-slate-50/90 px-4 py-2.5 backdrop-blur-sm dark:border-vnote-border/80 dark:bg-vnote-surface/80";
  const toolbarBarNoWrapClass = cn(toolbarBarClass, "flex-nowrap overflow-visible");
  const toolbarSectionNoWrapClass = "flex min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-visible";
  const toolbarSectionResponsiveNoWrapClass = cn(toolbarSectionNoWrapClass, "min-w-0 flex-1");
  const toolbarSectionEndNoWrapClass = cn(toolbarSectionNoWrapClass, "ml-auto shrink-0 justify-end");
  const toolbarActionClusterClass = "flex max-w-full shrink-0 items-center gap-2 overflow-visible rounded-2xl border border-slate-200/75 bg-white/55 p-1 shadow-sm shadow-slate-200/40 dark:border-vnote-border/80 dark:bg-white/5 dark:shadow-none";
  const toolbarActionButtonClass = "min-w-0 flex-1 justify-center whitespace-nowrap sm:flex-none sm:justify-start";
  const toolbarCompactButtonClass = "min-w-0 justify-center";
  const toolbarMetaPillClass = "inline-flex min-h-9 items-center rounded-xl border border-slate-200/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm dark:border-vnote-border/80 dark:bg-white/5 dark:text-slate-400";
  const dropdownMenuClass = "absolute top-full left-0 mt-2 z-[120] max-h-80 overflow-auto rounded-2xl border border-slate-200/95 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] ring-1 ring-slate-200/80 dark:border-vnote-border/95 dark:bg-slate-900 dark:ring-white/10";
  const dropdownHeaderClass = "sticky top-0 flex items-center gap-2 border-b border-slate-200/90 bg-white px-4 py-2 dark:border-vnote-border/90 dark:bg-slate-900";
  const emptyStateActionButtonClass = cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium text-white shadow-sm transition-all cursor-pointer",
    "bg-blue-500 hover:bg-blue-600 hover:shadow-md",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm"
  );

  return (
    <div className={cn("isolate flex h-full flex-col overflow-visible rounded-lg border border-slate-200/70 shadow-soft dark:border-vnote-border/80", glassPanel)}>
      {/* 标签页头部 */}
      <div className={cn("relative z-50 border-b border-slate-200/80 px-3 py-1.5 select-none dark:border-vnote-border/80", glassPanel)}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0 flex-1 pr-[96px]">
            <ResponsiveTabs
              className="min-w-0"
              items={TAB_GROUPS.find(g => g.id === activeGroup)?.tabs || []}
              activeTabId={activeTab}
              onTabClick={(id) => setActiveTab(id as TabId)}
              renderTab={(tab, isDropdown, displayMode) => {
                const generating = isTabGenerating(tab.id as TabId);
                const error = getTabError(tab.id as TabId);
                const isActive = activeTab === tab.id;
                const iconOnly = !isDropdown && displayMode === "icon";

                if (isDropdown) {
                  return (
                    <div className={cn(
                      "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-left transition-all cursor-pointer w-full select-none",
                      isActive
                        ? "bg-blue-50/90 text-blue-600 dark:bg-blue-500/14 dark:text-blue-400"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/6"
                    )}>
                      {tab.icon}
                      <span className="flex-1 truncate">{tab.label}</span>
                      {generating && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping" />}
                      {error && !generating && <X className="w-3 h-3 text-red-500" />}
                    </div>
                  );
                }

                return (
                  <button
                    className={cn(
                      "group inline-flex h-[30px] items-center rounded-xl border text-sm font-medium transition-all relative cursor-pointer whitespace-nowrap",
                      iconOnly ? "w-[30px] justify-center px-0" : "gap-1.5 px-2.5",
                      isActive
                        ? "border-blue-200/85 bg-blue-50/95 text-blue-600 shadow-sm dark:border-blue-500/30 dark:bg-blue-500/14 dark:text-blue-400"
                        : "border-transparent text-slate-500 hover:border-slate-200/80 hover:bg-white/80 hover:text-slate-700 dark:text-slate-400 dark:hover:border-white/8 dark:hover:bg-white/6 dark:hover:text-slate-200"
                    )}
                    title={tab.label}
                    aria-label={tab.label}
                  >
                    {tab.icon}
                    {!iconOnly && tab.label}
                    {generating && (
                      <span className={cn("bg-blue-500 rounded-full animate-ping", iconOnly ? "absolute -top-0.5 -right-0.5 w-2 h-2" : "w-2 h-2")} />
                    )}
                    {error && !generating && (
                      <X className={cn("text-red-500", iconOnly ? "absolute -top-0.5 -right-0.5 w-3 h-3" : "w-3 h-3")} />
                    )}
                  </button>
                );
              }}
            />
          </div>

          <div className="absolute inset-y-0 right-0 z-[90] flex w-[96px] items-center justify-end">
                <button
                  type="button"
                  onClick={() => handleGroupChange(activeGroup === "study" ? "summary" : "study")}
                  title={`切换到${activeGroup === "study" ? TAB_GROUPS[0].label : TAB_GROUPS[1].label}`}
                  className="group relative flex h-[39px] w-full items-center overflow-hidden rounded-[20px] border border-slate-200/84 bg-gradient-to-b from-slate-100/98 via-slate-100/94 to-slate-200/84 px-[7px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.045)] ring-1 ring-white/72 backdrop-blur-sm transition-all duration-200 cursor-pointer hover:border-blue-200/85 hover:text-blue-600 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_24px_rgba(59,130,246,0.11)] dark:border-vnote-border/80 dark:bg-gradient-to-b dark:from-slate-800/92 dark:via-slate-800/88 dark:to-slate-900/82 dark:text-slate-300 dark:ring-white/6 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:hover:border-blue-500/30 dark:hover:text-blue-300 dark:hover:shadow-[0_10px_24px_rgba(2,6,23,0.32)]"
                >
                  <span className="pointer-events-none absolute inset-y-[4px] left-[4px] w-[31px] rounded-[15px] border border-white/78 bg-gradient-to-b from-white via-white to-slate-100/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_5px_12px_rgba(15,23,42,0.055)] transition-all duration-200 group-hover:w-[33px] group-hover:border-blue-100/80 group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_6px_14px_rgba(59,130,246,0.08)] dark:border-white/8 dark:bg-gradient-to-b dark:from-slate-700/78 dark:via-slate-700/64 dark:to-slate-800/70 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_10px_rgba(2,6,23,0.24)] dark:group-hover:border-blue-400/18 dark:group-hover:bg-slate-700/82" />
                  <span className="pointer-events-none absolute right-[8px] top-1/2 h-4.5 w-4.5 -translate-y-1/2 rounded-full bg-white/44 opacity-0 blur-[1px] transition-opacity duration-200 group-hover:opacity-100 dark:bg-blue-400/10" />
                  <span className="relative z-10 flex w-full items-center gap-1.5">
                    <span className="flex h-5.5 w-5.5 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors duration-200 group-hover:text-blue-500 dark:text-slate-400 dark:group-hover:text-blue-300">
                      {activeGroup === "study" ? TAB_GROUPS[1].icon : TAB_GROUPS[0].icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-none tracking-[0.01em]">{activeGroup === "study" ? TAB_GROUPS[1].label : TAB_GROUPS[0].label}</span>
                    <span className="flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded-full border border-slate-200/78 bg-white/82 text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition-all duration-200 group-hover:translate-x-0.5 group-hover:border-blue-200/85 group-hover:bg-blue-50 group-hover:text-blue-500 dark:border-white/8 dark:bg-white/6 dark:text-slate-500 dark:group-hover:border-blue-400/20 dark:group-hover:bg-blue-500/14 dark:group-hover:text-blue-300">
                      <ChevronRight className="h-[11px] w-[11px]" strokeWidth={2.4} />
                    </span>
                  </span>
                </button>
          </div>
        </div>
      </div>

      {/* 次级工具栏测量节点 */}
      <div className="pointer-events-none absolute -left-[9999px] top-0 z-[-1] h-0 overflow-hidden opacity-0" aria-hidden="true">
        <div className={toolbarBarNoWrapClass}>
          <div ref={originalToolbarMeasureLeftExpandedRef} className={toolbarSectionResponsiveNoWrapClass}>
            {isAssistModeActive ? (
              <div className={cn(toolbarMetaPillClass, "max-w-full gap-2 text-blue-600 dark:text-blue-400 sm:text-sm")}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="truncate">点击"添加截图"按钮在字幕行上方添加章节分隔点</span>
                <span className="text-xs text-blue-500 dark:text-blue-300">已添加 {assistModeMarkers.length} 个截图标记</span>
              </div>
            ) : (
              <>
                <div className="relative min-w-0 max-w-full" ref={chapterDropdownRef}>
                  <button
                    onClick={() => setShowChapterDropdown(!showChapterDropdown)}
                    className={cn(toolbarButtonClass, toolbarActionButtonClass, "max-w-full")}
                    type="button"
                    title="章节目录"
                    aria-label="章节目录"
                  >
                    <List className="w-4 h-4" />
                    <span className="truncate">共 {detailedReadingData?.chapters.length || 0} 个章节</span>
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showChapterDropdown && "rotate-180")} />
                  </button>
                  {showChapterDropdown && detailedReadingData && (
                    <div className={cn(dropdownMenuClass, "w-96")}>
                      <div className={dropdownHeaderClass}>
                        <List className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">章节目录</span>
                      </div>
                      <div className="py-1">
                        {detailedReadingData.chapters.map((chapter, index) => {
                          const isCurrentChapter = chapter.id === currentChapterId;
                          const formatTime = (seconds: number): string => {
                            const hours = Math.floor(seconds / 3600);
                            const minutes = Math.floor((seconds % 3600) / 60);
                            const secs = Math.floor(seconds % 60);
                            if (hours > 0) {
                              return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
                            }
                            return `${minutes}:${secs.toString().padStart(2, "0")}`;
                          };
                          return (
                            <button
                              key={chapter.id}
                              onClick={() => handleOriginalChapterJump(chapter)}
                              className={cn(
                                "w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer text-left",
                                isCurrentChapter
                                  ? "bg-blue-50/90 dark:bg-blue-500/16"
                                  : "hover:bg-white/75 dark:hover:bg-white/6"
                              )}
                            >
                              <span className={cn(
                                "inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold",
                                isCurrentChapter
                                  ? "bg-blue-500 text-white"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                              )}>
                                {index + 1}
                              </span>
                              <span className={cn(
                                "flex-1 min-w-0 truncate text-sm",
                                isCurrentChapter
                                  ? "text-blue-600 dark:text-blue-400 font-medium"
                                  : "text-slate-700 dark:text-slate-300"
                              )}>
                                {chapter.title}
                              </span>
                              <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{formatTime(chapter.start_time)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={() => setAutoScroll(!autoScroll)} className={cn(toolbarActionButtonClass, toolbarButtonClass, autoScroll ? toolbarButtonActiveClass : "")} type="button" title="字幕滚动" aria-label="字幕滚动">
                  <Clock className="w-4 h-4" />
                  字幕滚动
                </button>
                {note.subtitle_path && (
                  <>
                    <button
                      onClick={() => setShowChapterSubtitles(!showChapterSubtitles)}
                      className={cn(toolbarActionButtonClass, toolbarButtonClass, showChapterSubtitles && toolbarButtonActiveClass)}
                      type="button"
                      title={showChapterSubtitles ? "隐藏字幕" : "显示字幕"}
                      aria-label={showChapterSubtitles ? "隐藏字幕" : "显示字幕"}
                    >
                      <SubtitlesIcon className="w-4 h-4" />
                      {showChapterSubtitles ? "隐藏字幕" : "显示字幕"}
                    </button>
                    {showChapterSubtitles && detailedReadingData && (
                      <div className="relative min-w-0 max-w-full" ref={subtitleModeDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowSubtitleModeDropdown(!showSubtitleModeDropdown)}
                          disabled={subtitleOptimizing}
                          className={cn(
                            toolbarButtonClass,
                            toolbarActionButtonClass,
                            "max-w-full pr-8 relative focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                            subtitleOptimizationEnabled
                              ? toolbarButtonActiveClass
                              : "border-slate-200/80 bg-white/80 text-slate-600 dark:border-vnote-border/80 dark:bg-white/5 dark:text-slate-300",
                            subtitleOptimizing && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {subtitleOptimizationEnabled ? "智能优化" : "原文"}
                          <ChevronDown className={cn(
                            "absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-transform",
                            subtitleOptimizationEnabled ? "text-blue-400" : "text-slate-400",
                            showSubtitleModeDropdown && "rotate-180"
                          )} />
                        </button>
                        {showSubtitleModeDropdown && !subtitleOptimizing && (
                          <div className={cn(dropdownMenuClass, "right-0 left-auto w-28 py-1")}>
                            {[
                              { value: "original", label: "原文" },
                              { value: "optimized", label: "智能优化" },
                            ].map(mode => (
                              <button
                                key={mode.value}
                                type="button"
                                onClick={async () => {
                                  const shouldEnable = mode.value === "optimized";
                                  if (shouldEnable !== subtitleOptimizationEnabled) {
                                    await handleSubtitleOptimizationToggle();
                                  }
                                  setShowSubtitleModeDropdown(false);
                                }}
                                className={cn(
                                  "w-full px-3 py-2 text-sm text-left transition-colors flex items-center justify-between cursor-pointer",
                                  (mode.value === "optimized" ? subtitleOptimizationEnabled : !subtitleOptimizationEnabled)
                                    ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                )}
                              >
                                {mode.label}
                                {(mode.value === "optimized" ? subtitleOptimizationEnabled : !subtitleOptimizationEnabled) && (
                                  <Check className="w-4 h-4" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <div className={toolbarSectionEndNoWrapClass}>
            <div ref={originalToolbarMeasureRightCompactRef} className={cn(toolbarActionClusterClass, "absolute opacity-0 pointer-events-none")}>
              <ToolbarIconButton
                icon={MousePointer2}
                label="辅助模式"
                active={isAssistModeActive}
                compact={true}
                className={cn(toolbarButtonClass, toolbarCompactButtonClass)}
                onClick={() => setIsAssistModeActive(!isAssistModeActive)}
              >
                辅助模式
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={assistModeGenerating ? Loader2 : RefreshCw}
                label={assistModeGenerating ? "生成中" : "重新生成"}
                disabled={assistModeGenerating}
                spinning={assistModeGenerating}
                compact={true}
                className={cn(toolbarButtonClass, toolbarCompactButtonClass)}
                onClick={() => {}}
              >
                重新生成
              </ToolbarIconButton>
            </div>
            <div ref={originalToolbarMeasureRightExpandedRef} className={toolbarActionClusterClass}>
              <ToolbarIconButton
                icon={MousePointer2}
                label="辅助模式"
                active={isAssistModeActive}
                compact={false}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
                onClick={() => setIsAssistModeActive(!isAssistModeActive)}
              >
                辅助模式
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={assistModeGenerating ? Loader2 : RefreshCw}
                label={assistModeGenerating ? "生成中" : "重新生成"}
                disabled={assistModeGenerating}
                spinning={assistModeGenerating}
                compact={false}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
                onClick={() => {
                  setConfirmDialogConfig({
                    title: "确认重新生成",
                    message: "重新生成将覆盖当前的章节内容，此操作不可撤销。是否继续？",
                    onConfirm: async () => {
                      setShowConfirmDialog(false);
                      if (isAssistModeActive) {
                        generateChaptersWithMarkers(assistModeMarkers);
                      } else {
                        // 清除字幕优化缓存
                        setOptimizedSubtitles(new Map());
                        setSubtitleOptimizationEnabled(false);
                        setFailedChapterIds(new Set());
                        try {
                          await invoke("delete_optimized_subtitles", { noteId: note.id });
                        } catch (err) {
                          console.error("[NoteContentPanel] 清除数据库字幕缓存失败:", err);
                        }
                        try {
                          await invoke("clear_chapter_screenshots", { noteId: note.id });
                        } catch (err) {
                          console.error("[NoteContentPanel] 清除截图缓存失败:", err);
                        }
                        // 清除视觉化总结缓存，使其在章节重新生成后回退到动态组装
                        try {
                          await invoke("clear_visual_summary", { noteId: note.id });
                        } catch (err) {
                          console.error("[NoteContentPanel] 清除视觉化总结缓存失败:", err);
                        }
                        setChapterIsGenerating(true);
                        setChapterGenerating(note.id, true);
                        const generationId = crypto.randomUUID();
                        registerActiveGenerationId(note.id, generationId);
                        try {
                          await invoke("generate_note_content", {
                            generationId,
                            noteId: note.id,
                            modelId: currentModelId || defaultAiConfigId,
                            concurrent: true,
                            regenerate: true,
                            tabsToGenerate: ["detailed_reading"],
                          });
                        } catch (error) {
                          setChapterIsGenerating(false);
                          setChapterGenerating(note.id, false);
                          unregisterActiveGenerationId(note.id, generationId);
                          message.error(`重新生成章节失败: ${error}`);
                        }
                      }
                    },
                  });
                  setShowConfirmDialog(true);
                }}
              >
                {assistModeGenerating ? "生成中..." : "重新生成"}
              </ToolbarIconButton>
            </div>
          </div>
        </div>
        <div className={cn(toolbarBarNoWrapClass, "select-none")}>
          <div ref={visualToolbarMeasureLeftExpandedRef} className={toolbarSectionResponsiveNoWrapClass}>
            {!isVisualEditMode && visualChapterItems.length > 0 && (
              <div className="relative min-w-0 max-w-full">
                <button className={cn(toolbarButtonClass, toolbarActionButtonClass, "max-w-full")} type="button">
                  <List className="w-4 h-4" />
                  <span className="truncate">共 {visualChapterItems.length} 个章节</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          <div className={toolbarSectionEndNoWrapClass}>
            <div ref={visualToolbarMeasureRightCompactRef} className={cn(toolbarActionClusterClass, "absolute opacity-0 pointer-events-none")}>
              <ToolbarIconButton
                icon={Edit3}
                label={isVisualEditMode ? "预览" : "编辑"}
                active={isVisualEditMode}
                compact={true}
                className={cn(toolbarButtonClass, toolbarCompactButtonClass)}
                onClick={() => {}}
              >
                {isVisualEditMode ? "预览" : "编辑"}
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Copy}
                label="复制"
                compact={true}
                className={cn(toolbarButtonClass, toolbarCompactButtonClass)}
                onClick={() => {}}
              >
                复制
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Download}
                label="下载"
                compact={true}
                className={cn(toolbarButtonClass, toolbarCompactButtonClass)}
                onClick={() => {}}
              >
                下载
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Package}
                label="导出"
                compact={true}
                className={cn(toolbarButtonClass, toolbarCompactButtonClass)}
                onClick={() => {}}
              >
                导出
              </ToolbarIconButton>
            </div>
            <div ref={visualToolbarMeasureRightExpandedRef} className={toolbarActionClusterClass}>
              <ToolbarIconButton
                icon={Edit3}
                label={isVisualEditMode ? "预览" : "编辑"}
                active={isVisualEditMode}
                compact={false}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
                onClick={() => {}}
              >
                {isVisualEditMode ? "预览" : "编辑"}
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Copy}
                label="复制"
                compact={false}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
                onClick={() => {}}
              >
                复制
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Download}
                label="下载"
                compact={false}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
                onClick={() => {}}
              >
                下载
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Package}
                label="导出"
                compact={false}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
                onClick={() => {}}
              >
                导出
              </ToolbarIconButton>
            </div>
          </div>
        </div>
      </div>

      {/* 次级工具栏 - 根据标签页显示不同内容 */}
      {activeTab === "summary" ? (
        // 全文总结标签页的工具栏
        <div className={toolbarBarNoWrapClass}>
          <div className={toolbarSectionResponsiveNoWrapClass}>
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={cn(toolbarButtonClass, toolbarActionButtonClass, isEditMode && toolbarButtonActiveClass)}
            >
              <Edit3 className="w-4 h-4" />
              {isEditMode ? "预览" : "编辑"}
            </button>
          </div>
          <div className={toolbarSectionEndNoWrapClass}>
            <div className={toolbarActionClusterClass}>
              <button
                onClick={handleCopy}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Copy className="w-4 h-4" />
                复制
              </button>
              <button
                onClick={handleDownload}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Download className="w-4 h-4" />
                下载
              </button>
              <button
                onClick={openPromptDialog}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <RefreshCw className="w-4 h-4" />
                重新总结
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === "original" ? (
        // 原文细读标签页的工具栏（不管有无章节数据都显示相同）
        <div ref={originalToolbarRef} className={toolbarBarNoWrapClass}>
          <div ref={originalToolbarLeftRef} className={toolbarSectionResponsiveNoWrapClass} data-toolbar-row>
            {isAssistModeActive ? (
              <div className={cn(toolbarMetaPillClass, "max-w-full gap-2 text-blue-600 dark:text-blue-400 sm:text-sm")}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="truncate">点击"添加截图"按钮在字幕行上方添加章节分隔点</span>
                <span className="text-xs text-blue-500 dark:text-blue-300">已添加 {assistModeMarkers.length} 个截图标记</span>
              </div>
            ) : (
              <>
                <div className="relative min-w-0 max-w-full" ref={chapterDropdownRef}>
                  <button
                    onClick={() => setShowChapterDropdown(!showChapterDropdown)}
                    className={cn(
                      toolbarButtonClass,
                      isCompactOriginalToolbarLeft ? toolbarCompactButtonClass : toolbarActionButtonClass,
                      !isCompactOriginalToolbarLeft && "max-w-full"
                    )}
                    title="章节目录"
                    aria-label="章节目录"
                  >
                    <List className="w-4 h-4" />
                    {!isCompactOriginalToolbarLeft && (
                      <>
                        <span className="truncate">共 {detailedReadingData?.chapters.length || 0} 个章节</span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showChapterDropdown ? "rotate-180" : ""}`} />
                      </>
                    )}
                  </button>
                  {showChapterDropdown && detailedReadingData && (
                    <div className={cn(dropdownMenuClass, "w-96")}>
                      <div className={dropdownHeaderClass}>
                        <List className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">章节目录</span>
                      </div>
                      <div className="py-1">
                        {detailedReadingData.chapters.map((chapter, index) => {
                          const isCurrentChapter = chapter.id === currentChapterId;
                          const formatTime = (seconds: number): string => {
                            const hours = Math.floor(seconds / 3600);
                            const minutes = Math.floor((seconds % 3600) / 60);
                            const secs = Math.floor(seconds % 60);
                            if (hours > 0) {
                              return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
                            }
                            return `${minutes}:${secs.toString().padStart(2, "0")}`;
                          };
                          return (
                            <button
                              key={chapter.id}
                              onClick={() => handleOriginalChapterJump(chapter)}
                              className={cn(
                                "w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer text-left",
                                isCurrentChapter
                                  ? "bg-blue-50/90 dark:bg-blue-500/16"
                                  : "hover:bg-white/75 dark:hover:bg-white/6"
                              )}
                            >
                              <span className="text-xs text-blue-400 dark:text-blue-400 font-mono w-12 flex-shrink-0">
                                {formatTime(chapter.start_time)}
                              </span>
                              <span className="text-xs w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                                {index + 1}
                              </span>
                              <span className={cn(
                                "text-sm truncate",
                                isCurrentChapter
                                  ? "text-blue-600 dark:text-blue-400 font-medium"
                                  : "text-slate-700 dark:text-slate-200"
                              )}>
                                {chapter.title}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={cn(
                    isCompactOriginalToolbarLeft ? toolbarCompactButtonClass : toolbarActionButtonClass,
                    toolbarButtonClass,
                    autoScroll ? toolbarButtonActiveClass : ""
                  )}
                  title="字幕滚动"
                  aria-label="字幕滚动"
                >
                  <Clock className="w-4 h-4" />
                  {!isCompactOriginalToolbarLeft && "字幕滚动"}
                </button>

                {note.subtitle_path && (
                  <>
                    <button
                      onClick={() => setShowChapterSubtitles(!showChapterSubtitles)}
                      className={cn(
                        isCompactOriginalToolbarLeft ? toolbarCompactButtonClass : toolbarActionButtonClass,
                        toolbarButtonClass,
                        showChapterSubtitles && toolbarButtonActiveClass
                      )}
                      title={showChapterSubtitles ? "隐藏字幕" : "显示字幕"}
                      aria-label={showChapterSubtitles ? "隐藏字幕" : "显示字幕"}
                    >
                      <SubtitlesIcon className="w-4 h-4" />
                      {!isCompactOriginalToolbarLeft && (showChapterSubtitles ? "隐藏字幕" : "显示字幕")}
                    </button>
                    {showChapterSubtitles && detailedReadingData && (
                      <div className="relative min-w-0 max-w-full" ref={subtitleModeDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowSubtitleModeDropdown(!showSubtitleModeDropdown)}
                          disabled={subtitleOptimizing}
                          className={cn(
                            toolbarButtonClass,
                            toolbarActionButtonClass,
                            "max-w-full pr-8 relative focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                            subtitleOptimizationEnabled
                              ? toolbarButtonActiveClass
                              : "border-slate-200/80 bg-white/80 text-slate-600 dark:border-vnote-border/80 dark:bg-white/5 dark:text-slate-300",
                            subtitleOptimizing && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {subtitleOptimizationEnabled
                            ? (isCompactOriginalToolbarLeft ? "优化" : "智能优化")
                            : "原文"}
                          <ChevronDown className={cn(
                            "absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform pointer-events-none",
                            subtitleOptimizationEnabled ? "text-blue-400" : "text-slate-400",
                            showSubtitleModeDropdown && "rotate-180"
                          )} />
                        </button>
                        {showSubtitleModeDropdown && !subtitleOptimizing && (
                          <div className={cn(dropdownMenuClass, "right-0 left-auto w-28 py-1")}>
                            {[
                              { value: "original", label: "原文" },
                              { value: "optimized", label: "智能优化" },
                            ].map(mode => (
                              <button
                                key={mode.value}
                                type="button"
                                onClick={async () => {
                                  const shouldEnable = mode.value === "optimized";
                                  if (shouldEnable !== subtitleOptimizationEnabled) {
                                    await handleSubtitleOptimizationToggle();
                                  }
                                  setShowSubtitleModeDropdown(false);
                                }}
                                className={cn(
                                  "w-full px-3 py-2 text-sm text-left transition-colors flex items-center justify-between cursor-pointer",
                                  (mode.value === "optimized" ? subtitleOptimizationEnabled : !subtitleOptimizationEnabled)
                                    ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                )}
                              >
                                {mode.label}
                                {(mode.value === "optimized" ? subtitleOptimizationEnabled : !subtitleOptimizationEnabled) && (
                                  <Check className="w-4 h-4" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <div ref={originalToolbarRightRef} className={toolbarSectionEndNoWrapClass} data-toolbar-row>
            <div className={toolbarActionClusterClass}>
              <ToolbarIconButton
                icon={MousePointer2}
                label="辅助模式"
                active={isAssistModeActive}
                compact={isCompactOriginalToolbarRight}
                className={cn(toolbarButtonClass, isCompactOriginalToolbarRight ? toolbarCompactButtonClass : toolbarActionButtonClass)}
                onClick={() => setIsAssistModeActive(!isAssistModeActive)}
              >
                辅助模式
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={assistModeGenerating ? Loader2 : RefreshCw}
                label={assistModeGenerating ? "生成中" : "重新生成"}
                disabled={assistModeGenerating}
                spinning={assistModeGenerating}
                compact={isCompactOriginalToolbarRight}
                className={cn(toolbarButtonClass, isCompactOriginalToolbarRight ? toolbarCompactButtonClass : toolbarActionButtonClass)}
                onClick={() => {
                  setConfirmDialogConfig({
                    title: "确认重新生成",
                    message: "重新生成将覆盖当前的章节内容，此操作不可撤销。是否继续？",
                    onConfirm: async () => {
                      setShowConfirmDialog(false);
                      if (isAssistModeActive) {
                        // 辅助模式下：使用截图标记生成章节
                        generateChaptersWithMarkers(assistModeMarkers);
                      } else {
                        // 普通模式下：清除缓存并重新生成
                        // 清除字幕优化缓存（内存和数据库）
                        setOptimizedSubtitles(new Map());
                        setSubtitleOptimizationEnabled(false);
                        setFailedChapterIds(new Set());
                        try {
                          await invoke("delete_optimized_subtitles", { noteId: note.id });
                        } catch (err) {
                          console.error("[NoteContentPanel] 清除数据库字幕缓存失败:", err);
                        }
                        // 清除之前生成的截图
                        try {
                          await invoke("clear_chapter_screenshots", { noteId: note.id });
                        } catch (err) {
                          console.error("[NoteContentPanel] 清除截图缓存失败:", err);
                        }
                        // 清除视觉化总结缓存，使其在章节重新生成后回退到动态组装
                        try {
                          await invoke("clear_visual_summary", { noteId: note.id });
                        } catch (err) {
                          console.error("[NoteContentPanel] 清除视觉化总结缓存失败:", err);
                        }
                        // 重新生成章节（统一走详细阅读链路）
                        setChapterIsGenerating(true);
                        setChapterGenerating(note.id, true);
                        const generationId = crypto.randomUUID();
                        registerActiveGenerationId(note.id, generationId);
                        try {
                          await invoke("generate_note_content", {
                            generationId,
                            noteId: note.id,
                            modelId: currentModelId || defaultAiConfigId,
                            concurrent: true,
                            regenerate: true,
                            tabsToGenerate: ["detailed_reading"],
                          });
                        } catch (error) {
                          setChapterIsGenerating(false);
                          setChapterGenerating(note.id, false);
                          unregisterActiveGenerationId(note.id, generationId);
                          message.error(`重新生成章节失败: ${error}`);
                        }
                      }
                    }
                  });
                  setShowConfirmDialog(true);
                }}
              >
                {assistModeGenerating ? (
                  <>
                    生成中...
                    {assistModeProgress && !isCompactOriginalToolbarRight && (
                      <span className="text-xs ml-1">
                        ({assistModeProgress.current}/{assistModeProgress.total})
                      </span>
                    )}
                  </>
                ) : (
                  "重新生成"
                )}
              </ToolbarIconButton>
            </div>
          </div>
        </div>
      ) : activeTab === "script" ? (
        // 字幕脚本标签页的专用工具栏
        <div className={toolbarBarNoWrapClass}>
          <div className={cn(toolbarSectionResponsiveNoWrapClass)}>
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(toolbarButtonClass, toolbarActionButtonClass, autoScroll && toolbarButtonActiveClass)}
            >
              <Clock className="w-4 h-4" />
              字幕滚动
            </button>
          </div>
          <div className={toolbarSectionEndNoWrapClass} />
        </div>
      ) : activeTab === "highlights" ? (
        // 高光笔记标签页的专用工具栏
        <div className={toolbarBarNoWrapClass}>
          <div className={toolbarSectionResponsiveNoWrapClass} />
          <div className={toolbarSectionEndNoWrapClass}>
            <div className={toolbarActionClusterClass}>
              <button
                onClick={handleHighlightRegenerate}
                disabled={highlightIsGenerating}
                className={cn(toolbarButtonClass, toolbarActionButtonClass, toolbarButtonDisabledClass)}
              >
                {highlightIsGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    重新生成
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === "visual" ? (
        // 视觉化总结标签页的专用工具栏
        <div ref={visualToolbarRef} className={cn(toolbarBarNoWrapClass, "select-none")}>
          <div ref={visualToolbarLeftRef} className={toolbarSectionResponsiveNoWrapClass} data-toolbar-row>
            {!isVisualEditMode && visualChapterItems.length > 0 && (
              <>
                <div className="relative min-w-0 max-w-full" ref={visualChapterDropdownRef}>
                  <button
                    onClick={() => setShowVisualChapterDropdown(!showVisualChapterDropdown)}
                    className={cn(
                      toolbarButtonClass,
                      isCompactVisualToolbarLeft ? toolbarCompactButtonClass : toolbarActionButtonClass,
                      !isCompactVisualToolbarLeft && "max-w-full"
                    )}
                    title="章节目录"
                    aria-label="章节目录"
                  >
                    <List className="w-4 h-4" />
                    {!isCompactVisualToolbarLeft && (
                      <>
                        <span className="truncate">{`共 ${visualChapterItems.length} 个章节`}</span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showVisualChapterDropdown ? "rotate-180" : ""}`} />
                      </>
                    )}
                  </button>
                  {showVisualChapterDropdown && (
                    <div className={cn(dropdownMenuClass, "w-96")}>
                      <div className={dropdownHeaderClass}>
                        <List className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">章节目录</span>
                      </div>
                      <div className="py-1">
                        {visualChapterItems.map((chapter) => {
                          const isCurrentChapter = chapter.index === activeVisualChapterIndex;
                          return (
                            <button
                              key={`visual-chapter-${chapter.index}`}
                              onClick={() => handleVisualChapterJump(chapter.index)}
                              className={cn(
                                "w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer text-left",
                                isCurrentChapter
                                  ? "bg-blue-50/90 dark:bg-blue-500/16"
                                  : "hover:bg-white/75 dark:hover:bg-white/6"
                              )}
                            >
                              <span className="text-xs w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                                {chapter.index + 1}
                              </span>
                              <span
                                className={cn(
                                  "text-sm truncate",
                                  chapter.level === 2 && "pl-3",
                                  chapter.level === 3 && "pl-6",
                                  isCurrentChapter
                                    ? "text-blue-600 dark:text-blue-400 font-medium"
                                    : "text-slate-700 dark:text-slate-200"
                                )}
                              >
                                {chapter.text}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div ref={visualToolbarRightRef} className={toolbarSectionEndNoWrapClass} data-toolbar-row>
            <div className={toolbarActionClusterClass}>
              <ToolbarIconButton
                icon={Edit3}
                label={isVisualEditMode ? "预览" : "编辑"}
                active={isVisualEditMode}
                compact={isCompactVisualToolbarRight}
                className={cn(toolbarButtonClass, isCompactVisualToolbarRight ? toolbarCompactButtonClass : toolbarActionButtonClass)}
                onClick={handleVisualEditToggle}
              >
                {isVisualEditMode ? "预览" : "编辑"}
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Copy}
                label="复制"
                compact={isCompactVisualToolbarRight}
                className={cn(toolbarButtonClass, isCompactVisualToolbarRight ? toolbarCompactButtonClass : toolbarActionButtonClass)}
                onClick={handleVisualCopy}
              >
                复制
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Download}
                label="下载"
                compact={isCompactVisualToolbarRight}
                className={cn(toolbarButtonClass, isCompactVisualToolbarRight ? toolbarCompactButtonClass : toolbarActionButtonClass)}
                onClick={handleVisualDownload}
              >
                下载
              </ToolbarIconButton>
              <ToolbarIconButton
                icon={Package}
                label="导出"
                compact={isCompactVisualToolbarRight}
                className={cn(toolbarButtonClass, isCompactVisualToolbarRight ? toolbarCompactButtonClass : toolbarActionButtonClass)}
                onClick={handleVisualExport}
              >
                导出
              </ToolbarIconButton>
            </div>
          </div>
        </div>
      ) : activeTab === "custom" && note.custom_summary ? (
        // 自定义总结标签页的工具栏（有内容时显示完整工具栏）
        <div className={toolbarBarNoWrapClass}>
          <div className={toolbarSectionResponsiveNoWrapClass}>
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={cn(toolbarButtonClass, toolbarActionButtonClass, isEditMode && toolbarButtonActiveClass)}
            >
              <Edit3 className="w-4 h-4" />
              {isEditMode ? "预览" : "编辑"}
            </button>
          </div>
          <div className={toolbarSectionEndNoWrapClass}>
            <div className={toolbarActionClusterClass}>
              <button
                onClick={handleCopy}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Copy className="w-4 h-4" />
                复制
              </button>
              <button
                onClick={handleDownload}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Download className="w-4 h-4" />
                下载
              </button>
              <button
                onClick={openCustomPromptDialog}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <RefreshCw className="w-4 h-4" />
                重新总结
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === "custom" && !note.custom_summary ? (
        // 自定义总结标签页的工具栏（无内容时不显示工具栏）
        null
      ) : activeTab === "flashcard" ? (
        // 闪记卡标签页的专用工具栏
        <div className={toolbarBarNoWrapClass}>
          <div className={toolbarSectionResponsiveNoWrapClass} />
          <div className={toolbarSectionEndNoWrapClass}>
            <div className={toolbarActionClusterClass}>
              <button
                onClick={() => {
                  setConfirmDialogConfig({
                    title: "确认重新生成",
                    message: "重新生成将覆盖当前的闪记卡，此操作不可撤销。是否继续？",
                    onConfirm: () => {
                      setShowConfirmDialog(false);
                      window.dispatchEvent(new CustomEvent('flashcard-regenerate', { detail: { noteId: note.id } }));
                    }
                  });
                  setShowConfirmDialog(true);
                }}
                disabled={isTabGenerating("flashcard")}
                className={cn(toolbarButtonClass, toolbarActionButtonClass, toolbarButtonDisabledClass)}
              >
                {isTabGenerating("flashcard") ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    重新生成
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('flashcard-download-csv', { detail: { noteId: note.id } }));
                }}
                disabled={!note.flashcards}
                className={cn(toolbarButtonClass, toolbarActionButtonClass, toolbarButtonDisabledClass)}
              >
                <Download className="w-4 h-4" />
                下载CSV
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === "panoramic_blueprint" && note.panoramic_blueprint ? (
        // 深度蓝图标签页的工具栏（有内容时显示）
        <div className={toolbarBarNoWrapClass}>
          <div className={toolbarSectionResponsiveNoWrapClass}>
            {/* 进度提示 */}
            {blueprintIsGenerating && blueprintProgress ? (
              <div className={toolbarSectionNoWrapClass}>
                <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                <span className="truncate text-sm text-blue-800 dark:text-blue-300">
                  正在生成深度蓝图... ({blueprintProgress.current}/{blueprintProgress.total})
                </span>
              </div>
            ) : (
              <button
                onClick={() => setBlueprintEditMode(!blueprintEditMode)}
                className={cn(toolbarButtonClass, toolbarActionButtonClass, blueprintEditMode && toolbarButtonActiveClass)}
              >
                <Edit3 className="w-4 h-4" />
                {blueprintEditMode ? "预览" : "编辑"}
              </button>
            )}
          </div>
          <div className={toolbarSectionEndNoWrapClass}>
            <div className={toolbarActionClusterClass}>
              <button
                onClick={async () => {
                  if (note.panoramic_blueprint) {
                    await copyText(note.panoramic_blueprint);
                    message.success('已复制到剪贴板');
                  }
                }}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Copy className="w-4 h-4" /> 复制
              </button>
              <button
                onClick={async () => {
                  if (!note.panoramic_blueprint) return;
                  try {
                    const filePath = await save({
                      defaultPath: `${note.title}_深度蓝图.md`,
                      filters: [{ name: 'Markdown', extensions: ['md'] }]
                    });
                    if (filePath) {
                      await invoke('save_file_content', {
                        path: filePath,
                        content: note.panoramic_blueprint
                      });
                      message.success('下载成功');
                    }
                  } catch (error) {
                    message.error('下载失败');
                  }
                }}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Download className="w-4 h-4" /> 下载
              </button>
              <button
                onClick={() => {
                  setConfirmDialogConfig({
                    title: "确认重新生成",
                    message: "重新生成将覆盖当前的深度蓝图，此操作不可撤销。是否继续？",
                    onConfirm: () => {
                      setShowConfirmDialog(false);
                      generatePanoramicBlueprint();
                    }
                  });
                  setShowConfirmDialog(true);
                }}
                disabled={blueprintIsGenerating}
                className={cn(toolbarButtonClass, toolbarActionButtonClass, toolbarButtonDisabledClass)}
              >
                <RefreshCw className={cn("w-4 h-4", blueprintIsGenerating && "animate-spin")} />
                重新生成
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === "ai_note" || activeTab === "quicknotes" || activeTab === "mindmap" || activeTab === "canvas" || activeTab === "panoramic_blueprint" ? (
        // AI 笔记、随手笔记、思维导图、无限画布、深度蓝图标签页不需要额外的次级工具栏
        null
      ) : (
        // 其他标签页的简化工具栏
        <div className={toolbarBarNoWrapClass}>
          <div className={toolbarSectionResponsiveNoWrapClass} />
          <div className={toolbarSectionEndNoWrapClass}>
            <div className={toolbarActionClusterClass}>
              <button
                onClick={handleCopy}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Copy className="w-4 h-4" />
                复制
              </button>
              <button
                onClick={handleDownload}
                className={cn(toolbarButtonClass, toolbarActionButtonClass)}
              >
                <Download className="w-4 h-4" />
                下载
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 内容区域 */}
      <div
        className={cn("relative z-0 flex-1 min-h-0",
          activeTab === "ai_note"
            ? "p-0 overflow-hidden"
            : activeTab === "quicknotes" || activeTab === "mindmap" || activeTab === "canvas"
            ? "p-0 overflow-hidden"
            : activeTab === "script"
            ? "p-0 overflow-hidden" // 字幕脚本使用虚拟列表，需要隐藏外层滚动
            : isEditMode ? "p-0 overflow-y-auto overflow-x-hidden" : "p-6 overflow-y-auto overflow-x-hidden"
        )}
        onScroll={activeTab === "original" ? handleUserScroll : undefined}
      >
        {/* 正常内容渲染 */}
        {activeTab === "summary" && (
          note.full_summary ? (
            <EditableMarkdown
              noteId={note.id}
              tabType="full_summary"
              content={note.full_summary}
              isGenerating={isTabGenerating("summary")}
              emptyMessage="全文总结内容将在AI分析后生成"
              isEditMode={isEditMode}
              onContentUpdate={onGenerationComplete}
            />
          ) : isTabGenerating("summary") ? (
            <EditableMarkdown
              noteId={note.id}
              tabType="full_summary"
              content={null}
              isGenerating={true}
              emptyMessage=""
              isEditMode={false}
              onContentUpdate={onGenerationComplete}
            />
          ) : (
            <SharedEmptyState
              icon={<FileText className="w-8 h-8 text-slate-400 dark:text-slate-500" />}
              title="暂无全文总结"
              description="AI 可以根据视频字幕自动生成结构化的全文总结，包含摘要、核心亮点和关键术语。"
              action={
                <button
                  onClick={handleGenerateFullSummaryWithDefaults}
                  disabled={!note.subtitle_path || aiConfigs.length === 0}
                  className={emptyStateActionButtonClass}
                >
                  <Sparkles className="w-4 h-4" />
                  生成全文总结
                </button>
              }
              hint={
                (!note.subtitle_path || aiConfigs.length === 0)
                  ? (!note.subtitle_path ? "请先上传字幕文件" : "请先配置 AI 模型")
                  : undefined
              }
            />
          )
        )}
        {activeTab === "original" && (() => {
          // 辅助模式下显示 AssistModeView
          if (isAssistModeActive) {
            return (
              <AssistModeView
                noteId={note.id}
                subtitlePath={note.subtitle_path}
                videoPath={note.video_path}
                onRegenerateChapters={(markers: ScreenshotMarker[]) => {
                  generateChaptersWithMarkers(markers);
                }}
                onExitAssistMode={() => setIsAssistModeActive(false)}
                onMarkersChange={setAssistModeMarkers}
              />
            );
          }

          // 使用新格式 DetailedReadingData
          if (detailedReadingData) {
            return (
              <DetailedReadingView
                data={detailedReadingData}
                currentChapterId={currentChapterId}
                subtitleEntries={subtitleEntries}
                showSubtitles={showChapterSubtitles}
                subtitleOptimizationEnabled={subtitleOptimizationEnabled}
                optimizedSubtitles={optimizedSubtitles}
                optimizingChapterIds={optimizingChapterIds}
                failedChapterIds={failedChapterIds}
                onReoptimizeChapter={handleReoptimizeChapter}
              />
            );
          }

          // 空状态
          return (
            <SharedEmptyState
              icon={<BookOpen className="w-8 h-8 text-slate-400 dark:text-slate-500" />}
              title="暂无原文细读数据"
              description="先生成章节与细读内容后，这里会展示结构化章节、字幕片段与精读结果。"
              hint="请点击上方“重新生成”按钮开始生成"
              cardClassName="max-w-xl"
            />
          );
        })()}
        {activeTab === "highlights" && (
          <HighlightGrid
            ref={highlightGridRef}
            noteId={note.id}
            subtitlePath={note.subtitle_path}
            modelId={currentModelId || defaultAiConfigId || null}
            totalDuration={detailedReadingData?.total_duration || 0}
            initialHighlightData={parseHighlightData(note.highlights)}
            onGenerationComplete={() => {
              onGenerationComplete?.();
            }}
            isGenerating={highlightIsGenerating}
            onRegenerate={handleHighlightRegenerate}
          />
        )}
        {activeTab === "script" && <ScriptContent subtitlePath={note.subtitle_path} autoScroll={autoScroll} />}
        {activeTab === "visual" && (
          <VisualSummaryContent
            isEditMode={isVisualEditMode}
            editContent={visualEditContent}
            onEditContentChange={setVisualEditContent}
            savedMarkdownContent={visualSummaryDisplayMarkdown}
          />
        )}
        {activeTab === "custom" && (
          note.custom_summary ? (
            <EditableMarkdown
              noteId={note.id}
              tabType="custom_summary"
              content={note.custom_summary}
              isGenerating={isTabGenerating("custom")}
              emptyMessage="自定义总结 - 根据您的需求定制总结内容"
              isEditMode={isEditMode}
              onContentUpdate={onGenerationComplete}
            />
          ) : isTabGenerating("custom") ? (
            <EditableMarkdown
              noteId={note.id}
              tabType="custom_summary"
              content={null}
              isGenerating={true}
              emptyMessage=""
              isEditMode={false}
              onContentUpdate={onGenerationComplete}
            />
          ) : (
            <SharedEmptyState
              icon={<Sparkles className="w-8 h-8 text-blue-500" />}
              title="自定义总结"
              description="根据您的需求定制总结内容，输入自定义提示词生成更贴合当前学习目标的个性化笔记。"
              action={
                <button
                  onClick={openCustomPromptDialog}
                  className={emptyStateActionButtonClass}
                >
                  <Sparkles className="w-4 h-4" />
                  开始生成
                </button>
              }
              iconWrapClassName="bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30"
            />
          )
        )}
        {activeTab === "ai_note" && (
          <AiNoteContent
            note={note}
            aiConfigs={aiConfigs}
            currentModelId={currentModelId}
            promptConfigs={promptConfigs}
            isGenerating={isTabGenerating("ai_note")}
            onGenerationComplete={onGenerationComplete}
            setupGenerationListener={setupGenerationListener}
          />
        )}
        {activeTab === "flashcard" && (
          <FlashcardContent
            key={note.id}
            noteId={note.id}
            noteName={note.title}
            subtitlePath={note.subtitle_path}
            modelId={currentModelId || defaultAiConfigId || null}
            flashcardData={parseFlashcardData(note.flashcards)}
            isGenerating={isTabGenerating("flashcard")}
            onGenerationComplete={onGenerationComplete}
          />
        )}
        {activeTab === "quicknotes" && (
          <QuickNotesContainer
            noteId={note.id}
            noteTitle={note.title}
            initialContent={note.quick_notes}
            initialMindMapData={note.quick_notes_mindmap}
            initialCanvasData={note.quick_notes_canvas}
            onContentChange={onGenerationComplete}
            forceTab="richtext"
          />
        )}
        {activeTab === "mindmap" && (
          <QuickNotesContainer
            noteId={note.id}
            noteTitle={note.title}
            initialContent={note.quick_notes}
            initialMindMapData={note.quick_notes_mindmap}
            initialCanvasData={note.quick_notes_canvas}
            onContentChange={onGenerationComplete}
            forceTab="mindmap"
          />
        )}
        {activeTab === "canvas" && (
          <QuickNotesContainer
            noteId={note.id}
            noteTitle={note.title}
            initialContent={note.quick_notes}
            initialMindMapData={note.quick_notes_mindmap}
            initialCanvasData={note.quick_notes_canvas}
            onContentChange={onGenerationComplete}
            forceTab="canvas"
          />
        )}
        {activeTab === "panoramic_blueprint" && (
          note.panoramic_blueprint ? (
            <EditableMarkdown
              noteId={note.id}
              tabType="panoramic_blueprint"
              content={note.panoramic_blueprint}
              isGenerating={false}
              emptyMessage=""
              isEditMode={blueprintEditMode}
              onContentUpdate={onGenerationComplete}
            />
          ) : (
            <SharedEmptyState
              icon={<MapIcon className="w-8 h-8 text-blue-500" />}
              title="生成全景深度重构蓝图"
              description="使用 AI 深度分析视频内容，生成更完整的结构化知识文档，便于复盘、重构与延展学习。"
              action={
                (currentModelId || defaultAiConfigId) ? (
                  <button
                    onClick={generatePanoramicBlueprint}
                    disabled={blueprintIsGenerating || !note.subtitle_path}
                    className={emptyStateActionButtonClass}
                  >
                    {blueprintIsGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      <>
                        <MapIcon className="w-4 h-4" />
                        开始生成
                      </>
                    )}
                  </button>
                ) : undefined
              }
              hint={
                (currentModelId || defaultAiConfigId)
                  ? (!note.subtitle_path ? "请先上传字幕文件" : undefined)
                  : <span className="text-sm font-medium text-red-500 dark:text-red-400">请先在视频播放器右上角选择 AI 模型</span>
              }
              iconWrapClassName="bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30"
            />
          )
        )}
      </div>

      {/* 自定义总结弹窗 */}
      {showPromptDialog && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPromptDialog(false)}>
          <div className={cn("rounded-2xl shadow-2xl w-[600px] max-w-[90vw]", glassModal)} onClick={e => e.stopPropagation()}>
            {/* 标题和关闭按钮 */}
            <div className="flex items-center justify-between px-8 pt-6 pb-4">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-500" />
                {dialogMode === "full" ? "重新生成总结" : "重新生成自定义总结"}
              </h3>
              <button
                onClick={() => setShowPromptDialog(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* 标签切换 - 仅全文总结模式显示 */}
            {dialogMode === "full" && (
              <div className="px-8">
                <div className="flex gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  <button
                    onClick={() => setDialogTab("default")}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                      dialogTab === "default"
                        ? cn(glassInput, "text-blue-600 dark:text-blue-400 shadow-sm")
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    默认配置
                  </button>
                  <button
                    onClick={() => setDialogTab("custom")}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                      dialogTab === "custom"
                        ? cn(glassInput, "text-blue-600 dark:text-blue-400 shadow-sm")
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    自定义总结
                  </button>
                </div>
              </div>
            )}

            {/* 默认配置标签页内容 - 仅全文总结模式显示 */}
            {dialogMode === "full" && dialogTab === "default" && (
              <div className="px-8 py-6">
                {/* 两列布局 */}
                <div className="grid grid-cols-2 gap-x-10 gap-y-5">
                  {/* 大语言模型 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">大语言模型</span>
                    <div className="relative" ref={modelDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                        className={cn("w-44 px-3 py-2 pr-10 rounded-xl border border-slate-200/80 dark:border-vnote-border/80 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all truncate", glassInput)}
                      >
                        {aiConfigs.find(c => c.id === selectedModelId)?.title || "选择模型"}
                      </button>
                      <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showModelDropdown ? "rotate-180" : ""}`} />
                      {showModelDropdown && (
                        <div className={cn("absolute z-50 mt-2 w-56 right-0 rounded-2xl border border-white/45 dark:border-vnote-border/80 ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.22)] py-1 max-h-60 overflow-auto", glassMenu)}>
                          {aiConfigs.map(config => (
                            <button
                              key={config.id}
                              type="button"
                              onClick={() => {
                                setSelectedModelId(config.id);
                                setShowModelDropdown(false);
                              }}
                              className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer ${
                                selectedModelId === config.id ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : "text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <span className="truncate">{config.title}</span>
                              {selectedModelId === config.id && <Check className="w-4 h-4 flex-shrink-0 ml-2" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 输出语言 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">输出语言</span>
                    <div className="relative" ref={languageDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                        className={cn("w-32 px-3 py-2 pr-10 rounded-xl border border-slate-200/80 dark:border-vnote-border/80 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all", glassInput)}
                      >
                        {configLanguage === "zh" ? "中文" : "English"}
                      </button>
                      <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showLanguageDropdown ? "rotate-180" : ""}`} />
                      {showLanguageDropdown && (
                        <div className={cn("absolute z-50 mt-2 w-32 right-0 rounded-2xl border border-white/45 dark:border-vnote-border/80 ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.22)] py-1", glassMenu)}>
                          {[
                            { value: "zh", label: "中文" },
                            { value: "en", label: "English" },
                          ].map(lang => (
                            <button
                              key={lang.value}
                              type="button"
                              onClick={() => {
                                setConfigLanguage(lang.value as "zh" | "en");
                                setShowLanguageDropdown(false);
                              }}
                              className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer ${
                                configLanguage === lang.value ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : "text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <span>{lang.label}</span>
                              {configLanguage === lang.value && <Check className="w-4 h-4 flex-shrink-0 ml-2" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 是否显示Emoji */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">是否显示Emoji</span>
                    <button
                      onClick={() => setConfigShowEmoji(!configShowEmoji)}
                      className={`relative w-14 h-7 rounded-full transition-all duration-200 ease-in-out cursor-pointer ${
                        configShowEmoji ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-600"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-200 ease-in-out ${
                          configShowEmoji ? "left-8" : "left-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* 是否显示时间戳 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">是否显示时间戳</span>
                    <button
                      onClick={() => setConfigShowTimestamp(!configShowTimestamp)}
                      className={`relative w-14 h-7 rounded-full transition-all duration-200 ease-in-out cursor-pointer ${
                        configShowTimestamp ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-600"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-200 ease-in-out ${
                          configShowTimestamp ? "left-8" : "left-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* 要点个数 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">要点个数</span>
                    <div className="flex items-center gap-3 w-40">
                      <input
                        type="range"
                        min="1"
                        max="15"
                        value={configHighlightCount}
                        onChange={e => setConfigHighlightCount(Number(e.target.value))}
                        className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-blue-500"
                      />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 w-6 text-center">{configHighlightCount}</span>
                    </div>
                  </div>

                  {/* 句子长短 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">句子长短</span>
                    <div className="flex items-center gap-3 w-40">
                      <input
                        type="range"
                        min="10"
                        max="40"
                        step="5"
                        value={configSentenceLength}
                        onChange={e => setConfigSentenceLength(Number(e.target.value))}
                        className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-blue-500"
                      />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 w-7 text-center">{configSentenceLength}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 自定义总结标签页内容 */}
            {(dialogMode === "custom" || dialogTab === "custom") && (
              <div className="px-8 py-6">
                {/* 大语言模型 */}
                <div className="flex items-center justify-between mb-5">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">大语言模型</span>
                  <div className="relative" ref={modelDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowModelDropdown(!showModelDropdown)}
                      className={cn("w-48 px-3 py-2 pr-10 rounded-xl border border-slate-200/80 dark:border-vnote-border/80 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all truncate", glassInput)}
                    >
                      {aiConfigs.find(c => c.id === selectedModelId)?.title || "选择模型"}
                    </button>
                    <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showModelDropdown ? "rotate-180" : ""}`} />
                    {showModelDropdown && (
                      <div className={cn("absolute z-50 mt-2 w-56 right-0 rounded-2xl border border-white/45 dark:border-vnote-border/80 ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.22)] py-1 max-h-60 overflow-auto", glassMenu)}>
                        {aiConfigs.map(config => (
                          <button
                            key={config.id}
                            type="button"
                            onClick={() => {
                              setSelectedModelId(config.id);
                              setShowModelDropdown(false);
                            }}
                            className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
                              selectedModelId === config.id ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <span className="truncate">{config.title}</span>
                            {selectedModelId === config.id && <Check className="w-4 h-4 flex-shrink-0 ml-2" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 提示词内容输入 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">提示词内容</label>
                    {customSummaryPromptConfigs.length > 0 && (
                      <div className="relative" ref={promptDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowPromptDropdown(!showPromptDropdown)}
                          className={cn("px-3 py-1.5 pr-8 rounded-xl border border-slate-200/80 dark:border-vnote-border/80 text-sm text-slate-600 dark:text-slate-300 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all", glassInput)}
                        >
                          选择已配置的提示词
                        </button>
                        <ChevronDown className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showPromptDropdown ? "rotate-180" : ""}`} />
                        {showPromptDropdown && (
                          <div className={cn("absolute z-50 mt-2 w-64 right-0 rounded-2xl border border-white/45 dark:border-vnote-border/80 ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.22)] py-1 max-h-60 overflow-auto", glassMenu)}>
                            {customSummaryPromptConfigs.map(prompt => (
                              <button
                                key={prompt.id}
                                type="button"
                                onClick={() => {
                                  setCustomPrompt(prompt.content);
                                  setShowPromptDropdown(false);
                                }}
                                className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-300 cursor-pointer"
                              >
                                <div className="font-medium truncate">{prompt.title}</div>
                                {prompt.description && (
                                  <div className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">{prompt.description}</div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder={`请输入您的自定义总结提示词，比如：
将以下视频字幕概括成一段简短的要点，然后用列表的形式提取要点信息，为每个要点信息选择一个适当的表情符号。
输出应使用以下模板：

## 摘要
## 亮点
- [emoji] 要点`}
                    rows={8}
                    className={cn("w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-500 text-sm text-slate-900 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400", glassInput)}
                  />
                </div>
              </div>
            )}

            {/* 底部按钮 */}
            <div className="flex gap-3 px-8 pb-6 pt-2">
              <button
                onClick={() => setShowPromptDialog(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-xl transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleCustomGenerate}
                disabled={(dialogMode === "custom" || dialogTab === "custom") && !customPrompt}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                开始生成
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 确认对话框 */}
      <ConfirmDialog
        open={showConfirmDialog}
        title={confirmDialogConfig.title}
        message={confirmDialogConfig.message}
        onConfirm={confirmDialogConfig.onConfirm}
        onCancel={() => setShowConfirmDialog(false)}
        danger={true}
      />
    </div>
  );
}

// 字幕脚本内容 - 结构化展示字幕
interface ScriptContentProps {
  subtitlePath: string | null;
  autoScroll: boolean;
}

/**
 * 二分查找当前时间对应的字幕索引
 * 字幕按时间排序，使用二分查找提升性能 O(log n)
 */
function findCurrentEntryIndexBinary(entries: SubtitleEntry[], time: number): number | null {
  if (entries.length === 0) return null;

  let left = 0;
  let right = entries.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const entry = entries[mid];

    if (time >= entry.start_time && time <= entry.end_time) {
      return mid;
    }

    if (time < entry.start_time) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }

  return null;
}

function ScriptContent({ subtitlePath, autoScroll }: ScriptContentProps) {
  const [subtitleEntries, setSubtitleEntries] = useState<SubtitleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentEntryIndex, setCurrentEntryIndex] = useState<number | null>(null);

  // 加载并解析字幕文件
  useEffect(() => {
    if (!subtitlePath) {
      setSubtitleEntries([]);
      return;
    }

    setLoading(true);
    setError(null);

    invoke<SubtitleEntry[]>("parse_subtitle_file", { path: subtitlePath })
      .then((entries) => {
        setSubtitleEntries(entries);
      })
      .catch((err) => {
        setError(`无法解析字幕文件: ${err}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [subtitlePath]);

  // 监听视频时间更新（使用二分查找）
  useEffect(() => {
    if (!autoScroll || subtitleEntries.length === 0) return;

    return subscribeVideoTime((currentTime) => {
      const index = findCurrentEntryIndexBinary(subtitleEntries, currentTime);
      setCurrentEntryIndex((prev) => (prev === index ? prev : index));
    });
  }, [autoScroll, subtitleEntries]);

  // 当 autoScroll 关闭时，清除高亮
  useEffect(() => {
    if (!autoScroll) {
      setCurrentEntryIndex(null);
    }
  }, [autoScroll]);

  if (!subtitlePath) {
    return (
      <SharedEmptyState
        icon={<Captions className="w-8 h-8 text-slate-400 dark:text-slate-500" />}
        title="未上传字幕文件"
        description="上传视频时可选择添加字幕文件，导入后这里会展示完整字幕脚本并支持自动跟随播放。"
      />
    );
  }

  if (loading) {
    return (
      <SharedEmptyState
        icon={<Loader2 className="w-8 h-8 animate-spin text-blue-500" />}
        title="加载字幕中"
        description="正在解析字幕文件，请稍候。"
        iconWrapClassName="bg-blue-50/90 dark:bg-blue-900/20"
      />
    );
  }

  if (error) {
    return (
      <SharedEmptyState
        icon={<Captions className="w-8 h-8 text-red-500 dark:text-red-400" />}
        title="字幕解析失败"
        description={error}
        iconWrapClassName="border-red-200/80 bg-red-50/90 dark:border-red-500/30 dark:bg-red-500/10"
      />
    );
  }

  if (subtitleEntries.length === 0) {
    return (
      <SharedEmptyState
        icon={<Captions className="w-8 h-8 text-slate-400 dark:text-slate-500" />}
        title="字幕文件为空"
        description="当前字幕文件中没有可展示的字幕内容，请检查文件内容后重试。"
      />
    );
  }

  return (
    <VirtualizedSubtitleList
      entries={subtitleEntries}
      currentEntryIndex={autoScroll ? currentEntryIndex : null}
    />
  );
}
