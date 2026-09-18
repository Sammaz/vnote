import { describe, expect, it } from "vitest";
import type { DetailedReadingChapter } from "../types";
import { findCurrentDetailedReadingChapter, getDetailedReadingChapterStatus, mergeDetailedReadingChapter } from "./detailedReadingChapters";

const chapter = (
  id: string,
  startTime: number,
  endTime: number
): DetailedReadingChapter => ({
  id,
  title: `Chapter ${id}`,
  start_time: startTime,
  end_time: endTime,
  content: "",
  subtitle_entries: [],
  screenshot_path: null,
});

describe("findCurrentDetailedReadingChapter", () => {
  it("assigns a shared boundary to the next chapter", () => {
    const chapters = [
      chapter("first", 0, 60),
      chapter("second", 60, 120),
    ];

    expect(findCurrentDetailedReadingChapter(chapters, 60)?.id).toBe("second");
  });

  it("keeps the previous chapter active just before a shared boundary", () => {
    const chapters = [
      chapter("first", 0, 60),
      chapter("second", 60, 120),
    ];

    expect(findCurrentDetailedReadingChapter(chapters, 59.999)?.id).toBe("first");
  });

  it("includes the final chapter end time", () => {
    const chapters = [
      chapter("first", 0, 60),
      chapter("second", 60, 120),
    ];

    expect(findCurrentDetailedReadingChapter(chapters, 120)?.id).toBe("second");
  });

  it("prefers later chapters when generated ranges overlap", () => {
    const chapters = [
      chapter("first", 0, 70),
      chapter("second", 60, 120),
    ];

    expect(findCurrentDetailedReadingChapter(chapters, 60)?.id).toBe("second");
    expect(findCurrentDetailedReadingChapter(chapters, 65)?.id).toBe("second");
  });

  it("returns null when the time is outside every chapter", () => {
    const chapters = [
      chapter("first", 10, 20),
      chapter("second", 30, 40),
    ];

    expect(findCurrentDetailedReadingChapter(chapters, 5)).toBeNull();
    expect(findCurrentDetailedReadingChapter(chapters, 25)).toBeNull();
    expect(findCurrentDetailedReadingChapter(chapters, 45)).toBeNull();
  });
});

describe("mergeDetailedReadingChapter", () => {
  it("inserts chapters in start_time order and preserves unchanged identities", () => {
    const first = chapter("first", 0, 60);
    const third = chapter("third", 120, 180);
    const merged = mergeDetailedReadingChapter(
      mergeDetailedReadingChapter(null, third, 180),
      first,
      180
    );

    expect(merged.chapters.map((item) => item.id)).toEqual(["first", "third"]);
    expect(merged.chapters[1]).toBe(third);

    const sameAgain = mergeDetailedReadingChapter(merged, first, 180);
    expect(sameAgain).toBe(merged);
  });

  it("replaces an existing chapter by id when screenshot arrives", () => {
    const first = chapter("first", 0, 60);
    const withShot = { ...first, screenshot_path: "shot.jpg" };
    const merged = mergeDetailedReadingChapter(
      { chapters: [first], total_duration: 60, generated_at: "t" },
      withShot,
      60
    );

    expect(merged.chapters).toHaveLength(1);
    expect(merged.chapters[0]).toBe(withShot);
    expect(merged.chapters[0].screenshot_path).toBe("shot.jpg");
  });

  it("replaces an existing chapter by id when status changes", () => {
    const first = chapter("first", 0, 60);
    const failed = { ...first, status: "failed" as const, error: "timeout" };
    const merged = mergeDetailedReadingChapter(
      { chapters: [first], total_duration: 60, generated_at: "t" },
      failed,
      60
    );

    expect(merged.chapters).toHaveLength(1);
    expect(merged.chapters[0].status).toBe("failed");
    expect(merged.chapters[0].error).toBe("timeout");
  });
});

describe("getDetailedReadingChapterStatus", () => {
  it("treats missing status as success", () => {
    expect(getDetailedReadingChapterStatus(chapter("first", 0, 60))).toBe("success");
    expect(getDetailedReadingChapterStatus({ status: "failed" })).toBe("failed");
  });
});
