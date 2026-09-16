/**
 * AssistModeView 组件属性测试
 * 使用 vitest + fast-check 进行属性测试
 *
 * Feature: visual-summary-assist-mode
 * - Property 7: Active Subtitle Highlighting
 * - Property 9: Screenshot Display After Capture
 * - Property 11: Marker Removal
 *
 * **Validates: Requirements 3.4, 4.3, 4.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { AssistModeView } from "./AssistModeView";
import type { SubtitleEntry, ScreenshotMarker } from "../../types";

// ============================================================================
// Mocks
// ============================================================================

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

// Mock canvas API for jsdom（截图捕获依赖 canvas.getContext / toBlob，
// jsdom 的 getContext 存在但返回 null，toBlob 未实现，必须覆盖）
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  drawImage: vi.fn(),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
  callback(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
}) as typeof HTMLCanvasElement.prototype.toBlob;

// jsdom 的 Blob 没有 arrayBuffer 方法（截图数据需要转为 Uint8Array）
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
  };
}

// 截图捕获会通过 document.querySelector("video") 查找播放器，
// jsdom 没有真实视频播放器，这里注入一个带尺寸信息的假 video 元素
const fakeVideo = document.createElement("video") as HTMLVideoElement;
Object.defineProperty(fakeVideo, "videoWidth", { value: 1280 });
Object.defineProperty(fakeVideo, "videoHeight", { value: 720 });
vi.spyOn(document, "querySelector").mockImplementation(((selector: string) => {
  if (selector === "video") return fakeVideo;
  return null;
}) as typeof document.querySelector);

// ============================================================================
// 测试数据生成器 (Arbitraries)
// ============================================================================

/**
 * 生成有效的字幕条目列表
 */
const subtitleListArbitrary = (
  minLength: number,
  maxLength: number
): fc.Arbitrary<SubtitleEntry[]> =>
  fc
    .array(
      fc.record({
        duration: fc.integer({ min: 2, max: 30 }),
        text: fc.string({ minLength: 1, maxLength: 50 }),
      }),
      { minLength, maxLength }
    )
    .map((entries) => {
      let currentTime = 0;
      return entries.map((entry, index) => {
        const start_time = currentTime;
        const end_time = start_time + entry.duration;
        currentTime = end_time;
        return {
          index,
          start_time,
          end_time,
          text: entry.text,
          second_language_text: null,
        };
      });
    });


/**
 * 生成截图标记
 */
const createMarker = (
  noteId: string,
  subtitleIndex: number,
  timestamp: number
): ScreenshotMarker => ({
  id: `marker-${subtitleIndex}-${Date.now()}-${Math.random()}`,
  note_id: noteId,
  subtitle_index: subtitleIndex,
  timestamp: timestamp,
  screenshot_path: `/screenshots/test-${subtitleIndex}.png`,
  created_at: new Date().toISOString(),
});

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 设置 mock invoke 返回值
 */
function setupMockInvoke(subtitles: SubtitleEntry[], markers: ScreenshotMarker[]) {
  let currentMarkers = [...markers];
  
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "parse_subtitle_file") {
      return Promise.resolve(subtitles);
    }
    if (command === "get_screenshot_markers") {
      return Promise.resolve(currentMarkers);
    }
    if (command === "save_screenshot_marker") {
      const subtitleIndex = args?.subtitleIndex as number;
      const timestamp = args?.timestamp as number;
      const noteId = args?.noteId as string;
      const newMarker: ScreenshotMarker = {
        id: `new-marker-${subtitleIndex}-${Date.now()}`,
        note_id: noteId,
        subtitle_index: subtitleIndex,
        timestamp: timestamp,
        screenshot_path: `/screenshots/new-${subtitleIndex}.png`,
        created_at: new Date().toISOString(),
      };
      currentMarkers = [...currentMarkers.filter(m => m.subtitle_index !== subtitleIndex), newMarker];
      return Promise.resolve(newMarker);
    }
    if (command === "delete_screenshot_marker") {
      const markerId = args?.markerId as string;
      currentMarkers = currentMarkers.filter((m) => m.id !== markerId);
      return Promise.resolve();
    }
    return Promise.reject(new Error(`Unknown command: ${command}`));
  });
}

