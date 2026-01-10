import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { Folder, Note, AppStats, AiConfig, SidebarState } from "../types";

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

const mockAiConfigs: AiConfig[] = [
  {
    id: 1,
    title: "DeepSeek V3",
    base_url: "https://api.deepseek.com",
    api_key: "sk-***",
    model: "deepseek-chat",
    sort_order: 1,
  },
  {
    id: 2,
    title: "OpenAI GPT-4",
    base_url: "https://api.openai.com/v1",
    api_key: "sk-***",
    model: "gpt-4-turbo",
    sort_order: 2,
  },
];

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

  // 上传状态
  uploadedVideo: File | null;
  uploadedSubtitle: File | null;
  setUploadedVideo: (file: File | null) => void;
  setUploadedSubtitle: (file: File | null) => void;

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
  const [notes] = useState<Note[]>(mockNotes);
  const [stats] = useState<AppStats>(mockStats);
  const [aiConfigs] = useState<AiConfig[]>(mockAiConfigs);

  // 上传状态
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [uploadedSubtitle, setUploadedSubtitle] = useState<File | null>(null);

  // AI 模型
  const [selectedModelId, setSelectedModelId] = useState<number | null>(
    mockAiConfigs[0]?.id ?? null
  );

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);

  // 搜索
  const [searchQuery, setSearchQuery] = useState("");

  // 视图
  const [currentView, setCurrentView] = useState<"home" | "settings" | "note">("home");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

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
