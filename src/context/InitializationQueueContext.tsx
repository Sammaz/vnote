/**
 * 初始化队列 Context
 * 管理多个笔记的初始化任务队列，支持排队执行和断点恢复
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  InitializationState,
  NoteInitializationEvent,
  StepStatus,
  createInitialState,
} from "../types/noteInitialization";

/** 初始化任务参数 */
export interface InitializationTaskParams {
  noteId: string;
  noteTitle: string;
  modelId: string;
  videoPath: string;
  subtitlePath: string | null;
  startFromStep?: number; // 用于断点恢复
}

/** 队列中的任务 */
export interface QueuedTask {
  id: string;
  params: InitializationTaskParams;
  status: "waiting" | "running" | "completed" | "failed" | "aborted";
  addedAt: Date;
}

/** Context 类型 */
interface InitializationQueueContextType {
  /** 等待队列 */
  queue: QueuedTask[];
  /** 当前执行的任务 */
  currentTask: QueuedTask | null;
  /** 当前任务的初始化状态 */
  initState: InitializationState;
  /** 当前任务的进度百分比 */
  initProgress: number;
  /** 添加任务到队列 */
  addToQueue: (params: InitializationTaskParams) => void;
  /** 从队列移除任务 */
  removeFromQueue: (taskId: string) => void;
  /** 根据笔记ID移除任务（从队列移除，如果正在运行则中止） */
  removeNoteFromQueue: (noteId: string) => Promise<void>;
  /** 中止当前任务 */
  abortCurrent: () => Promise<void>;
  /** 清空队列 */
  clearQueue: () => void;
  /** 是否有任务正在执行或等待 */
  hasActiveTasks: boolean;
}

const InitializationQueueContext = createContext<InitializationQueueContextType | null>(null);

interface InitializationQueueProviderProps {
  children: ReactNode;
  onTaskCompleted?: (noteId: string) => void;
}

