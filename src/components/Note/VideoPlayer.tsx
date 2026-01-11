import { useRef, useEffect, useState, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { AlertCircle, Video, Loader2 } from "lucide-react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { PlaybackResume } from "./PlaybackResume";

// 检查是否是 TS 格式
function isTsFormat(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".ts");
}

// 视频扩展名到 MIME 类型的映射
const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  webm: "video/webm",
  flv: "video/x-flv",
  ts: "video/mp2t",
};

// 根据文件路径获取 MIME 类型
function getVideoMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return VIDEO_MIME_TYPES[ext] || "video/mp4";
}

interface VideoPlayerProps {
  videoUrl: string;
  subtitleUrl?: string | null;
  compact?: boolean;
  autoPlay?: boolean;
  noteId?: number;
  lastPlaybackPosition?: number | null;
}

export function VideoPlayer({
  videoUrl,
  subtitleUrl,
  compact = false,
  autoPlay = false,
  noteId,
  lastPlaybackPosition: initialLastPlaybackPosition,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const assRef = useRef<any>(null);
  const assVisibleRef = useRef<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [lastPlaybackPosition, setLastPlaybackPosition] = useState<number | null>(
    initialLastPlaybackPosition ?? null
  );
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [actualVideoUrl, setActualVideoUrl] = useState<string>(videoUrl);

  // 使用 ref 存储最新值，供事件处理器使用
  const lastSavedPositionRef = useRef<number>(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteIdRef = useRef<number | undefined>(noteId);
  const showResumePromptRef = useRef<boolean>(false);
  const lastPlaybackPositionRef = useRef<number | null>(lastPlaybackPosition);

  // 从数据库获取最新的播放位置
  useEffect(() => {
    if (!noteId) return;

    const fetchLatestPosition = async () => {
      try {
        const note = await invoke<{ last_playback_position: number | null } | null>("get_note", { id: noteId });
        if (note && note.last_playback_position !== null && note.last_playback_position > 0) {
          setLastPlaybackPosition(note.last_playback_position);
        }
      } catch (err) {
        console.error("Failed to fetch latest playback position:", err);
      }
    };

    fetchLatestPosition();
  }, [noteId]);

  // 保持 ref 同步
  useEffect(() => {
    noteIdRef.current = noteId;
  }, [noteId]);

  useEffect(() => {
    showResumePromptRef.current = showResumePrompt;
  }, [showResumePrompt]);

  useEffect(() => {
    lastPlaybackPositionRef.current = lastPlaybackPosition;
  }, [lastPlaybackPosition]);

  // 当视频加载完成且有播放位置时，检查是否显示恢复提示
  useEffect(() => {
    if (
      !loading &&
      videoDuration > 0 &&
      lastPlaybackPosition &&
      lastPlaybackPosition > 10 &&
      lastPlaybackPosition < videoDuration - 10
    ) {
      setShowResumePrompt(true);
    }
  }, [loading, videoDuration, lastPlaybackPosition]);

  // TS 文件转换为 MP4
  useEffect(() => {
    if (!isTsFormat(videoUrl)) {
      setActualVideoUrl(videoUrl);
      setConverting(false);
      return;
    }

    let cancelled = false;
    setConverting(true);
    setLoading(true);

    const convertVideo = async () => {
      try {
        // 检查 ffmpeg 是否可用
        const ffmpegAvailable = await invoke<boolean>("check_ffmpeg");
        if (!ffmpegAvailable) {
          throw new Error("未检测到 ffmpeg。请安装 ffmpeg 以支持 TS 视频播放。");
        }

        // 转换 TS 到 MP4
        const mp4Path = await invoke<string>("convert_ts_to_mp4", { tsPath: videoUrl });

        if (!cancelled) {
          setActualVideoUrl(mp4Path);
          setConverting(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("TS conversion error:", err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError("TS 视频转换失败：" + errorMsg);
          setConverting(false);
          setLoading(false);
        }
      }
    };

    convertVideo();

    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  // 跳转到上次播放位置
  const handleResume = useCallback(() => {
    if (playerRef.current && lastPlaybackPosition) {
      playerRef.current.currentTime = lastPlaybackPosition;
      setShowResumePrompt(false);
    }
  }, [lastPlaybackPosition]);

  // 关闭恢复提示
  const handleDismissResume = useCallback(() => {
    setShowResumePrompt(false);
  }, []);

  useEffect(() => {
    // 如果正在转换，不要初始化播放器
    if (converting) return;
    if (!containerRef.current) return;

    // 重置状态
    setError(null);
    setLoading(true);
    setShowResumePrompt(false);
    setVideoDuration(0);
    lastSavedPositionRef.current = 0;

    // 清理旧的播放器和 ASS 实例
    if (assRef.current) {
      assRef.current.destroy();
      assRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    assVisibleRef.current = true;

    // 检查视频路径是否有效
    if (!actualVideoUrl) {
      setError("视频路径为空");
      setLoading(false);
      return;
    }

    // 判断字幕类型
    const isAssSubtitle = subtitleUrl && /\.(ass|ssa)$/i.test(subtitleUrl);
    const isVttSubtitle = subtitleUrl && /\.(vtt|srt)$/i.test(subtitleUrl);
    const hasSubtitle = isAssSubtitle || isVttSubtitle;

    // 创建 video 元素
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.autoplay = autoPlay;

    // 清空容器并添加新的 video
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(video);

    // 用于追踪组件是否已卸载
    let isMounted = true;
    // 用于存储清理函数
    let cleanupPlayerEvents: (() => void) | null = null;

    // 初始化播放器的通用函数
    const initPlyr = () => {
      const player = new Plyr(video, {
        controls: compact
          ? ["play", "progress", "current-time", "mute", "fullscreen"]
          : [
              "play-large",
              "play",
              "progress",
              "current-time",
              "duration",
              "mute",
              "volume",
              "captions",
              "settings",
              "pip",
              "fullscreen",
            ],
        settings: ["captions", "quality", "speed"],
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
        captions: { active: !!hasSubtitle, language: "zh", update: true },
        keyboard: { focused: true, global: false },
        tooltips: { controls: true, seek: true },
        i18n: {
          speed: "速度",
          normal: "正常",
          quality: "画质",
          captions: "字幕",
          settings: "设置",
          pip: "画中画",
          play: "播放",
          pause: "暂停",
          mute: "静音",
          unmute: "取消静音",
          enterFullscreen: "全屏",
          exitFullscreen: "退出全屏",
          currentTime: "当前时间",
          duration: "总时长",
          volume: "音量",
          seek: "跳转",
          enableCaptions: "开启字幕",
          disableCaptions: "关闭字幕",
        },
      });
      playerRef.current = player;
      return player;
    };

    // 设置播放器事件监听
    const setupPlayerEvents = (player: Plyr) => {
      // 保存播放位置到数据库
      const savePlaybackPosition = async (position: number) => {
        const currentNoteId = noteIdRef.current;
        if (!currentNoteId || position < 1) return;
        if (Math.abs(position - lastSavedPositionRef.current) < 1) return;
        lastSavedPositionRef.current = position;
        try {
          await invoke("update_playback_position", { noteId: currentNoteId, position });
        } catch (err) {
          console.error("Failed to save playback position:", err);
        }
      };

      // 时间更新事件（防抖保存）
      const handleTimeUpdate = () => {
        const currentTime = player.currentTime;
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          savePlaybackPosition(currentTime);
        }, 5000);

        const lastPos = lastPlaybackPositionRef.current;
        if (showResumePromptRef.current && lastPos && currentTime > lastPos) {
          setShowResumePrompt(false);
        }
      };

      // 暂停时立即保存
      const handlePause = () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        savePlaybackPosition(player.currentTime);
      };

      // 视频结束时清除播放位置
      const handleEnded = async () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        const currentNoteId = noteIdRef.current;
        if (currentNoteId) {
          try {
            await invoke("update_playback_position", { noteId: currentNoteId, position: 0 });
            lastSavedPositionRef.current = 0;
          } catch (err) {
            console.error("Failed to clear playback position:", err);
          }
        }
      };

      player.on("timeupdate", handleTimeUpdate);
      player.on("pause", handlePause);
      player.on("ended", handleEnded);

      // ASS 字幕相关
      const cleanupRef = {
        captionBtn: null as Element | null,
        handler: null as (() => void) | null,
        resizeObserver: null as ResizeObserver | null,
        resizeTimeout: null as ReturnType<typeof setTimeout> | null,
        assModule: null as any,
        assContent: null as string | null,
        lastWidth: 0,
      };

      const createAssInstance = () => {
        if (!cleanupRef.assModule || !cleanupRef.assContent || !containerRef.current) return;
        const plyrContainer = containerRef.current.querySelector(".plyr");
        const videoEl = containerRef.current.querySelector("video");
        if (!plyrContainer || !videoEl) return;

        if (assRef.current) {
          assRef.current.destroy();
          assRef.current = null;
        }

        const ASS = cleanupRef.assModule.default;
        assRef.current = new ASS(cleanupRef.assContent, videoEl as HTMLVideoElement, {
          container: plyrContainer as HTMLElement,
          resampling: "video_height",
        });

        if (!assVisibleRef.current) {
          const assBox = plyrContainer.querySelector(".ASS-box") as HTMLElement;
          if (assBox) {
            assBox.style.display = "none";
          }
        }
      };

      if (isAssSubtitle && subtitleUrl) {
        Promise.all([
          import("assjs"),
          invoke<string>("read_file_content", { path: subtitleUrl }),
        ])
          .then(([assModule, assContent]) => {
            if (!isMounted || !assContent || !containerRef.current) return;

            cleanupRef.assModule = assModule;
            cleanupRef.assContent = assContent;

            const plyrContainer = containerRef.current.querySelector(".plyr");
            if (!plyrContainer) return;

            cleanupRef.lastWidth = plyrContainer.clientWidth;
            createAssInstance();

            const resizeObserver = new ResizeObserver((entries) => {
              const entry = entries[0];
              if (!entry) return;
              const newWidth = entry.contentRect.width;
              if (Math.abs(newWidth - cleanupRef.lastWidth) < 50) return;
              if (cleanupRef.resizeTimeout) {
                clearTimeout(cleanupRef.resizeTimeout);
              }
              cleanupRef.resizeTimeout = setTimeout(() => {
                if (!isMounted) return;
                cleanupRef.lastWidth = newWidth;
                createAssInstance();
              }, 350);
            });
            resizeObserver.observe(plyrContainer);
            cleanupRef.resizeObserver = resizeObserver;

            const btn = plyrContainer.querySelector('[data-plyr="captions"]');
            if (btn) {
              const handler = () => {
                assVisibleRef.current = !assVisibleRef.current;
                const assBox = plyrContainer.querySelector(".ASS-box") as HTMLElement;
                if (assBox) {
                  assBox.style.display = assVisibleRef.current ? "" : "none";
                }
              };
              cleanupRef.captionBtn = btn;
              cleanupRef.handler = handler;
              btn.addEventListener("click", handler);
            }
          })
          .catch((err) => {
            console.error("Failed to load ASS subtitle:", err);
          });
      }

      // 返回清理函数
      return () => {
        const currentTime = player.currentTime;
        const currentNoteId = noteIdRef.current;
        if (currentNoteId && currentTime > 1) {
          invoke("update_playback_position", { noteId: currentNoteId, position: currentTime }).catch((err) => {
            console.error("Failed to save playback position on unmount:", err);
          });
        }
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        if (cleanupRef.resizeTimeout) {
          clearTimeout(cleanupRef.resizeTimeout);
        }
        if (cleanupRef.resizeObserver) {
          cleanupRef.resizeObserver.disconnect();
        }
        if (cleanupRef.captionBtn && cleanupRef.handler) {
          cleanupRef.captionBtn.removeEventListener("click", cleanupRef.handler);
        }
        player.off("timeupdate", handleTimeUpdate);
        player.off("pause", handlePause);
        player.off("ended", handleEnded);
        if (assRef.current) {
          assRef.current.destroy();
          assRef.current = null;
        }
      };
    };

    // 使用标准方式加载视频（包括转换后的 MP4）
    video.crossOrigin = "anonymous";
    const videoSrc = convertFileSrc(actualVideoUrl);
    const source = document.createElement("source");
    source.src = videoSrc;
    source.type = getVideoMimeType(actualVideoUrl);
    video.appendChild(source);

    if (isVttSubtitle && subtitleUrl) {
      const track = document.createElement("track");
      track.kind = "captions";
      track.label = "中文";
      track.srclang = "zh";
      track.src = convertFileSrc(subtitleUrl);
      track.default = true;
      video.appendChild(track);
    }

    if (isAssSubtitle) {
      const track = document.createElement("track");
      track.kind = "captions";
      track.label = "中文";
      track.srclang = "zh";
      track.src = "data:text/vtt;base64,V0VCVlRUCgo=";
      track.default = true;
      video.appendChild(track);
    }

    video.addEventListener("loadedmetadata", () => {
      setLoading(false);
      setVideoDuration(video.duration);
    });

    video.addEventListener("error", () => {
      setError("无法加载视频文件，请检查文件路径是否正确");
      setLoading(false);
    });

    const player = initPlyr();
    cleanupPlayerEvents = setupPlayerEvents(player);

    return () => {
      isMounted = false;
      if (cleanupPlayerEvents) {
        cleanupPlayerEvents();
      }
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [actualVideoUrl, subtitleUrl, compact, autoPlay, converting]);

  // 错误状态
  if (error) {
    return (
      <div className={`w-full ${compact ? "h-48" : "aspect-video"} bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center`}>
        <div className="text-center p-6">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-slate-400">{error}</p>
          <p className="text-xs text-slate-500 mt-2 truncate max-w-[300px]" title={videoUrl}>
            {videoUrl}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 加载/转换状态覆盖层 */}
      {(loading || converting) && (
        <div className={`absolute inset-0 ${compact ? "h-48" : "aspect-video"} bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center z-10`}>
          <div className="text-center">
            {converting ? (
              <>
                <Loader2 className="w-12 h-12 text-blue-400 mx-auto mb-3 animate-spin" />
                <p className="text-sm text-slate-400">正在转换 TS 视频...</p>
                <p className="text-xs text-slate-500 mt-1">首次播放需要转换，之后会使用缓存</p>
              </>
            ) : (
              <>
                <Video className="w-12 h-12 text-slate-600 mx-auto mb-3 animate-pulse" />
                <p className="text-sm text-slate-500">加载视频中...</p>
              </>
            )}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className={`w-full ${compact ? "" : "aspect-video"} bg-black rounded-lg overflow-hidden plyr-container relative`}
      />
      {/* 播放位置恢复提示 */}
      {showResumePrompt && lastPlaybackPosition && (
        <PlaybackResume
          position={lastPlaybackPosition}
          onResume={handleResume}
          onDismiss={handleDismissResume}
        />
      )}
    </div>
  );
}
