import { useState, useMemo, forwardRef, useImperativeHandle, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Clock, Image as ImageIcon, Loader2, ChevronDown, ChevronUp, AlertCircle, RefreshCw } from "lucide-react";
import type { Chapter, ChapterData, ChapterGenerationEvent, SubtitleEntry } from "../../types";
import { cn } from "../../utils/cn";
import { setChapterGenerating } from "../../utils/noteGenerationState";

interface ChapterGridProps {
  noteId: number;
  videoPath: string;
  subtitlePath: string | null;
  chapterData: ChapterData | null;
  isGenerating: boolean;
  onChapterClick?: (chapter: Chapter) => void;
  onGenerationComplete?: () => void;
  modelId: number | null;
  showToolbar?: boolean; // 是否显示内置工具栏
  currentChapterId?: string | null; // 当前播放的章节ID
  showSubtitles?: boolean; // 是否显示字幕（由父组件控制）
  // 字幕优化相关
  subtitleOptimizationEnabled?: boolean; // 是否启用字幕优化
  optimizedSubtitles?: Map<string, string>; // 章节ID -> 优化后字幕
  optimizingChapterIds?: Set<string>; // 正在优化的章节ID
  failedChapterIds?: Set<string>; // 优化失败的章节ID
  onReoptimizeChapter?: (chapterId: string) => void; // 重新优化单个章节的回调
}

export interface ChapterGridRef {
  generateChapters: () => void;
  isGenerating: boolean;
}