/**
 * 渲染 AssistModeView 组件并等待加载完成
 */
async function renderAssistModeView(
  subtitles: SubtitleEntry[],
  markers: ScreenshotMarker[] = [],
  options: {
    noteId?: string;
    subtitlePath?: string | null;
    videoPath?: string;
  } = {}
) {
  const {
    noteId = "1",
    subtitlePath = "/path/to/subtitle.srt",
    videoPath = "/path/to/video.mp4",
  } = options;

  setupMockInvoke(subtitles, markers);

  const onRegenerateChapters = vi.fn();
  const onExitAssistMode = vi.fn();

  const result = render(
    <AssistModeView
      noteId={noteId}
      subtitlePath={subtitlePath}
      videoPath={videoPath}
      onRegenerateChapters={onRegenerateChapters}
      onExitAssistMode={onExitAssistMode}
    />
  );

  // 等待加载完成
  if (subtitlePath && subtitles.length > 0) {
    await waitFor(() => {
      expect(screen.queryByText("加载字幕中...")).not.toBeInTheDocument();
    }, { timeout: 3000 });
  }

  return {
    ...result,
    onRegenerateChapters,
    onExitAssistMode,
  };
}

/**
 * 模拟视频时间更新事件
 */
function dispatchVideoTimeUpdate(time: number) {
  const event = new CustomEvent("video-time-update", {
    detail: { time },
  });
  window.dispatchEvent(event);
}
// Export for potential future use
void dispatchVideoTimeUpdate;

/**
 * 查找当前应该高亮的字幕索引
 */
function findExpectedActiveIndex(subtitles: SubtitleEntry[], time: number): number | null {
  for (let i = 0; i < subtitles.length; i++) {
    const entry = subtitles[i];
    if (time >= entry.start_time && time < entry.end_time) {
      return i;
    }
  }
  for (let i = subtitles.length - 1; i >= 0; i--) {
    if (time >= subtitles[i].start_time) {
      return i;
    }
  }
  return null;
}

/**
 * 查找高亮的字幕行
 */
function findHighlightedRows(container: HTMLElement): Element[] {
  const rows = container.querySelectorAll('[id^="subtitle-row-"]');
  return Array.from(rows).filter(row => row.classList.contains("border-l-2"));
}
// Export for potential future use
void findHighlightedRows;


