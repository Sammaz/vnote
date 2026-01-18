import { ArrowLeft, FileText } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { NoteCard } from "./NoteCard";

export function RecentNotesPage() {
  const { notes, setSelectedNoteId, setCurrentView } = useApp();

  // 取最近 12 条笔记
  const recentNotes = notes.slice(0, 12);

  const handleOpenNote = (noteId: number) => {
    setSelectedNoteId(noteId);
    setCurrentView("note");
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100 dark:bg-neutral-900">
      {/* 头部区域 */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
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
            最近笔记
          </h1>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-6 border-t border-slate-200 dark:border-neutral-700" />

      {/* 内容列表 */}
      <div className="flex-1 overflow-y-auto">
        {recentNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-12 h-12 text-slate-500 dark:text-slate-600 mb-4" />
            <p className="text-slate-500 dark:text-slate-400">
              还没有任何笔记
            </p>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {recentNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onClick={() => handleOpenNote(note.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
