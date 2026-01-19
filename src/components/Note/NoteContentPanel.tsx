import { useState, useEffect, useCallback, useRef } from "react";
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
  CheckCircle2,
  X,
  ChevronDown,
  Check,
  List,
  Clock,
  Subtitles as SubtitlesIcon,
  Wand2,
  Loader2,
  MousePointer2,
  Package,
  GitBranch,
  Zap,
  StickyNote,
  GraduationCap,
  Network,
  Palette,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "../../utils/cn";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Note, GenerationEvent, TabType, AiConfig, PromptConfig, ChapterData, SubtitleOptimizationEvent, SingleChapterOptimizationEvent, SubtitleEntry, OptimizedSubtitle, NoteUiState, SubtitleOptimizationTaskState, HighlightData, ScreenshotMarker, FlashcardData, FlashcardGenerationEvent } from "../../types";
import { EditableMarkdown } from "./EditableMarkdown";
import { ChapterGrid, type ChapterGridRef } from "./ChapterGrid";
import { SubtitleRow } from "./SubtitleRow";
import { HighlightGrid, type HighlightGridRef } from "./Highlight";
import { VisualSummaryContent, type VisualViewMode } from "./VisualSummaryContent";
import { FlashcardContent } from "./FlashcardContent";
import { QuickNotesContainer } from "./QuickNotesContainer";
import type { MindMapViewRef } from "./MindMap";
import { AssistModeView } from "./AssistModeView";
import { message } from "../../utils/message";
import { assembleChapterMarkdown } from "../../utils/markdownAssembler";
import { useInitTaskQueue } from "../../context/InitTaskQueueContext";
import {
  getNoteGenerationState,
  setNoteGenerationState,
  attemptedAutoGenerateNoteIds,
  activeListeners,
  setChapterGenerating,
  setInitialAutoGeneration,
  isInitialAutoGeneration,
} from "../../utils/noteGenerationState";
import type { ChapterGenerationEvent } from "../../types";

