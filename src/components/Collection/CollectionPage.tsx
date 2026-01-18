import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  List,
  Plus,
  MoreHorizontal,
  Edit2,
  Trash2,
  FileText,
  Video,
  BookOpen,
  Sparkles,
  Network,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { CreateCollectionModal } from "./CreateCollectionModal";
import type { CollectionItem as CollectionItemType, Note } from "../../types";

interface NoteWithDetails extends CollectionItemType {
  note: Note;
}

export function CollectionPage() {
  const {
    collections,
    selectedCollectionId,
    removeNoteFromCollection,
    setSelectedNoteId,
    setCurrentView,
    notes,
    deleteCollection,
  } = useApp();

  const [collectionItems, setCollectionItems] = useState<NoteWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const collection = collections.find((c) => c.id === selectedCollectionId);

  // 加载合集内容
  useEffect(() => {
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
        left: rect.right - 220,
      });
    }
    setShowMenu(!showMenu);
  };

  const handleRemoveNote = async (noteId: number) => {
    if (!selectedCollectionId) return;
    try {
      await removeNoteFromCollection(selectedCollectionId, noteId);
      setCollectionItems((prev) => prev.filter((item) => item.note_id !== noteId));
    } catch (error) {
      console.error("Failed to remove note from collection:", error);
    }
  };

  const handleOpenNote = (noteId: number) => {
    setSelectedNoteId(noteId);
    setCurrentView("note");
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

  if (!collection) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
        请选择一个合集
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100 dark:bg-neutral-900">
      {/* 头部卡片区域 */}
      <div className="flex-shrink-0 m-4 mb-0 p-5 bg-white dark:bg-vnote-card rounded-xl border border-slate-200 dark:border-transparent">
        {/* 标题行 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <List className="w-6 h-6 text-slate-600 dark:text-slate-300" />
            <div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                {collection.name}
              </h1>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-0.5">
                {collection.description || "暂无描述"}
              </p>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <button
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer",
                "bg-slate-100 dark:bg-neutral-700",
                "text-slate-600 dark:text-slate-300 text-sm",
                "hover:bg-slate-200 dark:hover:bg-neutral-600"
              )}
            >
              <Plus className="w-4 h-4" />
              <span>批量添加</span>
            </button>
            <button
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer",
                "text-pink-500 dark:text-pink-400 text-sm",
                "hover:bg-pink-50 dark:hover:bg-pink-500/10"
              )}
            >
              <Sparkles className="w-4 h-4" />
              <span>Ask AI</span>
            </button>
            <button
              ref={menuTriggerRef}
              onClick={handleMenuClick}
              className={cn(
                "p-2 rounded-lg transition-colors cursor-pointer",
                "text-slate-500 dark:text-slate-400",
                "hover:bg-slate-100 dark:hover:bg-neutral-700"
              )}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 归纳总结卡片 */}
        <div className="mt-4 p-4 bg-slate-50 dark:bg-neutral-800/50 rounded-xl border border-slate-200 dark:border-neutral-600">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-500/20 rounded-full">
                <BookOpen className="w-5 h-5 text-blue-500" />
              </div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                归纳总结
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
              <button className="flex items-center gap-1.5 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">
                <Network className="w-3.5 h-3.5" />
                <span>思维导图</span>
              </button>
              <button className="flex items-center gap-1.5 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">
                <Edit2 className="w-3.5 h-3.5" />
                <span>编辑</span>
              </button>
              <button className="flex items-center gap-1.5 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">
                <RefreshCw className="w-3.5 h-3.5" />
                <span>重新总结</span>
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-400 dark:text-slate-500 text-center py-4">
            基于合集中所有视频内容生成归纳总结
          </p>
        </div>

        {/* 统计行 */}
        <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          {collectionItems.length} 项内容
        </div>
      </div>

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
          <div className="p-6 space-y-2">
            {collectionItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl transition-all cursor-pointer group",
                  "bg-white dark:bg-vnote-card",
                  "border border-slate-200 dark:border-vnote-border",
                  "hover:border-blue-300 dark:hover:border-blue-500/50",
                  "hover:shadow-md"
                )}
                onClick={() => handleOpenNote(item.note_id)}
              >
                <div className="flex-shrink-0 p-2.5 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                  <Video className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {item.note.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    添加于 {new Date(item.created_at).toLocaleDateString("zh-CN")}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveNote(item.note_id);
                  }}
                  className={cn(
                    "p-2 rounded-lg transition-all cursor-pointer",
                    "opacity-0 group-hover:opacity-100",
                    "hover:bg-red-50 dark:hover:bg-red-500/10",
                    "text-slate-400 hover:text-red-500"
                  )}
                  title="从合集移除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 下拉菜单 - Portal */}
      {showMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed w-56 py-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl z-[9999]"
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
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>导出总结 (Markdown)</span>
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
            <span>删除整个合集</span>
          </button>
        </div>,
        document.body
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
                onClick={handleDeleteCollection}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-neutral-700 hover:bg-slate-300 dark:hover:bg-neutral-600 rounded-md transition-colors cursor-pointer"
              >
                永久删除
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 编辑弹窗 */}
      {showEditModal && (
        <CreateCollectionModal
          onClose={() => setShowEditModal(false)}
          editingCollection={collection}
        />
      )}
    </div>
  );
}
