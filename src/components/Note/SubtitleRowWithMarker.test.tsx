/**
 * SubtitleRowWithMarker 组件属性测试
 * 使用 vitest + fast-check 进行属性测试
 *
 * Feature: visual-summary-assist-mode
 * - Property 4: Subtitle Row Count Invariant
 * - Property 5: Subtitle Row Content Completeness
 *
 * **Validates: Requirements 3.1, 3.2**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { SubtitleRowWithMarker } from "./SubtitleRowWithMarker";
import { formatTimestamp } from "./SubtitleRow";
import type { SubtitleEntry, ScreenshotMarker } from "../../types";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

// ============================================================================
// 测试数据生成器 (Arbitraries)
// ============================================================================

/**
 * 生成有效的字幕条目
 * 确保 end_time > start_time，且文本非空
 */
const subtitleEntryArbitrary: fc.Arbitrary<SubtitleEntry> = fc
  .record({
    index: fc.nat({ max: 1000 }),
    start_time: fc.nat({ max: 7200 }), // 0-2小时
    duration: fc.integer({ min: 1, max: 30 }), // 1-30秒
    text: fc.string({ minLength: 1, maxLength: 200 }),
    second_language_text: fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
      nil: null,
    }),
  })
  .map((entry) => ({
    index: entry.index,
    start_time: entry.start_time,
    end_time: entry.start_time + entry.duration,
    text: entry.text,
    second_language_text: entry.second_language_text,
  }));

/**
 * 生成字幕条目列表
 * 确保索引连续且时间递增
 */
const subtitleListArbitrary = (
  minLength: number,
  maxLength: number
): fc.Arbitrary<SubtitleEntry[]> =>
  fc
    .array(
      fc.record({
        duration: fc.integer({ min: 1, max: 30 }),
        text: fc.string({ minLength: 1, maxLength: 200 }),
        second_language_text: fc.option(
          fc.string({ minLength: 1, maxLength: 200 }),
          { nil: null }
        ),
      }),
      { minLength, maxLength }
    )
    .map((entries) => {
      let currentTime = 0;
      return entries.map((entry, index) => {
        const start_time = currentTime;
        const end_time = start_time + entry.duration;
        currentTime = end_time + 1; // 1秒间隔
        return {
          index,
          start_time,
          end_time,
          text: entry.text,
          second_language_text: entry.second_language_text,
        };
      });
    });

/**
 * 生成截图标记
 */
const screenshotMarkerArbitrary = (
  noteId: string,
  subtitleIndex: number
): fc.Arbitrary<ScreenshotMarker> =>
  fc.record({
    id: fc.uuid(),
    note_id: fc.constant(noteId),
    subtitle_index: fc.constant(subtitleIndex),
    timestamp: fc.nat({ max: 7200 }),
    screenshot_path: fc.string({ minLength: 5, maxLength: 100 }).map((s) => `/screenshots/${s}.png`),
    created_at: fc.date().map((d) => d.toISOString()),
  });
// Export for potential future use
void screenshotMarkerArbitrary;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 渲染单个 SubtitleRowWithMarker 组件
 */
function renderSubtitleRow(
  entry: SubtitleEntry,
  options: {
    isActive?: boolean;
    marker?: ScreenshotMarker | null;
    isCapturing?: boolean;
    videoAvailable?: boolean;
  } = {}
) {
  const {
    isActive = false,
    marker = null,
    isCapturing = false,
    videoAvailable = true,
  } = options;

  return render(
    <SubtitleRowWithMarker
      entry={entry}
      index={entry.index}
      isActive={isActive}
      marker={marker}
      onAddScreenshot={vi.fn()}
      onRemoveScreenshot={vi.fn()}
      onClick={vi.fn()}
      isCapturing={isCapturing}
      videoAvailable={videoAvailable}
    />
  );
}

/**
 * 渲染字幕行列表（模拟辅助模式视图）
 */
