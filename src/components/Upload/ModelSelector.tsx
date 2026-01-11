import { ChevronDown, Bot, Star } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";

export function ModelSelector() {
  const { aiConfigs, selectedModelId, setSelectedModelId } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sort configs: default first, then by sort_order
  const sortedConfigs = useMemo(() =>
    [...aiConfigs].sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return a.sort_order - b.sort_order;
    }), [aiConfigs]);

  const selectedModel = aiConfigs.find((c) => c.id === selectedModelId);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (aiConfigs.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 dark:bg-vnote-surface border border-slate-200 dark:border-vnote-border text-sm text-slate-500">
        <Bot className="w-4 h-4" />
        <span>请先在设置中配置 AI 模型</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-lg",
          "bg-slate-100 dark:bg-vnote-surface border border-slate-200 dark:border-vnote-border",
          "text-sm text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600",
          "transition-all duration-200"
        )}
      >
        <Bot className="w-4 h-4 text-blue-400" />
        <span>{selectedModel?.title || "选择模型"}</span>
        <ChevronDown
          className={cn("w-4 h-4 text-slate-500 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute left-0 top-full mt-2 w-56 z-50",
            "bg-white dark:bg-vnote-card border border-slate-200 dark:border-vnote-border rounded-xl shadow-xl",
            "py-1 animate-fade-in"
          )}
        >
          {sortedConfigs.map((config) => (
            <button
              key={config.id}
              onClick={() => {
                setSelectedModelId(config.id);
                setIsOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-left",
                "hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors",
                config.id === selectedModelId
                  ? "text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10"
                  : "text-slate-600 dark:text-slate-300"
              )}
            >
              <Bot className="w-4 h-4" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate flex items-center gap-1.5">
                  {config.title}
                  {config.is_default && (
                    <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                  )}
                </p>
                <p className="text-xs text-slate-500 truncate">{config.model}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
