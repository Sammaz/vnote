/**
 * AppContext - 统一的应用状态管理
 *
 * 架构优化说明：
 * 1. 内部使用拆分的 Provider 来管理不同领域的状态
 * 2. 对外通过 useApp() 提供统一的 API，保持向后兼容
 * 3. 各个拆分的 Context 可以独立使用，避免不必要的重渲染
 */
import { createContext, useContext, useMemo, useCallback, type ReactNode } from "react";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { SettingsProvider, useSettings } from "./SettingsContext";
import { UploadProvider, useUpload } from "./UploadContext";
import { CollectionsProvider, useCollections } from "./CollectionsContext";
import { NotesProvider, useNotes } from "./NotesContext";
import type {
  Folder,
  Note,
  AppStats,
  AiConfig,
  SidebarState,
  UploadedFile,
  UploadedVideoItem,
  CreateNoteRequest,
  UpdateNoteMetadataRequest,
  VideoToolbarSettings,
  PromptConfig,
  Collection,
  CreateCollectionRequest,
  ViewType,
} from "../types";

// Context 状态类型 - 保持原有 API
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
  updateNote: (req: UpdateNoteMetadataRequest) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  updateNoteSuggestedQuestions: (noteId: string, questions: string[]) => void;

  // 合集（资源库）
  collections: Collection[];
  selectedCollectionId: string | null;
  expandedCollections: Set<string>;
  refreshCollections: () => Promise<void>;
  createCollection: (req: CreateCollectionRequest) => Promise<Collection>;
  updateCollection: (collection: Collection) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  setSelectedCollection: (id: string | null) => void;
  toggleCollectionExpand: (id: string) => void;
  addNoteToCollection: (collectionId: string, noteId: string) => Promise<void>;
  removeNoteFromCollection: (collectionId: string, noteId: string) => Promise<void>;
  notesInCollections: Set<string>;
  updateCollectionsOrder: (collectionIds: string[]) => Promise<void>;

  // 批量操作
  batchSelection: { isSelecting: boolean; selectedNoteIds: Set<string> };
  setBatchSelecting: (isSelecting: boolean) => void;
  toggleNoteSelection: (noteId: string) => void;
  selectAllNotes: (noteIds: string[]) => void;
  clearSelection: () => void;
  batchRemoveFromCollection: (collectionId: string, noteIds: string[]) => Promise<void>;
  batchMoveToCollection: (fromCollectionId: string, toCollectionId: string, noteIds: string[]) => Promise<void>;
  batchDeleteNotes: (noteIds: string[]) => Promise<void>;

  // 上传状态
  uploadedItems: UploadedVideoItem[];
  addUploadedItems: (items: UploadedVideoItem[]) => void;
  removeUploadedItem: (index: number) => void;
  updateItemSubtitle: (index: number, subtitle: UploadedFile | null) => void;
  clearUploads: () => void;

  // AI 模型选择
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;

  // 生成状态
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;

  // 搜索
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // 当前视图
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;

  // 视频工具栏设置（全局）
  toolbarSettings: VideoToolbarSettings;
  setVideoVisible: (visible: boolean) => void;
  setAutoPlay: (autoPlay: boolean) => void;
  setLayoutSwapped: (swapped: boolean) => void;
  setLayoutPanelWidth: (width: number) => void;
  setCaptionsEnabled: (enabled: boolean) => void;

  // 累计观看时长
  addWatchTime: (seconds: number) => void;

  // 笔记初始化
  pendingInitialization: import("./UploadContext").PendingInitializationParams | null;
  setPendingInitialization: (params: import("./UploadContext").PendingInitializationParams | null) => void;
}

const AppContext = createContext<AppContextType | null>(null);

/**
 * 内部组件：组合所有拆分的 Context 值
 */
