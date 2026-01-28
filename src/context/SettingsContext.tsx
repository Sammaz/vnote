/**
 * SettingsContext - 设置与工具栏状态管理
 * 从 AppContext 拆分，减少不必要的重渲染
 */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AiConfig, PromptConfig, VideoToolbarSettings, AppStats } from "../types";

// 常量定义 - 避免 Magic Numbers
export const LAYOUT_PANEL_WIDTH = {
  MIN: 30,
  MAX: 70,
  DEFAULT: 40,
} as const;

const mockStats: AppStats = {
  totalNotes: 0,
  totalWatchTime: 0,
  notesThisWeek: 0,
  lastActivityDate: null,
};

interface SettingsContextType {
  // AI 配置
  aiConfigs: AiConfig[];
  promptConfigs: PromptConfig[];
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  refreshAiConfigs: () => Promise<void>;
  refreshPromptConfigs: () => Promise<void>;

  // 统计
  stats: AppStats;
  setStats: React.Dispatch<React.SetStateAction<AppStats>>;
  addWatchTime: (seconds: number) => void;

  // 工具栏设置
  toolbarSettings: VideoToolbarSettings;
  setVideoVisible: (visible: boolean) => void;
  setAutoPlay: (autoPlay: boolean) => void;
  setLayoutSwapped: (swapped: boolean) => void;
  setLayoutPanelWidth: (width: number) => void;
  setCaptionsEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [stats, setStats] = useState<AppStats>(mockStats);

  const [toolbarSettings, setToolbarSettings] = useState<VideoToolbarSettings>({
    videoVisible: true,
    autoPlay: false,
    layoutSwapped: false,
    layoutPanelWidth: LAYOUT_PANEL_WIDTH.DEFAULT,
    captionsEnabled: true,
  });

  // 保存单个设置
  const saveSetting = useCallback(async (key: string, value: string) => {
    try {
      await invoke("set_setting", { key, value });
    } catch (error) {
      console.error(`Failed to save setting ${key}:`, error);
    }
  }, []);

  // 加载工具栏设置
  const loadToolbarSettings = useCallback(async () => {
    try {
      const [videoVisible, autoPlay, layoutSwapped, layoutPanelWidth, captionsEnabled] = await Promise.all([
        invoke<string | null>("get_setting", { key: "toolbar_video_visible" }),
        invoke<string | null>("get_setting", { key: "toolbar_auto_play" }),
        invoke<string | null>("get_setting", { key: "toolbar_layout_swapped" }),
        invoke<string | null>("get_setting", { key: "toolbar_layout_panel_width" }),
        invoke<string | null>("get_setting", { key: "toolbar_captions_enabled" }),
      ]);

      setToolbarSettings({
        videoVisible: videoVisible !== "false",
        autoPlay: autoPlay === "true",
        layoutSwapped: layoutSwapped === "true",
        layoutPanelWidth: layoutPanelWidth
          ? Math.max(LAYOUT_PANEL_WIDTH.MIN, Math.min(LAYOUT_PANEL_WIDTH.MAX, parseInt(layoutPanelWidth, 10)))
          : LAYOUT_PANEL_WIDTH.DEFAULT,
        captionsEnabled: captionsEnabled !== "false",
      });
    } catch (error) {
      console.error("Failed to load toolbar settings:", error);
    }
  }, []);

  // 加载累计观看时长
  const loadTotalWatchTime = useCallback(async () => {
    try {
      const value = await invoke<string | null>("get_setting", { key: "total_watch_time" });
      if (value) {
        const totalWatchTime = parseInt(value, 10) || 0;
        setStats(prev => ({ ...prev, totalWatchTime }));
      }
    } catch (error) {
      console.error("Failed to load total watch time:", error);
    }
  }, []);

  // 增加观看时长
  const addWatchTime = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    setStats(prev => {
      const newTotal = prev.totalWatchTime + Math.floor(seconds);
      invoke("set_setting", { key: "total_watch_time", value: newTotal.toString() }).catch(err => {
        console.error("Failed to save watch time:", err);
      });
      return { ...prev, totalWatchTime: newTotal };
    });
  }, []);

  // 设置视频可见性
  const setVideoVisible = useCallback((visible: boolean) => {
    setToolbarSettings(prev => ({ ...prev, videoVisible: visible }));
    saveSetting("toolbar_video_visible", visible.toString());
  }, [saveSetting]);

  // 设置自动播放
  const setAutoPlay = useCallback((autoPlay: boolean) => {
    setToolbarSettings(prev => ({ ...prev, autoPlay }));
    saveSetting("toolbar_auto_play", autoPlay.toString());
  }, [saveSetting]);

  // 设置布局交换
  const setLayoutSwapped = useCallback((swapped: boolean) => {
    setToolbarSettings(prev => ({ ...prev, layoutSwapped: swapped }));
    saveSetting("toolbar_layout_swapped", swapped.toString());
  }, [saveSetting]);

  // 设置布局面板宽度
  const setLayoutPanelWidth = useCallback((width: number) => {
    const clampedWidth = Math.max(LAYOUT_PANEL_WIDTH.MIN, Math.min(LAYOUT_PANEL_WIDTH.MAX, width));
    setToolbarSettings(prev => ({ ...prev, layoutPanelWidth: clampedWidth }));
    saveSetting("toolbar_layout_panel_width", clampedWidth.toString());
  }, [saveSetting]);

  // 设置字幕开关状态
  const setCaptionsEnabled = useCallback((enabled: boolean) => {
    setToolbarSettings(prev => ({ ...prev, captionsEnabled: enabled }));
    saveSetting("toolbar_captions_enabled", enabled.toString());
  }, [saveSetting]);

  // 加载 AI 配置
  const refreshAiConfigs = useCallback(async () => {
    try {
      const configs = await invoke<AiConfig[]>("get_ai_configs");
      setAiConfigs(configs);

      if (configs.length > 0) {
        const defaultConfig = configs.find(c => c.is_default);
        if (defaultConfig) {
          setSelectedModelId(defaultConfig.id);
        } else if (!selectedModelId || !configs.find(c => c.id === selectedModelId)) {
          setSelectedModelId(configs[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to load AI configs:", error);
    }
  }, [selectedModelId]);

  // 加载提示词配置
  const refreshPromptConfigs = useCallback(async () => {
    try {
      const configs = await invoke<PromptConfig[]>("get_prompt_configs");
      setPromptConfigs(configs);
    } catch (error) {
      console.error("Failed to load prompt configs:", error);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    refreshAiConfigs();
    refreshPromptConfigs();
    loadToolbarSettings();
    loadTotalWatchTime();
  }, []);

  const value = useMemo(() => ({
    aiConfigs,
    promptConfigs,
    selectedModelId,
    setSelectedModelId,
    refreshAiConfigs,
    refreshPromptConfigs,
    stats,
    setStats,
    addWatchTime,
    toolbarSettings,
    setVideoVisible,
    setAutoPlay,
    setLayoutSwapped,
    setLayoutPanelWidth,
    setCaptionsEnabled,
  }), [
    aiConfigs,
    promptConfigs,
    selectedModelId,
    refreshAiConfigs,
    refreshPromptConfigs,
    stats,
    addWatchTime,
    toolbarSettings,
    setVideoVisible,
    setAutoPlay,
    setLayoutSwapped,
    setLayoutPanelWidth,
    setCaptionsEnabled,
  ]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
