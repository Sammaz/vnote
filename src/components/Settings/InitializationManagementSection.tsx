import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Play, RefreshCw, RotateCcw, Save, Square, ListChecks, AlertCircle, Clock, Activity } from "lucide-react";

import { useApp } from "../../context/AppContext";
import { useInitializationRuntime, type InitializationTaskParams } from "../../context/InitializationRuntimeContext";
import { message } from "../../utils/message";
import type { Note } from "../../types";

type RunStatus = "idle" | "queued" | "running" | "completed" | "partial_failed" | "failed" | "canceled";
type ItemStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "skipped"
  | "failed"
  | "blocked"
  | "canceled";

interface InitializationItemDefinition {
  item_key: string;
  display_name: string;
  description: string;
  dependencies: string[];
  output_target: string;
  default_config: unknown;
}

interface NoteInitializationOverview {
  note_id: string;
  note_title: string;
  subtitle_path: string | null;
  model_id: string | null;
  run_status: RunStatus;
  selected_count: number;
  completed_count: number;
  skipped_count: number;
  failed_count: number;
  running_count: number;
  output_count: number;
  updated_at: string;
}

interface NoteInitializationRun {
  id: string;
  note_id: string;
  status: RunStatus;
  selected_items: string[];
  locked_items: string[];
  model_override_id: string | null;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface NoteInitializationItem {
  id: string;
  note_id: string;
  item_key: string;
  selected: boolean;
  locked: boolean;
  status: ItemStatus;
  config_json: string | null;
  depends_on: string[];
  last_model_id: string | null;
  last_error: string | null;
  output_present: boolean;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface NoteInitializationDetail {
  run: NoteInitializationRun | null;
  items: NoteInitializationItem[];
}

interface UpsertNoteInitializationItemInput {
  note_id: string;
  item_key: string;
  selected: boolean;
  locked: boolean;
  status: ItemStatus;
  config_json: string | null;
  depends_on: string[];
  last_model_id: string | null;
  last_error: string | null;
  output_present: boolean;
  started_at: string | null;
  completed_at: string | null;
}

type NoteFilter = "all" | "pending" | "running" | "failed" | "completed" | "has_subtitle" | "no_subtitle";

const DEFAULT_SELECTED_KEYS = new Set([
  "subtitle_generation",
  "suggested_questions",
  "full_summary",
  "detailed_reading",
  "subtitle_optimization",
  "highlights",
  "flashcards",
]);

const runStatusLabelMap: Record<RunStatus, string> = {
  idle: "待处理",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  partial_failed: "部分失败",
  failed: "失败",
  canceled: "已取消",
};

function expandDependencies(selected: Set<string>, dependencyMap: Map<string, string[]>): Set<string> {
  const expanded = new Set(selected);
  const queue = [...selected];

  while (queue.length > 0) {
    const key = queue.shift()!;
    const dependencies = dependencyMap.get(key) ?? [];
    for (const dep of dependencies) {
      if (!expanded.has(dep)) {
        expanded.add(dep);
        queue.push(dep);
      }
    }
  }

  return expanded;
}

function normalizeSelection(
  explicitSelected: Set<string>,
  registry: InitializationItemDefinition[]
): { selected: Set<string>; locked: Set<string> } {
  const registrySet = new Set(registry.map((item) => item.item_key));
  const dependencyMap = new Map(registry.map((item) => [item.item_key, item.dependencies]));
  const validExplicit = new Set(Array.from(explicitSelected).filter((key) => registrySet.has(key)));
  const selected = expandDependencies(validExplicit, dependencyMap);
  const locked = new Set(Array.from(selected).filter((key) => !validExplicit.has(key)));
  return { selected, locked };
}

function safeJsonParse(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getRegenerate(item: NoteInitializationItem): boolean {
  const config = safeJsonParse(item.config_json);
  return Boolean(config.regenerate);
}

function setRegenerate(item: NoteInitializationItem, regenerate: boolean): NoteInitializationItem {
  const config = safeJsonParse(item.config_json);
  config.regenerate = regenerate;
  return {
    ...item,
    config_json: JSON.stringify(config),
  };
}

interface InitializationManagementSectionProps {
  notes: Note[];
}

export function InitializationManagementSection({ notes }: InitializationManagementSectionProps) {
  const { aiConfigs, selectedModelId } = useApp();
  const {
    runtimeQueue,
    currentTask,
    initState,
    initProgress,
    addBatchToRuntime,
    removeFromRuntime,
    abortCurrent,
    clearRuntime,
    hasActiveTasks,
  } = useInitializationRuntime();

  const [registry, setRegistry] = useState<InitializationItemDefinition[]>([]);
  const [overview, setOverview] = useState<NoteInitializationOverview[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all");
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [editingItems, setEditingItems] = useState<NoteInitializationItem[]>([]);
  const [explicitSelectedKeys, setExplicitSelectedKeys] = useState<Set<string>>(new Set());
  const [modelOverrideId, setModelOverrideId] = useState<string | null>(null);

  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const noteMap = useMemo(() => {
    return new Map(notes.map((note) => [note.id, note]));
  }, [notes]);

  const defaultAiConfigId = useMemo(() => {
    return aiConfigs.find((config) => config.is_default)?.id ?? aiConfigs[0]?.id ?? null;
  }, [aiConfigs]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const [registryData, overviewData] = await Promise.all([
        invoke<InitializationItemDefinition[]>("get_initialization_registry"),
        invoke<NoteInitializationOverview[]>("get_initialization_overview"),
      ]);
      setRegistry(registryData);
      setOverview(overviewData);

      if (overviewData.length > 0 && selectedNoteIds.length === 0) {
        const firstId = overviewData[0].note_id;
        setSelectedNoteIds([firstId]);
        setActiveNoteId(firstId);
      }
    } catch (error) {
      console.error("Failed to load initialization overview:", error);
      message.error(`初始化管理加载失败：${String(error)}`);
    } finally {
      setLoadingOverview(false);
    }
  }, [selectedNoteIds.length]);

  const loadNoteDetail = useCallback(async (noteId: string) => {
    setLoadingDetail(true);
    try {
      const detail = await invoke<NoteInitializationDetail>("get_note_initialization_plan", { noteId });
      setModelOverrideId(detail.run?.model_override_id ?? null);

      const itemMap = new Map(detail.items.map((item) => [item.item_key, item]));
      const normalizedItems = registry.map((definition) => {
        const existing = itemMap.get(definition.item_key);
        if (existing) return existing;
        return {
          id: "",
          note_id: noteId,
          item_key: definition.item_key,
          selected: false,
          locked: false,
          status: "pending" as ItemStatus,
          config_json: JSON.stringify(definition.default_config ?? {}),
          depends_on: definition.dependencies,
          last_model_id: null,
          last_error: null,
          output_present: false,
          started_at: null,
          completed_at: null,
          updated_at: "",
        };
      });

      const explicit = new Set(
        normalizedItems.filter((item) => item.selected && !item.locked).map((item) => item.item_key)
      );

      setEditingItems(normalizedItems);
      setExplicitSelectedKeys(explicit);
    } catch (error) {
      console.error("Failed to load initialization plan:", error);
      message.error(`加载笔记初始化计划失败：${String(error)}`);
      setEditingItems([]);
      setExplicitSelectedKeys(new Set());
    } finally {
      setLoadingDetail(false);
    }
  }, [registry]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!activeNoteId || registry.length === 0) return;
    loadNoteDetail(activeNoteId);
  }, [activeNoteId, registry.length, loadNoteDetail]);

