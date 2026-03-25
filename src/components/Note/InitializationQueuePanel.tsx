/**
 * 初始化队列面板组件
 * 显示当前执行的任务和等待队列
 * 支持拖拽移动和最小化
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, AlertCircle, Clock, XCircle, Minus } from "lucide-react";
import { useInitializationQueue } from "../../context/InitializationQueueContext";
import { INITIALIZATION_STEPS } from "../../types/noteInitialization";

// 面板尺寸常量
const PANEL_WIDTH = 320;
const PANEL_HEIGHT_ESTIMATE = 400;
const MINIMIZED_SIZE = 48;
const STORAGE_KEY = "vnote-queue-panel-state";

// 持久化状态类型
interface PanelState {
  x: number;
  y: number;
  isMinimized: boolean;
}

// 加载持久化状态
function loadPanelState(): PanelState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return null;
}

// 保存持久化状态
function savePanelState(state: PanelState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

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

  // 最小化状态
  const [isMinimized, setIsMinimized] = useState(() => {
    const saved = loadPanelState();
    return saved?.isMinimized ?? false;
  });

  // 位置状态（初始化为右下角）
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const saved = loadPanelState();
    if (saved) {
      return { x: saved.x, y: saved.y };
    }
    // 默认右下角 - 根据初始最小化状态计算
    const savedMinimized = loadPanelState()?.isMinimized ?? false;
    const width = savedMinimized ? MINIMIZED_SIZE : PANEL_WIDTH;
    const height = savedMinimized ? MINIMIZED_SIZE : PANEL_HEIGHT_ESTIMATE;
    return {
      x: window.innerWidth - width - 16,
      y: window.innerHeight - height - 16,
    };
  });

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // 获取实际面板高度
  const getActualHeight = useCallback(() => {
    if (isMinimized) return MINIMIZED_SIZE;
    return panelRef.current?.getBoundingClientRect().height || 300;
  }, [isMinimized]);

  // 计算当前面板尺寸
  const currentWidth = isMinimized ? MINIMIZED_SIZE : PANEL_WIDTH;

  // 约束位置在视口内
  const constrainPosition = useCallback(
    (x: number, y: number, width: number) => {
      const height = getActualHeight();
      return {
        x: Math.max(0, Math.min(x, window.innerWidth - width)),
        y: Math.max(0, Math.min(y, window.innerHeight - height)),
      };
    },
    [getActualHeight]
  );

  // 拖拽开始
  const handleMouseDown = (e: React.MouseEvent) => {
    // 阻止文本选择
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setIsDragging(true);
    }
  };

  // 拖拽移动和结束
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      const constrained = constrainPosition(newX, newY, currentWidth);
      setPosition(constrained);
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      // 判断是否为点击（移动距离小于 5px）
      const distance = Math.sqrt(
        Math.pow(e.clientX - dragStartPos.x, 2) + Math.pow(e.clientY - dragStartPos.y, 2)
      );
      if (distance < 5 && isMinimized) {
        // 点击最小化指示器时展开
        toggleMinimize(false);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, dragStartPos, currentWidth, constrainPosition, isMinimized]);

  // 窗口缩放处理
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => constrainPosition(prev.x, prev.y, currentWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentWidth, constrainPosition]);

  // 持久化状态
  useEffect(() => {
    savePanelState({ x: position.x, y: position.y, isMinimized });
  }, [position, isMinimized]);

  // 首次渲染后调整位置到右下角
  useEffect(() => {
    // 延迟一帧以获取实际高度
    requestAnimationFrame(() => {
      const height = panelRef.current?.getBoundingClientRect().height || 300;
      setPosition({
        x: window.innerWidth - currentWidth - 16,
        y: window.innerHeight - height - 16,
      });
    });
  }, []);

  // 当有新任务时自动展开面板（只在任务ID变化时触发）
  const prevTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentTaskId = currentTask?.id ?? null;
    // 只在新任务开始时展开（从无任务变为有任务，或任务ID变化）
    if (currentTaskId && currentTaskId !== prevTaskIdRef.current && isMinimized) {
      setIsMinimized(false);
      requestAnimationFrame(() => {
        const height = panelRef.current?.getBoundingClientRect().height || 300;
        setPosition({
          x: window.innerWidth - PANEL_WIDTH - 16,
          y: window.innerHeight - height - 16,
        });
      });
    }
    prevTaskIdRef.current = currentTaskId;
  }, [currentTask?.id]);

  // 当队列或任务状态变化时，重新计算位置确保面板贴近右下角
  const prevQueueLengthRef = useRef(queue.length);
  useEffect(() => {
    // 队列长度变化或任务状态变化时，延迟一帧重新计算位置
    if (!isMinimized) {
      requestAnimationFrame(() => {
        const height = panelRef.current?.getBoundingClientRect().height || 300;
        // 始终保持面板贴近右下角
        setPosition({
          x: window.innerWidth - PANEL_WIDTH - 16,
          y: window.innerHeight - height - 16,
        });
      });
    }
    prevQueueLengthRef.current = queue.length;
  }, [queue.length, currentTask?.status, initState.currentStepIndex, isMinimized]);

  // 切换最小化状态并同步更新位置
  const toggleMinimize = (minimize: boolean) => {
    const newWidth = minimize ? MINIMIZED_SIZE : PANEL_WIDTH;
    if (minimize) {
      // 最小化时直接定位到右下角
      setPosition({
        x: window.innerWidth - newWidth - 16,
        y: window.innerHeight - MINIMIZED_SIZE - 16,
      });
      setIsMinimized(true);
    } else {
      // 展开时先设置状态，然后在下一帧获取实际高度并调整位置
      setIsMinimized(false);
      requestAnimationFrame(() => {
        const height = panelRef.current?.getBoundingClientRect().height || 300;
        setPosition({
          x: window.innerWidth - newWidth - 16,
          y: window.innerHeight - height - 16,
        });
      });
    }
  };

  // 无任务时不显示
  if (!currentTask && queue.length === 0) {
    return null;
  }

  const hideSubtitleGeneration = Boolean(currentTask?.params.subtitlePath) || initState.total === 6;

  // 获取当前步骤名称
  const currentStepName =
    initState.currentStepIndex >= 0 && initState.currentStepIndex < INITIALIZATION_STEPS.length
      ? INITIALIZATION_STEPS[initState.currentStepIndex].name
      : "";

  // 获取当前步骤的消息
  const currentStepMessage =
    initState.currentStepIndex >= 0 && initState.steps[initState.currentStepIndex]?.message;

  const displayCurrentStepName =
    hideSubtitleGeneration && initState.currentStepIndex === 0 ? "" : currentStepName;

  const displayCurrentStepMessage =
    hideSubtitleGeneration && initState.currentStepIndex === 0 ? null : currentStepMessage;

  const displaySteps = hideSubtitleGeneration
    ? initState.steps.filter((step) => step.step !== "subtitle_generation")
    : initState.steps;

  // 计算总任务数（当前任务 + 队列中的任务）
  const totalTasks = (currentTask ? 1 : 0) + queue.length;

  // 最小化指示器组件
  const MinimizedIndicator = (
    <div
      ref={panelRef}
      className={`w-12 h-12 rounded-full bg-blue-500 shadow-lg flex items-center justify-center cursor-pointer hover:bg-blue-600 transition-colors relative ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 50,
      }}
      onMouseDown={handleMouseDown}
      title="点击展开初始化队列"
    >
      <Loader2 className="w-6 h-6 text-white animate-spin" />
      {/* 任务数角标 */}
      {totalTasks > 0 && (
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
          <span className="text-xs text-white font-medium">{totalTasks}</span>
        </div>
      )}
    </div>
  );

  // 展开状态面板
  const ExpandedPanel = (
    <div
      ref={panelRef}
      className={`w-80 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden ${
        isDragging ? "cursor-grabbing" : ""
      }`}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 50,
      }}
    >
      {/* 标题栏 - 可拖拽区域 */}
      <div
        className={`flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-600 ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            初始化队列
          </span>
        </div>
        <div className="flex items-center gap-1">
          {queue.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearQueue();
              }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-1 cursor-pointer"
            >
              清空队列
            </button>
          )}
          {/* 最小化按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize(true);
            }}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
            title="最小化"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
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
                {currentTask.status === "running" && displayCurrentStepMessage && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {displayCurrentStepMessage}
                  </p>
                )}
              </div>
              {currentTask.status === "running" && (
                <button
                  onClick={abortCurrent}
                  className="ml-2 p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
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
                    {displayCurrentStepName}
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
                  {displaySteps.map((step) => (
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
                    className="ml-2 p-0.5 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
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

  // 使用 createPortal 渲染到 body，避免父容器 overflow 影响
  return createPortal(
    isMinimized ? MinimizedIndicator : ExpandedPanel,
    document.body
  );
}
