/**
 * 时间轴组件 - 显示高光片段在视频中的分布
 */

import { cn } from "../../../utils/cn";
import { calculateMarkerPosition, getHighlightTypeColor } from "../../../utils/highlightUtils";
import type { HighlightSegment } from "../../../types";

interface TimelineBarProps {
  highlights: HighlightSegment[];
  totalDuration: number;
  onMarkerClick: (highlight: HighlightSegment) => void;
  activeHighlightId?: string | null;
}

export function TimelineBar({
  highlights,
  totalDuration,
  onMarkerClick,
  activeHighlightId,
}: TimelineBarProps) {
  if (totalDuration <= 0) return null;

  return (
    <div className="relative w-full h-8 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden">
      {/* 背景进度条 */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-800" />
      
      {/* 高光标记 */}
      {highlights.map((highlight) => {
        const position = calculateMarkerPosition(highlight.start_time, totalDuration);
        const width = calculateMarkerPosition(highlight.end_time - highlight.start_time, totalDuration);
        const isActive = activeHighlightId === highlight.id;
        
        return (
          <button
            key={highlight.id}
            onClick={() => onMarkerClick(highlight)}
            className={cn(
              "absolute top-1 bottom-1 rounded cursor-pointer transition-all duration-200",
              "hover:opacity-100 hover:scale-y-110",
              getHighlightTypeColor(highlight.highlight_type),
              isActive ? "opacity-100 ring-2 ring-white dark:ring-slate-900 z-10" : "opacity-70"
            )}
            style={{
              left: `${position}%`,
              width: `${Math.max(width, 1)}%`,
              minWidth: "4px",
            }}
            title={`${highlight.content.slice(0, 50)}...`}
          />
        );
      })}

      {/* 时间刻度 */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 text-[10px] text-slate-400 dark:text-slate-500">
        <span>0:00</span>
        <span>{formatDuration(totalDuration)}</span>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
