import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
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

function MessageItem({ content, type = "info", duration = 3000, onClose }: MessageProps) {
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

// 容器组件
let messageContainer: HTMLDivElement | null = null;
let messageRoot: any = null;

function getContainer() {
  if (!messageContainer) {
    messageContainer = document.createElement("div");
    messageContainer.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none";
    document.body.appendChild(messageContainer);
    messageRoot = createRoot(messageContainer);
  }
  return { container: messageContainer, root: messageRoot };
}

interface MessageInstance {
  id: number;
  element: React.ReactElement;
}

const instances: MessageInstance[] = [];
let nextId = 1;

function renderMessages() {
  const { root } = getContainer();
  root.render(
    <>
      {instances.map((instance) => (
        <div key={instance.id} className="pointer-events-auto">
          {instance.element}
        </div>
      ))}
    </>
  );
}

function show(content: string, type: MessageType = "info", duration = 3000): number {
  const id = nextId++;

  const element = (
    <MessageItem
      content={content}
      type={type}
      duration={duration}
      onClose={() => {
        const index = instances.findIndex((i) => i.id === id);
        if (index !== -1) {
          instances.splice(index, 1);
          renderMessages();
        }
      }}
    />
  );

  instances.push({ id, element });
  renderMessages();

  return id;
}

export const message = {
  success: (content: string, duration?: number) => show(content, "success", duration),
  error: (content: string, duration?: number) => show(content, "error", duration),
  warning: (content: string, duration?: number) => show(content, "warning", duration),
  info: (content: string, duration?: number) => show(content, "info", duration),
};