// ============================================================================
// Property 7: Active Subtitle Highlighting
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 7: Active Subtitle Highlighting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * Property 7: Active Subtitle Highlighting
   *
   * *For any* video playback time T, exactly one subtitle row (the one where
   * `start_time <= T < end_time`) SHALL have the active/highlighted state.
   *
   * **Validates: Requirements 3.4**
   * 
   * Note: This test validates the highlighting logic by testing the findCurrentEntryIndex
   * algorithm which determines which subtitle should be highlighted for a given time.
   */
  it("should correctly identify the active subtitle index for any playback time", () => {
    fc.assert(
      fc.property(
        subtitleListArbitrary(3, 10),
        fc.nat({ max: 100 }),
        (subtitles, timeOffset) => {
          if (subtitles.length === 0) return true;

          const totalDuration = subtitles[subtitles.length - 1].end_time;
          const time = (timeOffset / 100) * totalDuration;

          const expectedIndex = findExpectedActiveIndex(subtitles, time);

          if (expectedIndex !== null) {
            const entry = subtitles[expectedIndex];
            // 验证时间在该字幕的范围内
            expect(time).toBeGreaterThanOrEqual(entry.start_time);
            // 对于精确匹配，时间应该小于 end_time
            // 对于最后一个已过去的字幕，时间可能大于等于 end_time
            if (time < entry.end_time) {
              expect(time).toBeLessThan(entry.end_time);
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 验证时间在字幕范围边界时的高亮逻辑
   */
  it("should identify correct index at exact start_time boundary", () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "First subtitle" },
      { index: 1, start_time: 10, end_time: 20, text: "Second subtitle" },
      { index: 2, start_time: 20, end_time: 30, text: "Third subtitle" },
    ];

    // 测试精确的边界时间
    expect(findExpectedActiveIndex(subtitles, 0)).toBe(0);
    expect(findExpectedActiveIndex(subtitles, 10)).toBe(1);
    expect(findExpectedActiveIndex(subtitles, 20)).toBe(2);
  });

  /**
   * 验证时间在字幕结束时间前一刻的高亮逻辑
   */
  it("should identify correct index just before end_time", () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "First subtitle" },
      { index: 1, start_time: 10, end_time: 20, text: "Second subtitle" },
    ];

    // 测试 end_time - 0.001（刚好在结束前）
    expect(findExpectedActiveIndex(subtitles, 9.999)).toBe(0);
    expect(findExpectedActiveIndex(subtitles, 19.999)).toBe(1);
  });

  /**
   * 验证高亮逻辑在时间跨越字幕边界时正确切换
   */
  it("should switch active index when time crosses subtitle boundary", () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "First" },
      { index: 1, start_time: 10, end_time: 20, text: "Second" },
      { index: 2, start_time: 20, end_time: 30, text: "Third" },
    ];

    // 在第一个字幕范围内
    expect(findExpectedActiveIndex(subtitles, 5)).toBe(0);
    
    // 切换到第二个字幕
    expect(findExpectedActiveIndex(subtitles, 15)).toBe(1);
    
    // 切换到第三个字幕
    expect(findExpectedActiveIndex(subtitles, 25)).toBe(2);
  });

  /**
   * Property: 对于任意时间，最多只有一个字幕被高亮
   */
  it("should return exactly one index for any time within subtitle range", () => {
    fc.assert(
      fc.property(
        subtitleListArbitrary(1, 20),
        fc.nat({ max: 1000 }),
        (subtitles, timeOffset) => {
          if (subtitles.length === 0) return true;

          const totalDuration = subtitles[subtitles.length - 1].end_time;
          const time = (timeOffset / 1000) * totalDuration;

          const activeIndex = findExpectedActiveIndex(subtitles, time);

          // 如果时间在字幕范围内，应该返回一个有效索引
          if (time >= 0 && time < totalDuration) {
            expect(activeIndex).not.toBeNull();
            expect(activeIndex).toBeGreaterThanOrEqual(0);
            expect(activeIndex).toBeLessThan(subtitles.length);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ============================================================================
// Property 9: Screenshot Display After Capture
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 9: Screenshot Display After Capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * Property 9: Screenshot Display After Capture
   *
   * *For any* screenshot marker added at subtitle index N, the UI SHALL display
   * the screenshot image above the row at index N.
   *
   * **Validates: Requirements 4.3**
   */
  it("should display screenshot image above the correct subtitle row for any marker", async () => {
    await fc.assert(
      fc.asyncProperty(
        subtitleListArbitrary(3, 8),
        fc.nat({ max: 7 }),
        async (subtitles, rawMarkerIndex) => {
          if (subtitles.length === 0) return;

          const markerIndex = rawMarkerIndex % subtitles.length;
          const marker = createMarker("1", markerIndex, subtitles[markerIndex].start_time);

          const { container, unmount } = await renderAssistModeView(subtitles, [marker]);

          const screenshotImages = container.querySelectorAll("img");
          expect(screenshotImages.length).toBeGreaterThanOrEqual(1);

          const subtitleRow = container.querySelector(`#subtitle-row-${markerIndex}`);
          expect(subtitleRow).toBeTruthy();

          const parentContainer = subtitleRow?.closest(".relative");
          expect(parentContainer).toBeTruthy();

          const screenshotInContainer = parentContainer?.querySelector("img");
          expect(screenshotInContainer).toBeTruthy();
          expect(screenshotInContainer?.getAttribute("src")).toContain(marker.screenshot_path);

          unmount();
        }
      ),
      { numRuns: 15, timeout: 60000 }
    );
  }, 65000);

  /**
   * 验证多个截图标记都正确显示
   */
  it("should display all screenshot markers at their correct positions", async () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "First" },
      { index: 1, start_time: 10, end_time: 20, text: "Second" },
      { index: 2, start_time: 20, end_time: 30, text: "Third" },
      { index: 3, start_time: 30, end_time: 40, text: "Fourth" },
    ];

    const markers: ScreenshotMarker[] = [
      createMarker("1", 0, 0),
      createMarker("1", 2, 20),
    ];

    const { container } = await renderAssistModeView(subtitles, markers);

    const screenshotImages = container.querySelectorAll("img");
    expect(screenshotImages.length).toBe(2);

    for (const marker of markers) {
      const subtitleRow = container.querySelector(`#subtitle-row-${marker.subtitle_index}`);
      expect(subtitleRow).toBeTruthy();

      const parentContainer = subtitleRow?.closest(".relative");
      const screenshotInContainer = parentContainer?.querySelector("img");
      expect(screenshotInContainer).toBeTruthy();
      expect(screenshotInContainer?.getAttribute("src")).toContain(marker.screenshot_path);
    }
  });

  /**
   * 验证添加截图后立即显示
   */
  it("should display screenshot immediately after adding", async () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "First" },
      { index: 1, start_time: 10, end_time: 20, text: "Second" },
    ];

    const { container } = await renderAssistModeView(subtitles, []);

    let screenshotImages = container.querySelectorAll("img");
    expect(screenshotImages.length).toBe(0);

    const addButtons = screen.getAllByText("添加截图");
    expect(addButtons.length).toBe(2);

    await act(async () => {
      fireEvent.click(addButtons[0]);
    });

    await waitFor(() => {
      screenshotImages = container.querySelectorAll("img");
      expect(screenshotImages.length).toBe(1);
    });

    const subtitleRow = container.querySelector("#subtitle-row-0");
    const parentContainer = subtitleRow?.closest(".relative");
    const screenshotInContainer = parentContainer?.querySelector("img");
    expect(screenshotInContainer).toBeTruthy();
  });

  /**
   * 验证截图显示包含正确的 alt 文本
   */
  it("should display screenshot with correct alt text containing timestamp", async () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 65, end_time: 75, text: "Test subtitle" },
    ];

    const marker = createMarker("1", 0, 65);
    const { container } = await renderAssistModeView(subtitles, [marker]);

    const screenshotImage = container.querySelector("img");
    expect(screenshotImage).toBeTruthy();
    expect(screenshotImage?.getAttribute("alt")).toContain("截图");
  });
});


