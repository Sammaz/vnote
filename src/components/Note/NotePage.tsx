import { useState } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { ChatWindow } from "./ChatWindow";
import { NoteContentPanel } from "./NoteContentPanel";
import { VideoToolbar } from "./VideoToolbar";
import { useApp } from "../../context/AppContext";

export function NotePage() {
  const { notes, selectedNoteId } = useApp();

  // Toolbar state
  const [videoVisible, setVideoVisible] = useState(true);
  const [autoPlay, setAutoPlay] = useState(false);
  const [layoutSwapped, setLayoutSwapped] = useState(false);
  const [currentModelId, setCurrentModelId] = useState<number | null>(null);

  // 找到当前选中的笔记
  const currentNote = notes.find((note) => note.id === selectedNoteId);

  // 初始化当前模型ID（从笔记的model_id获取）
  useState(() => {
    if (currentNote?.model_id && currentModelId === null) {
      setCurrentModelId(currentNote.model_id);
    }
  });

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

  // 如果还没设置当前模型ID，使用笔记的model_id
  if (currentModelId === null && currentNote.model_id) {
    setCurrentModelId(currentNote.model_id);
  }

  // 解析建议问题
  const suggestedQuestions: string[] = currentNote.suggested_questions
    ? JSON.parse(currentNote.suggested_questions)
    : [];

  // 视频+聊天面板
  const videoPanel = (
    <div className={`${layoutSwapped ? "w-[60%]" : "w-[40%]"} flex flex-col gap-4 flex-shrink-0`}>
      {/* 工具栏 */}
      <VideoToolbar
        videoVisible={videoVisible}
        onToggleVideo={() => setVideoVisible(!videoVisible)}
        autoPlay={autoPlay}
        onToggleAutoPlay={() => setAutoPlay(!autoPlay)}
        layoutSwapped={layoutSwapped}
        onToggleLayout={() => setLayoutSwapped(!layoutSwapped)}
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
          noteTitle={currentNote.title}
          suggestedQuestions={suggestedQuestions}
        />
      </div>
    </div>
  );

  // 笔记内容面板
  const notePanel = (
    <div className={`${layoutSwapped ? "w-[40%]" : "w-[60%]"} min-w-0`}>
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