export const ChapterGrid = forwardRef<ChapterGridRef, ChapterGridProps>(function ChapterGrid({
  noteId,
  videoPath,
  subtitlePath,
  chapterData: propChapterData,
  isGenerating,
  onChapterClick,
  onGenerationComplete,
  modelId,
  showToolbar = true, // 默认显示内置工具栏
  currentChapterId,
  showSubtitles: propShowSubtitles = false,
  // 字幕优化相关
  subtitleOptimizationEnabled = false,
  optimizedSubtitles,
  optimizingChapterIds,
  failedChapterIds,
  onReoptimizeChapter,
}: ChapterGridProps, ref) {
  const [generating, setGenerating] = useState(isGenerating);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]); // 字幕数据
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);

  // 同步父组件的 isGenerating 状态到内部状态
  useEffect(() => {
    setGenerating(isGenerating);
  }, [isGenerating]);

  // 加载字幕数据
  useEffect(() => {
    const loadSubtitles = async () => {
      if (!propShowSubtitles || !subtitlePath) {
        setSubtitles([]);
        return;
      }
      setLoadingSubtitles(true);
      try {
        const result = await invoke<SubtitleEntry[]>("parse_subtitle_file", {
          path: subtitlePath,
        });
        setSubtitles(result);
      } catch (error) {
        console.error("[loadSubtitles] 加载字幕失败:", error);
      } finally {
        setLoadingSubtitles(false);
      }
    };
    loadSubtitles();
  }, [propShowSubtitles, subtitlePath]);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    generateChapters: handleGenerateChapters,
    get isGenerating() { return generating; },
  }));

  // 如果 propChapterData 为 null，尝试从 note.detailed_reading 解析（用于初始加载）
  const effectiveChapterData = useMemo(() => {
    if (propChapterData) return propChapterData;
    // 这里无法直接访问 note 数据，由父组件负责传递
    return null;
  }, [propChapterData]);

  // 生成章节
  const handleGenerateChapters = async () => {
    // 防止重复生成
    if (generating) {
      return;
    }

    if (!modelId || !subtitlePath) {
      return;
    }

    try {
      setGenerating(true);
      setChapterGenerating(noteId, true); // 设置全局状态

      const generationId = crypto.randomUUID();

      // 设置事件监听
      const unlisten = await listen<ChapterGenerationEvent>(
        `chapter-generation-${generationId}`,
        (event) => {
          const data = event.payload;
          switch (data.status) {
            case "Starting":
              setProgress({ current: 0, total: 0, message: "开始分析..." });
              break;
            case "AnalyzingSubtitle":
              setProgress({ current: 0, total: 0, message: data.message });
              break;
            case "ChapterCompleted":
              // 使用后端返回的 completed 计数（并发场景下递增显示）
              setProgress({ current: data.completed, total: data.total, message: data.message });
              break;
            case "CapturingScreenshots":
              setProgress({ current: data.current, total: data.total, message: data.message });
              break;
            case "Completed":
              // 保存到数据库
              invoke("save_chapters_to_note", {
                noteId: noteId,
                chapterData: data.chapter_data,
              }).then(() => {
                onGenerationComplete?.();
                setGenerating(false);
                setChapterGenerating(noteId, false); // 清除全局状态
                setProgress(null);
              });
              unlisten();
              break;
            case "Error":
              setGenerating(false);
              setChapterGenerating(noteId, false); // 清除全局状态
              setProgress(null);
              unlisten();
              break;
            case "Aborted":
              setGenerating(false);
              setChapterGenerating(noteId, false); // 清除全局状态
              setProgress(null);
              unlisten();
              break;
          }
        }
      );

      // 开始生成
      await invoke("generate_chapters", {
        generationId,
        noteId: noteId,
        modelId: modelId,
        videoPath: videoPath,
        subtitlePath: subtitlePath,
        captureScreenshots: true,
      });
    } catch (error) {
      console.error("[handleGenerateChapters] 生成失败:", error);
      setGenerating(false);
      setChapterGenerating(noteId, false); // 清除全局状态
      setProgress(null);
    }
  };

  // 处理章节点击
  const handleChapterClick = (chapter: Chapter) => {
    onChapterClick?.(chapter);
  };

  // 如果正在生成，显示进度
  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <p className="text-slate-600 dark:text-slate-400 mb-2">
          {progress?.message || "正在生成章节..."}
        </p>
        {progress && progress.total > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-48 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <span className="text-sm text-slate-500 dark:text-slate-500">
              {progress.current} / {progress.total}
            </span>
          </div>
        )}
      </div>
    );
  }

  // 如果没有章节数据，显示空状态
  if (!effectiveChapterData || effectiveChapterData.chapters.length === 0) {
    const canGenerate = modelId && subtitlePath;
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-slate-400">
        <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg mb-2">暂无章节内容</p>
        <p className="text-sm mb-6">AI 可以根据视频字幕自动生成章节并截图</p>
        {showToolbar && canGenerate ? (
          <button
            onClick={handleGenerateChapters}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            生成章节
          </button>
        ) : showToolbar ? (
          <p className="text-sm text-orange-400">
            {!modelId ? "请先配置 AI 模型" : "请先上传字幕文件"}
          </p>
        ) : null}
      </div>
    );
  }

  // 渲染章节卡片列表（垂直布局，一行一个）
  return (
    <div className="p-1 overflow-y-auto">
      {showToolbar && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            共 {effectiveChapterData.chapters.length} 个章节
          </h2>
          <button
            onClick={handleGenerateChapters}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            重新生成
          </button>
        </div>
      )}
      <div className="space-y-3">
        {effectiveChapterData.chapters.map((chapter, index) => (
          <ChapterCard
            key={chapter.id}
            id={`chapter-${chapter.id}`}
            chapter={chapter}
            index={index}
            onDoubleClick={() => handleChapterClick(chapter)}
            isCurrent={currentChapterId === chapter.id}
            subtitles={propShowSubtitles ? subtitles : null}
            loadingSubtitles={loadingSubtitles}
            // 字幕优化相关
            subtitleOptimizationEnabled={subtitleOptimizationEnabled}
            optimizedSubtitle={optimizedSubtitles?.get(chapter.id)}
            isOptimizing={optimizingChapterIds?.has(chapter.id)}
            optimizationFailed={failedChapterIds?.has(chapter.id)}
            onReoptimize={onReoptimizeChapter ? () => onReoptimizeChapter(chapter.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
});

interface ChapterCardProps {
  chapter: Chapter;
  index: number;
  onDoubleClick: () => void;
  id?: string;
  isCurrent?: boolean; // 是否是当前播放的章节
  subtitles?: SubtitleEntry[] | null; // 字幕数据
  loadingSubtitles?: boolean; // 是否正在加载字幕
  // 字幕优化相关
  subtitleOptimizationEnabled?: boolean; // 是否启用字幕优化
  optimizedSubtitle?: string; // 优化后的字幕
  isOptimizing?: boolean; // 是否正在优化
  optimizationFailed?: boolean; // 优化是否失败
  onReoptimize?: () => void; // 重新优化回调
}

function ChapterCard({
  chapter,
  index,
  onDoubleClick,
  id,
  isCurrent = false,
  subtitles,
  loadingSubtitles = false,
  // 字幕优化相关
  subtitleOptimizationEnabled = false,
  optimizedSubtitle,
  isOptimizing = false,
  optimizationFailed = false,
  onReoptimize,
}: ChapterCardProps) {
  const [expanded, setExpanded] = useState(false); // 是否展开字幕

  // 当前选中章节自动展开字幕，非选中时收起
  useEffect(() => {
    if (subtitles && subtitles.length > 0) {
      setExpanded(isCurrent);
    }
  }, [isCurrent, subtitles]);

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const [imageError, setImageError] = useState(false);

  // 使用 Tauri 的 convertFileSrc 转换本地文件路径
  const screenshotUrl = chapter.screenshot_path ? convertFileSrc(chapter.screenshot_path) : null;

  // 计算当前章节对应的字幕（支持双语）
  const chapterSubtitles = useMemo(() => {
    if (!subtitles || subtitles.length === 0) return null;

    // 过滤出当前章节时间范围内的字幕
    const filtered = subtitles.filter(
      sub => sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
    );

    if (filtered.length === 0) return null;

    // 检查是否有双语字幕
    const hasBilingual = filtered.some(sub => sub.second_language_text);

    if (hasBilingual) {
      // 双语字幕：分离主语言和第二语言
      const primaryText = filtered
        .map(sub => sub.text)
        .join(" ");

      const secondaryText = filtered
        .filter(sub => sub.second_language_text)
        .map(sub => sub.second_language_text!)
        .join(" ");

      // 格式：第一语言 + 换行 + 空行 + 第二语言
      return { primary: primaryText, secondary: secondaryText };
    } else {
      // 单语字幕：直接拼接
      const text = filtered.map(sub => sub.text).join(" ");
      return { primary: text, secondary: null };
    }
  }, [subtitles, chapter.start_time, chapter.end_time]);

  // 是否有字幕内容
  const hasSubtitles = chapterSubtitles && chapterSubtitles.primary && chapterSubtitles.primary.length > 0;

  // 是否有优化后的字幕可显示
  const hasOptimizedSubtitle = subtitleOptimizationEnabled && optimizedSubtitle && optimizedSubtitle.length > 0;

  // 是否显示字幕区域（有原始字幕或有优化后字幕或正在优化或优化失败）
  const showSubtitleArea = hasSubtitles || hasOptimizedSubtitle || isOptimizing || optimizationFailed;

  return (
    <div
      id={id}
      className={cn(
        "group bg-white dark:bg-vnote-card rounded-lg border overflow-hidden hover:shadow-md transition-all",
        isCurrent
          ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/50 shadow-md"
          : "border-slate-200 dark:border-vnote-border hover:border-blue-400 dark:hover:border-blue-500"
      )}
    >
      {/* 主体内容区域 - 可点击跳转视频 */}
      <div
        onClick={onDoubleClick}
        className="flex cursor-pointer"
      >
        {/* 左侧截图区域 - 缩略图 */}
        <div className="relative w-48 flex-shrink-0 bg-slate-100 dark:bg-slate-800">
          {screenshotUrl && !imageError ? (
            <img
              src={screenshotUrl}
              alt={chapter.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
              <span className="text-3xl font-bold text-slate-300 dark:text-slate-600">
                {index + 1}
              </span>
            </div>
          )}

          {/* 播放按钮遮罩 */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <Play className="w-10 h-10 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* 章节序号 */}
          <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs w-7 h-7 rounded-full flex items-center justify-center font-medium">
            {index + 1}
          </div>

          {/* 时间戳标签 */}
          <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTime(chapter.start_time)}
          </div>
        </div>

        {/* 右侧内容区域 */}
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-start justify-between mb-2 gap-2">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base flex-1">
              {chapter.title}
            </h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTime(chapter.start_time)} - {formatTime(chapter.end_time)}
              </div>
              {/* 优化状态指示器 */}
              {isOptimizing && (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              )}
              {optimizationFailed && !isOptimizing && (
                <span title="字幕优化失败">
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                </span>
              )}
              {/* 展开/收起按钮 */}
              {showSubtitleArea && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(!expanded);
                  }}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  title={expanded ? "收起字幕" : "展开字幕"}
                >
                  {expanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
            {chapter.content}
          </p>
        </div>
      </div>

      {/* 字幕展开区域 - 抽屉效果 */}
      {showSubtitleArea && expanded && (
        <div className="px-4 pb-2 border-t border-slate-100 dark:border-slate-700/50">
          <div className="pt-5 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
            {/* 正在优化中 */}
            {isOptimizing && (
              <div className="flex items-center gap-2 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在优化字幕...
              </div>
            )}
            {/* 显示优化后的字幕 */}
            {!isOptimizing && hasOptimizedSubtitle && (
              <div>{optimizedSubtitle}</div>
            )}
            {/* 显示原始字幕（未启用优化或优化失败时） */}
            {!isOptimizing && !hasOptimizedSubtitle && hasSubtitles && (
              <div>
                {chapterSubtitles!.secondary ? (
                  // 双语字幕：两种语言换行+空行分隔
                  <>
                    {chapterSubtitles!.primary}
{"\n"}
{chapterSubtitles!.secondary}
                  </>
                ) : (
                  // 单语字幕
                  chapterSubtitles!.primary
                )}
              </div>
            )}
            {/* 优化失败提示 */}
            {!isOptimizing && optimizationFailed && !hasOptimizedSubtitle && (
              <div className="mt-2 text-xs text-orange-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                字幕优化失败{hasSubtitles ? "，显示原始字幕" : ""}
              </div>
            )}
            {/* 重新优化按钮 - 只要字幕优化开关开启且不在优化中就显示 */}
            {!isOptimizing && subtitleOptimizationEnabled && onReoptimize && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReoptimize();
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer",
                    optimizationFailed && !hasOptimizedSubtitle
                      ? "text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                      : "text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  )}
                  title="重新优化此章节字幕"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {optimizationFailed && !hasOptimizedSubtitle ? "重试" : "重新优化"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 加载字幕状态 */}
      {loadingSubtitles && !subtitles && (
        <div className="px-4 pb-3 border-t border-slate-100 dark:border-slate-700/50">
          <div className="pt-3 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在加载字幕...
          </div>
        </div>
      )}
    </div>
  );
}
