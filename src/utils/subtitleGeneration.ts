export const SUBTITLE_GENERATION_PROGRESS_EVENT = "subtitle-generation-progress";
export const SUBTITLE_GENERATION_ITEM_KEY = "subtitle_generation";

export interface SubtitleRuntimeTaskLike {
  status: string;
  params: {
    noteId: string;
    selectedKeys: string[];
  };
}

export interface SubtitleGenerationProgressEvent {
  note_id: string;
  percent: number;
  message: string;
}

export interface SubtitleGenerationProgress {
  noteId: string;
  percent: number;
  message: string;
}

export function isSubtitleGenerationTask(task: SubtitleRuntimeTaskLike | null | undefined): boolean {
  return Boolean(task?.params.selectedKeys.includes(SUBTITLE_GENERATION_ITEM_KEY));
}

export function hasGeneratedSubtitles(subtitlePath: string | null | undefined): boolean {
  return Boolean(subtitlePath && subtitlePath.trim());
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeSubtitleProgress(
  payload: SubtitleGenerationProgressEvent,
): SubtitleGenerationProgress {
  return {
    noteId: payload.note_id,
    percent: clampPercent(payload.percent),
    message: payload.message?.trim() || "正在生成字幕",
  };
}

export function isNoteWaitingForSubtitles(options: {
  noteId: string;
  subtitlePath: string | null | undefined;
  currentTask: SubtitleRuntimeTaskLike | null;
  runtimeQueue: SubtitleRuntimeTaskLike[];
}): boolean {
  if (hasGeneratedSubtitles(options.subtitlePath)) {
    return false;
  }

  const matchesNote = (task: SubtitleRuntimeTaskLike | null | undefined) =>
    Boolean(task && task.params.noteId === options.noteId && isSubtitleGenerationTask(task));

  if (matchesNote(options.currentTask) && options.currentTask?.status === "running") {
    return true;
  }

  return options.runtimeQueue.some(matchesNote);
}

export function getSubtitleIndicatorViewModel(options: {
  currentTask: SubtitleRuntimeTaskLike | null;
  runtimeQueue: SubtitleRuntimeTaskLike[];
  subtitleProgress: SubtitleGenerationProgress | null;
}): {
  visible: boolean;
  queued: boolean;
  percent: number | null;
  message: string;
} {
  const isCurrentSubtitleTask =
    options.currentTask?.status === "running" && isSubtitleGenerationTask(options.currentTask);
  const hasQueuedSubtitleTask = options.runtimeQueue.some(isSubtitleGenerationTask);

  if (!isCurrentSubtitleTask && !hasQueuedSubtitleTask) {
    return {
      visible: false,
      queued: false,
      percent: null,
      message: "",
    };
  }

  if (!isCurrentSubtitleTask) {
    return {
      visible: true,
      queued: true,
      percent: null,
      message: "排队等待生成字幕",
    };
  }

  const progress =
    options.subtitleProgress &&
    options.currentTask &&
    options.subtitleProgress.noteId === options.currentTask.params.noteId
      ? options.subtitleProgress
      : null;

  return {
    visible: true,
    queued: false,
    percent: progress?.percent ?? 0,
    message: progress?.message ?? "正在生成字幕",
  };
}
