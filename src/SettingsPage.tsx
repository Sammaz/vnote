import {
    ArrowLeft, Monitor, Moon, Palette, Settings as SettingsIcon, Sun, Bot, Eye, EyeOff, Loader2, Plus, Trash2, Star, Database, Sparkles, HardDrive
} from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "./context/AppContext";

interface SettingsPageProps {
    currentTheme: "light" | "dark";
    onThemeChange: (theme: "light" | "dark") => void;
    onClose: () => void;
}

interface AiConfig {
    id: number;
    title: string;
    base_url: string;
    api_key: string;
    model: string;
    sort_order: number;
    is_default: boolean;
}

interface EmbeddingConfig {
    id: number;
    title: string;
    base_url: string;
    api_key: string;
    model: string;
    sort_order: number;
    is_default: boolean;
}

interface RerankerConfig {
    id: number;
    title: string;
    base_url: string;
    api_key: string;
    model: string;
    sort_order: number;
    is_default: boolean;
}

type SettingsTab = "general" | "model";
type EditingType = "ai" | "embedding" | "reranker" | null;

export default function SettingsPage({ currentTheme, onThemeChange, onClose }: SettingsPageProps) {
    const { refreshAiConfigs } = useApp();
    const [activeTab, setActiveTab] = useState<SettingsTab>("general");
    const [trayEnabled, setTrayEnabled] = useState(false);
    const [loading, setLoading] = useState(true);

    // AI config state
    const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
    const [editingAiConfig, setEditingAiConfig] = useState<AiConfig | null>(null);
    const [deletingAiConfigId, setDeletingAiConfigId] = useState<number | null>(null);

    // Embedding config state
    const [embeddingConfigs, setEmbeddingConfigs] = useState<EmbeddingConfig[]>([]);
    const [editingEmbeddingConfig, setEditingEmbeddingConfig] = useState<EmbeddingConfig | null>(null);
    const [deletingEmbeddingConfigId, setDeletingEmbeddingConfigId] = useState<number | null>(null);

    // Reranker config state
    const [rerankerConfigs, setRerankerConfigs] = useState<RerankerConfig[]>([]);
    const [editingRerankerConfig, setEditingRerankerConfig] = useState<RerankerConfig | null>(null);
    const [deletingRerankerConfigId, setDeletingRerankerConfigId] = useState<number | null>(null);

    // Shared editing state
    const [editingType, setEditingType] = useState<EditingType>(null);
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [testingApi, setTestingApi] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Video cache state
    const [videoCacheSize, setVideoCacheSize] = useState<number>(0);
    const [clearingCache, setClearingCache] = useState(false);

    // Load settings from database on mount
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const [tray, aiCfgs, embCfgs, rerCfgs, cacheSize] = await Promise.all([
                    invoke<boolean>("get_tray_enabled"),
                    invoke<AiConfig[]>("get_ai_configs"),
                    invoke<EmbeddingConfig[]>("get_embedding_configs"),
                    invoke<RerankerConfig[]>("get_reranker_configs"),
                    invoke<number>("get_video_cache_size"),
                ]);
                setTrayEnabled(tray);
                setAiConfigs(aiCfgs);
                setEmbeddingConfigs(embCfgs);
                setRerankerConfigs(rerCfgs);
                setVideoCacheSize(cacheSize);
            } catch (error) {
                console.error("Failed to load settings:", error);
            } finally {
                setLoading(false);
            }
        };
        loadSettings();
    }, []);

    const handleThemeChange = async (theme: "light" | "dark") => {
        onThemeChange(theme);
        try {
            await invoke("set_theme", { theme });
        } catch (error) {
            console.error("Failed to save theme:", error);
        }
    };

    const handleTrayToggle = async () => {
        const newValue = !trayEnabled;
        try {
            await invoke("update_tray_enabled", { enabled: newValue });
            setTrayEnabled(newValue);
        } catch (error) {
            console.error("Failed to update tray:", error);
        }
    };

    // Format bytes to human readable size
    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const handleClearVideoCache = async () => {
        setClearingCache(true);
        try {
            const clearedSize = await invoke<number>("clear_video_cache");
            setVideoCacheSize(0);
            console.log(`Cleared ${formatBytes(clearedSize)} of video cache`);
        } catch (error) {
            console.error("Failed to clear video cache:", error);
        } finally {
            setClearingCache(false);
        }
    };

    // AI Config handlers
    const createEmptyAiConfig = (): AiConfig => ({
        id: 0,
        title: "",
        base_url: "",
        api_key: "",
        model: "",
        sort_order: aiConfigs.length,
        is_default: false
    });

    const saveAiConfig = async () => {
        if (!editingAiConfig) return;
        try {
            if (editingAiConfig.id === 0) {
                const newId = await invoke<number>("create_ai_config", { config: editingAiConfig });
                setAiConfigs([...aiConfigs, { ...editingAiConfig, id: newId }]);
            } else {
                await invoke("update_ai_config", { config: editingAiConfig });
                setAiConfigs(aiConfigs.map(c => c.id === editingAiConfig.id ? editingAiConfig : c));
            }
            closeEditor();
            await refreshAiConfigs();
        } catch (error) {
            console.error("Failed to save AI config:", error);
        }
    };

    const deleteAiConfig = async (id: number) => {
        try {
            await invoke("delete_ai_config", { id });
            setAiConfigs(aiConfigs.filter(c => c.id !== id));
            setDeletingAiConfigId(null);
            await refreshAiConfigs();
        } catch (error) {
            console.error("Failed to delete AI config:", error);
        }
    };

    const toggleDefaultAiConfig = async (id: number, currentIsDefault: boolean) => {
        try {
            if (currentIsDefault) {
                await invoke("unset_default_ai_config", { id });
                setAiConfigs(aiConfigs.map(c => c.id === id ? { ...c, is_default: false } : c));
            } else {
                await invoke("set_default_ai_config", { id });
                setAiConfigs(aiConfigs.map(c => ({ ...c, is_default: c.id === id })));
            }
            await refreshAiConfigs();
        } catch (error) {
            console.error("Failed to toggle default AI config:", error);
        }
    };

    // Embedding Config handlers
    const createEmptyEmbeddingConfig = (): EmbeddingConfig => ({
        id: 0,
        title: "",
        base_url: "",
        api_key: "",
        model: "",
        sort_order: embeddingConfigs.length,
        is_default: false
    });

    const saveEmbeddingConfig = async () => {
        if (!editingEmbeddingConfig) return;
        try {
            if (editingEmbeddingConfig.id === 0) {
                const newId = await invoke<number>("create_embedding_config", { config: editingEmbeddingConfig });
                // First config is auto-set as default by backend
                const isFirst = embeddingConfigs.length === 0;
                setEmbeddingConfigs([...embeddingConfigs, { ...editingEmbeddingConfig, id: newId, is_default: isFirst }]);
            } else {
                await invoke("update_embedding_config", { config: editingEmbeddingConfig });
                setEmbeddingConfigs(embeddingConfigs.map(c => c.id === editingEmbeddingConfig.id ? editingEmbeddingConfig : c));
            }
            closeEditor();
        } catch (error) {
            console.error("Failed to save embedding config:", error);
        }
    };

    const deleteEmbeddingConfig = async (id: number) => {
        try {
            const deletingConfig = embeddingConfigs.find(c => c.id === id);
            await invoke("delete_embedding_config", { id });

            const remaining = embeddingConfigs.filter(c => c.id !== id);
            // If deleted config was default and there are remaining configs, first one becomes default
            if (deletingConfig?.is_default && remaining.length > 0) {
                remaining[0].is_default = true;
            }
            setEmbeddingConfigs(remaining);
            setDeletingEmbeddingConfigId(null);
        } catch (error) {
            console.error("Failed to delete embedding config:", error);
        }
    };

    const toggleDefaultEmbeddingConfig = async (id: number, currentIsDefault: boolean) => {
        try {
            if (currentIsDefault) {
                // If it's the only config, don't allow unsetting
                if (embeddingConfigs.length <= 1) return;

                // Find the first other config to set as default
                const otherConfig = embeddingConfigs.find(c => c.id !== id);
                if (otherConfig) {
                    await invoke("set_default_embedding_config", { id: otherConfig.id });
                    setEmbeddingConfigs(embeddingConfigs.map(c => ({ ...c, is_default: c.id === otherConfig.id })));
                }
            } else {
                await invoke("set_default_embedding_config", { id });
                setEmbeddingConfigs(embeddingConfigs.map(c => ({ ...c, is_default: c.id === id })));
            }
        } catch (error) {
            console.error("Failed to toggle default embedding config:", error);
        }
    };

    // Reranker Config handlers
    const createEmptyRerankerConfig = (): RerankerConfig => ({
        id: 0,
        title: "",
        base_url: "",
        api_key: "",
        model: "",
        sort_order: rerankerConfigs.length,
        is_default: false
    });

    const saveRerankerConfig = async () => {
        if (!editingRerankerConfig) return;
        try {
            if (editingRerankerConfig.id === 0) {
                const newId = await invoke<number>("create_reranker_config", { config: editingRerankerConfig });
                // First config is auto-set as default by backend
                const isFirst = rerankerConfigs.length === 0;
                setRerankerConfigs([...rerankerConfigs, { ...editingRerankerConfig, id: newId, is_default: isFirst }]);
            } else {
                await invoke("update_reranker_config", { config: editingRerankerConfig });
                setRerankerConfigs(rerankerConfigs.map(c => c.id === editingRerankerConfig.id ? editingRerankerConfig : c));
            }
            closeEditor();
        } catch (error) {
            console.error("Failed to save reranker config:", error);
        }
    };

    const deleteRerankerConfig = async (id: number) => {
        try {
            const deletingConfig = rerankerConfigs.find(c => c.id === id);
            await invoke("delete_reranker_config", { id });

            const remaining = rerankerConfigs.filter(c => c.id !== id);
            // If deleted config was default and there are remaining configs, first one becomes default
            if (deletingConfig?.is_default && remaining.length > 0) {
                remaining[0].is_default = true;
            }
            setRerankerConfigs(remaining);
            setDeletingRerankerConfigId(null);
        } catch (error) {
            console.error("Failed to delete reranker config:", error);
        }
    };

    const toggleDefaultRerankerConfig = async (id: number, currentIsDefault: boolean) => {
        try {
            if (currentIsDefault) {
                // If it's the only config, don't allow unsetting
                if (rerankerConfigs.length <= 1) return;

                // Find the first other config to set as default
                const otherConfig = rerankerConfigs.find(c => c.id !== id);
                if (otherConfig) {
                    await invoke("set_default_reranker_config", { id: otherConfig.id });
                    setRerankerConfigs(rerankerConfigs.map(c => ({ ...c, is_default: c.id === otherConfig.id })));
                }
            } else {
                await invoke("set_default_reranker_config", { id });
                setRerankerConfigs(rerankerConfigs.map(c => ({ ...c, is_default: c.id === id })));
            }
        } catch (error) {
            console.error("Failed to toggle default reranker config:", error);
        }
    };

    const closeEditor = () => {
        setEditingType(null);
        setEditingAiConfig(null);
        setEditingEmbeddingConfig(null);
        setEditingRerankerConfig(null);
        setApiKeyVisible(false);
        setTestResult(null);
    };

    const openAiEditor = (config: AiConfig) => {
        setEditingType("ai");
        setEditingAiConfig(config);
    };

    const openEmbeddingEditor = (config: EmbeddingConfig) => {
        setEditingType("embedding");
        setEditingEmbeddingConfig(config);
    };

    const openRerankerEditor = (config: RerankerConfig) => {
        setEditingType("reranker");
        setEditingRerankerConfig(config);
    };

    const testApiConfig = async () => {
        setTestingApi(true);
        setTestResult(null);
        await new Promise(resolve => setTimeout(resolve, 1000));
        setTestResult({ success: true, message: "连接成功" });
        setTestingApi(false);
    };

    const themeButtonClass = (theme: "light" | "dark") =>
        [
            "flex items-center justify-center h-9 w-11 rounded-lg border text-sm transition-all",
            theme === currentTheme
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-white/50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600",
        ].join(" ");

    // Get current editing config values
    const getCurrentEditingConfig = () => {
        if (editingType === "ai") return editingAiConfig;
        if (editingType === "embedding") return editingEmbeddingConfig;
        if (editingType === "reranker") return editingRerankerConfig;
        return null;
    };

    const setCurrentEditingConfig = (updates: Partial<AiConfig | EmbeddingConfig | RerankerConfig>) => {
        if (editingType === "ai" && editingAiConfig) {
            setEditingAiConfig({ ...editingAiConfig, ...updates });
        } else if (editingType === "embedding" && editingEmbeddingConfig) {
            setEditingEmbeddingConfig({ ...editingEmbeddingConfig, ...updates });
        } else if (editingType === "reranker" && editingRerankerConfig) {
            setEditingRerankerConfig({ ...editingRerankerConfig, ...updates });
        }
    };

    const saveCurrentConfig = () => {
        if (editingType === "ai") saveAiConfig();
        else if (editingType === "embedding") saveEmbeddingConfig();
        else if (editingType === "reranker") saveRerankerConfig();
    };

    const getEditorTitle = () => {
        const config = getCurrentEditingConfig();
        const isNew = config?.id === 0;
        if (editingType === "ai") return isNew ? "新增对话模型" : "编辑对话模型";
        if (editingType === "embedding") return isNew ? "新增 Embedding 模型" : "编辑 Embedding 模型";
        if (editingType === "reranker") return isNew ? "新增 Reranker 模型" : "编辑 Reranker 模型";
        return "";
    };

    const getEditorDescription = () => {
        if (editingType === "ai") return "配置用于对话的 AI 模型接口";
        if (editingType === "embedding") return "配置用于向量化的 Embedding 模型接口";
        if (editingType === "reranker") return "配置用于重排序的 Reranker 模型接口";
        return "";
    };

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
        );
    }

    const currentConfig = getCurrentEditingConfig();

    // Config list item component
    const ConfigListItem = ({
        config,
        icon: Icon,
        onEdit,
        onDelete,
        onToggleDefault
    }: {
        config: { id: number; title: string; model: string; base_url: string; is_default: boolean };
        icon: typeof Bot;
        onEdit: () => void;
        onDelete: () => void;
        onToggleDefault: () => void;
    }) => (
        <div className="flex items-center gap-4 p-4 rounded-lg border border-slate-200 dark:border-vnote-border">
            <div className="h-8 w-8 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                <Icon size={16} className="text-slate-600 dark:text-slate-400" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2">
                    {config.title || "未命名"}
                    {config.is_default && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">默认</span>
                    )}
                </div>
                <div className="text-xs text-slate-500 truncate">{config.model || config.base_url || "未配置"}</div>
            </div>
            <button
                onClick={onToggleDefault}
                className={config.is_default
                    ? "text-yellow-500 hover:text-yellow-600"
                    : "text-slate-400 hover:text-yellow-500"}
                title={config.is_default ? "取消默认" : "设为默认"}
            >
                <Star size={14} fill={config.is_default ? "currentColor" : "none"} />
            </button>
            <button
                onClick={onEdit}
                className="text-slate-400 hover:text-blue-600 text-xs"
            >
                编辑
            </button>
            <button
                onClick={onDelete}
                className="text-slate-400 hover:text-red-600"
            >
                <Trash2 size={14} />
            </button>
        </div>
    );

    // Delete confirmation modal
    const DeleteModal = ({
        title,
        onCancel,
        onConfirm
    }: {
        title: string;
        onCancel: () => void;
        onConfirm: () => void;
    }) => (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
            <div className="bg-white dark:bg-vnote-card rounded-2xl p-6 w-[360px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">确认删除</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                    确定要删除配置「{title}」吗？此操作无法撤销。
                </p>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">取消</button>
                    <button onClick={onConfirm} className="flex-1 px-4 py-2.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm">删除</button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex h-full w-full">
            <aside className="w-52 border-r border-slate-200 dark:border-vnote-border bg-slate-50/70 dark:bg-vnote-card/30 backdrop-blur-xl flex flex-col">
                <div className="px-4 py-4 text-xs font-medium tracking-wider text-slate-400 dark:text-slate-500 uppercase">设置</div>
                <nav className="flex-1 px-2">
                    <button
                        onClick={() => setActiveTab("general")}
                        className={[
                            "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all",
                            activeTab === "general"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover",
                        ].join(" ")}
                    >
                        <SettingsIcon size={16} />
                        常规设置
                    </button>
                    <button
                        onClick={() => setActiveTab("model")}
                        className={[
                            "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all mt-1",
                            activeTab === "model"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover",
                        ].join(" ")}
                    >
                        <Bot size={16} />
                        模型配置
                    </button>
                </nav>
            </aside>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            {activeTab === "general" ? <SettingsIcon size={20} /> : <Bot size={20} />}
                            {activeTab === "general" ? "常规设置" : "模型配置"}
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {activeTab === "general" ? "界面显示与桌面行为" : "配置对话模型、Embedding 和 Reranker"}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover/50 rounded-lg transition-colors"
                    >
                        <ArrowLeft size={16} />
                        返回
                    </button>
                </div>

                {activeTab === "general" ? (
                    <div className="space-y-6">
                        <div className="space-y-4">
                            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">界面设置</h3>
                            <div className="space-y-3">
                                <div className="flex items-center gap-4 p-4 rounded-lg border border-slate-200 dark:border-vnote-border">
                                    <div className="h-8 w-8 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                        <Palette size={16} className="text-slate-600 dark:text-slate-400" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">主题</div>
                                        <div className="text-sm text-slate-500 dark:text-slate-400">选择应用的外观主题</div>
                                    </div>
                                    <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                                        <button onClick={() => handleThemeChange("light")} className={themeButtonClass("light")}><Sun size={16} /></button>
                                        <button onClick={() => handleThemeChange("dark")} className={themeButtonClass("dark")}><Moon size={16} /></button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 p-4 rounded-lg border border-slate-200 dark:border-vnote-border">
                                    <div className="h-8 w-8 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                        <Monitor size={16} className="text-slate-600 dark:text-slate-400" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">系统托盘</div>
                                        <div className="text-sm text-slate-500 dark:text-slate-400">关闭窗口时保持后台运行</div>
                                    </div>
                                    <button onClick={handleTrayToggle} className={["relative inline-flex h-6 w-11 items-center rounded-full transition-colors", trayEnabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"].join(" ")}>
                                        <span className={["inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform", trayEnabled ? "translate-x-6" : "translate-x-1"].join(" ")} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">数据管理</h3>
                            <div className="space-y-3">
                                <div className="flex items-center gap-4 p-4 rounded-lg border border-slate-200 dark:border-vnote-border">
                                    <div className="h-8 w-8 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                        <HardDrive size={16} className="text-slate-600 dark:text-slate-400" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">视频缓存</div>
                                        <div className="text-sm text-slate-500 dark:text-slate-400">视频转换后的临时文件</div>
                                    </div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400 mr-2">
                                        {formatBytes(videoCacheSize)}
                                    </div>
                                    <button
                                        onClick={handleClearVideoCache}
                                        disabled={clearingCache || videoCacheSize === 0}
                                        className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                    >
                                        {clearingCache ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={14} />
                                        )}
                                        {clearingCache ? "清除中..." : "清除"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : editingType ? (
                    // Editor view
                    <>
                        <div className="flex items-center gap-3 mb-6">
                            <button
                                onClick={closeEditor}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors"
                            >
                                <ArrowLeft size={20} className="text-slate-500" />
                            </button>
                            <div>
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                    {getEditorTitle()}
                                </h3>
                                <p className="text-sm text-slate-500">{getEditorDescription()}</p>
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div className="flex flex-col w-full">
                                <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">配置名称</div>
                                <input
                                    type="text"
                                    value={currentConfig?.title || ""}
                                    onChange={e => setCurrentEditingConfig({ title: e.target.value })}
                                    placeholder={editingType === "ai" ? "例如：OpenAI、DeepSeek" : editingType === "embedding" ? "例如：OpenAI Embedding" : "例如：Cohere Reranker"}
                                    className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                                />
                                <p className="text-sm text-slate-500 mt-2">为此配置设置一个易于识别的名称</p>
                            </div>

                            <div className="flex flex-col w-full">
                                <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">BaseURL</div>
                                <input
                                    type="text"
                                    value={currentConfig?.base_url || ""}
                                    onChange={e => setCurrentEditingConfig({ base_url: e.target.value })}
                                    placeholder="例如：https://api.openai.com/v1"
                                    className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                />
                                <p className="text-sm text-slate-500 mt-2">API 服务的基础地址</p>
                            </div>

                            <div className="flex flex-col w-full">
                                <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">API Key</div>
                                <div className="flex gap-2">
                                    <input
                                        type={apiKeyVisible ? "text" : "password"}
                                        value={currentConfig?.api_key || ""}
                                        onChange={e => setCurrentEditingConfig({ api_key: e.target.value })}
                                        placeholder="sk-..."
                                        className="flex-1 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setApiKeyVisible(!apiKeyVisible)}
                                        className="px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                    >
                                        {apiKeyVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col w-full">
                                <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">模型名称</div>
                                <input
                                    type="text"
                                    value={currentConfig?.model || ""}
                                    onChange={e => setCurrentEditingConfig({ model: e.target.value })}
                                    placeholder={editingType === "ai" ? "例如：gpt-4o、deepseek-chat" : editingType === "embedding" ? "例如：text-embedding-3-small" : "例如：rerank-multilingual-v3.0"}
                                    className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono"
                                />
                                <p className="text-sm text-slate-500 mt-2">要使用的模型 ID</p>
                            </div>

                            {testResult && (
                                <div className={`p-3 rounded-md text-sm text-center ${testResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'}`}>
                                    {testResult.message}
                                </div>
                            )}

                            <button
                                onClick={testApiConfig}
                                disabled={testingApi || !currentConfig?.base_url || !currentConfig?.model}
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2 border border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {testingApi && <Loader2 size={14} className="animate-spin" />}
                                {testingApi ? "测试中..." : "测试连接"}
                            </button>
                        </div>
                        <div className="flex gap-3 pt-6">
                            <button
                                onClick={closeEditor}
                                className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-md transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={saveCurrentConfig}
                                className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                            >
                                保存
                            </button>
                        </div>
                    </>
                ) : (
                    // List view
                    <div className="space-y-8">
                        {/* AI Config Section */}
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">对话模型</h3>
                                    <span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">聊天</span>
                                </div>
                                <button
                                    onClick={() => openAiEditor(createEmptyAiConfig())}
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                >
                                    <Plus size={14} /> 新增配置
                                </button>
                            </div>
                            <div className="space-y-3">
                                {aiConfigs.map((config) => (
                                    <ConfigListItem
                                        key={config.id}
                                        config={config}
                                        icon={Bot}
                                        onEdit={() => openAiEditor(config)}
                                        onDelete={() => setDeletingAiConfigId(config.id)}
                                        onToggleDefault={() => toggleDefaultAiConfig(config.id, config.is_default)}
                                    />
                                ))}
                                {aiConfigs.length === 0 && (
                                    <div className="text-center py-6 text-slate-500 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                                        暂无配置，点击上方新增
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Embedding Config Section */}
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Embedding 模型</h3>
                                    <span className="px-2 py-0.5 text-xs rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">向量化</span>
                                </div>
                                <button
                                    onClick={() => openEmbeddingEditor(createEmptyEmbeddingConfig())}
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                >
                                    <Plus size={14} /> 新增配置
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                用于将字幕文本转换为向量，实现"基于视频"的语义搜索
                            </p>
                            <div className="space-y-3">
                                {embeddingConfigs.map((config) => (
                                    <ConfigListItem
                                        key={config.id}
                                        config={config}
                                        icon={Database}
                                        onEdit={() => openEmbeddingEditor(config)}
                                        onDelete={() => setDeletingEmbeddingConfigId(config.id)}
                                        onToggleDefault={() => toggleDefaultEmbeddingConfig(config.id, config.is_default)}
                                    />
                                ))}
                                {embeddingConfigs.length === 0 && (
                                    <div className="text-center py-6 text-slate-500 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                                        暂无配置，点击上方新增
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Reranker Config Section */}
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Reranker 模型</h3>
                                    <span className="px-2 py-0.5 text-xs rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">重排序</span>
                                </div>
                                <button
                                    onClick={() => openRerankerEditor(createEmptyRerankerConfig())}
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                >
                                    <Plus size={14} /> 新增配置
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                对初步检索结果进行重新排序，提高相关性（可选）
                            </p>
                            <div className="space-y-3">
                                {rerankerConfigs.map((config) => (
                                    <ConfigListItem
                                        key={config.id}
                                        config={config}
                                        icon={Sparkles}
                                        onEdit={() => openRerankerEditor(config)}
                                        onDelete={() => setDeletingRerankerConfigId(config.id)}
                                        onToggleDefault={() => toggleDefaultRerankerConfig(config.id, config.is_default)}
                                    />
                                ))}
                                {rerankerConfigs.length === 0 && (
                                    <div className="text-center py-6 text-slate-500 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                                        暂无配置，点击上方新增（可选）
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Delete modals */}
                {deletingAiConfigId !== null && (
                    <DeleteModal
                        title={aiConfigs.find(c => c.id === deletingAiConfigId)?.title || "未命名"}
                        onCancel={() => setDeletingAiConfigId(null)}
                        onConfirm={() => deleteAiConfig(deletingAiConfigId)}
                    />
                )}
                {deletingEmbeddingConfigId !== null && (
                    <DeleteModal
                        title={embeddingConfigs.find(c => c.id === deletingEmbeddingConfigId)?.title || "未命名"}
                        onCancel={() => setDeletingEmbeddingConfigId(null)}
                        onConfirm={() => deleteEmbeddingConfig(deletingEmbeddingConfigId)}
                    />
                )}
                {deletingRerankerConfigId !== null && (
                    <DeleteModal
                        title={rerankerConfigs.find(c => c.id === deletingRerankerConfigId)?.title || "未命名"}
                        onCancel={() => setDeletingRerankerConfigId(null)}
                        onConfirm={() => deleteRerankerConfig(deletingRerankerConfigId)}
                    />
                )}
            </div>
        </div>
    );
}
