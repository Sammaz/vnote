import { Video, Calendar } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "../../utils/cn";
import type { Note, ChapterData } from "../../types";

interface NoteCardProps {
  note: Note;
  onClick?: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;

  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

// 从 detailed_reading 中提取第一章的截图路径
function getFirstChapterScreenshot(detailedReading: string | ChapterData | null): string | null {
  if (!detailedReading) return null;

  // 如果是字符串，尝试解析为 JSON
  if (typeof detailedReading === "string") {
    try {
      const parsed = JSON.parse(detailedReading) as ChapterData;
      if (parsed.chapters && Array.isArray(parsed.chapters)) {
        // 找到第一个有截图的章节
        const chapterWithScreenshot = parsed.chapters.find(ch => ch.screenshot_path);
        return chapterWithScreenshot?.screenshot_path || null;
      }
    } catch {
      // 不是有效的 JSON，返回 null
      return null;
    }
  }

  // 如果已经是 ChapterData 对象
  if (typeof detailedReading === "object" && detailedReading.chapters) {
    const chapterWithScreenshot = detailedReading.chapters.find(ch => ch.screenshot_path);
    return chapterWithScreenshot?.screenshot_path || null;
  }

  return null;
}

export function NoteCard({ note, onClick }: NoteCardProps) {
  // 获取第一章截图路径
  const screenshotPath = getFirstChapterScreenshot(note.detailed_reading);
  const thumbnailUrl = screenshotPath ? convertFileSrc(screenshotPath) : null;

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
        {thumbnailUrl ? (
          // 显示截图
          <>
            <img
              src={thumbnailUrl}
              alt={note.title}
              className="w-full h-full object-cover"
            />
            {/* 悬停遮罩 */}
            <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors duration-200" />
          </>
        ) : (
          // 显示默认图标
          <>
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 dark:from-vnote-surface to-slate-200 dark:to-vnote-elevated">
              <Video className="w-12 h-12 text-slate-400 dark:text-vnote-muted" />
            </div>
            {/* 悬停遮罩 */}
            <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors duration-200" />
          </>
        )}
      </div>

      {/* 信息区域 */}
      <div className="p-4">
        <h3 className="font-medium text-slate-700 dark:text-slate-100 truncate group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
          {note.title}
        </h3>
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(note.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
