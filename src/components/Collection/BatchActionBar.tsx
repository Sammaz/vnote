import { X, Trash2, FolderInput } from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { useApp } from "../../context/AppContext";

interface BatchActionBarProps {
  collectionId: string;
  totalCount: number;
  onMoveClick: () => void;
}

export function BatchActionBar({ collectionId, onMoveClick }: BatchActionBarProps) {
  const {
    batchSelection,
    setBatchSelecting,
    batchRemoveFromCollection,
    batchDeleteNotes,
  } = useApp();

  const glassMenu = useGlassBg("menu");

  const selectedCount = batchSelection.selectedNoteIds.size;

  const handleRemove = async () => {
    if (selectedCount === 0) return;
    await batchRemoveFromCollection(collectionId, Array.from(batchSelection.selectedNoteIds));
  };

  const handleDelete = async () => {
    if (selectedCount === 0) return;
    if (!confirm(`确定要永久删除选中的 ${selectedCount} 个笔记吗？此操作无法撤销。`)) return;
    await batchDeleteNotes(Array.from(batchSelection.selectedNoteIds));
  };

  const handleCancel = () => {
    setBatchSelecting(false);
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800/30">
      <div className="flex items-center gap-3">
        <span className="text-sm text-blue-600 dark:text-blue-400">
          已选择 {selectedCount} 项
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onMoveClick}
          disabled={selectedCount === 0}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
            glassMenu, "border border-slate-200 dark:border-neutral-700",
            "text-slate-600 dark:text-slate-300",
            "hover:bg-slate-50 dark:hover:bg-neutral-700",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <FolderInput className="w-3.5 h-3.5" />
          移动
        </button>

        <button
          onClick={handleRemove}
          disabled={selectedCount === 0}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
            glassMenu, "border border-slate-200 dark:border-neutral-700",
            "text-slate-600 dark:text-slate-300",
            "hover:bg-slate-50 dark:hover:bg-neutral-700",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <X className="w-3.5 h-3.5" />
          移出合集
        </button>

        <button
          onClick={handleDelete}
          disabled={selectedCount === 0}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
            "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30",
            "text-red-600 dark:text-red-400",
            "hover:bg-red-100 dark:hover:bg-red-900/30",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除
        </button>

        <div className="w-px h-4 bg-slate-200 dark:bg-neutral-700 mx-1" />

        <button
          onClick={handleCancel}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
            "text-slate-500 dark:text-slate-400",
            "hover:bg-slate-100 dark:hover:bg-neutral-700"
          )}
        >
          取消
        </button>
      </div>
    </div>
  );
}
