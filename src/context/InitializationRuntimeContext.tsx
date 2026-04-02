/**
 * 初始化运行任务 Context
 * 管理当前会话内由用户手动触发的初始化执行流（不做重启自动恢复）
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
  InitializationItemRuntime,
  InitializationItemRuntimeStatus,
  createInitialState,
} from "../types/noteInitialization";

/** 初始化任务参数 */
export interface InitializationTaskParams {
  noteId: string;
  noteTitle: string;
  modelId: string;
  videoPath: string;
  subtitlePath: string | null;
  selectedKeys: string[];
}

/** 初始化运行任务 */
export interface RuntimeTask {
  id: string;
  params: InitializationTaskParams;
  status: "waiting" | "running" | "completed" | "partial_failed" | "failed" | "aborted";
  addedAt: Date;
}

export interface RuntimeSummary {
  total: number;
  queued: number;
  running: number;
  success: number;
  partial: number;
  failed: number;
  skipped: number;
}

/** Context 类型 */
interface InitializationRuntimeContextType {
  runtimeQueue: RuntimeTask[];
  currentTask: RuntimeTask | null;
  initState: InitializationState;
  initProgress: number;
  runtimeSummary: RuntimeSummary;
  addBatchToRuntime: (paramsList: InitializationTaskParams[]) => number;
  removeFromRuntime: (taskId: string) => void;
  removeNoteFromRuntime: (noteId: string) => Promise<void>;
  abortCurrent: () => Promise<void>;
  stopAllTasks: () => Promise<void>;
  clearRuntime: () => void;
  hasActiveTasks: boolean;
}

const InitializationRuntimeContext = createContext<InitializationRuntimeContextType | null>(null);

interface InitializationRuntimeProviderProps {
  children: ReactNode;
  onTaskCompleted?: (noteId: string) => void;
}

function createRuntimeItemsFromStartingPayload(
  payload: Extract<NoteInitializationEvent, { type: "Starting" }>
): InitializationItemRuntime[] {
  return payload.steps.map((name, index) => ({
    step: String(index),
    name,
    status: "pending" as InitializationItemRuntimeStatus,
  }));
}

function createEmptyRuntimeSummary(): RuntimeSummary {
  return {
    total: 0,
    queued: 0,
    running: 0,
    success: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
  };
}

