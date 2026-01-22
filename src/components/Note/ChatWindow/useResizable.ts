/**
 * 可复用的调整大小 Hook
 */

import { useState, useCallback, useEffect } from "react";
import { MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT, type ResizeDirection } from "./constants";

interface UseResizableOptions {
  initialSize?: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface ResizeStart {
  x: number;
  y: number;
  width: number;
  height: number;
  posX: number;
  posY: number;
}

export function useResizable({
  initialSize = { width: 420, height: 550 },
  minWidth = MIN_WIDTH,
  minHeight = MIN_HEIGHT,
  maxWidth = MAX_WIDTH,
  maxHeight = MAX_HEIGHT,
}: UseResizableOptions = {}) {
  const [size, setSize] = useState(initialSize);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection>(null);
  const [resizeStart, setResizeStart] = useState<ResizeStart>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    posX: 0,
    posY: 0,
  });

  const handleResizeStart = useCallback((
    e: React.MouseEvent,
    direction: ResizeDirection,
    currentPosition: { x: number; y: number }
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: currentPosition.x,
      posY: currentPosition.y,
    });
  }, [size]);

  const calculateNewSize = useCallback((e: MouseEvent): {
    newWidth: number;
    newHeight: number;
    newX: number;
    newY: number;
  } => {
    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;

    let newWidth = resizeStart.width;
    let newHeight = resizeStart.height;
    let newX = resizeStart.posX;
    let newY = resizeStart.posY;

    if (resizeDirection?.includes("e")) {
      newWidth = Math.min(maxWidth, Math.max(minWidth, resizeStart.width + deltaX));
    }
    if (resizeDirection?.includes("w")) {
      const potentialWidth = resizeStart.width - deltaX;
      if (potentialWidth >= minWidth && potentialWidth <= maxWidth) {
        newWidth = potentialWidth;
        newX = resizeStart.posX + deltaX;
      }
    }
    if (resizeDirection?.includes("s")) {
      newHeight = Math.min(maxHeight, Math.max(minHeight, resizeStart.height + deltaY));
    }
    if (resizeDirection?.includes("n")) {
      const potentialHeight = resizeStart.height - deltaY;
      if (potentialHeight >= minHeight && potentialHeight <= maxHeight) {
        newHeight = potentialHeight;
        newY = resizeStart.posY + deltaY;
      }
    }

    return { newWidth, newHeight, newX, newY };
  }, [resizeDirection, resizeStart, minWidth, minHeight, maxWidth, maxHeight]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  // 添加全局鼠标事件监听
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isResizing, handleMouseUp]);

  return {
    size,
    setSize,
    isResizing,
    resizeDirection,
    handleResizeStart,
    calculateNewSize,
  };
}
