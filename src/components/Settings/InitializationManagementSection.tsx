import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Square,
} from "lucide-react";

import { useApp } from "../../context/AppContext";
import {
  useInitializationRuntime,
  type InitializationTaskParams,
} from "../../context/InitializationRuntimeContext";
import { message } from "../../utils/message";
import type { Note, PromptConfig } from "../../types";

type RunStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "partial_failed"
  | "failed"
  | "canceled";
type ItemStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "skipped"
  | "failed"
  | "blocked"
  | "canceled";

type StepKey = "notes" | "items" | "run";
type NoteFilter =
  | "all"
  | "pending"
  | "running"
  | "failed"
  | "completed"
  | "has_subtitle"
  | "no_subtitle";
type OpenDropdown = "note-filter" | "reference-model" | null;

interface InitializationItemDefinition {
  item_key: string;
  display_name: string;
  description: string;
  dependencies: string[];
  output_target: string;
  default_config: unknown;
}

interface NoteInitializationOverview {
  note_id: string;
  note_title: string;
  subtitle_path: string | null;
  run_status: RunStatus;
  selected_count: number;
  completed_count: number;
  skipped_count: number;
  failed_count: number;
  running_count: number;
  output_count: number;
  updated_at: string;
}

interface NoteInitializationItem {
  id: string;
  note_id: string;
  item_key: string;
  selected: boolean;
  locked: boolean;
  status: ItemStatus;
  config_json: string | null;
  depends_on: string[];
  last_model_id: string | null;
  last_error: string | null;
  output_present: boolean;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface NoteInitializationDetail {
  run: {
    id: string;
    note_id: string;
    status: RunStatus;
    model_override_id: string | null;
    last_error: string | null;
    started_at: string | null;
    completed_at: string | null;
    updated_at: string;
  } | null;
  items: NoteInitializationItem[];
}


const runStatusLabelMap: Record<RunStatus, string> = {
  idle: "待处理",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  partial_failed: "部分失败",
  failed: "失败",
  canceled: "已取消",
};

const runtimeTaskStatusLabelMap: Record<
  "waiting" | "running" | "completed" | "partial_failed" | "failed" | "aborted",
  string
> = {
  waiting: "等待中",
  running: "运行中",
  completed: "已完成",
  partial_failed: "部分失败",
  failed: "失败",
  aborted: "已取消",
};

const itemStatusLabelMap: Record<ItemStatus, string> = {
  pending: "待处理",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  skipped: "已跳过",
  failed: "失败",
  blocked: "阻塞",
  canceled: "已取消",
};

const noteFilterOptions: Array<{ value: NoteFilter; label: string }> = [
  { value: "all", label: "全部笔记" },
  { value: "pending", label: "待处理" },
  { value: "running", label: "运行中" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "已完成" },
  { value: "has_subtitle", label: "有字幕" },
  { value: "no_subtitle", label: "无字幕" },
];

function expandDependencies(
  selected: Set<string>,
  dependencyMap: Map<string, string[]>
): Set<string> {
  const expanded = new Set(selected);
  const queue = [...selected];

  while (queue.length > 0) {
    const key = queue.shift()!;
    const dependencies = dependencyMap.get(key) ?? [];
    for (const dep of dependencies) {
      if (!expanded.has(dep)) {
        expanded.add(dep);
        queue.push(dep);
      }
    }
  }

  return expanded;
}

function normalizeSelection(
  explicitSelected: Set<string>,
  registry: InitializationItemDefinition[]
): { selected: Set<string>; locked: Set<string> } {
  const registrySet = new Set(registry.map((item) => item.item_key));
  const dependencyMap = new Map(
    registry.map((item) => [item.item_key, item.dependencies])
  );
  const validExplicit = new Set(
    Array.from(explicitSelected).filter((key) => registrySet.has(key))
  );
  const selected = expandDependencies(validExplicit, dependencyMap);
  const locked = new Set(
    Array.from(selected).filter((key) => !validExplicit.has(key))
  );
  return { selected, locked };
}

function safeJsonParse(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getRegenerate(item: NoteInitializationItem): boolean {
  const config = safeJsonParse(item.config_json);
  return Boolean(config.regenerate);
}

function setRegenerate(
  item: NoteInitializationItem,
  regenerate: boolean
): NoteInitializationItem {
  const config = safeJsonParse(item.config_json);
  config.regenerate = regenerate;
  return {
    ...item,
    config_json: JSON.stringify(config),
  };
}

function getRunStatusBadgeTone(
  status: RunStatus
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "running":
      return "info";
    case "queued":
      return "warning";
    case "completed":
      return "success";
    case "failed":
    case "partial_failed":
    case "canceled":
      return "danger";
    default:
      return "neutral";
  }
}

function getRuntimeTaskStatusBadgeTone(
  status: "waiting" | "running" | "completed" | "partial_failed" | "failed" | "aborted"
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "waiting":
      return "warning";
    case "running":
      return "info";
    case "completed":
      return "success";
    case "partial_failed":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function getItemStatusBadgeClass(status: ItemStatus) {
  switch (status) {
    case "running":
    case "queued":
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-900/40";
    case "completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/40";
    case "failed":
    case "blocked":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/40";
    case "skipped":
    case "canceled":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/40";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600";
  }
}

const glassPanelClass =
  "rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/72 dark:bg-vnote-card/85 shadow-[0_10px_30px_rgba(15,23,42,0.06)] dark:shadow-[0_16px_40px_rgba(2,6,23,0.32)] backdrop-blur-xl";
const softSurfaceClass =
  "rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(248,250,252,0.58))] dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.58),rgba(15,23,42,0.7))] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const secondaryButtonClass =
  "px-3 py-2 text-sm rounded-xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/55 dark:bg-slate-800/55 text-slate-700 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-vnote-hover hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-50 transition-all cursor-pointer shadow-sm";
const primaryButtonClass =
  "px-3.5 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:shadow-[0_10px_24px_rgba(37,99,235,0.3)] transition-all";
const dangerButtonClass =
  "px-3 py-2 text-sm rounded-xl border border-red-200/90 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50 flex items-center gap-2 cursor-pointer transition-all";
const warningButtonClass =
  "px-3 py-2 text-sm rounded-xl border border-amber-200/90 text-amber-700 hover:bg-amber-50 dark:border-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/20 disabled:opacity-50 flex items-center gap-2 cursor-pointer transition-all";
const tertiaryButtonClass =
  "px-3 py-2 text-sm rounded-xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/55 dark:bg-slate-800/55 text-slate-700 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-vnote-hover hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-50 transition-all cursor-pointer";
const wideTertiaryButtonClass =
  `${tertiaryButtonClass} min-w-[132px] inline-flex items-center justify-center`;
const chipButtonClass =
  "px-2.5 py-1.5 rounded-xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/50 dark:bg-slate-800/44 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100/65 dark:hover:bg-vnote-hover hover:border-slate-300 dark:hover:border-slate-600 transition-all cursor-pointer";
const subtleDangerButtonClass =
  "text-[11px] font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors cursor-pointer";
const premiumInputClass =
  "w-full px-3 py-2.5 rounded-xl border border-slate-200/80 dark:border-slate-600/80 bg-white/68 dark:bg-slate-800/80 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all";
const premiumDropdownButtonClass =
  "w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200/80 dark:border-slate-600/80 bg-white/68 dark:bg-slate-800/80 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all truncate shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";
const premiumDropdownMenuClass =
  "absolute z-50 mt-2 w-full right-0 rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-white/78 dark:bg-slate-800/95 shadow-[0_18px_40px_rgba(15,23,42,0.12)] dark:shadow-[0_20px_44px_rgba(2,6,23,0.5)] backdrop-blur-xl py-1.5 max-h-72 overflow-auto";
const summaryStripClass =
  "rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(248,250,252,0.52))] dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.42),rgba(15,23,42,0.72))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const infoSurfaceClass =
  "rounded-2xl border border-blue-200/75 dark:border-blue-900/40 bg-[linear-gradient(180deg,rgba(239,246,255,0.58),rgba(219,234,254,0.32))] dark:bg-[linear-gradient(180deg,rgba(30,64,175,0.16),rgba(15,23,42,0.82))] p-3.5 space-y-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]";
const warningSurfaceClass =
  "rounded-2xl border border-amber-200/75 dark:border-amber-900/40 bg-[linear-gradient(180deg,rgba(255,251,235,0.62),rgba(254,243,199,0.28))] dark:bg-[linear-gradient(180deg,rgba(120,53,15,0.14),rgba(15,23,42,0.82))] p-3.5 space-y-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]";
const dangerSurfaceClass =
  "rounded-2xl border border-red-200/75 dark:border-red-900/40 bg-[linear-gradient(180deg,rgba(254,242,242,0.62),rgba(254,226,226,0.26))] dark:bg-[linear-gradient(180deg,rgba(127,29,29,0.14),rgba(15,23,42,0.82))] p-3.5 space-y-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]";
const inlineDangerActionClass =
  "text-xs font-medium text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors cursor-pointer";
const sectionEyebrowClass =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600/80 dark:text-blue-300/80";
const sectionTitleClass =
  "text-sm font-semibold tracking-[0.01em] text-slate-900 dark:text-slate-100";
const sectionDescriptionClass =
  "mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400";
const dashboardToggleButtonClass =
  "w-full px-4 md:px-5 py-4 flex items-center justify-between gap-3 hover:bg-slate-50/90 dark:hover:bg-vnote-hover cursor-pointer transition-colors";
const configPanelClass =
  "rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-900/30 p-3 space-y-3";
const configLabelClass =
  "text-xs font-medium text-slate-600 dark:text-slate-300";
const configToggleBtnClass =
  "relative w-11 h-6 rounded-full transition-all duration-200 ease-in-out cursor-pointer";
const configToggleKnobClass =
  "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-200 ease-in-out";

const CONFIGURABLE_ITEM_KEYS = new Set(["full_summary", "custom_summary", "ai_note"]);

const DEFAULT_CUSTOM_SUMMARY_PROMPT = `你是一位高效的学习笔记整理专家。请基于以下视频字幕，生成一份面向实际应用的精炼总结。

输出要求：
1. 使用 Markdown 格式，结构紧凑，适合快速回顾
2. 使用中文输出，专有名词保留英文
3. 严格按照以下格式：

## 一句话概括
用一句话（30字以内）说清这个视频讲了什么。

## 核心要点
用编号列表提炼 3-5 个最重要的观点或结论，每条 1-2 句话，前面加合适的 emoji。

## 行动清单
提炼出可以直接落地执行的建议或步骤，以任务清单（- [ ]）格式输出。

## 值得深挖
列出视频中提到但未展开、值得进一步学习的概念或资源（1-3 条）。`;

const AI_NOTE_STYLE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: "concise", label: "简洁", description: "更聚焦核心结论与重点，适合快速复习。" },
  { value: "detailed", label: "详细", description: "兼顾概念、步骤与细节，适合系统学习。" },
  { value: "outline", label: "大纲", description: "更强调标题层级与结构，便于转换脑图。" },
];

