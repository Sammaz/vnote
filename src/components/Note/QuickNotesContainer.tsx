/**
 * 随手笔记容器组件
 * 管理子标签页切换（富文本编辑、思维导图、无限画布）
 */

import { useState } from "react";
import { SubTabBar, type QuickNotesSubTab } from "./QuickNotes/SubTabBar";
import { QuickNotesContent } from "./QuickNotesContent";
import { MindMapEditor } from "./QuickNotes/MindMapEditor";
import { InfiniteCanvas } from "./QuickNotes/InfiniteCanvas";

interface QuickNotesContainerProps {
  noteId: number;
  noteTitle: string;
  initialContent: string | null;
  initialMindMapData: string | null;
  initialCanvasData: string | null;
  onContentChange?: () => void;
}

export function QuickNotesContainer({
  noteId,
  noteTitle,
  initialContent,
  initialMindMapData,
  initialCanvasData,
  onContentChange,
}: QuickNotesContainerProps) {
  const [activeSubTab, setActiveSubTab] = useState<QuickNotesSubTab>("richtext");

  return (
    <div className="flex flex-col h-full">
      {/* 子标签页切换栏 */}
      <SubTabBar activeTab={activeSubTab} onTabChange={setActiveSubTab} />

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {activeSubTab === "richtext" && (
          <QuickNotesContent
            noteId={noteId}
            initialContent={initialContent}
            onContentChange={onContentChange}
          />
        )}
        {activeSubTab === "mindmap" && (
          <MindMapEditor
            noteId={noteId}
            noteTitle={noteTitle}
            initialData={initialMindMapData}
            onContentChange={onContentChange}
          />
        )}
        {activeSubTab === "canvas" && (
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
