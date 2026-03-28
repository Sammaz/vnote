import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useUpload } from "../../context/UploadContext";

// 获取文件名（不含扩展名）
function getBaseName(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

export function GenerateButton() {
  const {
    isGenerating,
    setIsGenerating,
    selectedModelId,
    createNote,
    setCurrentView,
    setSelectedNoteId,
  } = useApp();

  const { uploadedItems, clearUploads } = useUpload();

  const itemCount = uploadedItems.length;
  const canGenerate = itemCount > 0 && selectedModelId && !isGenerating;

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setIsGenerating(true);

    try {
      let firstNoteId: string | null = null;

      for (const item of uploadedItems) {
        const noteTitle = getBaseName(item.video.name);

        const newNote = await createNote({
          title: noteTitle,
          video_path: item.video.path,
          subtitle_path: item.subtitle?.path || null,
          model_id: selectedModelId,
        });

        if (!firstNoteId) {
          firstNoteId = newNote.id;
        }
      }

      // 清空上传状态
      clearUploads();

      // 跳转到第一个笔记
      if (firstNoteId) {
        setSelectedNoteId(firstNoteId);
        setCurrentView("note");
      }
    } catch (error) {
      console.error("Failed to create notes:", error);
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
          <span>{itemCount > 1 ? `批量生成 ${itemCount} 个笔记` : "一键生成笔记"}</span>
        </>
      )}
    </button>
  );
}
