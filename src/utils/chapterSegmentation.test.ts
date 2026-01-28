/**
 * 章节分段算法属性测试
 * 使用 vitest + fast-check 进行属性测试
 *
 * Feature: visual-summary-assist-mode
 * - Property 13: Chapter Segmentation from Markers
 * - Property 14: First Segment Auto-Screenshot
 * - Property 15: User Screenshot Used for Segment
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  calculateChapterSegments,
  validateSegmentsCoverage,
} from "./chapterSegmentation";
import type { SubtitleEntry, ScreenshotMarker } from "../types";

// ============================================================================
// 测试数据生成器
// ============================================================================

/**
 * 生成随机字幕条目数组
 * 确保字幕按时间顺序排列，且时间不重叠
 */
const subtitlesArbitrary = (minLength: number, maxLength: number) =>
  fc
    .array(
      fc.record({
        text: fc.string({ minLength: 1, maxLength: 100 }),
        duration: fc.integer({ min: 1, max: 10 }), // 每条字幕持续1-10秒
      }),
      { minLength, maxLength }
    )
    .map((entries) => {
      let currentTime = 0;
      return entries.map((entry, index) => {
        const startTime = currentTime;
        const endTime = startTime + entry.duration;
        currentTime = endTime;
        return {
          index,
          start_time: startTime,
          end_time: endTime,
          text: entry.text,
        } as SubtitleEntry;
      });
    });

/**
 * 生成随机截图标记数组
 * 确保标记索引在有效范围内且不重复
 */
const markersArbitrary = (subtitleCount: number, minMarkers: number, maxMarkers: number) =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: subtitleCount - 1 }), {
      minLength: minMarkers,
      maxLength: Math.min(maxMarkers, subtitleCount),
    })
    .map((indices) =>
      indices.sort((a, b) => a - b).map((subtitleIndex, i) => ({
        id: `marker-${i}`,
        note_id: "1",
        subtitle_index: subtitleIndex,
        timestamp: subtitleIndex * 5, // 假设每条字幕5秒
        screenshot_path: `/screenshots/marker-${i}.png`,
        created_at: new Date().toISOString(),
      })) as ScreenshotMarker[]
    );

/**
 * 生成字幕和标记的组合
 * 确保标记索引在字幕范围内
 */
const subtitlesWithMarkersArbitrary = (
  minSubtitles: number,
  maxSubtitles: number,
  minMarkers: number,
  maxMarkers: number
) =>
  subtitlesArbitrary(minSubtitles, maxSubtitles).chain((subtitles) =>
    markersArbitrary(subtitles.length, minMarkers, maxMarkers).map((markers) => ({
      subtitles,
      markers,
    }))
  );

