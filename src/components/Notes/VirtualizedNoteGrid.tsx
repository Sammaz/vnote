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
const GAP = 16; // 网格间距
const OVERSCAN = 3; // 预渲染行数

interface VirtualizedNoteGridProps {
  notes: Note[];
  onNoteClick: (noteId: string) => void;
  onNoteEdit?: (note: Note) => void;
  onNoteDelete?: (noteId: string, triggerRect?: DOMRect | null) => void;
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
  onNoteEdit,
  onNoteDelete,
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

  // 根据容器宽度动态估算行高: aspect-video(9/16 * 列宽) + 信息区(~68px) + gap
  const estimateRowSize = useCallback(() => {
    const containerWidth = parentRef.current?.clientWidth ?? 800;
    const availableWidth = containerWidth - 32; // px-4 * 2
    const colWidth = (availableWidth - GAP * (columns - 1)) / columns;
    const videoHeight = colWidth * 9 / 16;
    return videoHeight + 68 + GAP;
  }, [columns]);

  // 虚拟化配置 - 使用动态测量
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowSize,
    measureElement: (el) => el.getBoundingClientRect().height + GAP,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // 点击处理
  const handleClick = useCallback((noteId: string) => {
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
              onEdit={onNoteEdit ? () => onNoteEdit(note) : undefined}
              onDelete={onNoteDelete ? (triggerRect) => onNoteDelete(note.id, triggerRect) : undefined}
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
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 w-full px-4"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {row.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onClick={() => handleClick(note.id)}
                    onEdit={onNoteEdit ? () => onNoteEdit(note) : undefined}
                    onDelete={onNoteDelete ? (triggerRect) => onNoteDelete(note.id, triggerRect) : undefined}
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
