/**
 * 高光工具栏组件 - 类型切换和重新生成
 */

import { RefreshCw, Loader2 } from "lucide-react";
import { cn } from "../../../utils/cn";
import type { HighlightType } from "../../../types";
import { HIGHLIGHT_TYPE_LABELS, HIGHLIGHT_TYPE_DESCRIPTIONS } from "../../../types";

interface HighlightToolbarProps {
  activeType: HighlightType;
  onTypeChange: (type: HighlightType) => void;
  onRegenerate: () => void;
  isGenerating: boolean;
  highlightCount: number;
}

const HIGHLIGHT_TYPES: HighlightType[] = ["default", "emotional", "viral"];

export function HighlightToolbar({
  activeType,
  onTypeChange,
  onRegenerate,
  isGenerating,
  highlightCount,
}: HighlightToolbarProps) {
  return (
    <div className="space-y-3">
      {/* 类型切换标签页 */}
      <div className="flex items-center gap-2">
        <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {HIGHLIGHT_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => onTypeChange(type)}
              disabled={isGenerating}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 cursor-pointer",
                activeType === type
                  ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200",
                isGenerating && "opacity-50 cursor-not-allowed"
              )}
            >
              {HIGHLIGHT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        {/* 重新生成按钮 */}
        <button
          onClick={onRegenerate}
          disabled={isGenerating}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all cursor-pointer",
            "bg-blue-500 hover:bg-blue-600 text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              重新生成
            </>
          )}
        </button>

        {/* 高光数量 */}
        {highlightCount > 0 && !isGenerating && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            共 {highlightCount} 个高光
          </span>
        )}
      </div>

      {/* 类型描述 */}
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        {HIGHLIGHT_TYPE_DESCRIPTIONS[activeType]}
      </p>
    </div>
  );
}
