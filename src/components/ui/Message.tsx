import { useState, useEffect } from "react";
import { CheckCircle, XCircle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "../../utils/cn";

export type MessageType = "success" | "error" | "warning" | "info";

interface MessageProps {
  content: string;
  type?: MessageType;
  duration?: number;
  onClose?: () => void;
}

const ICONS = {
  success: <CheckCircle className="w-5 h-5 text-green-500" />,
  error: <XCircle className="w-5 h-5 text-red-500" />,
  warning: <AlertCircle className="w-5 h-5 text-yellow-500" />,
  info: <Info className="w-5 h-5 text-blue-500" />,
};

const STYLES = {
  success: "border-l-green-500",
  error: "border-l-red-500",
  warning: "border-l-yellow-500",
  info: "border-l-blue-500",
};

// 纯组件导出，符合 React Fast Refresh 要求
export function MessageItem({ content, type = "info", duration = 3000, onClose }: MessageProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, 200); // 等待动画完成
  };

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border-l-4 bg-white dark:bg-vnote-card min-w-[300px] max-w-md transition-all duration-200",
        STYLES[type],
        isExiting ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"
      )}
    >
      <div className="flex-shrink-0 mt-0.5">{ICONS[type]}</div>
      <div className="flex-1 text-sm text-slate-700 dark:text-slate-200 break-words">
        {content}
      </div>
      <button
        onClick={handleClose}
        className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