function AppContextBridge({ children }: { children: ReactNode }) {
  // 从各个拆分的 Context 获取状态和方法
  const sidebarContext = useSidebar();
  const settingsContext = useSettings();
  const uploadContext = useUpload();
  const collectionsContext = useCollections();
  const notesContext = useNotes();

  // 组合所有值 - 使用 useMemo 优化
  // 注意：依赖项使用整个 context 对象是合理的，因为：
  // 1. 各个子 Context 内部已使用 useCallback/useMemo 确保引用稳定
  // 2. 精细化列出 50+ 个属性会导致维护困难且容易遗漏
  // 3. 对于性能敏感场景，建议直接使用拆分的 hooks（useSidebar 等）
  const value: AppContextType = useMemo(() => ({
    // 侧边栏
    sidebar: sidebarContext.sidebar,
    toggleSidebar: sidebarContext.toggleSidebar,
    setSelectedFolder: sidebarContext.setSelectedFolder,
    toggleFolderExpand: sidebarContext.toggleFolderExpand,
    folders: sidebarContext.folders,

    // 笔记
    notes: notesContext.notes,
    refreshNotes: notesContext.refreshNotes,
    createNote: notesContext.createNote,
    updateNote: notesContext.updateNote,
    deleteNote: notesContext.deleteNote,
    updateNoteSuggestedQuestions: notesContext.updateNoteSuggestedQuestions,
    isGenerating: notesContext.isGenerating,
    setIsGenerating: notesContext.setIsGenerating,
    searchQuery: notesContext.searchQuery,
    setSearchQuery: notesContext.setSearchQuery,
    currentView: notesContext.currentView,
    setCurrentView: notesContext.setCurrentView,
    selectedNoteId: notesContext.selectedNoteId,
    setSelectedNoteId: notesContext.setSelectedNoteId,

    // 设置
    stats: settingsContext.stats,
    aiConfigs: settingsContext.aiConfigs,
    promptConfigs: settingsContext.promptConfigs,
    refreshAiConfigs: settingsContext.refreshAiConfigs,
    refreshPromptConfigs: settingsContext.refreshPromptConfigs,
    selectedModelId: settingsContext.selectedModelId,
    setSelectedModelId: settingsContext.setSelectedModelId,
    toolbarSettings: settingsContext.toolbarSettings,
    setVideoVisible: settingsContext.setVideoVisible,
    setAutoPlay: settingsContext.setAutoPlay,
    setLayoutSwapped: settingsContext.setLayoutSwapped,
    setLayoutPanelWidth: settingsContext.setLayoutPanelWidth,
    setCaptionsEnabled: settingsContext.setCaptionsEnabled,
    addWatchTime: settingsContext.addWatchTime,

    // 上传
    uploadedItems: uploadContext.uploadedItems,
    addUploadedItems: uploadContext.addUploadedItems,
    removeUploadedItem: uploadContext.removeUploadedItem,
    updateItemSubtitle: uploadContext.updateItemSubtitle,
    clearUploads: uploadContext.clearUploads,
    pendingInitialization: uploadContext.pendingInitialization,
    setPendingInitialization: uploadContext.setPendingInitialization,

    // 合集
    collections: collectionsContext.collections,
    selectedCollectionId: collectionsContext.selectedCollectionId,
    expandedCollections: collectionsContext.expandedCollections,
    notesInCollections: collectionsContext.notesInCollections,
    refreshCollections: collectionsContext.refreshCollections,
    createCollection: collectionsContext.createCollection,
    updateCollection: collectionsContext.updateCollection,
    deleteCollection: collectionsContext.deleteCollection,
    setSelectedCollection: collectionsContext.setSelectedCollection,
    toggleCollectionExpand: collectionsContext.toggleCollectionExpand,
    addNoteToCollection: collectionsContext.addNoteToCollection,
    removeNoteFromCollection: collectionsContext.removeNoteFromCollection,
    updateCollectionsOrder: collectionsContext.updateCollectionsOrder,

    // 批量操作
    batchSelection: collectionsContext.batchSelection,
    setBatchSelecting: collectionsContext.setBatchSelecting,
    toggleNoteSelection: collectionsContext.toggleNoteSelection,
    selectAllNotes: collectionsContext.selectAllNotes,
    clearSelection: collectionsContext.clearSelection,
    batchRemoveFromCollection: collectionsContext.batchRemoveFromCollection,
    batchMoveToCollection: collectionsContext.batchMoveToCollection,
    batchDeleteNotes: async (noteIds: string[]) => {
      await collectionsContext.batchDeleteNotes(noteIds, notesContext.refreshNotes);
    },
  }), [
    sidebarContext,
    settingsContext,
    uploadContext,
    collectionsContext,
    notesContext,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * 内部组件：连接 SettingsContext 和 NotesProvider
 * 用于将 setStats 传递给 NotesProvider
 */
function NotesProviderWithStats({ children }: { children: ReactNode }) {
  const { setStats } = useSettings();

  const handleStatsUpdate = useCallback((partialStats: Partial<AppStats>) => {
    setStats(prev => ({ ...prev, ...partialStats }));
  }, [setStats]);

  return (
    <NotesProvider onStatsUpdate={handleStatsUpdate}>
      {children}
    </NotesProvider>
  );
}

/**
 * AppProvider - 嵌套所有拆分的 Provider
 * 顺序很重要：外层 Provider 可以被内层访问
 */
export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <SettingsProvider>
        <UploadProvider>
          <NotesProviderWithStats>
            <CollectionsProvider>
              <AppContextBridge>
                {children}
              </AppContextBridge>
            </CollectionsProvider>
          </NotesProviderWithStats>
        </UploadProvider>
      </SettingsProvider>
    </SidebarProvider>
  );
}

/**
 * useApp - 统一的 hook，保持向后兼容
 *
 * 注意：对于性能敏感的组件，建议直接使用拆分的 hooks：
 * - useSidebar() - 侧边栏状态
 * - useSettings() - 设置和配置
 * - useUpload() - 上传状态
 * - useCollections() - 合集和批量操作
 * - useNotes() - 笔记数据和视图状态
 */
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}

// 导出拆分的 hooks，方便组件逐步迁移
export { useSidebar } from "./SidebarContext";
export { useSettings } from "./SettingsContext";
export { useUpload } from "./UploadContext";
export { useCollections } from "./CollectionsContext";
export { useNotes } from "./NotesContext";
