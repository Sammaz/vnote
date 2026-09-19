import { describe, expect, it } from "vitest";
import type { DetailedReadingChapter } from "../types";
import {
  stashDetailedReadingPartial,
  stashDetailedReadingChapter,
  stashDetailedReadingData,
  takeDetailedReadingPartial,
  takeDetailedReadingData,
  clearDetailedReadingPartial,
  clearNoteGenerationState,
  markPendingNoteRefresh,
  takePendingNoteRefresh,
} from "./noteGenerationState";

const snapshot = {
  chapters: [] as DetailedReadingChapter[],
  total_duration: 0,
  generated_at: "t0",
};

const chapter = (id: string, start: number, end: number): DetailedReadingChapter => ({
  id,
  title: id,
  start_time: start,
  end_time: end,
  content: "",
  subtitle_entries: [],
  screenshot_path: null,
});

describe("pending detailed reading partials", () => {
  it("keeps raw JSON snapshots unparsed until take()", () => {
    const noteId = "stash-take-once";
    stashDetailedReadingPartial(noteId, JSON.stringify(snapshot));
    expect(takeDetailedReadingData(noteId)).toEqual(snapshot);
    expect(takeDetailedReadingData(noteId)).toBeNull();
  });

  it("merges incremental chapters while hidden without JSON snapshots", () => {
    const noteId = "stash-chapter-merge";
    stashDetailedReadingChapter(noteId, chapter("second", 60, 120), 120);
    stashDetailedReadingChapter(noteId, chapter("first", 0, 60), 120);
    const taken = takeDetailedReadingData(noteId);
    expect(taken?.chapters.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("does not let a later JSON snapshot clobber an incremental chapter stash", () => {
    const noteId = "stash-no-overwrite";
    stashDetailedReadingChapter(noteId, chapter("old", 0, 10), 10);
    stashDetailedReadingPartial(noteId, JSON.stringify(snapshot));
    const taken = takeDetailedReadingData(noteId);
    expect(taken?.chapters.map((item) => item.id)).toEqual(["old"]);
  });

  it("uses the raw snapshot only when no chapter stash exists", () => {
    const noteId = "stash-raw-fallback";
    stashDetailedReadingPartial(noteId, JSON.stringify(snapshot));
    expect(takeDetailedReadingData(noteId)).toEqual(snapshot);
  });

  it("does not parse invalid raw snapshots until take()", () => {
    const noteId = "stash-invalid-raw";
    stashDetailedReadingPartial(noteId, "{not-json");
    expect(takeDetailedReadingData(noteId)).toBeNull();
  });

  it("empty TabStarted stash wins over a later raw snapshot", () => {
    const noteId = "stash-empty-wins";
    stashDetailedReadingData(noteId, snapshot);
    stashDetailedReadingPartial(noteId, JSON.stringify({
      chapters: [chapter("late", 0, 1)],
      total_duration: 1,
      generated_at: "t1",
    }));
    expect(takeDetailedReadingData(noteId)).toEqual(snapshot);
  });

  it("clearNoteGenerationState drops pending partials", () => {
    const noteId = "stash-clear";
    stashDetailedReadingPartial(noteId, JSON.stringify(snapshot));
    clearNoteGenerationState(noteId);
    expect(takeDetailedReadingPartial(noteId)).toBeNull();
  });

  it("clearDetailedReadingPartial drops only the stash", () => {
    const noteId = "stash-clear-partial";
    stashDetailedReadingChapter(noteId, chapter("c", 0, 5), 5);
    clearDetailedReadingPartial(noteId);
    expect(takeDetailedReadingPartial(noteId)).toBeNull();
  });

  it("defers note refresh until takePendingNoteRefresh", () => {
    const noteId = "pending-refresh";
    markPendingNoteRefresh(noteId);
    expect(takePendingNoteRefresh(noteId)).toBe(true);
    expect(takePendingNoteRefresh(noteId)).toBe(false);
  });
});
