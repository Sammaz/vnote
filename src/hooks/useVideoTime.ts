/**
 * useVideoTime - 视频时间订阅 hook
 *
 * 设计动机：
 * Plyr `timeupdate` 通过 `video-time-update` 全局事件广播，频率 4-15Hz。
 * 多个组件直接监听该事件并 setState 会造成大量重渲染。
 * 该模块统一订阅一次原始事件，使用 rAF 合并多次更新到一帧内，
 * 并向订阅方回调最新时间，避免高频 setState 与监听器抖动。
 */

import { useEffect, useRef } from "react";

type Listener = (time: number) => void;

let latestTime = 0;
let pendingFrame: number | null = null;
const listeners = new Set<Listener>();
let isInitialized = false;

function flush() {
  pendingFrame = null;
  const time = latestTime;
  for (const listener of listeners) {
    try {
      listener(time);
    } catch (err) {
      console.error("[useVideoTime] listener error:", err);
    }
  }
}

function ensureGlobalListener() {
  if (isInitialized) return;
  isInitialized = true;
  if (typeof window === "undefined") return;

  window.addEventListener("video-time-update", (e: Event) => {
    const event = e as CustomEvent<{ time: number }>;
    const time = event.detail?.time;
    if (typeof time !== "number") return;
    latestTime = time;
    if (pendingFrame === null) {
      pendingFrame = window.requestAnimationFrame(flush);
    }
  });
}

/**
 * 订阅视频当前时间变化（rAF 节流）。
 * 回调每帧最多触发一次，多个订阅者共享同一个 rAF。
 * 不触发 React 重渲染——回调内自行决定是否 setState。
 */
export function subscribeVideoTime(listener: Listener): () => void {
  ensureGlobalListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 获取当前最新的视频时间（同步快照）。
 */
export function getCurrentVideoTime(): number {
  return latestTime;
}

/**
 * Hook：在组件中订阅视频时间，自动随组件卸载清理。
 * 回调请保持稳定（用 ref 或 useCallback），避免重复订阅。
 */
export function useVideoTimeSubscription(listener: Listener) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    const stable: Listener = (time) => listenerRef.current(time);
    const unsubscribe = subscribeVideoTime(stable);
    return unsubscribe;
  }, []);
}
