import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { MoreHorizontal, Edit2, Trash2, BookOpen, GripVertical, CheckSquare, Square, Plus } from "lucide-react";
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
import { useApp } from "../../context/AppContext";
import { CreateCollectionModal } from "./CreateCollectionModal";
import { AddNotesToCollectionModal } from "./AddNotesToCollectionModal";
import { BatchActionBar } from "./BatchActionBar";
import { MoveToCollectionModal } from "./MoveToCollectionModal";
import { NoteCard } from "../Notes/NoteCard";
import type { CollectionItem as CollectionItemType, Note } from "../../types";

interface NoteWithDetails extends CollectionItemType {
  note: Note;
}

interface SortableCardProps {
  item: NoteWithDetails;
  onOpenNote: (noteId: number) => void;
  onDelete: (item: NoteWithDetails) => void;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: (noteId: number) => void;
}

function SortableCard({ item, onOpenNote, onDelete, isSelecting, isSelected, onToggleSelect }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => {
    if (isSelecting) {
      onToggleSelect(item.note_id);
    } else {
      onOpenNote(item.note_id);
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
            onToggleSelect(item.note_id);
          }}
          className="absolute top-2 left-2 z-20 p-1 rounded bg-white/90 dark:bg-neutral-800/90 cursor-pointer"
        >
          {isSelected ? (
            <CheckSquare className="w-5 h-5 text-blue-500" />
          ) : (
            <Square className="w-5 h-5 text-slate-400" />
          )}
        </div>
      )}
      <div onClick={handleClick} className="cursor-pointer">
        <NoteCard note={item.note} onClick={() => {}} />
      </div>
      {!isSelecting && (
        <>
          <div
            {...attributes}
            {...listeners}
            className={cn(
              "absolute top-2 left-2 p-1.5 rounded-lg transition-all cursor-grab z-10",
              "opacity-0 group-hover:opacity-100",
              "bg-white/90 dark:bg-neutral-800/90",
              "hover:bg-slate-100 dark:hover:bg-neutral-700",
              "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            )}
            title="拖拽排序"
          >
            <GripVertical className="w-4 h-4" />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item);
            }}
            className={cn(
              "absolute top-2 right-2 p-1.5 rounded-lg transition-all cursor-pointer z-10",
              "opacity-0 group-hover:opacity-100",
              "bg-white/90 dark:bg-neutral-800/90",
              "hover:bg-red-50 dark:hover:bg-red-500/20",
              "text-slate-400 hover:text-red-500"
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
    notes,
    deleteNote,
    deleteCollection,
    batchSelection,
    setBatchSelecting,
    toggleNoteSelection,
  } = useApp();

  const [collectionItems, setCollectionItems] = useState<NoteWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddNotesModal, setShowAddNotesModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<NoteWithDetails | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const collection = collections.find((c) => c.id === selectedCollectionId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedCollectionId) return;

    const oldIndex = collectionItems.findIndex((item) => item.id === active.id);
    const newIndex = collectionItems.findIndex((item) => item.id === over.id);

    const newItems = arrayMove(collectionItems, oldIndex, newIndex);
    setCollectionItems(newItems);

    try {
      await invoke("update_collection_items_order", {
        collectionId: selectedCollectionId,
        noteIds: newItems.map((item) => item.note_id),
      });
    } catch (error) {
      console.error("Failed to update order:", error);
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

  const handleDeleteNote = async () => {
    if (!noteToDelete) return;
    try {
      await deleteNote(noteToDelete.note_id);
      setCollectionItems((prev) => prev.filter((item) => item.note_id !== noteToDelete.note_id));
    } catch (error) {
      console.error("Failed to delete note:", error);
    } finally {
      setNoteToDelete(null);
    }
  };

  const handleOpenNote = (noteId: number) => {
    setSelectedNoteId(noteId);
    setCurrentView("note");
  };

  if (!collection) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
        请选择一个合集
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100 dark:bg-neutral-900">
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
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 truncate">
                {collection.name}
              </h1>
              <div className="flex-1" />
              <button
                onClick={() => setShowAddNotesModal(true)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer",
                  "text-slate-600 dark:text-slate-300 text-sm",
                  "bg-white dark:bg-neutral-700",
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
        ) : collectionItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BookOpen className="w-12 h-12 text-slate-500 dark:text-slate-600 mb-4" />
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              这个合集还没有内容。
            </p>
            <button
              onClick={() => setShowAddNotesModal(true)}
              className={cn(
                "px-4 py-2 rounded-lg transition-colors cursor-pointer",
                "bg-white dark:bg-neutral-700",
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
              items={collectionItems.map((item) => item.id)}
              strategy={rectSortingStrategy}
            >
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {collectionItems.map((item) => (
                    <SortableCard
                      key={item.id}
                      item={item}
                      onOpenNote={handleOpenNote}
                      onDelete={setNoteToDelete}
                      isSelecting={batchSelection.isSelecting}
                      isSelected={batchSelection.selectedNoteIds.has(item.note_id)}
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
          className="fixed w-44 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl z-[9999]"
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

      {/* 删除笔记确认弹窗 */}
      {noteToDelete && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setNoteToDelete(null)}
          />
          <div className="relative w-full max-w-md mx-4 p-6 bg-white dark:bg-neutral-900 rounded-lg shadow-2xl border border-slate-200 dark:border-neutral-700">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              确定要删除笔记吗?
            </h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
              确定要永久删除「{noteToDelete.note.title}」吗？此操作无法撤销。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setNoteToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 rounded-md transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleDeleteNote}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors cursor-pointer"
              >
                删除
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 添加笔记弹窗 */}
      {showAddNotesModal && selectedCollectionId && (
        <AddNotesToCollectionModal
          collectionId={selectedCollectionId}
          existingNoteIds={collectionItems.map((item) => item.note_id)}
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
