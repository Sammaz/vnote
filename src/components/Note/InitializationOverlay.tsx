/**
 * 笔记初始化进度遮罩组件
 * 显示6步初始化进度，支持中止操作
 */

import { X, Check, SkipForward, AlertCircle, Loader2 } from "lucide-react";
import { InitializationState, StepStatus } from "../../types/noteInitialization";
import { cn } from "../../utils/cn";

interface InitializationOverlayProps {
  state: InitializationState;
  progress: number;
  onAbort: () => void;
}

// 步骤状态图标
function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return <Check className="w-4 h-4 text-green-500" />;
    case "skipped":
      return <SkipForward className="w-4 h-4 text-slate-400" />;
    case "failed":
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "running":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    default:
      return <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-600" />;
  }
}

// 步骤状态文本颜色
function getStepTextColor(status: StepStatus): string {
  switch (status) {
    case "completed":
      return "text-green-600 dark:text-green-400";
    case "skipped":
      return "text-slate-400";
    case "failed":
      return "text-red-600 dark:text-red-400";
    case "running":
      return "text-blue-600 dark:text-blue-400 font-medium";
    default:
      return "text-slate-500 dark:text-slate-400";
  }
}

export function InitializationOverlay({
  state,
  progress,
  onAbort,
}: InitializationOverlayProps) {
  if (!state.isInitializing && !state.error) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-[400px] max-w-[90vw]">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            正在初始化笔记数据
          </h3>
          <button
            onClick={onAbort}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="取消初始化"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* 进度条 */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-1">
            <span>进度</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 步骤列表 */}
        <div className="space-y-2 mb-4">
          {state.steps.map((step, index) => (
            <div
              key={step.step}
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg transition-colors",
                step.status === "running" && "bg-blue-50 dark:bg-blue-900/20"
              )}
            >
              <StepIcon status={step.status} />
              <div className="flex-1 min-w-0">
                <div className={cn("text-sm", getStepTextColor(step.status))}>
                  {step.name}
                </div>
                {step.status === "running" && step.message && (
                  <div className="text-xs text-slate-400 truncate">
                    {step.message}
                  </div>
                )}
                {step.status === "skipped" && step.reason && (
                  <div className="text-xs text-slate-400 truncate">
                    {step.reason}
                  </div>
                )}
                {step.status === "failed" && step.error && (
                  <div className="text-xs text-red-400 truncate">
                    {step.error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 错误信息 */}
        {state.error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg mb-4">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{state.error}</span>
            </div>
          </div>
        )}

        {/* 统计信息 */}
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            已完成 {state.completed}/{state.total}
            {state.skipped > 0 && ` · 跳过 ${state.skipped}`}
            {state.failed > 0 && ` · 失败 ${state.failed}`}
          </span>
          <button
            onClick={onAbort}
            className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