const AI_NOTE_SCREENSHOT_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: "off", label: "关闭", description: "仅生成文字笔记，不插入关键帧截图。" },
  { value: "few", label: "少量", description: "仅在最关键章节插入少量截图，适合快速回看。" },
  { value: "moderate", label: "适中", description: "每个主要章节配一张截图，兼顾结构与可回看性。" },
  { value: "dense", label: "密集", description: "尽可能保留更多视觉节点，适合演示型视频。" },
];

function generateFullSummaryPrompt(options: {
  language: "zh" | "en";
  showEmoji: boolean;
  showTimestamp: boolean;
  highlightCount: number;
  sentenceLength: number;
}): string {
  const { language, showEmoji, showTimestamp, highlightCount, sentenceLength } = options;
  const emojiEx = showEmoji ? "🔥 " : "";
  const emojiEx2 = showEmoji ? "💡 " : "";
  const tsEx = showTimestamp ? " [00:01:23]" : "";

  if (language === "en") {
    return `You are a professional video content analyst. Analyze the following video subtitles and generate a structured summary.

Output Requirements:
1. Use Markdown format (do not use code block markers)
2. Must output ALL content in English
3. Use natural, coherent paragraph-style writing. Do NOT use line-by-line listing or fragmented one-sentence-per-line style.
4. Follow this exact format:

# Summary
Summarize the video's topic, core arguments, and key conclusions in 3-5 coherent sentences (each sentence no more than ${sentenceLength} words). Write as a complete natural paragraph.

# Key Highlights
Extract the most important ${highlightCount} key points/highlights${showTimestamp ? ", and add the video timestamp (format: [00:01:23]) after each highlight title" : ""}${showEmoji ? ", and add an appropriate emoji symbol before each highlight title" : ""}

## ${emojiEx}Highlight Title 1${tsEx}
Describe in 3-5 sentences: what this highlight covers, why it matters, and what practical significance or insight it offers. Write as a natural paragraph, not a bullet list.

## ${emojiEx2}Highlight Title 2
Describe in 3-5 sentences: what this highlight covers, why it matters, and what practical significance or insight it offers. Write as a natural paragraph, not a bullet list.

(Continue with ${highlightCount} highlights)

# Key Terms
- **Term 1**: Explanation
- **Term 2**: Explanation

Video subtitles content:`;
  }

  return `你是一个专业的视频内容分析师。请分析以下视频字幕，生成一份结构化的全文总结。

输出要求：
1. 使用 Markdown 格式输出（不要使用代码块标记）
2. 必须使用中文输出所有内容
3. 使用自然连贯的段落式写作，禁止逐行罗列或一行一句的碎片化风格
4. 严格按照以下格式输出：

# 摘要
用3-5句连贯的话概括视频的主题、核心论点和关键结论，每句话不超过${sentenceLength}字，写成一个完整的自然段落。

# 核心亮点
提取最重要的${highlightCount}个知识点/亮点${showEmoji ? "，每个亮点标题前必须添加一个合适的 emoji 表情符号（如 🔥 💡 📊 🎯 ⚡）" : ""}${showTimestamp ? "，并在每个亮点标题后标注该亮点对应的视频时间戳（格式如 [00:01:23]）" : ""}

## ${emojiEx}亮点标题1${tsEx}
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

## ${emojiEx2}亮点标题2
用3-5句话展开描述：这个亮点讲了什么、为什么重要、有什么实际意义或启发。写成自然段落，不要逐条罗列。

（继续提取${highlightCount}个亮点）

# 关键术语
- **术语1**：解释
- **术语2**：解释

视频字幕内容：`;
}

function MiniBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger" | "strong-info";
}) {
  const toneClass =
    tone === "info"
      ? "border-blue-200 bg-blue-100/50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-100/50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300"
        : tone === "warning"
          ? "border-amber-200 bg-amber-100/50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300"
          : tone === "danger"
            ? "border-red-200 bg-red-100/50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
            : tone === "strong-info"
              ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500 dark:text-white"
              : "border-slate-200 bg-slate-100/50 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${toneClass}`}>
      {children}
    </span>
  );
}

