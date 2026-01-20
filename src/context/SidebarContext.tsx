/**
 * SidebarContext - 侧边栏状态管理
 * 从 AppContext 拆分，减少不必要的重渲染
 */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { Folder, SidebarState } from "../types";

// Mock 数据 - 文件夹暂时保留
const mockFolders: Folder[] = [
  { id: "1", name: "学习笔记", parentId: null, createdAt: new Date(), updatedAt: new Date() },
  { id: "2", name: "工作资料", parentId: null, createdAt: new Date(), updatedAt: new Date() },
  { id: "3", name: "React 教程", parentId: "1", createdAt: new Date(), updatedAt: new Date() },
];

interface SidebarContextType {
  sidebar: SidebarState;
  folders: Folder[];
  toggleSidebar: () => void;
  setSelectedFolder: (folderId: string | null) => void;
  toggleFolderExpand: (folderId: string) => void;
  clearFolderSelection: () => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [sidebar, setSidebar] = useState<SidebarState>({
    collapsed: false,
    selectedFolderId: null,
    expandedFolders: new Set(["1"]),
  });

  const [folders] = useState<Folder[]>(mockFolders);

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

  const clearFolderSelection = useCallback(() => {
    setSidebar((prev) => ({ ...prev, selectedFolderId: null }));
  }, []);

  const value = useMemo(() => ({
    sidebar,
    folders,
    toggleSidebar,
    setSelectedFolder,
    toggleFolderExpand,
    clearFolderSelection,
  }), [sidebar, folders, toggleSidebar, setSelectedFolder, toggleFolderExpand, clearFolderSelection]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
