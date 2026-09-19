import { describe, expect, it } from "vitest";
import {
  clampPercent,
  getSubtitleIndicatorViewModel,
  hasGeneratedSubtitles,
  isNoteWaitingForSubtitles,
  isSubtitleGenerationTask,
  normalizeSubtitleProgress,
  type SubtitleRuntimeTaskLike,
} from "./subtitleGeneration";

function task(
  noteId: string,
  status: string,
  selectedKeys = ["subtitle_generation"],
): SubtitleRuntimeTaskLike {
  return {
    status,
    params: { noteId, selectedKeys },
  };
}

describe("subtitle generation helpers", () => {
  it("detects subtitle generation tasks", () => {
    expect(isSubtitleGenerationTask(task("n1", "running"))).toBe(true);
    expect(isSubtitleGenerationTask(task("n1", "running", ["full_summary"]))).toBe(false);
    expect(isSubtitleGenerationTask(null)).toBe(false);
  });

  it("treats blank subtitle paths as missing", () => {
    expect(hasGeneratedSubtitles("/a.srt")).toBe(true);
    expect(hasGeneratedSubtitles("  ")).toBe(false);
    expect(hasGeneratedSubtitles(null)).toBe(false);
  });

  it("clamps and normalizes progress payloads", () => {
    expect(clampPercent(42.4)).toBe(42);
    expect(clampPercent(-8)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(normalizeSubtitleProgress({
      note_id: "n1",
      percent: 66.6,
      message: " 正在识别语音... ",
    })).toEqual({
      noteId: "n1",
      percent: 67,
      message: "正在识别语音...",
    });
  });

  it("locks the right panel only while this note is waiting for subtitles", () => {
    expect(isNoteWaitingForSubtitles({
      noteId: "n1",
      subtitlePath: "/a.srt",
      currentTask: task("n1", "running"),
      runtimeQueue: [],
    })).toBe(false);

    expect(isNoteWaitingForSubtitles({
      noteId: "n1",
      subtitlePath: null,
      currentTask: task("n1", "running"),
      runtimeQueue: [],
    })).toBe(true);

    expect(isNoteWaitingForSubtitles({
      noteId: "n2",
      subtitlePath: null,
      currentTask: task("n1", "running"),
      runtimeQueue: [task("n2", "waiting")],
    })).toBe(true);

    expect(isNoteWaitingForSubtitles({
      noteId: "n3",
      subtitlePath: null,
      currentTask: task("n1", "running"),
      runtimeQueue: [task("n2", "waiting")],
    })).toBe(false);
  });

  it("builds the bottom-right indicator view model", () => {
    expect(getSubtitleIndicatorViewModel({
      currentTask: null,
      runtimeQueue: [],
      subtitleProgress: null,
    }).visible).toBe(false);

    expect(getSubtitleIndicatorViewModel({
      currentTask: task("n1", "running"),
      runtimeQueue: [],
      subtitleProgress: { noteId: "n1", percent: 37, message: "正在识别语音..." },
    })).toEqual({
      visible: true,
      queued: false,
      percent: 37,
      message: "正在识别语音...",
    });

    expect(getSubtitleIndicatorViewModel({
      currentTask: task("n1", "running", ["full_summary"]),
      runtimeQueue: [task("n2", "waiting")],
      subtitleProgress: null,
    })).toEqual({
      visible: true,
      queued: true,
      percent: null,
      message: "排队等待生成字幕",
    });
  });
});
