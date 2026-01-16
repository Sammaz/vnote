/**
 * 视频视觉总结内容组件
 * 将原文细读的章节数据组装为 Markdown 格式并使用 ReactMarkdown 渲染展示
 * 支持 Markdown 和思维导图两种视图模式
 */

import { useMemo, useEffect, forwardRef } from "react";
import { BarChart3 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChapterData, SubtitleEntry } from "../../types";
import { assembleChapterMarkdown } from "../../utils/markdownAssembler";
import { MindMapView, type MindMapViewRef } from "./MindMap";

/** 视觉化总结视图模式 */
export type VisualViewMode = "markdown" | "mindmap";

interface VisualSummaryContentProps {
  chapterData: ChapterData | null;
  optimizedSubtitles: Map<string, string>;
  originalSubtitles: SubtitleEntry[];
  isEditMode?: boolean;
  editContent?: string;
  onEditContentChange?: (content: string) => void;
  showTimestamp?: boolean;
  /** 视图模式：markdown 或 mindmap */
  viewMode?: VisualViewMode;
  /** 笔记标题（用于思维导图根节点） */
  noteTitle?: string;
  /** 已保存的思维导图数据（JSON 字符串） */
  savedMindMapData?: string | null;
}

export const VisualSummaryContent = forwardRef<MindMapViewRef, VisualSummaryContentProps>(function VisualSummaryContent({
  chapterData,
  optimizedSubtitles,
  originalSubtitles,
  isEditMode = false,
  editContent = "",
  onEditContentChange,
  showTimestamp = true,
  viewMode = "markdown",
  noteTitle = "思维导图",
  savedMindMapData,
}, ref) {
  // 组装 Markdown 内容
  const markdownContent = useMemo(() => {
    if (!chapterData || chapterData.chapters.length === 0) {
      return "";
    }
    return assembleChapterMarkdown({
      chapters: chapterData.chapters,
      optimizedSubtitles,
      originalSubtitles,
      showTimestamp,
    });
  }, [chapterData, optimizedSubtitles, originalSubtitles, showTimestamp]);

  // 当进入编辑模式且 editContent 为空时，初始化内容
  useEffect(() => {
    if (isEditMode && !editContent && markdownContent && onEditContentChange) {
      onEditContentChange(markdownContent);
    }
  }, [isEditMode, editContent, markdownContent, onEditContentChange]);

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

  // 思维导图模式
  if (viewMode === "mindmap") {
    return (
      <MindMapView ref={ref} chapterData={chapterData} noteTitle={noteTitle} savedMindMapData={savedMindMapData} />
    );
  }

  // 编辑模式（仅 Markdown 模式支持）
  if (isEditMode) {
    return (
      <div className="flex flex-col h-full">
        <textarea
          value={editContent}
          onChange={(e) => onEditContentChange?.(e.target.value)}
          className="flex-1 w-full p-4 bg-white dark:bg-vnote-bg text-slate-800 dark:text-slate-200 font-mono text-sm resize-none focus:outline-none border-none"
          placeholder="编辑 Markdown 内容..."
        />
      </div>
    );
  }

  // Markdown 预览模式
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="note-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
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
});
