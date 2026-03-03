/**
 * 视频相关工具函数
 */

import { invoke } from "@tauri-apps/api/core";
import { VIDEO_MIME_TYPES } from "./constants";

/**
 * 根据文件路径获取 MIME 类型
 */
export function getVideoMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return VIDEO_MIME_TYPES[ext] || "video/mp4";
}

// Lazy-cached video server info
let cachedServerInfo: { port: number; token: string } | null = null;

/**
 * 获取本地视频服务器的端口和 access_token（带懒缓存）
 */
export async function getVideoServerInfo(): Promise<{
  port: number;
  token: string;
}> {
  if (cachedServerInfo) return cachedServerInfo;
  const [port, token] = await invoke<[number, string]>(
    "get_video_server_info"
  );
  cachedServerInfo = { port, token };
  return cachedServerInfo;
}

/**
 * 将本地文件路径转换为 localhost HTTP 视频服务器 URL
 */
export function toStreamUrl(
  filePath: string,
  port: number,
  token: string
): string {
  // Normalize backslashes to forward slashes
  const normalized = filePath.replace(/\\/g, "/");
  // Encode each segment but preserve /
  const encoded = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `http://127.0.0.1:${port}/${encoded}?access_token=${token}`;
}
