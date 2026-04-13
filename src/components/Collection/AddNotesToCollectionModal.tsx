import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Video, Check, Search } from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { useApp } from "../../context/AppContext";

interface AddNotesToCollectionModalProps {
  collectionId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddNotesToCollectionModal({
  collectionId,
  onClose,
  onSuccess,
}: AddNotesToCollectionModalProps) {
  const { notes, addNoteToCollection, notesInCollections } = useApp();
  const glassModal = useGlassBg("modal");
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 过滤出未添加到任何合集的笔记，保持后端返回的稳定排序（created_at DESC, rowid DESC）
  const availableNotes = useMemo(() => {
    return notes.filter((note) => !notesInCollections.has(note.id)).reverse();
  }, [notes, notesInCollections]);

  // 搜索过滤
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return availableNotes;
    const query = searchQuery.toLowerCase();
    return availableNotes.filter((note) =>
      note.title.toLowerCase().includes(query)
    );
  }, [availableNotes, searchQuery]);

  const toggleNoteSelection = (noteId: string) => {
    setSelectedNoteIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(noteId)) {
        newSet.delete(noteId);
      } else {
        newSet.add(noteId);
      }
      return newSet;
    });
  };

  const isAllSelected = filteredNotes.length > 0 && filteredNotes.every((n) => selectedNoteIds.has(n.id));

  const toggleSelectAll = () => {
    setSelectedNoteIds(isAllSelected ? new Set() : new Set(filteredNotes.map((n) => n.id)));
  };

  const handleSubmit = async () => {
    if (selectedNoteIds.size === 0) return;

    setIsSubmitting(true);
    try {
      for (const note of filteredNotes) {
        if (selectedNoteIds.has(note.id)) {
          await addNoteToCollection(collectionId, note.id);
        }
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to add notes to collection:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div className={cn("relative w-full max-w-2xl max-h-[80vh] mx-4 rounded-lg shadow-2xl animate-fade-in border border-slate-300 dark:border-neutral-600 flex flex-col", glassModal)}>
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer z-10"
        >
          <X className="w-5 h-5 text-slate-500 dark:text-neutral-300" />
        </button>

        {/* 头部 */}
        <div className="p-6 pb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            添加笔记到合集
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-neutral-300">
            选择要添加到合集的笔记
          </p>

          {/* 搜索框 */}
          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-neutral-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索笔记..."
              className={cn(
                "w-full pl-10 pr-4 py-2.5 rounded-lg border transition-colors",
                "bg-slate-50 dark:bg-neutral-800",
                "border-slate-300 dark:border-neutral-600",
                "focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20",
                "text-slate-800 dark:text-slate-200 text-sm",
                "placeholder:text-slate-500 dark:placeholder:text-neutral-400"
              )}
            />
          </div>
        </div>

        {/* 全选 */}
        {filteredNotes.length > 0 && (
          <label onClick={toggleSelectAll} className="mx-6 mt-3 mb-1 pb-3 border-b border-slate-200 dark:border-neutral-700 flex items-center gap-2 cursor-pointer text-sm text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-300 transition-colors">
            <div className={cn("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", isAllSelected ? "bg-blue-500 border-blue-500" : "border-slate-300 dark:border-neutral-600")}>
              {isAllSelected && <Check className="w-2.5 h-2.5 text-white" />}
            </div>
            全选
          </label>
        )}

        {/* 笔记列表 */}
        <div className="flex-1 overflow-y-auto px-6">
          {filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Video className="w-12 h-12 text-slate-400 dark:text-neutral-500 mb-4" />
              <p className="text-slate-500 dark:text-neutral-400">
                {availableNotes.length === 0
                  ? "没有可添加的笔记"
                  : "没有找到匹配的笔记"}
              </p>
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => toggleNoteSelection(note.id)}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl transition-all cursor-pointer",
                    "border",
                    selectedNoteIds.has(note.id)
                      ? "bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/50"
                      : "bg-slate-50 dark:bg-neutral-800 border-slate-200 dark:border-neutral-700 hover:border-slate-300 dark:hover:border-neutral-600"
                  )}
                >
                  {/* 选择框 */}
                  <div
                    className={cn(
                      "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                      selectedNoteIds.has(note.id)
                        ? "bg-blue-500 border-blue-500"
                        : "border-slate-300 dark:border-neutral-600"
                    )}
                  >
                    {selectedNoteIds.has(note.id) && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>

                  {/* 图标 */}
                  <div className="flex-shrink-0 p-2.5 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                    <Video className="w-5 h-5 text-blue-500" />
                  </div>

                  {/* 笔记信息 */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                      {note.title}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      创建于 {new Date(note.created_at).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex-shrink-0 p-6 pt-4 border-t border-slate-200 dark:border-neutral-700 flex items-center justify-between">
          <span className="text-sm text-slate-500 dark:text-neutral-400">
            已选择 {selectedNoteIds.size} 项
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className={cn(
                "px-4 py-2 rounded-md transition-colors cursor-pointer text-sm",
                "text-slate-600 dark:text-slate-300",
                "hover:bg-slate-100 dark:hover:bg-neutral-800"
              )}
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={selectedNoteIds.size === 0 || isSubmitting}
              className={cn(
                "px-4 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
                "bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 dark:hover:bg-white",
                "text-white dark:text-slate-900",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isSubmitting ? "添加中..." : `添加 ${selectedNoteIds.size} 项`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