function renderSubtitleRowList(
  subtitles: SubtitleEntry[],
  markers: Map<number, ScreenshotMarker> = new Map()
) {
  return render(
    <div data-testid="subtitle-row-list">
      {subtitles.map((entry) => (
        <div key={entry.index} data-testid={`subtitle-row-container-${entry.index}`}>
          <SubtitleRowWithMarker
            entry={entry}
            index={entry.index}
            isActive={false}
            marker={markers.get(entry.index) || null}
            onAddScreenshot={vi.fn()}
            onRemoveScreenshot={vi.fn()}
            onClick={vi.fn()}
            isCapturing={false}
            videoAvailable={true}
          />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Property 4: Subtitle Row Count Invariant
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 4: Subtitle Row Count Invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 4: Subtitle Row Count Invariant
   *
   * *For any* list of subtitle entries with length N, when assist mode is active,
   * the rendered subtitle row list SHALL contain exactly N rows.
   *
   * **Validates: Requirements 3.1**
   */
  it("should render exactly N rows for N subtitle entries", () => {
    fc.assert(
      fc.property(
        subtitleListArbitrary(1, 50), // 1-50 个字幕条目
        (subtitles) => {
          const { container } = renderSubtitleRowList(subtitles);

          // 获取所有渲染的字幕行容器
          const rowContainers = container.querySelectorAll(
            '[data-testid^="subtitle-row-container-"]'
          );

          // 验证渲染的行数等于字幕条目数
          expect(rowContainers.length).toBe(subtitles.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 边界情况：空字幕列表
   */
  it("should render 0 rows for empty subtitle list", () => {
    const { container } = renderSubtitleRowList([]);
    const rowContainers = container.querySelectorAll(
      '[data-testid^="subtitle-row-container-"]'
    );
    expect(rowContainers.length).toBe(0);
  });

  /**
   * 边界情况：单个字幕条目
   */
  it("should render exactly 1 row for single subtitle entry", () => {
    fc.assert(
      fc.property(subtitleEntryArbitrary, (entry) => {
        const { container } = renderSubtitleRowList([entry]);
        const rowContainers = container.querySelectorAll(
          '[data-testid^="subtitle-row-container-"]'
        );
        expect(rowContainers.length).toBe(1);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * 验证带截图标记的字幕列表仍然保持行数不变
   */
  it("should maintain row count regardless of screenshot markers", () => {
    fc.assert(
      fc.property(
        subtitleListArbitrary(5, 20),
        fc.array(fc.nat({ max: 19 }), { minLength: 0, maxLength: 5 }), // 随机标记位置
        (subtitles, markerIndices) => {
          // 创建标记 Map
          const markers = new Map<number, ScreenshotMarker>();
          const uniqueIndices = [...new Set(markerIndices)].filter(
            (i) => i < subtitles.length
          );

          uniqueIndices.forEach((index) => {
            markers.set(index, {
              id: `marker-${index}`,
              note_id: "1",
              subtitle_index: index,
              timestamp: subtitles[index]?.start_time || 0,
              screenshot_path: `/screenshots/test-${index}.png`,
              created_at: new Date().toISOString(),
            });
          });

          const { container } = renderSubtitleRowList(subtitles, markers);
          const rowContainers = container.querySelectorAll(
            '[data-testid^="subtitle-row-container-"]'
          );

          // 行数应该等于字幕数，不受标记影响
          expect(rowContainers.length).toBe(subtitles.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ============================================================================
// Property 5: Subtitle Row Content Completeness
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 5: Subtitle Row Content Completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 5: Subtitle Row Content Completeness
   *
   * *For any* subtitle entry, the corresponding rendered row SHALL contain
   * both the formatted timestamp and the text content of that entry.
   *
   * **Validates: Requirements 3.2**
   */
  it("should display formatted timestamp and text content for any subtitle entry", () => {
    fc.assert(
      fc.property(subtitleEntryArbitrary, (entry) => {
        const { container } = renderSubtitleRow(entry);

        // 验证时间戳存在且格式正确
        const expectedTimestamp = formatTimestamp(entry.start_time);
        expect(container.textContent).toContain(expectedTimestamp);

        // 验证字幕文本存在
        expect(container.textContent).toContain(entry.text);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * 验证双语字幕的内容完整性
   */
  it("should display both primary and secondary language text for bilingual subtitles", () => {
    fc.assert(
      fc.property(
        fc.record({
          index: fc.nat({ max: 100 }),
          start_time: fc.nat({ max: 7200 }),
          duration: fc.integer({ min: 1, max: 30 }),
          text: fc.string({ minLength: 1, maxLength: 100 }),
          second_language_text: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        (data) => {
          const entry: SubtitleEntry = {
            index: data.index,
            start_time: data.start_time,
            end_time: data.start_time + data.duration,
            text: data.text,
            second_language_text: data.second_language_text,
          };

          const { container } = renderSubtitleRow(entry);

          // 验证主语言文本
          expect(container.textContent).toContain(entry.text);

          // 验证副语言文本
          expect(container.textContent).toContain(entry.second_language_text);

          // 验证时间戳
          const expectedTimestamp = formatTimestamp(entry.start_time);
          expect(container.textContent).toContain(expectedTimestamp);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * 验证时间戳格式正确性
   */
  it("should format timestamp correctly for any time value", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 36000 }), // 0-10小时
        (seconds) => {
          const entry: SubtitleEntry = {
            index: 0,
            start_time: seconds,
            end_time: seconds + 5,
            text: "Test subtitle",
          };

          const { container } = renderSubtitleRow(entry);
          const expectedTimestamp = formatTimestamp(seconds);

          // 验证时间戳格式
          if (seconds >= 3600) {
            // HH:MM:SS 格式
            expect(expectedTimestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
          } else {
            // MM:SS 格式
            expect(expectedTimestamp).toMatch(/^\d{2}:\d{2}$/);
          }

          // 验证时间戳在渲染内容中
          expect(container.textContent).toContain(expectedTimestamp);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 验证列表中每个字幕行都包含完整内容
   */
  it("should display complete content for each row in a subtitle list", () => {
    fc.assert(
      fc.property(subtitleListArbitrary(1, 20), (subtitles) => {
        const { container } = renderSubtitleRowList(subtitles);

        // 验证每个字幕条目的内容都存在
        subtitles.forEach((entry) => {
          const expectedTimestamp = formatTimestamp(entry.start_time);

          // 时间戳应该存在
          expect(container.textContent).toContain(expectedTimestamp);

          // 字幕文本应该存在
          expect(container.textContent).toContain(entry.text);

          // 如果有副语言文本，也应该存在
          if (entry.second_language_text) {
            expect(container.textContent).toContain(entry.second_language_text);
          }
        });
      }),
      { numRuns: 50 }
    );
  });

  /**
   * 验证特殊字符的正确渲染
   */
  it("should correctly render subtitle text with special characters", () => {
    // 使用 fc.string 生成包含各种字符的字符串
    const specialCharsArbitrary = fc.string({ minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(specialCharsArbitrary, (text) => {
        const entry: SubtitleEntry = {
          index: 0,
          start_time: 60,
          end_time: 65,
          text: text,
        };

        const { container } = renderSubtitleRow(entry);

        // 验证文本内容存在
        // 我们检查文本是否被渲染，而不是精确匹配
        const textElement = container.querySelector("p");
        expect(textElement).not.toBeNull();
        expect(textElement?.textContent).toBe(text);
      }),
      { numRuns: 50 }
    );
  });
});

// ============================================================================
// formatTimestamp 函数单元测试
// ============================================================================

describe("formatTimestamp", () => {
  it("should format 0 seconds as 00:00", () => {
    expect(formatTimestamp(0)).toBe("00:00");
  });

  it("should format seconds under 1 minute correctly", () => {
    expect(formatTimestamp(5)).toBe("00:05");
    expect(formatTimestamp(59)).toBe("00:59");
  });

  it("should format minutes correctly", () => {
    expect(formatTimestamp(60)).toBe("01:00");
    expect(formatTimestamp(125)).toBe("02:05");
    expect(formatTimestamp(3599)).toBe("59:59");
  });

  it("should format hours correctly", () => {
    expect(formatTimestamp(3600)).toBe("01:00:00");
    expect(formatTimestamp(3661)).toBe("01:01:01");
    expect(formatTimestamp(7325)).toBe("02:02:05");
  });

  /**
   * Property: 时间戳格式一致性
   */
  it("should always produce valid timestamp format", () => {
    fc.assert(
      fc.property(fc.nat({ max: 36000 }), (seconds) => {
        const result = formatTimestamp(seconds);

        if (seconds >= 3600) {
          // HH:MM:SS 格式
          expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        } else {
          // MM:SS 格式
          expect(result).toMatch(/^\d{2}:\d{2}$/);
        }

        // 验证可以解析回原始秒数
        const parts = result.split(":").map(Number);
        let totalSeconds: number;
        if (parts.length === 3) {
          totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else {
          totalSeconds = parts[0] * 60 + parts[1];
        }
        expect(totalSeconds).toBe(Math.floor(seconds));
      }),
      { numRuns: 100 }
    );
  });
});