// ============================================================================
// Property 13: Chapter Segmentation from Markers
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 13: Chapter Segmentation from Markers", () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * *For any* set of M screenshot markers (M >= 1) at distinct subtitle indices,
   * the chapter segmentation algorithm SHALL produce exactly M segments if the
   * first marker is at index 0, or M+1 segments otherwise.
   * Each segment SHALL contain consecutive subtitles from one marker position to the next.
   */
  it("should produce correct number of segments based on marker positions", () => {
    fc.assert(
      fc.property(
        subtitlesWithMarkersArbitrary(3, 20, 1, 5),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);

          // 计算预期分段数量
          const firstMarkerAtZero = markers.some((m) => m.subtitle_index === 0);
          const expectedSegmentCount = firstMarkerAtZero
            ? markers.length
            : markers.length + 1;

          // 验证分段数量
          expect(segments.length).toBe(expectedSegmentCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should produce consecutive segments covering all subtitles", () => {
    fc.assert(
      fc.property(
        subtitlesWithMarkersArbitrary(3, 20, 1, 5),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);

          // 验证分段覆盖所有字幕
          expect(validateSegmentsCoverage(segments, subtitles.length)).toBe(true);

          // 验证分段连续性
          for (let i = 0; i < segments.length - 1; i++) {
            expect(segments[i].end_index).toBe(segments[i + 1].start_index);
          }

          // 验证第一个分段从0开始
          expect(segments[0].start_index).toBe(0);

          // 验证最后一个分段到字幕末尾
          expect(segments[segments.length - 1].end_index).toBe(subtitles.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should handle single marker at index 0 (produces 1 segment)", () => {
    fc.assert(
      fc.property(subtitlesArbitrary(3, 20), (subtitles) => {
        const markers: ScreenshotMarker[] = [
          {
            id: "marker-0",
            note_id: "1",
            subtitle_index: 0,
            timestamp: 0,
            screenshot_path: "/screenshots/marker-0.png",
            created_at: new Date().toISOString(),
          },
        ];

        const segments = calculateChapterSegments(subtitles, markers);

        // 单个标记在索引0，应该产生1个分段
        expect(segments.length).toBe(1);
        expect(segments[0].start_index).toBe(0);
        expect(segments[0].end_index).toBe(subtitles.length);
      }),
      { numRuns: 100 }
    );
  });

  it("should handle single marker not at index 0 (produces 2 segments)", () => {
    fc.assert(
      fc.property(
        subtitlesArbitrary(3, 20).chain((subtitles) =>
          fc.integer({ min: 1, max: subtitles.length - 1 }).map((markerIndex) => ({
            subtitles,
            markerIndex,
          }))
        ),
        ({ subtitles, markerIndex }) => {
          const markers: ScreenshotMarker[] = [
            {
              id: "marker-0",
              note_id: "1",
              subtitle_index: markerIndex,
              timestamp: markerIndex * 5,
              screenshot_path: "/screenshots/marker-0.png",
              created_at: new Date().toISOString(),
            },
          ];

          const segments = calculateChapterSegments(subtitles, markers);

          // 单个标记不在索引0，应该产生2个分段
          expect(segments.length).toBe(2);
          expect(segments[0].start_index).toBe(0);
          expect(segments[0].end_index).toBe(markerIndex);
          expect(segments[1].start_index).toBe(markerIndex);
          expect(segments[1].end_index).toBe(subtitles.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 14: First Segment Auto-Screenshot
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 14: First Segment Auto-Screenshot", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * *For any* chapter segmentation where no marker exists at subtitle index 0,
   * the first segment's screenshot_path SHALL be null (indicating automatic
   * screenshot capture is needed at the first subtitle's timestamp).
   */
  it("should set first segment screenshot_path to null when no marker at index 0", () => {
    fc.assert(
      fc.property(
        subtitlesArbitrary(3, 20).chain((subtitles) =>
          // 生成不包含索引0的标记
          fc
            .uniqueArray(fc.integer({ min: 1, max: subtitles.length - 1 }), {
              minLength: 1,
              maxLength: Math.min(5, subtitles.length - 1),
            })
            .map((indices) => ({
              subtitles,
              markers: indices.sort((a, b) => a - b).map((idx, i) => ({
                id: `marker-${i}`,
                note_id: "1",
                subtitle_index: idx,
                timestamp: idx * 5,
                screenshot_path: `/screenshots/marker-${i}.png`,
                created_at: new Date().toISOString(),
              })) as ScreenshotMarker[],
            }))
        ),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);

          // 第一个分段的 screenshot_path 应该为 null
          expect(segments[0].screenshot_path).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should set first segment screenshot_path to marker's path when marker exists at index 0", () => {
    fc.assert(
      fc.property(
        subtitlesArbitrary(3, 20).chain((subtitles) =>
          // 生成包含索引0的标记
          fc
            .uniqueArray(fc.integer({ min: 1, max: subtitles.length - 1 }), {
              minLength: 0,
              maxLength: Math.min(4, subtitles.length - 1),
            })
            .map((additionalIndices) => {
              const markerAtZero: ScreenshotMarker = {
                id: "marker-0",
                note_id: "1",
                subtitle_index: 0,
                timestamp: 0,
                screenshot_path: "/screenshots/marker-at-zero.png",
                created_at: new Date().toISOString(),
              };
              const additionalMarkers = additionalIndices
                .sort((a, b) => a - b)
                .map((idx, i) => ({
                  id: `marker-${i + 1}`,
                  note_id: "1",
                  subtitle_index: idx,
                  timestamp: idx * 5,
                  screenshot_path: `/screenshots/marker-${i + 1}.png`,
                  created_at: new Date().toISOString(),
                })) as ScreenshotMarker[];

              return {
                subtitles,
                markers: [markerAtZero, ...additionalMarkers],
              };
            })
        ),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);

          // 第一个分段的 screenshot_path 应该是索引0标记的截图路径
          expect(segments[0].screenshot_path).toBe("/screenshots/marker-at-zero.png");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should handle empty markers (single segment with null screenshot_path)", () => {
    fc.assert(
      fc.property(subtitlesArbitrary(1, 20), (subtitles) => {
        const segments = calculateChapterSegments(subtitles, []);

        // 无标记时应该产生单个分段，screenshot_path 为 null
        expect(segments.length).toBe(1);
        expect(segments[0].screenshot_path).toBeNull();
        expect(segments[0].start_index).toBe(0);
        expect(segments[0].end_index).toBe(subtitles.length);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 15: User Screenshot Used for Segment
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 15: User Screenshot Used for Segment", () => {
  /**
   * **Validates: Requirements 5.4**
   *
   * *For any* chapter segment that starts at a marker position,
   * the segment's screenshot_path SHALL equal the marker's screenshot_path.
   */
  it("should use marker's screenshot_path for segments starting at marker positions", () => {
    fc.assert(
      fc.property(
        subtitlesWithMarkersArbitrary(3, 20, 1, 5),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);

          // 对于每个标记，找到以该标记位置开始的分段
          for (const marker of markers) {
            const segmentAtMarker = segments.find(
              (s) => s.start_index === marker.subtitle_index
            );

            // 应该存在以该标记位置开始的分段
            expect(segmentAtMarker).toBeDefined();

            // 该分段的 screenshot_path 应该等于标记的 screenshot_path
            expect(segmentAtMarker!.screenshot_path).toBe(marker.screenshot_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should preserve unique screenshot paths for each marker", () => {
    fc.assert(
      fc.property(
        subtitlesArbitrary(5, 20).chain((subtitles) =>
          fc
            .uniqueArray(fc.integer({ min: 0, max: subtitles.length - 1 }), {
              minLength: 2,
              maxLength: Math.min(5, subtitles.length),
            })
            .map((indices) => ({
              subtitles,
              markers: indices.sort((a, b) => a - b).map((idx, i) => ({
                id: `marker-${i}`,
                note_id: "1",
                subtitle_index: idx,
                timestamp: idx * 5,
                screenshot_path: `/screenshots/unique-${idx}-${i}.png`, // 唯一路径
                created_at: new Date().toISOString(),
              })) as ScreenshotMarker[],
            }))
        ),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);

          // 验证每个标记的截图路径都被正确使用
          for (const marker of markers) {
            const segmentAtMarker = segments.find(
              (s) => s.start_index === marker.subtitle_index
            );
            expect(segmentAtMarker).toBeDefined();
            expect(segmentAtMarker!.screenshot_path).toBe(marker.screenshot_path);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should correctly assign screenshot_path for all segments", () => {
    fc.assert(
      fc.property(
        subtitlesWithMarkersArbitrary(5, 20, 1, 5),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);
          const sortedMarkers = [...markers].sort(
            (a, b) => a.subtitle_index - b.subtitle_index
          );

          for (const segment of segments) {
            // 找到该分段对应的标记（如果有）
            const markerAtStart = sortedMarkers.find(
              (m) => m.subtitle_index === segment.start_index
            );

            if (markerAtStart) {
              // 如果分段起始位置有标记，使用该标记的截图
              expect(segment.screenshot_path).toBe(markerAtStart.screenshot_path);
            } else {
              // 如果分段起始位置没有标记（只可能是第一个分段），screenshot_path 为 null
              expect(segment.start_index).toBe(0);
              expect(segment.screenshot_path).toBeNull();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// 边界情况测试
// ============================================================================

describe("Feature: visual-summary-assist-mode, Edge Cases", () => {
  it("should handle empty subtitles array", () => {
    const segments = calculateChapterSegments([], []);
    expect(segments).toEqual([]);
  });

  it("should handle single subtitle with no markers", () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 5, text: "Single subtitle" },
    ];
    const segments = calculateChapterSegments(subtitles, []);

    expect(segments.length).toBe(1);
    expect(segments[0].start_index).toBe(0);
    expect(segments[0].end_index).toBe(1);
    expect(segments[0].screenshot_path).toBeNull();
  });

  it("should handle single subtitle with marker at index 0", () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 5, text: "Single subtitle" },
    ];
    const markers: ScreenshotMarker[] = [
      {
        id: "marker-0",
        note_id: "1",
        subtitle_index: 0,
        timestamp: 0,
        screenshot_path: "/screenshots/marker-0.png",
        created_at: new Date().toISOString(),
      },
    ];
    const segments = calculateChapterSegments(subtitles, markers);

    expect(segments.length).toBe(1);
    expect(segments[0].start_index).toBe(0);
    expect(segments[0].end_index).toBe(1);
    expect(segments[0].screenshot_path).toBe("/screenshots/marker-0.png");
  });

  it("should handle markers at consecutive indices", () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 5, text: "Subtitle 0" },
      { index: 1, start_time: 5, end_time: 10, text: "Subtitle 1" },
      { index: 2, start_time: 10, end_time: 15, text: "Subtitle 2" },
    ];
    const markers: ScreenshotMarker[] = [
      {
        id: "marker-0",
        note_id: "1",
        subtitle_index: 0,
        timestamp: 0,
        screenshot_path: "/screenshots/marker-0.png",
        created_at: new Date().toISOString(),
      },
      {
        id: "marker-1",
        note_id: "1",
        subtitle_index: 1,
        timestamp: 5,
        screenshot_path: "/screenshots/marker-1.png",
        created_at: new Date().toISOString(),
      },
      {
        id: "marker-2",
        note_id: "1",
        subtitle_index: 2,
        timestamp: 10,
        screenshot_path: "/screenshots/marker-2.png",
        created_at: new Date().toISOString(),
      },
    ];
    const segments = calculateChapterSegments(subtitles, markers);

    // 3个连续标记应该产生3个分段，每个分段只包含1个字幕
    expect(segments.length).toBe(3);
    expect(segments[0]).toMatchObject({
      start_index: 0,
      end_index: 1,
      screenshot_path: "/screenshots/marker-0.png",
    });
    expect(segments[1]).toMatchObject({
      start_index: 1,
      end_index: 2,
      screenshot_path: "/screenshots/marker-1.png",
    });
    expect(segments[2]).toMatchObject({
      start_index: 2,
      end_index: 3,
      screenshot_path: "/screenshots/marker-2.png",
    });
  });

  it("should handle unsorted markers (algorithm should sort them)", () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 5, text: "Subtitle 0" },
      { index: 1, start_time: 5, end_time: 10, text: "Subtitle 1" },
      { index: 2, start_time: 10, end_time: 15, text: "Subtitle 2" },
      { index: 3, start_time: 15, end_time: 20, text: "Subtitle 3" },
    ];
    // 故意乱序的标记
    const markers: ScreenshotMarker[] = [
      {
        id: "marker-2",
        note_id: "1",
        subtitle_index: 3,
        timestamp: 15,
        screenshot_path: "/screenshots/marker-2.png",
        created_at: new Date().toISOString(),
      },
      {
        id: "marker-0",
        note_id: "1",
        subtitle_index: 1,
        timestamp: 5,
        screenshot_path: "/screenshots/marker-0.png",
        created_at: new Date().toISOString(),
      },
    ];
    const segments = calculateChapterSegments(subtitles, markers);

    // 应该正确处理乱序标记
    expect(segments.length).toBe(3); // 无标记在0，所以是 2+1=3
    expect(segments[0].screenshot_path).toBeNull(); // 第一段无标记
    expect(segments[1].screenshot_path).toBe("/screenshots/marker-0.png");
    expect(segments[2].screenshot_path).toBe("/screenshots/marker-2.png");
  });
});

// ============================================================================
// validateSegmentsCoverage 测试
// ============================================================================

describe("validateSegmentsCoverage", () => {
  it("should return true for valid coverage", () => {
    fc.assert(
      fc.property(
        subtitlesWithMarkersArbitrary(3, 20, 0, 5),
        ({ subtitles, markers }) => {
          const segments = calculateChapterSegments(subtitles, markers);
          expect(validateSegmentsCoverage(segments, subtitles.length)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should return true for empty segments with zero subtitles", () => {
    expect(validateSegmentsCoverage([], 0)).toBe(true);
  });

  it("should return false for empty segments with non-zero subtitles", () => {
    expect(validateSegmentsCoverage([], 5)).toBe(false);
  });
});
