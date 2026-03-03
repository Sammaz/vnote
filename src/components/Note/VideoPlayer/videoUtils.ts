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
 * 将本地文件路径转换为 stream 协议 URL
 * Windows WebView2 要求使用 http://<scheme>.localhost/ 格式
 */
export function toStreamUrl(filePath: string): string {
  // Normalize backslashes to forward slashes
  const normalized = filePath.replace(/\\/g, "/");
  // Encode each segment but preserve /
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `http://stream.localhost/${encoded}`;
}
