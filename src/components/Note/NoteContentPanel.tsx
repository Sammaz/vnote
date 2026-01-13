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
  Share2,
  Edit3,
  RefreshCw,
  CheckCircle2,
  FolderPlus,
  List,
  X,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Note, GenerationEvent, TabType, AiConfig, PromptConfig } from "../../types";
import { EditableMarkdown } from "./EditableMarkdown";
import { message } from "../ui/Message";

type TabId = "summary" | "original" | "highlights" | "script" | "visual" | "custom";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "summary", label: "全文总结", icon: <FileText className="w-4 h-4" /> },
  { id: "original", label: "原文细读", icon: <BookOpen className="w-4 h-4" /> },
  { id: "highlights", label: "高光笔记", icon: <Highlighter className="w-4 h-4" /> },
  { id: "script", label: "字幕脚本", icon: <Captions className="w-4 h-4" /> },
  { id: "visual", label: "视觉化总结", icon: <BarChart3 className="w-4 h-4" /> },
  { id: "custom", label: "自定义总结", icon: <Sparkles className="w-4 h-4" /> },
];

// 标签页类型映射
const TAB_TYPE_MAPPING: Record<string, TabType> = {
  summary: "full_summary",
  original: "detailed_reading",
  highlights: "highlights",
  visual: "visual_summary",
  custom: "custom_summary",
};

// ============================================================================
// 全局生成状态管理器（跨组件实例持久化）
// ============================================================================

interface NoteGenerationState {
  isGenerating: boolean;
  generationId: string | null;
  regeneratingTabs: Set<TabType>;
  progress: { current: number; total: number; message: string };
  completedTabs: Set<TabType>;
  failedTabs: Map<TabType, string>;
}

// 全局存储每个笔记的生成状态
const noteGenerationStates = new Map<number, NoteGenerationState>();

// 全局追踪已尝试自动生成的笔记ID（避免重复触发）
const attemptedAutoGenerateNoteIds = new Set<number>();

// 全局事件监听器管理（避免重复监听同一个generationId）
const activeListeners = new Map<string, () => void>();

// 获取或初始化笔记的生成状态
function getNoteGenerationState(noteId: number): NoteGenerationState {
  if (!noteGenerationStates.has(noteId)) {
    noteGenerationStates.set(noteId, {
      isGenerating: false,
      generationId: null,
      regeneratingTabs: new Set(),
      progress: { current: 0, total: 0, message: "" },
      completedTabs: new Set(),
      failedTabs: new Map(),
    });
  }
  return noteGenerationStates.get(noteId)!;
}

// 设置笔记的生成状态
function setNoteGenerationState(noteId: number, updates: Partial<NoteGenerationState>) {
  const state = getNoteGenerationState(noteId);
  Object.assign(state, updates);
}

// 清理笔记的生成状态（导出供外部使用）
export function clearNoteGenerationState(noteId: number) {
  const state = noteGenerationStates.get(noteId);
  if (state?.generationId) {
    // 清理事件监听器
    const unlisten = activeListeners.get(state.generationId);
    if (unlisten) {
      unlisten();
      activeListeners.delete(state.generationId);
    }
  }
  noteGenerationStates.delete(noteId);
}

// 判断笔记是否正在生成中（导出供外部使用）
export function isNoteGenerating(noteId: number): boolean {
  return getNoteGenerationState(noteId).isGenerating;
}

interface NoteContentPanelProps {
  note: Note;
  onGenerationComplete?: () => void;
  aiConfigs: AiConfig[];
  currentModelId?: number | null; // 视频播放器右上角选择的模型ID
  promptConfigs?: PromptConfig[]; // 提示词配置列表
}

