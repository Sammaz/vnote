/**
 * 视频视觉总结内容组件
 * 将原文细读的章节数据组装为 Markdown 格式并使用 ReactMarkdown 渲染展示
 */

import { useState, useMemo, useCallback } from "react";
import { Loader2, Copy, Download, Check, BarChart3 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChapterData, SubtitleEntry } from "../../types";
import { assembleChapterMarkdown } from "../../utils/markdownAssembler";
import { message } from "../../utils/message";

interface VisualSummaryContentProps {
  chapterData: ChapterData | null;
  // 字幕优化相关状态（从父组件传入，复用现有逻辑）
  optimizedSubtitles: Map<string, string>;
  originalSubtitles: SubtitleEntry[];
  subtitleOptimizing: boolean;
  subtitleOptimizationProgress: { current: number; total: number } | null;
}

export function VisualSummaryContent({
  chapterData,
  optimizedSubtitles,
  originalSubtitles,
  subtitleOptimizing,
  subtitleOptimizationProgress,
}: VisualSummaryContentProps) {
  const [copied, setCopied] = useState(false);

  // 组装 Markdown 内容
  const markdownContent = useMemo(() => {
    if (!chapterData || chapterData.chapters.length === 0) {
      return "";
    }
    return assembleChapterMarkdown({
      chapters: chapterData.chapters,
      optimizedSubtitles,
      originalSubtitles,
    });
  }, [chapterData, optimizedSubtitles, originalSubtitles]);

  // 复制 Markdown 内容到剪贴板
  const handleCopy = useCallback(async () => {
    if (!markdownContent) return;
    try {
      await navigator.clipboard.writeText(markdownContent);
      setCopied(true);
      message.success("已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[VisualSummaryContent] 复制失败:", error);
      message.error("复制失败");
    }
  }, [markdownContent]);

  // 导出 Markdown 文件
  const handleExport = useCallback(async () => {
    if (!markdownContent) return;
    try {
      const filePath = await save({
        defaultPath: "visual-summary.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, markdownContent);
        message.success("导出成功");
      }
    } catch (error) {
      console.error("[VisualSummaryContent] 导出失败:", error);
      message.error("导出失败");
    }
  }, [markdownContent]);

  // 空状态：无章节数据
  if (!chapterData || chapterData.chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-slate-400">
        <BarChart3 className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg mb-2">暂无视觉总结内容</p>
        <p className="text-sm text-center max-w-md">
          请先在「原文细读」标签页生成章节内容，然后返回此页面查看视觉化总结
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>共 {chapterData.chapters.length} 个章节</span>
          {subtitleOptimizing && subtitleOptimizationProgress && (
            <span className="flex items-center gap-1 text-blue-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              正在优化 {subtitleOptimizationProgress.current}/{subtitleOptimizationProgress.total} 章节
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={!markdownContent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="复制 Markdown"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            复制
          </button>
          <button
            onClick={handleExport}
            disabled={!markdownContent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="导出为 .md 文件"
          >
            <Download className="w-4 h-4" />
            导出
          </button>
        </div>
      </div>

      {/* Markdown 内容区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="note-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // 自定义 img 渲染：处理本地文件路径
              img: ({ src, alt, ...props }) => {
                return (
                  <img
                    src={src}
                    alt={alt}
                    {...props}
                    className="rounded-lg max-w-full"
                  />
                );
              },
            }}
          >
            {markdownContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
