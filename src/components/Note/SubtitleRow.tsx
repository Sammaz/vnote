import { memo } from "react";
import { cn } from "../../utils/cn";
import type { SubtitleEntry } from "../../types";

/**
 * 格式化时间戳为 MM:SS 或 HH:MM:SS 格式
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

interface SubtitleRowProps {
  entry: SubtitleEntry;
  isActive: boolean;
  onClick: () => void;
}

/**
 * 单条字幕行组件
 * - 显示时间戳和文本
 * - 支持双语字幕（主语言青色，副语言黄色）
 * - 支持高亮当前播放行
 * - 点击跳转到对应时间
 */
export const SubtitleRow = memo(function SubtitleRow({
  entry,
  isActive,
  onClick,
}: SubtitleRowProps) {
  const hasBilingual = !!entry.second_language_text;

  const handleClick = () => {
    // 派发 seek-video 事件跳转到对应时间
    window.dispatchEvent(
      new CustomEvent("seek-video", { detail: { time: entry.start_time } })
    );
    onClick();
  };

  return (
    <div
      id={`subtitle-row-${entry.index}`}
      onClick={handleClick}
      className={cn(
        "flex items-start gap-3 px-4 py-2 cursor-pointer transition-colors rounded-lg",
        "hover:bg-slate-100 dark:hover:bg-vnote-hover",
        isActive && "bg-blue-50 dark:bg-blue-900/20"
      )}
    >
      {/* 时间戳 */}
      <span className="text-sm font-mono text-blue-500 dark:text-blue-400 flex-shrink-0 w-16">
        {formatTimestamp(entry.start_time)}
      </span>

      {/* 字幕文本 */}
      <div className="flex-1 min-w-0">
        {/* 主语言文本 */}
        <p
          className={cn(
            "text-sm leading-relaxed break-words",
            hasBilingual
              ? "text-cyan-600 dark:text-cyan-400"
              : "text-slate-700 dark:text-slate-300"
          )}
        >
          {entry.text}
        </p>

        {/* 副语言文本（如果存在） */}
        {hasBilingual && (
          <p className="text-sm leading-relaxed break-words mt-1 text-amber-600 dark:text-amber-400">
            {entry.second_language_text}
          </p>
        )}
      </div>
    </div>
  );
});
