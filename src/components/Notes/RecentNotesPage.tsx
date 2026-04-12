import { useCallback, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useCollections } from "../../context/CollectionsContext";
import { useInitializationRuntime } from "../../context/InitializationRuntimeContext";
import { useGlassBg } from "../../hooks/useGlassBg";
import { VirtualizedNoteGrid } from "./VirtualizedNoteGrid";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { Note } from "../../types";

export function RecentNotesPage() {
  const { notes, setSelectedNoteId, setCurrentView, deleteNote } = useApp();
  const { expandCollectionPathForNote } = useCollections();
  const { removeNoteFromRuntime } = useInitializationRuntime();
  const glassPanel = useGlassBg("panel");
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [deleteTriggerRect, setDeleteTriggerRect] = useState<DOMRect | null>(null);

  // 显示所有笔记（不再限制12条，虚拟滚动可以处理大量数据）
  const recentNotes = notes;

  const handleOpenNote = async (noteId: string) => {
    await expandCollectionPathForNote(noteId);
    setSelectedNoteId(noteId);
    setCurrentView("note");
  };

  const handleCancelDelete = useCallback(() => {
    setNoteToDelete(null);
    setDeleteTriggerRect(null);
  }, []);

  const handleConfirmDelete = async () => {
    if (!noteToDelete) return;

    try {
      await removeNoteFromRuntime(noteToDelete.id);
      await deleteNote(noteToDelete.id);
      handleCancelDelete();
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${glassPanel}`}>
      {/* 头部区域 */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentView("home")}
            className={cn(
              "p-1.5 rounded-lg transition-colors cursor-pointer",
              "text-slate-400 dark:text-slate-400",
              "hover:text-slate-600 dark:hover:text-slate-300",
              "hover:bg-slate-200 dark:hover:bg-neutral-700"
            )}
            title="返回首页"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            最近笔记
          </h1>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-6 border-t border-slate-200 dark:border-neutral-700" />

      {/* 内容列表 - 使用虚拟滚动 */}
      {recentNotes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <FileText className="w-12 h-12 text-slate-500 dark:text-slate-400 mb-4" />
          <p className="text-slate-500 dark:text-slate-400">
            还没有任何笔记
          </p>
        </div>
      ) : (
        <VirtualizedNoteGrid
          notes={recentNotes}
          onNoteClick={handleOpenNote}
          onNoteDelete={(noteId, triggerRect) => {
            const targetNote = recentNotes.find((note) => note.id === noteId);
            if (targetNote) {
              setDeleteTriggerRect(triggerRect ?? null);
              setNoteToDelete(targetNote);
            }
          }}
        />
      )}

      <ConfirmDialog
        open={noteToDelete !== null}
        title="确认删除"
        message={noteToDelete ? `你将删除笔记“${noteToDelete.title}”。\n删除后将无法恢复。` : ""}
        confirmText="确认删除"
        cancelText="取消"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        danger
        placement="anchored"
        triggerRect={deleteTriggerRect}
      />
    </div>
  );
}
