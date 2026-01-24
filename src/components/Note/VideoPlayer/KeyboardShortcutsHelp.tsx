/**
 * KeyboardShortcutsHelp - 快捷键帮助面板
 * 显示视频播放器的所有快捷键列表
 */

import { createPortal } from "react-dom";
import { X, Keyboard } from "lucide-react";
import { useEffect } from "react";

interface KeyboardShortcutsHelpProps {
  onClose: () => void;
}

// 快捷键列表数据
const shortcuts = [
  { key: "Space / K", description: "播放/暂停" },
  { key: "←", description: "后退 10 秒" },
  { key: "→", description: "前进 10 秒" },
  { key: "↑", description: "音量增加 10%" },
  { key: "↓", description: "音量减少 10%" },
  { key: "M", description: "静音/取消静音" },
  { key: "F", description: "全屏/退出全屏" },
  { key: "C", description: "字幕开关" },
  { key: "L", description: "循环播放" },
  { key: "0-9", description: "跳转到 0%-90%" },
  { key: "Escape", description: "退出全屏" },
  { key: "H", description: "显示/隐藏快捷键帮助" },
];

export function KeyboardShortcutsHelp({ onClose }: KeyboardShortcutsHelpProps) {
  // 监听 Escape 键关闭面板
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-neutral-900 rounded-lg shadow-2xl animate-fade-in border border-slate-200 dark:border-neutral-700">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5 text-slate-400 dark:text-neutral-500" />
        </button>

        {/* 内容区域 */}
        <div className="p-6">
          {/* 标题 */}
          <div className="flex items-center gap-2 mb-4">
            <Keyboard className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              快捷键帮助
            </h2>
          </div>

          {/* 快捷键列表 */}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {shortcuts.map((shortcut, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-slate-50 dark:hover:bg-neutral-800 transition-colors"
              >
                <span className="text-sm text-slate-600 dark:text-neutral-400">
                  {shortcut.description}
                </span>
                <kbd className="px-2 py-1 text-xs font-mono bg-slate-100 dark:bg-neutral-800 border border-slate-300 dark:border-neutral-600 rounded text-slate-700 dark:text-slate-300">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>

          {/* 提示信息 */}
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-neutral-700">
            <p className="text-xs text-slate-500 dark:text-neutral-400 text-center">
              按 <kbd className="px-1.5 py-0.5 text-xs font-mono bg-slate-100 dark:bg-neutral-800 border border-slate-300 dark:border-neutral-600 rounded">Esc</kbd> 或点击遮罩层关闭
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
