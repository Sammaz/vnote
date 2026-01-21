/**
 * 初始化遮罩组件
 *
 * 在自动初始化任务执行期间显示全屏遮罩，
 * 显示任务进度和状态，完全阻断用户交互。
 */

import { Loader2, Check, X, Clock } from "lucide-react";
import type { InitTaskConfig } from "../../types";

// 任务名称映射
const TASK_NAMES: Record<string, string> = {
  full_summary: "全文总结",
  detailed_reading: "原文细读",
  subtitle_optimization: "字幕优化",
  highlights: "高光笔记",
  suggested_questions: "推荐问题",
  flashcards: "闪记卡",
};

// 任务描述映射
const TASK_DESCRIPTIONS: Record<string, string> = {
  full_summary: "正在生成视频内容的全文总结...",
  detailed_reading: "正在分析视频章节并生成细读笔记...",
  subtitle_optimization: "正在优化字幕文本...",
  highlights: "正在提取视频高光内容...",
  suggested_questions: "正在生成推荐问题...",
  flashcards: "正在生成闪记卡片...",
};

interface InitializationOverlayProps {
  /** 是否显示遮罩 */
  isVisible: boolean;
  /** 当前正在执行的任务类型 */
  currentTask: string | null;
  /** 已完成的任务集合 */
  completedTasks: Set<string>;
  /** 失败的任务映射 (taskType -> errorMessage) */
  failedTasks: Map<string, string>;
  /** 进度信息 */
  progress: { current: number; total: number };
  /** 任务配置列表 */
  taskConfigs: InitTaskConfig[];
}

type TaskStatus = "pending" | "running" | "completed" | "failed";

interface TaskDisplayItem {
  taskType: string;
  name: string;
  status: TaskStatus;
  error?: string;
}

export function InitializationOverlay({
  isVisible,
  currentTask,
  completedTasks,
  failedTasks,
  progress,
  taskConfigs,
}: InitializationOverlayProps) {
  if (!isVisible) return null;

  // 构建任务显示列表
  const taskItems: TaskDisplayItem[] = taskConfigs.map((config) => {
    const taskType = config.task_type;
    let status: TaskStatus = "pending";

    if (completedTasks.has(taskType)) {
      status = "completed";
    } else if (failedTasks.has(taskType)) {
      status = "failed";
    } else if (currentTask === taskType) {
      status = "running";
    }

    return {
      taskType,
      name: TASK_NAMES[taskType] || taskType,
      status,
      error: failedTasks.get(taskType),
    };
  });

  // 计算进度百分比
  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // 获取当前任务描述
  const currentTaskDescription = currentTask ? TASK_DESCRIPTIONS[currentTask] || "正在处理..." : "正在初始化...";

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] max-w-[90vw] max-h-[90vh] rounded-xl bg-white dark:bg-vnote-card border border-slate-200 dark:border-vnote-border shadow-2xl overflow-hidden flex flex-col">
        {/* 标题区域 */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-vnote-border bg-gradient-to-r from-blue-500/10 to-purple-500/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Loader2 className="w-6 h-6 text-blue-500 dark:text-blue-400 animate-spin" />
              <div className="absolute inset-0 rounded-full bg-blue-400/20 animate-ping" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white">正在初始化笔记</h3>
              <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">{currentTaskDescription}</p>
            </div>
          </div>
        </div>

        {/* 进度条 */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-vnote-border/50 flex-shrink-0">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-500 dark:text-gray-400">整体进度</span>
            <span className="text-slate-700 dark:text-white font-medium">
              {progress.current} / {progress.total} 个任务
            </span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* 任务列表 - 弹性高度 */}
        <div className="px-6 py-4 flex-1 min-h-0">
          <div className="space-y-2">
            {taskItems.map((item) => (
              <TaskItem key={item.taskType} item={item} />
            ))}
          </div>
        </div>

        {/* 底部提示 */}
        <div className="px-6 py-3 border-t border-slate-100 dark:border-vnote-border/50 bg-slate-50 dark:bg-vnote-bg/50 flex-shrink-0">
          <p className="text-xs text-slate-400 dark:text-gray-500 text-center">
            请耐心等待，初始化完成后即可开始使用
          </p>
        </div>
      </div>
    </div>
  );
}

// 单个任务项组件
function TaskItem({ item }: { item: TaskDisplayItem }) {
  const statusConfig = {
    pending: {
      icon: <Clock className="w-4 h-4 text-slate-400 dark:text-gray-500" />,
      textColor: "text-slate-400 dark:text-gray-500",
      bgColor: "bg-slate-100 dark:bg-gray-800/50",
    },
    running: {
      icon: <Loader2 className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin" />,
      textColor: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-50 dark:bg-blue-500/10",
    },
    completed: {
      icon: <Check className="w-4 h-4 text-green-500 dark:text-green-400" />,
      textColor: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-500/10",
    },
    failed: {
      icon: <X className="w-4 h-4 text-red-500 dark:text-red-400" />,
      textColor: "text-red-600 dark:text-red-400",
      bgColor: "bg-red-50 dark:bg-red-500/10",
    },
  };

  const config = statusConfig[item.status];

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${config.bgColor}`}
    >
      <div className="flex-shrink-0">{config.icon}</div>
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${config.textColor}`}>{item.name}</span>
        {item.status === "failed" && item.error && (
          <p className="text-xs text-red-500 dark:text-red-400/80 mt-0.5 truncate" title={item.error}>
            {item.error}
          </p>
        )}
      </div>
      {item.status === "running" && (
        <span className="text-xs text-blue-500 dark:text-blue-400/80 animate-pulse">执行中</span>
      )}
    </div>
  );
}
