/**
 * 笔记初始化 Hook
 * 管理笔记创建后的数据初始化流程
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  InitializationState,
  NoteInitializationEvent,
  StepStatus,
  createInitialState,
} from "../types/noteInitialization";

export interface UseNoteInitializationParams {
  noteId: string;
  modelId: string;
  videoPath: string;
  subtitlePath: string | null;
}

export interface UseNoteInitializationResult {
  state: InitializationState;
  progress: number;
  startInitialization: (params: UseNoteInitializationParams) => Promise<void>;
  abortInitialization: () => Promise<void>;
  resetState: () => void;
}

export function useNoteInitialization(): UseNoteInitializationResult {
  const [state, setState] = useState<InitializationState>(createInitialState());
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // 计算进度百分比
  const progress =
    state.total > 0
      ? Math.round(((state.completed + state.skipped + state.failed) / state.total) * 100)
      : 0;

  // 清理事件监听器
  const cleanup = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // 重置状态
  const resetState = useCallback(() => {
    cleanup();
    setState(createInitialState());
  }, [cleanup]);

  // 启动初始化
  const startInitialization = useCallback(
    async (params: UseNoteInitializationParams) => {
      // 重置状态
      setState({
        ...createInitialState(),
        isInitializing: true,
      });

      try {
        // 调用后端启动初始化
        const initializationId = await invoke<string>("initialize_note_data", {
          noteId: params.noteId,
          modelId: params.modelId,
          videoPath: params.videoPath,
          subtitlePath: params.subtitlePath,
        });

        // 更新初始化ID
        setState((prev) => ({
          ...prev,
          initializationId,
        }));

        // 监听初始化事件
        const eventName = `note-initialization-${initializationId}`;
        unlistenRef.current = await listen<NoteInitializationEvent>(eventName, (event) => {
          const payload = event.payload;

          setState((prev) => {
            const newState = { ...prev };
            const newSteps = [...prev.steps];

            switch (payload.type) {
              case "Starting":
                newState.initializationId = payload.initialization_id;
                newState.total = payload.total_steps;
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
                newState.completed = prev.completed + 1;
                break;

              case "StepSkipped":
                if (newSteps[payload.step_index]) {
                  newSteps[payload.step_index] = {
                    ...newSteps[payload.step_index],
                    status: "skipped" as StepStatus,
                    reason: payload.reason,
                  };
                }
                newState.skipped = prev.skipped + 1;
                break;

              case "StepFailed":
                if (newSteps[payload.step_index]) {
                  newSteps[payload.step_index] = {
                    ...newSteps[payload.step_index],
                    status: "failed" as StepStatus,
                    error: payload.error,
                  };
                }
                newState.failed = prev.failed + 1;
                break;

              case "Completed":
                newState.isInitializing = false;
                newState.completed = payload.completed;
                newState.skipped = payload.skipped;
                newState.failed = payload.failed;
                newState.total = payload.total;
                cleanup();
                break;

              case "Error":
                newState.isInitializing = false;
                newState.error = payload.error;
                cleanup();
                break;

              case "Aborted":
                newState.isInitializing = false;
                cleanup();
                break;
            }

            newState.steps = newSteps;
            return newState;
          });
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [cleanup]
  );

  // 中止初始化
  const abortInitialization = useCallback(async () => {
    if (state.initializationId) {
      try {
        await invoke("abort_note_initialization", {
          initializationId: state.initializationId,
        });
      } catch (error) {
        console.error("Failed to abort initialization:", error);
      }
    }
    cleanup();
    setState((prev) => ({
      ...prev,
      isInitializing: false,
    }));
  }, [state.initializationId, cleanup]);

  return {
    state,
    progress,
    startInitialization,
    abortInitialization,
    resetState,
  };
}
