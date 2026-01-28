import { useState, useEffect, useRef, useCallback } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { ChatWindow } from "./ChatWindow";
import { NoteContentPanel } from "./NoteContentPanel";
import { VideoToolbar } from "./VideoToolbar";
import { useApp } from "../../context/AppContext";
import { useInitializationQueue } from "../../context/InitializationQueueContext";

// 拖拽分隔条组件
interface ResizerProps {
  onDrag: (deltaX: number) => void;
  isDragging: boolean;
}

function Resizer({ onDrag, isDragging }: ResizerProps) {
  const resizerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      onDrag(deltaX);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [onDrag]);

  return (
    <div className="flex flex-col items-center justify-center flex-shrink-0" style={{ width: "16px" }}>
      <div
        ref={resizerRef}
        onMouseDown={handleMouseDown}
        className={`
          w-1 h-8 rounded-full flex-shrink-0
          hover:bg-blue-500 dark:hover:bg-blue-400
          transition-all duration-200 cursor-col-resize
          ${isDragging ? "bg-blue-500 dark:bg-blue-400 w-1.5" : "bg-slate-300 dark:bg-slate-600 hover:w-1.5"}
        `}
      />
    </div>
  );
}

export function NotePage() {
  const { notes, selectedNoteId, toolbarSettings, aiConfigs, promptConfigs, refreshNotes, setLayoutPanelWidth } = useApp();

  // 使用全局初始化队列 Context
  const { currentTask, initState } = useInitializationQueue();

  // 找到当前选中的笔记
  const currentNote = notes.find((note) => note.id === selectedNoteId);

  // 当前笔记的模型ID（从笔记记录获取）
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当笔记变化时，更新模型ID
  useEffect(() => {
    if (currentNote?.model_id) {
      setCurrentModelId(currentNote.model_id);
    }
  }, [currentNote?.model_id]);

  // 初始化完成后刷新笔记数据（监听当前笔记的初始化状态）
  useEffect(() => {
    // 当当前任务是当前笔记且初始化完成时刷新
    if (
      currentTask &&
      currentTask.params.noteId === selectedNoteId &&
      !initState.isInitializing &&
      initState.completed > 0
    ) {
      refreshNotes();
    }
  }, [currentTask, selectedNoteId, initState.isInitializing, initState.completed, refreshNotes]);

  // 从全局设置获取工具栏状态
  const { videoVisible, autoPlay, layoutSwapped, layoutPanelWidth } = toolbarSettings;

  // 计算实际的宽度百分比
  // layoutPanelWidth: 左侧面板的宽度百分比 (30-70)
  // layoutSwapped: 是否交换左右位置
  const getWidths = () => {
    const leftWidth = layoutPanelWidth;
    const rightWidth = 100 - leftWidth;
    return { leftWidth, rightWidth };
  };

  const { leftWidth, rightWidth } = getWidths();

  // 处理拖拽调整宽度
  const handleResize = useCallback((deltaX: number) => {
    if (!containerRef.current) return;

    const containerWidth = containerRef.current.offsetWidth;
    const deltaPercent = (deltaX / containerWidth) * 100;

    // 根据是否交换左右，调整相应的面板
    // layoutPanelWidth 始终表示左侧面板的宽度百分比
    if (layoutSwapped) {
      // 右侧是视频面板，左侧是笔记面板
      // 向右拖动 = 笔记面板变窄（视频面板变宽）
      const newWidth = leftWidth - deltaPercent;
      setLayoutPanelWidth(newWidth);
    } else {
      // 左侧是视频面板，右侧是笔记面板
      // 向右拖动 = 视频面板变宽
      const newWidth = leftWidth + deltaPercent;
      setLayoutPanelWidth(newWidth);
    }

    setIsDragging(true);
  }, [layoutSwapped, leftWidth, setLayoutPanelWidth]);

  // 拖拽结束
  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      document.addEventListener("mouseup", handleMouseUp);
      return () => document.removeEventListener("mouseup", handleMouseUp);
    }
  }, [isDragging]);

  // 条件返回：在所有 hooks 之后
  if (!currentNote) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <p className="text-lg mb-2">未找到笔记</p>
          <p className="text-sm text-slate-400">请从侧边栏选择一个笔记</p>
        </div>
      </div>
    );
  }

  // 解析建议问题
  const suggestedQuestions: string[] = currentNote.suggested_questions
    ? JSON.parse(currentNote.suggested_questions)
    : [];

  // 视频+聊天面板
  const videoPanel = (
    <div className="flex flex-col gap-4 flex-shrink-0" style={{ width: `${leftWidth}%` }}>
      {/* 工具栏 */}
      <VideoToolbar
        currentModelId={currentModelId}
        onModelChange={setCurrentModelId}
      />

      {/* 视频播放器 */}
      {videoVisible && (
        <div className="flex-shrink-0">
          <VideoPlayer
            key={currentNote.id}
            videoUrl={currentNote.video_path}
            subtitleUrl={currentNote.subtitle_path}
            autoPlay={autoPlay}
            noteId={currentNote.id}
            lastPlaybackPosition={currentNote.last_playback_position}
          />

          {/* 视频信息 */}
          <div className="mt-3 px-1">
            <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 line-clamp-2">
              {currentNote.title}
            </h1>
          </div>
        </div>
      )}

      {/* 聊天窗口 */}
      <div className="flex-1 min-h-0">
        <ChatWindow
          noteId={currentNote.id}
          modelId={currentModelId}
          suggestedQuestions={suggestedQuestions}
        />
      </div>
    </div>
  );

  // 笔记内容面板
  const notePanel = (
    <div className="min-w-0" style={{ width: `${rightWidth}%` }}>
      <NoteContentPanel
        note={currentNote}
        onGenerationComplete={refreshNotes}
        aiConfigs={aiConfigs}
        currentModelId={currentModelId}
        promptConfigs={promptConfigs}
      />
    </div>
  );

  return (
    <div ref={containerRef} className="relative flex-1 flex gap-0 p-4 overflow-hidden">
      {layoutSwapped ? (
        <>
          {notePanel}
          <Resizer onDrag={handleResize} isDragging={isDragging} />
          {videoPanel}
        </>
      ) : (
        <>
          {videoPanel}
          <Resizer onDrag={handleResize} isDragging={isDragging} />
          {notePanel}
        </>
      )}
    </div>
  );
}
