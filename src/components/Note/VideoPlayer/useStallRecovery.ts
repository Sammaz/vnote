import { useCallback, useRef } from "react";
import Plyr from "plyr";
import {
  STALL_CHECK_INTERVAL,
  STALL_THRESHOLD,
  STALL_NUDGE_OFFSET,
  STALL_RECOVERY_COOLDOWN,
  STALL_MAX_RELOAD_PER_SESSION,
} from "./constants";

export function useStallRecovery(
  playerRef: React.RefObject<Plyr | null>,
  onRecoveryLoadingChange: (loading: boolean) => void
): {
  startStallDetection: () => void;
  stopStallDetection: () => void;
} {
  const consecutiveStallCountRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastRecoveryTimestampRef = useRef(0);
  const currentRecoveryLevelRef = useRef<0 | 1 | 2>(0);
  const reloadCountRef = useRef(0);
  const recoveringRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runReloadRecovery = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      recoveringRef.current = false;
      return;
    }

    if (reloadCountRef.current >= STALL_MAX_RELOAD_PER_SESSION) {
      console.warn("[Stall Recovery] Level 3 skipped: max reload count reached");
      recoveringRef.current = false;
      return;
    }

    const media = (player as any).media as HTMLVideoElement | undefined;
    if (!media) {
      recoveringRef.current = false;
      return;
    }

    reloadCountRef.current += 1;
    const targetTime = player.currentTime;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      media.style.opacity = "";
      onRecoveryLoadingChange(false);
      recoveringRef.current = false;
    };

    const timeoutId = setTimeout(() => {
      console.warn("[Stall Recovery] Level 3 timeout");
      finish();
    }, 5000);

    const handleSeeked = () => {
      clearTimeout(timeoutId);
      media.removeEventListener("seeked", handleSeeked);
      finish();
      Promise.resolve(player.play()).catch((err: unknown) => {
        console.warn("[Stall Recovery] Level 3 play failed:", err);
      });
    };

    const handleCanPlay = () => {
      media.removeEventListener("canplay", handleCanPlay);
      const safeTime = Number.isFinite(player.duration)
        ? Math.min(targetTime, Math.max(player.duration - 0.1, 0))
        : targetTime;
      media.addEventListener("seeked", handleSeeked, { once: true });
      player.currentTime = Math.max(0, safeTime);
    };

    console.warn("[Stall Recovery] Level 3: Seamless reload");
    media.style.opacity = "0";
    onRecoveryLoadingChange(true);
    media.addEventListener("canplay", handleCanPlay, { once: true });
    media.load();
  }, [onRecoveryLoadingChange, playerRef]);

  const recoverFromStall = useCallback(() => {
    const player = playerRef.current;
    if (!player || recoveringRef.current) return;

    const now = Date.now();
    if (now - lastRecoveryTimestampRef.current < STALL_RECOVERY_COOLDOWN) {
      return;
    }

    recoveringRef.current = true;
    lastRecoveryTimestampRef.current = now;

    const media = (player as any).media as HTMLVideoElement | undefined;

    try {
      if (currentRecoveryLevelRef.current === 0) {
        console.warn("[Stall Recovery] Level 1: Seek nudge");
        if (media) {
          const nextTime = Math.min(player.currentTime + STALL_NUDGE_OFFSET, Math.max(player.duration - 0.1, 0));
          player.currentTime = Math.max(0, nextTime);
        }
        currentRecoveryLevelRef.current = 1;
        recoveringRef.current = false;
        return;
      }

      if (currentRecoveryLevelRef.current === 1) {
        console.warn("[Stall Recovery] Level 2: Pause-play cycle");
        player.pause();
        requestAnimationFrame(() => {
          Promise.resolve(player.play()).catch((err: unknown) => {
            console.warn("[Stall Recovery] Level 2 play failed:", err);
          });
          recoveringRef.current = false;
        });
        currentRecoveryLevelRef.current = 2;
        return;
      }

      runReloadRecovery();
    } catch (err) {
      console.warn("[Stall Recovery] Recovery failed:", err);
      recoveringRef.current = false;
      onRecoveryLoadingChange(false);
    }
  }, [onRecoveryLoadingChange, playerRef, runReloadRecovery]);

  const startStallDetection = useCallback(() => {
    if (intervalRef.current) return;

    const player = playerRef.current;
    if (!player) return;

    lastTimeRef.current = player.currentTime;
    consecutiveStallCountRef.current = 0;

    intervalRef.current = setInterval(() => {
      const currentPlayer = playerRef.current;
      if (!currentPlayer || !currentPlayer.playing || recoveringRef.current) return;

      const currentTime = currentPlayer.currentTime;
      const duration = currentPlayer.duration;
      const media = (currentPlayer as any).media as HTMLVideoElement | undefined;

      if (!Number.isFinite(currentTime) || !Number.isFinite(duration)) {
        lastTimeRef.current = currentTime;
        return;
      }

      if (currentTime >= duration - 1) {
        consecutiveStallCountRef.current = 0;
        lastTimeRef.current = currentTime;
        return;
      }

      const timeAdvanced = Math.abs(currentTime - lastTimeRef.current) > 0.01;
      if (timeAdvanced) {
        consecutiveStallCountRef.current = 0;
        currentRecoveryLevelRef.current = 0;
        lastTimeRef.current = currentTime;
        return;
      }

      const isBuffering = !!media && (media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || media.networkState === HTMLMediaElement.NETWORK_LOADING);
      if (isBuffering) {
        lastTimeRef.current = currentTime;
        return;
      }

      consecutiveStallCountRef.current += 1;
      lastTimeRef.current = currentTime;

      if (consecutiveStallCountRef.current >= STALL_THRESHOLD) {
        consecutiveStallCountRef.current = 0;
        recoverFromStall();
      }
    }, STALL_CHECK_INTERVAL);
  }, [playerRef, recoverFromStall]);

  const stopStallDetection = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    consecutiveStallCountRef.current = 0;
    currentRecoveryLevelRef.current = 0;
    recoveringRef.current = false;
    onRecoveryLoadingChange(false);
  }, [onRecoveryLoadingChange]);

  return {
    startStallDetection,
    stopStallDetection,
  };
}
