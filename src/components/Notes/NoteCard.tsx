import { Video, Calendar, Clock } from "lucide-react";
import { cn } from "../../utils/cn";
import type { Note } from "../../types";

interface NoteCardProps {
  note: Note;
  onClick?: () => void;
}

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;

  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:00`;
  }
  return `${minutes}:00`;
}

export function NoteCard({ note, onClick }: NoteCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "note-card group relative rounded-xl overflow-hidden",
        "bg-white dark:bg-vnote-card border border-slate-200 dark:border-vnote-border",
        "cursor-pointer"
      )}
    >
      {/* 缩略图区域 */}
      <div className="aspect-video bg-slate-100 dark:bg-vnote-surface relative overflow-hidden">
        {note.thumbnailPath ? (
          <img
            src={note.thumbnailPath}
            alt={note.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 dark:from-vnote-surface to-slate-200 dark:to-vnote-elevated">
            <Video className="w-12 h-12 text-slate-400 dark:text-vnote-muted" />
          </div>
        )}

        {/* 时长标签 */}
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/70 text-xs text-white font-medium">
          {formatDuration(note.duration)}
        </div>

        {/* 悬停遮罩 */}
        <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors duration-200" />
      </div>

      {/* 信息区域 */}
      <div className="p-4">
        <h3 className="font-medium text-slate-700 dark:text-slate-100 truncate group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
          {note.title}
        </h3>
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(note.createdAt)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {formatDuration(note.duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
