import { createPortal } from "react-dom";
import { X, Library } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";

interface MoveToCollectionModalProps {
  fromCollectionId: number;
  noteIds: number[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function MoveToCollectionModal({
  fromCollectionId,
  noteIds,
  onClose,
  onSuccess,
}: MoveToCollectionModalProps) {
  const { collections, batchMoveToCollection } = useApp();

  // 过滤掉当前合集
  const otherCollections = collections.filter((c) => c.id !== fromCollectionId);

  const handleMove = async (toCollectionId: number) => {
    try {
      await batchMoveToCollection(fromCollectionId, toCollectionId, noteIds);
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to move notes:", error);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-neutral-900 rounded-lg shadow-2xl border border-slate-200 dark:border-neutral-700">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5 text-slate-400 dark:text-neutral-500" />
        </button>

        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            移动到合集
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            选择要移动到的目标合集（{noteIds.length} 个笔记）
          </p>

          <div className="mt-4 max-h-64 overflow-y-auto space-y-1">
            {otherCollections.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500 text-center py-4">
                没有其他合集可选
              </p>
            ) : (
              otherCollections.map((collection) => (
                <button
                  key={collection.id}
                  onClick={() => handleMove(collection.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer",
                    "hover:bg-slate-50 dark:hover:bg-neutral-800",
                    "text-left"
                  )}
                >
                  <Library className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                      {collection.name}
                    </div>
                    {collection.description && (
                      <div className="text-xs text-slate-400 dark:text-neutral-500 truncate">
                        {collection.description}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 dark:text-neutral-500">
                    {collection.item_count} 项
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
