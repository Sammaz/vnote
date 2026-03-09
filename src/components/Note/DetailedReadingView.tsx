import { useMemo } from "react";
import { DetailedReadingData, SubtitleEntry } from "../../types";
import { DetailedReadingChapterCard } from "./DetailedReadingChapterCard";

interface DetailedReadingViewProps {
  data: DetailedReadingData;
  currentTime: number;
  subtitleEntries?: SubtitleEntry[];
  showSubtitles?: boolean;
  subtitleOptimizationEnabled?: boolean;
  optimizedSubtitles?: Map<string, string>;
  optimizingChapterIds?: Set<string>;
  failedChapterIds?: Set<string>;
  onReoptimizeChapter?: (chapterId: string) => void;
}

export function DetailedReadingView({
  data,
  currentTime,
  subtitleEntries = [],
  showSubtitles = false,
  subtitleOptimizationEnabled = false,
  optimizedSubtitles,
  optimizingChapterIds,
  failedChapterIds,
  onReoptimizeChapter,
}: DetailedReadingViewProps) {
  const currentChapterId = useMemo(() => {
    const chapter = data.chapters.find(
      c => currentTime >= c.start_time && currentTime < c.end_time
    );
    return chapter?.id || null;
  }, [data.chapters, currentTime]);

  return (
    <div className="p-1 h-full">
      <div className="space-y-3">
        {data.chapters.map((chapter, index) => (
          <DetailedReadingChapterCard
            key={chapter.id}
            chapter={chapter}
            index={index}
            isCurrent={currentChapterId === chapter.id}
            subtitleEntries={subtitleEntries}
            showSubtitles={showSubtitles}
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
}
