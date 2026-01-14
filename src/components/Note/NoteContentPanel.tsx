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
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "../../utils/cn";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Note, GenerationEvent, TabType, AiConfig, PromptConfig, ChapterData } from "../../types";
import { EditableMarkdown } from "./EditableMarkdown";
import { ChapterGrid, type ChapterGridRef } from "./ChapterGrid";
import { message } from "../../utils/message";
import {
  getNoteGenerationState,
  setNoteGenerationState,
  attemptedAutoGenerateNoteIds,
  activeListeners,
} from "../../utils/noteGenerationState";

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
// 工具函数已移至 src/utils/noteGenerationState.ts 以避免 Fast Refresh 警告
// ============================================================================

interface NoteContentPanelProps {
  note: Note;
  onGenerationComplete?: () => void;
  aiConfigs: AiConfig[];
  currentModelId?: number | null; // 视频播放器右上角选择的模型ID
  promptConfigs?: PromptConfig[]; // 提示词配置列表
}

export function NoteContentPanel({ note, onGenerationComplete, aiConfigs, currentModelId, promptConfigs = [] }: NoteContentPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");

  // ChapterGrid 组件的 ref
  const chapterGridRef = useRef<ChapterGridRef>(null);

  // 章节相关状态
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);
  const [isChapterMode, setIsChapterMode] = useState(false);

  // 章节下拉框状态
  const [showChapterDropdown, setShowChapterDropdown] = useState(false);
  const chapterDropdownRef = useRef<HTMLDivElement>(null);

  // 字幕滚动状态
  const [autoScroll, setAutoScroll] = useState(true);
  // 当前播放的章节ID
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  // 用户点击章节的时间戳（用于忽略视频时间更新）
  const userClickTimeRef = useRef<number>(0);

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
            setIsChapterMode(true);
          } else {
            setChapterData(null);
            setIsChapterMode(false);
          }
        } catch (e) {
          // 不是 JSON，保持为普通文本模式
          setChapterData(null);
          setIsChapterMode(false);
        }
      } else if (typeof note.detailed_reading === "object" && note.detailed_reading.chapters) {
        // 已经是 ChapterData 对象
        setChapterData(note.detailed_reading);
        setIsChapterMode(true);
      } else {
        setChapterData(null);
        setIsChapterMode(false);
      }
    } else {
      setChapterData(null);
      setIsChapterMode(false);
    }
  }, [note.detailed_reading]);

  // 编辑模式状态
  const [isEditMode, setIsEditMode] = useState(false);

  // 从全局状态同步组件state
  const syncStateFromGlobal = useCallback(() => {
    const globalState = getNoteGenerationState(note.id);
    return globalState;
  }, [note.id]);

  // 生成状态（从全局状态同步）
  const [isGenerating, setIsGenerating] = useState(() => syncStateFromGlobal().isGenerating);
  const [regeneratingTabs, setRegeneratingTabs] = useState<Set<TabType>>(() => new Set(syncStateFromGlobal().regeneratingTabs) as Set<TabType>);
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
          // 显示错误提示
          const tabName = failedTab === "full_summary" ? "全文总结" :
            failedTab === "detailed_reading" ? "原文细读" :
            failedTab === "highlights" ? "高光笔记" :
            failedTab === "visual_summary" ? "视觉化总结" :
            "自定义总结";
          message.error(`${tabName}生成失败: ${data.error}`);
          console.error(`[TabError] ${tabName} 生成失败:`, data.error);
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
        setCompletedTabs(new Set(globalState.completedTabs) as Set<TabType>);
        setFailedTabs(new Map(globalState.failedTabs) as Map<TabType, string>);
        setRegeneratingTabs(new Set(globalState.regeneratingTabs) as Set<TabType>);
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
  const handleGenerate = async () => {
    if (!note.model_id) {
      message.warning("请先选择AI模型");
      return;
    }

    // 检查是否已经在生成中
    const currentState = getNoteGenerationState(note.id);
    if (currentState.isGenerating) {
      return;
    }

    try {
      const id = crypto.randomUUID();

      // 生成默认提示词（中文、emoji、无时间戳、5个亮点、30字句子）
      const finalPrompt = `你是一个专业的视频内容分析师。请分析以下视频字幕，生成一份结构化的全文总结。

输出要求：
1. 使用 Markdown 格式输出（不要使用代码块标记）
2. 必须使用中文输出所有内容
3. 严格按照以下格式输出：

# 摘要
摘要段落，概括视频核心内容，每句话不超过30字

# 核心亮点
提取最重要的5个知识点/亮点，每个亮点标题前必须添加一个合适的 emoji 表情符号（如 🔥 💡 📊 🎯 ⚡）

## 🔥亮点标题1
详细描述该亮点的内容

## 💡亮点标题2
详细描述该亮点的内容

（继续提取5个亮点）

# 关键术语
- **术语1**：解释
- **术语2**：解释

视频字幕内容：`;

      // 更新全局状态
      setNoteGenerationState(note.id, {
        isGenerating: true,
        generationId: id,
        regeneratingTabs: new Set(["full_summary"]),
        progress: { current: 0, total: 1, message: "正在生成全文总结..." },
        completedTabs: new Set(),
        failedTabs: new Map(),
      });

      // 更新组件state
      setIsGenerating(true);
      setGenerationId(id);
      setCompletedTabs(new Set());
      setFailedTabs(new Map());
      setRegeneratingTabs(new Set(["full_summary"]));
      setProgress({ current: 0, total: 1, message: "正在生成全文总结..." });

      // 设置事件监听器
      setupGenerationListener(note.id, id);

      // 等待状态更新和事件监听器设置完成
      await new Promise(resolve => setTimeout(resolve, 100));

      // 调用后端生成接口（只生成全文总结）
      await invoke("generate_note_content", {
        generationId: id,
        noteId: note.id,
        modelId: note.model_id,
        concurrent: false,  // 不并发，只生成一个
        regenerate: true,   // 使用重新生成模式
        tabsToGenerate: ["full_summary"],
        customPrompt: finalPrompt,
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

  // 自动生成：当组件挂载且没有全文总结时，自动开始生成（仅触发一次）
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
      handleGenerate();
    }
  }, [note.id, note.full_summary, note.model_id]);

  // 检查标签页是否正在生成
  const isTabGenerating = (tabId: TabId): boolean => {
    const tabType = TAB_TYPE_MAPPING[tabId];
    if (!tabType) return false;
    // 如果正在重新生成该标签页，显示加载状态
    if (regeneratingTabs.has(tabType)) return true;
    // 只检查当前笔记的全局生成状态，不使用组件内部状态（避免切换笔记时状态混淆）
    const globalState = getNoteGenerationState(note.id);
    if (globalState.isGenerating) {
      const isNotCompleted = !globalState.completedTabs.has(tabType);
      const isNotFailed = !globalState.failedTabs.has(tabType);
      // 正在生成中，且该标签页未完成未失败，就显示加载状态
      if (isNotCompleted && isNotFailed) {
        return true;
      }
    }
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
              onClick={openPromptDialog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              重新总结
            </button>
          </div>
        </div>
      ) : activeTab === "original" && isChapterMode ? (
        // 原文细读标签页（章节模式）的工具栏
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-3">
            {/* 章节下拉框 */}
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
          {/* 重新生成按钮 - 样式与"重新总结"一致 */}
          <button
            onClick={() => chapterGridRef.current?.generateChapters()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            重新生成
          </button>
        </div>
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
        {activeTab === "original" && (() => {
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
              onGenerationComplete={onGenerationComplete}
              modelId={note.model_id}
              showToolbar={false}
              currentChapterId={currentChapterId}
            />
          );
        })()}
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
