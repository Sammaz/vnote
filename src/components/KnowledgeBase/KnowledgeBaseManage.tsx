import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Database,
} from "lucide-react";
import { cn } from "../../utils/cn";
import type { KnowledgeIndexStatus, KnowledgeIndexEvent } from "./types";

interface Props {
  onStatsChange: () => void;
}

export function KnowledgeBaseManage({ onStatsChange }: Props) {
  const [statuses, setStatuses] = useState<KnowledgeIndexStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexingTaskId, setIndexingTaskId] = useState<string | null>(null);
  const [indexingNoteIds, setIndexingNoteIds] = useState<Set<string>>(new Set());
  const [indexProgress, setIndexProgress] = useState<{
    completed: number;
    failed: number;
    total: number;
    noteTitle?: string;
  } | null>(null);

  const loadStatuses = useCallback(async () => {
    try {
      // Backfill visual_summary for notes that have detailed_reading but no visual_summary
      await invoke<number>("knowledge_base_backfill_visual_summaries");
      const res = await invoke<KnowledgeIndexStatus[]>(
        "knowledge_base_get_index_status"
      );
      setStatuses(res);
    } catch (e) {
      console.error("Failed to load index statuses:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  // Listen to indexing events
  useEffect(() => {
    if (!indexingTaskId) return;
    const eventName = `knowledge-index-${indexingTaskId}`;

    const unlisten = listen<KnowledgeIndexEvent>(eventName, (event) => {
      const data = event.payload;
      switch (data.status) {
        case "Progress":
          setIndexProgress({
            completed: data.completed,
            failed: data.failed,
            total: data.total,
            noteTitle: data.note_title,
          });
          break;
        case "Completed":
        case "Aborted":
          setIndexingTaskId(null);
          setIndexProgress(null);
          loadStatuses();
          onStatsChange();
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [indexingTaskId, loadStatuses, onStatsChange]);

  const handleIndexAll = useCallback(async () => {
    try {
      const taskId = await invoke<string>("knowledge_base_index_all_notes");
      setIndexingTaskId(taskId);
      setIndexProgress({ completed: 0, failed: 0, total: 0 });
    } catch (e) {
      console.error("Failed to start indexing:", e);
    }
  }, []);

  const handleIndexOutdated = useCallback(async () => {
    try {
      const taskId = await invoke<string>("knowledge_base_index_outdated_notes");
      setIndexingTaskId(taskId);
      setIndexProgress({ completed: 0, failed: 0, total: 0 });
    } catch (e) {
      console.error("Failed to start outdated indexing:", e);
    }
  }, []);

  const handleAbortIndexing = useCallback(async () => {
    if (!indexingTaskId) return;
    try {
      await invoke("knowledge_base_abort_indexing", {
        taskId: indexingTaskId,
      });
    } catch (e) {
      console.error("Failed to abort indexing:", e);
    }
  }, [indexingTaskId]);

  const handleIndexNote = useCallback(
    async (noteId: string) => {
      setIndexingNoteIds((prev) => new Set(prev).add(noteId));
      try {
        await invoke("knowledge_base_index_note", { noteId });
        loadStatuses();
        onStatsChange();
      } catch (e) {
        console.error("Failed to index note:", e);
        loadStatuses();
      } finally {
        setIndexingNoteIds((prev) => {
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
      }
    },
    [loadStatuses, onStatsChange]
  );

  const handleRemoveIndex = useCallback(
    async (noteId: string) => {
      try {
        await invoke("knowledge_base_remove_index", { noteId });
        loadStatuses();
        onStatsChange();
      } catch (e) {
        console.error("Failed to remove index:", e);
      }
    },
    [loadStatuses, onStatsChange]
  );

  // Filter: only notes with visual_summary
  const notesWithSummary = statuses.filter((s) => s.has_visual_summary);
  const indexedCount = notesWithSummary.filter(
    (s) => s.status === "completed"
  ).length;
  const outdatedCount = notesWithSummary.filter((s) => s.needs_reindex).length;
  const unindexedCount = notesWithSummary.filter(
    (s) => s.status === "none" || s.status === "failed"
  ).length;
  // Show "更新索引" when all notes are indexed but some are outdated
  const allIndexed = notesWithSummary.length > 0 && unindexedCount === 0;
  const showUpdateButton = allIndexed && outdatedCount > 0;

  return (
    <div className="flex flex-col h-full p-6">
      {/* Stats & Actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Database className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {indexedCount}/{notesWithSummary.length} 笔记已索引
          </span>
        </div>
        <div className="flex items-center gap-2">
          {indexingTaskId ? (
            <button
              onClick={handleAbortIndexing}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
            >
              中止索引
            </button>
          ) : showUpdateButton ? (
            <button
              onClick={handleIndexOutdated}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors cursor-pointer"
            >
              更新索引 ({outdatedCount})
            </button>
          ) : (
            <button
              onClick={handleIndexAll}
              disabled={notesWithSummary.length === 0}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer",
                notesWithSummary.length > 0
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                  : "bg-slate-100 dark:bg-neutral-700 text-slate-400 cursor-not-allowed"
              )}
            >
              全部索引
            </button>
          )}
        </div>
      </div>

      {/* Indexing progress */}
      {indexProgress && (
        <IndexProgressBar progress={indexProgress} />
      )}

      {/* Note list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loading && (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            加载中...
          </div>
        )}

        {!loading && notesWithSummary.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            暂无包含视觉化总结的笔记
          </div>
        )}

        {notesWithSummary.map((item) => (
          <NoteIndexRow
            key={item.note_id}
            item={item}
            onIndex={handleIndexNote}
            onRemove={handleRemoveIndex}
            disabled={!!indexingTaskId}
            isIndexing={indexingNoteIds.has(item.note_id)}
          />
        ))}
      </div>
    </div>
  );
}

function IndexProgressBar({
  progress,
}: {
  progress: { completed: number; failed: number; total: number; noteTitle?: string };
}) {
  const pct = progress.total > 0 ? ((progress.completed + progress.failed) / progress.total) * 100 : 0;

  return (
    <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-blue-600 dark:text-blue-400">
          索引中... {progress.completed + progress.failed}/{progress.total}
        </span>
        {progress.noteTitle && (
          <span className="text-xs text-slate-400 truncate max-w-[200px]">
            {progress.noteTitle}
          </span>
        )}
      </div>
      <div className="w-full h-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function NoteIndexRow({
  item,
  onIndex,
  onRemove,
  disabled,
  isIndexing,
}: {
  item: KnowledgeIndexStatus;
  onIndex: (noteId: string) => void;
  onRemove: (noteId: string) => void;
  disabled: boolean;
  isIndexing: boolean;
}) {
  const statusIcon = () => {
    if (isIndexing) {
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    }
    if (item.needs_reindex) {
      return <AlertCircle className="w-4 h-4 text-amber-500" />;
    }
    switch (item.status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "indexing":
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-slate-300 dark:text-slate-600" />;
    }
  };

  const statusLabel = () => {
    if (isIndexing) return "索引中...";
    if (item.needs_reindex) {
      return `内容已更新，需重新索引 (${item.chunk_count} 分块)`;
    }
    switch (item.status) {
      case "completed":
        return `已索引 (${item.chunk_count} 分块)`;
      case "indexing":
        return "索引中...";
      case "failed":
        return item.error_message || "索引失败";
      default:
        return "未索引";
    }
  };

  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white dark:hover:bg-neutral-800/60 transition-colors group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {statusIcon()}
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-700 dark:text-slate-200 truncate">
            {item.note_title}
          </div>
          <div className={cn(
            "text-xs truncate",
            item.needs_reindex && !isIndexing ? "text-amber-500" : "text-slate-400"
          )}>
            {statusLabel()}
          </div>
        </div>
      </div>
      <div className={cn(
        "flex items-center gap-1 transition-opacity",
        isIndexing || item.needs_reindex ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>
        <button
          onClick={() => onIndex(item.note_id)}
          disabled={disabled || isIndexing}
          className={cn(
            "p-1.5 rounded-md transition-colors cursor-pointer",
            disabled || isIndexing
              ? "text-slate-300 cursor-not-allowed"
              : "text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
          )}
          title={item.status === "completed" ? "重新索引" : "索引"}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isIndexing && "animate-spin")} />
        </button>
        {item.status === "completed" && (
          <button
            onClick={() => onRemove(item.note_id)}
            disabled={disabled}
            className={cn(
              "p-1.5 rounded-md transition-colors cursor-pointer",
              disabled
                ? "text-slate-300 cursor-not-allowed"
                : "text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            )}
            title="删除索引"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
