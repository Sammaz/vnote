import { useCallback, useState } from "react";
import { Upload, Video, FileText, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";

export function UploadZone() {
  const { uploadedVideo, uploadedSubtitle, setUploadedVideo, setUploadedSubtitle } = useApp();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    },
    [setUploadedVideo, setUploadedSubtitle]
  );

  const processFiles = (files: File[]) => {
    files.forEach((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();

      // 视频文件
      if (["mp4", "mkv", "avi", "mov", "webm", "flv"].includes(ext || "")) {
        setUploadedVideo(file);
      }
      // 字幕文件
      else if (["srt", "vtt", "ass", "ssa"].includes(ext || "")) {
        setUploadedSubtitle(file);
      }
    });
  };

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".mp4,.mkv,.avi,.mov,.webm,.flv,.srt,.vtt,.ass,.ssa";
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      processFiles(files);
    };
    input.click();
  };

  const hasFiles = uploadedVideo || uploadedSubtitle;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={!hasFiles ? handleFileSelect : undefined}
      className={cn(
        "upload-zone relative p-8 text-center",
        isDragOver && "drag-over",
        !hasFiles && "cursor-pointer"
      )}
    >
      {!hasFiles ? (
        <>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
              <Upload className="w-8 h-8 text-blue-400" />
            </div>
          </div>
          <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-2">
            拖拽视频和字幕文件到这里
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            支持 MP4, MKV, AVI 等视频格式 · SRT, VTT, ASS 字幕格式
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleFileSelect();
            }}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg",
              "bg-slate-100 dark:bg-vnote-hover border border-slate-200 dark:border-vnote-border",
              "text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600",
              "transition-all duration-200"
            )}
          >
            <Upload className="w-4 h-4" />
            选择文件
          </button>
        </>
      ) : (
        <div className="space-y-3">
          {/* 已上传的视频 */}
          {uploadedVideo && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-vnote-surface border border-slate-200 dark:border-vnote-border">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Video className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {uploadedVideo.name}
                </p>
                <p className="text-xs text-slate-500">
                  {(uploadedVideo.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setUploadedVideo(null);
                }}
                className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-vnote-hover text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 已上传的字幕 */}
          {uploadedSubtitle && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-vnote-surface border border-slate-200 dark:border-vnote-border">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-green-400" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {uploadedSubtitle.name}
                </p>
                <p className="text-xs text-slate-500">
                  {(uploadedSubtitle.size / 1024).toFixed(2)} KB
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setUploadedSubtitle(null);
                }}
                className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-vnote-hover text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 添加更多文件 */}
          <button
            onClick={handleFileSelect}
            className={cn(
              "w-full flex items-center justify-center gap-2 p-3 rounded-lg",
              "border border-dashed border-slate-300 dark:border-vnote-border",
              "text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-400 dark:hover:border-slate-600",
              "transition-all duration-200"
            )}
          >
            <Upload className="w-4 h-4" />
            {!uploadedVideo ? "添加视频" : !uploadedSubtitle ? "添加字幕（可选）" : "替换文件"}
          </button>
        </div>
      )}
    </div>
  );
}
