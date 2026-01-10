/**
 * VNote 数据类型定义
 */

// 文件夹
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 笔记
export interface Note {
  id: string;
  folderId: string;
  title: string;
  videoPath: string;
  subtitlePath: string | null;
  thumbnailPath: string | null;
  content: string; // AI 生成的 markdown 内容
  duration: number; // 视频时长（秒）
  createdAt: Date;
  updatedAt: Date;
}

// 应用统计
export interface AppStats {
  totalNotes: number;
  totalWatchTime: number; // 秒
  notesThisWeek: number;
  lastActivityDate: Date | null;
}

// AI 配置（与 SettingsPage 共享）
export interface AiConfig {
  id: number;
  title: string;
  base_url: string;
  api_key: string;
  model: string;
  sort_order: number;
}

// 上传文件信息
export interface UploadedFile {
  file: File;
  path: string;
  type: "video" | "subtitle";
}

// 侧边栏状态
export interface SidebarState {
  collapsed: boolean;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
}

// 视图类型
export type ViewType = "home" | "settings" | "note";
