/**
 * Context 统一导出
 * 提供所有 Context 的统一入口
 */

// 拆分后的 Context
export { SidebarProvider, useSidebar } from "./SidebarContext";
export { SettingsProvider, useSettings, LAYOUT_PANEL_WIDTH } from "./SettingsContext";
export { UploadProvider, useUpload } from "./UploadContext";
export { CollectionsProvider, useCollections } from "./CollectionsContext";
export { NotesProvider, useNotes } from "./NotesContext";
export { InitTaskQueueProvider, useInitTaskQueue } from "./InitTaskQueueContext";

// 兼容性导出 - 保持原有 AppContext 的 API
export { AppProvider, useApp } from "./AppContext";
