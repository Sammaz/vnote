import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { MoreHorizontal, Edit2, Trash2, BookOpen, GripVertical, CheckSquare, Square, Plus, FolderOpen, ArrowLeft } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { useApp } from "../../context/AppContext";
import { useCollections } from "../../context/CollectionsContext";
import { useInitializationRuntime } from "../../context/InitializationRuntimeContext";
import { CreateCollectionModal } from "./CreateCollectionModal";
import { AddNotesToCollectionModal } from "./AddNotesToCollectionModal";
import { BatchActionBar } from "./BatchActionBar";
import { MoveToCollectionModal } from "./MoveToCollectionModal";
import { NoteCard } from "../Notes/NoteCard";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { CollectionItem as CollectionItemType, Note, Collection } from "../../types";

interface NoteWithDetails extends CollectionItemType {
  note: Note;
}

// 混合列表项类型
type MixedItem =
  | { type: "collection"; data: Collection; sortKey: string }
  | { type: "note"; data: NoteWithDetails; sortKey: string };

// 可排序的混合卡片组件
function SortableMixedCard({
  item,
  onOpenNote,
  onOpenCollection,
  onDeleteNote,
  isSelecting,
  isSelected,
  onToggleSelect,
}: {
  item: MixedItem;
  onOpenNote: (noteId: string) => void;
  onOpenCollection: (collectionId: string) => void;
  onDeleteNote: (item: NoteWithDetails, triggerRect?: DOMRect | null) => void;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: (noteId: string) => void;
}) {
  const glassCard = useGlassBg("card");
  const glassMenu = useGlassBg("menu");
  const noteCardRef = useRef<HTMLDivElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.sortKey });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (item.type === "collection") {
    // 获取显示的封面：优先使用 cover_image，其次使用 first_item_cover
    const displayCover = item.data.cover_image || item.data.first_item_cover;

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn("relative group", isDragging && "opacity-50 z-50")}
      >
        <div
          onClick={() => onOpenCollection(item.data.id)}
          className={cn(
            "group relative rounded-xl overflow-hidden cursor-pointer",
            glassCard, "border border-slate-200/60 dark:border-vnote-border/60",
            "shadow-sm hover:shadow-xl"
          )}
        >
          <div className="aspect-video bg-slate-100 dark:bg-vnote-surface relative overflow-hidden">
            {displayCover ? (
              <>
                <img
                  src={convertFileSrc(displayCover)}
                  alt={item.data.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors duration-200" />
              </>
            ) : (
              <>
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 dark:from-vnote-surface to-slate-200 dark:to-vnote-elevated">
                  <FolderOpen className="w-12 h-12 text-slate-400 dark:text-vnote-muted" />
                </div>
                <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors duration-200" />
              </>
            )}
          </div>
          <div className="p-4">
            <h3 className="font-medium text-slate-700 dark:text-slate-100 truncate group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
              {item.data.name}
            </h3>
            <p className="text-xs text-slate-500 mt-2">
              {item.data.item_count} 项内容
            </p>
          </div>
        </div>
        <div
          {...attributes}
          {...listeners}
          className={cn(
            "absolute top-2 left-2 p-1.5 rounded-lg transition-all cursor-grab z-10",
            "opacity-0 group-hover:opacity-100",
            glassMenu,
            "hover:bg-slate-100 dark:hover:bg-neutral-700",
            "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          )}
          title="拖拽排序"
        >
          <GripVertical className="w-4 h-4" />
        </div>
      </div>
    );
  }

  // Note card
  const noteItem = item.data;
  const handleClick = () => {
    if (isSelecting) {
      onToggleSelect(noteItem.note_id);
    } else {
      onOpenNote(noteItem.note_id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative group",
        isDragging && "opacity-50 z-50",
        isSelecting && isSelected && "ring-2 ring-blue-500 rounded-lg"
      )}
    >
      {isSelecting && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(noteItem.note_id);
          }}
          className={cn("absolute top-2 left-2 z-20 p-1 rounded cursor-pointer", glassMenu)}
        >
          {isSelected ? (
            <CheckSquare className="w-5 h-5 text-blue-500" />
          ) : (
            <Square className="w-5 h-5 text-slate-500" />
          )}
        </div>
      )}
      <div ref={noteCardRef} onClick={handleClick} className="cursor-pointer">
        <NoteCard note={noteItem.note} onClick={() => {}} />
      </div>
      {!isSelecting && (
        <>
          <div
            {...attributes}
            {...listeners}
            className={cn(
              "absolute top-2 left-2 p-1.5 rounded-lg transition-all cursor-grab z-10",
              "opacity-0 group-hover:opacity-100",
              glassMenu,
              "hover:bg-slate-100 dark:hover:bg-neutral-700",
              "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            )}
            title="拖拽排序"
          >
            <GripVertical className="w-4 h-4" />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteNote(noteItem, noteCardRef.current?.getBoundingClientRect() ?? null);
            }}
            className={cn(
              "absolute top-2 right-2 p-1.5 rounded-lg transition-all cursor-pointer z-10",
              "opacity-0 group-hover:opacity-100",
              glassMenu,
              "hover:bg-red-50 dark:hover:bg-red-500/20",
              "text-slate-500 hover:text-red-500"
            )}
            title="删除笔记"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}

export function CollectionPage() {
  const {
    collections,
    selectedCollectionId,
    setSelectedNoteId,
    setCurrentView,
    setSelectedCollection,
    notes,
    deleteNote,
    deleteCollection,
    batchSelection,
    toggleNoteSelection,
    refreshCollections,
  } = useApp();
  const glassModal = useGlassBg("modal");
  const glassMenu = useGlassBg("menu");
  const glassInput = useGlassBg("input");
  const { removeNoteFromRuntime } = useInitializationRuntime();
  const { expandCollectionPathForNote, expandCollectionPath } = useCollections();

  const [collectionItems, setCollectionItems] = useState<NoteWithDetails[]>([]);
  const [mixedItems, setMixedItems] = useState<MixedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddNotesModal, setShowAddNotesModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<NoteWithDetails | null>(null);
  const [noteDeleteTriggerRect, setNoteDeleteTriggerRect] = useState<DOMRect | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const collection = collections.find((c) => c.id === selectedCollectionId);
  const parentCollection = collection?.parent_id
    ? collections.find((c) => c.id === collection.parent_id)
    : null;

  // 获取子合集
  const childCollections = useMemo(() => {
    return collections.filter((c) => c.parent_id === selectedCollectionId);
  }, [collections, selectedCollectionId]);

  // 构建混合列表
  useEffect(() => {
    const collectionMixedItems: MixedItem[] = childCollections.map((c) => ({
      type: "collection" as const,
      data: c,
      sortKey: `collection-${c.id}`,
    }));

    const noteMixedItems: MixedItem[] = collectionItems.map((item) => ({
      type: "note" as const,
      data: item,
      sortKey: `note-${item.note_id}`,
    }));

    // 合并并按 sort_order 排序
    const allItems = [...collectionMixedItems, ...noteMixedItems].sort((a, b) => {
      const aOrder = a.type === "collection" ? a.data.sort_order : a.data.sort_order;
      const bOrder = b.type === "collection" ? b.data.sort_order : b.data.sort_order;
      return aOrder - bOrder;
    });

    setMixedItems(allItems);
  }, [childCollections, collectionItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleBackToParent = () => {
    if (collection?.parent_id) {
      expandCollectionPath(collection.parent_id);
      setSelectedCollection(collection.parent_id);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedCollectionId) return;

    const oldIndex = mixedItems.findIndex((item) => item.sortKey === active.id);
    const newIndex = mixedItems.findIndex((item) => item.sortKey === over.id);

    const newItems = arrayMove(mixedItems, oldIndex, newIndex);

    // 立即更新本地状态，避免闪烁
    setMixedItems(newItems);

    // 同步更新 collectionItems 的 sort_order
    const updatedCollectionItems = collectionItems.map((item) => {
      const newItemIndex = newItems.findIndex(
        (ni) => ni.type === "note" && ni.data.note_id === item.note_id
      );
      if (newItemIndex !== -1) {
        return { ...item, sort_order: newItemIndex };
      }
      return item;
    });
    setCollectionItems(updatedCollectionItems);

    try {
      // 构建混合排序数据
      const orderData: [string, string][] = newItems.map((item) => {
        if (item.type === "collection") {
          return ["collection", item.data.id];
        } else {
          return ["note", item.data.note_id];
        }
      });

      await invoke("update_collection_mixed_order", {
        parentId: selectedCollectionId,
        items: orderData,
      });

      // 刷新 collections 数据以保持同步
      await refreshCollections();
    } catch (error) {
      console.error("Failed to update order:", error);
      // 恢复原来的顺序
      setMixedItems(mixedItems);
      setCollectionItems(collectionItems);
    }
  };

  // 加载合集内容
  const loadCollectionItems = async () => {
    if (!selectedCollectionId) return;

    setIsLoading(true);
    try {
      const items = await invoke<CollectionItemType[]>("get_collection_items", {
        collectionId: selectedCollectionId,
      });

      const itemsWithNotes: NoteWithDetails[] = items
        .map((item) => ({
          ...item,
          note: notes.find((n) => n.id === item.note_id),
        }))
        .filter((item): item is NoteWithDetails => item.note !== undefined);

      setCollectionItems(itemsWithNotes);
    } catch (error) {
      console.error("Failed to load collection items:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCollectionItems();
  }, [selectedCollectionId, notes]);

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const handleMenuClick = () => {
    if (!showMenu && menuTriggerRef.current) {
      const rect = menuTriggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 176,
      });
    }
    setShowMenu(!showMenu);
  };

  const handleDeleteCollection = async () => {
    if (!selectedCollectionId) return;
    setShowDeleteConfirm(false);
    try {
      await deleteCollection(selectedCollectionId);
      setCurrentView("home");
    } catch (error) {
      console.error("Failed to delete collection:", error);
    }
  };

  const handleCancelDeleteNote = useCallback(() => {
    setNoteToDelete(null);
    setNoteDeleteTriggerRect(null);
  }, []);

  const handleDeleteNote = async () => {
    if (!noteToDelete) return;
    try {
      // 先从初始化运行任务中移除（包括中止正在运行的任务）
      await removeNoteFromRuntime(noteToDelete.note_id);
      await deleteNote(noteToDelete.note_id);
      setCollectionItems((prev) => prev.filter((item) => item.note_id !== noteToDelete.note_id));
    } catch (error) {
      console.error("Failed to delete note:", error);
    } finally {
      handleCancelDeleteNote();
    }
  };

  const handleOpenNote = async (noteId: string) => {
    await expandCollectionPathForNote(noteId);
    setSelectedNoteId(noteId);
    setCurrentView("note");
  };

  const handleOpenChildCollection = (collectionId: string) => {
    setSelectedCollection(collectionId);
  };

  // 判断是否有内容（子合集或笔记）
  const hasContent = childCollections.length > 0 || collectionItems.length > 0;

  // 计算合集下所有内容（递归）
  const deleteStats = useMemo(() => {
    const countDescendants = (parentId: string): { collections: number; notes: number } => {
      const children = collections.filter((c) => c.parent_id === parentId);
      let totalCollections = children.length;
      let totalNotes = children.reduce((sum, c) => sum + c.item_count, 0);

      for (const child of children) {
        const childStats = countDescendants(child.id);
        totalCollections += childStats.collections;
        totalNotes += childStats.notes;
      }

      return { collections: totalCollections, notes: totalNotes };
    };

    if (!selectedCollectionId) return { collections: 0, notes: 0 };

    const current = collections.find((c) => c.id === selectedCollectionId);
    const descendants = countDescendants(selectedCollectionId);

    return {
      collections: descendants.collections,
      notes: (current?.item_count || 0) + descendants.notes,
    };
  }, [collections, selectedCollectionId]);

  if (!collection) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
        请选择一个合集
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/20 dark:bg-vnote-bg/10 backdrop-blur-[2px]">
      {/* 批量操作工具栏 */}
      {batchSelection.isSelecting && selectedCollectionId && (
        <BatchActionBar
          collectionId={selectedCollectionId}
          totalCount={collectionItems.length}
          onMoveClick={() => setShowMoveModal(true)}
        />
      )}

      {/* 头部区域 */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-start gap-4">
          {/* 封面图片 */}
          {collection.cover_image && (
            <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-slate-200 dark:bg-neutral-700">
              <img
                src={convertFileSrc(collection.cover_image)}
                alt={collection.name}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              {parentCollection && (
                <button
                  onClick={handleBackToParent}
                  className="flex-shrink-0 p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors cursor-pointer"
                  title={`返回到 ${parentCollection.name}`}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 truncate">
                {collection.name}
              </h1>
              <div className="flex-1" />
              <button
                onClick={() => setShowAddNotesModal(true)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer",
                  "text-slate-600 dark:text-slate-300 text-sm",
                  glassInput,
                  "border border-slate-200 dark:border-neutral-600",
                  "hover:bg-slate-50 dark:hover:bg-neutral-600"
                )}
              >
                <Plus className="w-4 h-4" />
                <span>添加笔记</span>
              </button>
              <button
                ref={menuTriggerRef}
                onClick={handleMenuClick}
                className={cn(
                  "flex-shrink-0 p-2 rounded-lg transition-colors cursor-pointer",
                  "text-slate-500 dark:text-slate-400",
                  "hover:bg-slate-200 dark:hover:bg-neutral-700"
                )}
                title="更多操作"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
            </div>
            {collection.description && (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">
                {collection.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-6 border-t border-slate-200 dark:border-neutral-700" />

      {/* 内容列表 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BookOpen className="w-12 h-12 text-slate-500 dark:text-slate-600 mb-4" />
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              这个合集还没有内容。
            </p>
            <button
              onClick={() => setShowAddNotesModal(true)}
              className={cn(
                "px-4 py-2 rounded-lg transition-colors cursor-pointer",
                glassInput,
                "text-slate-700 dark:text-slate-200 text-sm",
                "border border-slate-200 dark:border-neutral-600",
                "hover:bg-slate-50 dark:hover:bg-neutral-600"
              )}
            >
              去添加内容
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={mixedItems.map((item) => item.sortKey)}
              strategy={rectSortingStrategy}
            >
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {mixedItems.map((item) => (
                    <SortableMixedCard
                      key={item.sortKey}
                      item={item}
                      onOpenNote={handleOpenNote}
                      onOpenCollection={handleOpenChildCollection}
                      onDeleteNote={(item, triggerRect) => {
                        setNoteToDelete(item);
                        setNoteDeleteTriggerRect(triggerRect ?? null);
                      }}
                      isSelecting={batchSelection.isSelecting}
                      isSelected={item.type === "note" && batchSelection.selectedNoteIds.has(item.data.note_id)}
                      onToggleSelect={toggleNoteSelection}
                    />
                  ))}
                </div>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* 编辑弹窗 */}
      {showEditModal && (
        <CreateCollectionModal
          onClose={() => setShowEditModal(false)}
          editingCollection={collection}
        />
      )}

      {/* 更多操作下拉菜单 */}
      {showMenu && createPortal(
        <div
          ref={menuRef}
          className={cn("fixed w-44 py-1 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl z-[9999]", glassMenu)}
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <button
            onClick={() => {
              setShowMenu(false);
              setShowEditModal(true);
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
          >
            <Edit2 className="w-4 h-4" />
            <span>编辑信息</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />

          <button
            onClick={() => {
              setShowMenu(false);
              setShowDeleteConfirm(true);
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>删除合集</span>
          </button>
        </div>,
        document.body
      )}

      {/* 删除合集确认弹窗 */}
      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className={cn("relative w-full max-w-md mx-4 p-6 rounded-lg shadow-2xl border border-slate-200 dark:border-neutral-700", glassModal)}>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              确定要删除整个合集吗?
            </h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
              确定要永久删除合集「{collection.name}」吗？
              {(deleteStats.collections > 0 || deleteStats.notes > 0) && (
                <>
                  此合集包含
                  {deleteStats.collections > 0 && ` ${deleteStats.collections} 个子合集`}
                  {deleteStats.collections > 0 && deleteStats.notes > 0 && "、"}
                  {deleteStats.notes > 0 && ` ${deleteStats.notes} 篇笔记`}
                  ，
                </>
              )}
              此操作无法撤销。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 rounded-md transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleDeleteCollection}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors cursor-pointer"
              >
                永久删除
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={noteToDelete !== null}
        title="确认删除"
        message={noteToDelete ? `你将删除笔记“${noteToDelete.note.title}”。\n删除后将无法恢复。` : ""}
        confirmText="确认删除"
        cancelText="取消"
        onConfirm={handleDeleteNote}
        onCancel={handleCancelDeleteNote}
        danger
        placement="anchored"
        triggerRect={noteDeleteTriggerRect}
      />

      {/* 添加笔记弹窗 */}
      {showAddNotesModal && selectedCollectionId && (
        <AddNotesToCollectionModal
          collectionId={selectedCollectionId}
          onClose={() => setShowAddNotesModal(false)}
          onSuccess={loadCollectionItems}
        />
      )}

      {/* 移动到合集弹窗 */}
      {showMoveModal && selectedCollectionId && (
        <MoveToCollectionModal
          fromCollectionId={selectedCollectionId}
          noteIds={Array.from(batchSelection.selectedNoteIds)}
          onClose={() => setShowMoveModal(false)}
          onSuccess={loadCollectionItems}
        />
      )}
    </div>
  );
}
