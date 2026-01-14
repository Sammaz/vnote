import { useState, useMemo, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Clock, Image as ImageIcon, Loader2 } from "lucide-react";
import type { Chapter, ChapterData, ChapterGenerationEvent } from "../../types";
import { cn } from "../../utils/cn";

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
}: ChapterGridProps, ref) {
  const [generating, setGenerating] = useState(isGenerating);
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);

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
    if (!modelId || !subtitlePath) {
      return;
    }

    try {
      setGenerating(true);
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
            case "GeneratingChapters":
              setProgress({ current: data.current, total: data.total, message: data.message });
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
                setProgress(null);
              });
              unlisten();
              break;
            case "Error":
              setGenerating(false);
              setProgress(null);
              unlisten();
              break;
            case "Aborted":
              setGenerating(false);
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
}

function ChapterCard({ chapter, index, onDoubleClick, id, isCurrent = false }: ChapterCardProps) {
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

  return (
    <div
      id={id}
      onClick={onDoubleClick}
      className={cn(
        "group flex bg-white dark:bg-vnote-card rounded-lg border overflow-hidden hover:shadow-md transition-all cursor-pointer",
        isCurrent
          ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/50 shadow-md"
          : "border-slate-200 dark:border-vnote-border hover:border-blue-400 dark:hover:border-blue-500"
      )}
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
          <div className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1 flex-shrink-0">
            <Clock className="w-3 h-3" />
            {formatTime(chapter.start_time)} - {formatTime(chapter.end_time)}
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
          {chapter.content}
        </p>
      </div>
    </div>
  );
}
