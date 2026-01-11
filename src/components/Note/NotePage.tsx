import { useState, useEffect } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { ChatWindow } from "./ChatWindow";
import { NoteContentPanel } from "./NoteContentPanel";
import { VideoToolbar } from "./VideoToolbar";
import { useApp } from "../../context/AppContext";

export function NotePage() {
  const { notes, selectedNoteId, toolbarSettings } = useApp();

  // 当前笔记的模型ID（从笔记记录获取）
  const [currentModelId, setCurrentModelId] = useState<number | null>(null);

  // 找到当前选中的笔记
  const currentNote = notes.find((note) => note.id === selectedNoteId);

  // 当笔记变化时，更新模型ID
  useEffect(() => {
    if (currentNote?.model_id) {
      setCurrentModelId(currentNote.model_id);
    }
  }, [currentNote?.model_id]);

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

  // 从全局设置获取工具栏状态
  const { videoVisible, autoPlay, layoutSwapped, layoutRatio } = toolbarSettings;

  // 计算实际的宽度比例
  // layoutRatio: "4:6" 或 "6:4" 决定基础比例
  // layoutSwapped: 是否交换左右位置
  const getWidths = () => {
    const isWide = layoutRatio === "6:4";
    // 视频面板的基础宽度
    const videoWidth = isWide ? "w-[60%]" : "w-[40%]";
    const noteWidth = isWide ? "w-[40%]" : "w-[60%]";
    return { videoWidth, noteWidth };
  };

  const { videoWidth, noteWidth } = getWidths();

  // 视频+聊天面板
  const videoPanel = (
    <div className={`${videoWidth} flex flex-col gap-4 flex-shrink-0`}>
      {/* 工具栏 */}
      <VideoToolbar
        currentModelId={currentModelId}
        onModelChange={setCurrentModelId}
      />

      {/* 视频播放器 */}
      {videoVisible && (
        <div className="flex-shrink-0">
          <VideoPlayer
            videoUrl={currentNote.video_path}
            subtitleUrl={currentNote.subtitle_path}
            autoPlay={autoPlay}
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
          noteTitle={currentNote.title}
          suggestedQuestions={suggestedQuestions}
        />
      </div>
    </div>
  );

  // 笔记内容面板
  const notePanel = (
    <div className={`${noteWidth} min-w-0`}>
      <NoteContentPanel note={currentNote} />
    </div>
  );

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-hidden">
      {layoutSwapped ? (
        <>
          {notePanel}
          {videoPanel}
        </>
      ) : (
        <>
          {videoPanel}
          {notePanel}
        </>
      )}
    </div>
  );
}
