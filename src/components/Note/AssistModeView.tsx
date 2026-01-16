/**
 * AssistModeView 组件
 * 
 * 辅助模式的主视图组件，负责渲染逐行字幕和截图标记。
 * 
 * 功能：
 * - 加载字幕数据（从 subtitlePath）
 * - 加载截图标记（调用 get_screenshot_markers）
 * - 渲染 SubtitleRowWithMarker 列表
 * - 监听视频播放时间，高亮当前字幕行
 * - 处理添加截图（调用 save_screenshot_marker）
 * - 处理删除截图（调用 delete_screenshot_marker）
 * - 自动滚动到当前播放的字幕行
 * 
 * Requirements: 2.5, 3.4, 4.2, 4.5
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Captions, AlertCircle } from "lucide-react";
import { SubtitleRowWithMarker } from "./SubtitleRowWithMarker";
import type { SubtitleEntry, ScreenshotMarker } from "../../types";

/**
 * AssistModeView 组件属性
 */
export interface AssistModeViewProps {
  noteId: number;
  subtitlePath: string | null;
  videoPath: string;
  onRegenerateChapters: (markers: ScreenshotMarker[]) => void;
  onExitAssistMode: () => void;
  onMarkersChange?: (markers: ScreenshotMarker[]) => void;
}

/**
 * AssistModeView 组件状态
 */
interface AssistModeViewState {
  subtitles: SubtitleEntry[];
  markers: ScreenshotMarker[];
  activeSubtitleIndex: number | null;
  isCapturing: boolean;
}

