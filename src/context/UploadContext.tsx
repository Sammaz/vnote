/**
 * UploadContext - 上传状态管理
 * 从 AppContext 拆分，减少不必要的重渲染
 */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { UploadedFile, UploadedVideoItem } from "../types";

interface UploadContextType {
  uploadedItems: UploadedVideoItem[];
  addUploadedItems: (items: UploadedVideoItem[]) => void;
  removeUploadedItem: (index: number) => void;
  updateItemSubtitle: (index: number, subtitle: UploadedFile | null) => void;
  clearUploads: () => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadedItems, setUploadedItems] = useState<UploadedVideoItem[]>([]);

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
  }), [uploadedItems, addUploadedItems, removeUploadedItem, updateItemSubtitle, clearUploads]);

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return context;
}