type TabId = "summary" | "original" | "highlights" | "script" | "visual" | "custom" | "flashcard" | "quicknotes" | "mindmap" | "canvas";
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
      { id: "quicknotes", label: "随手笔记", icon: <StickyNote className="w-4 h-4" /> },
      { id: "mindmap", label: "思维导图", icon: <Network className="w-4 h-4" /> },
      { id: "canvas", label: "无限画布", icon: <Palette className="w-4 h-4" /> },
      { id: "flashcard", label: "闪记卡", icon: <Zap className="w-4 h-4" /> },
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
  currentModelId?: number | null; // 视频播放器右上角选择的模型ID
  promptConfigs?: PromptConfig[]; // 提示词配置列表
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
  // 任务队列 hook
  const { submitTask, completeTask, isNoteInQueue, getNoteQueuePosition, isNoteWaiting, onTaskReady } = useInitTaskQueue();

  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [activeGroup, setActiveGroup] = useState<TabGroupId>("summary");

  // ChapterGrid 组件的 ref
  const chapterGridRef = useRef<ChapterGridRef>(null);

  // HighlightGrid 组件的 ref
  const highlightGridRef = useRef<HighlightGridRef>(null);

  // MindMapView 组件的 ref
  const mindMapRef = useRef<MindMapViewRef>(null);

  // 章节相关状态
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);

  // 章节下拉框状态
  const [showChapterDropdown, setShowChapterDropdown] = useState(false);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);

  // 字幕滚动状态
  const [autoScroll, setAutoScroll] = useState(true);
  // 当前播放的章节ID
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  // 用户点击章节的时间戳（用于忽略视频时间更新）
  const userClickTimeRef = useRef<number>(0);
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
  const [subtitleOptimizationProgress, setSubtitleOptimizationProgress] = useState<{ current: number; total: number } | null>(null);
  const [optimizedSubtitles, setOptimizedSubtitles] = useState<Map<string, string>>(new Map());
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

  // 解析 detailed_reading 是否为章节数据
  useEffect(() => {
    if (note.detailed_reading) {
      // 尝试解析为 JSON
      if (typeof note.detailed_reading === "string") {
        try {
          const parsed = JSON.parse(note.detailed_reading);
          // 检查是否是 ChapterData 格式
          if (parsed && parsed.chapters && Array.isArray(parsed.chapters)) {
            setChapterData(parsed);
          } else {
            setChapterData(null);
          }
        } catch (e) {
          // 不是 JSON，保持为普通文本模式
          setChapterData(null);
        }
      } else if (typeof note.detailed_reading === "object" && note.detailed_reading.chapters) {
        // 已经是 ChapterData 对象
        setChapterData(note.detailed_reading);
      } else {
        setChapterData(null);
      }
    } else {
      setChapterData(null);
    }
  }, [note.detailed_reading]);

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
    const loadSavedState = async () => {
      try {
        // 加载 UI 状态
        const uiState = await invoke<NoteUiState | null>("get_note_ui_state", { noteId: note.id });
        if (uiState) {
          setShowChapterSubtitles(uiState.show_subtitles);
          setSubtitleOptimizationEnabled(uiState.subtitle_optimization_enabled);
        } else {
          setShowChapterSubtitles(false);
          setSubtitleOptimizationEnabled(false);
        }

        // 加载优化后的字幕缓存
        const savedSubtitles = await invoke<OptimizedSubtitle[]>("get_optimized_subtitles", { noteId: note.id });
        if (savedSubtitles && savedSubtitles.length > 0) {
          const subtitleMap = new Map<string, string>();
          savedSubtitles.forEach(s => subtitleMap.set(s.chapter_id, s.optimized_text));
          setOptimizedSubtitles(subtitleMap);
        } else {
          setOptimizedSubtitles(new Map());
        }

        // 检查是否有进行中的字幕优化任务
        const taskState = await invoke<SubtitleOptimizationTaskState | null>("get_subtitle_optimization_task_state", { noteId: note.id });
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
        } else {
          // 没有进行中的任务，重置临时状态
          setSubtitleOptimizing(false);
          setSubtitleOptimizationProgress(null);
          setOptimizingChapterIds(new Set());
          setFailedChapterIds(new Set());
          subtitleOptimizationIdRef.current = null;
        }
      } catch (error) {
        console.error("[NoteContentPanel] 加载保存的状态失败:", error);
        setShowChapterSubtitles(false);
        setSubtitleOptimizationEnabled(false);
        setOptimizedSubtitles(new Map());
        setSubtitleOptimizing(false);
        setSubtitleOptimizationProgress(null);
        setOptimizingChapterIds(new Set());
        setFailedChapterIds(new Set());
        subtitleOptimizationIdRef.current = null;
      }
    };

    loadSavedState();

    // 清理函数
    return () => {
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
  const [visualViewMode, setVisualViewMode] = useState<VisualViewMode>("markdown");
  const [showMindMapExportMenu, setShowMindMapExportMenu] = useState(false);
  const mindMapExportMenuRef = useRef<HTMLDivElement>(null);

  // 从全局状态同步组件state
  const syncStateFromGlobal = useCallback(() => {
    const globalState = getNoteGenerationState(note.id);
    return globalState;
  }, [note.id]);

  // 生成状态（从全局状态同步）
  const [isGenerating, setIsGenerating] = useState(() => syncStateFromGlobal().isGenerating);
  const [, setRegeneratingTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().regeneratingTabs) as Set<TabType>);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string }>(() => ({ ...syncStateFromGlobal().progress }));
  const [completedTabs, setCompletedTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().completedTabs) as Set<TabType>);
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

    // 触发重新渲染以更新UI
    forceUpdate({});

    // 如果该笔记正在生成中，确保事件监听器已设置
    if (globalState.generationId && globalState.isGenerating) {
      setupGenerationListener(note.id, globalState.generationId);
    }
  }, [note.id]);

  // 监听标签页切换，如果切换到原文细读且未生成，则触发生成
  useEffect(() => {
    // 只在切换到原文细读标签页时检查
    if (activeTab !== "original") return;

    // 检查全文总结是否已完成，原文细读是否未生成
    const globalState = getNoteGenerationState(note.id);
    const hasFullSummary = note.full_summary || globalState.completedTabs.has("full_summary") || globalState.completedTabs.has("FullSummary");
    const hasNoDetailedReading = !note.detailed_reading;

    // 如果当前正在生成中（包括自动初始化流程或章节生成），不再触发
    if (globalState.isGenerating || globalState.isGeneratingChapters || chapterIsGenerating) {
      return;
    }

    if (hasFullSummary && hasNoDetailedReading && chapterGridRef.current) {
      // 延迟一点确保 ChapterGrid 完全渲染
      setTimeout(() => {
        if (chapterGridRef.current) {
          chapterGridRef.current.generateChapters();
        }
      }, 300);
    }
  }, [activeTab, note.id, chapterIsGenerating]);

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
  }, [note.custom_summary, note.detailed_reading, note.highlights, note.visual_summary, note.full_summary]);

  // 设置生成事件监听器
  const setupGenerationListener = useCallback((noteId: number, genId: string) => {
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
          console.log(`[TabStarted] 收到事件: tab_type=${data.tab_type}, tab_name=${data.tab_name}`);
          const startedTab = convertTabType(data.tab_type);
          console.log(`[TabStarted] 转换后的标签: ${startedTab}`);
          const newRegeneratingOnStart = new Set([...state.regeneratingTabs, startedTab]);
          console.log(`[TabStarted] 当前正在生成的标签:`, Array.from(newRegeneratingOnStart));
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
          console.log(`[TabCompleted] 收到事件: tab_type=${data.tab_type}, content长度=${data.content?.length || 0}`);
          const completedTab = convertTabType(data.tab_type);
          console.log(`[TabCompleted] 转换后的标签: ${completedTab}`);
          const newCompleted = new Set([...state.completedTabs, completedTab]);
          const newRegenerating = new Set([...state.regeneratingTabs].filter(t => t !== completedTab));
          setNoteGenerationState(noteId, {
            completedTabs: newCompleted,
            regeneratingTabs: newRegenerating,
          });

          // 刷新笔记数据以显示新生成的内容
          console.log(`[TabCompleted] 准备刷新笔记数据`);
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

          // 延迟刷新笔记数据，避免与事件处理冲突
          setTimeout(() => {
            onGenerationComplete?.();
            // 如果是自动生成流程，继续生成高光笔记
            if (isInitialAutoGeneration(noteId)) {
              setTimeout(() => {
                generateHighlightsDirectlyRef.current?.();
              }, 500);
            }
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

  // 自定义总结专用弹窗状态（只显示自定义标签页）
  const [showCustomOnlyDialog, setShowCustomOnlyDialog] = useState(false);

  // 获取默认 AI 配置或使用笔记的 model_id
  const getDefaultModelId = useCallback(() => {
    // 优先使用笔记保存的 model_id
    if (note.model_id) return note.model_id;

    // 其次使用用户设置的默认模型 (is_default = true)
    const defaultConfig = aiConfigs.find(c => c.is_default);
    if (defaultConfig) return defaultConfig.id;

    // 最后使用第一个可用模型
    if (aiConfigs.length > 0) return aiConfigs[0].id;

    return 0;
  }, [note.model_id, aiConfigs]);

  const [selectedModelId, setSelectedModelId] = useState<number>(getDefaultModelId());

  // 自定义下拉框状态
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const promptDropdownRef = useRef<HTMLDivElement>(null);

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
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 监听视频播放时间变化，更新当前章节（不管是否开启字幕滚动）
  useEffect(() => {
    if (activeTab !== "original" || !chapterData) return;

    const handleVideoTimeUpdate = (e: Event) => {
      // 如果用户刚刚点击过章节（500ms内），忽略视频时间更新
      if (Date.now() - userClickTimeRef.current < 500) {
        return;
      }

      const event = e as CustomEvent<{ time: number }>;
      const currentTime = event.detail.time;

      // 找到当前时间对应的章节
      const currentChapter = chapterData.chapters.find(
        (chapter) => currentTime >= chapter.start_time && currentTime <= chapter.end_time
      );

      if (currentChapter) {
        setCurrentChapterId(currentChapter.id);
      } else {
        setCurrentChapterId(null);
      }
    };

    window.addEventListener("video-time-update", handleVideoTimeUpdate);
    return () => window.removeEventListener("video-time-update", handleVideoTimeUpdate);
  }, [activeTab, chapterData]);

  // 字幕滚动自动跳转卡片
  useEffect(() => {
    if (!autoScroll || activeTab !== "original" || !chapterData) return;

    const handleVideoTimeUpdate = (e: Event) => {
      const event = e as CustomEvent<{ time: number }>;
      const currentTime = event.detail.time;

      // 找到当前时间对应的章节
      const currentChapter = chapterData.chapters.find(
        (chapter) => currentTime >= chapter.start_time && currentTime <= chapter.end_time
      );

      if (currentChapter) {
        // 滚动到对应的章节卡片
        const chapterElement = document.getElementById(`chapter-${currentChapter.id}`);
        if (chapterElement) {
          chapterElement.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    };

    window.addEventListener("video-time-update", handleVideoTimeUpdate);
    return () => window.removeEventListener("video-time-update", handleVideoTimeUpdate);
  }, [autoScroll, activeTab, chapterData]);

  // 开始生成笔记（一键生成全文总结，使用默认配置）
  // skipCheck: 跳过重复生成检查（用于自动初始化流程，因为状态已经预先设置）
  const handleGenerate = async (skipCheck = false) => {
    if (!note.model_id) {
      message.warning("请先选择AI模型");
      return;
    }

    // 检查是否已经在生成中（除非明确跳过检查）
    if (!skipCheck) {
      const currentState = getNoteGenerationState(note.id);
      if (currentState.isGenerating) {
        return;
      }
    }

    try {
      const id = crypto.randomUUID();

      // 更新全局状态（初始不标记任何标签为正在生成，等待后端 TabStarted 事件）
      setNoteGenerationState(note.id, {
        isGenerating: true,
        generationId: id,
        regeneratingTabs: new Set(),
        progress: { current: 0, total: 4, message: "准备生成..." },
        completedTabs: new Set(),
        failedTabs: new Map(),
      });

      // 更新组件state
      setIsGenerating(true);
      setGenerationId(id);
      setCompletedTabs(new Set());
      setFailedTabs(new Map());
      setRegeneratingTabs(new Set());
      setProgress({ current: 0, total: 4, message: "准备生成..." });

      // 设置事件监听器
      setupGenerationListener(note.id, id);

      // 等待状态更新和事件监听器设置完成
      await new Promise(resolve => setTimeout(resolve, 100));

      // 调用后端生成接口（串行生成4个标签页）
      await invoke("generate_note_content", {
        generationId: id,
        noteId: note.id,
        modelId: note.model_id,
        concurrent: false,
        regenerate: true,
        tabsToGenerate: ["full_summary", "detailed_reading"],
        concurrentLimit: 1,
        customPrompt: null,
      });
    } catch (error) {
      console.error(`[handleGenerate] 生成失败:`, error);
      // 出错时重置状态
      setNoteGenerationState(note.id, {
        isGenerating: false,
        generationId: null,
        regeneratingTabs: new Set(),
      });
      setIsGenerating(false);
      setGenerationId(null);
      setRegeneratingTabs(new Set());
      message.error(`生成失败: ${error}`);
    }
  };

  // 自动生成：当组件挂载且没有全文总结时，提交到任务队列（仅触发一次）
  // 同步执行顺序：1. 全文总结 -> 2. 原文细读（在 AllCompleted 事件中触发）
  useEffect(() => {
    // 如果已经尝试过自动生成，跳过
    if (attemptedAutoGenerateNoteIds.has(note.id)) {
      return;
    }

    // 如果正在生成中，跳过
    const currentState = getNoteGenerationState(note.id);
    if (currentState.isGenerating) {
      return;
    }

    const hasNoContent = !note.full_summary && !note.detailed_reading &&
                         !note.highlights && !note.visual_summary && !note.custom_summary;

    if (hasNoContent && note.model_id) {
      // 标记已尝试自动生成
      attemptedAutoGenerateNoteIds.add(note.id);
      // 标记为首次自动生成流程
      setInitialAutoGeneration(note.id, true);

      // 立即设置生成状态，让UI显示加载动画（不等待后端响应）
      setNoteGenerationState(note.id, {
        isGenerating: true,
        generationId: null,
        regeneratingTabs: new Set(["full_summary"]),
        progress: { current: 0, total: 3, message: "准备生成..." },
        completedTabs: new Set(),
        failedTabs: new Map(),
      });
      setIsGenerating(true);
      setRegeneratingTabs(new Set(["full_summary"] as TabType[]));
      setProgress({ current: 0, total: 3, message: "准备生成..." });

      // 提交到任务队列
      submitTask(note.id).then((result) => {
        if (result.status === "Running") {
          // 立即执行（跳过重复检查，因为状态已预先设置）
          handleGenerate(true);
        } else {
          // 排队等待，不执行
          console.log(`[NoteContentPanel] 笔记 ${note.id} 在队列中等待，位置: ${result.position}`);
        }
      }).catch((error) => {
        console.error("[NoteContentPanel] 提交任务失败:", error);
        // 失败时重置状态
        setNoteGenerationState(note.id, {
          isGenerating: false,
          generationId: null,
          regeneratingTabs: new Set(),
        });
        setIsGenerating(false);
        setRegeneratingTabs(new Set());
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.full_summary, note.model_id]);

  // 监听任务就绪事件
  useEffect(() => {
    const unregister = onTaskReady((readyNoteId) => {
      if (readyNoteId === note.id) {
        console.log(`[NoteContentPanel] 笔记 ${note.id} 任务就绪，开始生成`);
        // 任务就绪，开始生成（跳过重复检查）
        handleGenerate(true);
      }
    });

    return () => {
      unregister();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, onTaskReady]);

  // 检查标签页是否正在生成
  const isTabGenerating = (tabId: TabId): boolean => {
    const tabType = TAB_TYPE_MAPPING[tabId];
    if (!tabType) return false;

    // 检查全局状态中是否正在生成该标签页
    const globalState = getNoteGenerationState(note.id);
    if (globalState.regeneratingTabs.has(tabType)) return true;

    // 原文细读（detailed_reading）使用组件 state 跟踪章节生成状态
    if (tabType === "detailed_reading" && chapterIsGenerating) return true;

    // 高光笔记使用单独的生成状态
    if (tabType === "highlights" && highlightIsGenerating) return true;

    // 视觉化总结使用字幕优化状态
    if (tabType === "visual_summary" && subtitleOptimizing) return true;

    // 闪记卡使用单独的生成状态
    if (tabType === "flashcards" && flashcardIsGenerating) return true;

    return false;
  };

  // 检查标签页是否已完成生成
  const isTabCompleted = (tabId: TabId): boolean => {
    const tabType = TAB_TYPE_MAPPING[tabId];
    if (!tabType) return false;
    return completedTabs.has(tabType);
  };

  // 检查标签页是否生成失败
  const getTabError = (tabId: TabId): string | undefined => {
    const tabType = TAB_TYPE_MAPPING[tabId];
    if (!tabType) return undefined;
    return failedTabs.get(tabType);
  };

  // 打开自定义提示词弹窗
  const openPromptDialog = () => {
    // 优先使用视频播放器右上角选择的模型，其次是笔记关联的模型，最后是第一个配置
    setSelectedModelId(currentModelId || note.model_id || aiConfigs[0]?.id || 0);
    setDialogTab("default");
    setConfigLanguage("zh");
    setConfigShowEmoji(true);
    setConfigShowTimestamp(false);
    setConfigHighlightCount(5);
    setConfigSentenceLength(30);
    setCustomPrompt("");
    setShowPromptDialog(true);
  };

  // 打开自定义总结专用弹窗（只显示自定义标签页）
  const openCustomPromptDialog = () => {
    setSelectedModelId(currentModelId || note.model_id || aiConfigs[0]?.id || 0);
    setCustomPrompt("");
    setShowCustomOnlyDialog(true);
  };

  // 获取当前标签页的内容
  const getCurrentContent = useCallback((): string | null => {
    const tabType = TAB_TYPE_MAPPING[activeTab];
    if (!tabType) return null;
    const content = note[tabType];
    // 处理 ChapterData 类型
    if (typeof content === "object" && content !== null) {
      return null; // 章节数据不支持复制为纯文本
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

  // 获取视觉化总结的 Markdown 内容
  const getVisualSummaryContent = useCallback((): string => {
    if (!chapterData || chapterData.chapters.length === 0) {
      return "";
    }
    return assembleChapterMarkdown({
      chapters: chapterData.chapters,
      optimizedSubtitles,
      originalSubtitles: subtitleEntries,
      showTimestamp: showVisualTimestamp,
    });
  }, [chapterData, optimizedSubtitles, subtitleEntries, showVisualTimestamp]);

  // 视觉化总结复制
  const handleVisualCopy = async () => {
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryContent();
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
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryContent();
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
    const content = isVisualEditMode ? visualEditContent : getVisualSummaryContent();
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

  // 思维导图导出为不同格式
  const handleMindMapExport = useCallback(async (format: 'png' | 'svg' | 'pdf') => {
    if (mindMapRef.current) {
      const mindMapInstance = mindMapRef.current.getInstance();
      if (!mindMapInstance) {
        message.warning("思维导图未初始化");
        return;
      }
      try {
        // 让用户选择保存位置
        const filePath = await save({
          defaultPath: `${note.title}.${format}`,
          filters: [{
            name: format.toUpperCase(),
            extensions: [format]
          }]
        });

        if (!filePath) {
          // 用户取消了保存
          return;
        }

        // 导出思维导图数据
        const dataUrl = await mindMapInstance.export(format, true, note.title);

        // 将 data URL 转换为 Blob
        const response = await fetch(dataUrl as string);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // 写入文件
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        await writeFile(filePath, uint8Array);

        message.success(`导出${format.toUpperCase()}成功`);
        setShowMindMapExportMenu(false);
      } catch (error) {
        console.error("Export failed:", error);
        message.error(`导出${format.toUpperCase()}失败: ${error}`);
      }
    } else {
      message.warning("思维导图未初始化");
    }
  }, [note.title]);

  // 点击外部关闭思维导图导出菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mindMapExportMenuRef.current && !mindMapExportMenuRef.current.contains(e.target as Node)) {
        setShowMindMapExportMenu(false);
      }
    };
    if (showMindMapExportMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMindMapExportMenu]);

  // 进入视觉化总结编辑模式时初始化内容
  const handleVisualEditToggle = () => {
    if (!isVisualEditMode) {
      // 进入编辑模式，初始化内容
      setVisualEditContent(getVisualSummaryContent());
    }
    setIsVisualEditMode(!isVisualEditMode);
  };

  // 直接调用后端 API 生成章节（用于自动生成流程，不需要切换标签页）
  const generateChaptersDirectly = useCallback(async () => {
    const effectiveModelId = currentModelId || note.model_id;
    if (!effectiveModelId || !note.subtitle_path) {
      console.error("[generateChaptersDirectly] 缺少必要参数");
      return;
    }

    try {
      setChapterGenerating(note.id, true);
      const generationId = crypto.randomUUID();

      // 设置事件监听
      const unlisten = await listen<ChapterGenerationEvent>(
        `chapter-generation-${generationId}`,
        (event) => {
          const data = event.payload;
          switch (data.status) {
            case "Completed":
              // 保存到数据库
              invoke("save_chapters_to_note", {
                noteId: note.id,
                chapterData: data.chapter_data,
              }).then(() => {
                setChapterGenerating(note.id, false);
                onGenerationComplete?.();
                // 如果是自动生成流程，继续生成高光笔记
                if (isInitialAutoGeneration(note.id)) {
                  generateHighlightsDirectlyRef.current?.();
                }
              });
              unlisten();
              break;
            case "Error":
            case "Aborted":
              setChapterGenerating(note.id, false);
              unlisten();
              break;
          }
        }
      );

      // 开始生成
      await invoke("generate_chapters", {
        generationId,
        noteId: note.id,
        modelId: effectiveModelId,
        videoPath: note.video_path,
        subtitlePath: note.subtitle_path,
        captureScreenshots: true,
      });
    } catch (error) {
      console.error("[generateChaptersDirectly] 生成失败:", error);
      setChapterGenerating(note.id, false);
    }
  }, [note.id, note.video_path, note.subtitle_path, note.model_id, currentModelId, onGenerationComplete]);

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

    try {
      setAssistModeGenerating(true);
      setAssistModeProgress({ current: 0, total: markers.length, message: "准备生成章节..." });
      const generationId = crypto.randomUUID();

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
              unlisten();
              break;
            case "Aborted":
              setAssistModeGenerating(false);
              setAssistModeProgress(null);
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
    }
  }, [note.id, note.video_path, note.subtitle_path, note.model_id, currentModelId, onGenerationComplete]);

  // 用于存储 generateHighlightsDirectly 的 ref，避免循环依赖
  const generateHighlightsDirectlyRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // 直接调用后端 API 生成高光笔记（用于自动生成流程，不需要切换标签页）
  const generateHighlightsDirectly = useCallback(async () => {
    // 防止重复生成
    if (highlightIsGenerating) {
      console.log("[generateHighlightsDirectly] 已在生成中，跳过");
      return;
    }

    const effectiveModelId = currentModelId || note.model_id;
    if (!effectiveModelId || !note.subtitle_path) {
      console.error("[generateHighlightsDirectly] 缺少必要参数");
      return;
    }

    setHighlightIsGenerating(true);
    try {
      const generationId = await invoke<string>("generate_highlights", {
        noteId: note.id,
        modelId: effectiveModelId,
        subtitlePath: note.subtitle_path,
        highlightType: "default",
        totalDuration: chapterData?.total_duration || 0,
      });

      // 等待生成完成
      const eventName = `highlight-generation-${generationId}`;
      const unlisten = await listen<any>(eventName, (event) => {
        const data = event.payload;
        if (data.status === "AllCompleted") {
          setHighlightIsGenerating(false);
          onGenerationComplete?.();
          // 如果是自动生成流程，跳过视觉化总结，直接触发闪记卡生成
          if (isInitialAutoGeneration(note.id)) {
            setTimeout(() => {
              generateFlashcardsDirectlyRef.current?.();
            }, 500);
          }
          unlisten();
        } else if (data.status === "Aborted") {
          setHighlightIsGenerating(false);
          unlisten();
        }
      });
    } catch (error) {
      console.error("[generateHighlightsDirectly] 生成失败:", error);
      setHighlightIsGenerating(false);
    }
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, chapterData?.total_duration, onGenerationComplete, highlightIsGenerating]);

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
    // 注意：不在此处结束自动生成流程，而是在闪记卡生成完成后结束

    // 如果已有缓存或正在优化，则不重复触发，但仍需继续自动生成流程
    if (optimizedSubtitles.size > 0 || subtitleOptimizing) {
      // 如果是自动生成流程，直接触发闪记卡生成
      if (isInitialAutoGeneration(note.id)) {
        setTimeout(() => {
          generateFlashcardsDirectlyRef.current?.();
        }, 500);
      }
      return;
    }

    // 检查必要条件
    if (!chapterData || !note.subtitle_path || !note.model_id) {
      // 如果是自动生成流程，仍需触发闪记卡生成
      if (isInitialAutoGeneration(note.id)) {
        setTimeout(() => {
          generateFlashcardsDirectlyRef.current?.();
        }, 500);
      }
      return;
    }

    // 静默执行字幕优化
    const effectiveModelId = currentModelId || note.model_id;
    if (!effectiveModelId) {
      // 如果是自动生成流程，仍需触发闪记卡生成
      if (isInitialAutoGeneration(note.id)) {
        setTimeout(() => {
          generateFlashcardsDirectlyRef.current?.();
        }, 500);
      }
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
        // 如果是自动生成流程，仍需触发闪记卡生成
        if (isInitialAutoGeneration(note.id)) {
          setTimeout(() => {
            generateFlashcardsDirectlyRef.current?.();
          }, 500);
        }
        return;
      }
    }

    if (currentSubtitleEntries.length === 0) {
      // 如果是自动生成流程，仍需触发闪记卡生成
      if (isInitialAutoGeneration(note.id)) {
        setTimeout(() => {
          generateFlashcardsDirectlyRef.current?.();
        }, 500);
      }
      return;
    }

    const generationId = crypto.randomUUID();
    subtitleOptimizationIdRef.current = generationId;

    const chaptersToOptimize = chapterData.chapters
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
      if (isInitialAutoGeneration(note.id)) {
        setTimeout(() => {
          generateFlashcardsDirectlyRef.current?.();
        }, 500);
      }
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
      // 如果是自动生成流程，仍需触发闪记卡生成
      if (isInitialAutoGeneration(note.id)) {
        setTimeout(() => {
          generateFlashcardsDirectlyRef.current?.();
        }, 500);
      }
    }
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, chapterData, subtitleEntries, optimizedSubtitles.size, subtitleOptimizing, setupSubtitleOptimizationListener]);

  // 更新 triggerVisualSummaryOptimizationSilent ref
  useEffect(() => {
    triggerVisualSummaryOptimizationSilentRef.current = triggerVisualSummaryOptimizationSilent;
  }, [triggerVisualSummaryOptimizationSilent]);

  // 直接调用后端 API 生成闪记卡（用于自动生成流程，不需要切换标签页）
  const generateFlashcardsDirectly = useCallback(async () => {
    // 防止重复生成
    if (flashcardIsGenerating) {
      console.log("[generateFlashcardsDirectly] 已在生成中，跳过");
      return;
    }

    const effectiveModelId = currentModelId || note.model_id;
    if (!effectiveModelId || !note.subtitle_path) {
      console.error("[generateFlashcardsDirectly] 缺少必要参数");
      // 结束自动生成流程
      setInitialAutoGeneration(note.id, false);
      // 通知任务队列：任务完成（即使缺少参数也要通知）
      completeTask(note.id).catch(console.error);
      return;
    }

    try {
      const generationId = crypto.randomUUID();

      // 设置生成状态（让标签页显示闪烁动画）
      setFlashcardIsGenerating(true);

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
              // 结束自动生成流程
              setInitialAutoGeneration(note.id, false);
              // 通知任务队列：整个自动初始化流程完成
              console.log(`[generateFlashcardsDirectly] 自动初始化流程完成，通知任务队列: note_id=${note.id}`);
              completeTask(note.id).catch(console.error);
              unlisten();
              break;
            case "Error":
            case "Aborted":
              // 清除生成状态
              setFlashcardIsGenerating(false);
              // 结束自动生成流程
              setInitialAutoGeneration(note.id, false);
              // 通知任务队列：任务完成（即使失败也要通知，让下一个任务继续）
              console.log(`[generateFlashcardsDirectly] 生成失败/中止，通知任务队列: note_id=${note.id}`);
              completeTask(note.id).catch(console.error);
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
      // 结束自动生成流程
      setInitialAutoGeneration(note.id, false);
      // 通知任务队列：任务完成（即使失败也要通知）
      completeTask(note.id).catch(console.error);
    }
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, onGenerationComplete, completeTask, flashcardIsGenerating]);

  // 更新 generateFlashcardsDirectly ref
  useEffect(() => {
    generateFlashcardsDirectlyRef.current = generateFlashcardsDirectly;
  }, [generateFlashcardsDirectly]);

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
      // 有缓存，直接启用显示
      setSubtitleOptimizationEnabled(true);
      return;
    }

    // 无缓存，开始优化
    // 优先使用视频播放器右上角选择的模型
    const effectiveModelId = currentModelId || note.model_id;
    if (!chapterData || !effectiveModelId || !note.subtitle_path) {
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
    const chaptersToOptimize = chapterData.chapters
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
  }, [subtitleOptimizing, subtitleOptimizationEnabled, optimizedSubtitles, chapterData, note.model_id, note.subtitle_path, note.id, subtitleEntries, setupSubtitleOptimizationListener, currentModelId]);

  // 高光笔记重新生成处理
  const handleHighlightRegenerate = useCallback(async () => {
    if (!note.subtitle_path || !note.model_id) {
      message.warning("缺少字幕文件或 AI 模型配置");
      return;
    }

    setHighlightIsGenerating(true);
    try {
      const generationId = await invoke<string>("generate_highlights", {
        noteId: note.id,
        modelId: currentModelId || note.model_id,
        subtitlePath: note.subtitle_path,
        highlightType: "default",
        totalDuration: chapterData?.total_duration || 0,
      });

      // 等待生成完成
      const eventName = `highlight-generation-${generationId}`;
      const unlisten = await listen<any>(eventName, (event) => {
        const data = event.payload;
        if (data.status === "AllCompleted") {
          setHighlightIsGenerating(false);
          onGenerationComplete?.();
          unlisten();
        } else if (data.status === "Aborted") {
          setHighlightIsGenerating(false);
          unlisten();
        }
      });
    } catch (error) {
      console.error("[NoteContentPanel] 高光笔记生成失败:", error);
      message.error(`生成失败: ${error}`);
      setHighlightIsGenerating(false);
    }
  }, [note.id, note.subtitle_path, note.model_id, currentModelId, chapterData?.total_duration, onGenerationComplete, highlightIsGenerating]);

  // 章节生成完成后的回调 - 触发高光笔记生成（自动生成流程）
  const handleChapterGenerationComplete = useCallback(() => {
    // 先刷新笔记数据
    onGenerationComplete?.();

    // 如果是自动生成流程，继续生成高光笔记（不切换标签页）
    if (isInitialAutoGeneration(note.id) && !note.highlights) {
      setTimeout(() => {
        generateHighlightsDirectly();
      }, 500);
    }
  }, [note.id, note.highlights, onGenerationComplete, generateHighlightsDirectly]);

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
    const chapter = chapterData?.chapters.find(c => c.id === chapterId);
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
  }, [chapterData, currentModelId, note.model_id, note.id, note.subtitle_path, subtitleEntries, optimizingChapterIds]);

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
3. Follow this exact format:

# Summary
A summary paragraph describing the core content of the video, each sentence no more than ${configSentenceLength} words

# Key Highlights
Extract the most important ${configHighlightCount} key points/highlights${configShowTimestamp ? ", and add the video timestamp (format: [00:01:23]) after each highlight title" : ""}${configShowEmoji ? ", and add an appropriate emoji symbol before each highlight title" : ""}

## ${emojiExample}Highlight Title 1${timestampExample}
Detailed description of this highlight

## ${emojiExample2}Highlight Title 2
Detailed description of this highlight

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
3. 严格按照以下格式输出：

# 摘要
摘要段落，概括视频核心内容，每句话不超过${configSentenceLength}字

# 核心亮点
提取最重要的${configHighlightCount}个知识点/亮点${configShowEmoji ? "，每个亮点标题前必须添加一个合适的 emoji 表情符号（如 🔥 💡 📊 🎯 ⚡）" : ""}${configShowTimestamp ? "，并在每个亮点标题后标注该亮点对应的视频时间戳（格式如 [00:01:23]）" : ""}

## ${emojiExample}亮点标题1${timestampExample}
详细描述该亮点的内容

## ${emojiExample2}亮点标题2
详细描述该亮点的内容

（继续提取${configHighlightCount}个亮点）

# 关键术语
- **术语1**：解释
- **术语2**：解释

视频字幕内容：`;
    }
  }, [configLanguage, configShowEmoji, configShowTimestamp, configHighlightCount, configSentenceLength]);

  // 执行生成
  const handleCustomGenerate = async () => {
    if (!selectedModelId) {
      message.warning("请选择AI模型");
      return;
    }

    // 检查是否已经在生成中
    const currentState = getNoteGenerationState(note.id);
    if (currentState.isGenerating) {
      message.warning("该笔记正在生成中，请稍后再试");
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
      const currentTabType = TAB_TYPE_MAPPING[activeTab] as TabType;
      const newRegeneratingTabs = currentTabType ? new Set<TabType>([currentTabType]) : new Set<TabType>();

      // 更新全局状态
      setNoteGenerationState(note.id, {
        isGenerating: true,
        generationId: id,
        regeneratingTabs: newRegeneratingTabs,
        progress: { current: 0, total: 0, message: "准备生成..." },
        completedTabs: new Set<TabType>(),
        failedTabs: new Map<TabType, string>(),
      });

      // 更新组件state
      setGenerationId(id);
      setIsGenerating(true);
      setCompletedTabs(new Set());
      setFailedTabs(new Map());
      setRegeneratingTabs(newRegeneratingTabs);

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
      setNoteGenerationState(note.id, {
        isGenerating: false,
        generationId: null,
        regeneratingTabs: new Set(),
      });
      setIsGenerating(false);
      setGenerationId(null);
      setRegeneratingTabs(new Set());
      message.error(`生成失败: ${error}`);
    }
  };

  // 自定义总结专用弹框的生成处理
  const handleCustomOnlyGenerate = async () => {
    if (!selectedModelId) {
      message.warning("请选择AI模型");
      return;
    }

    if (!customPrompt) {
      message.warning("请输入自定义提示词");
      return;
    }

    // 检查是否已经在生成中
    const currentState = getNoteGenerationState(note.id);
    if (currentState.isGenerating) {
      message.warning("该笔记正在生成中，请稍后再试");
      return;
    }

    setShowCustomOnlyDialog(false);

    try {
      const id = crypto.randomUUID();
      const newRegeneratingTabs = new Set<TabType>(["custom_summary"]);

      // 更新全局状态
      setNoteGenerationState(note.id, {
        isGenerating: true,
        generationId: id,
        regeneratingTabs: newRegeneratingTabs,
        progress: { current: 0, total: 0, message: "准备生成自定义总结..." },
        completedTabs: new Set<TabType>(),
        failedTabs: new Map<TabType, string>(),
      });

      // 更新组件state
      setGenerationId(id);
      setIsGenerating(true);
      setCompletedTabs(new Set());
      setFailedTabs(new Map());
      setRegeneratingTabs(newRegeneratingTabs);

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
        tabsToGenerate: ["custom_summary"],
        customPrompt: customPrompt,
      });
    } catch (error) {
      // 出错时重置状态
      setNoteGenerationState(note.id, {
        isGenerating: false,
        generationId: null,
        regeneratingTabs: new Set(),
      });
      setIsGenerating(false);
      setGenerationId(null);
      setRegeneratingTabs(new Set());
      message.error(`生成失败: ${error}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border overflow-hidden">
      {/* 标签页头部 */}
      <div className="border-b border-slate-200 dark:border-vnote-border select-none">
        <div className="flex items-center">
          {/* 当前分组的标签 */}
          <div className="flex flex-wrap flex-1">
            {TAB_GROUPS.find(g => g.id === activeGroup)?.tabs.map((tab) => {
              const generating = isTabGenerating(tab.id);
              const completed = isTabCompleted(tab.id);
              const error = getTabError(tab.id);

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors relative cursor-pointer",
                  activeTab === tab.id
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
          })}
          </div>

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
                  共 {chapterData?.chapters.length || 0} 个章节
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showChapterDropdown ? "rotate-180" : ""}`} />
                </button>
                {showChapterDropdown && chapterData && (
                  <div className="absolute top-full left-0 mt-1 w-96 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50 max-h-80 overflow-auto">
                    {/* 下拉框头部 */}
                    <div className="sticky top-0 bg-white dark:bg-slate-800 px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                      <List className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">章节目录</span>
                    </div>
                    {/* 章节列表 */}
                    <div className="py-1">
                      {chapterData.chapters.map((chapter, index) => {
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
                              // 设置当前选中的章节
                              setCurrentChapterId(chapter.id);
                              // 跳转到视频时间
                              window.dispatchEvent(new CustomEvent("seek-video", { detail: { time: chapter.start_time } }));
                              // 滚动到对应章节卡片
                              const chapterElement = document.getElementById(`chapter-${chapter.id}`);
                              if (chapterElement) {
                                chapterElement.scrollIntoView({ behavior: "smooth", block: "center" });
                              }
                              setShowChapterDropdown(false);
                            }}
                            className="w-full px-4 py-2 flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer text-left"
                          >
                            <span className="text-xs text-blue-400 dark:text-blue-400 font-mono w-12 flex-shrink-0">
                              {formatTime(chapter.start_time)}
                            </span>
                            <span className="text-xs w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                              {index + 1}
                            </span>
                            <span className="text-sm text-slate-700 dark:text-slate-200 truncate">
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
            {/* 字幕优化开关 - 仅在显示字幕时可用，辅助模式下隐藏 */}
            {!isAssistModeActive && note.subtitle_path && showChapterSubtitles && chapterData && (
              <button
                onClick={handleSubtitleOptimizationToggle}
                disabled={subtitleOptimizing}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                  subtitleOptimizationEnabled
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover",
                  subtitleOptimizing && "opacity-70"
                )}
              >
                {subtitleOptimizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                字幕优化
                {subtitleOptimizationProgress && (
                  <span className="text-xs ml-1">
                    ({subtitleOptimizationProgress.current}/{subtitleOptimizationProgress.total})
                  </span>
                )}
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
              onClick={async () => {
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
                  // 重新生成章节
                  chapterGridRef.current?.generateChapters();
                }
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
        <div className="flex items-center justify-end px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
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
          <div className="flex items-center gap-2">
            {/* 视图模式切换 */}
            <div className="flex items-center bg-slate-100 dark:bg-vnote-hover rounded-lg p-0.5">
              <button
                onClick={() => setVisualViewMode("markdown")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer",
                  visualViewMode === "markdown"
                    ? "bg-white dark:bg-vnote-card text-blue-600 dark:text-blue-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                <FileText className="w-4 h-4" />
                文档
              </button>
              <button
                onClick={() => setVisualViewMode("mindmap")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer",
                  visualViewMode === "mindmap"
                    ? "bg-white dark:bg-vnote-card text-blue-600 dark:text-blue-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                <GitBranch className="w-4 h-4" />
                思维导图
              </button>
            </div>
          </div>
          {/* 右侧按钮区域 */}
          <div className="flex items-center gap-1">
            {/* 思维导图模式下显示重新生成和导出按钮 */}
            {visualViewMode === "mindmap" && (
              <>
                <button
                  onClick={() => {
                    if (mindMapRef.current) {
                      mindMapRef.current.regenerate();
                      message.success("思维导图已重新生成");
                    } else {
                      message.warning("思维导图未初始化");
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  重新生成
                </button>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <div className="relative" ref={mindMapExportMenuRef}>
                  <button
                    onClick={() => setShowMindMapExportMenu(!showMindMapExportMenu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    导出
                  </button>
                  {showMindMapExportMenu && (
                    <div className="absolute top-full right-0 mt-2 w-40 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 py-1">
                      <button
                        onClick={() => handleMindMapExport('png')}
                        className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        导出为 PNG
                      </button>
                      <button
                        onClick={() => handleMindMapExport('svg')}
                        className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        导出为 SVG
                      </button>
                      <button
                        onClick={() => handleMindMapExport('pdf')}
                        className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        导出为 PDF
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
            {/* 仅在文档模式下显示时间戳、编辑和导出按钮 */}
            {visualViewMode === "markdown" && (
              <>
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
                <span className="text-slate-300 dark:text-slate-600">|</span>
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
              </>
            )}
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
        <div className="flex items-center justify-end px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('flashcard-regenerate', { detail: { noteId: note.id } }));
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
      ) : activeTab === "quicknotes" || activeTab === "mindmap" || activeTab === "canvas" ? (
        // 随手笔记、思维导图、无限画布标签页不需要次级工具栏（组件内部已有工具栏）
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
      <div className={cn(
        "flex-1",
        activeTab === "visual" && visualViewMode === "mindmap"
          ? "p-0 overflow-visible"
          : activeTab === "quicknotes" || activeTab === "mindmap" || activeTab === "canvas"
          ? "p-0 overflow-hidden"
          : isEditMode ? "p-0 overflow-y-auto" : "p-6 overflow-y-auto"
      )}>
        {/* 队列等待状态 */}
        {isNoteWaiting(note.id) && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4 p-8 bg-slate-50 dark:bg-vnote-surface rounded-lg border border-slate-200 dark:border-vnote-border">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              <div className="text-center">
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  排队等待中...
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  当前队列位置: #{getNoteQueuePosition(note.id)}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  前面还有 {getNoteQueuePosition(note.id) || 0} 个笔记在处理
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 正常内容渲染 */}
        {!isNoteWaiting(note.id) && activeTab === "summary" && (
          <EditableMarkdown
            noteId={note.id}
            tabType="full_summary"
            content={note.full_summary}
            isGenerating={isTabGenerating("summary")}
            emptyMessage="全文总结内容将在AI分析后生成"
            isEditMode={isEditMode}
            onContentUpdate={onGenerationComplete}
          />
        )}
        {!isNoteWaiting(note.id) && activeTab === "original" && (() => {
          // 辅助模式下显示 AssistModeView
          if (isAssistModeActive) {
            return (
              <AssistModeView
                noteId={note.id}
                subtitlePath={note.subtitle_path}
                videoPath={note.video_path}
                onRegenerateChapters={(markers: ScreenshotMarker[]) => {
                  // 使用截图标记生成章节
                  generateChaptersWithMarkers(markers);
                }}
                onExitAssistMode={() => setIsAssistModeActive(false)}
                onMarkersChange={setAssistModeMarkers}
              />
            );
          }

          // 检查是否是纯文本内容（向后兼容旧数据）
          const isPlainText = typeof note.detailed_reading === "string" &&
            note.detailed_reading.trim() &&
            !note.detailed_reading.trim().startsWith("{");

          return isPlainText ? (
            <EditableMarkdown
              noteId={note.id}
              tabType="detailed_reading"
              content={note.detailed_reading as string | null}
              isGenerating={isTabGenerating("original")}
              emptyMessage="原文细读内容将在AI分析后生成"
              isEditMode={isEditMode}
              onContentUpdate={onGenerationComplete}
            />
          ) : (
            // 否则显示 ChapterGrid（包含空状态和有数据的状态）
            <ChapterGrid
              ref={chapterGridRef}
              noteId={note.id}
              videoPath={note.video_path}
              subtitlePath={note.subtitle_path}
              chapterData={chapterData}
              isGenerating={isTabGenerating("original")}
              onChapterClick={(chapter) => {
                // 记录用户点击时间，防止视频时间更新干扰
                userClickTimeRef.current = Date.now();
                setCurrentChapterId(chapter.id);
                // 发送事件跳转视频时间
                window.dispatchEvent(new CustomEvent("seek-video", { detail: { time: chapter.start_time } }));
              }}
              onGenerationComplete={handleChapterGenerationComplete}
              modelId={currentModelId || note.model_id}
              showToolbar={false}
              currentChapterId={currentChapterId}
              showSubtitles={showChapterSubtitles}
              // 字幕优化相关
              subtitleOptimizationEnabled={subtitleOptimizationEnabled}
              optimizedSubtitles={optimizedSubtitles}
              optimizingChapterIds={optimizingChapterIds}
              failedChapterIds={failedChapterIds}
              onReoptimizeChapter={handleReoptimizeChapter}
            />
          );
        })()}
        {!isNoteWaiting(note.id) && activeTab === "highlights" && (
          <HighlightGrid
            ref={highlightGridRef}
            noteId={note.id}
            subtitlePath={note.subtitle_path}
            modelId={currentModelId || note.model_id}
            totalDuration={chapterData?.total_duration || 0}
            initialHighlightData={parseHighlightData(note.highlights)}
            onGenerationComplete={() => {
              onGenerationComplete?.();
            }}
            isGenerating={highlightIsGenerating}
            onRegenerate={handleHighlightRegenerate}
          />
        )}
        {!isNoteWaiting(note.id) && activeTab === "script" && <ScriptContent subtitlePath={note.subtitle_path} autoScroll={autoScroll} />}
        {!isNoteWaiting(note.id) && activeTab === "visual" && (
          <VisualSummaryContent
            ref={mindMapRef}
            chapterData={chapterData}
            optimizedSubtitles={optimizedSubtitles}
            originalSubtitles={subtitleEntries}
            isEditMode={isVisualEditMode}
            editContent={visualEditContent}
            onEditContentChange={setVisualEditContent}
            showTimestamp={showVisualTimestamp}
            viewMode={visualViewMode}
            noteTitle={note.title}
            savedMindMapData={note.visual_summary}
            noteId={note.id}
            onDataChange={onGenerationComplete}
          />
        )}
        {!isNoteWaiting(note.id) && activeTab === "custom" && (
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
        {!isNoteWaiting(note.id) && activeTab === "flashcard" && (
          <FlashcardContent
            noteId={note.id}
            noteName={note.title}
            subtitlePath={note.subtitle_path}
            modelId={currentModelId || note.model_id}
            flashcardData={parseFlashcardData(note.flashcards)}
            isGenerating={isTabGenerating("flashcard")}
            onGenerationComplete={onGenerationComplete}
          />
        )}
        {!isNoteWaiting(note.id) && activeTab === "quicknotes" && (
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
        {!isNoteWaiting(note.id) && activeTab === "mindmap" && (
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
        {!isNoteWaiting(note.id) && activeTab === "canvas" && (
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
                    {promptConfigs.filter(p => p.category === "summary").length > 0 && (
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
                            {promptConfigs.filter(p => p.category === "summary").map(prompt => (
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

      {/* 自定义总结专用弹窗（只显示自定义标签页） */}
      {showCustomOnlyDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCustomOnlyDialog(false)}>
          <div className="bg-white dark:bg-vnote-card rounded-2xl shadow-2xl w-[600px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            {/* 标题和关闭按钮 */}
            <div className="flex items-center justify-between px-8 pt-6 pb-4">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-500" />
                自定义总结
              </h3>
              <button
                onClick={() => setShowCustomOnlyDialog(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* 内容区域 */}
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

              {/* 提示词内容输入 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">提示词内容</label>
                  {promptConfigs.filter(p => p.category === "summary").length > 0 && (
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
                          {promptConfigs.filter(p => p.category === "summary").map(prompt => (
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

            {/* 底部按钮 */}
            <div className="flex gap-3 px-8 pb-6 pt-2">
              <button
                onClick={() => setShowCustomOnlyDialog(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-xl transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleCustomOnlyGenerate}
                disabled={!customPrompt}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 字幕脚本内容 - 结构化展示字幕
interface ScriptContentProps {
  subtitlePath: string | null;
  autoScroll: boolean;
}

function ScriptContent({ subtitlePath, autoScroll }: ScriptContentProps) {
  const [subtitleEntries, setSubtitleEntries] = useState<SubtitleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentEntryIndex, setCurrentEntryIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // 根据时间查找当前字幕条目
  const findCurrentEntryIndex = useCallback((time: number): number | null => {
    for (let i = 0; i < subtitleEntries.length; i++) {
      const entry = subtitleEntries[i];
      if (time >= entry.start_time && time <= entry.end_time) {
        return i;
      }
    }
    return null;
  }, [subtitleEntries]);

  // 监听视频时间更新
  useEffect(() => {
    if (!autoScroll || subtitleEntries.length === 0) return;

    const handleVideoTimeUpdate = (e: Event) => {
      const event = e as CustomEvent<{ time: number }>;
      const currentTime = event.detail.time;
      const index = findCurrentEntryIndex(currentTime);
      
      if (index !== currentEntryIndex) {
        setCurrentEntryIndex(index);
        
        // 自动滚动到当前字幕行
        if (index !== null) {
          const element = document.getElementById(`subtitle-row-${subtitleEntries[index].index}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }
    };

    window.addEventListener("video-time-update", handleVideoTimeUpdate);
    return () => window.removeEventListener("video-time-update", handleVideoTimeUpdate);
  }, [autoScroll, subtitleEntries, currentEntryIndex, findCurrentEntryIndex]);

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
    <div ref={containerRef} className="space-y-1">
      {subtitleEntries.map((entry, index) => (
        <SubtitleRow
          key={entry.index}
          entry={entry}
          isActive={currentEntryIndex === index}
          onClick={() => {}}
        />
      ))}
    </div>
  );
}
