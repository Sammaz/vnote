import { describe, expect, it } from "vitest";
import type { DetailedReadingChapter } from "../types";
import { findCurrentDetailedReadingChapter } from "./detailedReadingChapters";

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
