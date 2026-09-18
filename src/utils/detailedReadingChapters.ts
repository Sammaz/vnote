import type { DetailedReadingChapter, DetailedReadingChapterStatus, DetailedReadingData } from "../types";

export function getDetailedReadingChapterStatus(
  chapter: Pick<DetailedReadingChapter, "status">,
): DetailedReadingChapterStatus {
  return chapter.status ?? "success";
}

const CHAPTER_TIME_EPSILON = 1e-6;

/**
 * Finds the active detailed-reading chapter for a playback time.
 *
 * Chapter ranges are treated as half-open intervals: [start_time, end_time).
 * The final chapter includes its end_time. When generated data has touching or
 * slightly overlapping ranges, later chapters win at their own start_time so a
 * chapter is always selectable by seeking to its start.
 */
export function findCurrentDetailedReadingChapter(
  chapters: DetailedReadingChapter[],
  time: number
): DetailedReadingChapter | null {
  if (!Number.isFinite(time) || chapters.length === 0) return null;

  let exactStartMatch: DetailedReadingChapter | null = null;
  for (const chapter of chapters) {
    if (Math.abs(time - chapter.start_time) <= CHAPTER_TIME_EPSILON) {
      exactStartMatch = chapter;
    }
  }

  if (exactStartMatch) return exactStartMatch;

  let current: DetailedReadingChapter | null = null;
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index];
    const isLastChapter = index === chapters.length - 1;
    const isInRange =
      time >= chapter.start_time &&
      (time < chapter.end_time || (isLastChapter && time <= chapter.end_time));

    if (isInRange) {
      current = chapter;
    }
  }

  return current;
}


export function mergeDetailedReadingChapter(
  prev: DetailedReadingData | null,
  chapter: DetailedReadingChapter,
  totalDuration: number,
): DetailedReadingData {
  const generatedAt = prev?.generated_at || new Date().toISOString();
  if (!prev || prev.chapters.length === 0) {
    return {
      chapters: [chapter],
      total_duration: totalDuration,
      generated_at: generatedAt,
    };
  }

  const existingIndex = prev.chapters.findIndex((item) => item.id === chapter.id);
  if (existingIndex >= 0) {
    const old = prev.chapters[existingIndex];
    if (
      old.title === chapter.title &&
      old.content === chapter.content &&
      old.screenshot_path === chapter.screenshot_path &&
      old.start_time === chapter.start_time &&
      old.end_time === chapter.end_time &&
      old.status === chapter.status &&
      old.error === chapter.error
    ) {
      return prev;
    }
    const chapters = prev.chapters.slice();
    chapters[existingIndex] = chapter;
    return {
      ...prev,
      chapters,
      total_duration: totalDuration,
    };
  }

  const chapters = prev.chapters.concat(chapter).sort((left, right) => {
    if (left.start_time !== right.start_time) return left.start_time - right.start_time;
    return left.end_time - right.end_time;
  });
  return {
    chapters,
    total_duration: totalDuration,
    generated_at: generatedAt,
  };
}
