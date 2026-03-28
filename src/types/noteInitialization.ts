/**
 * 笔记初始化相关类型定义（item 级）
 */

/** 初始化项目键 */
export type InitializationItemKey = string;

/** 初始化事件类型 */
export type NoteInitializationEvent =
  | {
      type: "Starting";
      initialization_id: string;
      total_steps: number;
      steps: string[];
    }
  | {
      type: "StepStarting";
      step: InitializationItemKey;
      step_index: number;
      step_name: string;
    }
  | {
      type: "StepProgress";
      step: InitializationItemKey;
      message: string;
    }
  | {
      type: "StepCompleted";
      step: InitializationItemKey;
      step_index: number;
      step_name: string;
    }
  | {
      type: "StepSkipped";
      step: InitializationItemKey;
      step_index: number;
      step_name: string;
      reason: string;
    }
  | {
      type: "StepFailed";
      step: InitializationItemKey;
      step_index: number;
      step_name: string;
      error: string;
    }
  | {
      type: "Completed";
      completed: number;
      skipped: number;
      failed: number;
      total: number;
    }
  | {
      type: "Error";
      error: string;
    }
  | {
      type: "Aborted";
    };

/** 步骤状态 */
export type InitializationItemRuntimeStatus = "pending" | "running" | "completed" | "skipped" | "failed";

/** 步骤信息 */
export interface InitializationItemRuntime {
  step: InitializationItemKey;
  name: string;
  status: InitializationItemRuntimeStatus;
  message?: string;
  error?: string;
  reason?: string;
}

/** 初始化状态 */
export interface InitializationState {
  isInitializing: boolean;
  initializationId: string | null;
  currentStepIndex: number;
  steps: InitializationItemRuntime[];
  completed: number;
  skipped: number;
  failed: number;
  total: number;
  error: string | null;
}

/** 创建初始状态 */
export function createInitialState(): InitializationState {
  return {
    isInitializing: false,
    initializationId: null,
    currentStepIndex: -1,
    steps: [],
    completed: 0,
    skipped: 0,
    failed: 0,
    total: 0,
    error: null,
  };
}
