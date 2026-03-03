/**
 * VideoPlayer - 视频播放器组件
 * 重构后的模块化版本
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { AlertCircle, Video, Loader2 } from "lucide-react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { PlaybackResume } from "../PlaybackResume";
import { useApp } from "../../../context/AppContext";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";

// 导入拆分的模块
import {
  WATCH_TIME_INTERVAL,
  RESUME_THRESHOLD_START,
  RESUME_THRESHOLD_END,
  PLYR_I18N,
} from "./constants";
import {
  convertSrtToVtt,
  preprocessAssForBilingual,
  isTsFormat,
  getSubtitleType,
} from "./subtitleUtils";
import { getVideoMimeType, toStreamUrl } from "./videoUtils";

export interface VideoPlayerProps {
  videoUrl: string;
  subtitleUrl?: string | null;
  compact?: boolean;
  autoPlay?: boolean;
  noteId?: string;
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
  const [showHelp, setShowHelp] = useState(false);

  // 使用 ref 存储最新值，供事件处理器使用
  const lastSavedPositionRef = useRef<number>(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteIdRef = useRef<string | undefined>(noteId);
  const showResumePromptRef = useRef<boolean>(false);
  const lastPlaybackPositionRef = useRef<number | null>(lastPlaybackPosition);
  const watchTimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addWatchTimeRef = useRef(addWatchTime);

  // 保持 addWatchTime ref 同步
  useEffect(() => {
    addWatchTimeRef.current = addWatchTime;
  }, [addWatchTime]);

  // 保持 assVisibleRef 与 captionsEnabled 同步
  useEffect(() => {
    assVisibleRef.current = captionsEnabled;
  }, [captionsEnabled]);

  // 从数据库获取最新的播放位置
  useEffect(() => {
    if (!noteId) return;

    const fetchLatestPosition = async () => {
      try {
        const note = await invoke<{ last_playback_position: number | null } | null>("get_note", { id: noteId });
        if (note) {
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
      lastPlaybackPosition > RESUME_THRESHOLD_START &&
      lastPlaybackPosition < videoDuration - RESUME_THRESHOLD_END
    ) {
      setShowResumePrompt(true);
    }
  }, [loading, videoDuration, lastPlaybackPosition]);

  // TS 文件转换为 MP4 (使用事件驱动模式避免 GUI 卡顿)
  useEffect(() => {
    if (!isTsFormat(videoUrl)) {
      setActualVideoUrl(videoUrl);
      setConverting(false);
      return;
    }

    let cancelled = false;
    setConverting(true);
    setLoading(true);

    // 监听转换完成事件
    let unlisten: (() => void) | null = null;

    // 使用 requestAnimationFrame 确保 UI 先渲染，再启动后台任务
    requestAnimationFrame(() => {
      if (cancelled) return;

      import("@tauri-apps/api/event").then(({ listen }) => {
        if (cancelled) return;

        listen<{ note_id: string; success: boolean; mp4_path: string | null; error: string | null }>(
          "ts-conversion-complete",
          (event) => {
            // 只处理当前 noteId 的转换结果
            if (event.payload.note_id === noteId && !cancelled) {
              if (event.payload.success && event.payload.mp4_path) {
                setActualVideoUrl(event.payload.mp4_path);
                setConverting(false);
              } else {
                setError("TS 视频转换失败：" + (event.payload.error || "未知错误"));
                setConverting(false);
                setLoading(false);
              }
            }
          }
        ).then((unlistenFn) => {
          unlisten = unlistenFn;
        });

        // 启动转换（完全非阻塞，ffmpeg 检查在后端进行）
        invoke("start_ts_conversion", {
          tsPath: videoUrl,
          noteId: noteId
        });
      });
    });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [videoUrl, noteId]);

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

  // 监听 H 键显示/隐藏快捷键帮助
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // 忽略输入框等可编辑元素
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      // 按 H 键切换帮助面板
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        setShowHelp(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // 主要的播放器初始化 effect
  useEffect(() => {
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
    assVisibleRef.current = captionsEnabled;

    if (!actualVideoUrl) {
      setError("视频路径为空");
      setLoading(false);
      return;
    }

    // 判断字幕类型
    const { isAss: isAssSubtitle, isSrt: isSrtSubtitle, isVtt: isVttSubtitle, hasSubtitle } = getSubtitleType(subtitleUrl);

    // 创建 video 元素
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.autoplay = autoPlay;

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(video);

    let isMounted = true;
    let cleanupPlayerEvents: (() => void) | null = null;

    // 初始化播放器
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
        keyboard: { focused: true, global: true },
        tooltips: { controls: true, seek: true },
        i18n: PLYR_I18N,
      });
      playerRef.current = player;
      return player;
    };

    // 设置播放器事件监听
    const setupPlayerEvents = (player: Plyr) => {
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

      const handlePlay = () => startWatchTimeTracking();

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

        window.dispatchEvent(new CustomEvent("video-time-update", {
          detail: { time: currentTime }
        }));
      };

      const handlePause = () => {
        stopWatchTimeTracking();
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        savePlaybackPosition(player.currentTime);
      };

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

      const cleanupRef = {
        srtHandler: null as (() => void) | null,
        seekVideoHandler: null as (() => void) | null,
        assResizeObserver: null as ResizeObserver | null,
        assResizeState: null as { timeout: ReturnType<typeof setTimeout> | null } | null,
      };

      const handleCaptionsChange = () => {
        setTimeout(() => {
          const isCaptionsActive = player.currentTrack >= 0;
          setCaptionsEnabled(isCaptionsActive);
          assVisibleRef.current = isCaptionsActive;

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

      player.on("languagechange", handleCaptionsChange);
      player.on("captionsenabled", handleCaptionsChange);
      player.on("captionsdisabled", handleCaptionsChange);

      const captionBtn = (player.elements as any).buttons?.captions;
      if (captionBtn) {
        const clickHandler = () => {
          setTimeout(() => handleCaptionsChange(), 100);
        };
        captionBtn.addEventListener("click", clickHandler);
        cleanupRef.srtHandler = clickHandler;
      }

      if (isAssSubtitle && subtitleUrl) {
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

            if (assRef.current) {
              assRef.current.destroy();
              assRef.current = null;
            }

            const processedContent = preprocessAssForBilingual(assContent);
            const ASS = assModule.default;
            assRef.current = new ASS(processedContent, videoEl, {
              container: videoWrapper as HTMLElement,
            });

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

            const resizeState = { timeout: null as ReturnType<typeof setTimeout> | null };
            const triggerAssResize = () => {
              if (assRef.current) {
                const current = assRef.current.resampling;
                assRef.current.resampling = current === "video_height" ? "video_width" : "video_height";
                assRef.current.resampling = current;
                // 重新应用字幕可见性状态，防止 resize 后字幕状态被重置
                setAssVisibility(assVisibleRef.current);
              }
            };
            const resizeObserver = new ResizeObserver(() => {
              triggerAssResize();
              if (resizeState.timeout) {
                clearTimeout(resizeState.timeout);
              }
              resizeState.timeout = setTimeout(() => {
                triggerAssResize();
                resizeState.timeout = setTimeout(triggerAssResize, 100);
              }, 50);
            });
            resizeObserver.observe(containerRef.current);
            resizeObserver.observe(videoEl);

            cleanupRef.assResizeObserver = resizeObserver;
            cleanupRef.assResizeState = resizeState;

            // 使用当前的 captionsEnabled 状态，而不是 ref
            // 因为此时设置应该已经从数据库加载完成
            const shouldShow = assVisibleRef.current;
            setAssVisibility(shouldShow);
            setTimeout(() => setAssVisibility(shouldShow), 0);
            setTimeout(() => setAssVisibility(shouldShow), 50);
            setTimeout(() => setAssVisibility(shouldShow), 100);
            setTimeout(() => setAssVisibility(shouldShow), 200);
            setTimeout(() => setAssVisibility(shouldShow), 500);
          })
          .catch((err) => {
            console.error("Failed to load ASS subtitle:", err);
          });
      }

      const handleSeekVideo = ((event: Event) => {
        const customEvent = event as CustomEvent<{ time: number }>;
        const seekTime = customEvent.detail.time;
        if (player && typeof seekTime === "number") {
          player.currentTime = seekTime;
          window.dispatchEvent(new CustomEvent("video-time-update", {
            detail: { time: seekTime }
          }));
        }
      }) as () => void;
      window.addEventListener("seek-video", handleSeekVideo);
      cleanupRef.seekVideoHandler = handleSeekVideo;

      return () => {
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
        player.off("languagechange", handleCaptionsChange);
        player.off("captionsenabled", handleCaptionsChange);
        player.off("captionsdisabled", handleCaptionsChange);
        const captionBtn = (player.elements as any).buttons?.captions;
        if (captionBtn && cleanupRef.srtHandler) {
          captionBtn.removeEventListener("click", cleanupRef.srtHandler);
        }
        player.off("play", handlePlay);
        player.off("timeupdate", handleTimeUpdate);
        player.off("pause", handlePause);
        player.off("ended", handleEnded);
        if (cleanupRef.seekVideoHandler) {
          window.removeEventListener("seek-video", cleanupRef.seekVideoHandler);
        }
        if (cleanupRef.assResizeState?.timeout) {
          clearTimeout(cleanupRef.assResizeState.timeout);
        }
        if (cleanupRef.assResizeObserver) {
          cleanupRef.assResizeObserver.disconnect();
        }
        if (assRef.current) {
          assRef.current.destroy();
          assRef.current = null;
        }
      };
    };

    video.crossOrigin = "anonymous";
    const videoSrc = toStreamUrl(actualVideoUrl);
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
        track.default = captionsEnabled;
        video.appendChild(track);
      }

      if (isAssSubtitle) {
        const track = document.createElement("track");
        track.kind = "captions";
        track.label = "中文";
        track.srclang = "zh";
        track.src = "data:text/vtt;base64,V0VCVlRUCgo=";
        track.default = captionsEnabled;
        video.appendChild(track);
      }

      if (!isMounted) return;
      const player = initPlyr();
      cleanupPlayerEvents = setupPlayerEvents(player);
    };

    const handleLoadedMetadata = () => {
      if (!isMounted) return;
      setLoading(false);
      setVideoDuration(video.duration);
    };

    const handleVideoError = () => {
      if (!isMounted) return;
      setError("无法加载视频文件，请检查文件路径是否正确");
      setLoading(false);
    };

    // Stall recovery mechanism
    let stallRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
    let stallRetryCount = 0;

    const attemptStallRecovery = () => {
      if (video.paused || video.ended) return;
      stallRetryCount++;
      if (stallRetryCount > 3) {
        // After 3 retries, nudge currentTime to force a re-fetch (simulates manual seek)
        video.currentTime = video.currentTime + 0.01;
        stallRetryCount = 0;
      } else {
        video.play().catch(() => {});
      }
    };

    const handleStalled = () => {
      if (video.paused || video.ended) return;
      if (stallRecoveryTimer) clearTimeout(stallRecoveryTimer);
      stallRecoveryTimer = setTimeout(attemptStallRecovery, 2000);
    };

    const handleWaiting = () => {
      if (video.paused || video.ended) return;
      if (stallRecoveryTimer) clearTimeout(stallRecoveryTimer);
      stallRecoveryTimer = setTimeout(attemptStallRecovery, 1500);
    };

    const handlePlaying = () => {
      if (stallRecoveryTimer) {
        clearTimeout(stallRecoveryTimer);
        stallRecoveryTimer = null;
      }
      stallRetryCount = 0;
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleVideoError);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);

    setupPlayer();

    return () => {
      isMounted = false;
      if (stallRecoveryTimer) clearTimeout(stallRecoveryTimer);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleVideoError);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
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

    const textTracks = (containerRef.current?.querySelector("video") as HTMLVideoElement)?.textTracks;
    if (textTracks && textTracks.length > 0) {
      for (let i = 0; i < textTracks.length; i++) {
        textTracks[i].mode = captionsEnabled ? "showing" : "hidden";
      }
    }

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

  // 当帮助框打开/关闭时，切换播放器快捷键的启用状态
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    // 帮助框打开时禁用播放器快捷键，关闭时启用
    // 使用类型断言访问 Plyr 内部 config 属性
    const playerWithConfig = player as any;
    if (playerWithConfig.config && playerWithConfig.config.keyboard) {
      playerWithConfig.config.keyboard.global = !showHelp;
    }
  }, [showHelp]);

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
      {/* 快捷键帮助 */}
      {showHelp && (
        <KeyboardShortcutsHelp onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}
