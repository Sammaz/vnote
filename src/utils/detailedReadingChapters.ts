import type { DetailedReadingChapter } from "../types";

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
