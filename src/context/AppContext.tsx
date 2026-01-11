import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Folder, Note, AppStats, AiConfig, SidebarState, UploadedFile, CreateNoteRequest } from "../types";

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
  refreshAiConfigs: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  createNote: (req: CreateNoteRequest) => Promise<Note>;

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
  currentView: "home" | "settings" | "note";
  setCurrentView: (view: "home" | "settings" | "note") => void;
  selectedNoteId: number | null;
  setSelectedNoteId: (id: number | null) => void;
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
  const [currentView, setCurrentView] = useState<"home" | "settings" | "note">("home");
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);

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

  // 初始加载
  useEffect(() => {
    refreshAiConfigs();
    refreshNotes();
  }, []);

  // 侧边栏操作
  const toggleSidebar = useCallback(() => {
    setSidebar((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  const setSelectedFolder = useCallback((folderId: string | null) => {
    setSidebar((prev) => ({ ...prev, selectedFolderId: folderId }));
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

  const value: AppContextType = {
    sidebar,
    toggleSidebar,
    setSelectedFolder,
    toggleFolderExpand,
    folders,
    notes,
    stats,
    aiConfigs,
    refreshAiConfigs,
    refreshNotes,
    createNote,
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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
