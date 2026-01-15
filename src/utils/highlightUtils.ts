/**
 * 高光笔记工具函数
 */

import type { HighlightSegment, HighlightType } from "../types";

/**
 * 格式化时间（秒 -> MM:SS 或 HH:MM:SS）
 */
export function formatTime(seconds: number): string {
  if (seconds < 0) return "00:00";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 根据评分获取颜色
 * 0-59: 灰色, 60-79: 蓝色, 80-89: 绿色, 90-100: 金色
 */
export function getScoreColor(score: number): {
  bg: string;
  text: string;
  border: string;
} {
  if (score >= 90) {
    return {
      bg: "bg-amber-100 dark:bg-amber-900/30",
      text: "text-amber-700 dark:text-amber-400",
      border: "border-amber-300 dark:border-amber-700",
    };
  }
  if (score >= 80) {
    return {
      bg: "bg-emerald-100 dark:bg-emerald-900/30",
      text: "text-emerald-700 dark:text-emerald-400",
      border: "border-emerald-300 dark:border-emerald-700",
    };
  }
  if (score >= 60) {
    return {
      bg: "bg-blue-100 dark:bg-blue-900/30",
      text: "text-blue-700 dark:text-blue-400",
      border: "border-blue-300 dark:border-blue-700",
    };
  }
  return {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-300 dark:border-slate-600",
  };
}

/**
 * 计算时间轴标记位置（百分比）
 */
export function calculateMarkerPosition(startTime: number, totalDuration: number): number {
  if (totalDuration <= 0) return 0;
  const position = (startTime / totalDuration) * 100;
  return Math.max(0, Math.min(100, position));
}

/**
 * 按高光类型过滤
 */
export function filterByType(
  highlights: HighlightSegment[],
  type: HighlightType
): HighlightSegment[] {
  return highlights.filter((h) => h.highlight_type === type);
}

/**
 * 按主题标签过滤（包含任意一个选中标签即可）
 */
export function filterByTags(
  highlights: HighlightSegment[],
  selectedTags: Set<string>
): HighlightSegment[] {
  if (selectedTags.size === 0) return highlights;
  return highlights.filter((h) =>
    h.topic_tags.some((tag) => selectedTags.has(tag))
  );
}

/**
 * 按开始时间排序
 */
export function sortByStartTime(highlights: HighlightSegment[]): HighlightSegment[] {
  return [...highlights].sort((a, b) => a.start_time - b.start_time);
}

/**
 * 获取高光类型的标记颜色
 */
export function getHighlightTypeColor(type: HighlightType): string {
  switch (type) {
    case "default":
      return "bg-blue-500";
    case "emotional":
      return "bg-rose-500";
    case "viral":
      return "bg-amber-500";
    default:
      return "bg-slate-500";
  }
}

/**
 * 获取高光类型的图标
 */
export function getHighlightTypeIcon(type: HighlightType): string {
  switch (type) {
    case "default":
      return "💡";
    case "emotional":
      return "❤️";
    case "viral":
      return "🔥";
    default:
      return "✨";
  }
}
