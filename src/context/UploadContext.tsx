/**
 * UploadContext - 上传状态管理
 * 从 AppContext 拆分，减少不必要的重渲染
 */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { UploadedFile, UploadedVideoItem } from "../types";

/** 待初始化参数 */
export interface PendingInitializationParams {
  noteId: string;
  modelId: string;
  videoPath: string;
  subtitlePath: string | null;
}

interface UploadContextType {
  uploadedItems: UploadedVideoItem[];
  addUploadedItems: (items: UploadedVideoItem[]) => void;
  removeUploadedItem: (index: number) => void;
  updateItemSubtitle: (index: number, subtitle: UploadedFile | null) => void;
  clearUploads: () => void;
  // 待初始化参数（创建笔记后传递给 NotePage）
  pendingInitialization: PendingInitializationParams | null;
  setPendingInitialization: (params: PendingInitializationParams | null) => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadedItems, setUploadedItems] = useState<UploadedVideoItem[]>([]);
  const [pendingInitialization, setPendingInitialization] = useState<PendingInitializationParams | null>(null);

  const addUploadedItems = useCallback((items: UploadedVideoItem[]) => {
    setUploadedItems(prev => {
      const existingPaths = new Set(prev.map(i => i.video.path));
      const newItems = items.filter(i => !existingPaths.has(i.video.path));
      return [...prev, ...newItems];
    });
  }, []);

  const removeUploadedItem = useCallback((index: number) => {
    setUploadedItems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateItemSubtitle = useCallback((index: number, subtitle: UploadedFile | null) => {
    setUploadedItems(prev => prev.map((item, i) =>
      i === index ? { ...item, subtitle } : item
    ));
  }, []);

  const clearUploads = useCallback(() => {
    setUploadedItems([]);
  }, []);

  const value = useMemo(() => ({
    uploadedItems,
    addUploadedItems,
    removeUploadedItem,
    updateItemSubtitle,
    clearUploads,
    pendingInitialization,
    setPendingInitialization,
  }), [uploadedItems, addUploadedItems, removeUploadedItem, updateItemSubtitle, clearUploads, pendingInitialization]);

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return context;
}
