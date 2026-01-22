/**
 * 初始化队列面板组件
 * 显示当前执行的任务和等待队列
 */

import { X, Loader2, Check, AlertCircle, Clock, XCircle } from "lucide-react";
import { useInitializationQueue } from "../../context/InitializationQueueContext";
import { INITIALIZATION_STEPS } from "../../types/noteInitialization";

export function InitializationQueuePanel() {
  const {
    queue,
    currentTask,
    initState,
    initProgress,
    abortCurrent,
    removeFromQueue,
    clearQueue,
  } = useInitializationQueue();

  // 无任务时不显示
  if (!currentTask && queue.length === 0) {
    return null;
  }

  // 获取当前步骤名称
  const currentStepName =
    initState.currentStepIndex >= 0 && initState.currentStepIndex < INITIALIZATION_STEPS.length
      ? INITIALIZATION_STEPS[initState.currentStepIndex].name
      : "";

  // 获取当前步骤的消息
  const currentStepMessage =
    initState.currentStepIndex >= 0 && initState.steps[initState.currentStepIndex]?.message;

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-600">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            初始化队列
          </span>
        </div>
        {queue.length > 0 && (
          <button
            onClick={clearQueue}
            className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            清空队列
          </button>
        )}
      </div>

      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
        {/* 当前任务 */}
        {currentTask && (
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {currentTask.status === "running" && (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
                  )}
                  {currentTask.status === "completed" && (
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                  )}
                  {currentTask.status === "failed" && (
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  )}
                  {currentTask.status === "aborted" && (
                    <XCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                    {currentTask.params.noteTitle}
                  </span>
                </div>
                {currentTask.status === "running" && currentStepMessage && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {currentStepMessage}
                  </p>
                )}
              </div>
              {currentTask.status === "running" && (
                <button
                  onClick={abortCurrent}
                  className="ml-2 p-1 text-slate-400 hover:text-red-500 transition-colors"
                  title="取消"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* 进度条 */}
            {currentTask.status === "running" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    {currentStepName}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    {initProgress}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300 ease-out"
                    style={{ width: `${initProgress}%` }}
                  />
                </div>

                {/* 步骤列表 */}
                <div className="mt-3 space-y-1.5">
                  {initState.steps.map((step, index) => (
                    <div key={step.step} className="flex items-center gap-2 text-xs">
                      {step.status === "pending" && (
                        <div className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-500" />
                      )}
                      {step.status === "running" && (
                        <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                      )}
                      {step.status === "completed" && (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      )}
                      {step.status === "skipped" && (
                        <div className="w-3.5 h-3.5 rounded-full bg-slate-300 dark:bg-slate-500" />
                      )}
                      {step.status === "failed" && (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                      )}
                      <span
                        className={`${
                          step.status === "running"
                            ? "text-blue-600 dark:text-blue-400 font-medium"
                            : step.status === "completed"
                            ? "text-green-600 dark:text-green-400"
                            : step.status === "failed"
                            ? "text-red-600 dark:text-red-400"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {step.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 完成状态 */}
            {currentTask.status === "completed" && (
              <p className="text-xs text-green-600 dark:text-green-400">
                已完成 {initState.completed}/{initState.total} 个步骤
              </p>
            )}

            {/* 失败状态 */}
            {currentTask.status === "failed" && initState.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{initState.error}</p>
            )}
          </div>
        )}

        {/* 等待队列 */}
        {queue.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span>等待中 ({queue.length})</span>
            </div>
            <div className="space-y-1">
              {queue.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between py-1.5 px-2 bg-slate-50 dark:bg-slate-700/50 rounded text-xs"
                >
                  <span className="text-slate-600 dark:text-slate-300 truncate flex-1">
                    {task.params.noteTitle}
                  </span>
                  <button
                    onClick={() => removeFromQueue(task.id)}
                    className="ml-2 p-0.5 text-slate-400 hover:text-red-500 transition-colors"
                    title="移除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部统计 */}
      {currentTask && currentTask.status === "running" && (
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-700/50 border-t border-slate-200 dark:border-slate-600">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            已完成 {initState.completed + initState.skipped}/{initState.total}
            {queue.length > 0 && ` · 队列中还有 ${queue.length} 个任务`}
          </p>
        </div>
      )}
    </div>
  );
}
