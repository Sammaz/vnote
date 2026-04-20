import { useState, useRef, useEffect } from "react";
import {
  MonitorPlay,
  MonitorOff,
  Play,
  Pause,
  ArrowLeftRight,
  ChevronDown,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useGlassBg } from "../../hooks/useGlassBg";
import type { AiConfig } from "../../types";

interface VideoToolbarProps {
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
}

interface TooltipButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  active?: boolean;
}

function TooltipButton({ icon, tooltip, onClick, active }: TooltipButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer",
          active
            ? "bg-slate-200/90 dark:bg-neutral-700 text-slate-700 dark:text-neutral-200"
            : "bg-slate-100/90 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 hover:bg-slate-200 dark:hover:bg-neutral-700 hover:text-slate-800 dark:hover:text-neutral-200"
        )}
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-slate-700 dark:bg-neutral-800 text-white text-xs rounded whitespace-nowrap z-50">
          {tooltip}
        </div>
      )}
    </div>
  );
}

interface ModelSelectorProps {
  models: AiConfig[];
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
}

function ModelSelector({ models, currentModelId, onModelChange }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const glassMenu = useGlassBg("menu");

  const currentModel = models.find((m) => m.id === currentModelId);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 h-8 bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-600 dark:text-neutral-200 rounded-md transition-colors cursor-pointer"
      >
        <span className="text-xs font-medium truncate max-w-[120px]">
          {currentModel?.title || "选择模型"}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className={cn("absolute top-full right-0 mt-1 w-44 py-1 border border-slate-200 dark:border-neutral-700 rounded-md shadow-lg z-50", glassMenu)}>
          {models.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                onModelChange(model.id);
                setIsOpen(false);
              }}
              className={cn(
                "w-full px-3 py-1.5 text-left text-xs transition-colors cursor-pointer",
                model.id === currentModelId
                  ? "bg-slate-100 dark:bg-neutral-700 text-slate-800 dark:text-white"
                  : "text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-neutral-700 hover:text-slate-800 dark:hover:text-white"
              )}
            >
              {model.title}
            </button>
          ))}
          {models.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-slate-500 dark:text-neutral-500">
              暂无可用模型
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VideoToolbar({
  currentModelId,
  onModelChange,
}: VideoToolbarProps) {
  const {
    aiConfigs,
    toolbarSettings,
    setVideoVisible,
    setAutoPlay,
    setLayoutSwapped,
  } = useApp();

  const { videoVisible, autoPlay, layoutSwapped } = toolbarSettings;

  // 切换左右交换
  const handleToggleSwap = () => {
    setLayoutSwapped(!layoutSwapped);
  };

  return (
    <div className="flex items-center gap-1 flex-1">
      {/* Left side buttons */}
      <TooltipButton
        icon={videoVisible ? <MonitorPlay className="w-4 h-4" /> : <MonitorOff className="w-4 h-4" />}
        tooltip={videoVisible ? "隐藏视频" : "显示视频"}
        onClick={() => setVideoVisible(!videoVisible)}
        active={!videoVisible}
      />
      <TooltipButton
        icon={autoPlay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        tooltip={autoPlay ? "关闭自动播放" : "开启自动播放"}
        onClick={() => setAutoPlay(!autoPlay)}
        active={autoPlay}
      />
      <TooltipButton
        icon={<ArrowLeftRight className="w-4 h-4" />}
        tooltip="左右交换"
        onClick={handleToggleSwap}
        active={layoutSwapped}
      />

      {/* Right side model selector */}
      <div className="ml-auto">
        <ModelSelector
          models={aiConfigs}
          currentModelId={currentModelId}
          onModelChange={onModelChange}
        />
      </div>
    </div>
  );
}
