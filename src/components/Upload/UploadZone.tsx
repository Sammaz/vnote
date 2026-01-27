import { useCallback, useEffect, useState } from "react";
import { Upload, Video, FileText, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, stat } from "@tauri-apps/plugin-fs";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import type { UploadedFile } from "../../types";

// 字幕格式优先级（越靠前优先级越高）
const SUBTITLE_PRIORITY = ["ass", "srt", "vtt", "ssa"];
const VIDEO_EXTENSIONS = ["mp4", "mkv", "avi", "mov", "webm", "flv", "ts"];
const SUBTITLE_EXTENSIONS = ["ass", "srt", "vtt", "ssa"];

// 获取文件扩展名
function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

// 获取文件名（不含扩展名）
function getBaseName(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

// 获取目录路径
function getDirectoryPath(filePath: string): string {
  // 处理 Windows 和 Unix 路径
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSep > 0 ? filePath.substring(0, lastSep) : filePath;
}

// 获取文件名
function getFileName(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSep >= 0 ? filePath.substring(lastSep + 1) : filePath;
}

export function UploadZone() {
  const { uploadedVideo, uploadedSubtitle, setUploadedVideo, setUploadedSubtitle } = useApp();
  const [isDragOver, setIsDragOver] = useState(false);
  const isTauri =
    typeof window !== "undefined" &&
    Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  // 自动查找同名字幕文件
  const findMatchingSubtitle = useCallback(async (videoPath: string): Promise<UploadedFile | null> => {
    try {
      const dirPath = getDirectoryPath(videoPath);
      const videoFileName = getFileName(videoPath);
      const videoBaseName = getBaseName(videoFileName);

      // 读取目录
      const entries = await readDir(dirPath);

      // 查找同名字幕文件
      const subtitleCandidates: { path: string; name: string; priority: number }[] = [];

      for (const entry of entries) {
        if (entry.isFile && entry.name) {
          const ext = getExtension(entry.name);
          const baseName = getBaseName(entry.name);

          // 检查是否是字幕文件且文件名匹配
          if (SUBTITLE_EXTENSIONS.includes(ext) && baseName === videoBaseName) {
            const priority = SUBTITLE_PRIORITY.indexOf(ext);
            subtitleCandidates.push({
              path: `${dirPath}/${entry.name}`,
              name: entry.name,
              priority: priority >= 0 ? priority : SUBTITLE_PRIORITY.length,
            });
          }
        }
      }

      // 按优先级排序，选择最高优先级的字幕
      if (subtitleCandidates.length > 0) {
        subtitleCandidates.sort((a, b) => a.priority - b.priority);
        const bestMatch = subtitleCandidates[0];

        // 获取文件大小
        const fileInfo = await stat(bestMatch.path);

        return {
          name: bestMatch.name,
          path: bestMatch.path,
          size: fileInfo.size,
          type: "subtitle",
        };
      }

      return null;
    } catch (error) {
      console.error("查找字幕文件失败:", error);
      return null;
    }
  }, []);

  // 处理选择视频文件
  const handleSelectVideo = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: "视频文件",
          extensions: VIDEO_EXTENSIONS,
        }],
      });

      if (selected) {
        const filePath = selected as string;
        const fileName = getFileName(filePath);
        const fileInfo = await stat(filePath);

        const videoFile: UploadedFile = {
          name: fileName,
          path: filePath,
          size: fileInfo.size,
          type: "video",
        };

        setUploadedVideo(videoFile);

        // 自动查找字幕文件
        const matchingSubtitle = await findMatchingSubtitle(filePath);
        if (matchingSubtitle) {
          setUploadedSubtitle(matchingSubtitle);
        }
      }
    } catch (error) {
      console.error("选择视频文件失败:", error);
    }
  }, [setUploadedVideo, setUploadedSubtitle, findMatchingSubtitle]);

  // 处理选择字幕文件
  const handleSelectSubtitle = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: "字幕文件",
          extensions: SUBTITLE_EXTENSIONS,
        }],
      });

      if (selected) {
        const filePath = selected as string;
        const fileName = getFileName(filePath);
        const fileInfo = await stat(filePath);

        setUploadedSubtitle({
          name: fileName,
          path: filePath,
          size: fileInfo.size,
          type: "subtitle",
        });
      }
    } catch (error) {
      console.error("选择字幕文件失败:", error);
    }
  }, [setUploadedSubtitle]);

  const handleDroppedPaths = useCallback(
    async (paths: string[]) => {
      for (const filePath of paths) {
        const fileName = getFileName(filePath);
        const ext = getExtension(fileName);

        if (VIDEO_EXTENSIONS.includes(ext)) {
          try {
            const fileInfo = await stat(filePath);
            const videoFile: UploadedFile = {
              name: fileName,
              path: filePath,
              size: fileInfo.size,
              type: "video",
            };

            setUploadedVideo(videoFile);

            const matchingSubtitle = await findMatchingSubtitle(filePath);
            if (matchingSubtitle) {
              setUploadedSubtitle(matchingSubtitle);
            }
          } catch (error) {
            console.error("读取拖拽视频文件失败:", error);
          }
        } else if (SUBTITLE_EXTENSIONS.includes(ext)) {
          try {
            const fileInfo = await stat(filePath);
            setUploadedSubtitle({
              name: fileName,
              path: filePath,
              size: fileInfo.size,
              type: "subtitle",
            });
          } catch (error) {
            console.error("读取拖拽字幕文件失败:", error);
          }
        }
      }
    },
    [findMatchingSubtitle, setUploadedSubtitle, setUploadedVideo]
  );

  useEffect(() => {
    if (!isTauri) return undefined;
    let unlisten: (() => void) | null = null;

    const windowHandle = getCurrentWindow() as unknown as {
      onFileDropEvent?: (
        handler: (event: { payload?: unknown }) => void
      ) => Promise<() => void>;
      onDragDropEvent?: (
        handler: (event: { payload?: unknown }) => void
      ) => Promise<() => void>;
    };

    const subscribe =
      windowHandle.onFileDropEvent?.bind(windowHandle) ??
      windowHandle.onDragDropEvent?.bind(windowHandle);
    if (!subscribe) {
      console.warn("当前 Tauri 版本不支持文件拖拽事件 API");
      return undefined;
    }

    subscribe((event) => {
      const payload = event.payload as {
        type?: string;
        paths?: string[];
      };
      const eventType = payload.type?.toLowerCase();

      if (eventType === "hover" || eventType === "over" || eventType === "enter") {
        setIsDragOver(true);
        return;
      }

      if (eventType === "cancel" || eventType === "leave") {
        setIsDragOver(false);
        return;
      }

      if (eventType === "drop") {
        setIsDragOver(false);
        if (payload.paths && payload.paths.length > 0) {
          void handleDroppedPaths(payload.paths);
        }
      }
    })
      .then((unlistenFn) => {
        unlisten = unlistenFn;
      })
      .catch((error) => {
        console.warn("注册文件拖拽事件失败:", error);
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleDroppedPaths, isTauri]);


  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);

      if (isTauri) {
        const hasPath = files.some((file) => Boolean((file as File & { path?: string }).path));
        if (!hasPath) {
          return;
        }
      }

      for (const file of files) {
        const ext = getExtension(file.name);

        // 视频文件
        if (VIDEO_EXTENSIONS.includes(ext)) {
          // 注意：拖放的文件没有完整路径，只能使用 File 对象的基本信息
          // 在 Tauri 中拖放文件会有特殊处理
          const filePath = (file as File & { path?: string }).path || file.name;

          const videoFile: UploadedFile = {
            name: file.name,
            path: filePath,
            size: file.size,
            type: "video",
          };
          setUploadedVideo(videoFile);

          // 如果有完整路径，尝试自动查找字幕
          if (filePath !== file.name) {
            const matchingSubtitle = await findMatchingSubtitle(filePath);
            if (matchingSubtitle) {
              setUploadedSubtitle(matchingSubtitle);
            }
          }
        }
        // 字幕文件
        else if (SUBTITLE_EXTENSIONS.includes(ext)) {
          const filePath = (file as File & { path?: string }).path || file.name;

          setUploadedSubtitle({
            name: file.name,
            path: filePath,
            size: file.size,
            type: "subtitle",
          });
        }
      }
    },
    [findMatchingSubtitle, isTauri, setUploadedSubtitle, setUploadedVideo]
  );

  const hasFiles = uploadedVideo || uploadedSubtitle;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={!hasFiles ? handleSelectVideo : undefined}
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
            支持 MP4, MKV, AVI, TS 等视频格式 · SRT, VTT, ASS 字幕格式
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSelectVideo();
            }}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg",
              "bg-slate-100 dark:bg-vnote-hover border border-slate-200 dark:border-vnote-border",
              "text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600",
              "transition-all duration-200 cursor-pointer"
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
                className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-vnote-hover text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
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
                className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-vnote-hover text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 添加更多文件 */}
          <button
            onClick={!uploadedVideo ? handleSelectVideo : handleSelectSubtitle}
            className={cn(
              "w-full flex items-center justify-center gap-2 p-3 rounded-lg",
              "border border-dashed border-slate-300 dark:border-vnote-border",
              "text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-400 dark:hover:border-slate-600",
              "transition-all duration-200 cursor-pointer"
            )}
          >
            <Upload className="w-4 h-4" />
            {!uploadedVideo ? "添加视频" : !uploadedSubtitle ? "添加字幕（可选）" : "替换字幕"}
          </button>
        </div>
      )}
    </div>
  );
}
