import { useRef, useState, useEffect } from "react";
import { DetailedReadingData, SubtitleEntry } from "../../types";
import { DetailedReadingChapterCard } from "./DetailedReadingChapterCard";

interface DetailedReadingViewProps {
  data: DetailedReadingData;
  currentChapterId: string | null;
  subtitleEntries?: SubtitleEntry[];
  showSubtitles?: boolean;
  subtitleOptimizationEnabled?: boolean;
  optimizedSubtitles?: Map<string, string>;
  optimizingChapterIds?: Set<string>;
  failedChapterIds?: Set<string>;
  onReoptimizeChapter?: (chapterId: string) => void;
  regeneratingChapterIds?: Set<string>;
  regenerateLocked?: boolean;
  onRegenerateChapter?: (chapterId: string) => void;
}

export function DetailedReadingView({
  data,
  currentChapterId,
  subtitleEntries = [],
  showSubtitles = false,
  subtitleOptimizationEnabled = false,
  optimizedSubtitles,
  optimizingChapterIds,
  failedChapterIds,
  onReoptimizeChapter,
  regeneratingChapterIds,
  regenerateLocked = false,
  onRegenerateChapter,
}: DetailedReadingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const check = () => {
      const containerWidth = el.offsetWidth;
      const viewportWidth = window.innerWidth;
      // 当容器宽度占视口比例低于 45% 时，使用紧凑布局（图片在上）
      setCompact(containerWidth / viewportWidth < 0.45);
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    window.addEventListener("resize", check);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div ref={containerRef} className="p-1 h-full">
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
            onReoptimizeChapter={onReoptimizeChapter}
            isRegenerating={regeneratingChapterIds?.has(chapter.id)}
            regenerateLocked={regenerateLocked}
            onRegenerateChapter={onRegenerateChapter}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
