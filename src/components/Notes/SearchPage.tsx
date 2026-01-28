import { useState, useMemo } from "react";
import { ArrowLeft, Search, FileText, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { VirtualizedNoteGrid } from "./VirtualizedNoteGrid";

export function SearchPage() {
  const { notes, setSelectedNoteId, setCurrentView } = useApp();
  const [searchQuery, setSearchQuery] = useState("");

  // 模糊搜索笔记
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) {
      return notes;
    }
    const query = searchQuery.toLowerCase().trim();
    return notes.filter((note) =>
      note.title.toLowerCase().includes(query)
    );
  }, [notes, searchQuery]);

  const handleOpenNote = (noteId: string) => {
    setSelectedNoteId(noteId);
    setCurrentView("note");
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100 dark:bg-neutral-900">
      {/* 头部区域 */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setCurrentView("home")}
            className={cn(
              "p-1.5 rounded-lg transition-colors cursor-pointer",
              "text-slate-400 dark:text-slate-500",
              "hover:text-slate-600 dark:hover:text-slate-300",
              "hover:bg-slate-200 dark:hover:bg-neutral-700"
            )}
            title="返回首页"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            全局搜索
          </h1>
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-slate-400 dark:text-slate-500" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索笔记标题..."
            className={cn(
              "w-full pl-12 pr-10 py-3 rounded-xl",
              "bg-white/80 dark:bg-neutral-800/80",
              "border border-slate-200 dark:border-neutral-700",
              "text-slate-700 dark:text-slate-200",
              "placeholder:text-slate-400 dark:placeholder:text-slate-500",
              "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50",
              "backdrop-blur-sm transition-all duration-200"
            )}
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className={cn(
                "absolute inset-y-0 right-0 pr-4 flex items-center cursor-pointer",
                "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300",
                "transition-colors"
              )}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 搜索结果统计 */}
        <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          {searchQuery.trim() ? (
            <span>
              找到 <span className="font-medium text-slate-700 dark:text-slate-200">{filteredNotes.length}</span> 条结果
            </span>
          ) : (
            <span>共 {notes.length} 条笔记</span>
          )}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-6 border-t border-slate-200 dark:border-neutral-700" />

      {/* 内容列表 - 使用虚拟滚动 */}
      {filteredNotes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-slate-400 dark:text-slate-600" />
          </div>
          {searchQuery.trim() ? (
            <>
              <p className="text-slate-600 dark:text-slate-300 font-medium mb-1">
                未找到匹配的笔记
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                尝试使用其他关键词搜索
              </p>
            </>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">
              还没有任何笔记
            </p>
          )}
        </div>
      ) : (
        <VirtualizedNoteGrid
          notes={filteredNotes}
          onNoteClick={handleOpenNote}
        />
      )}
    </div>
  );
}
