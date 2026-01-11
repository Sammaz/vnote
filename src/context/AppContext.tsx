import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Folder, Note, AppStats, AiConfig, SidebarState, UploadedFile } from "../types";

// Mock 数据
const mockFolders: Folder[] = [
  { id: "1", name: "学习笔记", parentId: null, createdAt: new Date(), updatedAt: new Date() },
  { id: "2", name: "工作资料", parentId: null, createdAt: new Date(), updatedAt: new Date() },
  { id: "3", name: "React 教程", parentId: "1", createdAt: new Date(), updatedAt: new Date() },
];

const mockNotes: Note[] = [
  {
    id: "n1",
    folderId: "3",
    title: "React Hooks 入门教程",
    videoPath: "/videos/react-hooks.mp4",
    subtitlePath: "/subtitles/react-hooks.srt",
    thumbnailPath: null,
    content: "# React Hooks\n\n这是一个关于 React Hooks 的笔记...",
    duration: 3600,
    createdAt: new Date(Date.now() - 86400000),
    updatedAt: new Date(Date.now() - 86400000),
  },
  {
    id: "n2",
    folderId: "1",
    title: "TypeScript 高级技巧",
    videoPath: "/videos/typescript.mp4",
    subtitlePath: null,
    thumbnailPath: null,
    content: "# TypeScript 高级技巧\n\n...",
    duration: 2400,
    createdAt: new Date(Date.now() - 172800000),
    updatedAt: new Date(Date.now() - 172800000),
  },
  {
    id: "n3",
    folderId: "2",
    title: "项目管理最佳实践",
    videoPath: "/videos/pm.mp4",
    subtitlePath: "/subtitles/pm.vtt",
    thumbnailPath: null,
    content: "# 项目管理\n\n...",
    duration: 5400,
    createdAt: new Date(Date.now() - 259200000),
    updatedAt: new Date(Date.now() - 259200000),
  },
  {
    id: "n4",
    folderId: "1",
    title: "Rust 语言基础",
    videoPath: "/videos/rust.mp4",
    subtitlePath: null,
    thumbnailPath: null,
    content: "# Rust 基础\n\n...",
    duration: 4200,
    createdAt: new Date(Date.now() - 345600000),
    updatedAt: new Date(Date.now() - 345600000),
  },
];

const mockStats: AppStats = {
  totalNotes: 4,
  totalWatchTime: 15600,
  notesThisWeek: 2,
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
  addNote: (note: Omit<Note, "id" | "createdAt" | "updatedAt">) => Note;

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
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // 侧边栏
  const [sidebar, setSidebar] = useState<SidebarState>({
    collapsed: false,
    selectedFolderId: null,
    expandedFolders: new Set(["1"]),
  });

  // 数据（暂用 mock）
  const [folders] = useState<Folder[]>(mockFolders);
  const [notes, setNotes] = useState<Note[]>(mockNotes);
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
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

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

  // 初始加载 AI 配置
  useEffect(() => {
    refreshAiConfigs();
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

  // 添加笔记
  const addNote = useCallback((noteData: Omit<Note, "id" | "createdAt" | "updatedAt">): Note => {
    const now = new Date();
    const newNote: Note = {
      ...noteData,
      id: `n${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };

    setNotes((prev) => [newNote, ...prev]);

    // 更新统计
    setStats((prev) => ({
      ...prev,
      totalNotes: prev.totalNotes + 1,
      notesThisWeek: prev.notesThisWeek + 1,
      lastActivityDate: now,
    }));

    return newNote;
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
    addNote,
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
