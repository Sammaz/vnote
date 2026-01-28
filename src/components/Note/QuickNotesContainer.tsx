/**
 * 随手笔记容器组件
 * 管理子标签页切换（富文本编辑、思维导图、无限画布）
 */

import { type QuickNotesSubTab } from "./QuickNotes/SubTabBar";
import { QuickNotesContent } from "./QuickNotesContent";
import { MindMapEditor } from "./QuickNotes/MindMapEditor";
import { InfiniteCanvas } from "./QuickNotes/InfiniteCanvas";

interface QuickNotesContainerProps {
  noteId: string;
  noteTitle: string;
  initialContent: string | null;
  initialMindMapData: string | null;
  initialCanvasData: string | null;
  onContentChange?: () => void;
  /** 强制显示指定的子标签，不显示子标签栏 */
  forceTab?: QuickNotesSubTab;
}

export function QuickNotesContainer({
  noteId,
  noteTitle,
  initialContent,
  initialMindMapData,
  initialCanvasData,
  onContentChange,
  forceTab,
}: QuickNotesContainerProps) {
  // 如果指定了 forceTab，使用它；否则默认显示 richtext
  const currentTab = forceTab || "richtext";

  return (
    <div className="flex flex-col h-full">
      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {currentTab === "richtext" && (
          <QuickNotesContent
            noteId={noteId}
            initialContent={initialContent}
            onContentChange={onContentChange}
          />
        )}
        {currentTab === "mindmap" && (
          <MindMapEditor
            noteId={noteId}
            noteTitle={noteTitle}
            initialData={initialMindMapData}
            onContentChange={onContentChange}
          />
        )}
        {currentTab === "canvas" && (
          <InfiniteCanvas
            noteId={noteId}
            noteTitle={noteTitle}
            initialData={initialCanvasData}
            onContentChange={onContentChange}
          />
        )}
      </div>
    </div>
  );
}
