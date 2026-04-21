import { useState, useEffect, useRef, useCallback } from "react";
import { Pencil, ArrowLeft } from "lucide-react";
import { VideoPlayer } from "./VideoPlayer";
import { ChatWindow } from "./ChatWindow";
import { NoteContentPanel } from "./NoteContentPanel";
import { VideoToolbar } from "./VideoToolbar";
import { EditNoteModal } from "../Notes/EditNoteModal";
import { useApp } from "../../context/AppContext";
import { useCollections } from "../../context/CollectionsContext";

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

    // 拖拽期间全局设置光标样式和禁用文本选择，防止鼠标移出时光标变回箭头
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      onDrag(deltaX);
    };

    const handleMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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
  const { notes, selectedNoteId, selectedCollectionId, setCurrentView, toolbarSettings, aiConfigs, promptConfigs, refreshNotes, setLayoutPanelWidth, toggleSidebar, sidebar, setSelectedNoteId, defaultAiConfigId, notePageModelSelections, setNotePageModelSelection } = useApp();
  const { expandCollectionPath } = useCollections();

  // 找到当前选中的笔记
  const currentNote = notes.find((note) => note.id === selectedNoteId);

  // 当前笔记的模型ID（默认使用设置中的默认模型，可由工具栏临时覆盖）
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当笔记或默认模型变化时，重置当前模型ID
  useEffect(() => {
    if (!currentNote) {
      setCurrentModelId(defaultAiConfigId);
      return;
    }

    const rememberedModelId = notePageModelSelections[currentNote.id];
    setCurrentModelId(rememberedModelId ?? defaultAiConfigId);
  }, [currentNote, defaultAiConfigId, notePageModelSelections]);

  useEffect(() => {
    if (!currentNote || !currentModelId) return;
    setNotePageModelSelection(currentNote.id, currentModelId);
  }, [currentNote, currentModelId, setNotePageModelSelection]);

  // 自动展开侧边栏
  useEffect(() => {
    if (sidebar.collapsed) {
      toggleSidebar();
    }
  }, []);

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
      <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
        <div className="text-center">
          <p className="text-lg mb-2">未找到笔记</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">请从侧边栏选择一个笔记</p>
        </div>
      </div>
    );
  }

  // 解析建议问题，若没有或解析失败则显示默认问题
  const defaultSuggestedQuestions = [
    "这个视频的核心内容是什么?",
    "有哪些关键知识点?",
    "如何在实际项目中应用?",
  ];
  const suggestedQuestions: string[] = (() => {
    if (!currentNote.suggested_questions) return defaultSuggestedQuestions;
    try {
      const parsed = JSON.parse(currentNote.suggested_questions);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultSuggestedQuestions;
    } catch {
      return defaultSuggestedQuestions;
    }
  })();

  // 视频+聊天面板
  const videoPanel = (
    <div className="flex flex-col gap-4 flex-shrink-0" style={{ width: `${leftWidth}%` }}>
      {/* 返回按钮 + 工具栏 */}
      <div className="flex items-center gap-2">
        {selectedCollectionId && (
          <button
            onClick={() => {
              if (selectedCollectionId) {
                expandCollectionPath(selectedCollectionId);
              }
              setSelectedNoteId(null);
              setCurrentView("collection");
            }}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-neutral-700 rounded-lg transition-colors text-slate-700 dark:text-slate-300 cursor-pointer"
            title="返回合集"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <VideoToolbar
          currentModelId={currentModelId}
          onModelChange={setCurrentModelId}
        />
      </div>

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
          <div className="mt-3 px-1 flex items-center gap-2">
            <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 line-clamp-2 flex-1">
              {currentNote.title}
            </h1>
            <button
              onClick={() => setShowEditModal(true)}
              className="flex-shrink-0 p-1.5 rounded-md text-slate-500 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
              title="编辑笔记"
            >
              <Pencil className="w-4 h-4" />
            </button>
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
        key={currentNote.id}
        note={currentNote}
        onGenerationComplete={refreshNotes}
        aiConfigs={aiConfigs}
        currentModelId={currentModelId}
        defaultAiConfigId={defaultAiConfigId}
        promptConfigs={promptConfigs}
      />
    </div>
  );

  return (
    <>
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

      {showEditModal && currentNote && (
        <EditNoteModal note={currentNote} onClose={() => setShowEditModal(false)} />
      )}
    </>
  );
}
