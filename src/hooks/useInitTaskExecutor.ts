/**
 * 初始化任务执行器 Hook
 *
 * 根据用户配置的任务列表，按顺序执行初始化任务，
 * 并将状态持久化到数据库，支持应用重启后恢复执行。
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  InitTaskConfig,
  NoteInitProgress,
  NoteInitTask,
  GenerationEvent,
  ChapterGenerationEvent,
  HighlightGenerationEvent,
  FlashcardGenerationEvent,
  SubtitleOptimizationEvent,
} from "../types";

export interface UseInitTaskExecutorOptions {
  noteId: number;
  modelId: number | null;
  videoPath: string;
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

// 任务名称映射
const TASK_NAMES: Record<string, string> = {
  full_summary: "全文总结",
  detailed_reading: "原文细读",
  subtitle_optimization: "字幕优化",
  highlights: "高光笔记",
  suggested_questions: "推荐问题",
  flashcards: "闪记卡",
};

export function useInitTaskExecutor(options: UseInitTaskExecutorOptions): UseInitTaskExecutorReturn {
  const {
    noteId,
    modelId,
    videoPath,
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
  const isAbortedRef = useRef(false);
  const currentTaskIndexRef = useRef(0);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // 使用 ref 存储回调函数，避免闭包问题
  const onTaskStartRef = useRef(onTaskStart);
  const onTaskCompleteRef = useRef(onTaskComplete);
  const onTaskErrorRef = useRef(onTaskError);
  const onAllCompleteRef = useRef(onAllComplete);
  const onRefreshNoteRef = useRef(onRefreshNote);

  // 同步 ref 值
  useEffect(() => {
    onTaskStartRef.current = onTaskStart;
    onTaskCompleteRef.current = onTaskComplete;
    onTaskErrorRef.current = onTaskError;
    onAllCompleteRef.current = onAllComplete;
    onRefreshNoteRef.current = onRefreshNote;
  }, [onTaskStart, onTaskComplete, onTaskError, onAllComplete, onRefreshNote]);

  // 加载任务配置
  const loadTaskConfigs = useCallback(async () => {
    try {
      console.log(`[useInitTaskExecutor] 正在加载任务配置...`);
      const configs = await invoke<InitTaskConfig[]>("get_enabled_init_task_configs");
      setTaskConfigs(configs);
      setProgress(prev => ({ ...prev, total: configs.length }));
      console.log(`[useInitTaskExecutor] 加载到 ${configs.length} 个启用的任务:`, configs.map(c => TASK_NAMES[c.task_type] || c.task_type));
      if (configs.length === 0) {
        console.warn(`[useInitTaskExecutor] 警告: 没有启用的任务配置，请检查设置页面`);
      }
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

  // 执行全文总结任务
  const executeFullSummary = useCallback(async (): Promise<void> => {
    const generationId = crypto.randomUUID();
    console.log(`[useInitTaskExecutor] 开始执行全文总结, generationId=${generationId}`);

    const eventName = `note-generation-${generationId}`;

    return new Promise(async (resolve, reject) => {
      // 先设置事件监听器
      const unlisten = await listen<GenerationEvent>(eventName, (event) => {
        const data = event.payload;
        console.log(`[useInitTaskExecutor] 全文总结事件:`, data.status);

        if (data.status === "AllCompleted") {
          unlisten();
          if (data.failed > 0) {
            reject(new Error(`生成失败: ${data.failed} 个任务失败`));
          } else {
            resolve();
          }
        } else if (data.status === "TabError") {
          // 继续等待 AllCompleted
        } else if (data.status === "Aborted") {
          unlisten();
          reject(new Error("已中止"));
        }
      });

      // 监听器设置完成后，再调用后端生成接口
      try {
        await invoke("generate_note_content", {
          generationId,
          noteId,
          modelId,
          concurrent: false,
          regenerate: false,
          tabsToGenerate: ["full_summary"],
          concurrentLimit: 1,
          customPrompt: null,
        });
      } catch (error) {
        unlisten();
        reject(error);
      }
    });
  }, [noteId, modelId]);

  // 执行原文细读任务
  const executeDetailedReading = useCallback(async (): Promise<void> => {
    const generationId = crypto.randomUUID();
    console.log(`[useInitTaskExecutor] 开始执行原文细读, generationId=${generationId}`);

    const eventName = `chapter-generation-${generationId}`;
    console.log(`[useInitTaskExecutor] 监听事件: ${eventName}`);

    return new Promise(async (resolve, reject) => {
      // 先设置事件监听器
      const unlisten = await listen<ChapterGenerationEvent>(eventName, (event) => {
        const data = event.payload;
        console.log(`[useInitTaskExecutor] 原文细读事件:`, data.status, data);

        if (data.status === "Completed") {
          console.log(`[useInitTaskExecutor] 原文细读完成，章节数据:`, data.chapter_data?.chapters?.length || 0, "个章节");
          unlisten();
          resolve();
        } else if (data.status === "Error") {
          console.error(`[useInitTaskExecutor] 原文细读错误:`, data.error);
          unlisten();
          reject(new Error(data.error));
        } else if (data.status === "Aborted") {
          console.log(`[useInitTaskExecutor] 原文细读已中止`);
          unlisten();
          reject(new Error("已中止"));
        }
      });

      console.log(`[useInitTaskExecutor] 事件监听器已设置，开始调用后端 generate_chapters`);

      // 监听器设置完成后，再调用后端生成接口
      try {
        const result = await invoke("generate_chapters", {
          generationId,
          noteId,
          modelId,
          videoPath,
          subtitlePath,
          captureScreenshots: true,
        });
        console.log(`[useInitTaskExecutor] generate_chapters 调用返回:`, result);
      } catch (error) {
        console.error(`[useInitTaskExecutor] generate_chapters 调用失败:`, error);
        unlisten();
        reject(error);
      }
    });
  }, [noteId, modelId, videoPath, subtitlePath]);

  // 执行高光笔记任务
  const executeHighlights = useCallback(async (): Promise<void> => {
    const generationId = crypto.randomUUID();
    console.log(`[useInitTaskExecutor] 开始执行高光笔记, generationId=${generationId}`);

    const eventName = `highlight-generation-${generationId}`;

    return new Promise(async (resolve, reject) => {
      // 先设置事件监听器
      const unlisten = await listen<HighlightGenerationEvent>(eventName, (event) => {
        const data = event.payload;
        console.log(`[useInitTaskExecutor] 高光笔记事件:`, data.status);

        if (data.status === "AllCompleted") {
          unlisten();
          resolve();
        } else if (data.status === "Aborted") {
          unlisten();
          reject(new Error("已中止"));
        }
      });

      // 监听器设置完成后，再调用后端生成接口
      try {
        await invoke("generate_highlights", {
          noteId,
          modelId,
          subtitlePath,
          highlightType: "default",
          totalDuration: 0,
          generationId,
        });
      } catch (error) {
        unlisten();
        reject(error);
      }
    });
  }, [noteId, modelId, subtitlePath]);

  // 执行推荐问题任务
  const executeSuggestedQuestions = useCallback(async (): Promise<void> => {
    console.log(`[useInitTaskExecutor] 开始执行推荐问题`);

    try {
      // 调用后端生成接口（同步调用，返回生成的问题列表）
      const questions = await invoke<string[]>("generate_questions_for_note", {
        noteId,
      });
      console.log(`[useInitTaskExecutor] 推荐问题生成完成, 共 ${questions.length} 个问题`);
    } catch (error) {
      console.error(`[useInitTaskExecutor] 推荐问题生成失败:`, error);
      throw error;
    }
  }, [noteId]);

  // 执行闪记卡任务
  const executeFlashcards = useCallback(async (): Promise<void> => {
    const generationId = crypto.randomUUID();
    console.log(`[useInitTaskExecutor] 开始执行闪记卡, generationId=${generationId}`);

    const eventName = `flashcard-generation-${generationId}`;

    return new Promise(async (resolve, reject) => {
      // 先设置事件监听器
      const unlisten = await listen<FlashcardGenerationEvent>(eventName, (event) => {
        const data = event.payload;
        console.log(`[useInitTaskExecutor] 闪记卡事件:`, data.status);

        if (data.status === "Completed") {
          unlisten();
          resolve();
        } else if (data.status === "Error") {
          unlisten();
          reject(new Error(data.error));
        } else if (data.status === "Aborted") {
          unlisten();
          reject(new Error("已中止"));
        }
      });

      // 监听器设置完成后，再调用后端生成接口
      try {
        await invoke("generate_flashcards", {
          generationId,
          noteId,
          modelId,
        });
      } catch (error) {
        unlisten();
        reject(error);
      }
    });
  }, [noteId, modelId]);

  // 执行字幕优化任务
  const executeSubtitleOptimization = useCallback(async (): Promise<void> => {
    const generationId = crypto.randomUUID();
    console.log(`[useInitTaskExecutor] 开始执行字幕优化, generationId=${generationId}`);

    // 先获取章节数据
    const noteData = await invoke<{ detailed_reading: string | null } | null>("get_note", { id: noteId });
    if (!noteData || !noteData.detailed_reading) {
      console.log(`[useInitTaskExecutor] 没有章节数据，跳过字幕优化`);
      return;
    }

    let chapterData;
    try {
      chapterData = JSON.parse(noteData.detailed_reading);
    } catch {
      console.log(`[useInitTaskExecutor] 章节数据解析失败，跳过字幕优化`);
      return;
    }

    if (!chapterData.chapters || chapterData.chapters.length === 0) {
      console.log(`[useInitTaskExecutor] 没有章节，跳过字幕优化`);
      return;
    }

    // 解析字幕文件
    if (!subtitlePath) {
      console.log(`[useInitTaskExecutor] 没有字幕文件，跳过字幕优化`);
      return;
    }

    const subtitleEntries = await invoke<Array<{ index: number; start_time: number; end_time: number; text: string; second_language_text?: string | null }>>("parse_subtitle_file", {
      path: subtitlePath,
    });

    if (subtitleEntries.length === 0) {
      console.log(`[useInitTaskExecutor] 字幕内容为空，跳过字幕优化`);
      return;
    }

    // 准备章节字幕数据
    const chaptersToOptimize = chapterData.chapters
      .filter((chapter: { id: string }) => chapter.id)
      .map((chapter: { id: string; start_time: number; end_time: number }) => {
        const filtered = subtitleEntries.filter(
          (sub) => sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
        );

        if (filtered.length === 0) {
          return { chapter_id: chapter.id, subtitle_text: "", has_bilingual: false };
        }

        const hasBilingual = filtered.some((sub) => sub.second_language_text);

        let subtitleText: string;
        if (hasBilingual) {
          const primaryText = filtered.map((sub) => sub.text).join(" ");
          const secondaryText = filtered
            .filter((sub) => sub.second_language_text)
            .map((sub) => sub.second_language_text!)
            .join(" ");
          subtitleText = `${primaryText}\n\n${secondaryText}`;
        } else {
          subtitleText = filtered.map((sub) => sub.text).join(" ");
        }

        return {
          chapter_id: chapter.id,
          subtitle_text: subtitleText,
          has_bilingual: hasBilingual,
        };
      })
      .filter((c: { subtitle_text: string }) => c.subtitle_text.trim().length > 0);

    if (chaptersToOptimize.length === 0) {
      console.log(`[useInitTaskExecutor] 没有可优化的字幕内容，跳过`);
      return;
    }

    console.log(`[useInitTaskExecutor] 准备优化 ${chaptersToOptimize.length} 个章节的字幕`);

    const eventName = `subtitle-optimization-${generationId}`;

    return new Promise(async (resolve, reject) => {
      // 先设置事件监听器
      const unlisten = await listen<SubtitleOptimizationEvent>(eventName, (event) => {
        const data = event.payload;
        console.log(`[useInitTaskExecutor] 字幕优化事件:`, data.status);

        if (data.status === "AllCompleted") {
          unlisten();
          console.log(`[useInitTaskExecutor] 字幕优化完成: 成功=${data.succeeded}, 失败=${data.failed}`);
          // 注意：优化后的字幕已由后端在 ChapterCompleted 事件中保存到数据库
          // NoteContentPanel 会在切换笔记或刷新时从数据库加载
          resolve();
        } else if (data.status === "Aborted") {
          unlisten();
          reject(new Error("已中止"));
        }
      });

      // 监听器设置完成后，再调用后端生成接口
      try {
        await invoke("optimize_chapter_subtitles", {
          generationId,
          noteId,
          modelId,
          chapters: chaptersToOptimize,
        });
      } catch (error) {
        unlisten();
        reject(error);
      }
    });
  }, [noteId, modelId, subtitlePath]);

  // 执行单个任务
  const executeTask = useCallback(async (taskConfig: InitTaskConfig, completed: Set<string>, taskIndex: number, totalTasks: number): Promise<boolean> => {
    const { task_type } = taskConfig;
    const taskName = TASK_NAMES[task_type] || task_type;

    // 检查是否已中止
    if (isAbortedRef.current || isPausedRef.current) {
      console.log(`[useInitTaskExecutor] 任务 ${taskName} 被跳过（已中止/暂停）`);
      return false;
    }

    // 检查依赖
    if (!checkDependencies(taskConfig, completed)) {
      console.log(`[useInitTaskExecutor] 任务 ${taskName} 依赖未满足，跳过`);
      return true; // 继续执行下一个
    }

    // 检查必要条件
    if (!modelId) {
      console.log(`[useInitTaskExecutor] 缺少模型ID，跳过任务 ${taskName}`);
      return true;
    }

    // 需要字幕的任务检查
    const needsSubtitle = ["full_summary", "detailed_reading", "highlights", "flashcards", "subtitle_optimization", "suggested_questions"];
    if (needsSubtitle.includes(task_type) && !subtitlePath) {
      console.log(`[useInitTaskExecutor] 缺少字幕文件，跳过任务 ${taskName}`);
      return true;
    }

    setCurrentTask(task_type);
    console.log(`[useInitTaskExecutor] ★★★ 准备调用 onTaskStart, taskType=${task_type}`);
    console.log(`[useInitTaskExecutor] ★★★ onTaskStartRef.current 类型:`, typeof onTaskStartRef.current);
    console.log(`[useInitTaskExecutor] ★★★ onTaskStartRef.current 值:`, onTaskStartRef.current);
    if (onTaskStartRef.current) {
      console.log(`[useInitTaskExecutor] ★★★ 正在调用 onTaskStartRef.current(${task_type})`);
      onTaskStartRef.current(task_type);
      console.log(`[useInitTaskExecutor] ★★★ onTaskStartRef.current 调用完成`);
    } else {
      console.log(`[useInitTaskExecutor] ★★★ onTaskStartRef.current 为空，跳过调用`);
    }
    console.log(`[useInitTaskExecutor] ★★★ onTaskStart 调用完成`);
    console.log(`[useInitTaskExecutor] ========================================`);
    console.log(`[useInitTaskExecutor] 开始执行任务 [${taskIndex + 1}/${totalTasks}]: ${taskName}`);
    console.log(`[useInitTaskExecutor] ========================================`);

    try {
      // 根据任务类型执行不同的操作
      switch (task_type) {
        case "full_summary":
          await executeFullSummary();
          break;

        case "detailed_reading":
          await executeDetailedReading();
          break;

        case "highlights":
          await executeHighlights();
          break;

        case "flashcards":
          await executeFlashcards();
          break;

        case "subtitle_optimization":
          await executeSubtitleOptimization();
          break;

        case "suggested_questions":
          await executeSuggestedQuestions();
          break;

        default:
          console.warn(`[useInitTaskExecutor] 未知任务类型: ${task_type}`);
          return true;
      }

      // 任务成功完成
      console.log(`[useInitTaskExecutor] 任务 ${taskName} 执行完成`);
      onTaskCompleteRef.current?.(task_type);
      onRefreshNoteRef.current?.();
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[useInitTaskExecutor] 任务 ${taskName} 执行失败:`, error);
      setFailedTasks(prev => new Map([...prev, [task_type, errorMessage]]));
      onTaskErrorRef.current?.(task_type, errorMessage);
      return false; // 任务失败，但继续执行下一个
    }
  }, [
    modelId,
    subtitlePath,
    checkDependencies,
    executeFullSummary,
    executeDetailedReading,
    executeHighlights,
    executeFlashcards,
    executeSuggestedQuestions,
    executeSubtitleOptimization,
  ]);

  // 开始执行所有任务
  const startExecution = useCallback(async () => {
    if (isExecuting) {
      console.log("[useInitTaskExecutor] 已在执行中，跳过");
      return;
    }

    console.log("[useInitTaskExecutor] ========================================");
    console.log("[useInitTaskExecutor] 开始自动初始化流程");
    console.log("[useInitTaskExecutor] ========================================");

    setIsExecuting(true);
    isPausedRef.current = false;
    isAbortedRef.current = false;

    // 加载任务配置
    const configs = await loadTaskConfigs();
    if (configs.length === 0) {
      console.log("[useInitTaskExecutor] 没有启用的任务");
      setIsExecuting(false);
      onAllCompleteRef.current?.();
      return;
    }

    // 打印完整的任务列表
    console.log(`[useInitTaskExecutor] 将按以下顺序执行 ${configs.length} 个任务:`);
    configs.forEach((config, index) => {
      console.log(`  ${index + 1}. ${TASK_NAMES[config.task_type] || config.task_type}`);
    });

    // 重置状态
    const completed = new Set<string>();
    setCompletedTasks(completed);
    setFailedTasks(new Map());

    // 依次执行任务
    for (let i = 0; i < configs.length; i++) {
      if (isPausedRef.current || isAbortedRef.current) {
        console.log("[useInitTaskExecutor] 执行已暂停/中止");
        break;
      }

      currentTaskIndexRef.current = i;
      setProgress({ current: i + 1, total: configs.length });

      const success = await executeTask(configs[i], completed, i, configs.length);
      if (success) {
        completed.add(configs[i].task_type);
        setCompletedTasks(new Set(completed));
      } else if (isAbortedRef.current) {
        break;
      }
    }

    // 所有任务完成
    if (!isPausedRef.current) {
      console.log("[useInitTaskExecutor] ========================================");
      console.log("[useInitTaskExecutor] 自动初始化流程完成");
      console.log("[useInitTaskExecutor] ========================================");
      setCurrentTask(null);
      setIsExecuting(false);
      onAllCompleteRef.current?.();
    }
  }, [
    isExecuting,
    loadTaskConfigs,
    executeTask,
  ]);

  // 暂停执行
  const pauseExecution = useCallback(() => {
    console.log("[useInitTaskExecutor] 暂停执行");
    isPausedRef.current = true;
  }, []);

  // 恢复执行
  const resumeExecution = useCallback(async () => {
    if (!isPausedRef.current) return;

    console.log("[useInitTaskExecutor] 恢复执行");
    isPausedRef.current = false;
    setIsExecuting(true);

    const completed = new Set(completedTasks);

    // 从当前索引继续执行
    for (let i = currentTaskIndexRef.current; i < taskConfigs.length; i++) {
      if (isPausedRef.current || isAbortedRef.current) {
        break;
      }

      currentTaskIndexRef.current = i;
      setProgress({ current: i + 1, total: taskConfigs.length });

      const success = await executeTask(taskConfigs[i], completed, i, taskConfigs.length);
      if (success) {
        completed.add(taskConfigs[i].task_type);
        setCompletedTasks(new Set(completed));
      }
    }

    if (!isPausedRef.current) {
      setCurrentTask(null);
      setIsExecuting(false);
      onAllCompleteRef.current?.();
    }
  }, [taskConfigs, completedTasks, executeTask]);

  // 跳过当前任务
  const skipCurrentTask = useCallback(() => {
    if (currentTask) {
      console.log(`[useInitTaskExecutor] 跳过当前任务: ${TASK_NAMES[currentTask] || currentTask}`);
      setCompletedTasks(prev => new Set([...prev, currentTask]));
    }
  }, [currentTask]);

  // 检查任务是否已完成
  const isTaskCompleted = useCallback((taskType: string): boolean => {
    return completedTasks.has(taskType);
  }, [completedTasks]);

  // 检查任务是否正在运行
  const isTaskRunning = useCallback((taskType: string): boolean => {
    return currentTask === taskType;
  }, [currentTask]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      isAbortedRef.current = true;
      unlistenRef.current?.();
    };
  }, []);

  // 组件挂载时检查是否有未完成的任务（可选，用于恢复）
  useEffect(() => {
    const checkPendingTasks = async () => {
      try {
        const progressData = await invoke<NoteInitProgress | null>("get_note_init_progress", { noteId });
        if (progressData && (progressData.overall_status === "running" || progressData.overall_status === "paused")) {
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
          currentTaskIndexRef.current = progressData.current_task_index;

          // 加载配置
          const configs = JSON.parse(progressData.config_snapshot) as InitTaskConfig[];
          setTaskConfigs(configs);
          setProgress({ current: progressData.current_task_index, total: configs.length });
        }
      } catch (error) {
        // 忽略错误，可能是表不存在
        console.debug("[useInitTaskExecutor] 检查未完成任务:", error);
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
