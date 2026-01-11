import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";

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
    addNote,
    setUploadedVideo,
    setUploadedSubtitle,
  } = useApp();

  const canGenerate = uploadedVideo && selectedModelId && !isGenerating;

  const handleGenerate = async () => {
    if (!canGenerate || !uploadedVideo) return;

    setIsGenerating(true);

    // 模拟生成过程
    setTimeout(() => {
      // 创建笔记，标题为视频文件名（不含扩展名）
      const noteTitle = getBaseName(uploadedVideo.name);

      addNote({
        folderId: "1", // 默认放到学习笔记文件夹
        title: noteTitle,
        videoPath: uploadedVideo.path,
        subtitlePath: uploadedSubtitle?.path || null,
        thumbnailPath: null,
        content: `# ${noteTitle}\n\n正在生成笔记内容...`,
        duration: 0,
      });

      // 清空上传状态
      setUploadedVideo(null);
      setUploadedSubtitle(null);

      setIsGenerating(false);
    }, 1500);
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={!canGenerate}
      className={cn(
        "flex items-center justify-center gap-2 px-8 py-3 rounded-xl",
        "font-medium text-white transition-all duration-200",
        canGenerate
          ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 btn-glow"
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
