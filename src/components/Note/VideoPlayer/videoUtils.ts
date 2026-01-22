/**
 * 视频相关工具函数
 */

import { VIDEO_MIME_TYPES } from "./constants";

/**
 * 根据文件路径获取 MIME 类型
 */
export function getVideoMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return VIDEO_MIME_TYPES[ext] || "video/mp4";
}
