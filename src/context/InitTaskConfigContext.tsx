/**
 * 初始化任务配置 Context
 *
 * 提供全局的初始化任务配置管理，供 NoteContentPanel 和其他组件使用
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InitTaskConfig, InitTaskType } from "../types";

// ============================================================================
// 类型定义
// ============================================================================

interface InitTaskConfigContextType {
  /** 所有任务配置（按 sort_order 排序） */
  configs: InitTaskConfig[];
  /** 是否正在加载 */
  loading: boolean;
  /** 刷新配置 */
  refreshConfigs: () => Promise<void>;
  /** 检查任务是否启用 */
  isTaskEnabled: (taskType: InitTaskType) => boolean;
  /** 获取启用的任务列表（按执行顺序） */
  getEnabledTasks: () => InitTaskConfig[];
  /** 获取任务的执行顺序（从0开始，-1表示未启用） */
  getTaskOrder: (taskType: InitTaskType) => number;
  /** 检查任务依赖是否满足 */
  checkDependencies: (taskType: InitTaskType, completedTasks: Set<string>) => boolean;
  /** 获取下一个要执行的任务 */
  getNextTask: (completedTasks: Set<string>, skippedTasks: Set<string>) => InitTaskConfig | null;
}

// ============================================================================
// Context 创建
// ============================================================================

const InitTaskConfigContext = createContext<InitTaskConfigContextType | null>(null);

// ============================================================================
// Provider 组件
// ============================================================================

interface InitTaskConfigProviderProps {
  children: ReactNode;
}

export function InitTaskConfigProvider({ children }: InitTaskConfigProviderProps) {
  const [configs, setConfigs] = useState<InitTaskConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // 加载配置
  const refreshConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<InitTaskConfig[]>("get_init_task_configs");
      setConfigs(result);
    } catch (error) {
      console.error("[InitTaskConfigContext] 加载配置失败:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化时加载配置
  useEffect(() => {
    refreshConfigs();
  }, [refreshConfigs]);

  // 检查任务是否启用
  const isTaskEnabled = useCallback((taskType: InitTaskType): boolean => {
    const config = configs.find(c => c.task_type === taskType);
    return config?.enabled ?? false;
  }, [configs]);

  // 获取启用的任务列表
  const getEnabledTasks = useCallback((): InitTaskConfig[] => {
    return configs.filter(c => c.enabled).sort((a, b) => a.sort_order - b.sort_order);
  }, [configs]);

  // 获取任务执行顺序
  const getTaskOrder = useCallback((taskType: InitTaskType): number => {
    const enabledTasks = getEnabledTasks();
    const index = enabledTasks.findIndex(c => c.task_type === taskType);
    return index;
  }, [getEnabledTasks]);

  // 检查任务依赖是否满足
  const checkDependencies = useCallback((taskType: InitTaskType, completedTasks: Set<string>): boolean => {
    const config = configs.find(c => c.task_type === taskType);
    if (!config || !config.depends_on || config.depends_on.length === 0) {
      return true;
    }
    return config.depends_on.every(dep => completedTasks.has(dep));
  }, [configs]);

  // 获取下一个要执行的任务
  const getNextTask = useCallback((completedTasks: Set<string>, skippedTasks: Set<string>): InitTaskConfig | null => {
    const enabledTasks = getEnabledTasks();
    for (const task of enabledTasks) {
      if (completedTasks.has(task.task_type) || skippedTasks.has(task.task_type)) {
        continue;
      }
      if (checkDependencies(task.task_type, completedTasks)) {
        return task;
      }
    }
    return null;
  }, [getEnabledTasks, checkDependencies]);

  const value: InitTaskConfigContextType = {
    configs,
    loading,
    refreshConfigs,
    isTaskEnabled,
    getEnabledTasks,
    getTaskOrder,
    checkDependencies,
    getNextTask,
  };

  return (
    <InitTaskConfigContext.Provider value={value}>
      {children}
    </InitTaskConfigContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useInitTaskConfig() {
  const context = useContext(InitTaskConfigContext);
  if (!context) {
    throw new Error("useInitTaskConfig must be used within an InitTaskConfigProvider");
  }
  return context;
}

// ============================================================================
// 工具函数：获取任务显示名称
// ============================================================================

export function getTaskDisplayName(taskType: InitTaskType): string {
  const names: Record<InitTaskType, string> = {
    full_summary: "全文总结",
    detailed_reading: "原文细读",
    subtitle_optimization: "字幕优化",
    highlights: "高光笔记",
    suggested_questions: "推荐问题",
    flashcards: "闪记卡",
  };
  return names[taskType] || taskType;
}
