/**
 * 视频视觉总结内容组件
 * 将原文细读的章节数据组装为 Markdown 格式并使用 ReactMarkdown 渲染展示
 */

import { useMemo, useEffect } from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { TableOfContents } from "./TableOfContents";
import { MarkdownRenderer } from "../Markdown/MarkdownRenderer";

interface VisualSummaryContentProps {
  isEditMode?: boolean;
  editContent?: string;
  onEditContentChange?: (content: string) => void;
  showTimestamp?: boolean;
  /** 已保存的 Markdown 编辑内容（用户编辑后保存的内容） */
  savedMarkdownContent?: string | null;
}

export function VisualSummaryContent({
  isEditMode = false,
  editContent = "",
  onEditContentChange,
  showTimestamp = true,
  savedMarkdownContent,
}: VisualSummaryContentProps) {
  const glassPanel = useGlassBg("panel");

  // 从数据库字段读取 Markdown 内容
  const markdownContent = useMemo(() => {
    return savedMarkdownContent || "";
  }, [savedMarkdownContent]);

  // 当进入编辑模式且 editContent 为空时，初始化内容
  useEffect(() => {
    if (isEditMode && !editContent && markdownContent && onEditContentChange) {
      onEditContentChange(markdownContent);
    }
  }, [isEditMode, editContent, markdownContent, onEditContentChange]);

  if (!markdownContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-slate-500">
        <BarChart3 className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg mb-2">暂无视觉总结内容</p>
        <p className="text-sm text-center max-w-md">
          请先在「原文细读」标签页生成章节内容，然后返回此页面查看视觉化总结
        </p>
      </div>
    );
  }

  // 编辑模式（仅 Markdown 模式支持）
  if (isEditMode) {
    return (
      <div className="flex flex-col h-full">
        <textarea
          value={editContent}
          onChange={(e) => onEditContentChange?.(e.target.value)}
          className={cn("flex-1 w-full p-4 text-slate-800 dark:text-slate-200 font-mono text-sm resize-none focus:outline-none border-none", glassPanel)}
          placeholder="编辑 Markdown 内容..."
        />
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-row group">
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 custom-scrollbar">
        <MarkdownRenderer
          content={markdownContent}
          variant="note"
          className={showTimestamp ? undefined : "hide-timestamps"}
          headingIdPrefix="viz"
          enableHeadingAnchors
          enableTimestampRanges
          enableHashtags
          centerImages
        />
      </div>
      <TableOfContents markdown={markdownContent} idPrefix="viz" />
    </div>
  );
}