export function NoteContentPanel({ note, onGenerationComplete, aiConfigs, currentModelId, promptConfigs = [] }: NoteContentPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");

  // 编辑模式状态
  const [isEditMode, setIsEditMode] = useState(false);

  // 从全局状态同步组件state
  const syncStateFromGlobal = useCallback(() => {
    const globalState = getNoteGenerationState(note.id);
    return globalState;
  }, [note.id]);

  // 生成状态（从全局状态同步）
  const [isGenerating, setIsGenerating] = useState(() => syncStateFromGlobal().isGenerating);
  const [regeneratingTabs, setRegeneratingTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().regeneratingTabs));
  const [progress, setProgress] = useState<{ current: number; total: number; message: string }>(() => ({ ...syncStateFromGlobal().progress }));
  const [completedTabs, setCompletedTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().completedTabs));
  const [failedTabs, setFailedTabs] = useState<Map<TabType, string>>(() => new Map(syncStateFromGlobal().failedTabs));
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
    setCompletedTabs(new Set(globalState.completedTabs));
    setFailedTabs(new Map(globalState.failedTabs));
    setRegeneratingTabs(new Set(globalState.regeneratingTabs));

    // 触发重新渲染以更新UI
    forceUpdate({});

    // 如果该笔记正在生成中，确保事件监听器已设置
    if (globalState.generationId && globalState.isGenerating) {
      setupGenerationListener(note.id, globalState.generationId);
    }
  }, [note.id]);

  // 监听笔记内容变化，确保生成完成后更新显示
  useEffect(() => {
    // 当笔记内容更新时，触发重新渲染
    forceUpdate({});
  }, [note.custom_summary, note.detailed_reading, note.highlights, note.visual_summary, note.full_summary]);

  // 设置生成事件监听器
  const setupGenerationListener = useCallback((noteId: number, genId: string) => {
    // 如果已经监听过这个generationId，跳过
    if (activeListeners.has(genId)) {
      return;
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
          setNoteGenerationState(noteId, {
            progress: { ...state.progress, message: `正在生成 ${data.tab_name}...` },
          });
          break;

        case "TabProgress":
          setNoteGenerationState(noteId, {
            progress: { current: data.current, total: data.total, message: data.message },
          });
          break;

        case "TabCompleted":
          const completedTab = data.tab_type as TabType;
          const newCompleted = new Set([...state.completedTabs, completedTab]);
          const newRegenerating = new Set([...state.regeneratingTabs].filter(t => t !== completedTab));
          setNoteGenerationState(noteId, {
            completedTabs: newCompleted,
            regeneratingTabs: newRegenerating,
          });
          break;

        case "TabError":
          const failedTab = data.tab_type as TabType;
          const newFailed = new Map([...state.failedTabs, [failedTab, data.error]]);
          const newRegenerating2 = new Set([...state.regeneratingTabs].filter(t => t !== failedTab));
          setNoteGenerationState(noteId, {
            failedTabs: newFailed,
            regeneratingTabs: newRegenerating2,
          });
          break;

        case "AllCompleted":
          setNoteGenerationState(noteId, {
            isGenerating: false,
            generationId: null,
            regeneratingTabs: new Set(),
            progress: { current: data.total, total: data.total, message: "生成完成!" },
            completedTabs: new Set([...state.completedTabs]),
          });
          // 清理事件监听器
          const unlisten = activeListeners.get(genId);
          if (unlisten) {
            unlisten();
            activeListeners.delete(genId);
          }
          // 刷新笔记数据并等待完成
          onGenerationComplete?.();
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
        setCompletedTabs(new Set(updatedState.completedTabs));
        setFailedTabs(new Map(updatedState.failedTabs));
        setRegeneratingTabs(new Set(updatedState.regeneratingTabs));
        forceUpdate({});
      }
    });

    unlistenPromise.then((unlisten) => {
      activeListeners.set(genId, unlisten);
    });
  }, [note.id]);

  // 定期同步全局状态到组件state（用于跨组件更新）
  useEffect(() => {
    const interval = setInterval(() => {
      const globalState = getNoteGenerationState(note.id);

      // 只有当状态真正变化时才更新
      if (globalState.isGenerating !== isGenerating ||
          globalState.generationId !== generationId ||
          globalState.progress.message !== progress.message) {
        setIsGenerating(globalState.isGenerating);
        setGenerationId(globalState.generationId);
        setProgress({ ...globalState.progress });
        setCompletedTabs(new Set(globalState.completedTabs));
        setFailedTabs(new Map(globalState.failedTabs));
        setRegeneratingTabs(new Set(globalState.regeneratingTabs));
      }
    }, 200); // 每200ms同步一次

    return () => clearInterval(interval);
  }, [note.id, isGenerating, generationId, progress.message]);

  // 自定义提示词弹窗状态
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [dialogTab, setDialogTab] = useState<"default" | "custom">("default");

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
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 开始生成笔记（一键生成全部）
  const handleGenerate = async () => {
    if (!note.model_id) {
      message.warning("请先选择AI模型");
      return;
    }

    // 检查是否已经在生成中
    const currentState = getNoteGenerationState(note.id);
    if (currentState.isGenerating) {
      console.log(`[自动生成] 笔记 ${note.id} 正在生成中，跳过重复触发`);
      return;
    }

    try {
      const id = crypto.randomUUID();

      // 更新全局状态
      setNoteGenerationState(note.id, {
        isGenerating: true,
        generationId: id,
        regeneratingTabs: new Set(),
        progress: { current: 0, total: 0, message: "准备生成..." },
        completedTabs: new Set(),
        failedTabs: new Map(),
      });

      // 更新组件state
      setIsGenerating(true);
      setGenerationId(id);
      setCompletedTabs(new Set());
      setFailedTabs(new Map());
      setRegeneratingTabs(new Set());
      setProgress({ current: 0, total: 0, message: "准备生成..." });

      // 设置事件监听器
      setupGenerationListener(note.id, id);

      // 等待状态更新和事件监听器设置完成
      await new Promise(resolve => setTimeout(resolve, 100));

      // 后端会立即返回 generation_id，实际生成在后台进行
      await invoke("generate_note_content", {
        generationId: id,
        noteId: note.id,
        modelId: note.model_id,
        concurrent: true,
        regenerate: false,
        tabsToGenerate: [] as string[],
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

  // 自动生成：当组件挂载且没有全文总结时，自动开始生成（仅触发一次）
  useEffect(() => {
    // 如果已经尝试过自动生成，跳过
    if (attemptedAutoGenerateNoteIds.has(note.id)) {
      return;
    }

    // 如果正在生成中，跳过
    const currentState = getNoteGenerationState(note.id);
    if (currentState.isGenerating) {
      console.log(`[自动生成] 笔记 ${note.id} 正在生成中，跳过重复触发`);
      return;
    }

    const hasNoContent = !note.full_summary && !note.detailed_reading &&
                         !note.highlights && !note.visual_summary && !note.custom_summary;

    if (hasNoContent && note.model_id && !isGenerating) {
      console.log(`[自动生成] 触发笔记 ${note.id} 的自动生成`);
      handleGenerate();
    }
  }, [note.id, note.full_summary, note.model_id]);

  // 检查标签页是否正在生成
  const isTabGenerating = (tabId: TabId): boolean => {
    const tabType = TAB_TYPE_MAPPING[tabId];
    if (!tabType) return false;
    // 如果正在重新生成该标签页，显示加载状态
    if (regeneratingTabs.has(tabType)) return true;
    if (!isGenerating) return false;
    const tabName = tabType === "full_summary" ? "全文总结" :
      tabType === "detailed_reading" ? "原文细读" :
      tabType === "highlights" ? "高光笔记" :
      tabType === "visual_summary" ? "视觉化总结" :
      "自定义总结";
    const isInProgress = progress.message.includes(tabName);
    const isNotCompleted = !completedTabs.has(tabType);
    const isNotFailed = !failedTabs.has(tabType);
    // 正在生成中，且该标签页未完成未失败，就显示加载状态
    return isInProgress || (isNotCompleted && isNotFailed && progress.total === 0);
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

---

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

---

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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border overflow-hidden">
      {/* 标签页头部 */}
      <div className="border-b border-slate-200 dark:border-vnote-border">
        <div className="flex flex-wrap">
          {TABS.map((tab) => {
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
                {completed && !generating && (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                )}
                {error && !generating && (
                  <X className="w-3 h-3 text-red-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border">
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer">
            <FolderPlus className="w-4 h-4" />
            添加合集
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer">
            <List className="w-4 h-4" />
            章节
            <span className="ml-1 text-xs text-slate-400">(6)</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer">
            <Copy className="w-4 h-4" />
            复制
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer">
            <Download className="w-4 h-4" />
            下载
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors cursor-pointer">
            <Share2 className="w-4 h-4" />
            分享
          </button>
        </div>
      </div>

      {/* 次级工具栏 */}
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
        <button
          onClick={openPromptDialog}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          重新总结
        </button>
      </div>

      {/* 内容区域 */}
      <div className={cn(
        "flex-1 overflow-y-auto",
        isEditMode ? "p-0" : "p-6"
      )}>
        {activeTab === "summary" && (
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
        {activeTab === "original" && (
          <EditableMarkdown
            noteId={note.id}
            tabType="detailed_reading"
            content={note.detailed_reading}
            isGenerating={isTabGenerating("original")}
            emptyMessage="原文细读内容将在AI分析后生成"
            isEditMode={isEditMode}
            onContentUpdate={onGenerationComplete}
          />
        )}
        {activeTab === "highlights" && (
          <EditableMarkdown
            noteId={note.id}
            tabType="highlights"
            content={note.highlights}
            isGenerating={isTabGenerating("highlights")}
            emptyMessage="暂无高光笔记"
            isEditMode={isEditMode}
            onContentUpdate={onGenerationComplete}
          />
        )}
        {activeTab === "script" && <ScriptContent subtitlePath={note.subtitle_path} />}
        {activeTab === "visual" && (
          <EditableMarkdown
            noteId={note.id}
            tabType="visual_summary"
            content={note.visual_summary}
            isGenerating={isTabGenerating("visual")}
            emptyMessage="视觉化总结 (Beta) - 即将推出"
            isEditMode={isEditMode}
            onContentUpdate={onGenerationComplete}
          />
        )}
        {activeTab === "custom" && (
          <EditableMarkdown
            noteId={note.id}
            tabType="custom_summary"
            content={note.custom_summary}
            isGenerating={isTabGenerating("custom")}
            emptyMessage="自定义总结 - 根据您的需求定制总结内容"
            isEditMode={isEditMode}
            onContentUpdate={onGenerationComplete}
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
    </div>
  );
}

// 字幕脚本内容 - 直接读取字幕文件
function ScriptContent({ subtitlePath }: { subtitlePath: string | null }) {
  const [subtitleContent, setSubtitleContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subtitlePath) {
      setSubtitleContent(null);
      return;
    }

    setLoading(true);
    setError(null);

    invoke<string>("read_file_content", { path: subtitlePath })
      .then((content) => {
        setSubtitleContent(content);
      })
      .catch((err) => {
        setError(`无法读取字幕文件: ${err}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [subtitlePath]);

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

  return (
    <div className="prose prose-slate dark:prose-invert max-w-none">
      <pre className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300 font-mono bg-slate-50 dark:bg-vnote-surface p-4 rounded-lg">
        {subtitleContent}
      </pre>
    </div>
  );
}
