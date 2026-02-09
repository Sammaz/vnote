import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { ChevronUp, ChevronDown, MoreHorizontal, Trash2, Video, Library, ChevronRight, FolderPlus } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useInitializationQueue } from "../../context/InitializationQueueContext";
import { CreateCollectionModal } from "./CreateCollectionModal";
import type { Collection, CollectionItem as CollectionItemType, Note } from "../../types";

// 合集图标组件
function CollectionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

// 树形合集菜单项组件
function CollectionTreeMenuItem({
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
  const children = allCollections.filter((c) => c.parent_id === collection.id);
  const hasChildren = children.length > 0;
  const isExcluded = collection.id === excludeId;

  return (
    <div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isExcluded) onSelect(collection.id);
        }}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
          isExcluded
            ? "text-slate-400 dark:text-slate-500 cursor-default"
            : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 cursor-pointer"
        )}
        style={{ paddingLeft: `${12 + level * 12}px` }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
          className={cn(
            "w-4 h-4 flex items-center justify-center flex-shrink-0",
            hasChildren && "hover:bg-slate-200 dark:hover:bg-neutral-600 rounded cursor-pointer"
          )}
        >
          {hasChildren && (
            expanded ? (
              <ChevronDown className="w-3 h-3 text-slate-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-slate-400" />
            )
          )}
        </span>
        <Library className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{collection.name}</span>
      </button>
      {hasChildren && expanded && (
        <div>
          {children.map((child) => (
            <CollectionTreeMenuItem
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

interface CollectionItemProps {
  collection: Collection;
  level: number;
  childCollections: Collection[];
  allCollections: Collection[];
  onEdit?: (collection: Collection) => void;
}

interface NoteWithDetails extends CollectionItemType {
  note: Note;
}

// 合集内笔记项组件
function CollectionNoteItem({
  item,
  level,
  currentCollectionId
}: {
  item: NoteWithDetails;
  level: number;
  currentCollectionId: string;
}) {
  const {
    setSelectedNoteId,
    setCurrentView,
    selectedNoteId,
    deleteNote,
    collections,
    addNoteToCollection,
    removeNoteFromCollection,
  } = useApp();
  const { removeNoteFromQueue } = useInitializationQueue();

  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showCollectionSubmenu, setShowCollectionSubmenu] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedNoteId === item.note_id;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
        setShowCollectionSubmenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showMenu && menuTriggerRef.current) {
      const rect = menuTriggerRef.current.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 4, left: rect.right - 176 });
    }
    setShowMenu(!showMenu);
  };

  const handleMoveToCollection = async (collectionId: string) => {
    try {
      await removeNoteFromCollection(currentCollectionId, item.note_id);
      await addNoteToCollection(collectionId, item.note_id);
      setShowMenu(false);
      setShowCollectionSubmenu(false);
    } catch (error) {
      console.error("Failed to move note:", error);
    }
  };

  const handleRemoveFromCollection = async () => {
    try {
      await removeNoteFromCollection(currentCollectionId, item.note_id);
      setShowMenu(false);
    } catch (error) {
      console.error("Failed to remove note:", error);
    }
  };

  const handleDelete = async () => {
    setShowMenu(false);
    try {
      // 先从初始化队列移除（包括中止正在运行的任务）
      await removeNoteFromQueue(item.note_id);
      await deleteNote(item.note_id);
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  };

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          if (!showMenu) setShowMenu(false);
        }}
      >
        <button
          onClick={() => {
            setSelectedNoteId(item.note_id);
            setCurrentView("note");
          }}
          className={cn(
            "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-all duration-150 cursor-pointer",
            "text-sm",
            isSelected
              ? "bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400"
              : "hover:bg-slate-100 dark:hover:bg-vnote-hover text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          )}
          style={{ paddingLeft: `${24 + level * 16}px` }}
        >
          <Video className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="flex-1 truncate text-left">{item.note.title}</span>
          {(isHovered || showMenu) && (
            <div
              ref={menuTriggerRef}
              onClick={handleMenuClick}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-neutral-700 flex-shrink-0"
            >
              <MoreHorizontal className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
            </div>
          )}
        </button>
      </div>

      {showMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed w-44 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg z-[9999]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <div className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400 border-b border-slate-100 dark:border-neutral-700">
            操作
          </div>

          {/* 移动到其他合集 - 树形展示 */}
          <div
            className="relative"
            onMouseEnter={() => setShowCollectionSubmenu(true)}
            onMouseLeave={() => setShowCollectionSubmenu(false)}
          >
            <button className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer">
              <div className="flex items-center gap-2">
                <Library className="w-3.5 h-3.5" />
                <span>移动到合集</span>
              </div>
              <ChevronRight className="w-3 h-3" />
            </button>

            {showCollectionSubmenu && (
              <div className="absolute left-full top-0 ml-1 w-48 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg max-h-64 overflow-y-auto">
                {collections.filter((c) => c.parent_id === null).map((col) => (
                  <CollectionTreeMenuItem
                    key={col.id}
                    collection={col}
                    allCollections={collections}
                    excludeId={currentCollectionId}
                    level={0}
                    onSelect={handleMoveToCollection}
                  />
                ))}
                {collections.length > 0 && (
                  <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    setShowCollectionSubmenu(false);
                    setShowCreateCollectionModal(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>新合集</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleRemoveFromCollection}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>从合集移除</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />

          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除笔记</span>
          </button>
        </div>,
        document.body
      )}

      {showCreateCollectionModal && (
        <CreateCollectionModal onClose={() => setShowCreateCollectionModal(false)} />
      )}
    </>
  );
}

export function CollectionItem({
  collection,
  level,
  childCollections,
  allCollections,
  onEdit,
}: CollectionItemProps) {
  const {
    expandedCollections,
    toggleCollectionExpand,
    selectedCollectionId,
    setSelectedCollection,
    setCurrentView,
    deleteCollection,
    notes,
  } = useApp();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [collectionNotes, setCollectionNotes] = useState<NoteWithDetails[]>([]);

  const isExpanded = expandedCollections.has(collection.id);
  const isSelected = selectedCollectionId === collection.id;
  const hasChildren = childCollections.length > 0;
  const hasNotes = collection.item_count > 0;

  // 构建混合排序列表
  type MixedSidebarItem =
    | { type: "collection"; data: Collection }
    | { type: "note"; data: NoteWithDetails };

  const mixedItems: MixedSidebarItem[] = [
    ...childCollections.map((c) => ({ type: "collection" as const, data: c })),
    ...collectionNotes.map((n) => ({ type: "note" as const, data: n })),
  ].sort((a, b) => {
    const aOrder = a.type === "collection" ? a.data.sort_order : a.data.sort_order;
    const bOrder = b.type === "collection" ? b.data.sort_order : b.data.sort_order;
    return aOrder - bOrder;
  });

  // 加载合集内的笔记
  useEffect(() => {
    if (isExpanded && hasNotes) {
      invoke<CollectionItemType[]>("get_collection_items", { collectionId: collection.id })
        .then((items) => {
          const itemsWithNotes: NoteWithDetails[] = items
            .map((item) => ({
              ...item,
              note: notes.find((n) => n.id === item.note_id),
            }))
            .filter((item): item is NoteWithDetails => item.note !== undefined);
          setCollectionNotes(itemsWithNotes);
        })
        .catch((error) => {
          console.error("Failed to load collection notes:", error);
        });
    } else if (!hasNotes) {
      setCollectionNotes([]);
    }
  }, [isExpanded, hasNotes, collection.id, collection.item_count, notes]);

  const handleClick = () => {
    setSelectedCollection(collection.id);
    setCurrentView("collection");
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleCollectionExpand(collection.id);
  };

  const handleConfirmDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      await deleteCollection(collection.id);
    } catch (error) {
      console.error("Failed to delete collection:", error);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="relative">
        <button
          onClick={handleClick}
          className={cn(
            "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-all duration-150 cursor-pointer",
            "hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 text-sm",
            isSelected
              ? "bg-blue-50/90 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400"
              : "text-slate-600 dark:text-slate-300"
          )}
          style={{ paddingLeft: `${8 + level * 16}px` }}
        >
          <CollectionIcon className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 truncate text-left">{collection.name}</span>
          {(hasChildren || hasNotes) && (
            <>
              <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                {collection.item_count}
              </span>
              <div onClick={handleToggleExpand} className="flex-shrink-0 p-0.5">
                <ChevronUp
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-200 text-slate-400",
                    !isExpanded && "rotate-180"
                  )}
                />
              </div>
            </>
          )}
        </button>
      </div>

      {/* 展开内容：混合排序的子合集和笔记 */}
      {isExpanded && (
        <div className="mt-0.5 max-h-80 overflow-y-auto scrollbar-hide">
          {mixedItems.map((item) =>
            item.type === "collection" ? (
              <CollectionItem
                key={`collection-${item.data.id}`}
                collection={item.data}
                level={level + 1}
                childCollections={allCollections.filter((c) => c.parent_id === item.data.id)}
                allCollections={allCollections}
                onEdit={onEdit}
              />
            ) : (
              <CollectionNoteItem
                key={`note-${item.data.id}`}
                item={item.data}
                level={level}
                currentCollectionId={collection.id}
              />
            )
          )}
        </div>
      )}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative w-full max-w-md mx-4 p-6 bg-white dark:bg-neutral-900 rounded-lg shadow-2xl border border-slate-200 dark:border-neutral-700">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              确定要删除整个合集吗?
            </h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
              确定要永久删除合集「{collection.name}」吗？此操作会移除合集中的所有内容，且无法撤销。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 rounded-md transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-neutral-700 hover:bg-slate-300 dark:hover:bg-neutral-600 rounded-md transition-colors cursor-pointer"
              >
                永久删除
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
