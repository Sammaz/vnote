/**
 * 推荐问题弹窗组件
 */

import { createPortal } from "react-dom";
import { Lightbulb } from "lucide-react";
import { cn } from "../../../utils/cn";
import { useGlassBg } from "../../../hooks/useGlassBg";

interface SuggestedQuestionsPopoverProps {
  questions: string[];
  position: { x: number; y: number };
  onSelectQuestion: (question: string) => void;
  onClose: () => void;
  popoverContentRef: React.RefObject<HTMLDivElement | null>;
}

export function SuggestedQuestionsPopover({
  questions,
  position,
  onSelectQuestion,
  onClose,
  popoverContentRef,
}: SuggestedQuestionsPopoverProps) {
  const glassCard = useGlassBg("card");
  const glassMenu = useGlassBg("menu");

  return createPortal(
    <div
      ref={popoverContentRef}
      className={cn("w-80 rounded-2xl overflow-hidden border border-white/45 dark:border-vnote-border/80 ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.24)]", glassCard)}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        transform: "translateY(-100%)",
        zIndex: 9999,
        animation: "popoverSlideUp 0.2s ease-out",
      }}
    >
      <div className={cn("px-3 py-2 border-b border-slate-200/80 dark:border-vnote-border/80", glassMenu)}>
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <Lightbulb className="w-4 h-4 text-amber-400" />
          推荐问题
        </div>
      </div>
      <div className="p-2 max-h-64 overflow-y-auto">
        {questions.map((question, index) => (
          <button
            key={`question-${index}-${question.slice(0, 20)}`}
            onClick={() => {
              onSelectQuestion(question);
              onClose();
            }}
            className="w-full text-left px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-white/8 rounded-xl transition-colors mb-1 last:mb-0 cursor-pointer"
          >
            {question}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
