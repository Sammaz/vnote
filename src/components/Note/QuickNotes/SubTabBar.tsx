/**
 * 随手笔记子标签页切换栏
 */

import { FileText, Network, Palette } from "lucide-react";
import { cn } from "../../../utils/cn";

export type QuickNotesSubTab = "richtext" | "mindmap" | "canvas";

interface SubTab {
  id: QuickNotesSubTab;
  label: string;
  icon: React.ReactNode;
}

const SUB_TABS: SubTab[] = [
  { id: "richtext", label: "富文本编辑", icon: <FileText className="w-4 h-4" /> },
  { id: "mindmap", label: "思维导图", icon: <Network className="w-4 h-4" /> },
  { id: "canvas", label: "无限画布", icon: <Palette className="w-4 h-4" /> },
];

interface SubTabBarProps {
  activeTab: QuickNotesSubTab;
  onTabChange: (tab: QuickNotesSubTab) => void;
}

export function SubTabBar({ activeTab, onTabChange }: SubTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
      {SUB_TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
            activeTab === tab.id
              ? "bg-white dark:bg-vnote-card text-blue-600 dark:text-blue-400 shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
