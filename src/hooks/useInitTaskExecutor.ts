/**
 * 初始化任务执行器 Hook
 *
 * 根据用户配置的任务列表，按顺序执行初始化任务，
 * 并将状态持久化到数据库，支持应用重启后恢复执行。
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InitTaskConfig, NoteInitProgress, NoteInitTask } from "../types";

export interface UseInitTaskExecutorOptions {
  noteId: number;
  modelId: number | null;
  subtitlePath: string | null;
  onTaskStart?: (taskType: string) => void;
  onTaskComplete?: (taskType: string) => void;
  onTaskError?: (taskType: string, error: string) => void;
  onAllComplete?: () => void;
  onRefreshNote?: () => void;
}

export interface UseInitTaskExecutorReturn {
  isExecuting: boolean;
  currentTask: string | null;
  completedTasks: Set<string>;
  failedTasks: Map<string, string>;
  progress: { current: number; total: number };
  taskConfigs: InitTaskConfig[];
  startExecution: () => Promise<void>;
  pauseExecution: () => void;
  resumeExecution: () => Promise<void>;
  skipCurrentTask: () => void;
  isTaskCompleted: (taskType: string) => boolean;
  isTaskRunning: (taskType: string) => boolean;
}

export function useInitTaskExecutor(options: UseInitTaskExecutorOptions): UseInitTaskExecutorReturn {
  const {
    noteId,
    modelId,
    subtitlePath,
    onTaskStart,
    onTaskComplete,
    onTaskError,
    onAllComplete,
    onRefreshNote,
  } = options;

  const [isExecuting, setIsExecuting] = useState(false);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());
  const [failedTasks, setFailedTasks] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [taskConfigs, setTaskConfigs] = useState<InitTaskConfig[]>([]);

  const isPausedRef = useRef(false);
  const currentTaskIndexRef = useRef(0);

  // 加载任务配置
  const loadTaskConfigs = useCallback(async () => {
    try {
      const configs = await invoke<InitTaskConfig[]>("get_enabled_init_task_configs");
      setTaskConfigs(configs);
      setProgress(prev => ({ ...prev, total: configs.length }));
      return configs;
    } catch (error) {
      console.error("[useInitTaskExecutor] 加载任务配置失败:", error);
      return [];
    }
  }, []);

  // 检查任务依赖是否满足
  const checkDependencies = useCallback((taskConfig: InitTaskConfig, completed: Set<string>): boolean => {
    if (!taskConfig.depends_on || taskConfig.depends_on.length === 0) {
      return true;
    }
    return taskConfig.depends_on.every(dep => completed.has(dep));
  }, []);

  // 更新任务状态到数据库
  const updateTaskStatus = useCallback(async (
    taskType: string,
    status: "pending" | "running" | "completed" | "failed" | "skipped",
    errorMessage?: string,
    generationId?: string
  ) => {
    try {
      await invoke("update_note_init_task_status", {
        noteId,
        taskType,
        status,
        errorMessage: errorMessage || null,
        generationId: generationId || null,
      });
    } catch (error) {
      console.error("[useInitTaskExecutor] 更新任务状态失败:", error);
    }
  }, [noteId]);

  // 更新整体进度
  const updateOverallStatus = useCallback(async (status: "pending" | "running" | "completed" | "failed" | "paused") => {
    try {
      await invoke("update_note_init_overall_status", { noteId, status });
    } catch (error) {
      console.error("[useInitTaskExecutor] 更新整体状态失败:", error);
    }
  }, [noteId]);

  // 更新当前任务索引
  const updateCurrentTaskIndex = useCallback(async (index: number) => {
    try {
      await invoke("update_current_init_task_index", { noteId, index });
      currentTaskIndexRef.current = index;
    } catch (error) {
      console.error("[useInitTaskExecutor] 更新任务索引失败:", error);
    }
  }, [noteId]);

  // 执行单个任务
  const executeTask = useCallback(async (taskConfig: InitTaskConfig): Promise<boolean> => {
    const { task_type } = taskConfig;

    // 检查依赖
    if (!checkDependencies(taskConfig, completedTasks)) {
      console.log(`[useInitTaskExecutor] 任务 ${task_type} 依赖未满足，跳过`);
      await updateTaskStatus(task_type, "skipped");
      return true; // 继续执行下一个
    }

    // 检查必要条件
    if (!modelId) {
      console.log(`[useInitTaskExecutor] 缺少模型ID，跳过任务 ${task_type}`);
      await updateTaskStatus(task_type, "skipped", "缺少模型ID");
      return true;
    }

    setCurrentTask(task_type);
    onTaskStart?.(task_type);
    await updateTaskStatus(task_type, "running");

    try {
      // 根据任务类型执行不同的操作
      switch (task_type) {
        case "full_summary":
        case "detailed_reading":
          // 这两个任务通过现有的 generate_note_content 一起执行
          // 在 NoteContentPanel 中处理
          break;

        case "subtitle_optimization":
          // 字幕优化任务
          if (!subtitlePath) {
            await updateTaskStatus(task_type, "skipped", "缺少字幕文件");
            return true;
          }
          // 字幕优化通过现有逻辑处理
          break;

        case "highlights":
          // 高光笔记任务
          if (!subtitlePath) {
            await updateTaskStatus(task_type, "skipped", "缺少字幕文件");
            return true;
          }
          // 高光笔记通过现有逻辑处理
          break;

        case "suggested_questions":
          // 推荐问题任务
          if (!subtitlePath) {
            await updateTaskStatus(task_type, "skipped", "缺少字幕文件");
            return true;
          }
          // 推荐问题在 note_generation.rs 中自动执行
          break;

        case "flashcards":
          // 闪记卡任务
          if (!subtitlePath) {
            await updateTaskStatus(task_type, "skipped", "缺少字幕文件");
            return true;
          }
          // 闪记卡通过现有逻辑处理
          break;

        default:
          console.warn(`[useInitTaskExecutor] 未知任务类型: ${task_type}`);
          await updateTaskStatus(task_type, "skipped", "未知任务类型");
          return true;
      }

      // 任务成功完成
      setCompletedTasks(prev => new Set([...prev, task_type]));
      await updateTaskStatus(task_type, "completed");
      onTaskComplete?.(task_type);
      onRefreshNote?.();
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[useInitTaskExecutor] 任务 ${task_type} 执行失败:`, error);
      setFailedTasks(prev => new Map([...prev, [task_type, errorMessage]]));
      await updateTaskStatus(task_type, "failed", errorMessage);
      onTaskError?.(task_type, errorMessage);
      return false; // 任务失败，但继续执行下一个
    }
  }, [
    modelId,
    subtitlePath,
    completedTasks,
    checkDependencies,
    updateTaskStatus,
    onTaskStart,
    onTaskComplete,
    onTaskError,
    onRefreshNote,
  ]);

  // 开始执行所有任务
  const startExecution = useCallback(async () => {
    if (isExecuting) {
      console.log("[useInitTaskExecutor] 已在执行中，跳过");
      return;
    }

    setIsExecuting(true);
    isPausedRef.current = false;

    // 加载任务配置
    const configs = await loadTaskConfigs();
    if (configs.length === 0) {
      console.log("[useInitTaskExecutor] 没有启用的任务");
      setIsExecuting(false);
      return;
    }

    // 初始化任务记录
    try {
      await invoke("init_note_init_tasks", { noteId });
      await updateOverallStatus("running");
    } catch (error) {
      console.error("[useInitTaskExecutor] 初始化任务记录失败:", error);
    }

    // 依次执行任务
    for (let i = 0; i < configs.length; i++) {
      if (isPausedRef.current) {
        console.log("[useInitTaskExecutor] 执行已暂停");
        await updateOverallStatus("paused");
        break;
      }

      await updateCurrentTaskIndex(i);
      setProgress({ current: i + 1, total: configs.length });

      const success = await executeTask(configs[i]);
      if (!success) {
        console.log(`[useInitTaskExecutor] 任务 ${configs[i].task_type} 失败，继续执行下一个`);
      }
    }

    // 所有任务完成
    if (!isPausedRef.current) {
      setCurrentTask(null);
      setIsExecuting(false);
      await updateOverallStatus("completed");
      onAllComplete?.();
    }
  }, [
    isExecuting,
    noteId,
    loadTaskConfigs,
    executeTask,
    updateOverallStatus,
    updateCurrentTaskIndex,
    onAllComplete,
  ]);

  // 暂停执行
  const pauseExecution = useCallback(() => {
    isPausedRef.current = true;
  }, []);

  // 恢复执行
  const resumeExecution = useCallback(async () => {
    if (!isPausedRef.current) return;

    isPausedRef.current = false;
    setIsExecuting(true);
    await updateOverallStatus("running");

    // 从当前索引继续执行
    for (let i = currentTaskIndexRef.current; i < taskConfigs.length; i++) {
      if (isPausedRef.current) {
        await updateOverallStatus("paused");
        break;
      }

      await updateCurrentTaskIndex(i);
      setProgress({ current: i + 1, total: taskConfigs.length });

      const success = await executeTask(taskConfigs[i]);
      if (!success) {
        console.log(`[useInitTaskExecutor] 任务 ${taskConfigs[i].task_type} 失败，继续执行下一个`);
      }
    }

    if (!isPausedRef.current) {
      setCurrentTask(null);
      setIsExecuting(false);
      await updateOverallStatus("completed");
      onAllComplete?.();
    }
  }, [taskConfigs, executeTask, updateOverallStatus, updateCurrentTaskIndex, onAllComplete]);

  // 跳过当前任务
  const skipCurrentTask = useCallback(() => {
    if (currentTask) {
      updateTaskStatus(currentTask, "skipped");
      setCompletedTasks(prev => new Set([...prev, currentTask]));
    }
  }, [currentTask, updateTaskStatus]);

  // 检查任务是否已完成
  const isTaskCompleted = useCallback((taskType: string): boolean => {
    return completedTasks.has(taskType);
  }, [completedTasks]);

  // 检查任务是否正在运行
  const isTaskRunning = useCallback((taskType: string): boolean => {
    return currentTask === taskType;
  }, [currentTask]);

  // 组件挂载时检查是否有未完成的任务
  useEffect(() => {
    const checkPendingTasks = async () => {
      try {
        const progress = await invoke<NoteInitProgress | null>("get_note_init_progress", { noteId });
        if (progress && (progress.overall_status === "running" || progress.overall_status === "paused")) {
          // 恢复已完成的任务状态
          const tasks = await invoke<NoteInitTask[]>("get_note_init_tasks", { noteId });
          const completed = new Set<string>();
          const failed = new Map<string, string>();

          for (const task of tasks) {
            if (task.status === "completed") {
              completed.add(task.task_type);
            } else if (task.status === "failed" && task.error_message) {
              failed.set(task.task_type, task.error_message);
            }
          }

          setCompletedTasks(completed);
          setFailedTasks(failed);
          currentTaskIndexRef.current = progress.current_task_index;

          // 加载配置
          const configs = JSON.parse(progress.config_snapshot) as InitTaskConfig[];
          setTaskConfigs(configs);
          setProgress({ current: progress.current_task_index, total: configs.length });
        }
      } catch (error) {
        console.error("[useInitTaskExecutor] 检查未完成任务失败:", error);
      }
    };

    checkPendingTasks();
  }, [noteId]);

  return {
    isExecuting,
    currentTask,
    completedTasks,
    failedTasks,
    progress,
    taskConfigs,
    startExecution,
    pauseExecution,
    resumeExecution,
    skipCurrentTask,
    isTaskCompleted,
    isTaskRunning,
  };
}
