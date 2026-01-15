/**
 * Markdown 组装工具函数测试
 * 使用 vitest + fast-check 进行单元测试和属性测试
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import {
  formatTime,
  getChapterSubtitles,
  assembleChapterSection,
  assembleChapterMarkdown,
  getChaptersNeedingOptimization,
  type AssembleMarkdownOptions,
} from "./markdownAssembler";
import type { Chapter, SubtitleEntry } from "../types";

// Mock convertFileSrc
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

// ============================================================================
// 测试数据生成器
// ============================================================================

// 生成随机章节
const chapterArbitrary = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  start_time: fc.nat({ max: 3600 }), // 0-1小时
  end_time: fc.nat({ max: 7200 }), // 0-2小时
  content: fc.string({ maxLength: 200 }),
  screenshot_path: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: null }),
}).map((chapter) => ({
  ...chapter,
  // 确保 end_time > start_time
  end_time: chapter.start_time + Math.max(1, chapter.end_time - chapter.start_time),
})) as fc.Arbitrary<Chapter>;

// 生成随机字幕条目（保留以备将来使用）
// @ts-expect-error 保留以备将来使用
const subtitleEntryArbitrary = fc.record({
  index: fc.nat(),
  start_time: fc.nat({ max: 7200 }),
  end_time: fc.nat({ max: 7200 }),
  text: fc.string({ minLength: 1, maxLength: 100 }),
  second_language_text: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
}).map((entry) => ({
  ...entry,
  end_time: entry.start_time + Math.max(1, entry.end_time - entry.start_time),
})) as fc.Arbitrary<SubtitleEntry>;

// ============================================================================
// formatTime 测试
// ============================================================================

describe("formatTime", () => {
  it("should format seconds under 1 hour as MM:SS", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(59)).toBe("0:59");
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(125)).toBe("2:05");
    expect(formatTime(3599)).toBe("59:59");
  });

  it("should format seconds 1 hour or more as HH:MM:SS", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
    expect(formatTime(7325)).toBe("2:02:05");
  });

  // Property: 时间戳格式一致性
  it("Property 4: Timestamp Format Consistency - should always produce valid format", () => {
    fc.assert(
      fc.property(fc.nat({ max: 36000 }), (seconds) => {
        const result = formatTime(seconds);
        // 检查格式：MM:SS 或 HH:MM:SS
        if (seconds >= 3600) {
          expect(result).toMatch(/^\d+:\d{2}:\d{2}$/);
        } else {
          expect(result).toMatch(/^\d+:\d{2}$/);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// getChapterSubtitles 测试
// ============================================================================

describe("getChapterSubtitles", () => {
  it("should return empty string for empty subtitles", () => {
    const chapter: Chapter = {
      id: "1",
      title: "Test",
      start_time: 0,
      end_time: 60,
      content: "",
      screenshot_path: null,
    };
    expect(getChapterSubtitles(chapter, [])).toBe("");
  });

  it("should filter subtitles by chapter time range", () => {
    const chapter: Chapter = {
      id: "1",
      title: "Test",
      start_time: 10,
      end_time: 30,
      content: "",
      screenshot_path: null,
    };
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 5, end_time: 10, text: "Before" },
      { index: 1, start_time: 15, end_time: 20, text: "Inside1" },
      { index: 2, start_time: 25, end_time: 28, text: "Inside2" },
      { index: 3, start_time: 35, end_time: 40, text: "After" },
    ];
    expect(getChapterSubtitles(chapter, subtitles)).toBe("Inside1 Inside2");
  });

  it("should handle bilingual subtitles by using primary text only", () => {
    const chapter: Chapter = {
      id: "1",
      title: "Test",
      start_time: 0,
      end_time: 60,
      content: "",
      screenshot_path: null,
    };
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 10, end_time: 20, text: "中文", second_language_text: "English" },
    ];
    expect(getChapterSubtitles(chapter, subtitles)).toBe("中文");
  });
});

// ============================================================================
// assembleChapterSection 测试
// ============================================================================

describe("assembleChapterSection", () => {
  it("should include chapter title with timestamp", () => {
    const chapter: Chapter = {
      id: "1",
      title: "Test Chapter",
      start_time: 65,
      end_time: 125,
      content: "",
      screenshot_path: null,
    };
    const result = assembleChapterSection(chapter, 0, undefined, []);
    expect(result).toContain("# Test Chapter (1:05 - 2:05)");
  });

  it("should include screenshot when available", () => {
    const chapter: Chapter = {
      id: "1",
      title: "Test",
      start_time: 0,
      end_time: 60,
      content: "",
      screenshot_path: "/path/to/image.png",
    };
    const result = assembleChapterSection(chapter, 0, undefined, []);
    expect(result).toContain("![Test](asset://localhost/path/to/image.png)");
  });

  it("should use optimized subtitle when available", () => {
    const chapter: Chapter = {
      id: "1",
      title: "Test",
      start_time: 0,
      end_time: 60,
      content: "",
      screenshot_path: null,
    };
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 10, end_time: 20, text: "Original text" },
    ];
    const result = assembleChapterSection(chapter, 0, "Optimized text", subtitles);
    expect(result).toContain("Optimized text");
    expect(result).not.toContain("Original text");
  });

  it("should fall back to original subtitle when no optimized version", () => {
    const chapter: Chapter = {
      id: "1",
      title: "Test",
      start_time: 0,
      end_time: 60,
      content: "",
      screenshot_path: null,
    };
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 10, end_time: 20, text: "Original text" },
    ];
    const result = assembleChapterSection(chapter, 0, undefined, subtitles);
    expect(result).toContain("Original text");
  });
});

// ============================================================================
// assembleChapterMarkdown 测试
// ============================================================================

describe("assembleChapterMarkdown", () => {
  it("should return empty string for empty chapters", () => {
    const options: AssembleMarkdownOptions = {
      chapters: [],
      optimizedSubtitles: new Map(),
      originalSubtitles: [],
    };
    expect(assembleChapterMarkdown(options)).toBe("");
  });

  it("should assemble multiple chapters", () => {
    const chapters: Chapter[] = [
      { id: "1", title: "Chapter 1", start_time: 0, end_time: 60, content: "", screenshot_path: null },
      { id: "2", title: "Chapter 2", start_time: 60, end_time: 120, content: "", screenshot_path: null },
    ];
    const options: AssembleMarkdownOptions = {
      chapters,
      optimizedSubtitles: new Map(),
      originalSubtitles: [],
    };
    const result = assembleChapterMarkdown(options);
    expect(result).toContain("# Chapter 1");
    expect(result).toContain("# Chapter 2");
  });

  // Property 1: Markdown Assembly Completeness
  it("Property 1: Markdown Assembly Completeness - should contain heading for each chapter", () => {
    fc.assert(
      fc.property(
        fc.array(chapterArbitrary, { minLength: 1, maxLength: 10 }),
        (chapters) => {
          const options: AssembleMarkdownOptions = {
            chapters,
            optimizedSubtitles: new Map(),
            originalSubtitles: [],
          };
          const result = assembleChapterMarkdown(options);
          
          // 每个章节都应该有一个标题
          for (const chapter of chapters) {
            expect(result).toContain(`# ${chapter.title}`);
          }
          
          // 标题数量应该等于章节数量
          const headingCount = (result.match(/^# /gm) || []).length;
          expect(headingCount).toBe(chapters.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 2: Screenshot Inclusion
  it("Property 2: Screenshot Inclusion - should include all non-null screenshots", () => {
    fc.assert(
      fc.property(
        fc.array(chapterArbitrary, { minLength: 1, maxLength: 10 }),
        (chapters) => {
          const options: AssembleMarkdownOptions = {
            chapters,
            optimizedSubtitles: new Map(),
            originalSubtitles: [],
          };
          const result = assembleChapterMarkdown(options);
          
          for (const chapter of chapters) {
            if (chapter.screenshot_path) {
              // 应该包含图片语法
              expect(result).toContain(`![${chapter.title}]`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 3: Subtitle Content Priority
  it("Property 3: Subtitle Content Priority - optimized subtitle takes precedence", () => {
    fc.assert(
      fc.property(
        chapterArbitrary,
        fc.string({ minLength: 5, maxLength: 100 }), // 使用更长的字符串避免与 Markdown 语法冲突
        fc.string({ minLength: 5, maxLength: 100 }),
        (chapter, optimizedText, originalText) => {
          // 确保测试字符串不会与 Markdown 语法冲突
          const safeOptimized = `OPTIMIZED_${optimizedText}`;
          const safeOriginal = `ORIGINAL_${originalText}`;
          
          const subtitles: SubtitleEntry[] = [
            {
              index: 0,
              start_time: chapter.start_time,
              end_time: chapter.end_time,
              text: safeOriginal,
            },
          ];
          const optimizedSubtitles = new Map([[chapter.id, safeOptimized]]);
          
          const options: AssembleMarkdownOptions = {
            chapters: [chapter],
            optimizedSubtitles,
            originalSubtitles: subtitles,
          };
          const result = assembleChapterMarkdown(options);
          
          // 应该包含优化后的字幕
          expect(result).toContain(safeOptimized);
          // 不应该包含原始字幕
          expect(result).not.toContain(safeOriginal);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// getChaptersNeedingOptimization 测试
// ============================================================================

describe("getChaptersNeedingOptimization", () => {
  it("should return empty array for empty chapters", () => {
    expect(getChaptersNeedingOptimization([], new Map(), [])).toEqual([]);
  });

  it("should not include chapters that already have optimized subtitles", () => {
    const chapters: Chapter[] = [
      { id: "1", title: "Chapter 1", start_time: 0, end_time: 60, content: "", screenshot_path: null },
    ];
    const optimizedSubtitles = new Map([["1", "Optimized"]]);
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 10, end_time: 20, text: "Original" },
    ];
    
    const result = getChaptersNeedingOptimization(chapters, optimizedSubtitles, subtitles);
    expect(result).toEqual([]);
  });

  it("should include chapters without optimized subtitles but with original subtitles", () => {
    const chapters: Chapter[] = [
      { id: "1", title: "Chapter 1", start_time: 0, end_time: 60, content: "", screenshot_path: null },
    ];
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 10, end_time: 20, text: "Original" },
    ];
    
    const result = getChaptersNeedingOptimization(chapters, new Map(), subtitles);
    expect(result).toEqual(["1"]);
  });

  it("should not include chapters without any subtitles", () => {
    const chapters: Chapter[] = [
      { id: "1", title: "Chapter 1", start_time: 0, end_time: 60, content: "", screenshot_path: null },
    ];
    
    const result = getChaptersNeedingOptimization(chapters, new Map(), []);
    expect(result).toEqual([]);
  });
});
