import { useState, useCallback, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  RotateCcw,
  RefreshCw,
  Loader2,
  Copy,
  Zap,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { message } from "../../utils/message";
import type { FlashcardData, FlashcardGenerationEvent } from "../../types";
import { FLASHCARD_DIFFICULTY_LABELS } from "../../types";

interface FlashcardContentProps {
  noteId: string;
  noteName: string;
  subtitlePath: string | null;
  modelId: string | null;
  flashcardData: FlashcardData | null;
  isGenerating: boolean;
  onGenerationComplete?: () => void;
}

export function FlashcardContent({
  noteId,
  noteName,
  subtitlePath,
  modelId,
  flashcardData,
  isGenerating,
  onGenerationComplete,
}: FlashcardContentProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [localGenerating, setLocalGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number; message: string } | null>(null);

  const cards = flashcardData?.cards || [];
  const totalCards = cards.length;
  const currentCard = cards[currentIndex];

  // Reset current index when flashcard data changes
  useEffect(() => {
    if (flashcardData && currentIndex >= flashcardData.cards.length) {
      setCurrentIndex(0);
    }
  }, [flashcardData, currentIndex]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setShowAnswer(false);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < totalCards - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowAnswer(false);
    }
  }, [currentIndex, totalCards]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setShowAnswer(false);
  }, []);

  const handleToggleAnswer = useCallback(() => {
    setShowAnswer(!showAnswer);
  }, [showAnswer]);

  const handleCopyAnswer = useCallback(async () => {
    if (currentCard) {
      try {
        await navigator.clipboard.writeText(currentCard.answer);
        message.success("答案已复制到剪贴板");
      } catch {
        message.error("复制失败");
      }
    }
  }, [currentCard]);

  const handleDownloadCSV = useCallback(async () => {
    if (!cards.length) {
      message.warning("暂无闪记卡数据");
      return;
    }

    try {
      // 弹出保存文件对话框
      const filePath = await save({
        defaultPath: `${noteName}.csv`,
        filters: [
          {
            name: "CSV",
            extensions: ["csv"],
          },
        ],
      });

      if (!filePath) {
        // 用户取消了选择
        return;
      }

      // 构建 CSV 内容
      const csvContent = [
        ["问题", "答案", "难度", "标签"].join(","),
        ...cards.map(card => [
          `"${card.question.replace(/"/g, '""')}"`,
          `"${card.answer.replace(/"/g, '""')}"`,
          FLASHCARD_DIFFICULTY_LABELS[card.difficulty],
          `"${card.tags.join("; ")}"`,
        ].join(",")),
      ].join("\n");

      // 添加 BOM 以支持中文
      const contentWithBOM = "\uFEFF" + csvContent;

      // 调用 Rust 端保存文件
      await invoke("save_file_content", { path: filePath, content: contentWithBOM });
      message.success("CSV文件已保存");
    } catch (error) {
      console.error("保存CSV失败:", error);
      message.error(`保存失败: ${error}`);
    }
  }, [cards, noteId]);

  const handleGenerate = useCallback(async () => {
    if (!subtitlePath) {
      message.warning("没有字幕文件，无法生成闪记卡");
      return;
    }

    if (!modelId) {
      message.warning("请先选择AI模型");
      return;
    }

    // 闪记卡生成是独立的，只检查自身的生成状态
    if (localGenerating) {
      message.warning("闪记卡正在生成中，请稍后再试");
      return;
    }

    setLocalGenerating(true);
    setGenerationProgress({ current: 0, total: 0, message: "准备生成闪记卡..." });

    try {
      const generationId = crypto.randomUUID();

      // 闪记卡不设置全局 isGenerating 状态，保持独立性

      // Set up event listener
      const unlisten = await listen<FlashcardGenerationEvent>(
        `flashcard-generation-${generationId}`,
        (event) => {
          const payload = event.payload;

          if (payload.status === "Progress") {
            setGenerationProgress({
              current: payload.current,
              total: payload.total,
              message: payload.message,
            });
          } else if (payload.status === "Completed") {
            setLocalGenerating(false);
            setGenerationProgress(null);
            setCurrentIndex(0);
            setShowAnswer(true);
            onGenerationComplete?.();
            message.success(`成功生成 ${payload.flashcard_data.total_count} 张闪记卡`);
            unlisten();
          } else if (payload.status === "Error") {
            setLocalGenerating(false);
            setGenerationProgress(null);
            message.error(`生成失败: ${payload.error}`);
            unlisten();
          } else if (payload.status === "Aborted") {
            setLocalGenerating(false);
            setGenerationProgress(null);
            message.warning("生成已取消");
            unlisten();
          }
        }
      );

      // Call backend to generate flashcards
      await invoke("generate_flashcards", {
        generationId,
        noteId,
        modelId,
      });
    } catch (error) {
      setLocalGenerating(false);
      setGenerationProgress(null);
      message.error(`生成失败: ${error}`);
    }
  }, [noteId, subtitlePath, modelId, onGenerationComplete, localGenerating]);

  // Listen for external regenerate event
  useEffect(() => {
    const handleRegenerateEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ noteId: string }>;
      if (customEvent.detail.noteId === noteId) {
        handleGenerate();
      }
    };
    window.addEventListener('flashcard-regenerate', handleRegenerateEvent);
    return () => window.removeEventListener('flashcard-regenerate', handleRegenerateEvent);
  }, [noteId, handleGenerate]);

  // Listen for external download CSV event
  useEffect(() => {
    const handleDownloadEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ noteId: string }>;
      if (customEvent.detail.noteId === noteId) {
        handleDownloadCSV();
      }
    };
    window.addEventListener('flashcard-download-csv', handleDownloadEvent);
    return () => window.removeEventListener('flashcard-download-csv', handleDownloadEvent);
  }, [noteId, handleDownloadCSV]);

  const generating = isGenerating || localGenerating;

  // Calculate progress bar widths
  const completedWidth = totalCards > 0 ? ((currentIndex) / totalCards) * 100 : 0;
  const currentWidth = totalCards > 0 ? (1 / totalCards) * 100 : 0;

  // Empty state - no flashcards generated yet
  if (!flashcardData && !generating) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-yellow-100 to-orange-100 dark:from-yellow-900/30 dark:to-orange-900/30 flex items-center justify-center">
            <Zap className="w-8 h-8 text-yellow-500" />
          </div>
          <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-2">闪记卡</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs">
            基于视频内容生成问答卡片，帮助巩固知识点
          </p>
          <button
            onClick={handleGenerate}
            disabled={!subtitlePath || !modelId}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <Zap className="w-4 h-4" />
            生成闪记卡
          </button>
          {!subtitlePath && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
              需要字幕文件才能生成闪记卡
            </p>
          )}
        </div>
      </div>
    );
  }

  // Generating state
  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-yellow-500 animate-spin" />
          <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-2">
            正在生成闪记卡...
          </h3>
          {generationProgress && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {generationProgress.message}
            </p>
          )}
        </div>
      </div>
    );
  }

  // No cards generated (empty result)
  if (totalCards === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <Zap className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-2">暂无闪记卡</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            生成的闪记卡列表为空，请重新生成
          </p>
          <button
            onClick={handleGenerate}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            重新生成
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Progress Bar Section */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-slate-500 dark:text-slate-400">卡片进度</span>
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {currentIndex + 1} / {totalCards}
          </span>
        </div>
        {/* Progress Bar */}
        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full flex">
            {/* Completed portion - orange */}
            <div
              className="h-full bg-orange-400 transition-all duration-300"
              style={{ width: `${completedWidth}%` }}
            />
            {/* Current card portion - yellow */}
            <div
              className="h-full bg-yellow-400 transition-all duration-300"
              style={{ width: `${currentWidth}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Card Content */}
      <div className="flex-1 flex flex-col px-6 py-4 overflow-auto">
        {currentCard && (
          <>
            {/* Question Section - Always visible */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-500 dark:text-slate-400">问题</span>
                <div className="flex items-center gap-2">
                  {/* Difficulty/Tag Badges */}
                  <span className={cn(
                    "px-2 py-0.5 text-xs font-medium rounded border",
                    currentCard.difficulty === "easy"
                      ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800"
                      : currentCard.difficulty === "medium"
                      ? "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800"
                      : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                  )}>
                    {FLASHCARD_DIFFICULTY_LABELS[currentCard.difficulty]}
                  </span>
                  {currentCard.tags.slice(0, 2).map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-xs font-medium rounded border bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Question Content */}
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 min-h-[80px]">
                <p className="text-base text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {currentCard.question}
                </p>
              </div>
            </div>

            {/* Toggle Answer Button */}
            <div className="flex items-center justify-center mb-4">
              <button
                onClick={handleToggleAnswer}
                className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                {showAnswer ? (
                  <>
                    <EyeOff className="w-4 h-4" />
                    点击隐藏答案
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    点击查看答案
                  </>
                )}
              </button>
            </div>

            {/* Answer Section - Show/Hide based on state */}
            {showAnswer && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-500 dark:text-slate-400">答案</span>
                  <button
                    onClick={handleCopyAnswer}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                    title="复制答案"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>

                {/* Answer Content */}
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 min-h-[120px]">
                  <p className="text-base text-emerald-600 dark:text-emerald-400 leading-relaxed whitespace-pre-wrap">
                    {currentCard.answer}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="border-t border-slate-200 dark:border-vnote-border px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Previous Button */}
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
              currentIndex === 0
                ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
            )}
          >
            <ChevronLeft className="w-4 h-4" />
            上一张
          </button>

          {/* Center Actions */}
          <div className="flex items-center gap-4">
            {/* Next Button */}
            <button
              onClick={handleNext}
              disabled={currentIndex === totalCards - 1}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
                currentIndex === totalCards - 1
                  ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              )}
            >
              下一张
              <ChevronRight className="w-4 h-4" />
            </button>

            <span className="text-slate-300 dark:text-slate-600">|</span>

            {/* Toggle Answer Button */}
            <button
              onClick={handleToggleAnswer}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              {showAnswer ? (
                <>
                  <EyeOff className="w-4 h-4" />
                  隐藏答案
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  显示答案
                </>
              )}
            </button>

            {/* Restart Button */}
            <button
              onClick={handleRestart}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              重新开始
            </button>
          </div>

          {/* Placeholder for alignment */}
          <div className="w-[88px]" />
        </div>
      </div>
    </div>
  );
}
