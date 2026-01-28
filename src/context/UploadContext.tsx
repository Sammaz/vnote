/**
 * UploadContext - 上传状态管理
 * 从 AppContext 拆分，减少不必要的重渲染
 */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { UploadedFile } from "../types";

/** 待初始化参数 */
export interface PendingInitializationParams {
  noteId: string;
  modelId: string;
  videoPath: string;
  subtitlePath: string | null;
}

interface UploadContextType {
  uploadedVideo: UploadedFile | null;
  uploadedSubtitle: UploadedFile | null;
  setUploadedVideo: (file: UploadedFile | null) => void;
  setUploadedSubtitle: (file: UploadedFile | null) => void;
  clearUploads: () => void;
  // 待初始化参数（创建笔记后传递给 NotePage）
  pendingInitialization: PendingInitializationParams | null;
  setPendingInitialization: (params: PendingInitializationParams | null) => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadedVideo, setUploadedVideo] = useState<UploadedFile | null>(null);
  const [uploadedSubtitle, setUploadedSubtitle] = useState<UploadedFile | null>(null);
  const [pendingInitialization, setPendingInitialization] = useState<PendingInitializationParams | null>(null);

  const clearUploads = useCallback(() => {
    setUploadedVideo(null);
    setUploadedSubtitle(null);
  }, []);

  const value = useMemo(() => ({
    uploadedVideo,
    uploadedSubtitle,
    setUploadedVideo,
    setUploadedSubtitle,
    clearUploads,
    pendingInitialization,
    setPendingInitialization,
  }), [uploadedVideo, uploadedSubtitle, clearUploads, pendingInitialization]);

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return context;
}
