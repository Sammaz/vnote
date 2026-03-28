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

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  overlayOpacity: 60,
  contentOpacity: 46,
  blur: 8,
  size: "cover",
  position: "center",
  attachment: "fixed",
};

export interface BackgroundSettings {
  overlayOpacity: number;
  contentOpacity: number;
  blur: number;
  size: "cover" | "contain";
  position: "center" | "top" | "bottom";
  attachment: "fixed" | "scroll";
}

export interface InitializationTemplateSettings {
  selectedKeys: string[] | null;
  regenerate: boolean;
  modelId: string;
  loaded: boolean;
}

const INITIALIZATION_TEMPLATE_SELECTED_KEYS_KEY = "initialization_template_selected_keys";
const INITIALIZATION_TEMPLATE_REGENERATE_KEY = "initialization_template_regenerate";
const INITIALIZATION_TEMPLATE_MODEL_ID_KEY = "initialization_template_model_id";

const DEFAULT_INITIALIZATION_TEMPLATE_SETTINGS: InitializationTemplateSettings = {
  selectedKeys: null,
  regenerate: false,
  modelId: "",
  loaded: false,
};

function parseStringArraySetting(value: string | null): string[] | null {
  if (value === null || value.trim() === "") return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

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

  // 背景图
  backgroundImage: string | null;
  backgroundSettings: BackgroundSettings;
  setBackgroundImage: (path: string | null) => void;
  updateBackgroundSettings: (settings: Partial<BackgroundSettings>) => void;
  resetBackgroundSettings: () => void;

  // 初始化模板
  initializationTemplateSettings: InitializationTemplateSettings;
  setInitializationTemplateSelectedKeys: (keys: string[]) => void;
  setInitializationTemplateRegenerate: (regenerate: boolean) => void;
  setInitializationTemplateModelId: (modelId: string) => void;
  resetInitializationTemplateSettings: () => void;
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

  const [backgroundImage, setBackgroundImageState] = useState<string | null>(null);
  const [backgroundSettings, setBackgroundSettingsState] = useState<BackgroundSettings>(DEFAULT_BACKGROUND_SETTINGS);
  const [initializationTemplateSettings, setInitializationTemplateSettings] = useState<InitializationTemplateSettings>(
    DEFAULT_INITIALIZATION_TEMPLATE_SETTINGS
  );

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

  // 加载背景图设置
  const loadBackgroundImage = useCallback(async () => {
    try {
      const value = await invoke<string | null>("get_setting", { key: "background_image" });
      if (value) {
        setBackgroundImageState(value);
      }
    } catch (error) {
      console.error("Failed to load background image:", error);
    }
  }, []);

  const loadBackgroundSettings = useCallback(async () => {
    try {
      const [overlayOpacity, contentOpacity, blur, size, position, attachment] = await Promise.all([
        invoke<string | null>("get_setting", { key: "background_overlay_opacity" }),
        invoke<string | null>("get_setting", { key: "background_content_opacity" }),
        invoke<string | null>("get_setting", { key: "background_blur" }),
        invoke<string | null>("get_setting", { key: "background_size" }),
        invoke<string | null>("get_setting", { key: "background_position" }),
        invoke<string | null>("get_setting", { key: "background_attachment" }),
      ]);

      const parseNumberSetting = (value: string | null, min: number, max: number, fallback: number) => {
        if (value === null) return fallback;
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed)) return fallback;
        return Math.max(min, Math.min(max, parsed));
      };

      setBackgroundSettingsState({
        overlayOpacity: parseNumberSetting(overlayOpacity, 20, 90, DEFAULT_BACKGROUND_SETTINGS.overlayOpacity),
        contentOpacity: parseNumberSetting(contentOpacity, 10, 85, DEFAULT_BACKGROUND_SETTINGS.contentOpacity),
        blur: parseNumberSetting(blur, 0, 24, DEFAULT_BACKGROUND_SETTINGS.blur),
        size: size === "contain" || size === "cover" ? size : DEFAULT_BACKGROUND_SETTINGS.size,
        position: position === "top" || position === "bottom" || position === "center" ? position : DEFAULT_BACKGROUND_SETTINGS.position,
        attachment: attachment === "scroll" || attachment === "fixed" ? attachment : DEFAULT_BACKGROUND_SETTINGS.attachment,
      });
    } catch (error) {
      console.error("Failed to load background settings:", error);
    }
  }, []);

  // 设置/清除背景图
  const setBackgroundImage = useCallback((path: string | null) => {
    setBackgroundImageState(path);
    saveSetting("background_image", path ?? "");
  }, [saveSetting]);

  const updateBackgroundSettings = useCallback((settings: Partial<BackgroundSettings>) => {
    setBackgroundSettingsState(prev => {
      const next = { ...prev, ...settings };
      if (settings.overlayOpacity !== undefined) {
        saveSetting("background_overlay_opacity", next.overlayOpacity.toString());
      }
      if (settings.contentOpacity !== undefined) {
        saveSetting("background_content_opacity", next.contentOpacity.toString());
      }
      if (settings.blur !== undefined) {
        saveSetting("background_blur", next.blur.toString());
      }
      if (settings.size !== undefined) {
        saveSetting("background_size", next.size);
      }
      if (settings.position !== undefined) {
        saveSetting("background_position", next.position);
      }
      if (settings.attachment !== undefined) {
        saveSetting("background_attachment", next.attachment);
      }
      return next;
    });
  }, [saveSetting]);

  const resetBackgroundSettings = useCallback(() => {
    setBackgroundSettingsState(DEFAULT_BACKGROUND_SETTINGS);
    saveSetting("background_overlay_opacity", DEFAULT_BACKGROUND_SETTINGS.overlayOpacity.toString());
    saveSetting("background_content_opacity", DEFAULT_BACKGROUND_SETTINGS.contentOpacity.toString());
    saveSetting("background_blur", DEFAULT_BACKGROUND_SETTINGS.blur.toString());
    saveSetting("background_size", DEFAULT_BACKGROUND_SETTINGS.size);
    saveSetting("background_position", DEFAULT_BACKGROUND_SETTINGS.position);
    saveSetting("background_attachment", DEFAULT_BACKGROUND_SETTINGS.attachment);
  }, [saveSetting]);

  const loadInitializationTemplateSettings = useCallback(async () => {
    try {
      const [selectedKeys, regenerate, modelId] = await Promise.all([
        invoke<string | null>("get_setting", { key: INITIALIZATION_TEMPLATE_SELECTED_KEYS_KEY }),
        invoke<string | null>("get_setting", { key: INITIALIZATION_TEMPLATE_REGENERATE_KEY }),
        invoke<string | null>("get_setting", { key: INITIALIZATION_TEMPLATE_MODEL_ID_KEY }),
      ]);

      setInitializationTemplateSettings({
        selectedKeys: parseStringArraySetting(selectedKeys),
        regenerate: regenerate === "true",
        modelId: modelId ?? "",
        loaded: true,
      });
    } catch (error) {
      console.error("Failed to load initialization template settings:", error);
      setInitializationTemplateSettings({
        ...DEFAULT_INITIALIZATION_TEMPLATE_SETTINGS,
        loaded: true,
      });
    }
  }, []);

  const setInitializationTemplateSelectedKeys = useCallback((keys: string[]) => {
    setInitializationTemplateSettings(prev => ({
      ...prev,
      selectedKeys: keys,
      loaded: true,
    }));
    saveSetting(INITIALIZATION_TEMPLATE_SELECTED_KEYS_KEY, JSON.stringify(keys));
  }, [saveSetting]);

  const setInitializationTemplateRegenerate = useCallback((regenerate: boolean) => {
    setInitializationTemplateSettings(prev => ({
      ...prev,
      regenerate,
      loaded: true,
    }));
    saveSetting(INITIALIZATION_TEMPLATE_REGENERATE_KEY, regenerate.toString());
  }, [saveSetting]);

  const setInitializationTemplateModelId = useCallback((modelId: string) => {
    setInitializationTemplateSettings(prev => ({
      ...prev,
      modelId,
      loaded: true,
    }));
    saveSetting(INITIALIZATION_TEMPLATE_MODEL_ID_KEY, modelId);
  }, [saveSetting]);

  useEffect(() => {
    if (!initializationTemplateSettings.loaded || aiConfigs.length === 0) return;
    if (!initializationTemplateSettings.modelId) return;
    if (aiConfigs.some((config) => config.id === initializationTemplateSettings.modelId)) return;

    setInitializationTemplateSettings(prev => ({
      ...prev,
      modelId: "",
    }));
    saveSetting(INITIALIZATION_TEMPLATE_MODEL_ID_KEY, "");
  }, [aiConfigs, initializationTemplateSettings.loaded, initializationTemplateSettings.modelId, saveSetting]);

  const resetInitializationTemplateSettings = useCallback(() => {
    setInitializationTemplateSettings({
      selectedKeys: null,
      regenerate: false,
      modelId: "",
      loaded: true,
    });
    saveSetting(INITIALIZATION_TEMPLATE_SELECTED_KEYS_KEY, "");
    saveSetting(INITIALIZATION_TEMPLATE_REGENERATE_KEY, "false");
    saveSetting(INITIALIZATION_TEMPLATE_MODEL_ID_KEY, "");
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
    loadBackgroundImage();
    loadBackgroundSettings();
    loadInitializationTemplateSettings();
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
    backgroundImage,
    backgroundSettings,
    setBackgroundImage,
    updateBackgroundSettings,
    resetBackgroundSettings,
    initializationTemplateSettings,
    setInitializationTemplateSelectedKeys,
    setInitializationTemplateRegenerate,
    setInitializationTemplateModelId,
    resetInitializationTemplateSettings,
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
    backgroundImage,
    backgroundSettings,
    setBackgroundImage,
    updateBackgroundSettings,
    resetBackgroundSettings,
    initializationTemplateSettings,
    setInitializationTemplateSelectedKeys,
    setInitializationTemplateRegenerate,
    setInitializationTemplateModelId,
    resetInitializationTemplateSettings,
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
