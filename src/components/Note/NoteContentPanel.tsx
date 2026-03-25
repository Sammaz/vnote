import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAutoScroll } from "../../hooks/useAutoScroll";
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
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "../../utils/cn";
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
import { assembleChapterMarkdown } from "../../utils/markdownAssembler";
import { ConfirmDialog } from "../common/ConfirmDialog";
import {
  getNoteGenerationState,
  setNoteGenerationState,
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

// ============================================================================
// 全局生成状态管理器（跨组件实例持久化）
// 工具函数已移至 src/utils/noteGenerationState.ts 以避免 Fast Refresh 警告
// ============================================================================

interface NoteContentPanelProps {
  note: Note;
  onGenerationComplete?: () => void;
  aiConfigs: AiConfig[];
  currentModelId?: string | null;
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

export function NoteContentPanel({ note, onGenerationComplete, aiConfigs, currentModelId, promptConfigs = [] }: NoteContentPanelProps) {

  // 当前激活的标签页
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  // 当前激活的标签组
  const [activeGroup, setActiveGroup] = useState<TabGroupId>("summary");

  // HighlightGrid 组件的 ref
  const highlightGridRef = useRef<HighlightGridRef>(null);

  // 原文细读相关状态
  const [detailedReadingData, setDetailedReadingData] = useState<DetailedReadingData | null>(null);
  // 记录 detailedReadingData 所属的笔记 ID，防止笔记切换时的竞态条件
  const detailedReadingDataNoteIdRef = useRef<string | null>(null);

  // 章节下拉框状态
  const [showChapterDropdown, setShowChapterDropdown] = useState(false);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);

  const getCurrentChapter = useCallback((time: number): DetailedReadingChapter | null => {
    if (!detailedReadingData) return null;
    return detailedReadingData.chapters.find(
      chapter => time >= chapter.start_time && time <= chapter.end_time
    ) || null;
  }, [detailedReadingData]);

  // 字幕滚动状态
  const [autoScroll, setAutoScroll] = useState(true);
  // 当前视频播放时间（秒）
  const [currentTime, setCurrentTime] = useState(0);
  // 当前播放的章节ID
  // 用户点击章节的时间戳（用于忽略视频时间更新）
  const userClickTimeRef = useRef<number>(0);
  // 自动滚动控制
  const lastChapterIdRef = useRef<string | null>(null);
  const { shouldAutoScroll, handleUserScroll, isAutoScrollingRef } = useAutoScroll(autoScroll);
  // 显示章节字幕开关
  const [showChapterSubtitles, setShowChapterSubtitles] = useState(false);

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
  const [optimizedSubtitlesLoaded, setOptimizedSubtitlesLoaded] = useState(false);
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
      detailedReadingDataNoteIdRef.current = note.id;
    } else {
      setDetailedReadingData(null);
      detailedReadingDataNoteIdRef.current = null;
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
            // 字幕优化成功，标记待保存视觉化总结
            pendingVisualSummarySaveRef.current = true;
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
    // 切换笔记时清除待保存标志，防止旧笔记的标志影响新笔记
    pendingVisualSummarySaveRef.current = false;
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
  const [showVisualTimestamp, setShowVisualTimestamp] = useState(true);
  const [showVisualChapterDropdown, setShowVisualChapterDropdown] = useState(false);
  const [activeVisualChapterIndex, setActiveVisualChapterIndex] = useState(-1);
  const visualChapterDropdownRef = useRef<HTMLDivElement>(null);
  const visualManualScrollingRef = useRef(false);
  const visualManualScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 标记"需要在状态更新后保存视觉化总结到数据库"
  const pendingVisualSummarySaveRef = useRef<boolean>(false);

  // 从全局状态同步组件state
  const syncStateFromGlobal = useCallback(() => {
    const globalState = getNoteGenerationState(note.id);
    return globalState;
  }, [note.id]);

  // 生成状态（从全局状态同步）
  const [isGenerating, setIsGenerating] = useState(() => syncStateFromGlobal().isGenerating);
  const [, setRegeneratingTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().regeneratingTabs) as Set<TabType>);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string }>(() => ({ ...syncStateFromGlobal().progress }));
  const [, setCompletedTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().completedTabs) as Set<TabType>);
  const [failedTabs, setFailedTabs] = useState<Map<TabType, string>>(() => new Map(syncStateFromGlobal().failedTabs) as Map<TabType, string>);
  const [generationId, setGenerationId] = useState<string | null>(() => syncStateFromGlobal().generationId);

  // 用于触发重新渲染的计数器
  const [, forceUpdate] = useState({});

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

    // 触发重新渲染以更新UI
    forceUpdate({});

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

  // 监听笔记内容变化，确保生成完成后更新显示
  useEffect(() => {
    // 当笔记内容更新时，触发重新渲染
    forceUpdate({});
  }, [note.custom_summary, note.detailed_reading, note.highlights, note.visual_summary, note.full_summary, note.ai_note_markdown, note.ai_note_meta]);

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
        forceUpdate({});
      }
    });

    unlistenPromise.then((unlisten) => {
      activeListeners.set(genId, unlisten);
    });
  }, [note.id, convertTabType]);

  // 定期同步全局状态到组件state（用于跨组件更新）
  useEffect(() => {
    const interval = setInterval(() => {
      const globalState = getNoteGenerationState(note.id);

      // 只有当状态真正变化时才更新
      if (globalState.isGenerating !== isGenerating ||
          globalState.generationId !== generationId ||
          globalState.progress.message !== progress.message ||
          globalState.isGeneratingChapters !== chapterIsGenerating) {
        setIsGenerating(globalState.isGenerating);
        setGenerationId(globalState.generationId);
        setProgress({ ...globalState.progress });
        setCompletedTabs(new Set(globalState.completedTabs) as Set<TabType>);
        setFailedTabs(new Map(globalState.failedTabs) as Map<TabType, string>);
        setRegeneratingTabs(new Set(globalState.regeneratingTabs) as Set<TabType>);
        setChapterIsGenerating(globalState.isGeneratingChapters);
      }
    }, 200); // 每200ms同步一次

    return () => clearInterval(interval);
  }, [note.id, isGenerating, generationId, progress.message, chapterIsGenerating]);

  // 自定义提示词弹窗状态
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [dialogTab, setDialogTab] = useState<"default" | "custom">("default");
  const [selectedModelId, setSelectedModelId] = useState("");

  // 获取默认 AI 配置或使用笔记的 model_id
  const getDefaultModelId = useCallback(() => {
    if (currentModelId) return currentModelId;
    if (note.model_id) return note.model_id;

    const defaultConfig = aiConfigs.find(c => c.is_default);
    if (defaultConfig) return defaultConfig.id;

    if (aiConfigs.length > 0) return aiConfigs[0].id;

    return "";
  }, [currentModelId, note.model_id, aiConfigs]);

  const customSummaryPromptConfigs = promptConfigs.filter(p => p.category === "summary");

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

  // 监听视频播放时间变化（用于原文细读当前时间同步）
  useEffect(() => {
    if (activeTab !== "original") return;

    const handleCurrentTimeUpdate = (e: Event) => {
      const event = e as CustomEvent<{ time: number }>;
      setCurrentTime(event.detail.time);
    };

    window.addEventListener("video-time-update", handleCurrentTimeUpdate);
    return () => window.removeEventListener("video-time-update", handleCurrentTimeUpdate);
  }, [activeTab]);

  // 字幕滚动自动跳转卡片
  useEffect(() => {
    if (!autoScroll || activeTab !== "original" || !detailedReadingData) return;

    const handleVideoTimeUpdate = (e: Event) => {
      // 如果用户刚刚点击过章节（500ms内），忽略视频时间更新带来的滚动
      if (Date.now() - userClickTimeRef.current < 500) {
        return;
      }

      const event = e as CustomEvent<{ time: number }>;
      const currentTime = event.detail.time;

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
            }, 500); // 增加保护时间到 500ms
          }
        }
        lastChapterIdRef.current = currentChapter.id;
      }
    };

    window.addEventListener("video-time-update", handleVideoTimeUpdate);
    return () => window.removeEventListener("video-time-update", handleVideoTimeUpdate);
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
      await navigator.clipboard.writeText(content);
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
      showTimestamp: showVisualTimestamp,
    });
  }, [visualChaptersForMarkdown, optimizedSubtitles, subtitleEntries, showVisualTimestamp]);

  const getSavedVisualMarkdown = useCallback((): string | null => {
    return note.visual_summary || null;
  }, [note.visual_summary]);

  const getVisualSummaryDisplayMarkdown = useCallback((): string => {
    return getSavedVisualMarkdown() || getVisualSummaryContent();
  }, [getSavedVisualMarkdown, getVisualSummaryContent]);

  const visualSummaryDisplayMarkdown = useMemo(() => {
    return getVisualSummaryDisplayMarkdown();
  }, [getVisualSummaryDisplayMarkdown]);

  const visualChapterItems = useMemo<TOCItem[]>(() => {
    return extractMarkdownHeadings(visualSummaryDisplayMarkdown);
  }, [visualSummaryDisplayMarkdown]);

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

  // 组装视觉化总结 Markdown 并保存到数据库
  const saveAssembledVisualMarkdown = useCallback(async () => {
    const chapterDataForMarkdown = visualChaptersForMarkdown();
    if (!chapterDataForMarkdown || chapterDataForMarkdown.chapters.length === 0) return;
    if (detailedReadingDataNoteIdRef.current !== note.id) return;
    const content = assembleChapterMarkdown({
      chapters: chapterDataForMarkdown.chapters,
      optimizedSubtitles,
      originalSubtitles: subtitleEntries,
      showTimestamp: true,
    });
    if (!content) return;
    try {
      await invoke("update_note_content", {
        noteId: note.id,
        tabType: "visual_summary",
        content,
      });
    } catch (error) {
      console.error("保存视觉化总结失败:", error);
    }
  }, [visualChaptersForMarkdown, note.id, optimizedSubtitles, subtitleEntries]);

  // 当章节数据/optimizedSubtitles 更新后，如果有待保存标志，执行保存
  useEffect(() => {
    if (!pendingVisualSummarySaveRef.current) return;
    pendingVisualSummarySaveRef.current = false;
    saveAssembledVisualMarkdown().then(() => {
      onGenerationComplete?.();
    });
  }, [detailedReadingData, optimizedSubtitles, saveAssembledVisualMarkdown, onGenerationComplete]);

  // 迁移兼容：已有章节但从未保存过 visual_summary 的旧笔记，自动保存
  // 必须等待 optimizedSubtitles 从数据库加载完成，否则会回退到原始字幕
  // 注意：队列完成后 refreshNotes 会更新 note.detailed_reading（触发章节数据解析），
  // 但 loadSavedState 只依赖 note.id 不会重新执行，导致 optimizedSubtitles 可能是空 Map。
  // 因此这里需要重新从数据库加载优化字幕，确保用最新数据组装 markdown。
  useEffect(() => {
    if (!optimizedSubtitlesLoaded) return;
    if (!(detailedReadingData && detailedReadingData.chapters.length > 0 && !note.visual_summary)) return;
    let cancelled = false;
    (async () => {
      // 重新从数据库加载优化字幕，防止队列完成后 optimizedSubtitles 仍为空 Map
      const savedSubtitles = await invoke<OptimizedSubtitle[]>(
        "get_optimized_subtitles", { noteId: note.id }
      );
      if (cancelled) return;
      if (savedSubtitles && savedSubtitles.length > 0) {
        const freshMap = new Map<string, string>();
        savedSubtitles.forEach(s => freshMap.set(s.chapter_id, s.optimized_text));
        setOptimizedSubtitles(freshMap);
        // 字幕状态更新后，由 pendingVisualSummarySaveRef 机制触发保存
        pendingVisualSummarySaveRef.current = true;
      } else {
        // 没有优化字幕，直接用原始字幕组装保存
        saveAssembledVisualMarkdown().then(() => {
          onGenerationComplete?.();
        });
      }
    })();
    return () => { cancelled = true; };
  }, [note.id, detailedReadingData, note.visual_summary, optimizedSubtitlesLoaded, saveAssembledVisualMarkdown, onGenerationComplete]);

  // 视觉化总结复制
  const handleVisualCopy = async () => {
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryDisplayMarkdown();
    if (!content) {
      message.warning("暂无内容可复制");
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  };

  // 视觉化总结下载
  const handleVisualDownload = async () => {
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryDisplayMarkdown();
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
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryDisplayMarkdown();
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
    const effectiveModelId = currentModelId || note.model_id;
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
              // 标记待保存视觉化总结
              pendingVisualSummarySaveRef.current = true;
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
  }, [note.id, note.video_path, note.subtitle_path, note.model_id, currentModelId, onGenerationComplete]);

  // 用于存储 generateHighlightsDirectly 的 ref，避免循环依赖
  const generateHighlightsDirectlyRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // 直接调用后端 API 生成高光笔记（用于自动生成流程，不需要切换标签页）
  const generateHighlightsDirectly = useCallback(async () => {
    // 防止重复生成
    if (highlightIsGenerating) {
      return;
    }

    const effectiveModelId = currentModelId || note.model_id;
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
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, detailedReadingData?.total_duration, onGenerationComplete, highlightIsGenerating]);

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
    if (!detailedReadingData || !note.subtitle_path || !note.model_id) {
      return;
    }

    // 静默执行字幕优化
    const effectiveModelId = currentModelId || note.model_id;
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
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, detailedReadingData, subtitleEntries, optimizedSubtitles.size, subtitleOptimizing, setupSubtitleOptimizationListener]);

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

    const effectiveModelId = currentModelId || note.model_id;
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
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, onGenerationComplete, flashcardIsGenerating]);

  // 更新 generateFlashcardsDirectly ref
  useEffect(() => {
    generateFlashcardsDirectlyRef.current = generateFlashcardsDirectly;
  }, [generateFlashcardsDirectly]);

  // 生成全景深度重构蓝图
  const generatePanoramicBlueprint = useCallback(async () => {
    if (blueprintIsGenerating || !note.model_id) return;

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
        modelId: note.model_id,
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
  }, [note.id, note.model_id, blueprintIsGenerating, setupBlueprintListener]);

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
    const effectiveModelId = currentModelId || note.model_id;
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
  }, [subtitleOptimizing, subtitleOptimizationEnabled, optimizedSubtitles, detailedReadingData, note.model_id, note.subtitle_path, note.id, subtitleEntries, setupSubtitleOptimizationListener, currentModelId]);

  // 高光笔记重新生成处理
  const handleHighlightRegenerate = useCallback(async () => {
    // 显示确认对话框
    setConfirmDialogConfig({
      title: "确认重新生成",
      message: "重新生成将覆盖当前的高光笔记，此操作不可撤销。是否继续？",
      onConfirm: async () => {
        setShowConfirmDialog(false);

        if (!note.subtitle_path || !note.model_id) {
          message.warning("缺少字幕文件或 AI 模型配置");
          return;
        }

        setHighlightIsGenerating(true);
        setHighlightGenerating(note.id, true);
        try {
          const generationId = await invoke<string>("generate_highlights", {
            noteId: note.id,
            modelId: currentModelId || note.model_id,
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
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, detailedReadingData?.total_duration, onGenerationComplete, highlightIsGenerating]);

  // 单章节重新优化字幕
  const handleReoptimizeChapter = useCallback(async (chapterId: string) => {
    // 检查是否有正在进行的优化
    if (optimizingChapterIds.has(chapterId)) {
      return;
    }

    // 获取当前选择的模型
    const effectiveModelId = currentModelId || note.model_id;
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
          // 标记待保存视觉化总结
          pendingVisualSummarySaveRef.current = true;
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
  }, [detailedReadingData, currentModelId, note.model_id, note.id, note.subtitle_path, subtitleEntries, optimizingChapterIds]);

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
    const effectiveModelId = currentModelId || note.model_id || aiConfigs.find(c => c.is_default)?.id || aiConfigs[0]?.id;
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
  }, [note.id, note.model_id, currentModelId, aiConfigs, setupGenerationListener, generateDynamicPrompt]);

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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border overflow-hidden">
      {/* 标签页头部 */}
      <div className="border-b border-slate-200 dark:border-vnote-border select-none">
        <div className="flex items-center">
          {/* 当前分组的标签 */}
          <ResponsiveTabs
            items={TAB_GROUPS.find(g => g.id === activeGroup)?.tabs || []}
            activeTabId={activeTab}
            onTabClick={(id) => setActiveTab(id as TabId)}
            renderTab={(tab, isDropdown) => {
              const generating = isTabGenerating(tab.id as TabId);
              const error = getTabError(tab.id as TabId);
              const isActive = activeTab === tab.id;

              if (isDropdown) {
                return (
                  <div className={cn(
                    "flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer w-full select-none",
                    isActive ? "text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/10" : "text-slate-700 dark:text-slate-300"
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
                    "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors relative cursor-pointer whitespace-nowrap",
                    isActive
                      ? "border-blue-500 text-blue-500"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {generating && (
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                  )}
                  {error && !generating && (
                    <X className="w-3 h-3 text-red-500" />
                  )}
                </button>
              );
            }}
          />

          {/* 分组切换器 */}
          <div className="flex items-center gap-0.5 p-1 mr-2 bg-slate-100 dark:bg-vnote-surface rounded-lg">
            {TAB_GROUPS.map((group) => (
              <button
                key={group.id}
                onClick={() => handleGroupChange(group.id)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer",
                  activeGroup === group.id
                    ? "bg-white dark:bg-vnote-card text-blue-600 dark:text-blue-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                {group.icon}
                {group.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 次级工具栏 - 根据标签页显示不同内容 */}
      {activeTab === "summary" ? (
        // 全文总结标签页的工具栏
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                isEditMode
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
              )}
            >
              <Edit3 className="w-4 h-4" />
              {isEditMode ? "预览" : "编辑"}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Copy className="w-4 h-4" />
              复制
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              下载
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={openPromptDialog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              重新总结
            </button>
          </div>
        </div>
      ) : activeTab === "original" ? (
        // 原文细读标签页的工具栏（不管有无章节数据都显示相同）
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-3">
            {/* 辅助模式提示 - 仅在辅助模式下显示 */}
            {isAssistModeActive && (
              <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>点击"添加截图"按钮在字幕行上方添加章节分隔点</span>
                <span className="text-xs text-blue-500 dark:text-blue-500 ml-2">已添加 {assistModeMarkers.length} 个截图标记</span>
              </div>
            )}
            {/* 章节下拉框 - 辅助模式下隐藏 */}
            {!isAssistModeActive && (
              <div className="relative" ref={chapterDropdownRef}>
                <button
                  onClick={() => setShowChapterDropdown(!showChapterDropdown)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                >
                  <List className="w-4 h-4" />
                  共 {detailedReadingData?.chapters.length || 0} 个章节
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showChapterDropdown ? "rotate-180" : ""}`} />
                </button>
                {showChapterDropdown && detailedReadingData && (
                  <div className="absolute top-full left-0 mt-1 w-96 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50 max-h-80 overflow-auto">
                    {/* 下拉框头部 */}
                    <div className="sticky top-0 bg-white dark:bg-slate-800 px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                      <List className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">章节目录</span>
                    </div>
                    {/* 章节列表 */}
                    <div className="py-1">
                      {detailedReadingData.chapters.map((chapter, index) => {
                        const isCurrentChapter = chapter.id === getCurrentChapter(currentTime)?.id;
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
                            onClick={() => {
                              // 记录用户点击时间，防止视频时间更新干扰
                              userClickTimeRef.current = Date.now();
                              // 跳转到视频时间
                              window.dispatchEvent(new CustomEvent("seek-video", { detail: { time: chapter.start_time } }));
                              // 滚动到对应章节卡片
                              const chapterElement = document.getElementById(`chapter-${chapter.id}`);
                              if (chapterElement) {
                                chapterElement.scrollIntoView({ behavior: "smooth", block: "center" });
                              }
                              setShowChapterDropdown(false);
                            }}
                            className={cn(
                              "w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer text-left",
                              isCurrentChapter
                                ? "bg-blue-50 dark:bg-blue-900/20"
                                : "hover:bg-slate-100 dark:hover:bg-slate-700"
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
            )}
            {/* 字幕模式切换下拉框 - 辅助模式下隐藏 */}
            {!isAssistModeActive && note.subtitle_path && showChapterSubtitles && detailedReadingData && (
              <div className="relative" ref={subtitleModeDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowSubtitleModeDropdown(!showSubtitleModeDropdown)}
                  disabled={subtitleOptimizing}
                  className={cn(
                    "px-3 py-1.5 pr-8 text-sm rounded-xl border transition-all cursor-pointer relative",
                    subtitleOptimizationEnabled
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                    subtitleOptimizing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {subtitleOptimizationEnabled ? "智能优化" : "原文"}
                  <ChevronDown className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 transition-transform pointer-events-none",
                    subtitleOptimizationEnabled ? "text-blue-400" : "text-slate-400",
                    showSubtitleModeDropdown && "rotate-180"
                  )} />
                </button>
                {showSubtitleModeDropdown && !subtitleOptimizing && (
                  <div className="absolute z-50 mt-2 w-28 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1">
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
            {/* 字幕滚动开关 - 辅助模式下隐藏 */}
            {!isAssistModeActive && (
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                  autoScroll
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                )}
              >
                <Clock className="w-4 h-4" />
                字幕滚动
              </button>
            )}
            {/* 显示字幕开关 - 辅助模式下隐藏 */}
            {!isAssistModeActive && note.subtitle_path && (
              <button
                onClick={() => setShowChapterSubtitles(!showChapterSubtitles)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                  showChapterSubtitles
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                )}
              >
                <SubtitlesIcon className="w-4 h-4" />
                {showChapterSubtitles ? "隐藏字幕" : "显示字幕"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 辅助模式切换按钮 */}
            <button
              onClick={() => setIsAssistModeActive(!isAssistModeActive)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                isAssistModeActive
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
              )}
            >
              <MousePointer2 className="w-4 h-4" />
              辅助模式
            </button>
            {/* 重新生成按钮 */}
            <button
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
                      // 标记待保存视觉化总结
                      pendingVisualSummarySaveRef.current = true;
                      // 重新生成章节（统一走详细阅读链路）
                      setChapterIsGenerating(true);
                      setChapterGenerating(note.id, true);
                      const generationId = crypto.randomUUID();
                      registerActiveGenerationId(note.id, generationId);
                      try {
                        await invoke("generate_note_content", {
                          generationId,
                          noteId: note.id,
                          modelId: currentModelId || note.model_id,
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
              disabled={assistModeGenerating}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover",
                assistModeGenerating && "opacity-50 cursor-not-allowed"
              )}
            >
              {assistModeGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  生成中...
                  {assistModeProgress && (
                    <span className="text-xs ml-1">
                      ({assistModeProgress.current}/{assistModeProgress.total})
                    </span>
                  )}
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
      ) : activeTab === "script" ? (
        // 字幕脚本标签页的专用工具栏
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-3">
            {/* 字幕滚动开关 */}
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                autoScroll
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
              )}
            >
              <Clock className="w-4 h-4" />
              字幕滚动
            </button>
          </div>
          {/* 右侧留空，不显示复制和下载按钮 */}
          <div />
        </div>
      ) : activeTab === "highlights" ? (
        // 高光笔记标签页的专用工具栏
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div />
          {/* 重新生成按钮 */}
          <button
            onClick={handleHighlightRegenerate}
            disabled={highlightIsGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
      ) : activeTab === "visual" ? (
        // 视觉化总结标签页的专用工具栏
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface select-none">
          <div className="flex items-center gap-1">
            {!isVisualEditMode && visualChapterItems.length > 0 && (
              <>
                <div className="relative" ref={visualChapterDropdownRef}>
                  <button
                    onClick={() => setShowVisualChapterDropdown(!showVisualChapterDropdown)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                  >
                    <List className="w-4 h-4" />
                    {`共 ${visualChapterItems.length} 个章节`}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showVisualChapterDropdown ? "rotate-180" : ""}`} />
                  </button>
                  {showVisualChapterDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-96 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50 max-h-80 overflow-auto">
                      <div className="sticky top-0 bg-white dark:bg-slate-800 px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
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
                                  ? "bg-blue-50 dark:bg-blue-900/20"
                                  : "hover:bg-slate-100 dark:hover:bg-slate-700"
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
                <button
                  onClick={() => setShowVisualTimestamp(!showVisualTimestamp)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                    showVisualTimestamp
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                  )}
                >
                  <Clock className="w-4 h-4" />
                  时间戳
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleVisualEditToggle}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                isVisualEditMode
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
              )}
            >
              <Edit3 className="w-4 h-4" />
              {isVisualEditMode ? "预览" : "编辑"}
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={handleVisualCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Copy className="w-4 h-4" />
              复制
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={handleVisualDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              下载
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={handleVisualExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Package className="w-4 h-4" />
              导出
            </button>
          </div>
        </div>
      ) : activeTab === "custom" && note.custom_summary ? (
        // 自定义总结标签页的工具栏（有内容时显示完整工具栏）
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                isEditMode
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
              )}
            >
              <Edit3 className="w-4 h-4" />
              {isEditMode ? "预览" : "编辑"}
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer">
              思维导图
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Copy className="w-4 h-4" />
              复制
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              下载
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={openCustomPromptDialog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              重新总结
            </button>
          </div>
        </div>
      ) : activeTab === "custom" && !note.custom_summary ? (
        // 自定义总结标签页的工具栏（无内容时不显示工具栏）
        null
      ) : activeTab === "flashcard" ? (
        // 闪记卡标签页的专用工具栏
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div />
          <div className="flex items-center gap-1">
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('flashcard-download-csv', { detail: { noteId: note.id } }));
              }}
              disabled={!note.flashcards}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              下载CSV
            </button>
          </div>
        </div>
      ) : activeTab === "panoramic_blueprint" && note.panoramic_blueprint ? (
        // 深度蓝图标签页的工具栏（有内容时显示）
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-2">
            {/* 进度提示 */}
            {blueprintIsGenerating && blueprintProgress ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                <span className="text-sm text-blue-800 dark:text-blue-300">
                  正在生成深度蓝图... ({blueprintProgress.current}/{blueprintProgress.total})
                </span>
              </div>
            ) : (
              <button
                onClick={() => setBlueprintEditMode(!blueprintEditMode)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                  blueprintEditMode
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                )}
              >
                <Edit3 className="w-4 h-4" />
                {blueprintEditMode ? "预览" : "编辑"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={async () => {
                if (note.panoramic_blueprint) {
                  await navigator.clipboard.writeText(note.panoramic_blueprint);
                  message.success('已复制到剪贴板');
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Copy className="w-4 h-4" /> 复制
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" /> 下载
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={cn("w-4 h-4", blueprintIsGenerating && "animate-spin")} />
              重新生成
            </button>
          </div>
        </div>
      ) : activeTab === "ai_note" || activeTab === "quicknotes" || activeTab === "mindmap" || activeTab === "canvas" || activeTab === "panoramic_blueprint" ? (
        // AI 笔记、随手笔记、思维导图、无限画布、深度蓝图标签页不需要额外的次级工具栏
        null
      ) : (
        // 其他标签页的简化工具栏
        <div className="flex items-center justify-end px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Copy className="w-4 h-4" />
              复制
            </button>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              下载
            </button>
          </div>
        </div>
      )}

      {/* 内容区域 */}
      <div
        className={cn(
          "flex-1 min-h-0", // min-h-0 确保 flex 子元素可以正确收缩，让虚拟列表获得正确高度
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
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                </div>
                <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">暂无全文总结</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-md">
                  AI 可以根据视频字幕自动生成结构化的全文总结，包含摘要、核心亮点和关键术语。
                </p>
                <button
                  onClick={handleGenerateFullSummaryWithDefaults}
                  disabled={!note.subtitle_path || aiConfigs.length === 0}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all mx-auto",
                    "bg-blue-500 hover:bg-blue-600 text-white",
                    "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  )}
                >
                  <Sparkles className="w-4 h-4" />
                  生成全文总结
                </button>
                {(!note.subtitle_path || aiConfigs.length === 0) && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                    {!note.subtitle_path ? "请先上传字幕文件" : "请先配置 AI 模型"}
                  </p>
                )}
              </div>
            </div>
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
                currentTime={currentTime}
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
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-500">暂无原文细读数据，请点击右上角"重新生成"按钮生成</p>
            </div>
          );
        })()}
        {activeTab === "highlights" && (
          <HighlightGrid
            ref={highlightGridRef}
            noteId={note.id}
            subtitlePath={note.subtitle_path}
            modelId={currentModelId || note.model_id}
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
            showTimestamp={showVisualTimestamp}
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
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-2">自定义总结</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs">
                  根据您的需求定制总结内容，输入自定义提示词生成个性化笔记
                </p>
                <button
                  onClick={openCustomPromptDialog}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  开始生成
                </button>
              </div>
            </div>
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
            modelId={currentModelId || note.model_id}
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
            // 空状态：显示生成按钮
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center">
                  <MapIcon className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
                  生成全景深度重构蓝图
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 max-w-md">
                  使用AI深度分析视频内容，生成5倍字数扩展的结构化知识文档
                </p>
                {note.model_id ? (
                  <button
                    onClick={generatePanoramicBlueprint}
                    disabled={blueprintIsGenerating || !note.subtitle_path}
                    className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {blueprintIsGenerating ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        生成中...
                      </span>
                    ) : (
                      '开始生成'
                    )}
                  </button>
                ) : (
                  <p className="text-sm text-red-500 dark:text-red-400">
                    请先在视频播放器右上角选择AI模型
                  </p>
                )}
                {!note.subtitle_path && note.model_id && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                    请先上传字幕文件
                  </p>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* 自定义总结弹窗 */}
      {showPromptDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPromptDialog(false)}>
          <div className="bg-white dark:bg-vnote-card rounded-2xl shadow-2xl w-[600px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            {/* 标题和关闭按钮 */}
            <div className="flex items-center justify-between px-8 pt-6 pb-4">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-500" />
                重新生成总结
              </h3>
              <button
                onClick={() => setShowPromptDialog(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* 标签切换 */}
            <div className="px-8">
              <div className="flex gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <button
                  onClick={() => setDialogTab("default")}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                    dialogTab === "default"
                      ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  默认配置
                </button>
                <button
                  onClick={() => setDialogTab("custom")}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                    dialogTab === "custom"
                      ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  自定义总结
                </button>
              </div>
            </div>

            {/* 默认配置标签页内容 */}
            {dialogTab === "default" && (
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
                        className="w-44 px-3 py-2 pr-10 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all truncate"
                      >
                        {aiConfigs.find(c => c.id === selectedModelId)?.title || "选择模型"}
                      </button>
                      <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showModelDropdown ? "rotate-180" : ""}`} />
                      {showModelDropdown && (
                        <div className="absolute z-50 mt-2 w-56 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 max-h-60 overflow-auto">
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
                        className="w-32 px-3 py-2 pr-10 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all"
                      >
                        {configLanguage === "zh" ? "中文" : "English"}
                      </button>
                      <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showLanguageDropdown ? "rotate-180" : ""}`} />
                      {showLanguageDropdown && (
                        <div className="absolute z-50 mt-2 w-32 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1">
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
            {dialogTab === "custom" && (
              <div className="px-8 py-6">
                {/* 大语言模型 */}
                <div className="flex items-center justify-between mb-5">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">大语言模型</span>
                  <div className="relative" ref={modelDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowModelDropdown(!showModelDropdown)}
                      className="w-48 px-3 py-2 pr-10 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all truncate"
                    >
                      {aiConfigs.find(c => c.id === selectedModelId)?.title || "选择模型"}
                    </button>
                    <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showModelDropdown ? "rotate-180" : ""}`} />
                    {showModelDropdown && (
                      <div className="absolute z-50 mt-2 w-56 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 max-h-60 overflow-auto">
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
                          className="px-3 py-1.5 pr-8 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-300 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all"
                        >
                          选择已配置的提示词
                        </button>
                        <ChevronDown className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${showPromptDropdown ? "rotate-180" : ""}`} />
                        {showPromptDropdown && (
                          <div className="absolute z-50 mt-2 w-64 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 max-h-60 overflow-auto">
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
                                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{prompt.description}</div>
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
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
                disabled={dialogTab === "custom" && !customPrompt}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                开始生成
              </button>
            </div>
          </div>
        </div>
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

    const handleVideoTimeUpdate = (e: Event) => {
      const event = e as CustomEvent<{ time: number }>;
      const currentTime = event.detail.time;
      const index = findCurrentEntryIndexBinary(subtitleEntries, currentTime);

      if (index !== currentEntryIndex) {
        setCurrentEntryIndex(index);
      }
    };

    window.addEventListener("video-time-update", handleVideoTimeUpdate);
    return () => window.removeEventListener("video-time-update", handleVideoTimeUpdate);
  }, [autoScroll, subtitleEntries, currentEntryIndex]);

  // 当 autoScroll 关闭时，清除高亮
  useEffect(() => {
    if (!autoScroll) {
      setCurrentEntryIndex(null);
    }
  }, [autoScroll]);

  if (!subtitlePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <Captions className="w-12 h-12 mb-4 opacity-50" />
        <p>未上传字幕文件</p>
        <p className="text-sm mt-2">上传视频时可选择添加字幕文件</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <p>加载字幕中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (subtitleEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <Captions className="w-12 h-12 mb-4 opacity-50" />
        <p>字幕文件为空</p>
      </div>
    );
  }

  return (
    <VirtualizedSubtitleList
      entries={subtitleEntries}
      currentEntryIndex={autoScroll ? currentEntryIndex : null}
    />
  );
}
