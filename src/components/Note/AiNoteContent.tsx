import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Download, Edit3, GitBranch, RefreshCw, Sparkles, X } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { AiConfig, Note, PromptConfig } from "../../types";
import { cn } from "../../utils/cn";
import { message } from "../../utils/message";
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

  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const promptDropdownRef = useRef<HTMLDivElement>(null);

  const aiNoteMeta = parseAiNoteMeta(note.ai_note_meta);
  const aiNoteStyle = parseAiNoteStyle(aiNoteMeta?.style) ?? "detailed";
  const hasCustomPrompt = Boolean(aiNoteMeta?.custom_prompt?.trim());
  const aiNotePromptConfigs = promptConfigs;

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
    setShowPromptDialog(true);
  }, [aiNoteMeta?.custom_prompt, aiNoteMeta?.screenshot_density, aiNoteMeta?.style, getDefaultModelId]);

  const handleCopy = useCallback(async () => {
    if (!note.ai_note_markdown) {
      message.warning("暂无内容可复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(note.ai_note_markdown);
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

  useEffect(() => {
    if (viewMode !== "mindmap") {
      setMindMapSvg(null);
    }
  }, [viewMode]);

  return (
    <div className="h-full flex flex-col">
      {note.ai_note_markdown && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              <button
                onClick={() => setViewMode("markdown")}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer",
                  viewMode === "markdown"
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                文档
              </button>
              <button
                onClick={() => setViewMode("mindmap")}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer",
                  viewMode === "mindmap"
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                脑图
              </button>
            </div>
            {viewMode === "mindmap" ? (
              <div
                ref={setMindMapDepthControlContainer}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                title="显示层级"
              />
            ) : null}
            {viewMode === "markdown" && (
              <>
                <button
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                    isEditMode
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                  )}
                >
                  <Edit3 className="w-4 h-4" />
                  {isEditMode ? "预览" : "编辑"}
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800">
                  风格：{hasCustomPrompt ? "自定义" : AI_NOTE_STYLE_LABELS[aiNoteStyle]}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800">
                  截图：{AI_NOTE_SCREENSHOT_LABELS[parseAiNoteScreenshotDensity(aiNoteMeta?.screenshot_density)]}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {viewMode === "markdown" ? (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  复制
                </button>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <button
                  onClick={handleDownloadMarkdown}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  下载
                </button>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <button
                  onClick={openPromptDialog}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  重新生成
                </button>
              </>
            ) : (
              <button
                onClick={handleDownloadMindMap}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                下载
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

      {showPromptDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPromptDialog(false)}>
          <div className="bg-white dark:bg-vnote-card rounded-2xl shadow-2xl w-[600px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-8 pt-6 pb-4">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-500" />
                大纲笔记
              </h3>
              <button
                onClick={() => setShowPromptDialog(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="px-8 py-6">
              <div className="flex items-center justify-between mb-5">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">大语言模型</span>
                <div className="relative" ref={modelDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className="w-48 px-3 py-2 pr-10 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 font-medium text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all truncate"
                  >
                    {aiConfigs.find((config) => config.id === selectedModelId)?.title || "选择模型"}
                  </button>
                  <ChevronDown className={cn("absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform", showModelDropdown && "rotate-180")} />
                  {showModelDropdown && (
                    <div className="absolute z-50 mt-2 w-56 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 max-h-60 overflow-auto">
                      {aiConfigs.map((config) => (
                        <button
                          key={config.id}
                          type="button"
                          onClick={() => {
                            setSelectedModelId(config.id);
                            setShowModelDropdown(false);
                          }}
                          className={cn(
                            "w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer",
                            selectedModelId === config.id
                              ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                              : "text-slate-700 dark:text-slate-300"
                          )}
                        >
                          <span className="truncate">{config.title}</span>
                          {selectedModelId === config.id && <Check className="w-4 h-4 flex-shrink-0 ml-2" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">笔记风格</label>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  {AI_NOTE_STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedStyle(option.value)}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer",
                        selectedStyle === option.value
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500"
                      )}
                    >
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{option.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">关键帧截图</label>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {AI_NOTE_SCREENSHOT_OPTIONS.map((option) => (
                    <div key={option.value} className="relative group">
                      <button
                        type="button"
                        onClick={() => setSelectedScreenshotDensity(option.value)}
                        className={cn(
                          "w-full rounded-lg border px-2.5 py-2 text-center transition-colors cursor-pointer",
                          selectedScreenshotDensity === option.value
                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500"
                        )}
                      >
                        <div className="text-sm font-medium">{option.label}</div>
                      </button>
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-1.5 text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 bg-slate-800 text-slate-100 dark:bg-slate-200 dark:text-slate-800 shadow-lg">
                        {option.description}
                        <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800 dark:border-t-slate-200" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">补充提示词（可选）</label>
                  {aiNotePromptConfigs.length > 0 && (
                    <div className="relative" ref={promptDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowPromptDropdown(!showPromptDropdown)}
                        className="px-3 py-1.5 pr-8 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-300 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 transition-all"
                      >
                        选择已配置的提示词
                      </button>
                      <ChevronDown className={cn("absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform", showPromptDropdown && "rotate-180")} />
                      {showPromptDropdown && (
                        <div className="absolute z-50 mt-2 w-64 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 max-h-60 overflow-auto">
                          {aiNotePromptConfigs.map((prompt) => (
                            <button
                              key={prompt.id}
                              type="button"
                              onClick={() => {
                                setCustomPrompt(prompt.content);
                                setShowPromptDropdown(false);
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-300 cursor-pointer"
                            >
                              <div className="font-medium truncate">{prompt.title}</div>
                              {prompt.description && (
                                <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{prompt.description}</div>
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
                  placeholder={`可选：补充你希望 AI 额外关注的重点，比如：
- 更关注案例拆解
- 在关键小节保留时间戳
- 额外总结行动建议`}
                  rows={8}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  不填写时将使用当前风格的默认大纲笔记提示词。
                </p>
              </div>
            </div>

            <div className="flex gap-3 px-8 pb-6 pt-2">
              <button
                onClick={() => setShowPromptDialog(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-xl transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