export function AssistModeView({
  noteId,
  subtitlePath,
  videoPath,
  onRegenerateChapters: _onRegenerateChapters,
  onExitAssistMode: _onExitAssistMode,
  onMarkersChange,
}: AssistModeViewProps) {
  // Note: onRegenerateChapters and onExitAssistMode will be used when integrating
  // with NoteContentPanel in task 7.5
  void _onRegenerateChapters;
  void _onExitAssistMode;
  // 组件状态
  const [state, setState] = useState<AssistModeViewState>({
    subtitles: [],
    markers: [],
    activeSubtitleIndex: null,
    isCapturing: false,
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturingIndex, setCapturingIndex] = useState<number | null>(null);
  const [videoAvailable, setVideoAvailable] = useState(true);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrolledIndexRef = useRef<number | null>(null);

  // 加载字幕数据
  useEffect(() => {
    if (!subtitlePath) {
      setState(prev => ({ ...prev, subtitles: [] }));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    invoke<SubtitleEntry[]>("parse_subtitle_file", { path: subtitlePath })
      .then((entries) => {
        setState(prev => ({ ...prev, subtitles: entries }));
      })
      .catch((err) => {
        setError(`无法解析字幕文件: ${err}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [subtitlePath]);

  // 加载截图标记数据
  useEffect(() => {
    if (!noteId) return;

    invoke<ScreenshotMarker[]>("get_screenshot_markers", { noteId })
      .then((markers) => {
        setState(prev => ({ ...prev, markers }));
      })
      .catch((err) => {
        console.error("Failed to load screenshot markers:", err);
        // 不设置错误状态，使用空标记列表继续
      });
  }, [noteId]);

  // 当 markers 变化时通知父组件
  useEffect(() => {
    onMarkersChange?.(state.markers);
  }, [state.markers, onMarkersChange]);

  // 检查视频是否可用
  useEffect(() => {
    // 简单检查：如果 videoPath 存在则认为视频可用
    // 实际可用性由视频播放器组件决定
    setVideoAvailable(!!videoPath);
  }, [videoPath]);

  // 根据时间查找当前字幕条目索引
  const findCurrentEntryIndex = useCallback((time: number): number | null => {
    const { subtitles } = state;
    for (let i = 0; i < subtitles.length; i++) {
      const entry = subtitles[i];
      if (time >= entry.start_time && time < entry.end_time) {
        return i;
      }
    }
    // 如果没有精确匹配，找最近的已过去的字幕
    for (let i = subtitles.length - 1; i >= 0; i--) {
      if (time >= subtitles[i].start_time) {
        return i;
      }
    }
    return null;
  }, [state.subtitles]);

  // 监听视频时间更新，高亮当前字幕行并自动滚动
  useEffect(() => {
    if (state.subtitles.length === 0) return;

    const handleVideoTimeUpdate = (e: Event) => {
      const event = e as CustomEvent<{ time: number }>;
      const currentTime = event.detail.time;
      const index = findCurrentEntryIndex(currentTime);

      if (index !== state.activeSubtitleIndex) {
        setState(prev => ({ ...prev, activeSubtitleIndex: index }));

        // 自动滚动到当前字幕行（避免频繁滚动）
        if (index !== null && index !== lastScrolledIndexRef.current) {
          lastScrolledIndexRef.current = index;
          const element = document.getElementById(`subtitle-row-${state.subtitles[index].index}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }
    };

    window.addEventListener("video-time-update", handleVideoTimeUpdate);
    return () => window.removeEventListener("video-time-update", handleVideoTimeUpdate);
  }, [state.subtitles, state.activeSubtitleIndex, findCurrentEntryIndex]);

  // 获取指定字幕索引的截图标记
  const getMarkerForIndex = useCallback((index: number): ScreenshotMarker | null => {
    return state.markers.find(m => m.subtitle_index === index) || null;
  }, [state.markers]);

  // 添加截图标记
  const handleAddScreenshot = useCallback(async (subtitleIndex: number) => {
    if (!videoPath || state.isCapturing) return;

    const subtitle = state.subtitles[subtitleIndex];
    if (!subtitle) return;

    setCapturingIndex(subtitleIndex);
    setState(prev => ({ ...prev, isCapturing: true }));

    try {
      // 获取视频元素并捕获当前帧
      const videoElement = document.querySelector("video") as HTMLVideoElement | null;
      if (!videoElement) {
        throw new Error("视频播放器未找到");
      }

      // 创建 canvas 来捕获视频帧
      const canvas = document.createElement("canvas");
      canvas.width = videoElement.videoWidth || 1280;
      canvas.height = videoElement.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("无法创建 canvas 上下文");
      }

      // 绘制当前视频帧到 canvas
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // 将 canvas 转换为 PNG blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("无法生成截图"));
        }, "image/png");
      });

      // 将 blob 转换为 Uint8Array
      const arrayBuffer = await blob.arrayBuffer();
      const screenshotData = Array.from(new Uint8Array(arrayBuffer));

      // 调用后端保存截图标记
      const marker = await invoke<ScreenshotMarker>("save_screenshot_marker", {
        noteId,
        subtitleIndex,
        timestamp: subtitle.start_time,
        screenshotData,
      });

      // 更新标记列表
      setState(prev => ({
        ...prev,
        markers: [...prev.markers.filter(m => m.subtitle_index !== subtitleIndex), marker]
          .sort((a, b) => a.subtitle_index - b.subtitle_index),
        isCapturing: false,
      }));
    } catch (err) {
      console.error("Failed to add screenshot marker:", err);
      setState(prev => ({ ...prev, isCapturing: false }));
    } finally {
      setCapturingIndex(null);
    }
  }, [noteId, videoPath, state.subtitles, state.isCapturing]);

  // 删除截图标记
  const handleRemoveScreenshot = useCallback(async (subtitleIndex: number) => {
    const marker = getMarkerForIndex(subtitleIndex);
    if (!marker) return;

    try {
      // 调用后端删除截图标记
      await invoke("delete_screenshot_marker", {
        noteId,
        markerId: marker.id,
      });

      // 更新标记列表
      setState(prev => ({
        ...prev,
        markers: prev.markers.filter(m => m.id !== marker.id),
      }));
    } catch (err) {
      console.error("Failed to remove screenshot marker:", err);
    }
  }, [noteId, getMarkerForIndex]);

  // 点击字幕行（跳转视频由 SubtitleRowWithMarker 内部处理）
  const handleRowClick = useCallback(() => {
    // 可以在这里添加额外的点击处理逻辑
  }, []);

  // 空状态：无字幕路径
  if (!subtitlePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <Captions className="w-12 h-12 mb-4 opacity-50" />
        <p>未上传字幕文件</p>
        <p className="text-sm mt-2">上传视频时可选择添加字幕文件</p>
      </div>
    );
  }

  // 加载状态
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <p>加载字幕中...</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <AlertCircle className="w-12 h-12 mb-4 text-red-400" />
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  // 空字幕状态
  if (state.subtitles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <Captions className="w-12 h-12 mb-4 opacity-50" />
        <p>字幕文件为空</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 辅助模式提示栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>辅助模式：点击"添加截图"按钮在字幕行上方添加章节分隔点</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
          <span>已添加 {state.markers.length} 个截图标记</span>
        </div>
      </div>

      {/* 字幕列表 */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto"
      >
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {state.subtitles.map((entry, index) => (
            <SubtitleRowWithMarker
              key={entry.index}
              entry={entry}
              index={index}
              isActive={state.activeSubtitleIndex === index}
              marker={getMarkerForIndex(index)}
              onAddScreenshot={handleAddScreenshot}
              onRemoveScreenshot={handleRemoveScreenshot}
              onClick={handleRowClick}
              isCapturing={capturingIndex === index}
              videoAvailable={videoAvailable}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default AssistModeView;
