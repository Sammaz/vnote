/**
 * 调整大小手柄组件
 */

import type { ResizeDirection } from "./constants";

interface ResizeHandlesProps {
  onResizeStart: (e: React.MouseEvent, direction: ResizeDirection) => void;
}

export function ResizeHandles({ onResizeStart }: ResizeHandlesProps) {
  return (
    <>
      {/* 四边 */}
      <div
        className="absolute top-0 left-2 right-2 h-1 cursor-n-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "n")}
      />
      <div
        className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "s")}
      />
      <div
        className="absolute left-0 top-2 bottom-2 w-1 cursor-w-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "w")}
      />
      <div
        className="absolute right-0 top-2 bottom-2 w-1 cursor-e-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "e")}
      />
      {/* 四角 */}
      <div
        className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "nw")}
      />
      <div
        className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "ne")}
      />
      <div
        className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "sw")}
      />
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize hover:bg-blue-500/30"
        onMouseDown={(e) => onResizeStart(e, "se")}
      />
    </>
  );
}
