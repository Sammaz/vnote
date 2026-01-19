import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ============================================================================
// 类型定义
// ============================================================================

/** 提交任务结果 */
interface SubmitResult {
  status: "Running" | "Queued";
  position?: number;
}

/** 队列状态 */
interface QueueStatus {
  current_task_note_id: number | null;
  waiting_note_ids: number[];
}

/** 队列更新事件 */
interface QueueUpdatedEvent {
  current_task_note_id: number | null;
  waiting_note_ids: number[];
}

/** 任务就绪事件 */
interface TaskReadyEvent {
  note_id: number;
}

/** Context 状态类型 */
interface InitTaskQueueContextType {
  /** 当前正在执行任务的笔记ID */
  currentTaskNoteId: number | null;
  /** 等待队列中的笔记ID列表 */
  waitingNoteIds: number[];
  /** 提交初始化任务到队列 */
  submitTask: (noteId: number) => Promise<SubmitResult>;
  /** 标记任务完成 */
  completeTask: (noteId: number) => Promise<void>;
  /** 检查笔记是否在队列中（正在执行或等待） */
  isNoteInQueue: (noteId: number) => boolean;
  /** 获取笔记在队列中的位置（0=正在执行，1+=等待位置，null=不在队列） */
  getNoteQueuePosition: (noteId: number) => number | null;
  /** 检查笔记是否正在执行 */
  isNoteRunning: (noteId: number) => boolean;
  /** 检查笔记是否在等待 */
  isNoteWaiting: (noteId: number) => boolean;
  /** 从队列中移除笔记 */
  removeNoteFromQueue: (noteId: number) => Promise<boolean>;
  /** 刷新队列状态 */
  refreshQueueStatus: () => Promise<void>;
  /** 任务就绪回调注册 */
  onTaskReady: (callback: (noteId: number) => void) => () => void;
}

// ============================================================================
// Context 创建
// ============================================================================

const InitTaskQueueContext = createContext<InitTaskQueueContextType | null>(null);

// ============================================================================
// Provider 组件
// ============================================================================

export function InitTaskQueueProvider({ children }: { children: ReactNode }) {
  const [currentTaskNoteId, setCurrentTaskNoteId] = useState<number | null>(null);
  const [waitingNoteIds, setWaitingNoteIds] = useState<number[]>([]);
  // 使用 useRef 存储回调，避免事件监听器依赖变化导致的问题
  const taskReadyCallbacksRef = useRef<Set<(noteId: number) => void>>(new Set());

  // 刷新队列状态
  const refreshQueueStatus = useCallback(async () => {
    try {
      const status = await invoke<QueueStatus>("get_init_queue_status");
      setCurrentTaskNoteId(status.current_task_note_id);
      setWaitingNoteIds(status.waiting_note_ids);
    } catch (error) {
      console.error("[InitTaskQueue] 刷新队列状态失败:", error);
    }
  }, []);

  // 提交任务
  const submitTask = useCallback(async (noteId: number): Promise<SubmitResult> => {
    try {
      const result = await invoke<SubmitResult>("submit_init_task", { noteId });
      console.log(`[InitTaskQueue] 提交任务: noteId=${noteId}, result=`, result);
      return result;
    } catch (error) {
      console.error("[InitTaskQueue] 提交任务失败:", error);
      throw error;
    }
  }, []);

  // 完成任务
  const completeTask = useCallback(async (noteId: number): Promise<void> => {
    try {
      await invoke("complete_init_task_command", { noteId });
      console.log(`[InitTaskQueue] 任务完成: noteId=${noteId}`);
    } catch (error) {
      console.error("[InitTaskQueue] 完成任务失败:", error);
      throw error;
    }
  }, []);

  // 检查笔记是否在队列中
  const isNoteInQueue = useCallback((noteId: number): boolean => {
    return currentTaskNoteId === noteId || waitingNoteIds.includes(noteId);
  }, [currentTaskNoteId, waitingNoteIds]);

  // 获取笔记在队列中的位置
  const getNoteQueuePosition = useCallback((noteId: number): number | null => {
    if (currentTaskNoteId === noteId) {
      return 0; // 正在执行
    }
    const index = waitingNoteIds.indexOf(noteId);
    if (index !== -1) {
      return index + 1; // 等待位置（从1开始）
    }
    return null; // 不在队列中
  }, [currentTaskNoteId, waitingNoteIds]);

  // 检查笔记是否正在执行
  const isNoteRunning = useCallback((noteId: number): boolean => {
    return currentTaskNoteId === noteId;
  }, [currentTaskNoteId]);

  // 检查笔记是否在等待
  const isNoteWaiting = useCallback((noteId: number): boolean => {
    return waitingNoteIds.includes(noteId);
  }, [waitingNoteIds]);

  // 从队列中移除笔记
  const removeNoteFromQueue = useCallback(async (noteId: number): Promise<boolean> => {
    try {
      const removed = await invoke<boolean>("remove_note_from_queue", { noteId });
      return removed;
    } catch (error) {
      console.error("[InitTaskQueue] 移除笔记失败:", error);
      return false;
    }
  }, []);

  // 注册任务就绪回调
  const onTaskReady = useCallback((callback: (noteId: number) => void): (() => void) => {
    taskReadyCallbacksRef.current.add(callback);
    return () => {
      taskReadyCallbacksRef.current.delete(callback);
    };
  }, []);

  // 初始化时获取队列状态
  useEffect(() => {
    refreshQueueStatus();
  }, [refreshQueueStatus]);

  // 监听后端事件（只初始化一次，使用 ref 获取最新回调）
  useEffect(() => {
    // 监听队列更新事件
    const unlistenQueueUpdated = listen<QueueUpdatedEvent>("init-queue-updated", (event) => {
      console.log("[InitTaskQueue] 队列更新:", event.payload);
      setCurrentTaskNoteId(event.payload.current_task_note_id);
      setWaitingNoteIds(event.payload.waiting_note_ids);
    });

    // 监听任务就绪事件
    const unlistenTaskReady = listen<TaskReadyEvent>("init-task-ready", (event) => {
      console.log("[InitTaskQueue] 任务就绪:", event.payload);
      // 通知所有注册的回调（使用 ref 确保获取最新的回调集合）
      taskReadyCallbacksRef.current.forEach(callback => {
        callback(event.payload.note_id);
      });
    });

    return () => {
      unlistenQueueUpdated.then(fn => fn());
      unlistenTaskReady.then(fn => fn());
    };
  }, []); // 空依赖数组，只初始化一次

  const value: InitTaskQueueContextType = {
    currentTaskNoteId,
    waitingNoteIds,
    submitTask,
    completeTask,
    isNoteInQueue,
    getNoteQueuePosition,
    isNoteRunning,
    isNoteWaiting,
    removeNoteFromQueue,
    refreshQueueStatus,
    onTaskReady,
  };

  return (
    <InitTaskQueueContext.Provider value={value}>
      {children}
    </InitTaskQueueContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useInitTaskQueue() {
  const context = useContext(InitTaskQueueContext);
  if (!context) {
    throw new Error("useInitTaskQueue must be used within an InitTaskQueueProvider");
  }
  return context;
}