export function InitializationQueueProvider({ children, onTaskCompleted }: InitializationQueueProviderProps) {
  const [queue, setQueue] = useState<QueuedTask[]>([]);
  const [currentTask, setCurrentTask] = useState<QueuedTask | null>(null);
  const [initState, setInitState] = useState<InitializationState>(createInitialState());
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const isProcessingRef = useRef(false);

  // 计算进度百分比
  const initProgress =
    initState.total > 0
      ? Math.round(((initState.completed + initState.skipped + initState.failed) / initState.total) * 100)
      : 0;

  // 是否有任务正在执行或等待
  const hasActiveTasks = currentTask !== null || queue.length > 0;

  // 清理事件监听器
  const cleanup = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  // 执行单个任务
  const executeTask = useCallback(
    async (task: QueuedTask) => {
      const hasSubtitle = Boolean(task.params.subtitlePath);
      // 更新任务状态为运行中
      setCurrentTask({ ...task, status: "running" });
      const baseState = createInitialState();
      setInitState({
        ...baseState,
        isInitializing: true,
        total: hasSubtitle ? 6 : baseState.total,
      });

      try {
        // 调用后端启动初始化
        const initializationId = await invoke<string>("initialize_note_data", {
          noteId: task.params.noteId,
          modelId: task.params.modelId,
          videoPath: task.params.videoPath,
          subtitlePath: task.params.subtitlePath,
          startFromStep: task.params.startFromStep ?? null,
        });

        // 更新初始化ID
        setInitState((prev) => ({
          ...prev,
          initializationId,
        }));

        // 监听初始化事件
        const eventName = `note-initialization-${initializationId}`;
        unlistenRef.current = await listen<NoteInitializationEvent>(eventName, (event) => {
          const payload = event.payload;

          setInitState((prev) => {
            const newState = { ...prev };
            const newSteps = [...prev.steps];

            switch (payload.type) {
              case "Starting":
                newState.initializationId = payload.initialization_id;
                newState.total = hasSubtitle ? 6 : payload.total_steps;
                break;

              case "StepStarting":
                newState.currentStepIndex = payload.step_index;
                if (newSteps[payload.step_index]) {
                  newSteps[payload.step_index] = {
                    ...newSteps[payload.step_index],
                    status: "running" as StepStatus,
                  };
                }
                break;

              case "StepProgress":
                const progressIdx = newSteps.findIndex((s) => s.step === payload.step);
                if (progressIdx >= 0) {
                  newSteps[progressIdx] = {
                    ...newSteps[progressIdx],
                    message: payload.message,
                  };
                }
                break;

              case "StepCompleted":
                if (newSteps[payload.step_index]) {
                  newSteps[payload.step_index] = {
                    ...newSteps[payload.step_index],
                    status: "completed" as StepStatus,
                  };
                }
                if (!(hasSubtitle && payload.step === "subtitle_generation")) {
                  newState.completed = prev.completed + 1;
                }
                break;

              case "StepSkipped":
                if (newSteps[payload.step_index]) {
                  // 断点恢复的步骤显示为已完成状态
                  const isCheckpointRecovery = payload.reason.includes("断点恢复");
                  newSteps[payload.step_index] = {
                    ...newSteps[payload.step_index],
                    status: isCheckpointRecovery ? "completed" as StepStatus : "skipped" as StepStatus,
                    reason: isCheckpointRecovery ? undefined : payload.reason,
                  };
                }
                if (payload.step === "subtitle_generation" && payload.reason.includes("已存在字幕")) {
                  newState.total = 6;
                  break;
                }
                // 断点恢复的步骤计入已完成数
                if (payload.reason.includes("断点恢复")) {
                  if (!(hasSubtitle && payload.step === "subtitle_generation")) {
                    newState.completed = prev.completed + 1;
                  }
                } else {
                  if (!(hasSubtitle && payload.step === "subtitle_generation")) {
                    newState.skipped = prev.skipped + 1;
                  }
                }
                break;

              case "StepFailed":
                if (newSteps[payload.step_index]) {
                  newSteps[payload.step_index] = {
                    ...newSteps[payload.step_index],
                    status: "failed" as StepStatus,
                    error: payload.error,
                  };
                }
                if (!(hasSubtitle && payload.step === "subtitle_generation")) {
                  newState.failed = prev.failed + 1;
                }
                break;

              case "Completed":
                newState.isInitializing = false;
                newState.completed = payload.completed;
                const hideSubtitleGenerationForTotals = hasSubtitle || prev.total === 6;
                newState.skipped = hideSubtitleGenerationForTotals
                  ? Math.max(0, payload.skipped - 1)
                  : payload.skipped;
                newState.failed = payload.failed;
                newState.total = hideSubtitleGenerationForTotals ? 6 : payload.total;
                // 任务完成，标记并清理
                setCurrentTask((t) => {
                  // 调用完成回调刷新数据
                  if (t && onTaskCompleted) {
                    onTaskCompleted(t.params.noteId);
                  }
                  return t ? { ...t, status: "completed" } : null;
                });
                cleanup();
                break;

              case "Error":
                newState.isInitializing = false;
                newState.error = payload.error;
                setCurrentTask((t) => (t ? { ...t, status: "failed" } : null));
                cleanup();
                break;

              case "Aborted":
                newState.isInitializing = false;
                setCurrentTask((t) => (t ? { ...t, status: "aborted" } : null));
                cleanup();
                break;
            }

            newState.steps = newSteps;
            return newState;
          });
        });
      } catch (error) {
        setInitState((prev) => ({
          ...prev,
          isInitializing: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        setCurrentTask((t) => (t ? { ...t, status: "failed" } : null));
      }
    },
    [cleanup]
  );

  // 处理队列 - 当没有当前任务且队列不为空时
  useEffect(() => {
    const processNext = async () => {
      // 防止重复处理
      if (isProcessingRef.current) return;

      // 当前任务完成/失败/中止后，处理下一个
      if (currentTask && ["completed", "failed", "aborted"].includes(currentTask.status)) {
        // 延迟清理当前任务，给用户时间查看结果
        setTimeout(() => {
          setCurrentTask(null);
          setInitState(createInitialState());
        }, 1500);
        return;
      }

      // 如果没有当前任务且队列不为空，开始处理下一个
      if (!currentTask && queue.length > 0 && !initState.isInitializing) {
        isProcessingRef.current = true;
        const nextTask = queue[0];
        setQueue((prev) => prev.slice(1));
        await executeTask(nextTask);
        isProcessingRef.current = false;
      }
    };

    processNext();
  }, [currentTask, queue, initState.isInitializing, executeTask]);

  // 添加到队列
  const addToQueue = useCallback((params: InitializationTaskParams) => {
    const task: QueuedTask = {
      id: `task-${Date.now()}-${params.noteId}`,
      params,
      status: "waiting",
      addedAt: new Date(),
    };
    setQueue((prev) => [...prev, task]);
  }, []);

  // 从队列移除
  const removeFromQueue = useCallback((taskId: string) => {
    setQueue((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  // 中止当前任务
  const abortCurrent = useCallback(async () => {
    if (initState.initializationId) {
      try {
        await invoke("abort_note_initialization", {
          initializationId: initState.initializationId,
        });
      } catch (error) {
        console.error("Failed to abort initialization:", error);
      }
    }
    cleanup();
    setInitState((prev) => ({
      ...prev,
      isInitializing: false,
    }));
    setCurrentTask((t) => (t ? { ...t, status: "aborted" } : null));
  }, [initState.initializationId, cleanup]);

  // 清空队列
  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  // 根据笔记ID移除任务（从队列移除，如果正在运行则中止）
  const removeNoteFromQueue = useCallback(async (noteId: string) => {
    // 1. 从等待队列中移除该笔记的所有任务
    setQueue((prev) => prev.filter((t) => t.params.noteId !== noteId));

    // 2. 如果当前正在运行的任务就是这个笔记，中止它
    if (currentTask && currentTask.params.noteId === noteId && currentTask.status === "running") {
      // 中止后端初始化任务
      if (initState.initializationId) {
        try {
          await invoke("abort_note_initialization", {
            initializationId: initState.initializationId,
          });
          console.log(`[InitializationQueue] 已中止笔记 ${noteId} 的初始化任务`);
        } catch (error) {
          console.error(`[InitializationQueue] 中止笔记 ${noteId} 的初始化任务失败:`, error);
        }
      }
      // 清理前端状态
      cleanup();
      setInitState((prev) => ({
        ...prev,
        isInitializing: false,
      }));
      setCurrentTask((t) => (t ? { ...t, status: "aborted" } : null));
    }
  }, [currentTask, initState.initializationId, cleanup]);

  // 启动时检查未完成的初始化任务（断点恢复）
  useEffect(() => {
    const checkIncompleteInitializations = async () => {
      try {
        interface IncompleteNote {
          id: string;
          title: string;
          video_path: string;
          subtitle_path: string | null;
          model_id: string | null;
          init_status: number;
        }

        const incompleteNotes = await invoke<IncompleteNote[]>("get_incomplete_initializations");

        if (incompleteNotes.length > 0) {
          console.log(`[InitializationQueue] Found ${incompleteNotes.length} incomplete initialization(s), resuming...`);

          // 将未完成的笔记添加到队列
          for (const note of incompleteNotes) {
            if (note.model_id) {
              addToQueue({
                noteId: note.id,
                noteTitle: note.title,
                modelId: note.model_id,
                videoPath: note.video_path,
                subtitlePath: note.subtitle_path,
                startFromStep: note.init_status, // 从断点恢复
              });
            }
          }
        }
      } catch (error) {
        console.error("[InitializationQueue] Failed to check incomplete initializations:", error);
      }
    };

    // 延迟执行，确保应用完全加载
    const timer = setTimeout(checkIncompleteInitializations, 1000);
    return () => clearTimeout(timer);
  }, [addToQueue]);

  // 组件卸载时清理
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const value = useMemo(
    () => ({
      queue,
      currentTask,
      initState,
      initProgress,
      addToQueue,
      removeFromQueue,
      removeNoteFromQueue,
      abortCurrent,
      clearQueue,
      hasActiveTasks,
    }),
    [queue, currentTask, initState, initProgress, addToQueue, removeFromQueue, removeNoteFromQueue, abortCurrent, clearQueue, hasActiveTasks]
  );

  return (
    <InitializationQueueContext.Provider value={value}>
      {children}
    </InitializationQueueContext.Provider>
  );
}

export function useInitializationQueue() {
  const context = useContext(InitializationQueueContext);
  if (!context) {
    throw new Error("useInitializationQueue must be used within InitializationQueueProvider");
  }
  return context;
}
