/**
 * VirtualizedSubtitleList - 虚拟滚动字幕列表组件
 * 使用 @tanstack/react-virtual 实现高性能长列表渲染
 */
import { useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SubtitleEntry } from "../../types";
import { SubtitleRow } from "./SubtitleRow";
import { useAutoScroll } from "../../hooks/useAutoScroll";

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
  const lastIndexRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);
  const { shouldAutoScroll, handleUserScroll, isAutoScrollingRef } = useAutoScroll(true);

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
    if (currentEntryIndex === null) return;

    // 索引没变化，不滚动
    if (currentEntryIndex === lastIndexRef.current) return;

    if (shouldAutoScroll && currentEntryIndex >= 0 && currentEntryIndex < entries.length) {
      isAutoScrollingRef.current = true;

      // 计算滚动距离，决定使用 smooth 还是 auto
      const scrollDistance = Math.abs(currentEntryIndex - (lastIndexRef.current ?? currentEntryIndex));
      const behavior = scrollDistance > 10 ? "auto" : "smooth"; // 超过10条使用瞬时滚动

      virtualizer.scrollToIndex(currentEntryIndex, {
        align: "center",
        behavior: isInitializedRef.current ? behavior : "auto",
      });
      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, 500);
    }

    lastIndexRef.current = currentEntryIndex;
    isInitializedRef.current = true;
  }, [currentEntryIndex, entries.length, virtualizer, shouldAutoScroll, isAutoScrollingRef]);

  const handleClick = useCallback((index: number) => {
    onEntryClick?.(index);
  }, [onEntryClick]);

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: "strict" }}
      onScroll={handleUserScroll}
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
