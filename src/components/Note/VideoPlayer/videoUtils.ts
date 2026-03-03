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

/**
 * 将本地文件路径转换为 video-stream 自定义协议 URL
 */
export function toStreamUrl(filePath: string): string {
  // Normalize backslashes to forward slashes
  const normalized = filePath.replace(/\\/g, "/");
  // Encode each segment but preserve /
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `http://video-stream.localhost/${encoded}`;
}
