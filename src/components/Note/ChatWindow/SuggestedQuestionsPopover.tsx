/**
 * 推荐问题弹窗组件
 */

import { createPortal } from "react-dom";
import { Lightbulb } from "lucide-react";

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
  return createPortal(
    <div
      ref={popoverContentRef}
      className="w-80 rounded-2xl overflow-hidden border border-white/45 dark:border-vnote-border/80 bg-white/78 dark:bg-vnote-card/52 backdrop-blur-2xl ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.24)]"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        transform: "translateY(-100%)",
        zIndex: 9999,
        animation: "popoverSlideUp 0.2s ease-out",
      }}
    >
      <div className="px-3 py-2 border-b border-slate-200/80 dark:border-vnote-border/80 bg-white/28 dark:bg-black/10 backdrop-blur-md">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <Lightbulb className="w-4 h-4 text-amber-400" />
          推荐问题
        </div>
      </div>
      <div className="p-2 max-h-64 overflow-y-auto bg-white/8 dark:bg-transparent">
        {questions.map((question, index) => (
          <button
            key={`question-${index}-${question.slice(0, 20)}`}
            onClick={() => {
              onSelectQuestion(question);
              onClose();
            }}
            className="w-full text-left px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-white/8 rounded-xl transition-colors mb-1 last:mb-0 cursor-pointer"
          >
            {question}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