function HelperBlock({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: "default" | "muted";
  className?: string;
}) {
  const toneClass =
    tone === "muted"
      ? "border-slate-200 bg-slate-50/55 dark:border-slate-700 dark:bg-slate-800/50"
      : "border-slate-200 bg-white/50 dark:border-slate-700 dark:bg-slate-800/45";

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-xs leading-5 text-slate-500 dark:text-slate-400 ${toneClass} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/* ---------- Item Config Panel ---------- */

interface ItemConfigPanelProps {
  itemKey: string;
  config: Record<string, unknown>;
  onConfigChange: (updater: (c: Record<string, unknown>) => Record<string, unknown>) => void;
  promptConfigs: PromptConfig[];
}

function ItemConfigPanel({ itemKey, config, onConfigChange, promptConfigs }: ItemConfigPanelProps) {
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);
  const promptDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (promptDropdownRef.current && !promptDropdownRef.current.contains(e.target as Node)) {
        setShowPromptDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (itemKey === "full_summary") {
    const ui = (config._ui as Record<string, unknown>) ?? {};
    const language = (ui.language as "zh" | "en") ?? "zh";
    const showEmoji = ui.showEmoji !== undefined ? Boolean(ui.showEmoji) : true;
    const showTimestamp = Boolean(ui.showTimestamp ?? false);
    const highlightCount = Number(ui.highlightCount ?? 5);
    const sentenceLength = Number(ui.sentenceLength ?? 30);

    const updateUi = (patch: Record<string, unknown>) => {
      const newUi = { language, showEmoji, showTimestamp, highlightCount, sentenceLength, ...patch };
      const prompt = generateFullSummaryPrompt({
        language: newUi.language as "zh" | "en",
        showEmoji: Boolean(newUi.showEmoji),
        showTimestamp: Boolean(newUi.showTimestamp),
        highlightCount: Number(newUi.highlightCount),
        sentenceLength: Number(newUi.sentenceLength),
      });
      onConfigChange((c) => ({ ...c, _ui: newUi, custom_prompt: prompt }));
    };

    return (
      <div className={configPanelClass}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {/* 输出语言 */}
          <div className="flex items-center justify-between">
            <span className={configLabelClass}>输出语言</span>
            <button
              onClick={() => updateUi({ language: language === "zh" ? "en" : "zh" })}
              className="px-2.5 py-1 rounded-lg border border-slate-200/80 dark:border-slate-600/80 bg-white/52 dark:bg-slate-800/60 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-700 transition-colors cursor-pointer min-w-[56px] text-center"
            >
              {language === "zh" ? "中文" : "EN"}
            </button>
          </div>

          {/* 是否显示 Emoji */}
          <div className="flex items-center justify-between">
            <span className={configLabelClass}>显示 Emoji</span>
            <button
              onClick={() => updateUi({ showEmoji: !showEmoji })}
              className={`${configToggleBtnClass} ${showEmoji ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-600"}`}
            >
              <span className={`${configToggleKnobClass} ${showEmoji ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>

          {/* 是否显示时间戳 */}
          <div className="flex items-center justify-between">
            <span className={configLabelClass}>显示时间戳</span>
            <button
              onClick={() => updateUi({ showTimestamp: !showTimestamp })}
              className={`${configToggleBtnClass} ${showTimestamp ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-600"}`}
            >
              <span className={`${configToggleKnobClass} ${showTimestamp ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>

          {/* 要点个数 */}
          <div className="flex items-center justify-between gap-2">
            <span className={configLabelClass}>要点个数</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="1"
                max="15"
                value={highlightCount}
                onChange={(e) => updateUi({ highlightCount: Number(e.target.value) })}
                className="w-16 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 w-5 text-center">{highlightCount}</span>
            </div>
          </div>

          {/* 句子长短 */}
          <div className="col-span-2 flex items-center justify-between gap-2">
            <span className={configLabelClass}>句子长短</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="10"
                max="40"
                step="5"
                value={sentenceLength}
                onChange={(e) => updateUi({ sentenceLength: Number(e.target.value) })}
                className="w-24 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 w-5 text-center">{sentenceLength}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (itemKey === "custom_summary") {
    const customPrompt = (config.custom_prompt as string) ?? DEFAULT_CUSTOM_SUMMARY_PROMPT;

    return (
      <div className={configPanelClass}>
        {/* 预配置提示词 */}
        <div className="flex items-center justify-between">
          <span className={configLabelClass}>提示词内容</span>
          <div className="flex items-center gap-1.5">
            {customPrompt !== DEFAULT_CUSTOM_SUMMARY_PROMPT && (
              <button
                type="button"
                onClick={() => onConfigChange((c) => ({ ...c, custom_prompt: DEFAULT_CUSTOM_SUMMARY_PROMPT }))}
                className="px-2 py-0.5 rounded-lg text-[10px] text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all cursor-pointer"
              >
                恢复默认
              </button>
            )}
            {promptConfigs.length > 0 && (
              <div className="relative" ref={promptDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowPromptDropdown(!showPromptDropdown)}
                  className="px-2.5 py-1 pr-7 rounded-lg border border-slate-200/80 dark:border-slate-600/80 bg-white/52 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300 text-left cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all"
                >
                  选择提示词
                </button>
                <ChevronDown className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none transition-transform ${showPromptDropdown ? "rotate-180" : ""}`} />
                {showPromptDropdown && (
                  <div className={`${premiumDropdownMenuClass} w-56`}>
                    {promptConfigs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onConfigChange((c) => ({ ...c, custom_prompt: p.content }));
                          setShowPromptDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-300 cursor-pointer"
                      >
                        <div className="font-medium truncate">{p.title}</div>
                        {p.description && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{p.description}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 提示词内容 */}
        <div>
          <textarea
            value={customPrompt}
            onChange={(e) => onConfigChange((c) => ({ ...c, custom_prompt: e.target.value }))}
            placeholder="输入自定义提示词，AI 将按照此提示词生成总结..."
            rows={6}
            className={`${premiumInputClass} resize-none text-xs !py-2`}
          />
        </div>
      </div>
    );
  }

  if (itemKey === "ai_note") {
    const style = (config.style as string) || "detailed";
    const screenshotDensity = (config.screenshot_density as string) || "moderate";
    const customPrompt = (config.custom_prompt as string) ?? "";

    return (
      <div className={configPanelClass}>
        {/* 笔记风格 */}
        <div>
          <span className={`${configLabelClass} block mb-2`}>笔记风格</span>
          <div className="grid grid-cols-3 gap-1.5">
            {AI_NOTE_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onConfigChange((c) => ({ ...c, style: opt.value }))}
                className={`rounded-lg border px-2 py-2 text-left transition-colors cursor-pointer ${
                  style === opt.value
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300"
                    : "border-slate-200/80 bg-white/52 text-slate-700 hover:border-slate-300 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-slate-500"
                }`}
              >
                <div className="text-xs font-medium">{opt.label}</div>
                <div className="mt-0.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 关键帧截图 */}
        <div>
          <span className={`${configLabelClass} block mb-2`}>关键帧截图</span>
          <div className="grid grid-cols-4 gap-1.5">
            {AI_NOTE_SCREENSHOT_OPTIONS.map((opt) => (
              <div key={opt.value} className="relative group">
                <button
                  type="button"
                  onClick={() => onConfigChange((c) => ({ ...c, screenshot_density: opt.value }))}
                  className={`w-full rounded-lg border px-1.5 py-1.5 text-center transition-colors cursor-pointer ${
                    screenshotDensity === opt.value
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300"
                      : "border-slate-200/80 bg-white/52 text-slate-700 hover:border-slate-300 dark:border-slate-600/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-slate-500"
                  }`}
                >
                  <span className="text-xs font-medium">{opt.label}</span>
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2.5 py-1 text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 bg-slate-800 text-slate-100 dark:bg-slate-200 dark:text-slate-800 shadow-lg">
                  {opt.description}
                  <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800 dark:border-t-slate-200" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 补充提示词 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className={configLabelClass}>补充提示词（可选）</span>
            {promptConfigs.length > 0 && (
              <div className="relative" ref={promptDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowPromptDropdown(!showPromptDropdown)}
                  className="px-2 py-0.5 pr-6 rounded-lg border border-slate-200/80 dark:border-slate-600/80 bg-white/52 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all"
                >
                  选择提示词
                </button>
                <ChevronDown className={`absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none transition-transform ${showPromptDropdown ? "rotate-180" : ""}`} />
                {showPromptDropdown && (
                  <div className={`${premiumDropdownMenuClass} w-56`}>
                    {promptConfigs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onConfigChange((c) => ({ ...c, custom_prompt: p.content }));
                          setShowPromptDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-300 cursor-pointer"
                      >
                        <div className="font-medium truncate">{p.title}</div>
                        {p.description && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{p.description}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <textarea
            value={customPrompt}
            onChange={(e) => onConfigChange((c) => ({ ...c, custom_prompt: e.target.value }))}
            placeholder={`可选：补充你希望 AI 额外关注的重点，比如：
- 更关注案例拆解
- 在关键小节保留时间戳`}
            rows={3}
            className={`${premiumInputClass} resize-none text-xs !py-2`}
          />
          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
            不填写时将使用当前风格的默认提示词。
          </p>
        </div>
      </div>
    );
  }

  return null;
}

interface InitializationManagementSectionProps {
  notes: Note[];
}

export function InitializationManagementSection({
  notes,
}: InitializationManagementSectionProps) {
  const { aiConfigs, defaultAiConfigId, promptConfigs, initializationTemplateSettings, setInitializationTemplateSelectedKeys } = useApp();
  const {
    runtimeQueue,
    currentTask,
    initState,
    initProgress,
    runtimeSummary,
    addBatchToRuntime,
    removeFromRuntime,
    abortCurrent,
    stopAllTasks,
    clearRuntime,
    hasActiveTasks,
  } = useInitializationRuntime();

  const [registry, setRegistry] = useState<InitializationItemDefinition[]>([]);
  const [overview, setOverview] = useState<NoteInitializationOverview[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all");
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [editingItems, setEditingItems] = useState<NoteInitializationItem[]>([]);
  const [editingExplicitKeys, setEditingExplicitKeys] = useState<Set<string>>(new Set());
  const [editingModelOverrideId, setEditingModelOverrideId] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [dashboardExpanded, setDashboardExpanded] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("notes");
  const [openDropdown, setOpenDropdown] = useState<OpenDropdown>(null);

  const noteFilterDropdownRef = useRef<HTMLDivElement | null>(null);
  const referenceModelDropdownRef = useRef<HTMLDivElement | null>(null);
  const hasAutoJumpedToRunRef = useRef(false);

  const [expandedConfigKey, setExpandedConfigKey] = useState<string | null>(null);

  const updateEditingItemConfig = useCallback(
    (itemKey: string, updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      setEditingItems((prev) =>
        prev.map((item) => {
          if (item.item_key !== itemKey) return item;
          const config = safeJsonParse(item.config_json);
          const updated = updater(config);
          return { ...item, config_json: JSON.stringify(updated) };
        })
      );
    },
    []
  );

  const noteMap = useMemo(() => {
    return new Map(notes.map((note) => [note.id, note]));
  }, [notes]);

  const definitionMap = useMemo(() => {
    return new Map(registry.map((item) => [item.item_key, item]));
  }, [registry]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const refs = [
        noteFilterDropdownRef.current,
        referenceModelDropdownRef.current,
      ];

      if (refs.some((ref) => ref?.contains(target))) return;
      setOpenDropdown(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setOpenDropdown(null);
  }, [activeStep]);

  useEffect(() => {
    if (hasAutoJumpedToRunRef.current) {
      return;
    }

    if (currentTask?.status === "running" || initState.isInitializing) {
      hasAutoJumpedToRunRef.current = true;
      setActiveStep("run");
    }
  }, [currentTask?.status, initState.isInitializing]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const [registryData, overviewData] = await Promise.all([
        invoke<InitializationItemDefinition[]>("get_initialization_registry"),
        invoke<NoteInitializationOverview[]>("get_initialization_overview"),
      ]);
      setRegistry(registryData);
      setOverview(overviewData);

    } catch (error) {
      console.error("Failed to load initialization overview:", error);
      message.error(`初始化管理加载失败：${String(error)}`);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const lastOverviewRefreshTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentTask) {
      return;
    }

    if (!["completed", "partial_failed", "failed", "aborted"].includes(currentTask.status)) {
      return;
    }

    const refreshKey = `${currentTask.id}:${currentTask.status}`;
    if (lastOverviewRefreshTaskRef.current === refreshKey) {
      return;
    }

    lastOverviewRefreshTaskRef.current = refreshKey;
    void loadOverview();
  }, [currentTask, loadOverview]);

  useEffect(() => {
    if (registry.length === 0) {
      setEditingItems([]);
      setEditingExplicitKeys(new Set());
      return;
    }

    const normalizedItems = registry.map((definition) => ({
      id: "",
      note_id: "",
      item_key: definition.item_key,
      selected: false,
      locked: false,
      status: "pending" as ItemStatus,
      config_json: null,
      depends_on: definition.dependencies,
      last_model_id: null,
      last_error: null,
      output_present: false,
      started_at: null,
      completed_at: null,
      updated_at: "",
    }));

    setEditingItems((prev) => {
      if (prev.length === 0) {
        return normalizedItems;
      }

      const prevMap = new Map(prev.map((item) => [item.item_key, item]));
      return registry.map((definition) => {
        const existing = prevMap.get(definition.item_key);
        if (existing) {
          return { ...existing, depends_on: definition.dependencies };
        }
        return normalizedItems.find((i) => i.item_key === definition.item_key)!;
      });
    });

    setEditingExplicitKeys((prev) => {
      const validKeys = new Set(registry.map((item) => item.item_key));
      // 首次加载时从全局设置恢复
      if (prev.size === 0 && initializationTemplateSettings.loaded && initializationTemplateSettings.selectedKeys) {
        return new Set(initializationTemplateSettings.selectedKeys.filter((k) => validKeys.has(k)));
      }
      return new Set(Array.from(prev).filter((key) => validKeys.has(key)));
    });
  }, [registry, initializationTemplateSettings.loaded, initializationTemplateSettings.selectedKeys]);

  // 当已选项目变化时，自动持久化到全局设置
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (!initializationTemplateSettings.loaded) return;
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setInitializationTemplateSelectedKeys(Array.from(editingExplicitKeys));
  }, [editingExplicitKeys, initializationTemplateSettings.loaded, setInitializationTemplateSelectedKeys]);

  useEffect(() => {
    setEditingModelOverrideId((prev) => {
      if (prev && aiConfigs.some((config) => config.id === prev)) {
        return prev;
      }
      return defaultAiConfigId ?? null;
    });
  }, [aiConfigs, defaultAiConfigId]);

  const filteredOverview = useMemo(() => {
    return overview.filter((item) => {
      const query = searchQuery.trim().toLowerCase();
      if (query && !item.note_title.toLowerCase().includes(query)) {
        return false;
      }

      switch (noteFilter) {
        case "pending":
          return item.run_status === "idle";
        case "running":
          return item.run_status === "running" || item.run_status === "queued";
        case "failed":
          return (
            item.run_status === "failed" ||
            item.run_status === "partial_failed" ||
            item.run_status === "canceled"
          );
        case "completed":
          return item.run_status === "completed";
        case "has_subtitle":
          return Boolean(item.subtitle_path && item.subtitle_path.trim().length > 0);
        case "no_subtitle":
          return !(item.subtitle_path && item.subtitle_path.trim().length > 0);
        default:
          return true;
      }
    });
  }, [overview, searchQuery, noteFilter]);

  const selectedSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const failedOverview = useMemo(() => {
    return overview.filter(
      (item) =>
        item.run_status === "failed" ||
        item.run_status === "partial_failed" ||
        item.run_status === "canceled" ||
        item.failed_count > 0
    );
  }, [overview]);

  const currentStepName =
    initState.currentStepIndex >= 0 &&
    initState.currentStepIndex < initState.steps.length
      ? initState.steps[initState.currentStepIndex].name
      : "";
  const currentStepMessage =
    initState.currentStepIndex >= 0 &&
    initState.currentStepIndex < initState.steps.length
      ? initState.steps[initState.currentStepIndex].message
      : undefined;

  const runSummary = runtimeSummary;

  const overviewStats = useMemo(() => {
    const total = overview.length;
    const running = overview.filter(
      (item) => item.run_status === "running" || item.run_status === "queued"
    ).length;
    const failed = overview.filter(
      (item) =>
        item.run_status === "failed" ||
        item.run_status === "partial_failed" ||
        item.run_status === "canceled"
    ).length;
    const completed = overview.filter(
      (item) => item.run_status === "completed"
    ).length;
    const pending = total - running - failed - completed;
    return { total, running, failed, completed, pending };
  }, [overview]);

  const editingStatusSummary = useMemo(() => {
    const total = editingItems.length;
    const selected = editingItems.filter((item) => item.selected).length;
    const completed = editingItems.filter((item) => item.status === "completed").length;
    const running = editingItems.filter(
      (item) => item.status === "running" || item.status === "queued"
    ).length;
    const failed = editingItems.filter(
      (item) => item.status === "failed" || item.status === "blocked"
    ).length;
    const locked = editingItems.filter((item) => item.locked).length;

    return { total, selected, completed, running, failed, locked };
  }, [editingItems]);

  const currentExecutionModel = aiConfigs.find((config) => config.id === editingModelOverrideId);
  const executionModelTitle = currentExecutionModel?.title || "选择模型";
  const currentNoteFilterLabel =
    noteFilterOptions.find((option) => option.value === noteFilter)?.label ?? "全部笔记";

  const filteredOverviewEmptyCopy = useMemo(() => {
    if (loadingOverview) {
      return "正在加载笔记列表...";
    }

    if (overview.length === 0) {
      return "暂无可管理的笔记，请先创建或导入笔记后再进行初始化配置。";
    }

    if (searchQuery.trim()) {
      return "没有找到匹配当前搜索条件的笔记，可尝试修改关键词。";
    }

    if (noteFilter !== "all") {
      return "当前筛选条件下没有匹配笔记，可切换筛选条件后重试。";
    }

    return "暂无匹配笔记";
  }, [loadingOverview, noteFilter, overview.length, searchQuery]);

  const noteListSummary = useMemo(() => {
    if (loadingOverview) {
      return "正在刷新笔记概览...";
    }

    return `当前显示 ${filteredOverview.length} / ${overview.length} 条笔记，已勾选 ${selectedNoteIds.length} 条`;
  }, [filteredOverview.length, loadingOverview, overview.length, selectedNoteIds.length]);

  const stepSummaries = useMemo(() => {
    const step1 =
      selectedNoteIds.length > 0
        ? `已选 ${selectedNoteIds.length} 条`
        : "先选择要处理的笔记";
    const step2 =
      editingStatusSummary.selected > 0
        ? `已选 ${editingStatusSummary.selected} 项`
        : "先选择要同步的项目";
    const step3 = hasActiveTasks
      ? `运行中 ${runSummary.running} · 排队 ${runSummary.queued}`
      : selectedNoteIds.length > 0
        ? `准备执行 ${selectedNoteIds.length} 条`
        : "等待开始执行";

    return { step1, step2, step3 };
  }, [
    editingStatusSummary.selected,
    hasActiveTasks,
    runSummary.queued,
    runSummary.running,
    selectedNoteIds.length,
  ]);

  const toggleNoteSelection = useCallback((noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return Array.from(next);
    });
  }, []);

  const selectOnlyNote = useCallback((noteId: string) => {
    setSelectedNoteIds([noteId]);
    setActiveStep("items");
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedNoteIds(filteredOverview.map((item) => item.note_id));
  }, [filteredOverview]);

  const clearSelection = useCallback(() => {
    setSelectedNoteIds([]);
  }, []);

  const clearOverviewFilters = useCallback(() => {
    setSearchQuery("");
    setNoteFilter("all");
  }, []);

  const selectFailedNotes = useCallback(() => {
    setSelectedNoteIds(failedOverview.map((item) => item.note_id));
  }, [failedOverview]);

  const selectNoSubtitleNotes = useCallback(() => {
    const ids = overview
      .filter((item) => !(item.subtitle_path && item.subtitle_path.trim().length > 0))
      .map((item) => item.note_id);
    setSelectedNoteIds(ids);
  }, [overview]);

  const resolveModelId = useCallback(
    (_noteId: string, modelOverrideId: string | null): string | null => {
      return modelOverrideId ?? defaultAiConfigId;
    },
    [defaultAiConfigId]
  );

  const applySelectionToEditingItems = useCallback(
    (nextExplicit: Set<string>) => {
      const normalized = normalizeSelection(nextExplicit, registry);
      setEditingItems((prev) =>
        prev.map((item) => ({
          ...item,
          selected: normalized.selected.has(item.item_key),
          locked: normalized.locked.has(item.item_key),
        }))
      );
      setEditingExplicitKeys(nextExplicit);
    },
    [registry]
  );

  const toggleEditingItemSelected = useCallback(
    (itemKey: string) => {
      const target = editingItems.find((item) => item.item_key === itemKey);
      if (!target || target.locked) return;

      const nextExplicit = new Set(editingExplicitKeys);
      if (nextExplicit.has(itemKey)) {
        nextExplicit.delete(itemKey);
      } else {
        nextExplicit.add(itemKey);
      }

      applySelectionToEditingItems(nextExplicit);
    },
    [applySelectionToEditingItems, editingExplicitKeys, editingItems]
  );

  const selectAllEditingItems = useCallback(() => {
    applySelectionToEditingItems(new Set(registry.map((item) => item.item_key)));
  }, [applySelectionToEditingItems, registry]);

  const clearEditingItems = useCallback(() => {
    applySelectionToEditingItems(new Set());
  }, [applySelectionToEditingItems]);

  const updateEditingItemRegenerate = useCallback((itemKey: string, regenerate: boolean) => {
    setEditingItems((prev) =>
      prev.map((item) =>
        item.item_key === itemKey ? setRegenerate(item, regenerate) : item
      )
    );
  }, []);
  const executeSelectedNotes = useCallback(async () => {
    if (selectedNoteIds.length === 0) {
      message.warning("请先选择至少一条笔记");
      return;
    }

    setActionLoading("run");
    try {
      const uniqueNoteIds = Array.from(new Set(selectedNoteIds));
      const tasks: InitializationTaskParams[] = [];
      const selectedKeys = Array.from(editingExplicitKeys);
      let skippedNoModel = 0;

      // 收集所有已选项目的配置
      const itemConfigs: Record<string, string> = {};
      for (const item of editingItems) {
        if (item.selected && item.config_json) {
          itemConfigs[item.item_key] = item.config_json;
        }
      }

      for (const noteId of uniqueNoteIds) {
        const note = noteMap.get(noteId);
        if (!note) continue;

        const modelId = resolveModelId(noteId, editingModelOverrideId);
        if (!modelId) {
          skippedNoModel += 1;
          continue;
        }

        tasks.push({
          noteId,
          noteTitle: note.title,
          modelId,
          videoPath: note.video_path,
          subtitlePath: note.subtitle_path,
          selectedKeys,
          itemConfigs,
        });
      }

      const accepted = addBatchToRuntime(tasks);
      if (accepted > 0) {
        message.success(`已加入队列 ${accepted} 条任务`);
      } else {
        message.info("没有新的任务加入队列（可能已在队列中或正在运行）");
      }

      if (skippedNoModel > 0) {
        message.warning(`${skippedNoModel} 条笔记未配置可用模型，已跳过`);
      }

      await loadOverview();
    } catch (error) {
      console.error("Failed to execute initialization tasks:", error);
      message.error(`执行初始化任务失败：${String(error)}`);
    } finally {
      setActionLoading(null);
    }
  }, [
    addBatchToRuntime,
    editingExplicitKeys,
    editingItems,
    editingModelOverrideId,
    loadOverview,
    noteMap,
    resolveModelId,
    selectedNoteIds,
  ]);

  const prepareRetryTask = useCallback(
    async (noteId: string, detail: NoteInitializationDetail, retryKeys: Set<string>) => {
      if (retryKeys.size === 0) {
        return { task: null as InitializationTaskParams | null, missingModel: false };
      }

      const note = noteMap.get(noteId);
      if (!note) {
        return { task: null as InitializationTaskParams | null, missingModel: false };
      }

      const modelOverrideForRun = detail.run?.model_override_id ?? null;
      const modelId = resolveModelId(noteId, modelOverrideForRun);
      if (!modelId) {
        return { task: null as InitializationTaskParams | null, missingModel: true };
      }

      // 收集重试项目的配置（使用数据库中已保存的配置）
      const itemConfigs: Record<string, string> = {};
      for (const item of detail.items) {
        if (retryKeys.has(item.item_key) && item.config_json) {
          itemConfigs[item.item_key] = item.config_json;
        }
      }

      return {
        task: {
          noteId,
          noteTitle: note.title,
          modelId,
          videoPath: note.video_path,
          subtitlePath: note.subtitle_path,
          selectedKeys: Array.from(retryKeys),
          itemConfigs,
        } satisfies InitializationTaskParams,
        missingModel: false,
      };
    },
    [noteMap, resolveModelId]
  );

  const handleRetryFailed = useCallback(async () => {
    if (selectedNoteIds.length === 0) {
      message.warning("请先选择至少一条笔记");
      return;
    }

    setActionLoading("retry");
    try {
      const retryTasks: InitializationTaskParams[] = [];
      let hasRetriable = false;
      let skippedNoModel = 0;

      for (const noteId of selectedNoteIds) {
        const detail = await invoke<NoteInitializationDetail>(
          "get_note_initialization_plan",
          { noteId }
        );
        const failedKeys = new Set(
          detail.items
            .filter((item) => item.status === "failed" || item.status === "blocked")
            .map((item) => item.item_key)
        );

        if (failedKeys.size === 0) {
          continue;
        }

        hasRetriable = true;
        const { task, missingModel } = await prepareRetryTask(
          noteId,
          detail,
          failedKeys
        );
        if (missingModel) {
          skippedNoModel += 1;
        }
        if (task) {
          retryTasks.push(task);
        }
      }

      const accepted = addBatchToRuntime(retryTasks);

      await loadOverview();

      if (!hasRetriable) {
        message.info("所选笔记没有失败或阻塞项");
      } else if (accepted > 0) {
        message.success(`已将 ${accepted} 条重试任务加入队列`);
      } else {
        message.info("未新增重试任务（可能已在队列中或正在运行）");
      }

      if (skippedNoModel > 0) {
        message.warning(`${skippedNoModel} 条笔记缺少可用模型，已跳过`);
      }
    } catch (error) {
      console.error("Failed to retry failed initialization items:", error);
      message.error(`重试失败项失败：${String(error)}`);
    } finally {
      setActionLoading(null);
    }
  }, [
    addBatchToRuntime,
    loadOverview,
    prepareRetryTask,
    selectedNoteIds,
  ]);

  const handleStopAllTasks = useCallback(async () => {
    if (!hasActiveTasks) {
      return;
    }

    setActionLoading("stop-all");
    try {
      await stopAllTasks();
      await loadOverview();
      message.success("已停止全部任务");
    } catch (error) {
      console.error("Failed to stop all initialization tasks:", error);
      message.error(`停止全部任务失败：${String(error)}`);
    } finally {
      setActionLoading(null);
    }
  }, [hasActiveTasks, loadOverview, stopAllTasks]);

  return (
    <div className="space-y-5">
      <div className={`${glassPanelClass} p-4 md:p-5 space-y-3.5`}>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className={sectionEyebrowClass}>Initialization workflow</div>
            <div className="text-base font-semibold tracking-[0.01em] text-slate-900 dark:text-slate-100">
              初始化管理
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              按三步完成初始化：先选笔记，再选择项目并同步，最后统一开始执行。
            </div>
          </div>
          <button
            onClick={loadOverview}
            disabled={loadingOverview}
            className={`${secondaryButtonClass} flex items-center gap-2`}
          >
            <RefreshCw size={14} className={loadingOverview ? "animate-spin" : ""} />
            刷新
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          <MetricCard label="笔记总数" value={String(overviewStats.total)} />
          <MetricCard label="待处理" value={String(overviewStats.pending)} />
          <MetricCard label="运行中" value={String(overviewStats.running)} />
          <MetricCard
            label="失败"
            value={String(overviewStats.failed)}
            accent="text-red-600 dark:text-red-400"
          />
          <MetricCard
            label="已完成"
            value={String(overviewStats.completed)}
            accent="text-emerald-600 dark:text-emerald-400"
          />
        </div>
      </div>

      <div className={`${glassPanelClass} p-4 md:p-5`}>
        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-4.5">
          <div className="space-y-3">
            <div className={`${softSurfaceClass} p-3.5 space-y-3`}>
              <div className="space-y-1">
                <div className={sectionEyebrowClass}>Step navigation</div>
                <div className={sectionTitleClass}>初始化步骤</div>
                <div className={sectionDescriptionClass}>
                  三个步骤固定在左侧，右边展示当前步骤的详细内容。
                </div>
              </div>

              <StepCard
                index={1}
                title="选择笔记"
                description="确定要处理的目标笔记"
                summary={stepSummaries.step1}
                active={activeStep === "notes"}
                onClick={() => setActiveStep("notes")}
              />
              <StepCard
                index={2}
                title="选择初始化项目"
                description="统一设置项目并同步到已选笔记"
                summary={stepSummaries.step2}
                active={activeStep === "items"}
                onClick={() => setActiveStep("items")}
              />
              <StepCard
                index={3}
                title="开始执行"
                description="统一加入队列并查看运行状态"
                summary={stepSummaries.step3}
                active={activeStep === "run"}
                onClick={() => setActiveStep("run")}
              />
            </div>

            <HelperBlock tone="muted">
              推荐流程：步骤 1 勾选目标笔记 → 步骤 2 调整项目并同步 → 步骤 3 选择执行模型后开始执行。
            </HelperBlock>
          </div>

          <div className="space-y-4">
            {activeStep === "notes" && (
              <div className={`${softSurfaceClass} p-4 md:p-4.5 space-y-4`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className={sectionEyebrowClass}>Step 1</div>
                    <div className={sectionTitleClass}>第 1 步：选择笔记</div>
                    <div className={sectionDescriptionClass}>
                      在右侧列表中勾选要初始化的笔记，后续步骤会对这些已选笔记统一同步配置并执行。
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{noteListSummary}</span>
                  </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-2.5">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索笔记标题"
                    className={`flex-1 ${premiumInputClass}`}
                  />

                  <div className="relative lg:w-[220px]" ref={noteFilterDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setOpenDropdown((prev) => prev === "note-filter" ? null : "note-filter")}
                      className={premiumDropdownButtonClass}
                    >
                      {currentNoteFilterLabel}
                    </button>
                    <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${openDropdown === "note-filter" ? "rotate-180" : ""}`} />
                    {openDropdown === "note-filter" && (
                      <div className={premiumDropdownMenuClass}>
                        {noteFilterOptions.map((option) => (
                          <DropdownOptionButton
                            key={option.value}
                            selected={noteFilter === option.value}
                            label={option.label}
                            onClick={() => {
                              setNoteFilter(option.value);
                              setOpenDropdown(null);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <button
                    onClick={selectAllFiltered}
                    className={chipButtonClass}
                  >
                    按筛选全选
                  </button>
                  <button
                    onClick={selectFailedNotes}
                    className={chipButtonClass}
                  >
                    全选失败项
                  </button>
                  <button
                    onClick={selectNoSubtitleNotes}
                    className={chipButtonClass}
                  >
                    全选无字幕
                  </button>
                  <button
                    onClick={clearSelection}
                    className={chipButtonClass}
                  >
                    清空
                  </button>
                </div>

                <HelperBlock>
                  已勾选的笔记将在步骤 3 统一加入执行队列，执行时使用步骤 2 的全局配置。
                </HelperBlock>

                <div className="max-h-[620px] overflow-y-auto pr-1 space-y-2.5">
                  {filteredOverview.map((item) => {
                    const isSelected = selectedSet.has(item.note_id);
                    const progressTotal = Math.max(item.selected_count, 0);
                    const progressDone = item.completed_count + item.skipped_count;
                    const progressPercent =
                      progressTotal > 0
                        ? Math.min(100, Math.round((progressDone / progressTotal) * 100))
                        : 0;
                    return (
                      <div
                        key={item.note_id}
                        className={`rounded-[24px] border p-4 transition-all duration-200 shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${
                          isSelected
                            ? "border-blue-200/90 bg-[linear-gradient(180deg,rgba(239,246,255,0.52),rgba(219,234,254,0.32))] shadow-[0_12px_24px_rgba(59,130,246,0.05)] dark:border-blue-900/50 dark:bg-[linear-gradient(180deg,rgba(30,64,175,0.12),rgba(15,23,42,0.72))]"
                            : "border-slate-200/80 dark:border-slate-700/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(248,250,252,0.52))] dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.5),rgba(15,23,42,0.74))]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleNoteSelection(item.note_id)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                  {item.note_title}
                                </span>
                                {item.subtitle_path ? (
                                  <MiniBadge tone="success">有字幕</MiniBadge>
                                ) : (
                                  <MiniBadge>无字幕</MiniBadge>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                <MiniBadge>已选 {item.selected_count}</MiniBadge>
                                <MiniBadge tone="success">完成 {item.completed_count}</MiniBadge>
                                <MiniBadge tone={item.failed_count > 0 ? "warning" : "neutral"}>失败 {item.failed_count}</MiniBadge>
                                <MiniBadge>输出 {item.output_count}</MiniBadge>
                              </div>
                            </div>
                          </div>

                          <MiniBadge tone={getRunStatusBadgeTone(item.run_status)}>
                            {runStatusLabelMap[item.run_status]}
                          </MiniBadge>
                        </div>

                        <div className="mt-3 flex items-center gap-3">
                          <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                item.run_status === "failed" ||
                                item.run_status === "partial_failed"
                                  ? "bg-red-500"
                                  : item.run_status === "completed"
                                    ? "bg-emerald-500"
                                    : item.run_status === "running" || item.run_status === "queued"
                                      ? "bg-blue-500"
                                      : "bg-slate-400"
                              }`}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                            {progressTotal > 0 ? `${progressDone}/${progressTotal}` : "-"}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {filteredOverview.length === 0 && (
                    <div className="py-12 px-4 text-center space-y-3">
                      <div className="flex justify-center">
                        <MiniBadge tone="info">当前没有可操作笔记</MiniBadge>
                      </div>
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {filteredOverviewEmptyCopy}
                      </div>
                      {!loadingOverview && overview.length > 0 && (
                        <div className="space-y-3">
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            可尝试调整搜索关键词、切换筛选条件，或直接刷新概览数据。
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            {(searchQuery.trim() || noteFilter !== "all") && (
                              <button
                                onClick={clearOverviewFilters}
                                className={chipButtonClass}
                              >
                                清空筛选
                              </button>
                            )}
                            <button
                              onClick={loadOverview}
                              disabled={loadingOverview}
                              className={chipButtonClass}
                            >
                              重新刷新
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => setActiveStep("items")}
                    disabled={selectedNoteIds.length === 0}
                    className={primaryButtonClass}
                  >
                    下一步：选择初始化项目
                  </button>
                </div>
              </div>
            )}

            {activeStep === "items" && (
              <div className={`${softSurfaceClass} p-4 md:p-4.5 space-y-4`}>
                <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className={sectionEyebrowClass}>Step 2</div>
                    <div className={sectionTitleClass}>第 2 步：选择初始化项目</div>
                    <div className={sectionDescriptionClass}>
                      这里的初始化项目是全局配置，调整后将自动保存并在执行时生效。
                    </div>
                  </div>
                  <HelperBlock className="xl:max-w-sm py-2">
                    配置自动保存，执行时将应用到所有选中笔记。
                  </HelperBlock>
                </div>

                <div className={`${summaryStripClass} flex flex-wrap items-center gap-2 px-3.5 py-3`}>
                  <MiniBadge>已选 {editingStatusSummary.selected} 项</MiniBadge>
                  <MiniBadge tone={editingStatusSummary.locked > 0 ? "warning" : "neutral"}>
                    依赖锁定 {editingStatusSummary.locked}
                  </MiniBadge>
                  <MiniBadge tone={editingStatusSummary.completed > 0 ? "success" : "neutral"}>
                    已完成 {editingStatusSummary.completed}
                  </MiniBadge>
                  <MiniBadge tone={editingStatusSummary.failed > 0 ? "warning" : "neutral"}>
                    失败/阻塞 {editingStatusSummary.failed}
                  </MiniBadge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={selectAllEditingItems}
                    disabled={registry.length === 0}
                    className={`${tertiaryButtonClass} py-1.5`}
                  >
                    全选项目
                  </button>
                  <button
                    onClick={clearEditingItems}
                    disabled={registry.length === 0}
                    className={`${tertiaryButtonClass} py-1.5`}
                  >
                    清空项目
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {registry.map((definition) => {
                    const item = editingItems.find((it) => it.item_key === definition.item_key);
                    if (!item) return null;
                    const regenerate = getRegenerate(item);
                    const dependencyNames = definition.dependencies
                      .map(
                        (dependencyKey) =>
                          definitionMap.get(dependencyKey)?.display_name ?? dependencyKey
                      )
                      .join(" / ");
                    const cardTone = item.selected
                      ? "border-blue-300/90 bg-[linear-gradient(180deg,rgba(239,246,255,0.72),rgba(219,234,254,0.52))] shadow-[0_16px_30px_rgba(59,130,246,0.10)] ring-1 ring-blue-100/80 dark:border-blue-800/60 dark:bg-[linear-gradient(180deg,rgba(30,64,175,0.22),rgba(15,23,42,0.78))] dark:ring-blue-900/35"
                      : item.status === "failed" || item.status === "blocked"
                        ? "border-red-200/90 bg-[linear-gradient(180deg,rgba(254,242,242,0.62),rgba(254,226,226,0.42))] dark:border-red-900/40 dark:bg-[linear-gradient(180deg,rgba(127,29,29,0.18),rgba(15,23,42,0.78))]"
                        : item.status === "running" || item.status === "queued"
                          ? "border-blue-200/90 bg-[linear-gradient(180deg,rgba(239,246,255,0.62),rgba(219,234,254,0.38))] dark:border-blue-900/40 dark:bg-[linear-gradient(180deg,rgba(30,64,175,0.14),rgba(15,23,42,0.76))]"
                          : "border-slate-200/80 dark:border-slate-700/80 bg-white/52 dark:bg-slate-800/48 hover:border-slate-300/90 dark:hover:border-slate-600/80";

                    return (
                      <div
                        key={definition.item_key}
                        className={`rounded-[24px] border p-4 transition-all duration-200 shadow-[0_10px_24px_rgba(15,23,42,0.04)] flex h-full flex-col ${cardTone}`}
                      >
                        <div className="space-y-3 flex-1">
                          <div className="flex items-start justify-between gap-2.5 min-h-[72px]">
                            <label className="inline-flex items-start gap-3 flex-1 cursor-pointer min-w-0">
                              <input
                                type="checkbox"
                                checked={item.selected}
                                disabled={item.locked}
                                onChange={() => toggleEditingItemSelected(item.item_key)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/70"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                  {definition.display_name}
                                </span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1 leading-5 min-h-[40px]">
                                  {definition.description}
                                </span>
                              </span>
                            </label>
                            <span
                              className={`inline-flex min-w-[64px] justify-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${getItemStatusBadgeClass(item.status)}`}
                            >
                              {itemStatusLabelMap[item.status]}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 min-h-[28px]">
                            {item.output_present ? (
                              <MiniBadge tone="success">已有结果</MiniBadge>
                            ) : (
                              <MiniBadge>无结果</MiniBadge>
                            )}
                            {item.locked && <MiniBadge tone="warning">依赖锁定</MiniBadge>}
                          </div>

                          <div className="text-[11px] leading-5 text-slate-500 dark:text-slate-400 min-h-[20px]">
                            {dependencyNames ? `依赖：${dependencyNames}` : "\u00a0"}
                          </div>
                        </div>

                        {/* 展开式配置面板 */}
                        {CONFIGURABLE_ITEM_KEYS.has(definition.item_key) && (
                          <div
                            className={`overflow-hidden transition-all duration-300 ease-in-out ${
                              expandedConfigKey === definition.item_key
                                ? "max-h-[600px] opacity-100 mt-3"
                                : "max-h-0 opacity-0"
                            }`}
                          >
                            <ItemConfigPanel
                              itemKey={definition.item_key}
                              config={safeJsonParse(item.config_json)}
                              onConfigChange={(updater) => updateEditingItemConfig(definition.item_key, updater)}
                              promptConfigs={promptConfigs}
                            />
                          </div>
                        )}

                        <div className="mt-3 pt-3.5 border-t border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-2.5">
                          {/* 字幕生成不允许覆盖已有结果 */}
                          {definition.item_key !== "subtitle_generation" ? (
                            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={regenerate}
                                onChange={(e) => updateEditingItemRegenerate(item.item_key, e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/70"
                              />
                              覆盖已有结果
                            </label>
                          ) : (
                            <div />
                          )}
                          <div className="flex items-center gap-2">
                            {CONFIGURABLE_ITEM_KEYS.has(definition.item_key) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedConfigKey((prev) =>
                                    prev === definition.item_key ? null : definition.item_key
                                  )
                                }
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                                  expandedConfigKey === definition.item_key
                                    ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-700/50"
                                }`}
                                title="自定义配置"
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                                {expandedConfigKey === definition.item_key ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                            )}
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {item.selected ? "已选，将在执行时生效" : "未选，不参与执行"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center pt-1">
                  <div className="justify-self-start">
                    <button
                      onClick={() => setActiveStep("notes")}
                      className={wideTertiaryButtonClass}
                    >
                      返回上一步
                    </button>
                  </div>
                  <HelperBlock className="w-full text-center xl:max-w-none">
                    先同步项目配置，再到步骤 3 选择执行模型并开始执行。
                  </HelperBlock>
                  <div className="justify-self-start xl:justify-self-end">
                    <button
                      onClick={() => setActiveStep("run")}
                      disabled={selectedNoteIds.length === 0}
                      className={`${primaryButtonClass} min-w-[160px] justify-center`}
                    >
                      下一步
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeStep === "run" && (
              <div className="space-y-4">
                <div className={`${softSurfaceClass} p-4 md:p-4.5 space-y-4`}>
                  <div className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className={sectionEyebrowClass}>Step 3</div>
                      <div className={sectionTitleClass}>第 3 步：开始执行</div>
                      <div className={sectionDescriptionClass}>
                        这里仅负责执行。请选择模型后，将已选笔记统一加入运行队列。
                      </div>
                    </div>
                    <HelperBlock className="xl:max-w-sm py-2">
                      目标笔记 <span className="font-medium text-slate-700 dark:text-slate-200">{selectedNoteIds.length}</span> 条，已选项目 <span className="font-medium text-slate-700 dark:text-slate-200">{editingStatusSummary.selected}</span> 项。
                    </HelperBlock>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(240px,0.7fr)_minmax(0,1fr)] gap-3">
                    <div className="relative" ref={referenceModelDropdownRef}>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                        执行模型
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenDropdown((prev) => prev === "reference-model" ? null : "reference-model")}
                        className={premiumDropdownButtonClass}
                      >
                        {executionModelTitle}
                      </button>
                      <ChevronDown className={`absolute right-3 top-[39px] -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform ${openDropdown === "reference-model" ? "rotate-180" : ""}`} />
                      {openDropdown === "reference-model" && (
                        <div className={premiumDropdownMenuClass}>
                          {aiConfigs.map((config) => (
                            <DropdownOptionButton
                              key={config.id}
                              selected={editingModelOverrideId === config.id}
                              label={config.title}
                              onClick={() => {
                                setEditingModelOverrideId(config.id);
                                setOpenDropdown(null);
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className={`${summaryStripClass} flex flex-wrap items-center gap-2 px-3.5 py-3`}>
                      <MiniBadge>模型：{executionModelTitle}</MiniBadge>
                      <MiniBadge>已选 {selectedNoteIds.length} 条笔记</MiniBadge>
                      <MiniBadge>已选 {editingStatusSummary.selected} 项</MiniBadge>
                      <MiniBadge tone={runSummary.queued > 0 ? "warning" : "neutral"}>
                        队列 {runSummary.queued}
                      </MiniBadge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <MetricCard label="已选笔记" value={String(selectedNoteIds.length)} compact />
                    <MetricCard label="已选项目" value={String(editingStatusSummary.selected)} compact />
                    <MetricCard
                      label="运行中"
                      value={String(runSummary.running)}
                      accent="text-blue-600 dark:text-blue-400"
                      compact
                    />
                    <MetricCard
                      label="队列中"
                      value={String(runSummary.queued)}
                      accent="text-amber-600 dark:text-amber-400"
                      compact
                    />
                  </div>

                  <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={executeSelectedNotes}
                        disabled={actionLoading !== null || selectedNoteIds.length === 0}
                        className={`${primaryButtonClass} min-w-[112px] justify-center`}
                      >
                        {actionLoading === "run" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Play size={14} />
                        )}
                        执行
                      </button>

                      <button
                        onClick={handleRetryFailed}
                        disabled={actionLoading !== null || selectedNoteIds.length === 0}
                        className={`${warningButtonClass} min-w-[132px] justify-center`}
                      >
                        {actionLoading === "retry" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        重试失败项
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                      <MiniBadge tone={hasActiveTasks ? "danger" : "neutral"}>
                        {hasActiveTasks ? "当前存在运行任务" : "当前没有运行任务"}
                      </MiniBadge>
                      <button
                        onClick={abortCurrent}
                        disabled={!currentTask || currentTask.status !== "running" || actionLoading !== null}
                        className={dangerButtonClass}
                      >
                        <Square size={14} />
                        取消当前运行
                      </button>
                      <button
                        onClick={handleStopAllTasks}
                        disabled={!hasActiveTasks || actionLoading !== null}
                        className={dangerButtonClass}
                      >
                        <Square size={14} />
                        停止全部任务
                      </button>
                    </div>
                  </div>
                </div>

                <div className={`${glassPanelClass} overflow-hidden`}>
                  <button
                    onClick={() => setDashboardExpanded((prev) => !prev)}
                    className={dashboardToggleButtonClass}
                  >
                    <div>
                      <div className={sectionEyebrowClass}>Runtime dashboard</div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mt-1">
                        <Activity size={15} />
                        执行看板
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-left">
                        运行状态、等待队列和失败笔记会在这里集中呈现，便于继续处理。
                      </div>
                    </div>
                    <ChevronDown
                      size={18}
                      className={`text-slate-500 transition-transform ${
                        dashboardExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {dashboardExpanded && (
                    <div className="px-4 md:px-5 pb-5 space-y-3.5 border-t border-slate-200 dark:border-vnote-border">
                      <div className="pt-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-2 flex-1">
                          <MetricCard label="总任务" value={String(runSummary.total)} compact />
                          <MetricCard
                            label="排队中"
                            value={String(runSummary.queued)}
                            accent="text-amber-600 dark:text-amber-400"
                            compact
                          />
                          <MetricCard
                            label="运行中"
                            value={String(runSummary.running)}
                            accent="text-blue-600 dark:text-blue-400"
                            compact
                          />
                          <MetricCard
                            label="成功"
                            value={String(runSummary.success)}
                            accent="text-emerald-600 dark:text-emerald-400"
                            compact
                          />
                          <MetricCard
                            label="部分失败"
                            value={String(runSummary.partial)}
                            accent="text-amber-600 dark:text-amber-400"
                            compact
                          />
                          <MetricCard
                            label="失败"
                            value={String(runSummary.failed)}
                            accent="text-red-600 dark:text-red-400"
                            compact
                          />
                          <MetricCard label="跳过" value={String(runSummary.skipped)} compact />
                        </div>

                        <div className="flex items-center gap-2 self-start xl:pl-2">
                          {runtimeQueue.length > 0 && (
                            <button
                              onClick={clearRuntime}
                              disabled={actionLoading !== null}
                              className={chipButtonClass}
                            >
                              清空等待队列
                            </button>
                          )}
                          {hasActiveTasks && (
                            <button
                              onClick={handleStopAllTasks}
                              disabled={actionLoading !== null}
                              className={chipButtonClass}
                            >
                              停止全部任务
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.95fr)] gap-3">
                        <div className={`${infoSurfaceClass} dark:border-blue-800/45`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                              <Loader2
                                size={13}
                                className={
                                  currentTask?.status === "running"
                                    ? "animate-spin text-blue-500"
                                    : "text-slate-400"
                                }
                              />
                              当前运行
                            </div>
                            <MiniBadge
                              tone={
                                currentTask
                                  ? getRuntimeTaskStatusBadgeTone(currentTask.status)
                                  : "neutral"
                              }
                            >
                              {currentTask ? runtimeTaskStatusLabelMap[currentTask.status] : "空闲"}
                            </MiniBadge>
                          </div>
                          {currentTask ? (
                            <>
                              <div
                                className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate"
                                title={currentTask.params.noteTitle}
                              >
                                {currentTask.params.noteTitle}
                              </div>
                              <div className="rounded-lg border border-blue-200/70 dark:border-blue-900/40 bg-white/46 dark:bg-slate-900/20 px-3 py-2 space-y-1.5">
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  当前步骤
                                </div>
                                <div
                                  className="text-xs text-slate-700 dark:text-slate-200 truncate"
                                  title={currentStepName || undefined}
                                >
                                  {currentStepName || "等待步骤事件..."}
                                </div>
                                {currentStepMessage && (
                                  <div
                                    className="text-[11px] text-slate-500 dark:text-slate-400 truncate"
                                    title={currentStepMessage}
                                  >
                                    {currentStepMessage}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                  <span>整体进度</span>
                                  <span>{initProgress}%</span>
                                </div>
                                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${initProgress}%` }}
                                  />
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
                              <MiniBadge>当前空闲</MiniBadge>
                              <div>当前没有运行中的任务</div>
                              <div>当你开始执行后，这里会显示实时步骤与进度。</div>
                            </div>
                          )}
                        </div>

                        <div className={`${warningSurfaceClass} dark:border-amber-800/45`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                              <Clock size={13} className="text-amber-500" />
                              等待队列
                            </div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {runtimeQueue.length} 条
                            </span>
                          </div>
                          <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                            {runtimeQueue.length === 0 ? (
                              <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
                                <MiniBadge>队列为空</MiniBadge>
                                <div>暂无等待任务</div>
                                <div>新的批量任务会按加入顺序显示在这里，可单独移除。</div>
                              </div>
                            ) : (
                              runtimeQueue.map((task, index) => (
                                <div
                                  key={task.id}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-amber-200/70 dark:border-amber-900/30 bg-white/50 dark:bg-slate-900/20 px-3 py-2"
                                >
                                  <div className="min-w-0 flex items-center gap-2">
                                    <span className="text-[11px] text-amber-700 dark:text-amber-300 shrink-0">
                                      #{index + 1}
                                    </span>
                                    <span
                                      className="text-xs text-slate-700 dark:text-slate-200 truncate"
                                      title={task.params.noteTitle}
                                    >
                                      {task.params.noteTitle}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => removeFromRuntime(task.id)}
                                    className={inlineDangerActionClass}
                                  >
                                    移除
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className={`${dangerSurfaceClass} dark:border-red-800/45`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                              <AlertCircle size={13} className="text-red-500" />
                              失败笔记
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {failedOverview.length} 条
                              </span>
                              {failedOverview.length > 0 && (
                                <button
                                  onClick={selectFailedNotes}
                                  className={subtleDangerButtonClass}
                                >
                                  一键选中
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                            {failedOverview.length === 0 ? (
                              <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
                                <MiniBadge tone="success">当前无失败</MiniBadge>
                                <div>当前没有失败笔记</div>
                                <div>如果后续出现失败或部分失败的笔记，会集中展示在这里便于重试。</div>
                              </div>
                            ) : (
                              failedOverview.map((item) => (
                                <div
                                  key={item.note_id}
                                  className="rounded-lg border border-red-200/70 dark:border-red-900/40 bg-white/50 dark:bg-slate-900/20 px-3 py-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      className="text-xs text-slate-800 dark:text-slate-100 truncate"
                                      title={item.note_title}
                                    >
                                      {item.note_title}
                                    </span>
                                    <button
                                      onClick={() => selectOnlyNote(item.note_id)}
                                      className={subtleDangerButtonClass}
                                    >
                                      选中
                                    </button>
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-red-500">
                                    <MiniBadge tone="danger">失败 {item.failed_count}</MiniBadge>
                                    <MiniBadge tone={getRunStatusBadgeTone(item.run_status)}>
                                      {runStatusLabelMap[item.run_status]}
                                    </MiniBadge>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  index,
  title,
  description,
  summary,
  active,
  onClick,
}: {
  index: number;
  title: string;
  description: string;
  summary: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-[24px] border p-4 text-left transition-all duration-200 cursor-pointer ${
        active
          ? "border-blue-400/80 bg-[linear-gradient(180deg,rgba(239,246,255,0.72),rgba(219,234,254,0.54))] shadow-[0_18px_36px_rgba(59,130,246,0.12)] dark:border-blue-500/70 dark:bg-[linear-gradient(180deg,rgba(30,64,175,0.28),rgba(15,23,42,0.84))]"
          : "border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(248,250,252,0.52))] hover:bg-slate-50/70 hover:border-slate-300/90 dark:border-slate-700/80 dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.48),rgba(15,23,42,0.76))] dark:hover:bg-slate-800/74"
      }`}
    >
      <div className={`absolute inset-x-0 top-0 h-px ${active ? "bg-gradient-to-r from-transparent via-blue-400/80 to-transparent" : "bg-transparent"}`} />
      <div className={`absolute inset-y-0 left-0 w-[3px] rounded-r-full transition-opacity ${active ? "bg-blue-500/80 opacity-100" : "bg-transparent opacity-0"}`} />
      <div className="flex items-start gap-3.5">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold shadow-sm ${
            active
              ? "bg-blue-600 text-white ring-4 ring-blue-100/90 dark:bg-blue-500 dark:ring-blue-500/15"
              : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}
        >
          {index}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-[0.01em] text-slate-900 dark:text-slate-100">
              {title}
            </span>
            {active && <MiniBadge tone="strong-info">当前步骤</MiniBadge>}
          </div>
          <div className="text-xs leading-5 text-slate-500 dark:text-slate-400 max-w-[24ch]">
            {description}
          </div>
          <div className={`text-[11px] truncate ${active ? "text-blue-700 dark:text-blue-300" : "text-slate-500 dark:text-slate-400"}`}>
            {summary}
          </div>
        </div>
      </div>
    </button>
  );
}

function DropdownOptionButton({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mx-1.5 flex w-[calc(100%-0.75rem)] items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors cursor-pointer ${
        selected
          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/25 dark:text-blue-300"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/70"
      }`}
    >
      <span className="truncate">{label}</span>
      {selected && <Check className="w-4 h-4 flex-shrink-0 ml-2" />}
    </button>
  );
}

function MetricCard({
  label,
  value,
  accent,
  compact = false,
}: {
  label: string;
  value: string;
  accent?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(248,250,252,0.54))] dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.5),rgba(15,23,42,0.72))] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
        compact ? "px-3 py-2.5" : "px-4 py-3"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={`mt-1.5 font-semibold text-slate-900 dark:text-slate-100 ${compact ? "text-base" : "text-lg"} ${accent ?? ""}`}
      >
        {value}
      </div>
    </div>
  );
}
