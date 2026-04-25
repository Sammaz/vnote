import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, Download, Edit3, GitBranch, RefreshCw, Sparkles, X } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { AiConfig, Note, PromptConfig } from "../../types";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { message } from "../../utils/message";
import { copyText } from "../../utils/clipboard";
import { EditableMarkdown } from "./EditableMarkdown";
import { AiNoteMindMap } from "./AiNoteMindMap";
import { getNoteGenerationState, setNoteGenerationState } from "../../utils/noteGenerationState";

interface AiNoteMeta {
  style?: string;
  custom_prompt?: string | null;
  model_id?: string;
  screenshot_density?: AiNoteScreenshotDensity | null;
  has_screenshots?: boolean;
  generated_at?: string;
}

interface AiNoteContentProps {
  note: Note;
  aiConfigs: AiConfig[];
  currentModelId?: string | null;
  promptConfigs: PromptConfig[];
  isGenerating: boolean;
  onGenerationComplete?: () => void;
  setupGenerationListener: (noteId: string, genId: string) => void;
}

type AiNoteStyle = "concise" | "detailed" | "outline";
type AiNoteScreenshotDensity = "off" | "few" | "moderate" | "dense";

const AI_NOTE_STYLE_OPTIONS: Array<{ value: AiNoteStyle; label: string; description: string }> = [
  { value: "concise", label: "简洁", description: "更聚焦核心结论与重点，适合快速复习。" },
  { value: "detailed", label: "详细", description: "兼顾概念、步骤与细节，适合系统学习。" },
  { value: "outline", label: "大纲", description: "更强调标题层级与结构，便于转换脑图。" },
];

const AI_NOTE_STYLE_LABELS: Record<AiNoteStyle, string> = {
  concise: "简洁",
  detailed: "详细",
  outline: "大纲",
};

const AI_NOTE_SCREENSHOT_OPTIONS: Array<{ value: AiNoteScreenshotDensity; label: string; description: string }> = [
  { value: "off", label: "关闭", description: "仅生成文字笔记，不插入关键帧截图。" },
  { value: "few", label: "少量", description: "仅在最关键章节插入少量截图，适合快速回看。" },
  { value: "moderate", label: "适中", description: "每个主要章节配一张截图，兼顾结构与可回看性。" },
  { value: "dense", label: "密集", description: "尽可能保留更多视觉节点，适合演示型视频。" },
];

const AI_NOTE_SCREENSHOT_LABELS: Record<AiNoteScreenshotDensity, string> = {
  off: "关闭",
  few: "少量",
  moderate: "适中",
  dense: "密集",
};

function parseAiNoteMeta(metaJson: string | null): AiNoteMeta | null {
  if (!metaJson) return null;
  try {
    return JSON.parse(metaJson) as AiNoteMeta;
  } catch {
    return null;
  }
}

function parseAiNoteStyle(style?: string | null): AiNoteStyle | null {
  if (style === "concise" || style === "detailed" || style === "outline") {
    return style;
  }
  return null;
}

function parseAiNoteScreenshotDensity(value?: string | null): AiNoteScreenshotDensity {
  if (value === "few" || value === "moderate" || value === "dense") {
    return value;
  }
  return "off";
}