  const filteredOverview = useMemo(() => {
    return overview.filter((item) => {
      const query = searchQuery.trim().toLowerCase();
      if (query && !item.note_title.toLowerCase().includes(query)) {
        return false;
      }

      switch (noteFilter) {
        case "pending":
          return item.run_status === "idle";
        case "running":
          return item.run_status === "running" || item.run_status === "queued";
        case "failed":
          return item.run_status === "failed" || item.run_status === "partial_failed";
        case "completed":
          return item.run_status === "completed";
        case "has_subtitle":
          return Boolean(item.subtitle_path && item.subtitle_path.trim().length > 0);
        case "no_subtitle":
          return !(item.subtitle_path && item.subtitle_path.trim().length > 0);
        default:
          return true;
      }
    });
  }, [overview, searchQuery, noteFilter]);

  const selectedSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const currentStepName =
    initState.currentStepIndex >= 0 && initState.currentStepIndex < initState.steps.length
      ? initState.steps[initState.currentStepIndex].name
      : "";
  const currentStepMessage =
    initState.currentStepIndex >= 0 && initState.currentStepIndex < initState.steps.length
      ? initState.steps[initState.currentStepIndex].message
      : undefined;

  const runSummary = useMemo(() => {
    const queuedCount = runtimeQueue.length;
    const runningCount = currentTask && currentTask.status === "running" ? 1 : 0;
    const successCount = currentTask && currentTask.status === "completed" ? 1 : 0;
    const failedCount = currentTask && currentTask.status === "failed" ? 1 : 0;
    const skippedCount = initState.skipped;

    return {
      total: queuedCount + (currentTask ? 1 : 0),
      queued: queuedCount,
      running: runningCount,
      success: successCount,
      failed: failedCount,
      skipped: skippedCount,
    };
  }, [currentTask, initState.skipped, runtimeQueue.length]);

