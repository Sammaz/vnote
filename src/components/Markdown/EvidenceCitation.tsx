import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface EvidenceCitationSource {
  chunk_id?: string;
  note_title: string;
  content: string;
  score?: number | null;
}

interface EvidenceCitationContextValue {
  sources?: EvidenceCitationSource[];
  activeRank: number | null;
  onClick?: (rank: number) => void;
}

const EvidenceCitationContext = createContext<EvidenceCitationContextValue>({
  sources: undefined,
  activeRank: null,
  onClick: undefined,
});

interface EvidenceCitationProviderProps {
  sources?: EvidenceCitationSource[];
  activeRank: number | null;
  onClick?: (rank: number) => void;
  children: ReactNode;
}

export function EvidenceCitationProvider({
  sources,
  activeRank,
  onClick,
  children,
}: EvidenceCitationProviderProps) {
  const value = useMemo<EvidenceCitationContextValue>(
    () => ({ sources, activeRank, onClick }),
    [sources, activeRank, onClick],
  );
  return (
    <EvidenceCitationContext.Provider value={value}>{children}</EvidenceCitationContext.Provider>
  );
}

interface EvidenceCitationProps {
  rank: number;
}

const POPOVER_DELAY = 150;
const POPOVER_CLOSE_DELAY = 120;
const POPOVER_GAP = 8;
const POPOVER_WIDTH = 360;

export function EvidenceCitation({ rank }: EvidenceCitationProps) {
  const { sources, activeRank, onClick } = useContext(EvidenceCitationContext);
  const source = sources?.[rank - 1];
  const active = activeRank === rank;

  const glassCard = useGlassBg("card");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const missing = !source;

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleOpen = useCallback(() => {
    clearCloseTimer();
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      if (anchorRef.current) {
        setAnchorRect(anchorRef.current.getBoundingClientRect());
      }
      setOpen(true);
    }, POPOVER_DELAY);
  }, [clearCloseTimer, clearHoverTimer]);

  const scheduleClose = useCallback(() => {
    clearHoverTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, POPOVER_CLOSE_DELAY);
  }, [clearHoverTimer, clearCloseTimer]);

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const updateRect = () => {
      if (anchorRef.current) {
        setAnchorRect(anchorRef.current.getBoundingClientRect());
      }
    };
    updateRect();
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
    clearCloseTimer();
    if (anchorRef.current) {
      setAnchorRect(anchorRef.current.getBoundingClientRect());
    }
    setOpen(true);
  };

  const popoverPosition = anchorRect
    ? (() => {
        const margin = 12;
        const centerX = anchorRect.left + anchorRect.width / 2;
        const maxLeft = window.innerWidth - POPOVER_WIDTH - margin;
        const left = Math.min(Math.max(centerX - POPOVER_WIDTH / 2, margin), Math.max(maxLeft, margin));
        return { top: anchorRect.top, left };
      })()
    : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onMouseEnter={handleOpen}
        onMouseLeave={scheduleClose}
        onFocus={handleOpen}
        onBlur={scheduleClose}
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
      {open && popoverPosition && createPortal(
        <div
          role="presentation"
          onMouseEnter={() => { clearHoverTimer(); clearCloseTimer(); }}
          onMouseLeave={scheduleClose}
          style={{
            position: "fixed",
            top: popoverPosition.top,
            left: popoverPosition.left,
            width: POPOVER_WIDTH,
            transform: "translateY(-100%)",
            paddingBottom: POPOVER_GAP,
            zIndex: 9999,
          }}
        >
          <div
            role="tooltip"
            className={cn(
              "evidence-popover rounded-xl overflow-hidden border border-slate-200/60 dark:border-white/10 ring-1 ring-white/30 dark:ring-white/5 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_20px_40px_-12px_rgba(15,23,42,0.28)] pointer-events-auto",
              glassCard
            )}
          >
            {missing ? (
              <div className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 leading-5">
                未找到对应的证据 {rank}。AI 可能引用了超出检索范围的编号。
              </div>
            ) : (
              <>
                <div className="px-3 py-2 border-b border-slate-200/60 dark:border-white/10 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-md text-[11px] font-medium leading-none bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-200">
                    {rank}
                  </span>
                  <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate max-w-[200px]">
                    {source.note_title}
                  </span>
                  {typeof source.score === "number" && (
                    <span className="ml-auto px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 text-[11px] leading-none tabular-nums flex-shrink-0">
                      {(source.score * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="px-3.5 py-3 max-h-72 overflow-y-auto custom-scrollbar evidence-popover-body">
                  <MarkdownRenderer
                    content={source.content}
                    variant="compact"
                    enableLocalImages
                    enableTimestampRanges={false}
                    enableHashtags={false}
                  />
                </div>
                <div className="px-3 py-2 border-t border-slate-200/60 dark:border-white/10 text-[11px] text-slate-400 dark:text-slate-500">
                  点击徽标跳转到侧栏对应证据
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
