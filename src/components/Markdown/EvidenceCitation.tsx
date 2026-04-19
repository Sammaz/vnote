import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";

export interface EvidenceCitationSource {
  chunk_id?: string;
  note_title: string;
  content: string;
  score?: number | null;
}

interface EvidenceCitationProps {
  rank: number;
  source?: EvidenceCitationSource;
  active?: boolean;
  onClick?: (rank: number) => void;
}

const POPOVER_DELAY = 150;
const POPOVER_GAP = 8;
const POPOVER_WIDTH = 288;

export function EvidenceCitation({ rank, source, active, onClick }: EvidenceCitationProps) {
  const glassCard = useGlassBg("card");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const missing = !source;

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleOpen = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      if (anchorRef.current) {
        setAnchorRect(anchorRef.current.getBoundingClientRect());
      }
      setOpen(true);
    }, POPOVER_DELAY);
  }, [clearHoverTimer]);

  const handleClose = useCallback(() => {
    clearHoverTimer();
    setOpen(false);
  }, [clearHoverTimer]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  useLayoutEffect(() => {
    if (!open) return;
    const updateRect = () => {
      if (anchorRef.current) {
        setAnchorRect(anchorRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (missing) return;
    onClick?.(rank);
  };

  const popoverStyle = anchorRect
    ? (() => {
        const top = anchorRect.top - POPOVER_GAP;
        const centerX = anchorRect.left + anchorRect.width / 2;
        const margin = 12;
        const maxLeft = window.innerWidth - POPOVER_WIDTH - margin;
        const left = Math.min(Math.max(centerX - POPOVER_WIDTH / 2, margin), Math.max(maxLeft, margin));
        return {
          position: "fixed" as const,
          top,
          left,
          width: POPOVER_WIDTH,
          transform: "translateY(-100%)",
          zIndex: 9999,
        };
      })()
    : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
        onClick={handleClick}
        disabled={missing}
        aria-label={missing ? `证据${rank}（未找到）` : `证据${rank}`}
        className={cn(
          "inline-flex items-center justify-center align-[1px] mx-0.5 h-[18px] min-w-[18px] px-1 rounded-md border text-[11px] font-medium leading-none transition-colors",
          missing
            ? "border-slate-200 bg-slate-50 text-slate-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-slate-500 cursor-not-allowed"
            : "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-300 dark:border-blue-800/70 dark:bg-blue-900/25 dark:text-blue-200 dark:hover:bg-blue-900/40 cursor-pointer",
          !missing && active && "ring-2 ring-blue-400/60 border-blue-300 dark:border-blue-500"
        )}
      >
        {rank}
      </button>
      {open && popoverStyle && createPortal(
        <div
          role="tooltip"
          onMouseEnter={clearHoverTimer}
          onMouseLeave={handleClose}
          style={popoverStyle}
          className={cn(
            "rounded-xl overflow-hidden border border-white/50 dark:border-vnote-border/80 ring-1 ring-white/20 dark:ring-white/5 shadow-[0_20px_45px_rgba(15,23,42,0.24)] pointer-events-auto",
            glassCard
          )}
        >
          {missing ? (
            <div className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 leading-5">
              未找到对应的证据 {rank}。AI 可能引用了超出检索范围的编号。
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-slate-200/70 dark:border-vnote-border/70 flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-md text-[11px] font-medium leading-none bg-blue-50 text-blue-600 border border-blue-200 dark:border-blue-800/70 dark:bg-blue-900/25 dark:text-blue-200">
                  {rank}
                </span>
                <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                  {source.note_title}
                </span>
                {typeof source.score === "number" && (
                  <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0">
                    {(source.score * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="px-3 py-2.5 text-xs leading-6 text-slate-600 dark:text-slate-300 max-h-56 overflow-y-auto whitespace-pre-wrap">
                {source.content}
              </div>
              <div className="px-3 py-2 border-t border-slate-200/70 dark:border-vnote-border/70 text-[11px] text-slate-400 dark:text-slate-500">
                点击徽标跳转到侧栏对应证据
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