  const failedItems = useMemo(
    () => editingItems.filter((item) => item.status === "failed" || item.status === "blocked"),
    [editingItems]
  );

  const stats = useMemo(() => {
    const total = overview.length;
    const running = overview.filter((item) => item.run_status === "running" || item.run_status === "queued").length;
    const failed = overview.filter((item) => item.run_status === "failed" || item.run_status === "partial_failed").length;
    const completed = overview.filter((item) => item.run_status === "completed").length;
    const pending = total - running - failed - completed;
    return { total, running, failed, completed, pending };
  }, [overview]);

  const toggleNoteSelection = useCallback((noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      const result = Array.from(next);
      if (!result.includes(activeNoteId ?? "")) {
        setActiveNoteId(result[0] ?? null);
      }
      return result;
    });
  }, [activeNoteId]);

  const selectAllFiltered = useCallback(() => {
    const all = filteredOverview.map((item) => item.note_id);
    setSelectedNoteIds(all);
    setActiveNoteId(all[0] ?? null);
  }, [filteredOverview]);

  const clearSelection = useCallback(() => {
    setSelectedNoteIds([]);
    setActiveNoteId(null);
    setEditingItems([]);
    setExplicitSelectedKeys(new Set());
  }, []);

  const selectFailedNotes = useCallback(() => {
    const ids = overview
      .filter((item) => item.run_status === "failed" || item.run_status === "partial_failed")
      .map((item) => item.note_id);
    setSelectedNoteIds(ids);
    setActiveNoteId(ids[0] ?? null);
  }, [overview]);

  const selectNoSubtitleNotes = useCallback(() => {
    const ids = overview
      .filter((item) => !(item.subtitle_path && item.subtitle_path.trim().length > 0))
      .map((item) => item.note_id);
    setSelectedNoteIds(ids);
    setActiveNoteId(ids[0] ?? null);
  }, [overview]);

  const applySelectionToItems = useCallback((nextExplicit: Set<string>) => {
    const normalized = normalizeSelection(nextExplicit, registry);
    setEditingItems((prev) =>
      prev.map((item) => ({
        ...item,
        selected: normalized.selected.has(item.item_key),
        locked: normalized.locked.has(item.item_key),
      }))
    );
    setExplicitSelectedKeys(nextExplicit);
  }, [registry]);

  const toggleItemSelected = useCallback((itemKey: string) => {
    const target = editingItems.find((item) => item.item_key === itemKey);
    if (!target || target.locked) return;

    const nextExplicit = new Set(explicitSelectedKeys);
    if (nextExplicit.has(itemKey)) {
      nextExplicit.delete(itemKey);
    } else {
      nextExplicit.add(itemKey);
    }

    applySelectionToItems(nextExplicit);
  }, [editingItems, explicitSelectedKeys, applySelectionToItems]);

  const handleResetDefaults = useCallback(() => {
    const defaultExplicit = new Set(
      registry.filter((item) => DEFAULT_SELECTED_KEYS.has(item.item_key)).map((item) => item.item_key)
    );
    const normalized = normalizeSelection(defaultExplicit, registry);

    setEditingItems((prev) =>
      prev.map((item) => {
        const definition = registry.find((d) => d.item_key === item.item_key);
        return {
          ...item,
          selected: normalized.selected.has(item.item_key),
          locked: normalized.locked.has(item.item_key),
          config_json: JSON.stringify(definition?.default_config ?? {}),
          depends_on: definition?.dependencies ?? item.depends_on,
        };
      })
    );
    setExplicitSelectedKeys(defaultExplicit);
    setModelOverrideId(null);
  }, [registry]);

  const updateItemRegenerate = useCallback((itemKey: string, regenerate: boolean) => {
    setEditingItems((prev) =>
      prev.map((item) => (item.item_key === itemKey ? setRegenerate(item, regenerate) : item))
    );
  }, []);

  const mergePlanItems = useCallback(
    (noteId: string, detail: NoteInitializationDetail): UpsertNoteInitializationItemInput[] => {
      const templateMap = new Map(editingItems.map((item) => [item.item_key, item]));
      const detailMap = new Map(detail.items.map((item) => [item.item_key, item]));

      return registry.map((definition) => {
        const base = detailMap.get(definition.item_key);
        const template = templateMap.get(definition.item_key);
        return {
          note_id: noteId,
          item_key: definition.item_key,
          selected: template?.selected ?? base?.selected ?? false,
          locked: template?.locked ?? base?.locked ?? false,
          status: base?.status ?? "pending",
          config_json:
            template?.config_json ?? base?.config_json ?? JSON.stringify(definition.default_config ?? {}),
          depends_on: definition.dependencies,
          last_model_id: base?.last_model_id ?? null,
          last_error: base?.last_error ?? null,
          output_present: base?.output_present ?? false,
          started_at: base?.started_at ?? null,
          completed_at: base?.completed_at ?? null,
        };
      });
    },
    [editingItems, registry]
  );

  const savePlanForNotes = useCallback(
    async (noteIds: string[]) => {
      if (noteIds.length === 0) {
        message.warning("请先选择至少一条笔记");
        return false;
      }

      setActionLoading("save");
      try {
        for (const noteId of noteIds) {
          const detail = await invoke<NoteInitializationDetail>("get_note_initialization_plan", { noteId });
          const mergedItems = mergePlanItems(noteId, detail);
          const selectedItems = mergedItems.filter((item) => item.selected).map((item) => item.item_key);
          const lockedItems = mergedItems.filter((item) => item.locked).map((item) => item.item_key);

          if (selectedItems.length === 0) {
            message.warning("请至少选择一个初始化项目");
            return false;
          }

          await invoke<NoteInitializationDetail>("save_note_initialization_plan", {
            noteId,
            selectedItems,
            lockedItems,
            modelOverrideId,
            items: mergedItems,
          });
        }

        if (activeNoteId) {
          await loadNoteDetail(activeNoteId);
        }
        await loadOverview();
        message.success(`已保存 ${noteIds.length} 条笔记的初始化计划`);
        return true;
      } catch (error) {
        console.error("Failed to save initialization plan:", error);
        message.error(`保存初始化计划失败：${String(error)}`);
        return false;
      } finally {
        setActionLoading(null);
      }
    },
    [activeNoteId, loadNoteDetail, loadOverview, mergePlanItems, modelOverrideId]
  );

  const resolveModelId = useCallback(
    (noteId: string): string | null => {
      const note = noteMap.get(noteId);
      return modelOverrideId ?? note?.model_id ?? selectedModelId ?? defaultAiConfigId;
    },
    [defaultAiConfigId, modelOverrideId, noteMap, selectedModelId]
  );

  const enqueueNotes = useCallback(
    (noteIds: string[]) => {
      const candidates: InitializationTaskParams[] = [];
      let skippedNoModel = 0;

      for (const noteId of noteIds) {
        const note = noteMap.get(noteId);
        if (!note) continue;
        const modelId = resolveModelId(noteId);
        if (!modelId) {
          skippedNoModel += 1;
          continue;
        }

        candidates.push({
          noteId,
          noteTitle: note.title,
          modelId,
          videoPath: note.video_path,
          subtitlePath: note.subtitle_path,
        });
      }

      const accepted = addBatchToRuntime(candidates);
      if (accepted > 0) {
        message.success(`已加入队列 ${accepted} 条任务`);
      } else {
        message.info("没有可加入队列的任务（可能已在队列中或正在运行）");
      }

      if (skippedNoModel > 0) {
        message.warning(`${skippedNoModel} 条笔记未配置可用模型，已跳过`);
      }
    },
    [addBatchToRuntime, noteMap, resolveModelId]
  );

  const enqueueSelectedNotes = useCallback(async () => {
    const ok = await savePlanForNotes(selectedNoteIds);
    if (!ok) return;
    enqueueNotes(selectedNoteIds);
  }, [enqueueNotes, savePlanForNotes, selectedNoteIds]);

  const prepareRetryTask = useCallback(
    async (noteId: string, detail: NoteInitializationDetail, retryKeys: Set<string>) => {
      if (retryKeys.size === 0) {
        return { task: null as InitializationTaskParams | null, missingModel: false };
      }

      const normalized = normalizeSelection(retryKeys, registry);
      if (normalized.selected.size === 0) {
        message.warning("请至少选择一个初始化项目");
        return { task: null as InitializationTaskParams | null, missingModel: false };
      }

      const detailMap = new Map(detail.items.map((item) => [item.item_key, item]));
      const items: UpsertNoteInitializationItemInput[] = registry.map((definition) => {
        const base = detailMap.get(definition.item_key);
        return {
          note_id: noteId,
          item_key: definition.item_key,
          selected: normalized.selected.has(definition.item_key),
          locked: normalized.locked.has(definition.item_key),
          status: base?.status ?? "pending",
          config_json: base?.config_json ?? JSON.stringify(definition.default_config ?? {}),
          depends_on: definition.dependencies,
          last_model_id: base?.last_model_id ?? null,
          last_error: base?.last_error ?? null,
          output_present: base?.output_present ?? false,
          started_at: base?.started_at ?? null,
          completed_at: base?.completed_at ?? null,
        };
      });

      const modelOverrideForRun = detail.run?.model_override_id ?? null;

      await invoke<NoteInitializationDetail>("save_note_initialization_plan", {
        noteId,
        selectedItems: Array.from(normalized.selected),
        lockedItems: Array.from(normalized.locked),
        modelOverrideId: modelOverrideForRun,
        items,
      });

      const note = noteMap.get(noteId);
      if (!note) {
        return { task: null as InitializationTaskParams | null, missingModel: false };
      }

      const modelId = modelOverrideForRun ?? note.model_id ?? selectedModelId ?? defaultAiConfigId;
      if (!modelId) {
        return { task: null as InitializationTaskParams | null, missingModel: true };
      }

      return {
        task: {
          noteId,
          noteTitle: note.title,
          modelId,
          videoPath: note.video_path,
          subtitlePath: note.subtitle_path,
        } satisfies InitializationTaskParams,
        missingModel: false,
      };
    },
    [defaultAiConfigId, noteMap, registry, selectedModelId]
  );

  const handleRetryFailed = useCallback(async () => {
    if (selectedNoteIds.length === 0) {
      message.warning("请先选择至少一条笔记");
      return;
    }

    setActionLoading("retry");
    try {
      const retryTasks: InitializationTaskParams[] = [];
      let hasRetriable = false;
      let skippedNoModel = 0;

      for (const noteId of selectedNoteIds) {
        const detail = await invoke<NoteInitializationDetail>("get_note_initialization_plan", { noteId });
        const failedKeys = new Set(
          detail.items
            .filter((item) => item.status === "failed" || item.status === "blocked")
            .map((item) => item.item_key)
        );

        if (failedKeys.size === 0) {
          continue;
        }

        hasRetriable = true;
        const { task, missingModel } = await prepareRetryTask(noteId, detail, failedKeys);
        if (missingModel) {
          skippedNoModel += 1;
        }
        if (task) {
          retryTasks.push(task);
        }
      }

      const accepted = addBatchToRuntime(retryTasks);

      await loadOverview();
      if (activeNoteId) {
        await loadNoteDetail(activeNoteId);
      }

      if (!hasRetriable) {
        message.info("所选笔记没有失败或阻塞项");
      } else if (accepted > 0) {
        message.success(`已将 ${accepted} 条重试任务加入队列`);
      } else {
        message.info("未新增重试任务（可能已在队列中或正在运行）");
      }

      if (skippedNoModel > 0) {
        message.warning(`${skippedNoModel} 条笔记缺少可用模型，已跳过`);
      }
    } catch (error) {
      console.error("Failed to retry failed initialization items:", error);
      message.error(`重试失败项失败：${String(error)}`);
    } finally {
      setActionLoading(null);
    }
  }, [activeNoteId, addBatchToRuntime, loadNoteDetail, loadOverview, prepareRetryTask, selectedNoteIds]);

  const handleRetrySingleItem = useCallback(
    async (itemKey: string) => {
      if (!activeNoteId) {
        message.warning("请先选择笔记");
        return;
      }

      setActionLoading(`retry-${itemKey}`);
      try {
        const detail = await invoke<NoteInitializationDetail>("get_note_initialization_plan", { noteId: activeNoteId });
        const { task, missingModel } = await prepareRetryTask(activeNoteId, detail, new Set([itemKey]));

        if (missingModel) {
          message.warning("当前笔记缺少可用模型，无法重试");
        } else if (task) {
          const accepted = addBatchToRuntime([task]);
          if (accepted > 0) {
            message.success("已加入单项重试队列");
          } else {
            message.info("该任务已在队列中或正在运行");
          }
        }

        await loadOverview();
        await loadNoteDetail(activeNoteId);
      } catch (error) {
        console.error("Failed to retry single initialization item:", error);
        message.error(`单项重试失败：${String(error)}`);
      } finally {
        setActionLoading(null);
      }
    },
    [activeNoteId, addBatchToRuntime, loadNoteDetail, loadOverview, prepareRetryTask]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 dark:border-vnote-border bg-white dark:bg-vnote-card p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            统一规划初始化项目，支持手动入队与重试。
          </div>
          <button
            onClick={loadOverview}
            disabled={loadingOverview}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-vnote-border hover:bg-slate-100 dark:hover:bg-vnote-hover flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} className={loadingOverview ? "animate-spin" : ""} />
            刷新
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label="笔记总数" value={String(stats.total)} />
          <MetricCard label="待处理" value={String(stats.pending)} />
          <MetricCard label="运行中" value={String(stats.running)} />
          <MetricCard label="失败" value={String(stats.failed)} accent="text-red-600 dark:text-red-400" />
          <MetricCard label="已完成" value={String(stats.completed)} accent="text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-vnote-border bg-white dark:bg-vnote-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity size={15} />
              执行看板
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">批次总览、当前运行、等待队列与失败项重试均在此页完成。</p>
          </div>
          {runtimeQueue.length > 0 && (
            <button
              onClick={clearRuntime}
              disabled={actionLoading !== null}
              className="px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-vnote-border hover:bg-slate-100 dark:hover:bg-vnote-hover disabled:opacity-50 cursor-pointer"
            >
              清空等待队列
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <MetricCard label="总任务" value={String(runSummary.total)} />
          <MetricCard label="排队中" value={String(runSummary.queued)} accent="text-amber-600 dark:text-amber-400" />
          <MetricCard label="运行中" value={String(runSummary.running)} accent="text-blue-600 dark:text-blue-400" />
          <MetricCard label="成功" value={String(runSummary.success)} accent="text-emerald-600 dark:text-emerald-400" />
          <MetricCard label="失败" value={String(runSummary.failed)} accent="text-red-600 dark:text-red-400" />
          <MetricCard label="跳过" value={String(runSummary.skipped)} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Loader2 size={13} className={currentTask?.status === "running" ? "animate-spin text-blue-500" : "text-slate-400"} />
              当前运行
            </div>
            {currentTask ? (
              <>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={currentTask.params.noteTitle}>
                  {currentTask.params.noteTitle}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">状态：{currentTask.status}</div>
                {currentTask.status === "running" && (
                  <>
                    <div className="text-xs text-slate-600 dark:text-slate-300 truncate" title={currentStepName || undefined}>
                      {currentStepName || "等待步骤事件..."}
                    </div>
                    {currentStepMessage && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate" title={currentStepMessage}>
                        {currentStepMessage}
                      </div>
                    )}
                    <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${initProgress}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{initProgress}%</div>
                  </>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400">当前没有运行中的任务</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Clock size={13} className="text-slate-400" />
              等待队列（{runtimeQueue.length}）
            </div>
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              {runtimeQueue.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400">暂无等待任务</div>
              ) : (
                runtimeQueue.map((task) => (
                  <div key={task.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5">
                    <span className="text-xs text-slate-700 dark:text-slate-200 truncate" title={task.params.noteTitle}>
                      {task.params.noteTitle}
                    </span>
                    <button
                      onClick={() => removeFromRuntime(task.id)}
                      className="text-xs text-red-500 hover:text-red-600 dark:hover:text-red-300 cursor-pointer"
                    >
                      移除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <AlertCircle size={13} className="text-red-400" />
              失败项（当前笔记）
            </div>
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              {failedItems.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400">当前笔记无失败/阻塞项</div>
              ) : (
                failedItems.map((item) => (
                  <div key={item.item_key} className="rounded border border-red-200/70 dark:border-red-900/40 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-800 dark:text-slate-100 truncate" title={item.item_key}>
                        {item.item_key}
                      </span>
                      <button
                        onClick={() => handleRetrySingleItem(item.item_key)}
                        disabled={actionLoading !== null}
                        className="text-[11px] text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 cursor-pointer"
                      >
                        重试
                      </button>
                    </div>
                    {item.last_error && (
                      <div className="mt-1 text-[11px] text-red-500 truncate" title={item.last_error}>
                        {item.last_error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-vnote-border bg-white dark:bg-vnote-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索笔记标题"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
            />
            <select
              value={noteFilter}
              onChange={(e) => setNoteFilter(e.target.value as NoteFilter)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
            >
              <option value="all">全部</option>
              <option value="pending">待处理</option>
              <option value="running">运行中</option>
              <option value="failed">失败</option>
              <option value="completed">已完成</option>
              <option value="has_subtitle">有字幕</option>
              <option value="no_subtitle">无字幕</option>
            </select>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>已选 {selectedNoteIds.length} 条</span>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <button onClick={selectAllFiltered} className="hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                按筛选全选
              </button>
              <button onClick={selectFailedNotes} className="hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                全选失败项
              </button>
              <button onClick={selectNoSubtitleNotes} className="hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                全选无字幕
              </button>
              <button onClick={clearSelection} className="hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                清空
              </button>
            </div>
          </div>

          <div className="max-h-[520px] overflow-y-auto space-y-2 pr-1">
            {filteredOverview.map((item) => {
              const isSelected = selectedSet.has(item.note_id);
              const progressTotal = Math.max(item.selected_count, 0);
              const progressDone = item.completed_count + item.skipped_count;
              return (
                <button
                  key={item.note_id}
                  onClick={() => {
                    if (!selectedSet.has(item.note_id)) {
                      setSelectedNoteIds((prev) => [...prev, item.note_id]);
                    }
                    setActiveNoteId(item.note_id);
                  }}
                  className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                    activeNoteId === item.note_id
                      ? "border-blue-500 bg-blue-50/70 dark:bg-blue-900/20"
                      : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <label className="inline-flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleNoteSelection(item.note_id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1"
                      />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {item.note_title}
                      </span>
                    </label>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                      {runStatusLabelMap[item.run_status]}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>{item.subtitle_path ? "有字幕" : "无字幕"}</span>
                    <span>{progressTotal > 0 ? `${progressDone}/${progressTotal}` : "-"}</span>
                  </div>
                </button>
              );
            })}

            {!loadingOverview && filteredOverview.length === 0 && (
              <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">暂无匹配笔记</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-vnote-border bg-white dark:bg-vnote-card p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">初始化项目规划</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                依赖项会自动补齐并锁定；已有结果默认跳过，可单独开启覆盖。
              </p>
            </div>

            <select
              value={modelOverrideId ?? ""}
              onChange={(e) => setModelOverrideId(e.target.value || null)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
            >
              <option value="">使用笔记默认模型</option>
              {aiConfigs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.title}
                </option>
              ))}
            </select>
          </div>

          {loadingDetail ? (
            <div className="py-10 flex items-center justify-center text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              加载初始化计划中...
            </div>
          ) : editingItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">请先选择笔记</div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto pr-1 space-y-2">
              {registry.map((definition) => {
                const item = editingItems.find((it) => it.item_key === definition.item_key);
                if (!item) return null;
                const regenerate = getRegenerate(item);

                return (
                  <div
                    key={definition.item_key}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50/60 dark:bg-slate-800/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <label className="inline-flex items-start gap-2 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          disabled={item.locked}
                          onChange={() => toggleItemSelected(item.item_key)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                            {definition.display_name}
                          </span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {definition.description}
                          </span>
                        </span>
                      </label>

                      <span className="text-[11px] px-2 py-0.5 rounded bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                        {item.status}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className={`px-1.5 py-0.5 rounded ${item.output_present ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-slate-200 dark:bg-slate-700"}`}>
                        {item.output_present ? "已有结果" : "无结果"}
                      </span>
                      {item.locked && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                          依赖锁定
                        </span>
                      )}
                      {definition.dependencies.length > 0 && (
                        <span>依赖：{definition.dependencies.join(" / ")}</span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={regenerate}
                          onChange={(e) => updateItemRegenerate(item.item_key, e.target.checked)}
                        />
                        覆盖已有结果
                      </label>
                      <div className="flex items-center gap-2 min-w-0">
                        {item.last_error && (
                          <>
                            <span className="text-xs text-red-500 truncate max-w-[220px]" title={item.last_error}>
                              {item.last_error}
                            </span>
                            <button
                              onClick={() => handleRetrySingleItem(item.item_key)}
                              disabled={actionLoading !== null}
                              className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50 text-[11px] cursor-pointer"
                            >
                              {actionLoading === `retry-${item.item_key}` ? "重试中..." : "重试此项"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200 dark:border-vnote-border">
            <button
              onClick={() => savePlanForNotes(selectedNoteIds)}
              disabled={actionLoading !== null || selectedNoteIds.length === 0}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-vnote-border hover:bg-slate-100 dark:hover:bg-vnote-hover disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {actionLoading === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存计划
            </button>

            <button
              onClick={enqueueSelectedNotes}
              disabled={actionLoading !== null || selectedNoteIds.length === 0}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-vnote-border hover:bg-slate-100 dark:hover:bg-vnote-hover disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <ListChecks size={14} />
              加入队列
            </button>

            <button
              onClick={enqueueSelectedNotes}
              disabled={actionLoading !== null || selectedNoteIds.length === 0}
              className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <Play size={14} />
              立即执行
            </button>

            <button
              onClick={handleRetryFailed}
              disabled={actionLoading !== null || selectedNoteIds.length === 0}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-vnote-border hover:bg-slate-100 dark:hover:bg-vnote-hover disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {actionLoading === "retry" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              重试失败项
            </button>

            <button
              onClick={abortCurrent}
              disabled={!hasActiveTasks || actionLoading !== null}
              className="px-3 py-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <Square size={14} />
              取消运行
            </button>

            <button
              onClick={handleResetDefaults}
              disabled={editingItems.length === 0 || actionLoading !== null}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-vnote-border hover:bg-slate-100 dark:hover:bg-vnote-hover disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw size={14} />
              恢复默认配置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface px-4 py-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100 ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
