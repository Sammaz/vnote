import { useState } from "react";
import { createPortal } from "react-dom";
import { X, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useGlassBg } from "../../hooks/useGlassBg";
import type { Note } from "../../types";

interface EditNoteModalProps {
  note: Note;
  onClose: () => void;
}

export function EditNoteModal({ note, onClose }: EditNoteModalProps) {
  const { updateNote } = useApp();
  const glassModal = useGlassBg("modal");
  const [title, setTitle] = useState(note.title);
  const [videoPath, setVideoPath] = useState(note.video_path);
  const [subtitlePath, setSubtitlePath] = useState(note.subtitle_path ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBrowseVideo = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Video", extensions: ["mp4", "mkv", "avi", "mov", "webm", "ts", "flv"] }],
      });
      if (selected) setVideoPath(selected as string);
    } catch (err) {
      console.error("Failed to select video:", err);
    }
  };

  const handleBrowseSubtitle = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Subtitle", extensions: ["srt", "vtt", "ass", "ssa", "txt"] }],
      });
      if (selected) setSubtitlePath(selected as string);
    } catch (err) {
      console.error("Failed to select subtitle:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await updateNote({
        id: note.id,
        title: title.trim(),
        video_path: videoPath,
        subtitle_path: subtitlePath.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-lg mx-4 ${glassModal} rounded-lg shadow-2xl animate-fade-in border border-slate-200 dark:border-neutral-700`}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5 text-slate-600 dark:text-neutral-400" />
        </button>

        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">编辑笔记</h2>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            {/* 标题 */}
            <div className="flex items-start gap-4">
              <label className="w-16 flex-shrink-0 text-sm text-slate-600 dark:text-neutral-400 pt-2.5">标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={cn(
                  "flex-1 px-3 py-2.5 rounded-md border transition-colors",
                  "bg-slate-50 dark:bg-neutral-800",
                  "border-slate-200 dark:border-neutral-700",
                  "focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20",
                  "text-slate-800 dark:text-slate-200 text-sm",
                  "placeholder:text-slate-500 dark:placeholder:text-neutral-500"
                )}
                autoFocus
              />
            </div>

            {/* 视频路径 */}
            <div className="flex items-start gap-4">
              <label className="w-16 flex-shrink-0 text-sm text-slate-600 dark:text-neutral-400 pt-2.5">视频</label>
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={videoPath}
                  onChange={(e) => setVideoPath(e.target.value)}
                  className={cn(
                    "flex-1 px-3 py-2.5 rounded-md border transition-colors",
                    "bg-slate-50 dark:bg-neutral-800",
                    "border-slate-200 dark:border-neutral-700",
                    "focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20",
                    "text-slate-800 dark:text-slate-200 text-sm"
                  )}
                />
                <button
                  type="button"
                  onClick={handleBrowseVideo}
                  className={cn(
                    "flex-shrink-0 p-2.5 rounded-md border transition-colors cursor-pointer",
                    "bg-slate-50 dark:bg-neutral-800",
                    "border-slate-200 dark:border-neutral-700",
                    "hover:bg-slate-100 dark:hover:bg-neutral-700",
                    "text-slate-500 dark:text-neutral-400"
                  )}
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 字幕路径 */}
            <div className="flex items-start gap-4">
              <label className="w-16 flex-shrink-0 text-sm text-slate-600 dark:text-neutral-400 pt-2.5">字幕</label>
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={subtitlePath}
                  onChange={(e) => setSubtitlePath(e.target.value)}
                  placeholder="可选"
                  className={cn(
                    "flex-1 px-3 py-2.5 rounded-md border transition-colors",
                    "bg-slate-50 dark:bg-neutral-800",
                    "border-slate-200 dark:border-neutral-700",
                    "focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20",
                    "text-slate-800 dark:text-slate-200 text-sm",
                    "placeholder:text-slate-500 dark:placeholder:text-neutral-500"
                  )}
                />
                <button
                  type="button"
                  onClick={handleBrowseSubtitle}
                  className={cn(
                    "flex-shrink-0 p-2.5 rounded-md border transition-colors cursor-pointer",
                    "bg-slate-50 dark:bg-neutral-800",
                    "border-slate-200 dark:border-neutral-700",
                    "hover:bg-slate-100 dark:hover:bg-neutral-700",
                    "text-slate-500 dark:text-neutral-400"
                  )}
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
                {subtitlePath && (
                  <button
                    type="button"
                    onClick={() => setSubtitlePath("")}
                    className={cn(
                      "flex-shrink-0 p-2.5 rounded-md border transition-colors cursor-pointer",
                      "bg-slate-50 dark:bg-neutral-800",
                      "border-slate-200 dark:border-neutral-700",
                      "hover:bg-red-50 dark:hover:bg-red-500/10",
                      "text-slate-500 hover:text-red-500"
                    )}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-500 dark:text-red-400 pl-20">{error}</div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSubmitting || !title.trim()}
                className={cn(
                  "px-4 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
                  "bg-slate-800 dark:bg-slate-100 hover:bg-slate-700 dark:hover:bg-white",
                  "text-white dark:text-slate-900",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isSubmitting ? "保存中..." : "保存修改"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
