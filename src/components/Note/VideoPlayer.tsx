import { useRef, useEffect, useState, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { AlertCircle, Video, Loader2 } from "lucide-react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { PlaybackResume } from "./PlaybackResume";
import { useApp } from "../../context/AppContext";

// 观看时长追踪间隔（秒）
const WATCH_TIME_INTERVAL = 10;

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

// 将 SRT 内容转换为 WebVTT
function convertSrtToVtt(content: string): string {
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const lines = normalized.split("\n");
  const output: string[] = ["WEBVTT", ""];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      continue;
    }

    if (line.includes("-->")) {
      output.push(
        line.replace(/(\d{2}:\d{2}:\d{2})[,.](\d{3})/g, "$1.$2")
      );
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
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
  const { toolbarSettings, setCaptionsEnabled, addWatchTime } = useApp();
  const { captionsEnabled } = toolbarSettings;
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const assRef = useRef<any>(null);
  const assVisibleRef = useRef<boolean>(captionsEnabled);
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
  const watchTimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addWatchTimeRef = useRef(addWatchTime);

  // 保持 addWatchTime ref 同步
  useEffect(() => {
    addWatchTimeRef.current = addWatchTime;
  }, [addWatchTime]);

  // 从数据库获取最新的播放位置
  useEffect(() => {
    if (!noteId) return;

    const fetchLatestPosition = async () => {
      try {
        const note = await invoke<{ last_playback_position: number | null } | null>("get_note", { id: noteId });
        if (note) {
          // 无论如何都要更新 state，确保切换笔记时重置播放位置
          setLastPlaybackPosition(
            note.last_playback_position !== null && note.last_playback_position > 0
              ? note.last_playback_position
              : null
          );
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
        const mp4Path = await invoke<string>("convert_ts_to_mp4", {
          tsPath: videoUrl,
          noteId: noteId
        });

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
    const isSrtSubtitle = subtitleUrl && /\.srt$/i.test(subtitleUrl);
    const isVttSubtitle = subtitleUrl && /\.(vtt|webvtt)$/i.test(subtitleUrl);
    const hasSubtitle = isAssSubtitle || isSrtSubtitle || isVttSubtitle;

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
        captions: { active: captionsEnabled && !!hasSubtitle, language: "zh", update: true },
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

      // 观看时长追踪
      const startWatchTimeTracking = () => {
        if (watchTimeIntervalRef.current) return;
        watchTimeIntervalRef.current = setInterval(() => {
          if (player.playing) {
            addWatchTimeRef.current(WATCH_TIME_INTERVAL);
          }
        }, WATCH_TIME_INTERVAL * 1000);
      };

      const stopWatchTimeTracking = () => {
        if (watchTimeIntervalRef.current) {
          clearInterval(watchTimeIntervalRef.current);
          watchTimeIntervalRef.current = null;
        }
      };

      // 播放时开始追踪
      const handlePlay = () => {
        startWatchTimeTracking();
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

        // 发送视频时间更新事件，供其他组件使用
        window.dispatchEvent(new CustomEvent("video-time-update", {
          detail: { time: currentTime }
        }));
      };

      // 暂停时立即保存并停止追踪
      const handlePause = () => {
        stopWatchTimeTracking();
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        savePlaybackPosition(player.currentTime);
      };

      // 视频结束时清除播放位置并停止追踪
      const handleEnded = async () => {
        stopWatchTimeTracking();
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

      player.on("play", handlePlay);
      player.on("timeupdate", handleTimeUpdate);
      player.on("pause", handlePause);
      player.on("ended", handleEnded);

      // ASS 字幕相关清理函数
      const cleanupRef = {
        assHandler: null as (() => void) | null,
        srtHandler: null as (() => void) | null,
        seekVideoHandler: null as (() => void) | null,
      };

      // 监听字幕状态变化（适用于所有字幕类型）
      const handleCaptionsChange = () => {
        // 延迟执行以等待 Plyr 内部状态更新
        setTimeout(() => {
          // currentTrack: -1 表示无字幕，0+ 表示有字幕选中
          const isCaptionsActive = player.currentTrack >= 0;
          setCaptionsEnabled(isCaptionsActive);
          assVisibleRef.current = isCaptionsActive;

          // 如果是 ASS 字幕，同步更新 ASS 显示状态
          if (isAssSubtitle) {
            if (assRef.current) {
              if (isCaptionsActive) {
                assRef.current.show();
              } else {
                assRef.current.hide();
              }
            }
            const assBox = containerRef.current?.querySelector(".ASS-box") as HTMLElement;
            if (assBox) {
              assBox.style.visibility = isCaptionsActive ? "visible" : "hidden";
            }
          }
        }, 50);
      };

      // 监听字幕按钮点击和语言切换
      // 使用多种方式确保捕获字幕状态变化
      player.on("languagechange", handleCaptionsChange);

      // 监听字幕按钮点击
      const captionBtn = (player.elements as any).buttons?.captions;
      if (captionBtn) {
        const clickHandler = () => {
          setTimeout(() => {
            handleCaptionsChange();
          }, 100);
        };
        captionBtn.addEventListener("click", clickHandler);
        cleanupRef.srtHandler = clickHandler;
      }

      if (isAssSubtitle && subtitleUrl) {
        // 捕获当前的字幕状态，避免闭包问题
        const shouldShowCaptions = captionsEnabled;
        
        Promise.all([
          import("assjs"),
          invoke<string>("read_file_content", { path: subtitleUrl }),
        ])
          .then(([assModule, assContent]) => {
            if (!isMounted || !assContent || !containerRef.current) return;

            const plyrContainer = containerRef.current.querySelector(".plyr");
            const videoWrapper = containerRef.current.querySelector(".plyr__video-wrapper") || plyrContainer;
            if (!videoWrapper) return;

            const videoEl = containerRef.current.querySelector("video") as HTMLVideoElement;
            if (!videoEl) return;

            // 销毁旧实例（如果存在）
            if (assRef.current) {
              assRef.current.destroy();
              assRef.current = null;
            }

            // 创建 ASS 实例
            const ASS = assModule.default;
            assRef.current = new ASS(assContent, videoEl, {
              container: videoWrapper as HTMLElement,
            });

            // 监听容器尺寸变化，手动触发 assjs resize
            // assjs 的 ResizeObserver 监听的是 video 元素，但 video 的 clientWidth
            // 可能不会随容器变化而立即更新，导致字幕位置计算错误
            const resizeState = { timeout: null as ReturnType<typeof setTimeout> | null };
            const triggerAssResize = () => {
              if (assRef.current) {
                // 通过切换 resampling 属性来触发内部 resize
                const current = assRef.current.resampling;
                assRef.current.resampling = current === "video_height" ? "video_width" : "video_height";
                assRef.current.resampling = current;
              }
            };
            const resizeObserver = new ResizeObserver(() => {
              // 立即触发一次
              triggerAssResize();
              // 清除之前的延迟触发
              if (resizeState.timeout) {
                clearTimeout(resizeState.timeout);
              }
              // 延迟再触发一次，确保 video 元素尺寸已更新
              resizeState.timeout = setTimeout(() => {
                triggerAssResize();
                // 再延迟一次，处理某些浏览器的异步渲染
                resizeState.timeout = setTimeout(triggerAssResize, 100);
              }, 50);
            });
            resizeObserver.observe(containerRef.current);
            // 同时监听 video 元素，双重保障
            resizeObserver.observe(videoEl);

            // 保存 observer 和 state 引用以便清理
            (cleanupRef as any).assResizeObserver = resizeObserver;
            (cleanupRef as any).assResizeState = resizeState;

            // 根据字幕状态设置显示/隐藏
            // ASS 实例创建后，DOM 元素可能还没完全渲染，需要多次延迟设置
            const setAssVisibility = (visible: boolean) => {
              if (assRef.current) {
                if (visible) {
                  assRef.current.show();
                } else {
                  assRef.current.hide();
                }
              }
              const assBox = videoWrapper.querySelector(".ASS-box") as HTMLElement;
              if (assBox) {
                assBox.style.visibility = visible ? "visible" : "hidden";
              }
            };

            setAssVisibility(shouldShowCaptions);
            setTimeout(() => setAssVisibility(shouldShowCaptions), 0);
            setTimeout(() => setAssVisibility(shouldShowCaptions), 50);
            setTimeout(() => setAssVisibility(shouldShowCaptions), 100);
            
            assVisibleRef.current = shouldShowCaptions;
          })
          .catch((err) => {
            console.error("Failed to load ASS subtitle:", err);
          });
      }

      // 监听章节点击跳转事件
      const handleSeekVideo = ((event: Event) => {
        const customEvent = event as CustomEvent<{ time: number }>;
        const seekTime = customEvent.detail.time;
        if (player && typeof seekTime === "number") {
          player.currentTime = seekTime;
          // 立即发送时间更新事件，确保章节卡片状态同步
          window.dispatchEvent(new CustomEvent("video-time-update", {
            detail: { time: seekTime }
          }));
          // 可选：跳转后自动播放
          // player.play();
        }
      }) as () => void;
      window.addEventListener("seek-video", handleSeekVideo);
      cleanupRef.seekVideoHandler = handleSeekVideo;

      // 返回清理函数
      return () => {
        // 停止观看时长追踪
        stopWatchTimeTracking();
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
        // 移除字幕状态变化监听器
        player.off("languagechange", handleCaptionsChange);
        const captionBtn = (player.elements as any).buttons?.captions;
        if (captionBtn && cleanupRef.srtHandler) {
          captionBtn.removeEventListener("click", cleanupRef.srtHandler);
        }
        player.off("play", handlePlay);
        player.off("timeupdate", handleTimeUpdate);
        player.off("pause", handlePause);
        player.off("ended", handleEnded);
        // 移除章节跳转事件监听器
        if (cleanupRef.seekVideoHandler) {
          window.removeEventListener("seek-video", cleanupRef.seekVideoHandler);
        }
        // 清理 ASS 字幕相关资源
        if ((cleanupRef as any).assResizeState?.timeout) {
          clearTimeout((cleanupRef as any).assResizeState.timeout);
        }
        if ((cleanupRef as any).assResizeObserver) {
          (cleanupRef as any).assResizeObserver.disconnect();
        }
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

    let subtitleObjectUrl: string | null = null;

    const setupPlayer = async () => {
      if (isSrtSubtitle && subtitleUrl) {
        try {
          const srtContent = await invoke<string>("read_file_content", { path: subtitleUrl });
          if (!isMounted) return;
          const vttContent = convertSrtToVtt(srtContent);
          subtitleObjectUrl = URL.createObjectURL(
            new Blob([vttContent], { type: "text/vtt" })
          );
          const track = document.createElement("track");
          track.kind = "captions";
          track.label = "中文";
          track.srclang = "zh";
          track.src = subtitleObjectUrl;
          // 根据全局字幕状态设置 default
          track.default = captionsEnabled;
          video.appendChild(track);
        } catch (err) {
          console.error("Failed to load SRT subtitle:", err);
        }
      }

      if (isVttSubtitle && subtitleUrl) {
        const track = document.createElement("track");
        track.kind = "captions";
        track.label = "中文";
        track.srclang = "zh";
        track.src = convertFileSrc(subtitleUrl);
        // 根据全局字幕状态设置 default
        track.default = captionsEnabled;
        video.appendChild(track);
      }

      if (isAssSubtitle) {
        const track = document.createElement("track");
        track.kind = "captions";
        track.label = "中文";
        track.srclang = "zh";
        track.src = "data:text/vtt;base64,V0VCVlRUCgo=";
        // ASS 字幕也根据全局状态设置
        track.default = captionsEnabled;
        video.appendChild(track);
      }

      if (!isMounted) return;
      const player = initPlyr();
      cleanupPlayerEvents = setupPlayerEvents(player);
    };

    video.addEventListener("loadedmetadata", () => {
      setLoading(false);
      setVideoDuration(video.duration);
    });

    video.addEventListener("error", () => {
      setError("无法加载视频文件，请检查文件路径是否正确");
      setLoading(false);
    });

    setupPlayer();

    return () => {
      isMounted = false;
      if (subtitleObjectUrl) {
        URL.revokeObjectURL(subtitleObjectUrl);
      }
      if (cleanupPlayerEvents) {
        cleanupPlayerEvents();
      }
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [actualVideoUrl, subtitleUrl, compact, autoPlay, converting, setCaptionsEnabled]);

  // 当字幕状态变化时，更新播放器的字幕显示状态
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    // 更新 SRT/VTT 字幕状态
    const textTracks = (containerRef.current?.querySelector("video") as HTMLVideoElement)?.textTracks;
    if (textTracks && textTracks.length > 0) {
      for (let i = 0; i < textTracks.length; i++) {
        textTracks[i].mode = captionsEnabled ? "showing" : "hidden";
      }
    }

    // 更新 ASS 字幕状态
    if (assRef.current) {
      if (captionsEnabled) {
        assRef.current.show();
      } else {
        assRef.current.hide();
      }
    }
    const assBox = containerRef.current?.querySelector(".ASS-box") as HTMLElement;
    if (assBox) {
      assBox.style.visibility = captionsEnabled ? "visible" : "hidden";
    }
    assVisibleRef.current = captionsEnabled;
  }, [captionsEnabled]);

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
