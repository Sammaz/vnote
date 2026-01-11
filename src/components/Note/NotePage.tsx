import { VideoPlayer } from "./VideoPlayer";
import { ChatWindow } from "./ChatWindow";
import { NoteContentPanel } from "./NoteContentPanel";
import { useApp } from "../../context/AppContext";

export function NotePage() {
  const { notes, selectedNoteId } = useApp();

  // 找到当前选中的笔记
  const currentNote = notes.find((note) => note.id === selectedNoteId);

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

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-hidden">
      {/* 左侧面板 - 视频 + 聊天 */}
      <div className="w-[480px] flex flex-col gap-4 flex-shrink-0">
        {/* 视频播放器 */}
        <div className="flex-shrink-0">
          <VideoPlayer
            videoUrl={currentNote.videoPath}
            subtitleUrl={currentNote.subtitlePath}
          />

          {/* 视频信息 */}
          <div className="mt-3 px-1">
            <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 line-clamp-2">
              {currentNote.title}
            </h1>
          </div>
        </div>

        {/* 聊天窗口 */}
        <div className="flex-1 min-h-0">
          <ChatWindow noteTitle={currentNote.title} />
        </div>
      </div>

      {/* 右侧面板 - 笔记内容标签页 */}
      <div className="flex-1 min-w-0">
        <NoteContentPanel
          noteTitle={currentNote.title}
          noteContent={currentNote.content}
        />
      </div>
    </div>
  );
}
