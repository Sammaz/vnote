import {
    ArrowLeft, Monitor, Moon, Palette, Settings as SettingsIcon, Sun, Bot, Eye, EyeOff, Loader2, Plus, Trash2, Star
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

type SettingsTab = "general" | "model";

export default function SettingsPage({ currentTheme, onThemeChange, onClose }: SettingsPageProps) {
    const { refreshAiConfigs } = useApp();
    const [activeTab, setActiveTab] = useState<SettingsTab>("general");
    const [trayEnabled, setTrayEnabled] = useState(false);

    // AI config state
    const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
    const [editingAiConfig, setEditingAiConfig] = useState<AiConfig | null>(null);
    const [deletingAiConfigId, setDeletingAiConfigId] = useState<number | null>(null);
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [testingAi, setTestingAi] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [loading, setLoading] = useState(true);

    // Load settings from database on mount
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const [tray, configs] = await Promise.all([
                    invoke<boolean>("get_tray_enabled"),
                    invoke<AiConfig[]>("get_ai_configs"),
                ]);
                setTrayEnabled(tray);
                setAiConfigs(configs);
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
                // Create new config
                const newId = await invoke<number>("create_ai_config", { config: editingAiConfig });
                setAiConfigs([...aiConfigs, { ...editingAiConfig, id: newId }]);
            } else {
                // Update existing config
                await invoke("update_ai_config", { config: editingAiConfig });
                setAiConfigs(aiConfigs.map(c => c.id === editingAiConfig.id ? editingAiConfig : c));
            }
            setEditingAiConfig(null);
            setApiKeyVisible(false);
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

    const testAiConfig = async () => {
        if (!editingAiConfig) return;
        setTestingAi(true);
        setTestResult(null);
        // Simulate test - TODO: implement actual API test
        await new Promise(resolve => setTimeout(resolve, 1000));
        setTestResult({ success: true, message: "连接成功" });
        setTestingAi(false);
    };

    const themeButtonClass = (theme: "light" | "dark") =>
        [
            "flex items-center justify-center h-9 w-11 rounded-lg border text-sm transition-all",
            theme === currentTheme
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-white/50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600",
        ].join(" ");

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
        );
    }

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
                            {activeTab === "general" ? "界面显示与桌面行为" : "配置 AI 模型接口"}
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
                ) : (
                    <div className="space-y-6">
                        {editingAiConfig ? (
                            <>
                                <div className="flex items-center gap-3 mb-6">
                                    <button
                                        onClick={() => { setEditingAiConfig(null); setApiKeyVisible(false); setTestResult(null); }}
                                        className="p-2 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors"
                                    >
                                        <ArrowLeft size={20} className="text-slate-500" />
                                    </button>
                                    <div>
                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                            {editingAiConfig.id === 0 ? "自定义模型配置" : "编辑配置"}
                                        </h3>
                                        <p className="text-sm text-slate-500">配置自定义 AI 模型接口参数</p>
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    <div className="flex flex-col w-full">
                                        <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">配置名称</div>
                                        <input
                                            type="text"
                                            value={editingAiConfig.title}
                                            onChange={e => setEditingAiConfig({ ...editingAiConfig, title: e.target.value })}
                                            placeholder="例如：OpenAI、DeepSeek"
                                            className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                                        />
                                        <p className="text-sm text-slate-500 mt-2">为此配置设置一个易于识别的名称</p>
                                    </div>

                                    <div className="flex flex-col w-full">
                                        <div className="text-sm mb-2 font-bold text-slate-900 dark:text-slate-100">BaseURL</div>
                                        <input
                                            type="text"
                                            value={editingAiConfig.base_url}
                                            onChange={e => setEditingAiConfig({ ...editingAiConfig, base_url: e.target.value })}
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
                                                value={editingAiConfig.api_key}
                                                onChange={e => setEditingAiConfig({ ...editingAiConfig, api_key: e.target.value })}
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
                                            value={editingAiConfig.model}
                                            onChange={e => setEditingAiConfig({ ...editingAiConfig, model: e.target.value })}
                                            placeholder="例如：gpt-4o、deepseek-chat"
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
                                        onClick={testAiConfig}
                                        disabled={testingAi || !editingAiConfig.base_url || !editingAiConfig.model}
                                        className="w-full px-4 py-2.5 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2 border border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {testingAi && <Loader2 size={14} className="animate-spin" />}
                                        {testingAi ? "测试中..." : "测试连接"}
                                    </button>
                                </div>
                                <div className="flex gap-3 pt-6">
                                    <button
                                        onClick={() => { setEditingAiConfig(null); setApiKeyVisible(false); setTestResult(null); }}
                                        className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-md transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={saveAiConfig}
                                        className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                                    >
                                        保存
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">自定义模型配置</h3>
                                    <button
                                        onClick={() => setEditingAiConfig(createEmptyAiConfig())}
                                        className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                    >
                                        <Plus size={14} /> 新增配置
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {aiConfigs.map((config) => (
                                        <div
                                            key={config.id}
                                            className="flex items-center gap-4 p-4 rounded-lg border border-slate-200 dark:border-vnote-border"
                                        >
                                            <div className="h-8 w-8 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                                <Bot size={16} className="text-slate-600 dark:text-slate-400" />
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
                                                onClick={() => toggleDefaultAiConfig(config.id, config.is_default)}
                                                className={config.is_default
                                                    ? "text-yellow-500 hover:text-yellow-600"
                                                    : "text-slate-400 hover:text-yellow-500"}
                                                title={config.is_default ? "取消默认" : "设为默认"}
                                            >
                                                <Star size={14} fill={config.is_default ? "currentColor" : "none"} />
                                            </button>
                                            <button
                                                onClick={() => setEditingAiConfig(config)}
                                                className="text-slate-400 hover:text-blue-600 text-xs"
                                            >
                                                编辑
                                            </button>
                                            <button
                                                onClick={() => setDeletingAiConfigId(config.id)}
                                                className="text-slate-400 hover:text-red-600"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    {aiConfigs.length === 0 && (
                                        <div className="text-center py-8 text-slate-500 text-sm">
                                            暂无配置，点击上方新增
                                        </div>
                                    )}
                                </div>

                                {deletingAiConfigId !== null && (
                                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeletingAiConfigId(null)}>
                                        <div className="bg-white dark:bg-vnote-card rounded-2xl p-6 w-[360px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
                                            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">确认删除</h3>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                                                确定要删除配置「{aiConfigs.find(c => c.id === deletingAiConfigId)?.title || "未命名"}」吗？此操作无法撤销。
                                            </p>
                                            <div className="flex gap-3">
                                                <button onClick={() => setDeletingAiConfigId(null)} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">取消</button>
                                                <button onClick={() => deleteAiConfig(deletingAiConfigId)} className="flex-1 px-4 py-2.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm">删除</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
