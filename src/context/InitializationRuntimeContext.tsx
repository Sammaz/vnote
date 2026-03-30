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
}

/** 初始化运行任务 */
export interface RuntimeTask {
  id: string;
  params: InitializationTaskParams;
  status: "waiting" | "running" | "completed" | "failed" | "aborted";
  addedAt: Date;
}

export interface RuntimeSummary {
  total: number;
  queued: number;
  running: number;
  success: number;
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

  const initProgress =
    initState.total > 0
      ? Math.round(((initState.completed + initState.skipped + initState.failed) / initState.total) * 100)
      : 0;

  const hasActiveTasks = currentTask !== null || runtimeQueue.length > 0;

  const cleanup = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  const executeTask = useCallback(
    async (task: RuntimeTask) => {
      setCurrentTask({ ...task, status: "running" });
      setInitState({
        ...createInitialState(),
        isInitializing: true,
      });

      try {
        const initializationId = await invoke<string>("initialize_note_data", {
          noteId: task.params.noteId,
          modelId: task.params.modelId,
          videoPath: task.params.videoPath,
          subtitlePath: task.params.subtitlePath,
        });

        setInitState((prev) => ({
          ...prev,
          initializationId,
        }));

        const eventName = `note-initialization-${initializationId}`;
        unlistenRef.current = await listen<NoteInitializationEvent>(eventName, (event) => {
          const payload = event.payload;

          setInitState((prev) => {
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
                if (progressIdx >= 0) {
                  newState.steps[progressIdx] = {
                    ...newState.steps[progressIdx],
                    message: payload.message,
                  };
                }
                break;
              }

              case "StepCompleted": {
                ensureStepIndex(payload.step_index, payload.step_name, payload.step);
                newState.steps[payload.step_index] = {
                  ...newState.steps[payload.step_index],
                  step: payload.step,
                  name: payload.step_name,
                  status: "completed",
                  message: undefined,
                  error: undefined,
                  reason: undefined,
                };
                newState.completed = prev.completed + 1;
                break;
              }

              case "StepSkipped": {
                ensureStepIndex(payload.step_index, payload.step_name, payload.step);
                newState.steps[payload.step_index] = {
                  ...newState.steps[payload.step_index],
                  step: payload.step,
                  name: payload.step_name,
                  status: "skipped",
                  reason: payload.reason,
                  message: undefined,
                  error: undefined,
                };
                newState.skipped = prev.skipped + 1;
                break;
              }

              case "StepFailed": {
                ensureStepIndex(payload.step_index, payload.step_name, payload.step);
                newState.steps[payload.step_index] = {
                  ...newState.steps[payload.step_index],
                  step: payload.step,
                  name: payload.step_name,
                  status: "failed",
                  error: payload.error,
                  message: undefined,
                };
                newState.failed = prev.failed + 1;
                break;
              }

              case "Completed": {
                newState.isInitializing = false;
                newState.completed = payload.completed;
                newState.skipped = payload.skipped;
                newState.failed = payload.failed;
                newState.total = payload.total;
                setRuntimeSummary((prevSummary) => {
                  const next = {
                    ...prevSummary,
                    running: 0,
                  };
                  if (payload.failed > 0) {
                    next.failed += 1;
                  } else if (payload.completed > 0) {
                    next.success += 1;
                  } else {
                    next.skipped += 1;
                  }
                  return next;
                });
                setCurrentTask((t) => {
                  if (t && onTaskCompleted) {
                    onTaskCompleted(t.params.noteId);
                  }
                  return t ? { ...t, status: payload.failed > 0 ? "failed" : "completed" } : null;
                });
                cleanup();
                break;
              }

              case "Error": {
                newState.isInitializing = false;
                newState.error = payload.error;
                setRuntimeSummary((prevSummary) => ({
                  ...prevSummary,
                  running: 0,
                  failed: prevSummary.failed + 1,
                }));
                setCurrentTask((t) => {
                  if (t && onTaskCompleted) {
                    onTaskCompleted(t.params.noteId);
                  }
                  return t ? { ...t, status: "failed" } : null;
                });
                cleanup();
                break;
              }

              case "Aborted": {
                newState.isInitializing = false;
                setRuntimeSummary((prevSummary) => ({
                  ...prevSummary,
                  running: 0,
                  failed: prevSummary.failed + 1,
                }));
                setCurrentTask((t) => {
                  if (t && onTaskCompleted) {
                    onTaskCompleted(t.params.noteId);
                  }
                  return t ? { ...t, status: "aborted" } : null;
                });
                cleanup();
                break;
              }
            }

            return newState;
          });
        });
      } catch (error) {
        setInitState((prev) => ({
          ...prev,
          isInitializing: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        setRuntimeSummary((prevSummary) => ({
          ...prevSummary,
          running: 0,
          failed: prevSummary.failed + 1,
        }));
        setCurrentTask((t) => {
          if (t && onTaskCompleted) {
            onTaskCompleted(t.params.noteId);
          }
          return t ? { ...t, status: "failed" } : null;
        });
      }
    },
    [cleanup, onTaskCompleted]
  );

  useEffect(() => {
    const processNext = async () => {
      if (isProcessingRef.current) return;

      if (currentTask && ["completed", "failed", "aborted"].includes(currentTask.status)) {
        setTimeout(() => {
          setCurrentTask(null);
          setInitState(createInitialState());
        }, 1500);
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
  }, [currentTask, runtimeQueue, initState.isInitializing, executeTask]);

  const addBatchToRuntime = useCallback((paramsList: InitializationTaskParams[]) => {
    if (paramsList.length === 0) return 0;

    const seen = new Set<string>();
    const uniqueParams = paramsList.filter((params) => {
      if (seen.has(params.noteId)) return false;
      seen.add(params.noteId);
      return true;
    });

    const existingNoteIds = new Set(runtimeQueue.map((task) => task.params.noteId));
    if (currentTask?.status === "running") {
      existingNoteIds.add(currentTask.params.noteId);
    }

    const accepted = uniqueParams.filter((params) => !existingNoteIds.has(params.noteId));
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
      const isNewBatch = currentTask === null && runtimeQueue.length === 0 && prevSummary.running === 0;
      const baseSummary = isNewBatch ? createEmptyRuntimeSummary() : prevSummary;
      return {
        ...baseSummary,
        total: baseSummary.total + accepted.length,
        queued: baseSummary.queued + accepted.length,
      };
    });
    return accepted.length;
  }, [runtimeQueue, currentTask]);

  const removeFromRuntime = useCallback((taskId: string) => {
    let removed = 0;
    setQueue((prev) => {
      const next = prev.filter((t) => {
        const shouldKeep = t.id !== taskId;
        if (!shouldKeep) {
          removed += 1;
        }
        return shouldKeep;
      });
      return next;
    });
    if (removed > 0) {
      setRuntimeSummary((prevSummary) => ({
        ...prevSummary,
        total: Math.max(prevSummary.total - removed, 0),
        queued: Math.max(prevSummary.queued - removed, 0),
      }));
    }
  }, []);

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
    setRuntimeSummary((prevSummary) => ({
      ...prevSummary,
      running: 0,
      failed: currentTask?.status === "running" ? prevSummary.failed + 1 : prevSummary.failed,
    }));
    setCurrentTask((t) => {
      if (t && onTaskCompleted) {
        onTaskCompleted(t.params.noteId);
      }
      return t ? { ...t, status: "aborted" } : null;
    });
  }, [currentTask?.status, initState.initializationId, cleanup, onTaskCompleted]);

  const clearRuntime = useCallback(() => {
    let removed = 0;
    setQueue((prev) => {
      removed = prev.length;
      return [];
    });
    if (removed > 0) {
      setRuntimeSummary((prevSummary) => ({
        ...prevSummary,
        total: Math.max(prevSummary.total - removed, 0),
        queued: Math.max(prevSummary.queued - removed, 0),
      }));
    }
  }, []);

  const stopAllTasks = useCallback(async () => {
    const queuedCount = runtimeQueue.length;
    await abortCurrent();
    setQueue([]);
    setRuntimeSummary((prevSummary) => ({
      ...prevSummary,
      queued: 0,
      skipped: prevSummary.skipped + queuedCount,
    }));
  }, [abortCurrent, runtimeQueue.length]);

  const removeNoteFromRuntime = useCallback(
    async (noteId: string) => {
      let removedQueued = 0;
      setQueue((prev) => {
        const next = prev.filter((t) => {
          const shouldKeep = t.params.noteId !== noteId;
          if (!shouldKeep) {
            removedQueued += 1;
          }
          return shouldKeep;
        });
        return next;
      });

      if (removedQueued > 0) {
        setRuntimeSummary((prevSummary) => ({
          ...prevSummary,
          total: Math.max(prevSummary.total - removedQueued, 0),
          queued: Math.max(prevSummary.queued - removedQueued, 0),
        }));
      }

      if (currentTask && currentTask.params.noteId === noteId && currentTask.status === "running") {
        if (initState.initializationId) {
          try {
            await invoke("abort_note_initialization", {
              initializationId: initState.initializationId,
            });
            console.log(`[InitializationRuntime] 已中止笔记 ${noteId} 的初始化任务`);
          } catch (error) {
            console.error(`[InitializationRuntime] 中止笔记 ${noteId} 的初始化任务失败:`, error);
          }
        }

        cleanup();
        setInitState((prev) => ({
          ...prev,
          isInitializing: false,
        }));
        setCurrentTask((t) => (t ? { ...t, status: "aborted" } : null));
      }
    },
    [currentTask, initState.initializationId, cleanup]
  );

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

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
