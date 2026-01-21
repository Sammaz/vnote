/**
 * 笔记初始化相关类型定义
 */

/** 初始化步骤枚举 */
export type InitializationStep =
  | "questions"
  | "full_summary"
  | "chapters"
  | "subtitle_optimization"
  | "highlights"
  | "flashcards";

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
      step: InitializationStep;
      step_index: number;
      step_name: string;
    }
  | {
      type: "StepProgress";
      step: InitializationStep;
      message: string;
    }
  | {
      type: "StepCompleted";
      step: InitializationStep;
      step_index: number;
      step_name: string;
    }
  | {
      type: "StepSkipped";
      step: InitializationStep;
      step_index: number;
      step_name: string;
      reason: string;
    }
  | {
      type: "StepFailed";
      step: InitializationStep;
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
export type StepStatus = "pending" | "running" | "completed" | "skipped" | "failed";

/** 步骤信息 */
export interface StepInfo {
  step: InitializationStep;
  name: string;
  status: StepStatus;
  message?: string;
  error?: string;
  reason?: string;
}

/** 初始化状态 */
export interface InitializationState {
  isInitializing: boolean;
  initializationId: string | null;
  currentStepIndex: number;
  steps: StepInfo[];
  completed: number;
  skipped: number;
  failed: number;
  total: number;
  error: string | null;
}

/** 步骤信息常量 */
export const INITIALIZATION_STEPS: Array<{ step: InitializationStep; name: string }> = [
  { step: "questions", name: "推荐问题" },
  { step: "full_summary", name: "全文总结" },
  { step: "chapters", name: "章节生成" },
  { step: "subtitle_optimization", name: "字幕优化" },
  { step: "highlights", name: "高光笔记" },
  { step: "flashcards", name: "闪记卡" },
];

/** 创建初始状态 */
export function createInitialState(): InitializationState {
  return {
    isInitializing: false,
    initializationId: null,
    currentStepIndex: -1,
    steps: INITIALIZATION_STEPS.map(({ step, name }) => ({
      step,
      name,
      status: "pending" as StepStatus,
    })),
    completed: 0,
    skipped: 0,
    failed: 0,
    total: 6,
    error: null,
  };
}
