/**
 * 输入区域组件
 */

import { Paperclip, Video, Send, Square, X } from "lucide-react";
import { cn } from "../../../utils/cn";
import { ACCEPTED_IMAGE_TYPES } from "./constants";
import type { UploadedImage } from "./types";

interface InputAreaProps {
  input: string;
  setInput: (value: string) => void;
  uploadedImages: UploadedImage[];
  basedOnVideo: boolean;
  setBasedOnVideo: (value: boolean) => void;
  isStreaming: boolean;
  onSend: () => void;
  onStopGeneration: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: (imageId: string) => void;
  onAttachClick: () => void;
  onPaste: (e: React.ClipboardEvent) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  // 推荐问题相关
  questions: string[];
  questionButtonRef: React.RefObject<HTMLButtonElement | null>;
  onToggleQuestionPopover: () => void;
  showQuestionPopover: boolean;
}

export function InputArea({
  input,
  setInput,
  uploadedImages,
  basedOnVideo,
  setBasedOnVideo,
  isStreaming,
  onSend,
  onStopGeneration,
  onFileSelect,
  onRemoveImage,
  onAttachClick,
  onPaste,
  fileInputRef,
  questions,
  questionButtonRef,
  onToggleQuestionPopover,
  showQuestionPopover,
}: InputAreaProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="p-4 border-t border-slate-200 dark:border-vnote-border">
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        onChange={onFileSelect}
        className="hidden"
      />

      {/* 图片预览区域 */}
      {uploadedImages.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {uploadedImages.map((image) => (
            <div key={image.id} className="relative group">
              <img
                src={image.previewUrl}
                alt="预览"
                className="w-24 h-24 object-cover rounded-lg border border-slate-200 dark:border-vnote-border"
              />
              <button
                onClick={() => onRemoveImage(image.id)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 dark:bg-slate-600 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 文本输入框 */}
      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder="你的问题..."
          className="w-full px-4 py-3 bg-slate-50 dark:bg-vnote-surface border border-slate-200 dark:border-vnote-border rounded-xl text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-600 dark:placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          rows={2}
        />
      </div>

      {/* 底部操作栏 */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={onAttachClick}
            className="p-2 text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
            title="上传图片"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <button
            onClick={() => setBasedOnVideo(!basedOnVideo)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
              basedOnVideo
                ? "text-cyan-400 border border-cyan-400/50 bg-cyan-400/10"
                : "text-slate-600 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-vnote-hover"
            )}
          >
            <Video className="w-4 h-4" />
            {basedOnVideo ? "基于视频" : "不基于视频"}
          </button>
          {/* 推荐问题按钮 */}
          {questions.length > 0 && (
            <button
              ref={questionButtonRef}
              onClick={onToggleQuestionPopover}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                showQuestionPopover
                  ? "text-amber-400 border border-amber-400/50 bg-amber-400/10"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-vnote-hover"
              )}
            >
              <span>💡</span>
              <span>推荐问题</span>
              <span className="ml-0.5 px-1.5 py-0.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-200 dark:bg-vnote-surface rounded-full">
                {questions.length}
              </span>
            </button>
          )}
        </div>
        {isStreaming ? (
          <button
            onClick={onStopGeneration}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors cursor-pointer"
            title="停止生成"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!input.trim() && uploadedImages.length === 0}
            className={cn(
              "w-10 h-10 flex items-center justify-center rounded-full transition-colors cursor-pointer",
              input.trim() || uploadedImages.length > 0
                ? "bg-slate-700 dark:bg-slate-600 text-white hover:bg-slate-600 dark:hover:bg-slate-500"
                : "bg-slate-200 dark:bg-vnote-surface text-slate-600 dark:text-slate-400 cursor-not-allowed"
            )}
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
