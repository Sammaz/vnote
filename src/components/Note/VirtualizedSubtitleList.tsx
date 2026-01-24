/**
 * VirtualizedSubtitleList - 虚拟滚动字幕列表组件
 * 使用 @tanstack/react-virtual 实现高性能长列表渲染
 */
import { useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SubtitleEntry } from "../../types";
import { SubtitleRow } from "./SubtitleRow";

// 常量定义
const ESTIMATED_ROW_HEIGHT = 56; // 预估行高
const OVERSCAN = 5; // 预渲染行数
const PADDING_Y = 24; // 上下内边距

interface VirtualizedSubtitleListProps {
  entries: SubtitleEntry[];
  currentEntryIndex: number | null;
  onEntryClick?: (index: number) => void;
}

export function VirtualizedSubtitleList({
  entries,
  currentEntryIndex,
  onEntryClick,
}: VirtualizedSubtitleListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // 虚拟化配置
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // 当 currentEntryIndex 变化时，滚动到对应位置
  useEffect(() => {
    if (currentEntryIndex !== null && currentEntryIndex >= 0 && currentEntryIndex < entries.length) {
      virtualizer.scrollToIndex(currentEntryIndex, {
        align: "center",
        behavior: "smooth",
      });
    }
  }, [currentEntryIndex, entries.length, virtualizer]);

  const handleClick = useCallback((index: number) => {
    onEntryClick?.(index);
  }, [onEntryClick]);

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: "strict" }}
    >
      <div
        className="relative w-full px-6"
        style={{
          height: `${virtualizer.getTotalSize() + PADDING_Y * 2}px`,
          paddingTop: PADDING_Y,
          paddingBottom: PADDING_Y,
        }}
      >
        {virtualItems.map((virtualRow) => {
          const entry = entries[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 right-0 px-6"
              style={{
                transform: `translateY(${virtualRow.start + PADDING_Y}px)`,
              }}
            >
              <SubtitleRow
                entry={entry}
                isActive={currentEntryIndex === virtualRow.index}
                onClick={() => handleClick(virtualRow.index)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedSubtitleList;
