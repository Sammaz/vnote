import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Folder, Note, AppStats, AiConfig, SidebarState, UploadedFile, CreateNoteRequest, VideoToolbarSettings, PromptConfig, Collection, CreateCollectionRequest, ViewType } from "../types";

// Mock 数据 - 文件夹暂时保留
const mockFolders: Folder[] = [
  { id: "1", name: "学习笔记", parentId: null, createdAt: new Date(), updatedAt: new Date() },
  { id: "2", name: "工作资料", parentId: null, createdAt: new Date(), updatedAt: new Date() },
  { id: "3", name: "React 教程", parentId: "1", createdAt: new Date(), updatedAt: new Date() },
];

const mockStats: AppStats = {
  totalNotes: 0,
  totalWatchTime: 0,
  notesThisWeek: 0,
  lastActivityDate: new Date(),
};

// Context 状态类型
interface AppContextType {
  // 侧边栏状态
  sidebar: SidebarState;
  toggleSidebar: () => void;
  setSelectedFolder: (folderId: string | null) => void;
  toggleFolderExpand: (folderId: string) => void;

  // 数据
  folders: Folder[];
  notes: Note[];
  stats: AppStats;
  aiConfigs: AiConfig[];
  promptConfigs: PromptConfig[];
  refreshAiConfigs: () => Promise<void>;
  refreshPromptConfigs: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  createNote: (req: CreateNoteRequest) => Promise<Note>;
  deleteNote: (id: number) => Promise<void>;
  updateNoteSuggestedQuestions: (noteId: number, questions: string[]) => void;

  // 合集（资源库）
  collections: Collection[];
  selectedCollectionId: number | null;
  expandedCollections: Set<number>;
  refreshCollections: () => Promise<void>;
  createCollection: (req: CreateCollectionRequest) => Promise<Collection>;
  updateCollection: (collection: Collection) => Promise<void>;
  deleteCollection: (id: number) => Promise<void>;
  setSelectedCollection: (id: number | null) => void;
  toggleCollectionExpand: (id: number) => void;
  addNoteToCollection: (collectionId: number, noteId: number) => Promise<void>;
  removeNoteFromCollection: (collectionId: number, noteId: number) => Promise<void>;

  // 上传状态
  uploadedVideo: UploadedFile | null;
  uploadedSubtitle: UploadedFile | null;
  setUploadedVideo: (file: UploadedFile | null) => void;
  setUploadedSubtitle: (file: UploadedFile | null) => void;

  // AI 模型选择
  selectedModelId: number | null;
  setSelectedModelId: (id: number | null) => void;

  // 生成状态
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;

  // 搜索
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // 当前视图
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  selectedNoteId: number | null;
  setSelectedNoteId: (id: number | null) => void;

  // 视频工具栏设置（全局）
  toolbarSettings: VideoToolbarSettings;
  setVideoVisible: (visible: boolean) => void;
  setAutoPlay: (autoPlay: boolean) => void;
  setLayoutSwapped: (swapped: boolean) => void;
  setLayoutPanelWidth: (width: number) => void;
  setCaptionsEnabled: (enabled: boolean) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // 侧边栏
  const [sidebar, setSidebar] = useState<SidebarState>({
    collapsed: false,
    selectedFolderId: null,
    expandedFolders: new Set(["1"]),
  });