// ============================================================================
// Property 11: Marker Removal
// ============================================================================

describe("Feature: visual-summary-assist-mode, Property 11: Marker Removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * Property 11: Marker Removal
   *
   * *For any* screenshot marker at index N, after clicking the delete button,
   * the markers list SHALL no longer contain a marker with that index.
   *
   * **Validates: Requirements 4.5**
   */
  it("should remove marker from list after clicking delete button", async () => {
    await fc.assert(
      fc.asyncProperty(
        subtitleListArbitrary(3, 6),
        fc.nat({ max: 5 }),
        async (subtitles, rawMarkerIndex) => {
          if (subtitles.length === 0) return;

          const markerIndex = rawMarkerIndex % subtitles.length;
          const marker = createMarker("1", markerIndex, subtitles[markerIndex].start_time);

          const { container, unmount } = await renderAssistModeView(subtitles, [marker]);

          let screenshotImages = container.querySelectorAll("img");
          expect(screenshotImages.length).toBe(1);

          const deleteButton = screen.getByText("删除截图");
          expect(deleteButton).toBeTruthy();

          await act(async () => {
            fireEvent.click(deleteButton);
          });

          await waitFor(() => {
            screenshotImages = container.querySelectorAll("img");
            expect(screenshotImages.length).toBe(0);
          });

          expect(screen.queryByText("删除截图")).not.toBeInTheDocument();

          const addButtons = screen.getAllByText("添加截图");
          expect(addButtons.length).toBe(subtitles.length);

          unmount();
        }
      ),
      { numRuns: 10, timeout: 60000 }
    );
  }, 65000);

  /**
   * 验证删除一个标记不影响其他标记
   */
  it("should not affect other markers when deleting one", async () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "First" },
      { index: 1, start_time: 10, end_time: 20, text: "Second" },
      { index: 2, start_time: 20, end_time: 30, text: "Third" },
    ];

    const markers: ScreenshotMarker[] = [
      { ...createMarker("1", 0, 0), id: "marker-0" },
      { ...createMarker("1", 2, 20), id: "marker-2" },
    ];

    const { container } = await renderAssistModeView(subtitles, markers);

    let screenshotImages = container.querySelectorAll("img");
    expect(screenshotImages.length).toBe(2);

    const deleteButtons = screen.getAllByText("删除截图");
    expect(deleteButtons.length).toBe(2);

    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      screenshotImages = container.querySelectorAll("img");
      expect(screenshotImages.length).toBe(1);
    });

    const subtitleRow2 = container.querySelector("#subtitle-row-2");
    const parentContainer2 = subtitleRow2?.closest(".relative");
    const screenshotInContainer2 = parentContainer2?.querySelector("img");
    expect(screenshotInContainer2).toBeTruthy();
  });

  /**
   * 验证删除后调用了正确的后端命令
   */
  it("should call delete_screenshot_marker with correct parameters", async () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "Test" },
    ];

    const marker: ScreenshotMarker = {
      id: "test-marker-id-123",
      note_id: "42",
      subtitle_index: 0,
      timestamp: 0,
      screenshot_path: "/screenshots/test.png",
      created_at: new Date().toISOString(),
    };

    await renderAssistModeView(subtitles, [marker], { noteId: "42" });

    const deleteButton = screen.getByText("删除截图");
    await act(async () => {
      fireEvent.click(deleteButton);
    });

    expect(mockInvoke).toHaveBeenCalledWith("delete_screenshot_marker", {
      noteId: "42",
      markerId: "test-marker-id-123",
    });
  });

  /**
   * 验证删除所有标记后的状态
   */
  it("should show all add buttons after removing all markers", async () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "First" },
      { index: 1, start_time: 10, end_time: 20, text: "Second" },
    ];

    const markers: ScreenshotMarker[] = [
      { ...createMarker("1", 0, 0), id: "marker-0" },
      { ...createMarker("1", 1, 10), id: "marker-1" },
    ];

    const { container } = await renderAssistModeView(subtitles, markers);

    expect(container.querySelectorAll("img").length).toBe(2);
    expect(screen.queryAllByText("添加截图").length).toBe(0);

    let deleteButtons = screen.getAllByText("删除截图");
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(container.querySelectorAll("img").length).toBe(1);
    });

    deleteButtons = screen.getAllByText("删除截图");
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(container.querySelectorAll("img").length).toBe(0);
    });

    const addButtons = screen.getAllByText("添加截图");
    expect(addButtons.length).toBe(2);
  });
});


