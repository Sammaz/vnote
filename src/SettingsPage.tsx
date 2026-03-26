import {
    ArrowLeft, Monitor, Moon, Palette, Settings as SettingsIcon, Sun, Bot, Eye, EyeOff, Loader2, Plus, Trash2, Star, Database, Sparkles, MessageSquareText, Search, HardDrive, ImagePlus, X as XIcon, SlidersHorizontal, Focus, ScanText, RefreshCw
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "./context/AppContext";
import { useSettings } from "./context/SettingsContext";
import { DataManagementSection } from "./components/Settings/DataManagementSection";
import { message } from "./utils/message";
import type { AiConfig, EmbeddingConfig, RerankerConfig, PromptConfig } from "./types";

interface SettingsPageProps {
    currentTheme: "light" | "dark";
    onThemeChange: (theme: "light" | "dark") => void;
    onClose: () => void;
}

type SettingsTab = "general" | "model" | "prompt" | "data-management";
type EditingType = "ai" | "embedding" | "reranker" | null;

export default function SettingsPage({ currentTheme, onThemeChange, onClose }: SettingsPageProps) {
    const { notes, refreshAiConfigs, refreshPromptConfigs } = useApp();
    const { backgroundImage, backgroundSettings, setBackgroundImage, updateBackgroundSettings, resetBackgroundSettings } = useSettings();
    const [activeTab, setActiveTab] = useState<SettingsTab>("general");
    const [trayEnabled, setTrayEnabled] = useState(false);
    const [loading, setLoading] = useState(true);

    // AI config state
    const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
    const [editingAiConfig, setEditingAiConfig] = useState<AiConfig | null>(null);
    const [deletingAiConfigId, setDeletingAiConfigId] = useState<string | null>(null);

    // Embedding config state
    const [embeddingConfigs, setEmbeddingConfigs] = useState<EmbeddingConfig[]>([]);
    const [editingEmbeddingConfig, setEditingEmbeddingConfig] = useState<EmbeddingConfig | null>(null);
    const [deletingEmbeddingConfigId, setDeletingEmbeddingConfigId] = useState<string | null>(null);

    // Reranker config state
    const [rerankerConfigs, setRerankerConfigs] = useState<RerankerConfig[]>([]);
    const [editingRerankerConfig, setEditingRerankerConfig] = useState<RerankerConfig | null>(null);
    const [deletingRerankerConfigId, setDeletingRerankerConfigId] = useState<string | null>(null);

    // Shared editing state
    const [editingType, setEditingType] = useState<EditingType>(null);
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [testingApi, setTestingApi] = useState(false);

    // Prompt config state
    const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
    const [editingPromptConfig, setEditingPromptConfig] = useState<PromptConfig | null>(null);
    const [deletingPromptConfigId, setDeletingPromptConfigId] = useState<string | null>(null);

    // Prompt filter state
    const [promptSearchQuery, setPromptSearchQuery] = useState("");
    const [promptSortBy, setPromptSortBy] = useState<"recent" | "name">("recent");

    // Load settings from database on mount
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const [tray, aiCfgs, embCfgs, rerCfgs, promptCfgs] = await Promise.all([
                    invoke<boolean>("get_tray_enabled"),
                    invoke<AiConfig[]>("get_ai_configs"),
                    invoke<EmbeddingConfig[]>("get_embedding_configs"),
                    invoke<RerankerConfig[]>("get_reranker_configs"),
                    invoke<PromptConfig[]>("get_prompt_configs"),
                ]);
                setTrayEnabled(tray);
                setAiConfigs(aiCfgs);
                setEmbeddingConfigs(embCfgs);
                setRerankerConfigs(rerCfgs);
                setPromptConfigs(promptCfgs);
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

    const handlePickBackgroundImage = useCallback(async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: "图片文件",
                    extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"],
                }],
            });
            if (selected) {
                setBackgroundImage(selected);
            }
        } catch (error) {
            console.error("Failed to pick background image:", error);
        }
    }, [setBackgroundImage]);

    const previewOverlayStyle = useMemo(() => ({
        backdropFilter: `blur(${backgroundSettings.blur}px)`,
        backgroundColor: `rgb(248 250 252 / ${backgroundSettings.overlayOpacity}%)`,
    }), [backgroundSettings]);

    const previewPanelStyle = useMemo(() => ({
        backgroundColor: `rgb(248 250 252 / ${backgroundSettings.contentOpacity}%)`,
        backdropFilter: `blur(${Math.max(0, backgroundSettings.blur - 2)}px)`,
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    }), [backgroundSettings]);

    const previewGlowStyle = useMemo(() => ({
        background: "linear-gradient(135deg, rgb(255 255 255 / 48%) 0%, rgb(255 255 255 / 8%) 42%, rgb(59 130 246 / 16%) 100%)",
    }), []);

    // AI Config handlers
    const createEmptyAiConfig = (): AiConfig => ({
        id: "",
        title: "",
        base_url: "",
        api_key: "",
        model: "",
        sort_order: aiConfigs.length,
        is_default: false,
        concurrent_limit: 5,
        request_timeout: 180,
        rate_limit: 60
    });

    const saveAiConfig = async () => {
        if (!editingAiConfig) return;
        try {
            if (editingAiConfig.id === "") {
                const newId = await invoke<string>("create_ai_config", { config: editingAiConfig });
                // First config is auto-set as default by backend
                const isFirst = aiConfigs.length === 0;
                setAiConfigs([...aiConfigs, { ...editingAiConfig, id: newId, is_default: isFirst }]);
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

    const deleteAiConfig = async (id: string) => {
        try {
            const deletingConfig = aiConfigs.find(c => c.id === id);
            await invoke("delete_ai_config", { id });

            const remaining = aiConfigs.filter(c => c.id !== id);
            // If deleted config was default and there are remaining configs, first one becomes default
            if (deletingConfig?.is_default && remaining.length > 0) {
                remaining[0].is_default = true;
            }
            setAiConfigs(remaining);
            setDeletingAiConfigId(null);
            await refreshAiConfigs();
        } catch (error) {
            console.error("Failed to delete AI config:", error);
        }
    };

    const toggleDefaultAiConfig = async (id: string, currentIsDefault: boolean) => {
        try {
            if (currentIsDefault) {
                // If it's the only config, don't allow unsetting
                if (aiConfigs.length <= 1) return;

                // Find the first other config to set as default
                const otherConfig = aiConfigs.find(c => c.id !== id);
                if (otherConfig) {
                    await invoke("set_default_ai_config", { id: otherConfig.id });
                    setAiConfigs(aiConfigs.map(c => ({ ...c, is_default: c.id === otherConfig.id })));
                }
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
        id: "",
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
            if (editingEmbeddingConfig.id === "") {
                const newId = await invoke<string>("create_embedding_config", { config: editingEmbeddingConfig });
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

    const deleteEmbeddingConfig = async (id: string) => {
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

    const toggleDefaultEmbeddingConfig = async (id: string, currentIsDefault: boolean) => {
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
        id: "",
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
            if (editingRerankerConfig.id === "") {
                const newId = await invoke<string>("create_reranker_config", { config: editingRerankerConfig });
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

    const deleteRerankerConfig = async (id: string) => {
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

    const toggleDefaultRerankerConfig = async (id: string, currentIsDefault: boolean) => {
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

    // Prompt Config handlers
    const createEmptyPromptConfig = (): PromptConfig => ({
        id: "",
        title: "",
        description: null,
        content: "",
        sort_order: promptConfigs.length,
        is_default: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    const savePromptConfig = async () => {
        if (!editingPromptConfig) return;
        try {
            if (editingPromptConfig.id === "") {
                const newId = await invoke<string>("create_prompt_config", { config: editingPromptConfig });
                setPromptConfigs([...promptConfigs, { ...editingPromptConfig, id: newId }]);
            } else {
                await invoke("update_prompt_config", { config: editingPromptConfig });
                setPromptConfigs(promptConfigs.map(c => c.id === editingPromptConfig.id ? editingPromptConfig : c));
            }
            setEditingPromptConfig(null);
            // 同步更新全局状态
            refreshPromptConfigs();
        } catch (error) {
            console.error("Failed to save prompt config:", error);
        }
    };

    const deletePromptConfig = async (id: string) => {
        try {
            await invoke("delete_prompt_config", { id });
            setPromptConfigs(promptConfigs.filter(c => c.id !== id));
            setDeletingPromptConfigId(null);
            // 同步更新全局状态
            refreshPromptConfigs();
        } catch (error) {
            console.error("Failed to delete prompt config:", error);
        }
    };

    const openPromptEditor = (config: PromptConfig) => {
        setEditingPromptConfig(config);
    };

    // Filtered and sorted prompts
    const filteredPrompts = useMemo(() => {
        let filtered = promptConfigs;

        // Apply search filter
        if (promptSearchQuery) {
            const query = promptSearchQuery.toLowerCase();
            filtered = filtered.filter(p =>
                p.title.toLowerCase().includes(query) ||
                p.description?.toLowerCase().includes(query) ||
                p.content.toLowerCase().includes(query)
            );
        }

        // Apply sorting
        switch (promptSortBy) {
            case "name":
                return [...filtered].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
            case "recent":
            default:
                return [...filtered].sort((a, b) =>
                    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                );
        }
    }, [promptConfigs, promptSearchQuery, promptSortBy]);

    const closeEditor = () => {
        setEditingType(null);
        setEditingAiConfig(null);
        setEditingEmbeddingConfig(null);
        setEditingRerankerConfig(null);
        setEditingPromptConfig(null);
        setApiKeyVisible(false);
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
        const config = getCurrentEditingConfig();
        if (!config?.base_url || !config?.model) return;

        setTestingApi(true);

        try {
            await invoke("test_api_connection", {
                baseUrl: config.base_url,
                apiKey: config.api_key || "",
                model: config.model,
                configType: editingType || "ai",
            });
            message.success("连接成功");
        } catch (error) {
            message.error(String(error));
        } finally {
            setTestingApi(false);
        }
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
        const isNew = config?.id === "";
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
        config: { id: string; title: string; model: string; base_url: string; is_default: boolean };
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
                    ? "text-yellow-500 hover:text-yellow-600 cursor-pointer"
                    : "text-slate-400 hover:text-yellow-500 cursor-pointer"}
                title={config.is_default ? "取消默认" : "设为默认"}
            >
                <Star size={14} fill={config.is_default ? "currentColor" : "none"} />
            </button>
            <button
                onClick={onEdit}
                className="text-slate-400 hover:text-blue-600 text-xs cursor-pointer"
            >
                编辑
            </button>
            <button
                onClick={onDelete}
                className="text-slate-400 hover:text-red-600 cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/34 backdrop-blur-md" onClick={onCancel}>
            <div className="w-[360px] max-w-[90vw] rounded-[24px] border border-white/45 dark:border-vnote-border/80 bg-white/74 dark:bg-vnote-card/46 backdrop-blur-2xl ring-1 ring-white/30 dark:ring-white/5 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.26)]" onClick={e => e.stopPropagation()}>
                <div className="flex items-start gap-3 mb-5">
                    <div className="mt-0.5 h-10 w-10 rounded-2xl bg-red-50 dark:bg-red-500/12 border border-red-100 dark:border-red-500/20 flex items-center justify-center">
                        <Trash2 size={16} className="text-red-500 dark:text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">确认删除</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            确定要删除配置「{title}」吗？此操作无法撤销。
                        </p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-vnote-border/80 bg-white/45 dark:bg-white/5 hover:bg-white/70 dark:hover:bg-white/10 rounded-xl transition-colors cursor-pointer">取消</button>
                    <button onClick={onConfirm} className="flex-1 px-4 py-2.5 text-sm font-medium bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors shadow-sm cursor-pointer">删除</button>
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
                            "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all cursor-pointer",
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
                            "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all mt-1 cursor-pointer",
                            activeTab === "model"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover",
                        ].join(" ")}
                    >
                        <Bot size={16} />
                        模型配置
                    </button>
                    <button
                        onClick={() => setActiveTab("prompt")}
                        className={[
                            "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all mt-1 cursor-pointer",
                            activeTab === "prompt"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover",
                        ].join(" ")}
                    >
                        <MessageSquareText size={16} />
                        提示词管理
                    </button>
                    <button
                        onClick={() => setActiveTab("data-management")}
                        className={[
                            "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all mt-1 cursor-pointer",
                            activeTab === "data-management"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover",
                        ].join(" ")}
                    >
                        <HardDrive size={16} />
                        数据管理
                    </button>
                </nav>
            </aside>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            {activeTab === "general"
                                ? <SettingsIcon size={20} />
                                : activeTab === "model"
                                    ? <Bot size={20} />
                                    : activeTab === "prompt"
                                        ? <MessageSquareText size={20} />
                                        : <HardDrive size={20} />}
                            {activeTab === "general"
                                ? "常规设置"
                                : activeTab === "model"
                                    ? "模型配置"
                                    : activeTab === "prompt"
                                        ? "提示词管理"
                                        : "数据管理"}
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {activeTab === "general"
                                ? "界面显示与桌面行为"
                                : activeTab === "model"
                                    ? "配置对话模型、Embedding 和 Reranker"
                                    : activeTab === "prompt"
                                        ? "创建和管理自定义提示词模板"
                                        : "统一查看空间占用、分类清理与异常扫描"}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover/50 rounded-lg transition-colors cursor-pointer"
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
                                        <button onClick={() => handleThemeChange("light")} className={themeButtonClass("light") + " cursor-pointer"}><Sun size={16} /></button>
                                        <button onClick={() => handleThemeChange("dark")} className={themeButtonClass("dark") + " cursor-pointer"}><Moon size={16} /></button>
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
                                    <button onClick={handleTrayToggle} className={["relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer", trayEnabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"].join(" ")}>
                                        <span className={["inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform", trayEnabled ? "translate-x-6" : "translate-x-1"].join(" ")} />
                                    </button>
                                </div>
                                {/* 背景图片设置 */}
                                <div className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/70 dark:bg-vnote-card/40 backdrop-blur-xl shadow-soft overflow-hidden">
                                    <div className="flex items-center gap-4 p-5 border-b border-slate-200/70 dark:border-vnote-border/70">
                                        <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 flex items-center justify-center shadow-sm">
                                            <ImagePlus size={18} className="text-blue-500 dark:text-blue-400" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">背景图片</div>
                                            <div className="text-sm text-slate-500 dark:text-slate-400">左侧预览实际视觉效果，右侧实时调整背景强度与布局参数</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={resetBackgroundSettings}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 rounded-lg transition-colors cursor-pointer"
                                            >
                                                <RefreshCw size={13} />
                                                恢复默认
                                            </button>
                                            {backgroundImage && (
                                                <button
                                                    onClick={() => setBackgroundImage(null)}
                                                    className="px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                                                >
                                                    清除
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-5 p-5">
                                        <div className="space-y-3">
                                            <div className="text-xs font-semibold tracking-[0.18em] uppercase text-slate-400 dark:text-slate-500">Preview</div>
                                            {backgroundImage ? (
                                                <div className="group rounded-[26px] overflow-hidden border border-slate-200/80 dark:border-vnote-border/80 bg-slate-100/80 dark:bg-vnote-surface/70 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
                                                    <div className="relative aspect-[4/3] overflow-hidden">
                                                        <img
                                                            src={convertFileSrc(backgroundImage)}
                                                            alt="背景预览"
                                                            className="absolute inset-0 w-full h-full object-cover"
                                                            style={{
                                                                objectFit: backgroundSettings.size,
                                                                objectPosition: backgroundSettings.position,
                                                            }}
                                                        />
                                                        <div className="absolute inset-0" style={previewOverlayStyle} />
                                                        <div className="absolute inset-0 opacity-90" style={previewGlowStyle} />
                                                        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/35 via-white/10 to-transparent dark:from-white/10 dark:via-white/0 dark:to-transparent" />
                                                        <div className="relative z-10 h-full p-4 flex flex-col justify-between">
                                                            <div className="rounded-2xl border border-white/45 dark:border-white/10 px-4 py-3 shadow-soft ring-1 ring-white/20 dark:ring-white/5" style={previewPanelStyle}>
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <div>
                                                                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">VNote Preview</div>
                                                                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">全局背景效果</div>
                                                                    </div>
                                                                    <div className="h-8 w-8 rounded-xl bg-blue-500/15 text-blue-500 dark:text-blue-400 flex items-center justify-center">
                                                                        <SlidersHorizontal size={15} />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="rounded-2xl border border-white/35 dark:border-white/10 p-3 shadow-soft ring-1 ring-white/15 dark:ring-white/5" style={previewPanelStyle}>
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">阅读卡片</div>
                                                                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                                                                    </div>
                                                                    <div className="mt-2 h-2 rounded-full bg-slate-900/10 dark:bg-white/10" />
                                                                    <div className="mt-2 h-2 w-3/4 rounded-full bg-slate-900/10 dark:bg-white/10" />
                                                                    <div className="mt-2 h-2 w-1/2 rounded-full bg-slate-900/10 dark:bg-white/10" />
                                                                </div>
                                                                <div className="rounded-2xl border border-white/35 dark:border-white/10 p-3 shadow-soft ring-1 ring-white/15 dark:ring-white/5" style={previewPanelStyle}>
                                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400">氛围强度</div>
                                                                    <div className="mt-3 flex items-end justify-between gap-3">
                                                                        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{backgroundSettings.overlayOpacity}%</div>
                                                                        <div className="text-[11px] px-2 py-1 rounded-full bg-white/45 dark:bg-white/10 text-slate-500 dark:text-slate-400">Blur {backgroundSettings.blur}px</div>
                                                                    </div>
                                                                    <div className="mt-3 h-1.5 rounded-full bg-white/40 dark:bg-white/10 overflow-hidden">
                                                                        <div className="h-full rounded-full bg-gradient-to-r from-blue-400 via-cyan-400 to-violet-400" style={{ width: `${backgroundSettings.overlayOpacity}%` }} />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => setBackgroundImage(null)}
                                                            className="absolute top-3 right-3 z-20 p-2 bg-black/45 hover:bg-red-500/85 text-white rounded-full transition-colors cursor-pointer"
                                                        >
                                                            <XIcon size={12} />
                                                        </button>
                                                    </div>
                                                    <div className="px-4 py-3 border-t border-slate-200/70 dark:border-vnote-border/70 bg-white/60 dark:bg-vnote-card/30">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Current file</div>
                                                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">{backgroundImage}</div>
                                                            </div>
                                                            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/5 dark:bg-white/5 text-[11px] text-slate-500 dark:text-slate-400">
                                                                <SlidersHorizontal size={11} />
                                                                实时预览
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={handlePickBackgroundImage}
                                                    className="w-full aspect-[4/3] rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/80 dark:bg-vnote-surface/40 flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer"
                                                >
                                                    <div className="h-14 w-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                                                        <ImagePlus size={22} />
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-sm font-medium">选择一张背景图片</div>
                                                        <div className="text-xs mt-1">推荐横向高清图片，视觉效果更好</div>
                                                    </div>
                                                </button>
                                            )}
                                        </div>

                                        <div className="space-y-4">
                                            <div className="text-xs font-semibold tracking-[0.18em] uppercase text-slate-400 dark:text-slate-500">Controls</div>
                                            <div className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/75 dark:bg-vnote-card/35 backdrop-blur-lg p-4 space-y-4 shadow-soft">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">图片来源</div>
                                                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">更换后会立即应用到所有支持背景透出的页面</div>
                                                    </div>
                                                    <button
                                                        onClick={handlePickBackgroundImage}
                                                        className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/15 rounded-xl transition-colors cursor-pointer"
                                                    >
                                                        <ImagePlus size={15} />
                                                        {backgroundImage ? "更换图片" : "选择图片"}
                                                    </button>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="space-y-2 rounded-xl border border-slate-200/70 dark:border-vnote-border/70 bg-slate-50/80 dark:bg-vnote-surface/45 p-3">
                                                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                                                            <ScanText size={14} className="text-blue-500" />
                                                            背景遮罩强度
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <input type="range" min="20" max="90" value={backgroundSettings.overlayOpacity} onChange={(e) => updateBackgroundSettings({ overlayOpacity: parseInt(e.target.value, 10) })} className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-blue-500" />
                                                            <span className="w-10 text-right text-sm font-semibold text-slate-700 dark:text-slate-200">{backgroundSettings.overlayOpacity}%</span>
                                                        </div>
                                                        <div className="text-xs text-slate-500 dark:text-slate-400">数值越高，背景越柔和，阅读更稳定</div>
                                                    </div>

                                                    <div className="space-y-2 rounded-xl border border-slate-200/70 dark:border-vnote-border/70 bg-slate-50/80 dark:bg-vnote-surface/45 p-3">
                                                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                                                            <Focus size={14} className="text-emerald-500" />
                                                            内容底板强度
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <input type="range" min="10" max="85" value={backgroundSettings.contentOpacity} onChange={(e) => updateBackgroundSettings({ contentOpacity: parseInt(e.target.value, 10) })} className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-emerald-500" />
                                                            <span className="w-10 text-right text-sm font-semibold text-slate-700 dark:text-slate-200">{backgroundSettings.contentOpacity}%</span>
                                                        </div>
                                                        <div className="text-xs text-slate-500 dark:text-slate-400">调高后正文面板更稳重，调低后背景更有氛围</div>
                                                    </div>

                                                    <div className="space-y-2 rounded-xl border border-slate-200/70 dark:border-vnote-border/70 bg-slate-50/80 dark:bg-vnote-surface/45 p-3">
                                                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                                                            <Sparkles size={14} className="text-violet-500" />
                                                            背景模糊
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <input type="range" min="0" max="24" value={backgroundSettings.blur} onChange={(e) => updateBackgroundSettings({ blur: parseInt(e.target.value, 10) })} className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-violet-500" />
                                                            <span className="w-10 text-right text-sm font-semibold text-slate-700 dark:text-slate-200">{backgroundSettings.blur}px</span>
                                                        </div>
                                                        <div className="text-xs text-slate-500 dark:text-slate-400">轻微模糊能保留氛围感，同时减少背景干扰</div>
                                                    </div>

                                                    <div className="space-y-3 rounded-xl border border-slate-200/70 dark:border-vnote-border/70 bg-slate-50/80 dark:bg-vnote-surface/45 p-3">
                                                        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">布局方式</div>
                                                        <div className="space-y-2">
                                                            <div className="text-xs text-slate-500 dark:text-slate-400">填充</div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {([
                                                                    { label: "铺满", value: "cover" },
                                                                    { label: "完整", value: "contain" },
                                                                ] as const).map((item) => (
                                                                    <button
                                                                        key={item.value}
                                                                        onClick={() => updateBackgroundSettings({ size: item.value })}
                                                                        className={[
                                                                            "px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer",
                                                                            backgroundSettings.size === item.value
                                                                                ? "border-blue-500 bg-blue-500 text-white"
                                                                                : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                                                                        ].join(" ")}
                                                                    >
                                                                        {item.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="text-xs text-slate-500 dark:text-slate-400">定位</div>
                                                            <div className="grid grid-cols-3 gap-2">
                                                                {([
                                                                    { label: "顶部", value: "top" },
                                                                    { label: "居中", value: "center" },
                                                                    { label: "底部", value: "bottom" },
                                                                ] as const).map((item) => (
                                                                    <button
                                                                        key={item.value}
                                                                        onClick={() => updateBackgroundSettings({ position: item.value })}
                                                                        className={[
                                                                            "px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer",
                                                                            backgroundSettings.position === item.value
                                                                                ? "border-slate-900 dark:border-slate-100 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                                                                                : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                                                                        ].join(" ")}
                                                                    >
                                                                        {item.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="text-xs text-slate-500 dark:text-slate-400">附着</div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {([
                                                                    { label: "固定", value: "fixed" },
                                                                    { label: "滚动", value: "scroll" },
                                                                ] as const).map((item) => (
                                                                    <button
                                                                        key={item.value}
                                                                        onClick={() => updateBackgroundSettings({ attachment: item.value })}
                                                                        className={[
                                                                            "px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer",
                                                                            backgroundSettings.attachment === item.value
                                                                                ? "border-violet-500 bg-violet-500 text-white"
                                                                                : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                                                                        ].join(" ")}
                                                                    >
                                                                        {item.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : activeTab === "prompt" ? (
                    // Prompt tab
                    editingPromptConfig ? (
                        // Prompt editor view
                        <>
                            <div className="flex items-center gap-3 mb-6">
                                <button
                                    onClick={() => setEditingPromptConfig(null)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                                >
                                    <ArrowLeft size={20} className="text-slate-500" />
                                </button>
                                <div>
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                        {editingPromptConfig.id === "" ? "新增提示词" : "编辑提示词"}
                                    </h3>
                                    <p className="text-sm text-slate-500">创建自定义提示词模板</p>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div className="flex flex-col w-full">
                                    <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">标题</div>
                                    <input
                                        type="text"
                                        value={editingPromptConfig.title || ""}
                                        onChange={e => setEditingPromptConfig({ ...editingPromptConfig, title: e.target.value })}
                                        placeholder="例如：视频内容总结助手"
                                        className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                                    />
                                    <p className="text-sm text-slate-500 mt-2">为提示词设置一个易于识别的名称</p>
                                </div>

                                <div className="flex flex-col w-full">
                                    <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">描述</div>
                                    <input
                                        type="text"
                                        value={editingPromptConfig.description || ""}
                                        onChange={e => setEditingPromptConfig({ ...editingPromptConfig, description: e.target.value || null })}
                                        placeholder="简要说明提示词的用途和使用场景"
                                        className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                                    />
                                    <p className="text-sm text-slate-500 mt-2">可选，帮助你快速了解这个提示词的作用</p>
                                </div>

                                <div className="flex flex-col w-full">
                                    <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">提示词内容</div>
                                    <textarea
                                        value={editingPromptConfig.content || ""}
                                        onChange={e => setEditingPromptConfig({ ...editingPromptConfig, content: e.target.value })}
                                        placeholder="输入完整的 Prompt 指令内容"
                                        rows={8}
                                        className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm resize-y min-h-[200px]"
                                    />
                                    <p className="text-sm text-slate-500 mt-2">编写清晰、详细的 Prompt 指令，让 AI 能够准确理解你的需求</p>
                                </div>

                            </div>
                            <div className="flex gap-3 pt-6">
                                <button
                                    onClick={() => setEditingPromptConfig(null)}
                                    className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-md transition-colors cursor-pointer"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={savePromptConfig}
                                    disabled={!editingPromptConfig.title || !editingPromptConfig.content}
                                    className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    保存
                                </button>
                            </div>
                        </>
                    ) : (
                        // Prompt list view
                        <div className="space-y-6">
                            {/* Filter bar */}
                            <div className="flex items-center gap-3">
                                <div className="flex-1 relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={promptSearchQuery}
                                        onChange={e => setPromptSearchQuery(e.target.value)}
                                        placeholder="搜索提示词..."
                                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <select
                                    value={promptSortBy}
                                    onChange={e => setPromptSortBy(e.target.value as "recent" | "name")}
                                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="recent">最近更新</option>
                                    <option value="name">名称排序</option>
                                </select>
                                <button
                                    onClick={() => openPromptEditor(createEmptyPromptConfig())}
                                    className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 cursor-pointer"
                                >
                                    <Plus size={16} />
                                    新增提示词
                                </button>
                            </div>

                            {/* Prompt card grid */}
                            {filteredPrompts.length > 0 ? (
                                <div className="grid grid-cols-3 gap-4">
                                    {filteredPrompts.map((prompt) => {
                                        return (
                                            <div
                                                key={prompt.id}
                                                className="group relative rounded-xl overflow-hidden p-5 bg-white dark:bg-vnote-card border border-slate-200 dark:border-vnote-border hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-200 flex flex-col h-full"
                                            >
                                                <h3 className="text-slate-900 dark:text-slate-100 font-medium line-clamp-1">
                                                    {prompt.title}
                                                </h3>
                                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 line-clamp-2 flex-1">
                                                    {prompt.description || prompt.content}
                                                </p>
                                                <div className="flex gap-2 mt-4">
                                                    <button
                                                        onClick={() => openPromptEditor(prompt)}
                                                        className="flex-1 py-2 text-sm text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-700/50 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                                    >
                                                        编辑
                                                    </button>
                                                    <button
                                                        onClick={() => setDeletingPromptConfigId(prompt.id)}
                                                        className="p-2 text-slate-400 hover:text-red-500 bg-slate-100 dark:bg-slate-800/50 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="col-span-3 text-center py-16 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                                    <MessageSquareText size={48} className="mx-auto text-slate-600 mb-4" />
                                    <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400 mb-2">暂无提示词</h3>
                                    <p className="text-sm text-slate-500 mb-4">
                                        {promptSearchQuery
                                            ? "没有找到匹配的提示词"
                                            : "创建您的第一个提示词模板，提升笔记生成效率"}
                                    </p>
                                    <button
                                        onClick={() => openPromptEditor(createEmptyPromptConfig())}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto cursor-pointer"
                                    >
                                        <Plus size={16} />
                                        创建提示词
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                ) : activeTab === "data-management" ? (
                    <DataManagementSection notes={notes} />
                ) : editingType ? (
                    // Editor view
                    <>
                        <div className="flex items-center gap-3 mb-6">
                            <button
                                onClick={closeEditor}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
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
                                        className="px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
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

                            {editingType === "ai" && (
                                <div className="flex flex-col w-full">
                                    <div className="text-sm mb-3 font-bold text-slate-900 dark:text-slate-100">并发生成数</div>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            min="1"
                                            max="10"
                                            value={(currentConfig as AiConfig | null)?.concurrent_limit ?? 5}
                                            onChange={e => setCurrentEditingConfig({ concurrent_limit: Number(e.target.value) })}
                                            className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-blue-500"
                                        />
                                        <span className="text-lg font-semibold text-blue-600 dark:text-blue-400 w-8 text-center">
                                            {(currentConfig as AiConfig | null)?.concurrent_limit ?? 5}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-500 mt-3">同时生成的标签页数量，范围1-10，默认5</p>
                                </div>
                            )}

                            {editingType === "ai" && (
                                <div className="flex flex-col w-full">
                                    <div className="text-sm mb-3 font-bold text-slate-900 dark:text-slate-100">请求超时时间</div>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            min="0"
                                            max="600"
                                            step="30"
                                            value={(currentConfig as AiConfig | null)?.request_timeout ?? 180}
                                            onChange={e => setCurrentEditingConfig({ request_timeout: Number(e.target.value) })}
                                            className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-blue-500"
                                        />
                                        <span className="text-lg font-semibold text-blue-600 dark:text-blue-400 w-16 text-center">
                                            {(currentConfig as AiConfig | null)?.request_timeout === 0 ? "无限" : `${(currentConfig as AiConfig | null)?.request_timeout ?? 180}s`}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-500 mt-3">API 请求超时时间，范围0-600秒，0表示不设置超时，默认180秒</p>
                                </div>
                            )}

                            <button
                                onClick={testApiConfig}
                                disabled={testingApi || !currentConfig?.base_url || !currentConfig?.model}
                                className="w-full px-4 py-2.5 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2 border border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                                {testingApi && <Loader2 size={14} className="animate-spin" />}
                                {testingApi ? "测试中..." : "测试连接"}
                            </button>
                        </div>
                        <div className="flex gap-3 pt-6">
                            <button
                                onClick={closeEditor}
                                className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-md transition-colors cursor-pointer"
                            >
                                取消
                            </button>
                            <button
                                onClick={saveCurrentConfig}
                                className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors cursor-pointer"
                            >
                                保存
                            </button>
                        </div>
                    </>
                ) : activeTab === "model" && !editingType ? (
                    // Model list view
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
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
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
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
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
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
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
                ) : null}
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
                {deletingPromptConfigId !== null && (
                    <DeleteModal
                        title={promptConfigs.find(c => c.id === deletingPromptConfigId)?.title || "未命名"}
                        onCancel={() => setDeletingPromptConfigId(null)}
                        onConfirm={() => deletePromptConfig(deletingPromptConfigId)}
                    />
                )}
            </div>
        </div>
    );
}
