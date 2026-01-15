/**
 * Markdown 组装工具函数
 * 将原文细读的章节数据组装为 Markdown 格式字符串
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import type { Chapter, SubtitleEntry } from "../types";

/**
 * 格式化时间（秒）为 MM:SS 或 HH:MM:SS 格式
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 获取章节对应的原始字幕文本
 * 将章节时间范围内的字幕条目拼接为一段文本
 */
export function getChapterSubtitles(
  chapter: Chapter,
  subtitles: SubtitleEntry[]
): string {
  if (!subtitles || subtitles.length === 0) {
    return "";
  }

  // 过滤出当前章节时间范围内的字幕
  const filtered = subtitles.filter(
    (sub) => sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
  );

  if (filtered.length === 0) {
    return "";
  }

  // 检查是否有双语字幕
  const hasBilingual = filtered.some((sub) => sub.second_language_text);

  if (hasBilingual) {
    // 双语字幕：只取中文部分（主语言）
    return filtered.map((sub) => sub.text).join(" ");
  } else {
    // 单语字幕：直接拼接
    return filtered.map((sub) => sub.text).join(" ");
  }
}

/**
 * 组装单个章节的 Markdown 内容
 */
export function assembleChapterSection(
  chapter: Chapter,
  _index: number,
  optimizedSubtitle: string | undefined,
  originalSubtitles: SubtitleEntry[]
): string {
  const lines: string[] = [];

  // 1. 章节标题（带时间戳）
  const timeRange = `${formatTime(chapter.start_time)} - ${formatTime(chapter.end_time)}`;
  lines.push(`# ${chapter.title} (${timeRange})`);
  lines.push("");

  // 2. 截图（如果有）
  if (chapter.screenshot_path) {
    try {
      const imageUrl = convertFileSrc(chapter.screenshot_path);
      lines.push(`![${chapter.title}](${imageUrl})`);
      lines.push("");
    } catch (error) {
      console.error(`[assembleChapterSection] 转换截图路径失败:`, error);
    }
  }

  // 3. 字幕内容（优先使用优化后的字幕）
  let subtitleContent = "";
  if (optimizedSubtitle && optimizedSubtitle.trim()) {
    subtitleContent = optimizedSubtitle;
  } else {
    // 回退到原始字幕
    subtitleContent = getChapterSubtitles(chapter, originalSubtitles);
  }

  if (subtitleContent.trim()) {
    lines.push(subtitleContent);
    lines.push("");
  }

  // 4. 分隔线（除了最后一个章节）
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

/**
 * 组装选项接口
 */
export interface AssembleMarkdownOptions {
  chapters: Chapter[];
  optimizedSubtitles: Map<string, string>;
  originalSubtitles: SubtitleEntry[];
}

/**
 * 将章节数据组装为完整的 Markdown 字符串
 */
export function assembleChapterMarkdown(options: AssembleMarkdownOptions): string {
  const { chapters, optimizedSubtitles, originalSubtitles } = options;

  if (!chapters || chapters.length === 0) {
    return "";
  }

  const sections = chapters.map((chapter, index) => {
    const optimizedSubtitle = optimizedSubtitles.get(chapter.id);
    return assembleChapterSection(chapter, index, optimizedSubtitle, originalSubtitles);
  });

  // 移除最后一个分隔线
  let result = sections.join("");
  if (result.endsWith("---\n\n")) {
    result = result.slice(0, -5);
  }

  return result.trim();
}

/**
 * 检查哪些章节缺少优化字幕
 * 返回需要优化的章节 ID 列表
 */
export function getChaptersNeedingOptimization(
  chapters: Chapter[],
  optimizedSubtitles: Map<string, string>,
  originalSubtitles: SubtitleEntry[]
): string[] {
  if (!chapters || chapters.length === 0) {
    return [];
  }

  return chapters
    .filter((chapter) => {
      // 已有优化字幕，不需要优化
      if (optimizedSubtitles.has(chapter.id)) {
        return false;
      }
      // 检查是否有原始字幕可供优化
      const hasOriginalSubtitle = getChapterSubtitles(chapter, originalSubtitles).trim().length > 0;
      return hasOriginalSubtitle;
    })
    .map((chapter) => chapter.id);
}
