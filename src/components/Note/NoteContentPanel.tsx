import { useState, useEffect } from "react";
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
  Clock,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { invoke } from "@tauri-apps/api/core";
import type { Note } from "../../types";

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
  note: Note;
}

export function NoteContentPanel({ note }: NoteContentPanelProps) {
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
        {activeTab === "summary" && <SummaryContent note={note} />}
        {activeTab === "original" && <OriginalContent content={note.detailed_reading} />}
        {activeTab === "highlights" && <HighlightsContent content={note.highlights} />}
        {activeTab === "script" && <ScriptContent subtitlePath={note.subtitle_path} />}
        {activeTab === "visual" && <VisualContent content={note.visual_summary} />}
        {activeTab === "custom" && <CustomContent content={note.custom_summary} />}
      </div>
    </div>
  );
}

// 全文总结内容
function SummaryContent({ note }: { note: Note }) {
  const hasContent = note.full_summary;

  if (!hasContent) {
    return (
      <div className="space-y-6">
        {/* 等待生成状态 */}
        <div className="flex items-center gap-2 text-amber-500">
          <Clock className="w-4 h-4" />
          <span className="text-sm">等待 AI 生成总结...</span>
        </div>

        <div className="text-sm text-slate-500 dark:text-slate-400">
          笔记已创建，AI 总结功能即将上线。
        </div>
      </div>
    );
  }

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
        <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
          {note.full_summary}
        </div>
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
function OriginalContent({ content }: { content: string | null }) {
  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <p>原文细读内容将在 AI 分析后生成</p>
      </div>
    );
  }

  return (
    <div className="prose prose-slate dark:prose-invert max-w-none">
      <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
        {content}
      </div>
    </div>
  );
}

// 高光笔记内容
function HighlightsContent({ content }: { content: string | null }) {
  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <Highlighter className="w-12 h-12 mb-4 opacity-50" />
        <p>暂无高光笔记</p>
        <p className="text-sm mt-2">观看视频时添加高光笔记</p>
      </div>
    );
  }

  return (
    <div className="prose prose-slate dark:prose-invert max-w-none">
      <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
        {content}
      </div>
    </div>
  );
}

// 字幕脚本内容 - 直接读取字幕文件
function ScriptContent({ subtitlePath }: { subtitlePath: string | null }) {
  const [subtitleContent, setSubtitleContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subtitlePath) {
      setSubtitleContent(null);
      return;
    }

    setLoading(true);
    setError(null);

    invoke<string>("read_file_content", { path: subtitlePath })
      .then((content) => {
        setSubtitleContent(content);
      })
      .catch((err) => {
        setError(`无法读取字幕文件: ${err}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [subtitlePath]);

  if (!subtitlePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <Captions className="w-12 h-12 mb-4 opacity-50" />
        <p>未上传字幕文件</p>
        <p className="text-sm mt-2">上传视频时可选择添加字幕文件</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <p>加载字幕中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="prose prose-slate dark:prose-invert max-w-none">
      <pre className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300 font-mono bg-slate-50 dark:bg-vnote-surface p-4 rounded-lg">
        {subtitleContent}
      </pre>
    </div>
  );
}

// 视觉化总结内容
function VisualContent({ content }: { content: string | null }) {
  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <BarChart3 className="w-12 h-12 mb-4 opacity-50" />
        <p>视觉化总结 (Beta)</p>
        <p className="text-sm mt-2">即将推出</p>
      </div>
    );
  }

  return (
    <div className="prose prose-slate dark:prose-invert max-w-none">
      <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
        {content}
      </div>
    </div>
  );
}

// 自定义总结内容
function CustomContent({ content }: { content: string | null }) {
  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <Sparkles className="w-12 h-12 mb-4 opacity-50" />
        <p>自定义总结</p>
        <p className="text-sm mt-2">根据您的需求定制总结内容</p>
      </div>
    );
  }

  return (
    <div className="prose prose-slate dark:prose-invert max-w-none">
      <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
        {content}
      </div>
    </div>
  );
}
