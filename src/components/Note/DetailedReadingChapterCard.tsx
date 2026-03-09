import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { DetailedReadingChapter, SubtitleEntry } from "../../types";
import { cn } from "../../utils/cn";

interface DetailedReadingChapterCardProps {
  chapter: DetailedReadingChapter;
  index: number;
  isCurrent: boolean;
  subtitleEntries?: SubtitleEntry[];
  showSubtitles?: boolean;
  subtitleOptimizationEnabled?: boolean;
  optimizedSubtitle?: string;
  isOptimizing?: boolean;
  optimizationFailed?: boolean;
  onReoptimize?: () => void;
}

const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`;
};

const getChapterSubtitleEntries = (
  chapter: DetailedReadingChapter,
  subtitleEntries: SubtitleEntry[]
): SubtitleEntry[] => {
  if (chapter.subtitle_entries.length > 0) {
    return chapter.subtitle_entries;
  }

  return subtitleEntries.filter(
    sub => sub.start_time >= chapter.start_time && sub.start_time < chapter.end_time
  );
};

const splitSubtitleEntriesIntoParagraphs = (entries: SubtitleEntry[]): SubtitleEntry[][] => {
  if (entries.length === 0) return [];

  const paragraphs: SubtitleEntry[][] = [];
  let currentParagraph: SubtitleEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    currentParagraph.push(entry);

    const isLast = i === entries.length - 1;
    if (isLast) {
      paragraphs.push(currentParagraph);
      break;
    }

    const next = entries[i + 1];
    const hasPunctuationBreak = /[。！？.!?]$/.test(entry.text.trim());
    const hasTimeGapBreak = next.start_time - entry.end_time >= 1.5;

    if (hasPunctuationBreak || hasTimeGapBreak) {
      paragraphs.push(currentParagraph);
      currentParagraph = [];
    }
  }

  return paragraphs;
};

const normalizeForMatch = (text: string): string => {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const splitOptimizedParagraphs = (text?: string): string[] => {
  if (!text) return [];
  return text
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
};

const extractParagraphAnchors = (paragraph: string): { startAnchor: string; endAnchor: string; weight: number } => {
  const normalizedParagraph = normalizeForMatch(paragraph);
  const sentenceCandidates = paragraph
    .replace(/\n+/g, " ")
    .split(/[。！？.!?]+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  if (sentenceCandidates.length === 0) {
    return {
      startAnchor: paragraph.trim(),
      endAnchor: paragraph.trim(),
      weight: Math.max(1, normalizedParagraph.length),
    };
  }

  return {
    startAnchor: sentenceCandidates[0],
    endAnchor: sentenceCandidates[sentenceCandidates.length - 1],
    weight: Math.max(1, normalizedParagraph.length),
  };
};

const buildNgrams = (text: string, size: number): Set<string> => {
  const compact = normalizeForMatch(text).replace(/\s+/g, "");
  if (!compact) return new Set();
  if (compact.length <= size) return new Set([compact]);

  const result = new Set<string>();
  for (let i = 0; i <= compact.length - size; i++) {
    result.add(compact.slice(i, i + size));
  }
  return result;
};

const calculateSimilarity = (source: string, target: string): number => {
  const sourceNormalized = normalizeForMatch(source);
  const targetNormalized = normalizeForMatch(target);

  if (!sourceNormalized || !targetNormalized) return 0;

  const sourceTokens = new Set(sourceNormalized.split(" ").filter(Boolean));
  const targetTokens = new Set(targetNormalized.split(" ").filter(Boolean));

  let intersection = 0;
  sourceTokens.forEach(token => {
    if (targetTokens.has(token)) intersection += 1;
  });

  const union = new Set([...sourceTokens, ...targetTokens]).size;
  const tokenOverlap = union > 0 ? intersection / union : 0;

  const sourceNgrams = buildNgrams(sourceNormalized, 2);
  const targetNgrams = buildNgrams(targetNormalized, 2);

  let ngramIntersection = 0;
  sourceNgrams.forEach(ngram => {
    if (targetNgrams.has(ngram)) ngramIntersection += 1;
  });

  const dice =
    sourceNgrams.size + targetNgrams.size > 0
      ? (2 * ngramIntersection) / (sourceNgrams.size + targetNgrams.size)
      : 0;

  return tokenOverlap * 0.6 + dice * 0.4;
};

const scoreAnchorAgainstEntryWindow = (
  anchor: string,
  entries: SubtitleEntry[],
  windowStart: number,
  windowEnd: number
): number => {
  if (windowStart < 0 || windowEnd >= entries.length || windowStart > windowEnd) return 0;
  const windowText = entries.slice(windowStart, windowEnd + 1).map(entry => entry.text).join(" ");
  return calculateSimilarity(anchor, windowText);
};

const findBestAnchorIndex = (
  anchor: string,
  entries: SubtitleEntry[],
  searchStart: number,
  searchEnd: number
): { index: number; score: number } | null => {
  const normalizedAnchor = normalizeForMatch(anchor);
  if (!normalizedAnchor || searchStart > searchEnd) return null;

  let bestIndex = -1;
  let bestScore = 0;
  const maxWindowSize = 3;

  for (let i = searchStart; i <= searchEnd; i++) {
    for (let windowSize = 1; windowSize <= maxWindowSize; windowSize++) {
      const windowEnd = i + windowSize - 1;
      if (windowEnd > searchEnd) break;

      const score = scoreAnchorAgainstEntryWindow(anchor, entries, i, windowEnd);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
  }

  if (bestIndex < 0) return null;
  return { index: bestIndex, score: bestScore };
};

const buildLinearRangesByWeight = (
  paragraphAnchors: { weight: number }[],
  totalEntries: number
): Array<{ start: number; end: number }> | null => {
  if (paragraphAnchors.length === 0 || totalEntries <= 0) return null;
  if (totalEntries < paragraphAnchors.length) return null;

  const totalWeight = paragraphAnchors.reduce((sum, anchor) => sum + anchor.weight, 0);
  let consumed = 0;
  let accumulatedWeight = 0;

  return paragraphAnchors.map((anchor, index) => {
    const remainingParagraphs = paragraphAnchors.length - index - 1;
    const maxEnd = totalEntries - remainingParagraphs - 1;

    const start = consumed;
    accumulatedWeight += anchor.weight;

    const targetConsumed =
      index === paragraphAnchors.length - 1
        ? totalEntries
        : Math.round((accumulatedWeight / totalWeight) * totalEntries);

    const desiredEnd = Math.max(start, targetConsumed - 1);
    const end = Math.min(Math.max(desiredEnd, start), maxEnd);

    consumed = end + 1;

    return { start, end };
  });
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const joinEntryTexts = (entries: SubtitleEntry[], start: number, end: number): string => {
  if (start > end) return "";
  return entries.slice(start, end + 1).map(entry => entry.text).join(" ");
};

const optimizeParagraphBoundaries = (
  entries: SubtitleEntry[],
  optimizedParagraphs: string[],
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> => {
  if (ranges.length <= 1 || ranges.length !== optimizedParagraphs.length) {
    return ranges;
  }

  const optimizedRanges = ranges.map(range => ({ ...range }));

  // 迭代两轮，逐个优化相邻段之间的切分点
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < optimizedRanges.length - 1; i++) {
      const left = optimizedRanges[i];
      const right = optimizedRanges[i + 1];

      const minCut = left.start;
      const maxCut = right.end - 1;
      if (minCut > maxCut) continue;

      let bestCut = clamp(left.end, minCut, maxCut);
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let cut = minCut; cut <= maxCut; cut++) {
        const leftText = joinEntryTexts(entries, left.start, cut);
        const rightText = joinEntryTexts(entries, cut + 1, right.end);
        const score =
          calculateSimilarity(optimizedParagraphs[i], leftText) +
          calculateSimilarity(optimizedParagraphs[i + 1], rightText);

        if (score > bestScore) {
          bestScore = score;
          bestCut = cut;
        }
      }

      left.end = bestCut;
      right.start = bestCut + 1;
    }
  }

  return optimizedRanges;
};

const alignOriginalEntriesByOptimizedParagraphs = (
  entries: SubtitleEntry[],
  optimizedSubtitle?: string
): SubtitleEntry[][] => {
  if (entries.length === 0) return [];

  const optimizedParagraphs = splitOptimizedParagraphs(optimizedSubtitle);
  if (optimizedParagraphs.length === 0) {
    return splitSubtitleEntriesIntoParagraphs(entries);
  }

  if (optimizedParagraphs.length === 1) {
    return [entries];
  }

  const paragraphAnchors = optimizedParagraphs.map(extractParagraphAnchors);
  const linearRanges = buildLinearRangesByWeight(paragraphAnchors, entries.length);
  if (!linearRanges) {
    return splitSubtitleEntriesIntoParagraphs(entries);
  }

  const highConfidenceThreshold = 0.5;
  const mediumConfidenceThreshold = 0.3;
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (let paragraphIndex = 0; paragraphIndex < paragraphAnchors.length; paragraphIndex++) {
    const anchor = paragraphAnchors[paragraphIndex];
    const remainingParagraphs = paragraphAnchors.length - paragraphIndex - 1;
    const maxEnd = entries.length - remainingParagraphs - 1;
    const estimatedRange = linearRanges[paragraphIndex];
    const estimatedSize = Math.max(1, estimatedRange.end - estimatedRange.start + 1);

    if (cursor > maxEnd) {
      return splitSubtitleEntriesIntoParagraphs(entries);
    }

    const startMatch = findBestAnchorIndex(anchor.startAnchor, entries, cursor, maxEnd);
    const hasStartMatch = !!startMatch && startMatch.score >= mediumConfidenceThreshold;

    // 为了保证原文不丢行，段起点始终从 cursor 开始连续覆盖
    // startMatch 仅作为置信度信号，不直接用于截断起点
    let startIndex = cursor;

    const endMatch = findBestAnchorIndex(anchor.endAnchor, entries, startIndex, maxEnd);
    const hasEndMatch = !!endMatch && endMatch.score >= mediumConfidenceThreshold;

    let endIndex = hasEndMatch
      ? Math.max(startIndex, (endMatch as { index: number; score: number }).index)
      : startIndex + estimatedSize - 1;
    endIndex = clamp(endIndex, startIndex, maxEnd);

    const isHighConfidence =
      hasStartMatch &&
      hasEndMatch &&
      (startMatch as { index: number; score: number }).score >= highConfidenceThreshold &&
      (endMatch as { index: number; score: number }).score >= highConfidenceThreshold;

    const isMediumConfidence = !isHighConfidence && (hasStartMatch || hasEndMatch);

    if (!isHighConfidence && isMediumConfidence) {
      if (hasStartMatch && !hasEndMatch) {
        endIndex = clamp(startIndex + estimatedSize - 1, startIndex, maxEnd);
      } else if (!hasStartMatch && hasEndMatch) {
        startIndex = clamp(endIndex - estimatedSize + 1, cursor, endIndex);
      }
    }

    if (!isHighConfidence && !isMediumConfidence) {
      startIndex = clamp(Math.max(cursor, estimatedRange.start), cursor, maxEnd);
      endIndex = clamp(Math.max(startIndex, estimatedRange.end), startIndex, maxEnd);
    }

    ranges.push({ start: startIndex, end: endIndex });
    cursor = endIndex + 1;
  }

  if (ranges.length === 0) {
    return splitSubtitleEntriesIntoParagraphs(entries);
  }

  if (cursor < entries.length) {
    ranges[ranges.length - 1].end = entries.length - 1;
  }

  const optimizedRanges = optimizeParagraphBoundaries(entries, optimizedParagraphs, ranges);

  const alignedParagraphs = optimizedRanges
    .map(range => entries.slice(range.start, range.end + 1))
    .filter(paragraph => paragraph.length > 0);

  if (alignedParagraphs.length === 0) {
    return splitSubtitleEntriesIntoParagraphs(entries);
  }

  return alignedParagraphs;
};

export function DetailedReadingChapterCard({
  chapter,
  index,
  isCurrent,
  subtitleEntries = [],
  showSubtitles = false,
  subtitleOptimizationEnabled = false,
  optimizedSubtitle,
  isOptimizing = false,
  optimizationFailed = false,
  onReoptimize,
}: DetailedReadingChapterCardProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSeek = (time: number) => {
    window.dispatchEvent(new CustomEvent("seek-video", { detail: { time } }));
  };

  const chapterSubtitleEntries = useMemo(() => {
    if (!showSubtitles) return [];
    return getChapterSubtitleEntries(chapter, subtitleEntries);
  }, [showSubtitles, chapter, subtitleEntries]);

  const subtitleParagraphs = useMemo(
    () => alignOriginalEntriesByOptimizedParagraphs(chapterSubtitleEntries, optimizedSubtitle),
    [chapterSubtitleEntries, optimizedSubtitle]
  );

  const hasSubtitles = chapterSubtitleEntries.length > 0;
  const hasOptimizedSubtitle = subtitleOptimizationEnabled && !!optimizedSubtitle && optimizedSubtitle.length > 0;
  const showSubtitleArea = showSubtitles;

  useEffect(() => {
    if (showSubtitleArea) {
      setExpanded(isCurrent);
    }
  }, [isCurrent, showSubtitleArea]);

  return (
    <div
      id={`chapter-${chapter.id}`}
      className={cn(
        "bg-white dark:bg-vnote-card rounded-lg border overflow-hidden transition-all",
        isCurrent ? "border-blue-500 ring-2 ring-blue-500/50" : "border-slate-200 dark:border-vnote-border"
      )}
    >
      <div className="flex cursor-pointer hover:bg-slate-50 dark:hover:bg-vnote-hover" onClick={() => handleSeek(chapter.start_time)}>
        {chapter.screenshot_path && (
          <div className="relative w-48 flex-shrink-0 bg-slate-100 dark:bg-slate-800">
            <img
              src={convertFileSrc(chapter.screenshot_path)}
              alt={chapter.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs w-7 h-7 rounded-full flex items-center justify-center font-medium">
              {index + 1}
            </div>
          </div>
        )}

        <div className="flex-1 p-4 flex items-center justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{chapter.title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTime(chapter.start_time)} - {formatTime(chapter.end_time)}
            </p>
            {chapter.content?.trim() && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {chapter.content}
              </p>
            )}
          </div>

          <div className="ml-4 flex items-center gap-2">
            {isOptimizing && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
            {optimizationFailed && !isOptimizing && (
              <span title="字幕优化失败">
                <AlertCircle className="w-4 h-4 text-orange-500" />
              </span>
            )}
            {showSubtitleArea && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
              >
                {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {showSubtitleArea && expanded && (
        <div className="px-4 pb-3 border-t border-slate-200 dark:border-vnote-border pt-2 space-y-2">
          {isOptimizing && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在优化字幕...
            </div>
          )}

          {!isOptimizing && hasOptimizedSubtitle && (
            <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{optimizedSubtitle}</div>
          )}

          {!isOptimizing && !hasOptimizedSubtitle && hasSubtitles && (
            <div className="space-y-4">
              {subtitleParagraphs.map((paragraph, paragraphIndex) => (
                <div key={`${chapter.id}-paragraph-${paragraphIndex}`} className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {paragraph.map((entry, entryIndex) => (
                    <span key={`${chapter.id}-${entry.index}-${entry.start_time}-${entryIndex}`}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSeek(entry.start_time);
                        }}
                        className="inline text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                      >
                        {entry.text}
                      </button>
                      {entryIndex < paragraph.length - 1 ? " " : ""}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {!isOptimizing && !hasOptimizedSubtitle && !hasSubtitles && (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-1 px-2">
              暂无可显示的字幕内容
            </div>
          )}

          {!isOptimizing && optimizationFailed && !hasOptimizedSubtitle && (
            <div className="text-xs text-orange-500 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              字幕优化失败，显示原始字幕
            </div>
          )}

          {!isOptimizing && subtitleOptimizationEnabled && onReoptimize && (
            <div className="flex justify-end">
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
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {optimizationFailed && !hasOptimizedSubtitle ? "重试" : "重新优化"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
