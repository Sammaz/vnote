import { useState, useEffect, useCallback } from "react";
import { Search, MessageSquare, Settings2, BookOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../../utils/cn";
import { KnowledgeBaseSearch } from "./KnowledgeBaseSearch";
import { KnowledgeBaseChat } from "./KnowledgeBaseChat";
import { KnowledgeBaseManage } from "./KnowledgeBaseManage";
import type { KnowledgeBaseStats } from "./types";

type TabType = "search" | "chat" | "manage";

export function KnowledgeBasePage() {
  const [activeTab, setActiveTab] = useState<TabType>("search");
  const [stats, setStats] = useState<KnowledgeBaseStats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const s = await invoke<KnowledgeBaseStats>("knowledge_base_get_stats");
      setStats(s);
    } catch (e) {
      console.error("Failed to load knowledge base stats:", e);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: "search", label: "搜索", icon: <Search className="w-4 h-4" /> },
    { key: "chat", label: "对话", icon: <MessageSquare className="w-4 h-4" /> },
    { key: "manage", label: "管理", icon: <Settings2 className="w-4 h-4" /> },
  ];

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-slate-50/12 dark:bg-vnote-bg/8 backdrop-blur-[2px]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-vnote-border/80 bg-white/72 dark:bg-vnote-card/36 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            知识库
          </h2>
          {stats && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {stats.indexed_notes}/{stats.notes_with_summary} 已索引 · {stats.total_chunks} 分块
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-3 pb-0 border-b border-slate-200/60 dark:border-vnote-border/60 bg-white/42 dark:bg-vnote-card/20 backdrop-blur-md">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors cursor-pointer",
              activeTab === tab.key
                ? "bg-slate-100 dark:bg-neutral-800 text-blue-600 dark:text-blue-400"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-800/50"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-white/16 dark:bg-black/8 backdrop-blur-[3px]">
        {activeTab === "search" && <KnowledgeBaseSearch />}
        {activeTab === "chat" && <KnowledgeBaseChat />}
        {activeTab === "manage" && <KnowledgeBaseManage onStatsChange={loadStats} />}
      </div>
    </div>
  );
}
