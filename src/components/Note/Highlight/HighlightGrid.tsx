/**
 * 高光笔记主组件 - 整合所有子组件
 */

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { Loader2, Sparkles, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "../../../utils/cn";
import { filterByTags, sortByStartTime } from "../../../utils/highlightUtils";
import { TimelineBar } from "./TimelineBar";
import { HighlightCard } from "./HighlightCard";
import { TopicTags } from "./TopicTags";
import type {
  HighlightSegment,
  HighlightData,
  HighlightGenerationEvent,
} from "../../../types";

interface HighlightGridProps {
  noteId: number;
  subtitlePath: string | null;
  modelId: number | null;
  totalDuration: number;
  initialHighlightData?: HighlightData | null;
  onHighlightClick?: (highlight: HighlightSegment) => void;
  onGenerationComplete?: () => void;
  isGenerating?: boolean;
  onRegenerate?: () => void;
}

export interface HighlightGridRef {
  generateHighlights: () => void;
  isGenerating: boolean;
}

export const HighlightGrid = forwardRef<HighlightGridRef, HighlightGridProps>(function HighlightGrid({
  noteId,
  subtitlePath,
  modelId,
  totalDuration,
  initialHighlightData,
  onHighlightClick,
  onGenerationComplete,
  isGenerating: externalIsGenerating = false,
  onRegenerate,
}, ref) {
  // 状态
  const [highlightData, setHighlightData] = useState<HighlightData | null>(initialHighlightData || null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  
  // 生成状态 - 如果有外部控制则使用外部状态
  const [isGenerating, setIsGenerating] = useState(externalIsGenerating);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const generationIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // 解析初始数据
  useEffect(() => {
    if (initialHighlightData) {
      setHighlightData(initialHighlightData);
    }
  }, [initialHighlightData]);

  useEffect(() => {
    setIsGenerating(externalIsGenerating);
  }, [externalIsGenerating]);

  // 清理事件监听器
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // 设置事件监听器
  const setupEventListener = useCallback(async (generationId: string) => {
    if (unlistenRef.current) {
      unlistenRef.current();
    }

    const eventName = `highlight-generation-${generationId}`;
    const unlisten = await listen<HighlightGenerationEvent>(eventName, (event) => {
      const data = event.payload;

      switch (data.status) {
        case "Starting":
          setGenerationProgress({ current: 0, total: data.total_segments });
          setError(null);
          break;

        case "SegmentStarted":
          setGenerationProgress((prev) =>
            prev ? { ...prev, current: data.segment_index } : null
          );
          break;

        case "SegmentCompleted":
          setGenerationProgress((prev) =>
            prev ? { ...prev, current: data.segment_index + 1 } : null
          );
          break;

        case "SegmentFailed":
          console.error(`[HighlightGrid] 段 ${data.segment_index} 失败:`, data.error);
          break;

        case "AllCompleted":
          setIsGenerating(false);
          setGenerationProgress(null);
          // 重新加载笔记数据以获取最新的高光数据
          onGenerationComplete?.();
          break;

        case "Aborted":
          setIsGenerating(false);
          setGenerationProgress(null);
          break;
      }
    });

    unlistenRef.current = unlisten;
  }, [onGenerationComplete]);

  // 生成高光
  const handleGenerate = useCallback(async () => {
    // 如果有外部重新生成回调，优先使用外部回调
    if (onRegenerate) {
      onRegenerate();
      return;
    }

    if (!subtitlePath || !modelId) {
      setError("缺少字幕文件或 AI 模型配置");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const generationId = await invoke<string>("generate_highlights", {
        noteId,
        modelId,
        subtitlePath,
        highlightType: "default",
        totalDuration,
      });

      generationIdRef.current = generationId;
      await setupEventListener(generationId);
    } catch (e) {
      console.error("[HighlightGrid] 生成失败:", e);
      setError(String(e));
      setIsGenerating(false);
    }
  }, [noteId, subtitlePath, modelId, totalDuration, setupEventListener, onRegenerate]);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    generateHighlights: handleGenerate,
    get isGenerating() { return isGenerating; },
  }), [handleGenerate, isGenerating]);

  // 中止生成
  const handleAbort = useCallback(async () => {
    if (generationIdRef.current) {
      try {
        await invoke("abort_highlight_generation", {
          generationId: generationIdRef.current,
        });
      } catch (e) {
        console.error("[HighlightGrid] 中止失败:", e);
      }
    }
  }, []);

  // 标签切换
  const handleTagToggle = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(tag)) {
        newSet.delete(tag);
      } else {
        newSet.add(tag);
      }
      return newSet;
    });
  }, []);

  // 清除所有标签筛选
  const handleClearTags = useCallback(() => {
    setSelectedTags(new Set());
  }, []);

  // 点击高光卡片
  const handleHighlightClick = useCallback(
    (highlight: HighlightSegment) => {
      setActiveHighlightId(highlight.id);
      onHighlightClick?.(highlight);
      
      // 发送跳转视频事件
      window.dispatchEvent(
        new CustomEvent("seek-video", { detail: { time: highlight.start_time } })
      );
    },
    [onHighlightClick]
  );

  // 过滤和排序高光
  const filteredHighlights = highlightData
    ? sortByStartTime(
        filterByTags(highlightData.highlights, selectedTags)
      )
    : [];

  // 渲染空状态
  if (!highlightData && !isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <Sparkles className="w-8 h-8 text-slate-400 dark:text-slate-500" />
        </div>
        <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
          暂无高光笔记
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-6 max-w-md">
          高光笔记会自动提取视频中最重要的知识点和精彩片段，帮助你快速回顾核心内容。
        </p>
        
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500 mb-4">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!subtitlePath || !modelId}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
            "bg-blue-500 hover:bg-blue-600 text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <Sparkles className="w-4 h-4" />
          生成高光笔记
        </button>

        {(!subtitlePath || !modelId) && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
            {!subtitlePath ? "请先上传字幕文件" : "请先选择 AI 模型"}
          </p>
        )}
      </div>
    );
  }

  // 渲染生成中状态
  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-4">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
          正在生成高光笔记...
        </h3>
        {generationProgress && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            处理进度: {generationProgress.current} / {generationProgress.total} 段
          </p>
        )}
        <button
          onClick={handleAbort}
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          取消生成
        </button>
      </div>
    );
  }

  // 渲染高光列表
  return (
    <div className="space-y-3 p-2">
      {/* 时间轴 */}
      {filteredHighlights.length > 0 && (
        <TimelineBar
          highlights={filteredHighlights}
          totalDuration={totalDuration}
          onMarkerClick={handleHighlightClick}
          activeHighlightId={activeHighlightId}
        />
      )}

      {/* 主题标签筛选 */}
      {highlightData && highlightData.topic_tags.length > 0 && (
        <TopicTags
          tags={highlightData.topic_tags}
          selectedTags={selectedTags}
          onTagToggle={handleTagToggle}
          onClearAll={handleClearTags}
        />
      )}

      {/* 高光卡片列表 - 单列布局 */}
      {filteredHighlights.length > 0 ? (
        <div className="flex flex-col gap-2">
          {filteredHighlights.map((highlight, index) => (
            <HighlightCard
              key={highlight.id}
              highlight={highlight}
              index={index}
              onClick={() => handleHighlightClick(highlight)}
              isActive={activeHighlightId === highlight.id}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-slate-500 dark:text-slate-400">
          <p>当前筛选条件下没有高光片段</p>
          {selectedTags.size > 0 && (
            <button
              onClick={handleClearTags}
              className="text-blue-500 hover:text-blue-600 text-sm mt-2"
            >
              清除筛选条件
            </button>
          )}
        </div>
      )}
    </div>
  );
});
