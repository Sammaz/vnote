import React, { useEffect } from "react";
import { X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  onConfirm,
  onCancel,
  danger = false,
}) => {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/34 backdrop-blur-md"
      onClick={onCancel}
    >
      <div
        className="w-[420px] max-w-[90vw] overflow-hidden rounded-[24px] border border-white/45 dark:border-vnote-border/80 bg-white/74 dark:bg-vnote-card/46 backdrop-blur-2xl ring-1 ring-white/30 dark:ring-white/5 shadow-[0_24px_70px_rgba(15,23,42,0.26)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-200/80 dark:border-vnote-border/80 bg-white/16 dark:bg-black/8 backdrop-blur-md">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            data-tauri-drag-region="false"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-white/10 dark:bg-black/8 backdrop-blur-md">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-white/5 border border-slate-200/80 dark:border-vnote-border/80 rounded-xl hover:bg-white/75 dark:hover:bg-white/10 transition-colors cursor-pointer"
            data-tauri-drag-region="false"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
              danger
                ? "bg-red-600 hover:bg-red-700 text-white shadow-sm"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            }`}
            data-tauri-drag-region="false"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