  // 数据（文件夹暂用 mock）
  const [folders] = useState<Folder[]>(mockFolders);
  const [notes, setNotes] = useState<Note[]>([]);
  const [stats, setStats] = useState<AppStats>(mockStats);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);

  // 合集（资源库）状态
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [expandedCollections, setExpandedCollections] = useState<Set<number>>(new Set());

  // 上传状态
  const [uploadedVideo, setUploadedVideo] = useState<UploadedFile | null>(null);
  const [uploadedSubtitle, setUploadedSubtitle] = useState<UploadedFile | null>(null);

  // AI 模型
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);

  // 搜索
  const [searchQuery, setSearchQuery] = useState("");

  // 视图
  const [currentView, setCurrentView] = useState<ViewType>("home");
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);

  // 视频工具栏设置（全局）
  const [toolbarSettings, setToolbarSettings] = useState<VideoToolbarSettings>({
    videoVisible: true,
    autoPlay: false,
    layoutSwapped: false,
    layoutPanelWidth: 40, // 默认左侧占 40%
    captionsEnabled: true, // 默认字幕开启
  });

  // 加载工具栏设置
  const loadToolbarSettings = useCallback(async () => {
    try {
      const [videoVisible, autoPlay, layoutSwapped, layoutPanelWidth, captionsEnabled] = await Promise.all([
        invoke<string | null>("get_setting", { key: "toolbar_video_visible" }),
        invoke<string | null>("get_setting", { key: "toolbar_auto_play" }),
        invoke<string | null>("get_setting", { key: "toolbar_layout_swapped" }),
        invoke<string | null>("get_setting", { key: "toolbar_layout_panel_width" }),
        invoke<string | null>("get_setting", { key: "toolbar_captions_enabled" }),
      ]);

      setToolbarSettings({
        videoVisible: videoVisible !== "false",
        autoPlay: autoPlay === "true",
        layoutSwapped: layoutSwapped === "true",
        layoutPanelWidth: layoutPanelWidth ? Math.max(30, Math.min(70, parseInt(layoutPanelWidth, 10))) : 40,
        captionsEnabled: captionsEnabled !== "false", // 默认开启
      });
    } catch (error) {
      console.error("Failed to load toolbar settings:", error);
    }
  }, []);

  // 保存单个设置
  const saveSetting = useCallback(async (key: string, value: string) => {
    try {
      await invoke("set_setting", { key, value });
    } catch (error) {
      console.error(`Failed to save setting ${key}:`, error);
    }
  }, []);

  // 设置视频可见性
  const setVideoVisible = useCallback((visible: boolean) => {
    setToolbarSettings(prev => ({ ...prev, videoVisible: visible }));
    saveSetting("toolbar_video_visible", visible.toString());
  }, [saveSetting]);

  // 设置自动播放
  const setAutoPlay = useCallback((autoPlay: boolean) => {
    setToolbarSettings(prev => ({ ...prev, autoPlay }));
    saveSetting("toolbar_auto_play", autoPlay.toString());
  }, [saveSetting]);

  // 设置布局交换
  const setLayoutSwapped = useCallback((swapped: boolean) => {
    setToolbarSettings(prev => ({ ...prev, layoutSwapped: swapped }));
    saveSetting("toolbar_layout_swapped", swapped.toString());
  }, [saveSetting]);

  // 设置布局面板宽度
  const setLayoutPanelWidth = useCallback((width: number) => {
    const clampedWidth = Math.max(30, Math.min(70, width));
    setToolbarSettings(prev => ({ ...prev, layoutPanelWidth: clampedWidth }));
    saveSetting("toolbar_layout_panel_width", clampedWidth.toString());
  }, [saveSetting]);

  // 设置字幕开关状态
  const setCaptionsEnabled = useCallback((enabled: boolean) => {
    setToolbarSettings(prev => ({ ...prev, captionsEnabled: enabled }));
    saveSetting("toolbar_captions_enabled", enabled.toString());
  }, [saveSetting]);

  // 加载笔记列表
  const refreshNotes = useCallback(async () => {
    try {
      const notesList = await invoke<Note[]>("get_notes");
      setNotes(notesList);

      // 更新统计
      setStats(prev => ({
        ...prev,
        totalNotes: notesList.length,
        lastActivityDate: new Date(),
      }));
    } catch (error) {
      console.error("Failed to load notes:", error);
    }
  }, []);

  // 创建笔记
  const createNote = useCallback(async (req: CreateNoteRequest): Promise<Note> => {
    const newNote = await invoke<Note>("create_note", { req });
    // 刷新笔记列表
    await refreshNotes();
    return newNote;
  }, [refreshNotes]);

  // 删除笔记
  const deleteNote = useCallback(async (id: number): Promise<void> => {
    await invoke("delete_note", { id });
    // 刷新笔记列表
    await refreshNotes();
    // 如果删除的是当前选中的笔记，清除选中状态并返回首页
    if (selectedNoteId === id) {
      setSelectedNoteId(null);
      setCurrentView("home");
    }
    // 清除文件夹选中状态
    setSidebar((prev) => ({ ...prev, selectedFolderId: null }));
  }, [refreshNotes, selectedNoteId]);

  // 更新笔记的建议问题（用于局部刷新）
  const updateNoteSuggestedQuestions = useCallback((noteId: number, questions: string[]) => {
    setNotes(prev => prev.map(note =>
      note.id === noteId
        ? { ...note, suggested_questions: JSON.stringify(questions) }
        : note
    ));
  }, []);

  // 加载 AI 配置
  const refreshAiConfigs = useCallback(async () => {
    try {
      const configs = await invoke<AiConfig[]>("get_ai_configs");
      setAiConfigs(configs);

      // 如果当前没有选中模型，选择默认模型或第一个
      if (configs.length > 0) {
        const defaultConfig = configs.find(c => c.is_default);
        if (defaultConfig) {
          setSelectedModelId(defaultConfig.id);
        } else if (!selectedModelId || !configs.find(c => c.id === selectedModelId)) {
          setSelectedModelId(configs[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to load AI configs:", error);
    }
  }, [selectedModelId]);

  // 加载提示词配置
  const refreshPromptConfigs = useCallback(async () => {
    try {
      const configs = await invoke<PromptConfig[]>("get_prompt_configs");
      setPromptConfigs(configs);
    } catch (error) {
      console.error("Failed to load prompt configs:", error);
    }
  }, []);

  // 加载合集列表
  const refreshCollections = useCallback(async () => {
    try {
      const collectionsList = await invoke<Collection[]>("get_collections");
      setCollections(collectionsList);
    } catch (error) {
      console.error("Failed to load collections:", error);
    }
  }, []);

  // 创建合集
  const createCollectionFn = useCallback(async (req: CreateCollectionRequest): Promise<Collection> => {
    const newCollection = await invoke<Collection>("create_collection", { req });
    await refreshCollections();
    return newCollection;
  }, [refreshCollections]);

  // 更新合集
  const updateCollectionFn = useCallback(async (collection: Collection): Promise<void> => {
    await invoke("update_collection", { collection });
    await refreshCollections();
  }, [refreshCollections]);

  // 删除合集
  const deleteCollectionFn = useCallback(async (id: number): Promise<void> => {
    await invoke("delete_collection", { id });
    await refreshCollections();
    // 如果删除的是当前选中的合集，清除选中状态并返回首页
    if (selectedCollectionId === id) {
      setSelectedCollectionId(null);
      setCurrentView("home");
    }
  }, [refreshCollections, selectedCollectionId]);

  // 设置选中的合集
  const setSelectedCollection = useCallback((id: number | null) => {
    setSelectedCollectionId(id);
    // 选择合集时，清除文件夹和笔记选中状态
    setSidebar((prev) => ({ ...prev, selectedFolderId: null }));
    setSelectedNoteId(null);
  }, []);

  // 切换合集展开状态
  const toggleCollectionExpand = useCallback((id: number) => {
    setExpandedCollections((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return newExpanded;
    });
  }, []);

  // 添加笔记到合集
  const addNoteToCollectionFn = useCallback(async (collectionId: number, noteId: number): Promise<void> => {
    await invoke("add_note_to_collection", { collectionId, noteId });
    await refreshCollections();
  }, [refreshCollections]);

  // 从合集移除笔记
  const removeNoteFromCollectionFn = useCallback(async (collectionId: number, noteId: number): Promise<void> => {
    await invoke("remove_note_from_collection", { collectionId, noteId });
    await refreshCollections();
  }, [refreshCollections]);

  // 初始加载
  useEffect(() => {
    refreshAiConfigs();
    refreshPromptConfigs();
    refreshNotes();
    refreshCollections();
    loadToolbarSettings();
  }, []);

  // 侧边栏操作
  const toggleSidebar = useCallback(() => {
    setSidebar((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  const setSelectedFolder = useCallback((folderId: string | null) => {
    setSidebar((prev) => ({ ...prev, selectedFolderId: folderId }));
    // 选择文件夹时，清除笔记选中状态
    setSelectedNoteId(null);
  }, []);

  const toggleFolderExpand = useCallback((folderId: string) => {
    setSidebar((prev) => {
      const newExpanded = new Set(prev.expandedFolders);
      if (newExpanded.has(folderId)) {
        newExpanded.delete(folderId);
      } else {
        newExpanded.add(folderId);
      }
      return { ...prev, expandedFolders: newExpanded };
    });
  }, []);

  const value: AppContextType = useMemo(() => ({
    sidebar,
    toggleSidebar,
    setSelectedFolder,
    toggleFolderExpand,
    folders,
    notes,
    stats,
    aiConfigs,
    promptConfigs,
    refreshAiConfigs,
    refreshPromptConfigs,
    refreshNotes,
    createNote,
    deleteNote,
    updateNoteSuggestedQuestions,
    // 合集（资源库）
    collections,
    selectedCollectionId,
    expandedCollections,
    refreshCollections,
    createCollection: createCollectionFn,
    updateCollection: updateCollectionFn,
    deleteCollection: deleteCollectionFn,
    setSelectedCollection,
    toggleCollectionExpand,
    addNoteToCollection: addNoteToCollectionFn,
    removeNoteFromCollection: removeNoteFromCollectionFn,
    uploadedVideo,
    uploadedSubtitle,
    setUploadedVideo,
    setUploadedSubtitle,
    selectedModelId,
    setSelectedModelId,
    isGenerating,
    setIsGenerating,
    searchQuery,
    setSearchQuery,
    currentView,
    setCurrentView,
    selectedNoteId,
    setSelectedNoteId,
    toolbarSettings,
    setVideoVisible,
    setAutoPlay,
    setLayoutSwapped,
    setLayoutPanelWidth,
    setCaptionsEnabled,
  }), [
    sidebar,
    toggleSidebar,
    setSelectedFolder,
    toggleFolderExpand,
    folders,
    notes,
    stats,
    aiConfigs,
    promptConfigs,
    refreshAiConfigs,
    refreshPromptConfigs,
    refreshNotes,
    createNote,
    deleteNote,
    updateNoteSuggestedQuestions,
    // 合集（资源库）
    collections,
    selectedCollectionId,
    expandedCollections,
    refreshCollections,
    createCollectionFn,
    updateCollectionFn,
    deleteCollectionFn,
    setSelectedCollection,
    toggleCollectionExpand,
    addNoteToCollectionFn,
    removeNoteFromCollectionFn,
    uploadedVideo,
    uploadedSubtitle,
    setUploadedVideo,
    setUploadedSubtitle,
    selectedModelId,
    setSelectedModelId,
    isGenerating,
    setIsGenerating,
    searchQuery,
    setSearchQuery,
    currentView,
    setCurrentView,
    selectedNoteId,
    setSelectedNoteId,
    toolbarSettings,
    setVideoVisible,
    setAutoPlay,
    setLayoutSwapped,
    setLayoutPanelWidth,
    setCaptionsEnabled,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
