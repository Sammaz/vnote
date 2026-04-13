import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Library, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { useApp } from "../../context/AppContext";
import type { Collection } from "../../types";

interface MoveToCollectionModalProps {
  fromCollectionId: string;
  noteIds: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

// 树形合集项组件
function CollectionTreeItem({
  collection,
  allCollections,
  excludeId,
  level,
  onSelect,
}: {
  collection: Collection;
  allCollections: Collection[];
  excludeId: string;
  level: number;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = allCollections.filter((c) => c.parent_id === collection.id && c.id !== excludeId);
  const hasChildren = children.length > 0;

  return (
    <div>
      <button
        onClick={() => onSelect(collection.id)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2.5 rounded-md transition-colors cursor-pointer",
          "hover:bg-slate-50 dark:hover:bg-neutral-800",
          "text-left"
        )}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
          className={cn(
            "w-4 h-4 flex items-center justify-center flex-shrink-0",
            hasChildren && "hover:bg-slate-200 dark:hover:bg-neutral-700 rounded cursor-pointer"
          )}
        >
          {hasChildren && (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-neutral-300" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 dark:text-neutral-300" />
            )
          )}
        </span>
        <Library className="w-4 h-4 text-slate-600 dark:text-neutral-300 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
            {collection.name}
          </div>
        </div>
        <span className="text-xs text-slate-600 dark:text-neutral-300">
          {collection.item_count} 项
        </span>
      </button>
      {hasChildren && expanded && (
        <div>
          {children.map((child) => (
            <CollectionTreeItem
              key={child.id}
              collection={child}
              allCollections={allCollections}
              excludeId={excludeId}
              level={level + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MoveToCollectionModal({
  fromCollectionId,
  noteIds,
  onClose,
  onSuccess,
}: MoveToCollectionModalProps) {
  const { collections, batchMoveToCollection } = useApp();
  const glassModal = useGlassBg("modal");

  // 获取顶级合集（排除当前合集）
  const rootCollections = collections.filter((c) => c.parent_id === null && c.id !== fromCollectionId);

  const handleMove = async (toCollectionId: string) => {
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
      <div className={cn("relative w-full max-w-md mx-4 rounded-lg shadow-2xl border border-slate-300 dark:border-neutral-600", glassModal)}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5 text-slate-600 dark:text-neutral-300" />
        </button>

        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            移动到合集
          </h2>
          <p className="mt-1 text-sm text-slate-700 dark:text-neutral-300">
            选择要移动到的目标合集（{noteIds.length} 个笔记）
          </p>

          <div className="mt-4 max-h-64 overflow-y-auto">
            {rootCollections.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-neutral-300 text-center py-4">
                没有其他合集可选
              </p>
            ) : (
              rootCollections.map((collection) => (
                <CollectionTreeItem
                  key={collection.id}
                  collection={collection}
                  allCollections={collections}
                  excludeId={fromCollectionId}
                  level={0}
                  onSelect={handleMove}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
