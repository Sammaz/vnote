import { memo } from "react";
import { cn } from "../../utils/cn";
import { formatTimestamp } from "./SubtitleRow";
import type { SubtitleEntry, ScreenshotMarker } from "../../types";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * SubtitleRowWithMarker 组件属性
 */
interface SubtitleRowWithMarkerProps {
  entry: SubtitleEntry;
  index: number;
  isActive: boolean;
  marker: ScreenshotMarker | null;
  onAddScreenshot: (index: number) => void;
  onRemoveScreenshot: (index: number) => void;
  onClick: () => void;
  isCapturing: boolean;
  videoAvailable: boolean;
}

/**
 * 带截图标记功能的字幕行组件
 * 
 * 功能：
 * - 显示时间戳和字幕文本
 * - 当 marker 为 null 时，显示"添加截图"按钮
 * - 当 marker 存在时，显示截图预览图和"删除截图"按钮
 * - 点击字幕行时调用 onClick（用于跳转视频）
 * - isActive 为 true 时高亮显示
 * - isCapturing 为 true 时禁用添加按钮并显示加载状态
 * - videoAvailable 为 false 时禁用添加按钮
 * 
 * Requirements: 3.1, 3.2, 3.3, 4.1, 4.3, 4.4
 */
export const SubtitleRowWithMarker = memo(function SubtitleRowWithMarker({
  entry,
  index,
  isActive,
  marker,
  onAddScreenshot,
  onRemoveScreenshot,
  onClick,
  isCapturing,
  videoAvailable,
}: SubtitleRowWithMarkerProps) {
  const hasBilingual = !!entry.second_language_text;

  // 点击字幕行跳转视频
  const handleRowClick = () => {
    // 派发 seek-video 事件跳转到对应时间
    window.dispatchEvent(
      new CustomEvent("seek-video", { detail: { time: entry.start_time } })
    );
    onClick();
  };

  // 添加截图
  const handleAddScreenshot = (e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡，避免触发行点击
    onAddScreenshot(index);
  };

  // 删除截图
  const handleRemoveScreenshot = (e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡，避免触发行点击
    onRemoveScreenshot(index);
  };

  // 判断添加按钮是否禁用
  const isAddButtonDisabled = !videoAvailable || isCapturing;

  // 获取禁用提示文本
  const getDisabledTooltip = () => {
    if (!videoAvailable) {
      return "视频未加载，无法添加截图";
    }
    if (isCapturing) {
      return "正在截图中...";
    }
    return "";
  };

  return (
    <div className="relative">
      {/* 截图标记区域 - 显示在字幕行上方 */}
      <div className="flex items-center justify-center py-2 border-b border-dashed border-slate-200 dark:border-slate-700">
        {marker ? (
          // 有截图标记时显示截图预览和删除按钮
          <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
            {/* 截图预览 */}
            <div className="relative group">
              <img
                src={convertFileSrc(marker.screenshot_path)}
                alt={`截图 - ${formatTimestamp(marker.timestamp)}`}
                className="h-16 w-auto rounded shadow-sm object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded" />
            </div>
            
            {/* 截图信息和删除按钮 */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                章节分隔点 · {formatTimestamp(marker.timestamp)}
              </span>
              <button
                onClick={handleRemoveScreenshot}
                className={cn(
                  "text-xs px-2 py-1 rounded transition-colors cursor-pointer",
                  "text-red-600 dark:text-red-400",
                  "hover:bg-red-50 dark:hover:bg-red-900/20",
                  "focus:outline-none focus:ring-2 focus:ring-red-500/50"
                )}
              >
                删除截图
              </button>
            </div>
          </div>
        ) : (
          // 无截图标记时显示添加按钮
          <button
            onClick={handleAddScreenshot}
            disabled={isAddButtonDisabled}
            title={getDisabledTooltip()}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full transition-all",
              "border border-dashed",
              isAddButtonDisabled
                ? "border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                : "border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer"
            )}
          >
            {isCapturing ? (
              <>
                {/* 加载动画 */}
                <svg
                  className="animate-spin h-3.5 w-3.5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>截图中...</span>
              </>
            ) : (
              <>
                {/* 相机图标 */}
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span>添加截图</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* 字幕行内容 */}
      <div
        id={`subtitle-row-${entry.index}`}
        onClick={handleRowClick}
        className={cn(
          "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
          "hover:bg-slate-100 dark:hover:bg-vnote-hover",
          isActive && "bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500"
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
    </div>
  );
});

export default SubtitleRowWithMarker;
