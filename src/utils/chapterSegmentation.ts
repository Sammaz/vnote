/**
 * 章节分段工具函数
 * 
 * 用于辅助模式下根据截图标记计算章节边界
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import type { SubtitleEntry, ScreenshotMarker, AssistModeChapterSegment } from "../types";

/**
 * 根据截图标记位置计算章节分段
 * 
 * 算法说明：
 * 1. 如果 markers 为空，返回单个分段包含所有字幕，screenshot_path = null
 * 2. 按 subtitle_index 对 markers 排序
 * 3. 遍历 markers，创建分段：
 *    - 每个 marker 位置作为新章节的起点
 *    - 前一个分段的结束位置是当前 marker 的 subtitle_index
 * 4. 处理第一段无标记的情况：screenshot_path = null（需要自动截图）
 * 5. 有标记的分段使用该标记的截图
 * 
 * @param subtitles - 字幕数组
 * @param markers - 截图标记数组（按 subtitle_index 排序）
 * @returns 章节分段数组
 * 
 * Requirements:
 * - 5.1: 截图标记作为章节分隔点
 * - 5.2: 从一个标记到下一个标记（不包含）为一个章节
 * - 5.3: 第一段无标记时 screenshot_path 为 null（需要自动截图）
 * - 5.4: 有用户截图的章节使用该截图作为封面
 */
export function calculateChapterSegments(
  subtitles: SubtitleEntry[],
  markers: ScreenshotMarker[]
): AssistModeChapterSegment[] {
  // 空字幕数组，返回空分段
  if (subtitles.length === 0) {
    return [];
  }

  // 如果 markers 为空，返回单个分段包含所有字幕
  // screenshot_path = null 表示需要自动截图
  if (markers.length === 0) {
    return [
      {
        start_index: 0,
        end_index: subtitles.length,
        screenshot_path: null,
        start_time: subtitles[0].start_time,
        end_time: subtitles[subtitles.length - 1].end_time,
      },
    ];
  }

  // 按 subtitle_index 排序 markers
  const sortedMarkers = [...markers].sort(
    (a, b) => a.subtitle_index - b.subtitle_index
  );

  const segments: AssistModeChapterSegment[] = [];

  // 检查第一个标记是否在索引 0
  const firstMarkerAtZero = sortedMarkers[0].subtitle_index === 0;

  // 如果第一个标记不在索引 0，创建第一个分段（无标记，需要自动截图）
  if (!firstMarkerAtZero) {
    segments.push({
      start_index: 0,
      end_index: sortedMarkers[0].subtitle_index,
      screenshot_path: null, // 第一段无标记，需要自动截图
      start_time: subtitles[0].start_time,
      end_time: subtitles[sortedMarkers[0].subtitle_index - 1].end_time,
    });
  }

  // 遍历每个 marker 创建分段
  // 每个分段从当前 marker 位置开始，到下一个 marker 位置（或字幕末尾）结束
  for (let i = 0; i < sortedMarkers.length; i++) {
    const marker = sortedMarkers[i];
    const nextMarker = sortedMarkers[i + 1];

    // 确定分段的结束位置
    const endIndex = nextMarker ? nextMarker.subtitle_index : subtitles.length;

    // 创建分段，使用当前 marker 的截图
    segments.push({
      start_index: marker.subtitle_index,
      end_index: endIndex,
      screenshot_path: marker.screenshot_path,
      start_time: subtitles[marker.subtitle_index].start_time,
      end_time: subtitles[endIndex - 1].end_time,
    });
  }

  return segments;
}

/**
 * 验证分段是否覆盖所有字幕
 * 
 * @param segments - 章节分段数组
 * @param subtitleCount - 字幕总数
 * @returns 是否完整覆盖
 */
export function validateSegmentsCoverage(
  segments: AssistModeChapterSegment[],
  subtitleCount: number
): boolean {
  if (segments.length === 0) {
    return subtitleCount === 0;
  }

  // 检查第一个分段从 0 开始
  if (segments[0].start_index !== 0) {
    return false;
  }

  // 检查最后一个分段到字幕末尾
  if (segments[segments.length - 1].end_index !== subtitleCount) {
    return false;
  }

  // 检查分段连续性（每个分段的 end_index 等于下一个分段的 start_index）
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].end_index !== segments[i + 1].start_index) {
      return false;
    }
  }

  return true;
}

/**
 * 获取需要自动截图的分段
 * 
 * @param segments - 章节分段数组
 * @returns 需要自动截图的分段索引数组
 */
export function getSegmentsNeedingAutoScreenshot(
  segments: AssistModeChapterSegment[]
): number[] {
  return segments
    .map((segment, index) => (segment.screenshot_path === null ? index : -1))
    .filter((index) => index !== -1);
}