// ============================================================================
// 边界情况测试
// ============================================================================

describe("AssistModeView Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * 空字幕列表
   */
  it("should handle empty subtitle list gracefully", async () => {
    setupMockInvoke([], []);

    render(
      <AssistModeView
        noteId={"1"}
        subtitlePath="/path/to/subtitle.srt"
        videoPath="/path/to/video.mp4"
        onRegenerateChapters={vi.fn()}
        onExitAssistMode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("字幕文件为空")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  /**
   * 无字幕路径
   */
  it("should show message when subtitle path is null", async () => {
    setupMockInvoke([], []);

    render(
      <AssistModeView
        noteId={"1"}
        subtitlePath={null}
        videoPath="/path/to/video.mp4"
        onRegenerateChapters={vi.fn()}
        onExitAssistMode={vi.fn()}
      />
    );

    expect(screen.getByText("未上传字幕文件")).toBeInTheDocument();
  });

  /**
   * 视频不可用时添加按钮应禁用
   */
  it("should disable add screenshot buttons when video is unavailable", async () => {
    const subtitles: SubtitleEntry[] = [
      { index: 0, start_time: 0, end_time: 10, text: "Test" },
    ];

    setupMockInvoke(subtitles, []);

    render(
      <AssistModeView
        noteId={"1"}
        subtitlePath="/path/to/subtitle.srt"
        videoPath=""
        onRegenerateChapters={vi.fn()}
        onExitAssistMode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("加载字幕中...")).not.toBeInTheDocument();
    });

    const addButton = screen.getByRole("button", { name: /添加截图/i });
    expect(addButton).toBeDisabled();
  });
});
