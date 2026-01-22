/**
 * 播放位置和观看时长追踪 Hook
 */

import { useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WATCH_TIME_INTERVAL, POSITION_SAVE_DEBOUNCE } from "./constants";

interface UsePlaybackTrackingOptions {
  noteId?: number;
  addWatchTime: (seconds: number) => void;
}

interface PlaybackTrackingRefs {
  lastSavedPositionRef: React.MutableRefObject<number>;
  saveTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  noteIdRef: React.MutableRefObject<number | undefined>;
  watchTimeIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  addWatchTimeRef: React.MutableRefObject<(seconds: number) => void>;
}

export function usePlaybackTracking({
  noteId,
  addWatchTime,
}: UsePlaybackTrackingOptions): PlaybackTrackingRefs & {
  savePlaybackPosition: (position: number) => Promise<void>;
  startWatchTimeTracking: (isPlaying: () => boolean) => void;
  stopWatchTimeTracking: () => void;
  cleanup: () => void;
} {
  const lastSavedPositionRef = useRef<number>(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteIdRef = useRef<number | undefined>(noteId);
  const watchTimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addWatchTimeRef = useRef(addWatchTime);

  // 保持 refs 同步
  useEffect(() => {
    addWatchTimeRef.current = addWatchTime;
  }, [addWatchTime]);

  useEffect(() => {
    noteIdRef.current = noteId;
  }, [noteId]);

  // 保存播放位置到数据库
  const savePlaybackPosition = useCallback(async (position: number) => {
    const currentNoteId = noteIdRef.current;
    if (!currentNoteId || position < 1) return;
    if (Math.abs(position - lastSavedPositionRef.current) < 1) return;
    lastSavedPositionRef.current = position;
    try {
      await invoke("update_playback_position", { noteId: currentNoteId, position });
    } catch (err) {
      console.error("Failed to save playback position:", err);
    }
  }, []);

  // 观看时长追踪
  const startWatchTimeTracking = useCallback((isPlaying: () => boolean) => {
    if (watchTimeIntervalRef.current) return;
    watchTimeIntervalRef.current = setInterval(() => {
      if (isPlaying()) {
        addWatchTimeRef.current(WATCH_TIME_INTERVAL);
      }
    }, WATCH_TIME_INTERVAL * 1000);
  }, []);

  const stopWatchTimeTracking = useCallback(() => {
    if (watchTimeIntervalRef.current) {
      clearInterval(watchTimeIntervalRef.current);
      watchTimeIntervalRef.current = null;
    }
  }, []);

  // 清理函数
  const cleanup = useCallback(() => {
    stopWatchTimeTracking();
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, [stopWatchTimeTracking]);

  return {
    lastSavedPositionRef,
    saveTimeoutRef,
    noteIdRef,
    watchTimeIntervalRef,
    addWatchTimeRef,
    savePlaybackPosition,
    startWatchTimeTracking,
    stopWatchTimeTracking,
    cleanup,
  };
}

/**
 * 带防抖的保存播放位置
 */
export function debouncedSavePosition(
  saveTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  savePlaybackPosition: (position: number) => Promise<void>,
  position: number
): void {
  if (saveTimeoutRef.current) {
    clearTimeout(saveTimeoutRef.current);
  }
  saveTimeoutRef.current = setTimeout(() => {
    savePlaybackPosition(position);
  }, POSITION_SAVE_DEBOUNCE);
}
