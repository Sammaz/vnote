/**
 * VirtualizedNoteGrid - 虚拟滚动笔记网格组件
 * 使用 @tanstack/react-virtual 实现高性能长列表渲染
 * 支持响应式列数和动态高度
 */
import { useRef, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Note } from "../../types";
import { NoteCard } from "./NoteCard";

// 常量定义
const CARD_HEIGHT = 220; // 卡片高度 (aspect-video + 信息区域)
const GAP = 16; // 网格间距
const OVERSCAN = 3; // 预渲染行数

interface VirtualizedNoteGridProps {
  notes: Note[];
  onNoteClick: (noteId: number) => void;
  /** 每行列数，默认根据容器宽度自动计算 */
  columns?: number;
  /** 容器类名 */
  className?: string;
}

/**
 * 根据容器宽度计算列数
 * sm: 640px -> 2列
 * lg: 1024px -> 3列
 * xl: 1280px -> 4列
 */
function useResponsiveColumns(containerRef: React.RefObject<HTMLDivElement | null>): number {
  const width = containerRef.current?.clientWidth ?? 800;

  if (width >= 1280) return 4;
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

export function VirtualizedNoteGrid({
  notes,
  onNoteClick,
  columns: fixedColumns,
  className = "",
}: VirtualizedNoteGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // 响应式列数
  const autoColumns = useResponsiveColumns(parentRef);
  const columns = fixedColumns ?? autoColumns;

  // 将笔记分组为行
  const rows = useMemo(() => {
    const result: Note[][] = [];
    for (let i = 0; i < notes.length; i += columns) {
      result.push(notes.slice(i, i + columns));
    }
    return result;
  }, [notes, columns]);

  // 虚拟化配置
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // 点击处理
  const handleClick = useCallback((noteId: number) => {
    onNoteClick(noteId);
  }, [onNoteClick]);

  // 如果笔记数量少于阈值，使用普通渲染（避免小列表的虚拟化开销）
  const VIRTUALIZATION_THRESHOLD = 20;
  if (notes.length < VIRTUALIZATION_THRESHOLD) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onClick={() => handleClick(note.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`flex-1 overflow-auto ${className}`}
      style={{ contain: "strict" }}
    >
      <div
        className="relative w-full p-4"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              className="absolute top-0 left-0 w-full px-4"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className="grid gap-4 h-full"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {row.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onClick={() => handleClick(note.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedNoteGrid;
