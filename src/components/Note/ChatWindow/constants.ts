/**
 * ChatWindow 常量定义
 */

// 最小和最大尺寸限制
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 400;
export const MAX_WIDTH = 800;
export const MAX_HEIGHT = 900;

// 默认窗口尺寸
export const DEFAULT_WIDTH = 420;
export const DEFAULT_HEIGHT = 550;

// 支持的图片类型
export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,image/tiff,image/heic,image/heif,image/avif";

// 调整大小方向类型
export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;