export function InitializationRuntimeProvider({ children, onTaskCompleted }: InitializationRuntimeProviderProps) {
  const [runtimeQueue, setQueue] = useState<RuntimeTask[]>([]);
  const [currentTask, setCurrentTask] = useState<RuntimeTask | null>(null);
  const [initState, setInitState] = useState<InitializationState>(createInitialState());
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummary>(createEmptyRuntimeSummary());
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const isProcessingRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAbortRef = useRef(false);
  const currentTaskRef = useRef<RuntimeTask | null>(null);
  const runtimeQueueRef = useRef<RuntimeTask[]>([]);
  const initIdRef = useRef<string | null>(null);

  const initProgress =
    initState.total > 0
      ? Math.round(((initState.completed + initState.skipped + initState.failed) / initState.total) * 100)
      : 0;

  const hasActiveTasks = currentTask !== null || runtimeQueue.length > 0;

  useEffect(() => {
    currentTaskRef.current = currentTask;
  }, [currentTask]);

  useEffect(() => {
    runtimeQueueRef.current = runtimeQueue;
  }, [runtimeQueue]);

  useEffect(() => {
    initIdRef.current = initState.initializationId;
  }, [initState.initializationId]);

  const cleanup = useCallback(async () => {
    const unlisten = unlistenRef.current;
    unlistenRef.current = null;
    if (unlisten) {
      await unlisten();
    }
  }, []);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const waitForTaskExit = useCallback(async (noteId: string) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const task = currentTaskRef.current;
      if (!task || task.params.noteId !== noteId || task.status !== "running") {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, []);

  const scheduleTerminalReset = useCallback((taskId: string) => {
    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      const shouldResetState = currentTaskRef.current?.id === taskId;
      setCurrentTask((prevTask) => {
        if (!prevTask || prevTask.id !== taskId) {
          return prevTask;
        }
        currentTaskRef.current = null;
        return null;
      });
      setInitState((prevState) => {
        if (shouldResetState) {
          initIdRef.current = null;
          return createInitialState();
        }
        return prevState;
      });
      resetTimerRef.current = null;
    }, 1500);
  }, [clearResetTimer]);

  const executeTask = useCallback(
    async (task: RuntimeTask) => {
      pendingAbortRef.current = false;
      initIdRef.current = null;
      currentTaskRef.current = { ...task, status: "running" };
      clearResetTimer();
      setCurrentTask({ ...task, status: "running" });
      setInitState({
        ...createInitialState(),
        isInitializing: true,
      });

      try {
        await cleanup();

        const initializationId = await invoke<string>("prepare_note_initialization", {
          noteId: task.params.noteId,
          modelId: task.params.modelId,
          videoPath: task.params.videoPath,
          subtitlePath: task.params.subtitlePath,
          selectedKeys: task.params.selectedKeys,
        });

        setInitState((prev) => ({
          ...prev,
          initializationId,
        }));

        const eventName = `note-initialization-${initializationId}`;
        unlistenRef.current = await listen<NoteInitializationEvent>(eventName, (event) => {
          const payload = event.payload;

          setInitState((prev) => {
            if (prev.initializationId && prev.initializationId !== initializationId) {
              return prev;
            }

            const newState: InitializationState = {
              ...prev,
              steps: [...prev.steps],
            };

            const ensureStepIndex = (stepIndex: number, stepName: string, stepKey: string) => {
              if (!newState.steps[stepIndex]) {
                newState.steps[stepIndex] = {
                  step: stepKey,
                  name: stepName,
                  status: "pending",
                };
              }
            };

            switch (payload.type) {
              case "Starting": {
                const runtimeItems = createRuntimeItemsFromStartingPayload(payload);
                newState.initializationId = payload.initialization_id;
                newState.total = payload.total_steps;
                newState.steps = runtimeItems;
                break;
              }

              case "StepStarting": {
                ensureStepIndex(payload.step_index, payload.step_name, payload.step);
                newState.currentStepIndex = payload.step_index;
                newState.steps[payload.step_index] = {
                  ...newState.steps[payload.step_index],
                  step: payload.step,
                  name: payload.step_name,
                  status: "running",
                  message: undefined,
                  error: undefined,
                  reason: undefined,
                };
                break;
              }

              case "StepProgress": {
                const progressIdx = newState.steps.findIndex((s) => s.step === payload.step);
                if (progressIdx >= 0 && newState.steps[progressIdx]?.message !== payload.message) {
                  newState.steps[progressIdx] = {
                    ...newState.steps[progressIdx],
                    message: payload.message,
                  };
                }
                break;
              }

              case "StepCompleted": {
                ensureStepIndex(payload.step_index, payload.step_name, payload.step);
                const previousStatus = newState.steps[payload.step_index]?.status;
                newState.steps[payload.step_index] = {
                  ...newState.steps[payload.step_index],
                  step: payload.step,
                  name: payload.step_name,
                  status: "completed",
                  message: undefined,
                  error: undefined,
                  reason: undefined,
                };
                if (previousStatus !== "completed") {
                  newState.completed = prev.completed + 1;
                }
                break;
              }

              case "StepSkipped": {
                ensureStepIndex(payload.step_index, payload.step_name, payload.step);
                const previousStatus = newState.steps[payload.step_index]?.status;
                newState.steps[payload.step_index] = {
                  ...newState.steps[payload.step_index],
                  step: payload.step,
                  name: payload.step_name,
                  status: "skipped",
                  reason: payload.reason,
                  message: undefined,
                  error: undefined,
                };
                if (previousStatus !== "skipped") {
                  newState.skipped = prev.skipped + 1;
                }
                break;
              }

              case "StepFailed": {
                ensureStepIndex(payload.step_index, payload.step_name, payload.step);
                const previousStatus = newState.steps[payload.step_index]?.status;
                newState.steps[payload.step_index] = {
                  ...newState.steps[payload.step_index],
                  step: payload.step,
                  name: payload.step_name,
                  status: "failed",
                  error: payload.error,
                  message: undefined,
                };
                if (previousStatus !== "failed") {
                  newState.failed = prev.failed + 1;
                }
                break;
              }

              case "Completed": {
                newState.isInitializing = false;
                newState.completed = payload.completed;
                newState.skipped = payload.skipped;
                newState.failed = payload.failed;
                newState.total = payload.total;
                pendingAbortRef.current = false;
                setCurrentTask((t) => {
                  if (!t || ["completed", "partial_failed", "failed", "aborted"].includes(t.status)) {
                    return t;
                  }

                  setRuntimeSummary((prevSummary) => {
                    const next = {
                      ...prevSummary,
                      running: 0,
                    };
                    const hasFailure = payload.failed > 0;
                    const hasCompletion = payload.completed > 0;
                    const hasSkipped = payload.skipped > 0;

                    if (hasFailure && (hasCompletion || hasSkipped)) {
                      next.partial += 1;
                    } else if (hasFailure) {
                      next.failed += 1;
                    } else if (hasCompletion) {
                      next.success += 1;
                    } else {
                      next.skipped += 1;
                    }
                    return next;
                  });

                  if (onTaskCompleted) {
                    onTaskCompleted(t.params.noteId);
                  }

                  const hasFailure = payload.failed > 0;
                  const hasCompletion = payload.completed > 0;
                  const hasSkipped = payload.skipped > 0;
                  const nextStatus = hasFailure
                    ? hasCompletion || hasSkipped
                      ? "partial_failed"
                      : "failed"
                    : "completed";
                  scheduleTerminalReset(t.id);
                  return { ...t, status: nextStatus };
                });
                void cleanup();
                break;
              }

              case "Error": {
                newState.isInitializing = false;
                newState.error = payload.error;
                pendingAbortRef.current = false;
                setCurrentTask((t) => {
                  if (!t || ["completed", "partial_failed", "failed", "aborted"].includes(t.status)) {
                    return t;
                  }

                  setRuntimeSummary((prevSummary) => ({
                    ...prevSummary,
                    running: 0,
                    failed: prevSummary.failed + 1,
                  }));

                  if (onTaskCompleted) {
                    onTaskCompleted(t.params.noteId);
                  }

                  scheduleTerminalReset(t.id);
                  return { ...t, status: "failed" };
                });
                void cleanup();
                break;
              }

              case "Aborted": {
                newState.isInitializing = false;
                pendingAbortRef.current = false;
                setCurrentTask((t) => {
                  if (!t || ["completed", "partial_failed", "failed", "aborted"].includes(t.status)) {
                    return t;
                  }

                  setRuntimeSummary((prevSummary) => ({
                    ...prevSummary,
                    running: 0,
                    failed: prevSummary.failed + 1,
                  }));

                  if (onTaskCompleted) {
                    onTaskCompleted(t.params.noteId);
                  }

                  scheduleTerminalReset(t.id);
                  return { ...t, status: "aborted" };
                });
                void cleanup();
                break;
              }
            }

            return newState;
          });
        });

        if (pendingAbortRef.current) {
          try {
            await invoke("abort_note_initialization", {
              initializationId,
            });
          } catch (error) {
            console.error("Failed to abort pending initialization:", error);
          }
        } else {
          await invoke("start_note_initialization", {
            initializationId,
          });
        }
      } catch (error) {
        pendingAbortRef.current = false;
        void cleanup();
        setInitState((prev) => ({
          ...prev,
          isInitializing: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        setCurrentTask((t) => {
          if (!t || ["completed", "failed", "aborted"].includes(t.status)) {
            return t;
          }

          setRuntimeSummary((prevSummary) => ({
            ...prevSummary,
            running: 0,
            failed: prevSummary.failed + 1,
          }));

          if (onTaskCompleted) {
            onTaskCompleted(t.params.noteId);
          }

          scheduleTerminalReset(t.id);
          return { ...t, status: "failed" };
        });
      }
    },
    [cleanup, onTaskCompleted, scheduleTerminalReset]
  );

  useEffect(() => {
    const processNext = async () => {
      if (isProcessingRef.current) return;

      if (currentTask && ["completed", "partial_failed", "failed", "aborted"].includes(currentTask.status)) {
        if (!resetTimerRef.current) {
          scheduleTerminalReset(currentTask.id);
        }
        return;
      }

      if (!currentTask && runtimeQueue.length > 0 && !initState.isInitializing) {
        isProcessingRef.current = true;
        const nextTask = runtimeQueue[0];
        setQueue((prev) => prev.slice(1));
        setRuntimeSummary((prevSummary) => ({
          ...prevSummary,
          queued: Math.max(prevSummary.queued - 1, 0),
          running: 1,
        }));
        await executeTask(nextTask);
        isProcessingRef.current = false;
      }
    };

    processNext();
  }, [currentTask, runtimeQueue, initState.isInitializing, executeTask, scheduleTerminalReset]);

  const addBatchToRuntime = useCallback((paramsList: InitializationTaskParams[]) => {
    if (paramsList.length === 0) return 0;

    const seen = new Set<string>();
    const uniqueParams = paramsList.filter((params) => {
      if (seen.has(params.noteId)) return false;
      seen.add(params.noteId);
      return true;
    });

    const queuedNoteIds = new Set(runtimeQueueRef.current.map((task) => task.params.noteId));
    const runningTask = currentTaskRef.current;
    if (runningTask?.status === "running") {
      queuedNoteIds.add(runningTask.params.noteId);
    }

    const accepted = uniqueParams.filter((params) => !queuedNoteIds.has(params.noteId));
    if (accepted.length === 0) return 0;

    const now = Date.now();
    const tasks: RuntimeTask[] = accepted.map((params, index) => ({
      id: `task-${now}-${index}-${params.noteId}`,
      params,
      status: "waiting",
      addedAt: new Date(),
    }));

    setQueue((prev) => [...prev, ...tasks]);
    setRuntimeSummary((prevSummary) => {
      const isNewBatch =
        currentTaskRef.current === null && runtimeQueueRef.current.length === 0 && prevSummary.running === 0;
      const baseSummary = isNewBatch ? createEmptyRuntimeSummary() : prevSummary;
      return {
        ...baseSummary,
        total: baseSummary.total + accepted.length,
        queued: baseSummary.queued + accepted.length,
      };
    });
    return accepted.length;
  }, []);

  const removeFromRuntime = useCallback((taskId: string) => {
    const removed = runtimeQueueRef.current.some((task) => task.id === taskId) ? 1 : 0;
    if (removed === 0) {
      return;
    }

    setQueue((prev) => prev.filter((task) => task.id !== taskId));
    setRuntimeSummary((prevSummary) => ({
      ...prevSummary,
      total: Math.max(prevSummary.total - removed, 0),
      queued: Math.max(prevSummary.queued - removed, 0),
    }));
  }, []);

  const abortCurrent = useCallback(async () => {
    const runningTask = currentTaskRef.current;
    if (!runningTask || runningTask.status !== "running") {
      return;
    }

    pendingAbortRef.current = true;
    const initializationId = initIdRef.current;
    if (!initializationId) {
      return;
    }

    try {
      await invoke("abort_note_initialization", {
        initializationId,
      });
    } catch (error) {
      pendingAbortRef.current = false;
      console.error("Failed to abort initialization:", error);
      throw error;
    }
  }, []);

  const clearRuntime = useCallback(() => {
    const removed = runtimeQueueRef.current.length;
    if (removed === 0) {
      return;
    }

    setQueue([]);
    setRuntimeSummary((prevSummary) => ({
      ...prevSummary,
      total: Math.max(prevSummary.total - removed, 0),
      queued: Math.max(prevSummary.queued - removed, 0),
    }));
  }, []);

  const stopAllTasks = useCallback(async () => {
    const queuedCount = runtimeQueueRef.current.length;
    if (queuedCount > 0) {
      setQueue([]);
      setRuntimeSummary((prevSummary) => ({
        ...prevSummary,
        queued: 0,
        skipped: prevSummary.skipped + queuedCount,
      }));
    }

    await abortCurrent();
  }, [abortCurrent]);

  const removeNoteFromRuntime = useCallback(
    async (noteId: string) => {
      const removedQueued = runtimeQueueRef.current.filter((task) => task.params.noteId === noteId).length;
      if (removedQueued > 0) {
        setQueue((prev) => prev.filter((task) => task.params.noteId !== noteId));
        setRuntimeSummary((prevSummary) => ({
          ...prevSummary,
          total: Math.max(prevSummary.total - removedQueued, 0),
          queued: Math.max(prevSummary.queued - removedQueued, 0),
        }));
      }

      if (currentTaskRef.current?.params.noteId === noteId && currentTaskRef.current.status === "running") {
        await abortCurrent();
        await waitForTaskExit(noteId);
      }
    },
    [abortCurrent, waitForTaskExit]
  );

  useEffect(() => {
    return () => {
      clearResetTimer();
      void cleanup();
    };
  }, [cleanup, clearResetTimer]);

  const value = useMemo(
    () => ({
      runtimeQueue,
      currentTask,
      initState,
      initProgress,
      runtimeSummary,
      addBatchToRuntime,
      removeFromRuntime,
      removeNoteFromRuntime,
      abortCurrent,
      stopAllTasks,
      clearRuntime,
      hasActiveTasks,
    }),
    [
      runtimeQueue,
      currentTask,
      initState,
      initProgress,
      runtimeSummary,
      addBatchToRuntime,
      removeFromRuntime,
      removeNoteFromRuntime,
      abortCurrent,
      stopAllTasks,
      clearRuntime,
      hasActiveTasks,
    ]
  );

  return <InitializationRuntimeContext.Provider value={value}>{children}</InitializationRuntimeContext.Provider>;
}

export function useInitializationRuntime() {
  const context = useContext(InitializationRuntimeContext);
  if (!context) {
    throw new Error("useInitializationRuntime must be used within InitializationRuntimeProvider");
  }
  return context;
}
