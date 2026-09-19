import { Loader2 } from "lucide-react";
import { useInitializationRuntime } from "../context/InitializationRuntimeContext";
import { getSubtitleIndicatorViewModel } from "../utils/subtitleGeneration";

export function SubtitleGenerationIndicator() {
  const { runtimeQueue, currentTask, subtitleProgress } = useInitializationRuntime();
  const view = getSubtitleIndicatorViewModel({
    currentTask,
    runtimeQueue,
    subtitleProgress,
  });

  if (!view.visible) {
    return null;
  }

  return (
    <div
      className="fixed right-5 bottom-5 z-50 w-72 rounded-lg border border-blue-200/80 bg-white/95 px-4 py-3 text-sm text-slate-700 shadow-lg backdrop-blur-sm dark:border-blue-500/30 dark:bg-vnote-card/95 dark:text-slate-200"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-blue-500 dark:text-blue-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">正在生成字幕</p>
            {view.percent !== null && (
              <p className="text-sm font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {view.percent}%
              </p>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{view.message}</p>
          {view.percent !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-300 ease-out"
                style={{ width: `${view.percent}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
