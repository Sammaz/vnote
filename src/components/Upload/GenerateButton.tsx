import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useInitTaskQueue } from "../../context/InitTaskQueueContext";

// 获取文件名（不含扩展名）
function getBaseName(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

export function GenerateButton() {
  const {
    uploadedVideo,
    uploadedSubtitle,
    isGenerating,
    setIsGenerating,
    selectedModelId,
    createNote,
    setUploadedVideo,
    setUploadedSubtitle,
    setCurrentView,
    setSelectedNoteId,
  } = useApp();

  const { submitTask } = useInitTaskQueue();

  const canGenerate = uploadedVideo && selectedModelId && !isGenerating;

  const handleGenerate = async () => {
    if (!canGenerate || !uploadedVideo) return;

    setIsGenerating(true);

    try {
      // 创建笔记，标题为视频文件名（不含扩展名）
      const noteTitle = getBaseName(uploadedVideo.name);

      const newNote = await createNote({
        title: noteTitle,
        video_path: uploadedVideo.path,
        subtitle_path: uploadedSubtitle?.path || null,
        model_id: selectedModelId,
      });

      // 立即提交到任务队列
      console.log(`[GenerateButton] 提交笔记 ${newNote.id} 到任务队列`);
      await submitTask(newNote.id);

      // 清空上传状态
      setUploadedVideo(null);
      setUploadedSubtitle(null);

      // 跳转到笔记页面
      setSelectedNoteId(newNote.id);
      setCurrentView("note");
    } catch (error) {
      console.error("Failed to create note:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={!canGenerate}
      className={cn(
        "flex items-center justify-center gap-2 px-8 py-3 rounded-xl",
        "font-medium text-white transition-all duration-200",
        canGenerate
          ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 btn-glow cursor-pointer"
          : "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"
      )}
    >
      {isGenerating ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>生成中...</span>
        </>
      ) : (
        <>
          <Sparkles className="w-5 h-5" />
          <span>一键生成笔记</span>
        </>
      )}
    </button>
  );
}
