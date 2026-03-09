import { useState, useRef, useCallback, useEffect } from "react";

export function useAutoScroll(enabled: boolean) {
  const [isPaused, setIsPaused] = useState(false);
  const resumeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoScrollingRef = useRef(false);
  const isUserScrollingRef = useRef(false);

  const handleUserScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;

    isUserScrollingRef.current = true;
    setIsPaused(true);
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);

    resumeTimerRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      setIsPaused(false);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, []);

  return {
    shouldAutoScroll: enabled && !isPaused && !isUserScrollingRef.current,
    handleUserScroll,
    isAutoScrollingRef,
  };
}
