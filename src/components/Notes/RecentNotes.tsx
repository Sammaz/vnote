import { ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useCollections } from "../../context/CollectionsContext";
import { NoteCard } from "./NoteCard";

export function RecentNotes() {
  const { notes, setSelectedNoteId, setCurrentView } = useApp();
  const { expandCollectionPathForNote } = useCollections();

  // 按时间排序，取最近 4 条（数据库已经按 created_at DESC 排序）
  const recentNotes = notes.slice(0, 4);

  if (recentNotes.length === 0) {
    return null;
  }

  return (
    <section className="animate-fade-in">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">最近笔记</h2>
        <button
          onClick={() => setCurrentView("recent-notes")}
          className={cn(
            "flex items-center gap-1 text-sm text-slate-500 hover:text-blue-400",
            "transition-colors duration-200 cursor-pointer"
          )}
        >
          查看全部
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 笔记卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {recentNotes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onClick={async () => {
              setSelectedNoteId(note.id);
              setCurrentView("note");
              await expandCollectionPathForNote(note.id);
            }}
          />
        ))}
      </div>
    </section>
  );
}