function buildMindMapSvgContent(svg: SVGSVGElement): string {
  const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
  const sourceElements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const clonedElements = [clonedSvg, ...Array.from(clonedSvg.querySelectorAll("*"))];

  sourceElements.forEach((sourceElement, index) => {
    const targetElement = clonedElements[index];
    if (!targetElement) {
      return;
    }

    const computedStyle = window.getComputedStyle(sourceElement);
    const styleText = Array.from(computedStyle)
      .map((property) => `${property}:${computedStyle.getPropertyValue(property)};`)
      .join("");

    if (styleText) {
      targetElement.setAttribute("style", styleText);
    }
  });

  clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clonedSvg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      const padding = 24;
      clonedSvg.setAttribute("viewBox", `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`);
      clonedSvg.setAttribute("width", `${Math.ceil(bbox.width + padding * 2)}`);
      clonedSvg.setAttribute("height", `${Math.ceil(bbox.height + padding * 2)}`);
    }
  } catch {
    // ignore svg bounding box errors when exporting
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clonedSvg)}`;
}

function getElementContentWidth(element: HTMLElement | null): number {
  if (!element) return 0;
  return Math.max(element.scrollWidth, element.offsetWidth);
}

export function AiNoteContent({
  note,
  aiConfigs,
  currentModelId,
  promptConfigs,
  isGenerating,
  onGenerationComplete,
  setupGenerationListener,
}: AiNoteContentProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [viewMode, setViewMode] = useState<"markdown" | "mindmap">("markdown");
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<AiNoteStyle>("detailed");
  const [selectedScreenshotDensity, setSelectedScreenshotDensity] = useState<AiNoteScreenshotDensity>("off");
  const [customPrompt, setCustomPrompt] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);
  const [mindMapSvg, setMindMapSvg] = useState<SVGSVGElement | null>(null);
  const [mindMapDepthControlContainer, setMindMapDepthControlContainer] = useState<HTMLDivElement | null>(null);
  const [isCompactToolbarLeft, setIsCompactToolbarLeft] = useState(false);
  const [isCompactToolbarRight, setIsCompactToolbarRight] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureLeftExpandedRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureLeftCompactRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureRightExpandedRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureRightCompactRef = useRef<HTMLDivElement>(null);
  const toolbarCompactStateRef = useRef({ left: false, right: false });
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const promptDropdownRef = useRef<HTMLDivElement>(null);

  const glassPanel = useGlassBg("panel");
  const glassMenu = useGlassBg("menu");
  const glassInput = useGlassBg("input");
  const glassModal = useGlassBg("modal");

  const toolbarButtonClass = "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium text-slate-600 transition-all cursor-pointer hover:bg-white/80 hover:text-slate-800 hover:shadow-sm dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-slate-100 sm:justify-start";
  const toolbarIconButtonClass = "inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 transition-all cursor-pointer hover:bg-white/80 hover:text-slate-800 hover:shadow-sm dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-slate-100";
  const toolbarButtonActiveClass = "bg-blue-50/90 text-blue-600 shadow-sm dark:bg-blue-500/14 dark:text-blue-400";
  const toolbarBarClass = "flex items-center gap-3 border-b border-slate-200/80 bg-slate-50/85 px-4 py-3 backdrop-blur-sm dark:border-vnote-border/80 dark:bg-vnote-surface/80";
  const toolbarCompactBarClass = "gap-2 px-3 py-2.5 overflow-hidden";
  const toolbarSectionClass = "flex items-center gap-2 min-w-0 flex-nowrap overflow-hidden";
  const toolbarCompactSectionClass = "flex-nowrap gap-1.5 shrink-0 overflow-hidden";
  const toolbarSectionEndClass = cn(toolbarSectionClass, "justify-end sm:ml-auto");
  const toolbarCompactSectionEndClass = "ml-auto flex-nowrap gap-1 shrink-0 overflow-hidden";
  const toolbarMetaPillClass = "inline-flex h-9 items-center whitespace-nowrap rounded-xl border border-slate-200/80 bg-white/75 px-3 text-xs font-medium text-slate-500 shadow-sm dark:border-vnote-border/80 dark:bg-white/5 dark:text-slate-400";
  const toolbarCompactMetaPillClass = "px-2.5 text-[11px] whitespace-nowrap shrink-0";
  const toolbarDivider = <div className="hidden h-5 w-px bg-slate-200/90 dark:bg-vnote-border/80 sm:block" aria-hidden="true" />;

  const aiNoteMeta = parseAiNoteMeta(note.ai_note_meta);
  const aiNoteStyle = parseAiNoteStyle(aiNoteMeta?.style) ?? "detailed";
  const hasCustomPrompt = Boolean(aiNoteMeta?.custom_prompt?.trim());
  const aiNotePromptConfigs = promptConfigs;
  const aiNoteScreenshotLabel = AI_NOTE_SCREENSHOT_LABELS[parseAiNoteScreenshotDensity(aiNoteMeta?.screenshot_density)];

  const getDefaultModelId = useCallback(() => {
    if (currentModelId) return currentModelId;
    if (aiNoteMeta?.model_id) return aiNoteMeta.model_id;

    const defaultConfig = aiConfigs.find((config) => config.is_default);
    if (defaultConfig) return defaultConfig.id;

    return aiConfigs[0]?.id || "";
  }, [aiConfigs, aiNoteMeta?.model_id, currentModelId]);

  const openPromptDialog = useCallback(() => {
    setSelectedModelId(getDefaultModelId());
    setSelectedStyle(parseAiNoteStyle(aiNoteMeta?.style) ?? "detailed");
    setSelectedScreenshotDensity(parseAiNoteScreenshotDensity(aiNoteMeta?.screenshot_density));
    setCustomPrompt(aiNoteMeta?.custom_prompt || "");
    setShowModelDropdown(false);
    setShowPromptDropdown(false);
    setShowPromptDialog(true);
  }, [aiNoteMeta?.custom_prompt, aiNoteMeta?.screenshot_density, aiNoteMeta?.style, getDefaultModelId]);

  const handleCopy = useCallback(async () => {
    if (!note.ai_note_markdown) {
      message.warning("暂无内容可复制");
      return;
    }

    try {
      await copyText(note.ai_note_markdown);
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  }, [note.ai_note_markdown]);

  const handleDownloadMarkdown = useCallback(async () => {
    if (!note.ai_note_markdown) {
      message.warning("暂无内容可下载");
      return;
    }

    try {
      const filePath = await save({
        defaultPath: `${note.title}_大纲笔记`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });

      if (!filePath) return;

      await invoke("save_file_content", { path: filePath, content: note.ai_note_markdown });
      message.success("下载成功");
    } catch (error) {
      console.error("下载失败:", error);
      message.error(`下载失败: ${error}`);
    }
  }, [note.ai_note_markdown, note.title]);

  const handleDownloadMindMap = useCallback(async () => {
    if (!mindMapSvg) {
      message.warning("暂无思维导图可下载");
      return;
    }

    try {
      const filePath = await save({
        defaultPath: `${note.title}_思维导图`,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });

      if (!filePath) return;

      await invoke("save_file_content", { path: filePath, content: buildMindMapSvgContent(mindMapSvg) });
      message.success("下载成功");
    } catch (error) {
      console.error("下载思维导图失败:", error);
      message.error(`下载失败: ${error}`);
    }
  }, [mindMapSvg, note.title]);

  const handleGenerate = useCallback(async () => {
    if (!selectedModelId) {
      message.warning("请选择AI模型");
      return;
    }

    const globalState = getNoteGenerationState(note.id);
    if (globalState.regeneratingTabs.has("ai_note")) {
      message.warning("大纲笔记正在生成中，请稍后再试");
      return;
    }

    const trimmedPrompt = customPrompt.trim();

    setShowPromptDialog(false);
    setIsEditMode(false);

    try {
      const generationId = crypto.randomUUID();
      const currentTabs = new Set(globalState.regeneratingTabs);
      currentTabs.add("ai_note");
      setNoteGenerationState(note.id, {
        regeneratingTabs: currentTabs,
      });
      setupGenerationListener(note.id, generationId);
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await invoke("clear_ai_note_screenshots", { noteId: note.id });
      } catch (clearError) {
        console.error("[AiNoteContent] 清除大纲笔记截图缓存失败:", clearError);
      }
      await invoke("generate_ai_note_content", {
        generationId,
        noteId: note.id,
        modelId: selectedModelId,
        regenerate: true,
        style: selectedStyle,
        customPrompt: trimmedPrompt || null,
        screenshotDensity: selectedScreenshotDensity,
      });
    } catch (error) {
      const currentTabs = new Set(getNoteGenerationState(note.id).regeneratingTabs);
      currentTabs.delete("ai_note");
      setNoteGenerationState(note.id, {
        regeneratingTabs: currentTabs,
      });
      message.error(`生成失败: ${error}`);
    }
  }, [customPrompt, note.id, selectedModelId, selectedScreenshotDensity, selectedStyle, setupGenerationListener]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
      if (promptDropdownRef.current && !promptDropdownRef.current.contains(event.target as Node)) {
        setShowPromptDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!note.ai_note_markdown) {
      setIsEditMode(false);
      setViewMode("markdown");
    }
  }, [note.ai_note_markdown]);

  const hasAiNote = Boolean(note.ai_note_markdown);
  useEffect(() => {
    const toolbarElement = toolbarRef.current;
    const measureLeftExpandedElement = toolbarMeasureLeftExpandedRef.current;
    const measureLeftCompactElement = toolbarMeasureLeftCompactRef.current;
    const measureRightExpandedElement = toolbarMeasureRightExpandedRef.current;
    const measureRightCompactElement = toolbarMeasureRightCompactRef.current;
    if (!toolbarElement || !measureLeftExpandedElement || !measureLeftCompactElement || !measureRightExpandedElement || !measureRightCompactElement) {
      return;
    }

    const updateCompactMode = () => {
      const toolbarWidth = toolbarElement.clientWidth;
      const leftExpandedWidth = getElementContentWidth(measureLeftExpandedElement);
      const leftCompactWidth = getElementContentWidth(measureLeftCompactElement);
      const rightExpandedWidth = getElementContentWidth(measureRightExpandedElement);
      const rightCompactWidth = getElementContentWidth(measureRightCompactElement);

      let nextLeftCompact = false;
      let nextRightCompact = false;

      if (leftExpandedWidth + rightExpandedWidth <= toolbarWidth + 1) {
        nextLeftCompact = false;
        nextRightCompact = false;
      } else if (leftExpandedWidth + rightCompactWidth <= toolbarWidth + 1) {
        nextLeftCompact = false;
        nextRightCompact = true;
      } else {
        nextLeftCompact = true;
        nextRightCompact = leftCompactWidth + rightExpandedWidth > toolbarWidth + 1;
      }

      if (
        toolbarCompactStateRef.current.left !== nextLeftCompact ||
        toolbarCompactStateRef.current.right !== nextRightCompact
      ) {
        toolbarCompactStateRef.current = { left: nextLeftCompact, right: nextRightCompact };
        setIsCompactToolbarLeft(nextLeftCompact);
        setIsCompactToolbarRight(nextRightCompact);
      }
    };

    updateCompactMode();

    const observer = new ResizeObserver(() => {
      updateCompactMode();
    });
    observer.observe(toolbarElement);
    observer.observe(measureLeftExpandedElement);
    observer.observe(measureLeftCompactElement);
    observer.observe(measureRightExpandedElement);
    observer.observe(measureRightCompactElement);

    return () => observer.disconnect();
    // 依赖只关心是否渲染了工具栏（hasAiNote）以及布局影响宽度的开关，
    // 不依赖 note.ai_note_markdown 字符串本身——流式期间字符串变化会
    // 导致 observer 反复重建，造成卡顿。
  }, [hasAiNote, viewMode, isEditMode, hasCustomPrompt, aiNoteStyle, aiNoteScreenshotLabel]);

  return (
    <div className="h-full flex flex-col">
      {note.ai_note_markdown && (
        <div className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
          <div ref={toolbarMeasureLeftExpandedRef} className={cn(toolbarBarClass, "w-max flex-nowrap") }>
            <div className={toolbarSectionClass}>
              <div className={cn("inline-flex items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/70 p-1 shadow-sm dark:border-vnote-border/80 dark:bg-white/5 shrink-0", glassPanel)}>
                <button type="button" className={cn(toolbarButtonClass, viewMode === "markdown" && toolbarButtonActiveClass)}>
                  文档
                </button>
                <button type="button" className={cn(toolbarButtonClass, viewMode === "mindmap" && toolbarButtonActiveClass)}>
                  脑图
                </button>
              </div>
              {viewMode === "mindmap" ? (
                <div className={cn("flex min-w-0 items-center gap-2 rounded-xl border border-slate-200/80 px-3 py-1.5 dark:border-vnote-border/80 shrink-0", glassPanel)}>
                  <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">显示层级</span>
                </div>
              ) : null}
              {viewMode === "markdown" && (
                <>
                  <button type="button" className={cn(toolbarButtonClass, isEditMode && toolbarButtonActiveClass)}>
                    <Edit3 className="w-4 h-4" />
                    {isEditMode ? "预览" : "编辑"}
                  </button>
                  <span className={toolbarMetaPillClass}>
                    {hasCustomPrompt ? "自定义" : `风格：${AI_NOTE_STYLE_LABELS[aiNoteStyle]}`}
                  </span>
                  <span className={toolbarMetaPillClass}>{`截图：${aiNoteScreenshotLabel}`}</span>
                </>
              )}
            </div>
          </div>
          <div ref={toolbarMeasureLeftCompactRef} className={cn(toolbarBarClass, toolbarCompactBarClass, "w-max flex-nowrap") }>
            <div className={cn(toolbarSectionClass, toolbarCompactSectionClass)}>
              <div className={cn("inline-flex items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/70 p-1 shadow-sm dark:border-vnote-border/80 dark:bg-white/5 shrink-0", glassPanel)}>
                <button type="button" className={cn(toolbarButtonClass, viewMode === "markdown" && toolbarButtonActiveClass)}>
                  文档
                </button>
                <button type="button" className={cn(toolbarButtonClass, viewMode === "mindmap" && toolbarButtonActiveClass)}>
                  脑图
                </button>
              </div>
              {viewMode === "mindmap" ? (
                <div className={cn("flex min-w-0 items-center gap-2 rounded-xl border border-slate-200/80 px-3 py-1.5 dark:border-vnote-border/80 shrink-0", glassPanel)}>
                  <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">显示层级</span>
                </div>
              ) : null}
              {viewMode === "markdown" && (
                <>
                  <button type="button" className={cn(toolbarIconButtonClass, isEditMode && toolbarButtonActiveClass)}>
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <span className={cn(toolbarMetaPillClass, toolbarCompactMetaPillClass)}>
                    {hasCustomPrompt ? "自定义" : AI_NOTE_STYLE_LABELS[aiNoteStyle]}
                  </span>
                  <span className={cn(toolbarMetaPillClass, toolbarCompactMetaPillClass)}>{aiNoteScreenshotLabel}</span>
                </>
              )}
            </div>
          </div>
          <div ref={toolbarMeasureRightExpandedRef} className={cn(toolbarBarClass, "w-max flex-nowrap") }>
            <div className={toolbarSectionEndClass}>
              {viewMode === "markdown" ? (
                <>
                  <button type="button" className={toolbarButtonClass}>
                    <Copy className="w-4 h-4" />
                    复制
                  </button>
                  {toolbarDivider}
                  <button type="button" className={toolbarButtonClass}>
                    <Download className="w-4 h-4" />
                    下载
                  </button>
                  {toolbarDivider}
                  <button type="button" className={toolbarButtonClass}>
                    <RefreshCw className="w-4 h-4" />
                    重新生成
                  </button>
                </>
              ) : (
                <button type="button" className={toolbarButtonClass}>
                  <Download className="w-4 h-4" />
                  下载
                </button>
              )}
            </div>
          </div>
          <div ref={toolbarMeasureRightCompactRef} className={cn(toolbarBarClass, toolbarCompactBarClass, "w-max flex-nowrap") }>
            <div className={cn(toolbarSectionEndClass, toolbarCompactSectionEndClass)}>
              {viewMode === "markdown" ? (
                <>
                  <button type="button" className={toolbarIconButtonClass}>
                    <Copy className="w-4 h-4" />
                  </button>
                  <button type="button" className={toolbarIconButtonClass}>
                    <Download className="w-4 h-4" />
                  </button>
                  <button type="button" className={toolbarIconButtonClass}>
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button type="button" className={toolbarIconButtonClass}>
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {note.ai_note_markdown && (
        <div
          ref={toolbarRef}
          className={cn(
            toolbarBarClass,
            (isCompactToolbarLeft || isCompactToolbarRight) && toolbarCompactBarClass,
            "flex-nowrap"
          )}
        >
          <div className={cn(toolbarSectionClass, isCompactToolbarLeft && toolbarCompactSectionClass)} data-toolbar-row>
            <div className={cn("inline-flex items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/70 p-1 shadow-sm dark:border-vnote-border/80 dark:bg-white/5 shrink-0", glassPanel)}>
              <button
                onClick={() => setViewMode("markdown")}
                className={cn(toolbarButtonClass, viewMode === "markdown" && toolbarButtonActiveClass)}
              >
                文档
              </button>
              <button
                onClick={() => setViewMode("mindmap")}
                className={cn(toolbarButtonClass, viewMode === "mindmap" && toolbarButtonActiveClass)}
              >
                脑图
              </button>
            </div>
            {viewMode === "mindmap" ? (
              <div
                ref={setMindMapDepthControlContainer}
                className={cn("flex min-w-0 items-center gap-2 rounded-xl border border-slate-200/80 px-3 py-1.5 dark:border-vnote-border/80 shrink-0", glassPanel)}
                title="显示层级"
              />
            ) : null}
            {viewMode === "markdown" && (
              <>
                <button
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={cn(
                    isCompactToolbarLeft ? toolbarIconButtonClass : toolbarButtonClass,
                    isEditMode && toolbarButtonActiveClass
                  )}
                  title={isEditMode ? "预览" : "编辑"}
                >
                  <Edit3 className="w-4 h-4" />
                  {!isCompactToolbarLeft && (isEditMode ? "预览" : "编辑")}
                </button>
                <span className={cn(toolbarMetaPillClass, isCompactToolbarLeft && toolbarCompactMetaPillClass)}>
                  {hasCustomPrompt
                    ? "自定义"
                    : isCompactToolbarLeft
                      ? AI_NOTE_STYLE_LABELS[aiNoteStyle]
                      : `风格：${AI_NOTE_STYLE_LABELS[aiNoteStyle]}`}
                </span>
                <span className={cn(toolbarMetaPillClass, isCompactToolbarLeft && toolbarCompactMetaPillClass)}>
                  {isCompactToolbarLeft
                    ? aiNoteScreenshotLabel
                    : `截图：${aiNoteScreenshotLabel}`}
                </span>
              </>
            )}
          </div>
          <div className={cn(toolbarSectionEndClass, isCompactToolbarRight && toolbarCompactSectionEndClass)} data-toolbar-row>
            {viewMode === "markdown" ? (
              <>
                <button
                  onClick={handleCopy}
                  className={isCompactToolbarRight ? toolbarIconButtonClass : toolbarButtonClass}
                  title="复制"
                >
                  <Copy className="w-4 h-4" />
                  {!isCompactToolbarRight && "复制"}
                </button>
                {!isCompactToolbarRight && toolbarDivider}
                <button
                  onClick={handleDownloadMarkdown}
                  className={isCompactToolbarRight ? toolbarIconButtonClass : toolbarButtonClass}
                  title="下载"
                >
                  <Download className="w-4 h-4" />
                  {!isCompactToolbarRight && "下载"}
                </button>
                {!isCompactToolbarRight && toolbarDivider}
                <button
                  onClick={openPromptDialog}
                  className={isCompactToolbarRight ? toolbarIconButtonClass : toolbarButtonClass}
                  title="重新生成"
                >
                  <RefreshCw className="w-4 h-4" />
                  {!isCompactToolbarRight && "重新生成"}
                </button>
              </>
            ) : (
              <button
                onClick={handleDownloadMindMap}
                className={isCompactToolbarRight ? toolbarIconButtonClass : toolbarButtonClass}
                title="下载"
              >
                <Download className="w-4 h-4" />
                {!isCompactToolbarRight && "下载"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className={cn("flex-1 min-h-0", viewMode === "mindmap" ? "p-0 overflow-hidden" : isEditMode ? "p-0 overflow-y-auto overflow-x-hidden" : "p-6 overflow-y-auto overflow-x-hidden")}>
        {note.ai_note_markdown ? (
          viewMode === "mindmap" ? (
            <AiNoteMindMap
              markdown={note.ai_note_markdown}
              noteTitle={note.title}
              depthControlContainer={mindMapDepthControlContainer}
              onSvgReady={setMindMapSvg}
            />
          ) : (
            <EditableMarkdown
              noteId={note.id}
              tabType="ai_note"
              content={note.ai_note_markdown}
              isGenerating={isGenerating}
              emptyMessage="大纲笔记内容将在生成后显示"
              isEditMode={isEditMode}
              onContentUpdate={onGenerationComplete}
            />
          )
        ) : isGenerating ? (
          <EditableMarkdown
            noteId={note.id}
            tabType="ai_note"
            content={null}
            isGenerating={true}
            emptyMessage=""
            isEditMode={false}
            onContentUpdate={onGenerationComplete}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center">
                <GitBranch className="w-8 h-8 text-blue-500" />
              </div>
              <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-2">大纲笔记</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-xs">
                自动提炼核心概念、层级关系、方法步骤和行动清单，便于复习与后续整理。
              </p>
              <button
                onClick={openPromptDialog}
                disabled={!note.subtitle_path || aiConfigs.length === 0}
                className={cn(
                  "inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                )}
              >
                <Sparkles className="w-4 h-4" />
                开始生成
              </button>
              {(!note.subtitle_path || aiConfigs.length === 0) && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                  {!note.subtitle_path ? "请先上传字幕文件" : "请先配置 AI 模型"}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {showPromptDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm" onClick={() => setShowPromptDialog(false)}>
          <div className={cn("w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/80 shadow-[0_24px_80px_rgba(15,23,42,0.18)]", glassModal)} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-3.5 dark:border-vnote-border/80">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-500" />
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">大纲笔记</h3>
              </div>
              <button
                onClick={() => setShowPromptDialog(false)}
                className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-white/80 hover:text-slate-600 dark:hover:bg-white/8 dark:hover:text-slate-300 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex max-h-[min(72vh,560px)] flex-col gap-4 overflow-y-auto overflow-x-hidden px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">模型</span>
                <div className="relative flex-1 min-w-0" ref={modelDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className={cn("w-full h-9 rounded-lg border border-slate-200/80 px-3 pr-8 text-left text-sm font-medium text-slate-900 transition-all truncate cursor-pointer hover:border-slate-300/90 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-vnote-border/80 dark:text-slate-100 dark:hover:border-slate-500", glassInput)}
                  >
                    {aiConfigs.find((config) => config.id === selectedModelId)?.title || "选择模型"}
                  </button>
                  <ChevronDown className={cn("pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 transition-transform", showModelDropdown && "rotate-180")} />
                  {showModelDropdown && (
                    <div className={cn("absolute left-0 right-0 z-50 mt-1.5 overflow-auto rounded-xl border border-slate-200/80 py-1 shadow-[0_18px_45px_rgba(15,23,42,0.16)] max-h-52 dark:border-vnote-border/80", glassMenu)}>
                      {aiConfigs.map((config) => (
                        <button
                          key={config.id}
                          type="button"
                          onClick={() => {
                            setSelectedModelId(config.id);
                            setShowModelDropdown(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors cursor-pointer hover:bg-white/80 dark:hover:bg-white/8",
                            selectedModelId === config.id
                              ? "bg-blue-50/90 text-blue-600 dark:bg-blue-500/14 dark:text-blue-400"
                              : "text-slate-700 dark:text-slate-300"
                          )}
                        >
                          <span className="truncate">{config.title}</span>
                          {selectedModelId === config.id && <Check className="ml-2 h-3.5 w-3.5 flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">笔记风格</label>
                </div>
                <div className="flex gap-2">
                  {AI_NOTE_STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedStyle(option.value)}
                      className={cn(
                        "flex-1 h-9 rounded-lg border text-sm font-medium transition-all cursor-pointer",
                        selectedStyle === option.value
                          ? "border-blue-200/80 bg-blue-50/90 text-blue-700 shadow-sm dark:border-blue-400/40 dark:bg-blue-900/20 dark:text-blue-300"
                          : "border-slate-200/80 bg-white/72 text-slate-700 hover:border-slate-300/90 hover:shadow-sm dark:border-vnote-border/80 dark:bg-white/5 dark:text-slate-300 dark:hover:border-slate-500"
                      )}
                      title={option.description}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">关键帧截图</label>
                  <span className="text-xs text-slate-500 dark:text-slate-400">控制插图密度</span>
                </div>
                <div className="flex gap-2">
                  {AI_NOTE_SCREENSHOT_OPTIONS.map((option) => (
                    <div key={option.value} className="group relative flex-1">
                      <button
                        type="button"
                        onClick={() => setSelectedScreenshotDensity(option.value)}
                        className={cn(
                          "w-full h-9 rounded-lg border text-sm font-medium transition-all cursor-pointer",
                          selectedScreenshotDensity === option.value
                            ? "border-blue-200/80 bg-blue-50/90 text-blue-700 shadow-sm dark:border-blue-400/40 dark:bg-blue-900/20 dark:text-blue-300"
                            : "border-slate-200/80 bg-white/72 text-slate-700 hover:border-slate-300/90 hover:shadow-sm dark:border-vnote-border/80 dark:bg-white/5 dark:text-slate-300 dark:hover:border-slate-500"
                        )}
                      >
                        {option.label}
                      </button>
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[200px] -translate-x-1/2 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-slate-200 dark:text-slate-800">
                        {option.description}
                        <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-4 border-x-transparent border-t-4 border-t-slate-800 dark:border-t-slate-200" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={cn("rounded-xl border border-slate-200/80 p-3 dark:border-vnote-border/80", glassPanel)}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">补充提示词</label>
                  {aiNotePromptConfigs.length > 0 && (
                    <div className="relative shrink-0" ref={promptDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowPromptDropdown(!showPromptDropdown)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200/80 px-2.5 text-xs font-medium text-slate-600 transition-all cursor-pointer hover:border-slate-300/90 hover:shadow-sm dark:border-vnote-border/80 dark:text-slate-400 dark:hover:border-slate-500"
                      >
                        已配置提示词
                        <ChevronDown className={cn("h-3 w-3 transition-transform", showPromptDropdown && "rotate-180")} />
                      </button>
                      {showPromptDropdown && (
                        <div className={cn("absolute right-0 z-50 mt-1 w-56 overflow-auto rounded-xl border border-slate-200/80 py-1 shadow-[0_18px_45px_rgba(15,23,42,0.16)] max-h-44 dark:border-vnote-border/80", glassMenu)}>
                          {aiNotePromptConfigs.map((prompt) => (
                            <button
                              key={prompt.id}
                              type="button"
                              onClick={() => {
                                setCustomPrompt(prompt.content);
                                setShowPromptDropdown(false);
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-white/80 dark:text-slate-300 dark:hover:bg-white/8 cursor-pointer"
                            >
                              <div className="truncate font-medium">{prompt.title}</div>
                              {prompt.description && (
                                <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{prompt.description}</div>
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
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="可选：补充希望 AI 额外关注的重点"
                  rows={3}
                  className={cn("w-full rounded-lg border border-slate-200/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-vnote-border/80 dark:text-slate-100", glassInput)}
                />
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  不填写时将使用当前风格的默认大纲笔记提示词
                </p>
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-200/80 px-5 py-3.5 dark:border-vnote-border/80 sm:justify-end">
              <button
                onClick={() => setShowPromptDialog(false)}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200/80 px-4 text-sm font-medium text-slate-600 transition-all cursor-pointer hover:bg-white/80 hover:text-slate-800 hover:shadow-sm dark:border-vnote-border/80 dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-slate-100"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-all cursor-pointer hover:bg-blue-700 hover:shadow-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                开始生成
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
