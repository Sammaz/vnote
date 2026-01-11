import { useEffect } from "react";
import { X } from "lucide-react";

interface PlaybackResumeProps {
  position: number; // seconds
  onResume: () => void;
  onDismiss: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function PlaybackResume({ position, onResume, onDismiss }: PlaybackResumeProps) {
  // 5 秒后自动消失
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 5000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="absolute bottom-12 left-4 z-20 flex items-center gap-2 bg-black/80 text-white text-sm rounded px-3 py-2 animate-slide-in-bottom">
      <button
        onClick={onDismiss}
        className="p-0.5 hover:bg-white/20 rounded transition-colors"
        title="关闭"
      >
        <X className="w-4 h-4" />
      </button>
      <span className="text-slate-200">记忆你上次看到 {formatTime(position)}</span>
      <button
        onClick={onResume}
        className="text-pink-400 hover:text-pink-300 font-medium transition-colors"
      >
        跳转
      </button>
    </div>
  );
}
