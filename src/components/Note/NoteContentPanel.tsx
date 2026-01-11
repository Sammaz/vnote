import { useState } from "react";
import {
  FileText,
  BookOpen,
  Highlighter,
  Captions,
  BarChart3,
  Sparkles,
  Copy,
  Download,
  Share2,
  Edit3,
  RefreshCw,
  MoreHorizontal,
  CheckCircle2,
  FolderPlus,
  List,
} from "lucide-react";
import { cn } from "../../utils/cn";

type TabId = "summary" | "original" | "highlights" | "script" | "visual" | "custom";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "summary", label: "全文总结", icon: <FileText className="w-4 h-4" /> },
  { id: "original", label: "原文细读", icon: <BookOpen className="w-4 h-4" /> },
  { id: "highlights", label: "高光笔记", icon: <Highlighter className="w-4 h-4" /> },
  { id: "script", label: "字幕脚本", icon: <Captions className="w-4 h-4" /> },
  { id: "visual", label: "视觉化总结", icon: <BarChart3 className="w-4 h-4" /> },
  { id: "custom", label: "自定义总结", icon: <Sparkles className="w-4 h-4" /> },
];

interface NoteContentPanelProps {
  noteTitle: string;
  noteContent: string;
}

export function NoteContentPanel({ noteTitle, noteContent }: NoteContentPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");

  return (
    <div className="flex flex-col h-full bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border overflow-hidden">
      {/* 标签页头部 */}
      <div className="flex items-center border-b border-slate-200 dark:border-vnote-border">
        <div className="flex-1 flex items-center overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-blue-500 text-blue-500"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.id === "highlights" && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-slate-200 dark:bg-vnote-surface rounded">
                  0
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border">
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            <FolderPlus className="w-4 h-4" />
            添加合集
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            <List className="w-4 h-4" />
            章节
            <span className="ml-1 text-xs text-slate-400">(6)</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            <Copy className="w-4 h-4" />
            复制
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            <Download className="w-4 h-4" />
            下载
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors">
            <Share2 className="w-4 h-4" />
            分享
          </button>
          <button className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 次级工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            <Edit3 className="w-4 h-4" />
            编辑
          </button>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            思维导图
          </button>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
          <RefreshCw className="w-4 h-4" />
          重新总结
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "summary" && (
          <SummaryContent noteTitle={noteTitle} noteContent={noteContent} />
        )}
        {activeTab === "original" && <OriginalContent />}
        {activeTab === "highlights" && <HighlightsContent />}
        {activeTab === "script" && <ScriptContent />}
        {activeTab === "visual" && <VisualContent />}
        {activeTab === "custom" && <CustomContent />}
      </div>
    </div>
  );
}

// 全文总结内容
function SummaryContent({ noteTitle: _noteTitle, noteContent }: { noteTitle: string; noteContent: string }) {
  return (
    <div className="space-y-6">
      {/* 状态标签 */}
      <div className="flex items-center gap-2 text-green-500">
        <CheckCircle2 className="w-4 h-4" />
        <span className="text-sm">总结完成</span>
      </div>

      {/* 摘要 */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">摘要</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {noteContent || "正在生成摘要内容..."}
        </p>
      </section>

      {/* 亮点 */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">亮点</h2>
        <ul className="space-y-2">
          <li className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-blue-500 mt-0.5">📘</span>
            <span>核心概念和原理解析</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-yellow-500 mt-0.5">💡</span>
            <span>实践技巧和最佳实践</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-green-500 mt-0.5">🌐</span>
            <span>框架对比和选择建议</span>
          </li>
        </ul>
      </section>

      {/* 标签 */}
      <section>
        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-1 text-xs bg-slate-100 dark:bg-vnote-surface text-slate-600 dark:text-slate-400 rounded-full">
            #学习笔记
          </span>
          <span className="px-3 py-1 text-xs bg-slate-100 dark:bg-vnote-surface text-slate-600 dark:text-slate-400 rounded-full">
            #技术分享
          </span>
          <span className="px-3 py-1 text-xs bg-slate-100 dark:bg-vnote-surface text-slate-600 dark:text-slate-400 rounded-full">
            #教程
          </span>
        </div>
      </section>

      {/* 疑问解答 */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">疑问解答</h2>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              1. 这个视频的核心内容是什么？
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 pl-4">
              视频主要讲解了相关技术的核心概念和实践应用...
            </p>
          </div>
        </div>
      </section>

      {/* 术语表 */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">术语表</h2>
        <div className="space-y-2">
          <div className="text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">术语名称：</span>
            <span className="text-slate-600 dark:text-slate-400">术语的解释说明</span>
          </div>
        </div>
      </section>
    </div>
  );
}

// 原文细读内容
function OriginalContent() {
  return (
    <div className="flex items-center justify-center h-full text-slate-400">
      <p>原文细读功能开发中...</p>
    </div>
  );
}

// 高光笔记内容
function HighlightsContent() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400">
      <Highlighter className="w-12 h-12 mb-4 opacity-50" />
      <p>暂无高光笔记</p>
      <p className="text-sm mt-2">观看视频时添加高光笔记</p>
    </div>
  );
}

// 字幕脚本内容
function ScriptContent() {
  return (
    <div className="flex items-center justify-center h-full text-slate-400">
      <p>字幕脚本功能开发中...</p>
    </div>
  );
}

// 视觉化总结内容
function VisualContent() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400">
      <BarChart3 className="w-12 h-12 mb-4 opacity-50" />
      <p>视觉化总结 (Beta)</p>
      <p className="text-sm mt-2">即将推出</p>
    </div>
  );
}

// 自定义总结内容
function CustomContent() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400">
      <Sparkles className="w-12 h-12 mb-4 opacity-50" />
      <p>自定义总结</p>
      <p className="text-sm mt-2">根据您的需求定制总结内容</p>
    </div>
  );
}
