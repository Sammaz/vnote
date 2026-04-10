import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import { useGlassBg } from "../../hooks/useGlassBg";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  placement?: "center" | "anchored";
  triggerRect?: DOMRect | null;
}

interface AnchoredPosition {
  top: number;
  left: number;
  arrowTop: number;
  arrowSide: "left" | "right";
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
  placement = "center",
  triggerRect = null,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchoredPosition, setAnchoredPosition] = useState<AnchoredPosition | null>(null);
  const glassModal = useGlassBg("modal");

  const isAnchored = placement === "anchored" && triggerRect;

  const updateAnchoredPosition = useCallback(() => {
    if (!triggerRect || !panelRef.current) return;

    const panelRect = panelRef.current.getBoundingClientRect();
    const panelWidth = panelRect.width || 420;
    const panelHeight = panelRect.height || 240;
    const horizontalPadding = 12;
    const verticalPadding = 12;
    const gap = 10;
    const arrowSize = 14;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const triggerCenterY = (triggerRect.top + triggerRect.bottom) / 2;
    const spaceOnLeft = triggerRect.left - horizontalPadding;
    const spaceOnRight = viewportWidth - triggerRect.right - horizontalPadding;
    const placeOnRight = spaceOnRight >= panelWidth || spaceOnRight >= spaceOnLeft;

    const preferredLeft = placeOnRight
      ? triggerRect.right + gap
      : triggerRect.left - panelWidth - gap;
    const preferredTop = triggerCenterY - panelHeight / 2;
    const maxLeft = viewportWidth - panelWidth - horizontalPadding;
    const maxTop = viewportHeight - panelHeight - verticalPadding;
    const top = Math.max(verticalPadding, Math.min(preferredTop, Math.max(verticalPadding, maxTop)));
    const left = Math.max(horizontalPadding, Math.min(preferredLeft, Math.max(horizontalPadding, maxLeft)));
    const arrowTop = Math.max(
      22,
      Math.min(triggerCenterY - top - arrowSize / 2, panelHeight - arrowSize - 22)
    );

    setAnchoredPosition({
      top,
      left,
      arrowTop,
      arrowSide: placeOnRight ? "left" : "right",
    });
  }, [triggerRect]);

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

  useEffect(() => {
    if (!open || !isAnchored) {
      setAnchoredPosition(null);
      return;
    }

    updateAnchoredPosition();

    const handleResize = () => updateAnchoredPosition();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open, isAnchored, updateAnchoredPosition]);

  useEffect(() => {
    if (!open || !isAnchored) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onCancel();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, isAnchored, onCancel]);

  if (!open) return null;

  if (isAnchored) {
    return createPortal(
      <div className="fixed inset-0 z-[10000] pointer-events-none">
        <div
          ref={panelRef}
          className={`pointer-events-auto fixed z-[10001] w-[420px] max-w-[calc(100vw-1.5rem)] overflow-visible rounded-[22px] border border-slate-200/80 dark:border-vnote-border/80 ${glassModal} shadow-[0_24px_80px_rgba(15,23,42,0.16)] animate-fade-in`}
          style={anchoredPosition ? { top: anchoredPosition.top, left: anchoredPosition.left } : { visibility: "hidden", left: 0, top: 0 }}
        >
          {anchoredPosition && (
            <div
              className={`absolute h-3.5 w-3.5 border-t border-l border-slate-200/80 dark:border-vnote-border/80 bg-white/48 dark:bg-vnote-card/92 ${
                anchoredPosition.arrowSide === "left"
                  ? "-left-[7px] rotate-[-45deg]"
                  : "-right-[7px] rotate-[135deg]"
              }`}
              style={{ top: anchoredPosition.arrowTop }}
            />
          )}

          <div className="overflow-hidden rounded-[22px]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 bg-white/40 px-5 py-4 dark:border-vnote-border/70 dark:bg-white/5">
              <div className="min-w-0">
                <div className={`text-[11px] font-medium uppercase tracking-[0.16em] ${danger ? "text-red-500/80 dark:text-red-300/80" : "text-blue-500/80 dark:text-blue-300/80"}`}>
                  {danger ? "Danger Zone" : "Please Confirm"}
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {title}
                </div>
              </div>
              <button
                onClick={onCancel}
                className="cursor-pointer rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
                data-tauri-drag-region="false"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className={`rounded-2xl px-4 py-3 ${danger ? "border border-red-100 bg-red-50/80 dark:border-red-900/40 dark:bg-red-950/20" : "border border-slate-200/80 bg-slate-50/80 dark:border-vnote-border/80 dark:bg-white/5"}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm ${danger ? "bg-red-500 text-white" : "bg-blue-500 text-white"}`}>
                    <Trash2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {danger ? "删除后将无法恢复" : "请确认当前操作"}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400 whitespace-pre-line break-all">
                      {message}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={onCancel}
                  className="cursor-pointer rounded-xl border border-slate-200/80 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-vnote-border/80 dark:text-slate-300 dark:hover:bg-white/5"
                  data-tauri-drag-region="false"
                >
                  {cancelText}
                </button>
                <button
                  onClick={onConfirm}
                  className={`cursor-pointer rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors ${
                    danger
                      ? "bg-red-500 shadow-[0_10px_24px_rgba(239,68,68,0.28)] hover:bg-red-600"
                      : "bg-blue-600 shadow-[0_10px_24px_rgba(37,99,235,0.24)] hover:bg-blue-700"
                  }`}
                  data-tauri-drag-region="false"
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/34 backdrop-blur-md"
      onClick={onCancel}
    >
      <div
        className={`w-[420px] max-w-[90vw] overflow-hidden rounded-[24px] border border-white/45 dark:border-vnote-border/80 ${glassModal} ring-1 ring-white/30 dark:ring-white/5 shadow-[0_24px_70px_rgba(15,23,42,0.26)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200/80 bg-white/16 p-6 backdrop-blur-md dark:border-vnote-border/80 dark:bg-black/8">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-vnote-hover dark:hover:text-slate-200"
            data-tauri-drag-region="false"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{message}</p>
        </div>
        <div className="flex justify-end gap-3 bg-white/10 px-6 py-4 backdrop-blur-md dark:bg-black/8">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-xl border border-slate-200/80 bg-white/50 px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-white/75 dark:border-vnote-border/80 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            data-tauri-drag-region="false"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`cursor-pointer rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors ${
              danger
                ? "bg-red-600 shadow-sm hover:bg-red-700"
                : "bg-blue-600 shadow-sm hover:bg-blue-700"
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
