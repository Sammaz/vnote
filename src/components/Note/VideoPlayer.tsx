import { useRef, useEffect } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Plyr from "plyr";
import "plyr/dist/plyr.css";

interface VideoPlayerProps {
  videoUrl: string;
  subtitleUrl?: string | null;
  compact?: boolean;
}

export function VideoPlayer({ videoUrl, subtitleUrl, compact = false }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const assRef = useRef<any>(null);
  const assVisibleRef = useRef<boolean>(true);

  useEffect(() => {
    if (!containerRef.current) return;

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

    // 创建新的 video 元素
    const videoSrc = convertFileSrc(videoUrl);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    const source = document.createElement("source");
    source.src = videoSrc;
    source.type = "video/mp4";
    video.appendChild(source);

    // 判断字幕类型
    const isAssSubtitle = subtitleUrl && /\.(ass|ssa)$/i.test(subtitleUrl);
    const isVttSubtitle = subtitleUrl && /\.(vtt|srt)$/i.test(subtitleUrl);
    const hasSubtitle = isAssSubtitle || isVttSubtitle;

    // 如果是 VTT/SRT 字幕，添加 track 元素
    if (isVttSubtitle) {
      const track = document.createElement("track");
      track.kind = "captions";
      track.label = "中文";
      track.srclang = "zh";
      track.src = convertFileSrc(subtitleUrl);
      track.default = true;
      video.appendChild(track);
    }

    // ASS 字幕时添加一个空的 track 用于触发字幕按钮
    if (isAssSubtitle) {
      const track = document.createElement("track");
      track.kind = "captions";
      track.label = "中文";
      track.srclang = "zh";
      track.src = "data:text/vtt;base64,V0VCVlRUCgo="; // 空的 VTT 文件
      track.default = true;
      video.appendChild(track);
    }

    // 清空容器并添加新的 video
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(video);

    // 初始化 Plyr
    playerRef.current = new Plyr(video, {
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

    // 如果是 ASS 字幕，动态导入 assjs 并渲染
    let isMounted = true;
    const cleanupRef = {
      captionBtn: null as Element | null,
      handler: null as (() => void) | null,
    };

    if (isAssSubtitle) {
      Promise.all([
        import("assjs"),
        invoke<string>("read_file_content", { path: subtitleUrl }),
      ])
        .then(([assModule, assContent]) => {
          // 如果组件已卸载，不执行后续操作
          if (!isMounted || !assContent || !containerRef.current) return;

          const ASS = assModule.default;
          const plyrContainer = containerRef.current.querySelector(".plyr");
          const videoEl = containerRef.current.querySelector("video");
          if (plyrContainer && videoEl) {
            assRef.current = new ASS(assContent, videoEl as HTMLVideoElement, {
              container: plyrContainer as HTMLElement,
              resampling: "video_width",
            });

            // 监听字幕按钮点击来控制 ASS 字幕
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
          }
        })
        .catch((err) => {
          console.error("Failed to load ASS subtitle:", err);
        });
    }

    return () => {
      isMounted = false;
      // 移除事件监听器
      if (cleanupRef.captionBtn && cleanupRef.handler) {
        cleanupRef.captionBtn.removeEventListener("click", cleanupRef.handler);
      }
      if (assRef.current) {
        assRef.current.destroy();
        assRef.current = null;
      }
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoUrl, subtitleUrl, compact]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${compact ? "" : "aspect-video"} bg-black rounded-lg overflow-hidden plyr-container relative`}
    />
  );
}
