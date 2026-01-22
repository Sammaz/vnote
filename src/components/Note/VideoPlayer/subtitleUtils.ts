/**
 * 字幕格式转换工具
 */

import { ASS_BASE_MARGIN_V, ASS_LINE_HEIGHT, ASS_MIN_MARGIN_GAP } from "./constants";

/**
 * 将 SRT 内容转换为 WebVTT
 */
export function convertSrtToVtt(content: string): string {
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const lines = normalized.split("\n");
  const output: string[] = ["WEBVTT", ""];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      continue;
    }

    if (line.includes("-->")) {
      output.push(
        line.replace(/(\d{2}:\d{2}:\d{2})[,.](\d{3})/g, "$1.$2")
      );
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

/**
 * 预处理 ASS 字幕内容，修复双语字幕位置重叠问题
 *
 * 双语字幕通常使用两个不同的 Style，但有时它们的 MarginV（垂直边距）相同，
 * 导致两种语言的字幕重叠在一起。此函数检测并调整样式，确保双语字幕正确分层显示。
 */
export function preprocessAssForBilingual(content: string): string {
  const lines = content.split(/\r?\n/);
  const styleLines: { index: number; line: string; name: string; marginV: number }[] = [];
  let marginVIndex = -1;
  let nameIndex = -1;
  let alignmentIndex = -1;

  // 第一遍：找到 Format 行和所有 Style 行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("Format:") && lines[i - 1]?.includes("[V4+ Styles]")) {
      // 解析 Format 字段顺序
      const fields = line.substring(7).split(",").map(f => f.trim().toLowerCase());
      marginVIndex = fields.indexOf("marginv");
      nameIndex = fields.indexOf("name");
      alignmentIndex = fields.indexOf("alignment");
    }

    if (line.startsWith("Style:")) {
      const parts = line.substring(6).split(",").map(p => p.trim());
      const name = nameIndex >= 0 ? parts[nameIndex] : parts[0];
      const marginV = marginVIndex >= 0 ? parseInt(parts[marginVIndex], 10) || 0 : 0;
      styleLines.push({ index: i, line, name, marginV });
    }
  }

  // 如果只有一个样式或没有样式，不需要处理
  if (styleLines.length <= 1 || marginVIndex < 0) {
    return content;
  }

  // 检测是否存在位置冲突（多个样式有相同或相近的 MarginV）
  const marginVValues = styleLines.map(s => s.marginV);
  const uniqueMarginV = new Set(marginVValues);

  // 如果所有样式的 MarginV 都不同，且差距足够大，不需要处理
  if (uniqueMarginV.size === styleLines.length) {
    const sortedMargins = [...marginVValues].sort((a, b) => a - b);
    const minGap = Math.min(...sortedMargins.slice(1).map((v, i) => v - sortedMargins[i]));
    if (minGap >= ASS_MIN_MARGIN_GAP) {
      return content;
    }
  }

  // 调整样式：为每个样式设置不同的 MarginV
  // 第一个样式是副语言（上方，较大的 MarginV），第二个是主语言（底部，较小的 MarginV）
  const newLines = [...lines];
  const totalStyles = styleLines.length;

  styleLines.forEach((style, idx) => {
    const parts = lines[style.index].substring(6).split(",");

    // 计算新的 MarginV：反转顺序，第一个样式在上方，最后一个样式在底部
    const newMarginV = ASS_BASE_MARGIN_V + (totalStyles - 1 - idx) * ASS_LINE_HEIGHT;
    parts[marginVIndex] = String(newMarginV);

    // 确保对齐方式为底部居中（2）
    if (alignmentIndex >= 0) {
      parts[alignmentIndex] = "2";
    }

    newLines[style.index] = "Style:" + parts.join(",");
  });

  return newLines.join("\n");
}

/**
 * 检查是否是 TS 格式
 */
export function isTsFormat(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".ts");
}

/**
 * 判断字幕类型
 */
export function getSubtitleType(subtitleUrl: string | null | undefined): {
  isAss: boolean;
  isSrt: boolean;
  isVtt: boolean;
  hasSubtitle: boolean;
} {
  const isAss = subtitleUrl ? /\.(ass|ssa)$/i.test(subtitleUrl) : false;
  const isSrt = subtitleUrl ? /\.srt$/i.test(subtitleUrl) : false;
  const isVtt = subtitleUrl ? /\.(vtt|webvtt)$/i.test(subtitleUrl) : false;
  return {
    isAss,
    isSrt,
    isVtt,
    hasSubtitle: isAss || isSrt || isVtt,
  };
}
