/**
 * 高光卡片组件 - 显示单个高光片段
 */

import { Play } from "lucide-react";
import { cn } from "../../../utils/cn";
import { formatTime, getScoreColor, getHighlightTypeIcon } from "../../../utils/highlightUtils";
import type { HighlightSegment } from "../../../types";

interface HighlightCardProps {
  highlight: HighlightSegment;
  index: number;
  onClick: () => void;
  isActive?: boolean;
}

export function HighlightCard({
  highlight,
  index,
  onClick,
  isActive = false,
}: HighlightCardProps) {
  const scoreColors = getScoreColor(highlight.score);
  const typeIcon = getHighlightTypeIcon(highlight.highlight_type);

  return (
    <div
      id={`highlight-${highlight.id}`}
      onClick={onClick}
      className={cn(
        "group relative p-3 rounded-lg border cursor-pointer transition-all duration-200",
        "hover:shadow-sm hover:border-blue-300 dark:hover:border-blue-600",
        isActive
          ? "border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 shadow-sm"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
      )}
    >
      {/* 序号和类型图标 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
            #{index + 1}
          </span>
          <span className="text-sm">{typeIcon}</span>
        </div>
        
        {/* 评分徽章 */}
        <div
          className={cn(
            "px-2 py-0.5 rounded-full text-xs font-semibold",
            scoreColors.bg,
            scoreColors.text
          )}
        >
          {highlight.score}分
        </div>
      </div>

      {/* 内容 */}
      <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-3 mb-3">
        {highlight.content}
      </p>

      {/* 底部信息 */}
      <div className="flex items-center justify-between">
        {/* 时间戳 */}
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <Play className="w-3 h-3" />
          <span>{formatTime(highlight.start_time)}</span>
          <span>-</span>
          <span>{formatTime(highlight.end_time)}</span>
        </div>

        {/* 主题标签 */}
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {highlight.topic_tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
            >
              {tag}
            </span>
          ))}
          {highlight.topic_tags.length > 2 && (
            <span className="text-[10px] text-slate-400">
              +{highlight.topic_tags.length - 2}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
