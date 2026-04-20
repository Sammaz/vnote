import { memo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Video, Calendar, Edit3, Trash2 } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import type { Note, ChapterData, DetailedReadingData } from "../../types";

interface NoteCardProps {
  note: Note;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: (triggerRect?: DOMRect | null) => void;
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
function getFirstChapterScreenshot(detailedReading: string | ChapterData | DetailedReadingData | null): string | null {
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

// NoteCard 组件 - 使用 memo 优化避免不必要的重渲染
export const NoteCard = memo(function NoteCard({ note, onClick, onEdit, onDelete }: NoteCardProps) {
  const glassCard = useGlassBg("card");
  const glassMenu = useGlassBg("menu");
  // 获取第一章截图路径
  const screenshotPath = getFirstChapterScreenshot(note.detailed_reading);
  const thumbnailUrl = screenshotPath ? convertFileSrc(screenshotPath) : null;

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onEdit && !onDelete) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY });
  }, [onEdit, onDelete]);

  // 点击外部或 ESC 关闭菜单
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClose = () => setContextMenu(prev => ({ ...prev, visible: false }));
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) handleClose();
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 50);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu.visible]);

  return (
    <>
      <div
        ref={cardRef}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={cn(
          "note-card group relative rounded-xl overflow-hidden",
          glassCard, "border border-slate-200/60 dark:border-vnote-border/60",
          "shadow-sm hover:shadow-xl",
          "cursor-pointer"
        )}
      >
        {/* 缩略图区域 */}
        <div className="aspect-video bg-slate-100 dark:bg-vnote-surface relative overflow-hidden">
          {thumbnailUrl ? (
            <>
              <img src={thumbnailUrl} alt={note.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors duration-200" />
            </>
          ) : (
            <>
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 dark:from-vnote-surface to-slate-200 dark:to-vnote-elevated">
                <Video className="w-12 h-12 text-slate-500 dark:text-vnote-muted" />
              </div>
              <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors duration-200" />
            </>
          )}
        </div>

        {/* 信息区域 */}
        <div className="p-4">
          <h3 className="font-medium text-slate-700 dark:text-slate-100 truncate group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
            {note.title}
          </h3>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(note.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu.visible && createPortal(
        <div
          ref={menuRef}
          className={`fixed z-[9999] min-w-[160px] py-1 ${glassMenu} border border-slate-200 dark:border-neutral-700 rounded-lg shadow-xl`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onEdit && (
            <button
              onClick={() => { setContextMenu(prev => ({ ...prev, visible: false })); onEdit(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
            >
              <Edit3 className="w-4 h-4" />
              <span>编辑笔记</span>
            </button>
          )}
          {onEdit && onDelete && (
            <div className="my-1 border-t border-slate-100 dark:border-neutral-700" />
          )}
          {onDelete && (
            <button
              onClick={() => {
                const triggerRect = cardRef.current?.getBoundingClientRect() ?? null;
                setContextMenu(prev => ({ ...prev, visible: false }));
                onDelete(triggerRect);
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>删除笔记</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
});
