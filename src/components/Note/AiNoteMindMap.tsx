import { useMemo, useEffect, useRef, useState, useCallback, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { BarChart3, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Transformer, type IMarkmapJSONOptions } from "markmap-lib";
import { Markmap, loadCSS, loadJS } from "markmap-view";
import type { INode, IPureNode } from "markmap-common";
import { deriveOptions } from "markmap-view";
import { cleanMarkdownText, extractFirstTimestamp } from "../../utils/markdownRendererUtils";

interface AiNoteMindMapProps {
  markdown: string;
  noteTitle: string;
  depthControlContainer?: HTMLElement | null;
  onSvgReady?: (svg: SVGSVGElement | null) => void;
}

interface OutlineItem {
  level: number;
  text: string;
  uid: string;
  seekTime: number | null;
  isSyncTarget: boolean;
}

interface NormalizedMindmapMarkdownResult {
  normalizedMarkdown: string;
  hasHeadings: boolean;
  hasLevel1Heading: boolean;
  rootTitle: string;
}

const transformer = new Transformer();
const MINDMAP_DEPTH_STORAGE_KEY = "ai-note-mindmap-depth";
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;

function isSummaryHeading(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return normalized === "总结" || normalized === "总结：" || normalized === "总结:";
}

function getRootTitle(noteTitle: string): string {
  const singleLineTitle = noteTitle.replace(/\r?\n+/g, " ").trim();
  return cleanMarkdownText(singleLineTitle) || "大纲笔记";
}

function normalizeMindmapMarkdown(markdown: string, noteTitle: string): NormalizedMindmapMarkdownResult {
  const rootTitle = getRootTitle(noteTitle);
  const lines = markdown.split(/\r?\n/);
  let hasHeadings = false;
  let hasLevel1Heading = false;
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }

    const match = line.match(HEADING_RE);
    if (!match) {
      continue;
    }

    hasHeadings = true;
    if (match[1].length === 1) {
      hasLevel1Heading = true;
      break;
    }
  }

  if (!hasHeadings || hasLevel1Heading) {
    return {
      normalizedMarkdown: markdown,
      hasHeadings,
      hasLevel1Heading,
      rootTitle,
    };
  }

  return {
    normalizedMarkdown: `# ${rootTitle}\n\n${markdown}`,
    hasHeadings: true,
    hasLevel1Heading: false,
    rootTitle,
  };
}

function getMaxDepth(node: IPureNode, current = 1): number {
  if (!node.children?.length) {
    return current;
  }
  return Math.max(...node.children.map((child) => getMaxDepth(child, current + 1)));
}

function applyFoldDepth(node: IPureNode, foldDepth: number, current = 1): IPureNode {
  return {
    ...node,
    payload: {
      ...(node.payload ?? {}),
      fold: current >= foldDepth ? 1 : 0,
    },
    children: node.children.map((child) => applyFoldDepth(child, foldDepth, current + 1)),
  };
}

function readStoredMindmapDepth(): number {
  if (typeof window === "undefined") {
    return 2;
  }

  const saved = Number.parseInt(window.localStorage.getItem(MINDMAP_DEPTH_STORAGE_KEY) ?? "", 10);
  return Number.isFinite(saved) ? saved : 2;
}

function clampMindmapDepth(depth: number, treeMaxDepth: number): number {
  const safeMaxDepth = Math.max(1, treeMaxDepth);
  const minDepth = safeMaxDepth > 1 ? 2 : 1;
  return Math.min(safeMaxDepth, Math.max(minDepth, depth));
}

function collectOutlineItems(markdown: string): OutlineItem[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Array<{ level: number; rawText: string }> = [];
  let inCodeBlock = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) {
      return;
    }
    const match = line.match(HEADING_RE);
    if (!match) {
      return;
    }
    headings.push({
      level: match[1].length,
      rawText: match[2],
    });
  });

  return headings.map((heading, index) => {
    const seekTime = extractFirstTimestamp(heading.rawText);
    const text = cleanMarkdownText(heading.rawText) || `节点 ${index + 1}`;
    return {
      level: heading.level,
      text,
      uid: `ai-note-node-${index}`,
      seekTime,
      isSyncTarget: heading.level === 2 && seekTime !== null && !isSummaryHeading(text),
    };
  });
}

function findActiveOutlineItem(items: OutlineItem[], currentTime: number): OutlineItem | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof item.seekTime !== "number") {
      continue;
    }

    const nextTime = items[index + 1]?.seekTime;
    if (currentTime >= item.seekTime && (typeof nextTime !== "number" || currentTime < nextTime)) {
      return item;
    }
  }

  return null;
}

function isHeadingTag(tag: unknown): tag is `h${1 | 2 | 3 | 4 | 5 | 6}` {
  return typeof tag === "string" && /^h[1-6]$/.test(tag);
}

function enhanceNodeKeys(root: IPureNode, items: OutlineItem[], noteTitle: string): IPureNode {
  let headingIndex = 0;
  let nodeIndex = 0;

  const visit = (node: IPureNode, isRoot = false): IPureNode => {
    const nextNode: IPureNode = {
      ...node,
      payload: { ...(node.payload ?? {}) },
      children: [],
    };

    const tag = node.payload?.tag;
    const isHeadingNode = isHeadingTag(tag);

    if (isRoot) {
      // Root node: consume items[0] which is the root title item
      if (headingIndex < items.length) {
        headingIndex += 1;
      }
      // Override root content with note title for consistent display
      nextNode.content = noteTitle || "大纲笔记";
      nextNode.payload = {
        ...nextNode.payload,
        uid: "ai-note-root",
        heading: noteTitle || "大纲笔记",
        seekTime: null,
      };
    } else if (isHeadingNode) {
      const item = items[headingIndex++];
      nextNode.payload = {
        ...nextNode.payload,
        uid: item?.uid ?? `ai-note-node-${headingIndex}`,
        heading: item?.text ?? cleanMarkdownText(node.content),
        seekTime: item?.seekTime ?? null,
      };
    } else {
      nextNode.payload = {
        ...nextNode.payload,
        uid: `ai-note-tree-node-${nodeIndex++}`,
        heading: cleanMarkdownText(node.content),
        seekTime: null,
      };
    }

    nextNode.children = node.children.map((child) => visit(child));
    return nextNode;
  };

  return visit(root, true);
}

function getMarkmapOptions(isDarkMode: boolean): Partial<IMarkmapJSONOptions> {
  return {
    autoFit: true,
    duration: 300,
    fitRatio: 0.95,
    initialExpandLevel: -1,
    maxInitialScale: 2,
    maxWidth: 280,
    paddingX: 12,
    spacingHorizontal: 100,
    spacingVertical: 10,
    zoom: true,
    pan: true,
    colorFreezeLevel: 2,
    color: isDarkMode
      ? ["#60a5fa", "#818cf8", "#a78bfa", "#22d3ee", "#34d399"]
      : ["#2563eb", "#4f46e5", "#7c3aed", "#0891b2", "#059669"],
  } as Partial<IMarkmapJSONOptions>;
}

function getScale(mm: Markmap | null): number {
  const value = mm?.svg.attr("data-scale");
  const scale = value ? Number(value) : NaN;
  return Number.isFinite(scale) ? scale : 1;
}

function findMarkmapNode(root: INode | null | undefined, predicate: (node: INode) => boolean): INode | null {
  if (!root) {
    return null;
  }

  const stack: INode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (predicate(node)) {
      return node;
    }
    stack.push(...node.children);
  }

  return null;
}

export function AiNoteMindMap({ markdown, noteTitle, depthControlContainer, onSvgReady }: AiNoteMindMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  const activeUidRef = useRef<string | null>(null);
  const userSeekRef = useRef<{ targetTime: number; timestamp: number } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains("dark"));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [maxDepth, setMaxDepth] = useState(() => readStoredMindmapDepth());

  const normalized = useMemo(() => normalizeMindmapMarkdown(markdown, noteTitle), [markdown, noteTitle]);
  const items = useMemo(() => {
    if (!normalized.hasHeadings) {
      return [];
    }
    // Collect items from original markdown, but skip H1 headings since H1 becomes the root node
    const collectedItems = collectOutlineItems(markdown);
    const nonH1Items = collectedItems.filter((item) => item.level > 1);
    // Prepend root title item for the mind map root node
    const rootTitleItem: OutlineItem = {
      level: 1,
      text: normalized.rootTitle,
      uid: "ai-note-root",
      seekTime: null,
      isSyncTarget: false,
    };
    return [rootTitleItem, ...nonH1Items];
  }, [normalized.hasHeadings, normalized.rootTitle, markdown]);
  const syncItems = useMemo(() => items.filter((item) => item.isSyncTarget), [items]);
  const syncUidSet = useMemo(() => new Set(syncItems.map((item) => item.uid)), [syncItems]);
  const transformed = useMemo(() => {
    if (!normalized.hasHeadings) {
      return null;
    }

    // Strip image markdown before transformation to keep mind map nodes clean (ref: Diting1)
    const cleanedMarkdown = normalized.normalizedMarkdown
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/<img[^>]*\/?>/gi, "")
      .replace(/\n{3,}/g, "\n\n");
    const { root, features } = transformer.transform(cleanedMarkdown);
    const baseRoot = enhanceNodeKeys(root, items, normalized.rootTitle);
    return {
      baseRoot,
      treeMaxDepth: getMaxDepth(baseRoot),
      assets: transformer.getUsedAssets(features),
    };
  }, [normalized.hasHeadings, normalized.normalizedMarkdown, normalized.rootTitle, items]);
  const treeMaxDepth = transformed?.treeMaxDepth ?? 0;
  const resolvedMaxDepth = useMemo(
    () => clampMindmapDepth(maxDepth, treeMaxDepth || 1),
    [maxDepth, treeMaxDepth],
  );
  const foldedRoot = useMemo(() => {
    if (!transformed?.baseRoot) {
      return null;
    }
    return applyFoldDepth(transformed.baseRoot, resolvedMaxDepth);
  }, [resolvedMaxDepth, transformed?.baseRoot]);

  const focusNodeByUid = useCallback(async (uid: string | null) => {
    const mm = mmRef.current;
    if (!mm || !uid || !mm.state.data) {
      return;
    }

    const node = findMarkmapNode(mm.state.data, (current) => current.payload?.uid === uid);
    if (!node) {
      return;
    }

    await mm.setHighlight(node);
    await mm.ensureVisible(node, { top: 80, bottom: 80, left: 80, right: 80 });
    activeUidRef.current = uid;
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!transformed) {
      return;
    }

    if (transformed.assets.styles) {
      loadCSS(transformed.assets.styles);
    }
    if (transformed.assets.scripts) {
      loadJS(transformed.assets.scripts, {
        getMarkmap: () => ({ Markmap, loadCSS, loadJS }),
      });
    }
  }, [transformed]);

  useEffect(() => {
    if (!transformed) {
      return;
    }

    const nextDepth = clampMindmapDepth(readStoredMindmapDepth(), transformed.treeMaxDepth);
    setMaxDepth((current) => (current === nextDepth ? current : nextDepth));
    window.localStorage.setItem(MINDMAP_DEPTH_STORAGE_KEY, String(nextDepth));
  }, [transformed]);

  useEffect(() => {
    if (!containerRef.current || !foldedRoot || items.length === 0) {
      onSvgReady?.(null);
      return;
    }

    const existingSvg = svgRef.current ?? document.createElementNS("http://www.w3.org/2000/svg", "svg");
    existingSvg.classList.add("markmap", "h-full", "w-full");
    existingSvg.setAttribute("width", "100%");
    existingSvg.setAttribute("height", "100%");
    existingSvg.style.background = "transparent";
    existingSvg.style.color = isDarkMode ? "#ffffff" : "#0f172a";

    if (!svgRef.current) {
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(existingSvg);
      svgRef.current = existingSvg;
    }

    const options = deriveOptions(getMarkmapOptions(isDarkMode) as IMarkmapJSONOptions);

    const updateNodeInteractivity = () => {
      const groups = existingSvg.querySelectorAll<SVGGElement>("g.markmap-node");
      groups.forEach((group) => {
        const path = group.getAttribute("data-path");
        if (!path) {
          group.style.cursor = "default";
          return;
        }

        const node = findMarkmapNode(mmRef.current?.state.data, (current) => current.state?.path === path);
        const uid = typeof node?.payload?.uid === "string" ? node.payload.uid : null;
        const seekTime = typeof node?.payload?.seekTime === "number" ? node.payload.seekTime : null;
        group.style.cursor = uid && seekTime !== null && syncUidSet.has(uid) ? "pointer" : "default";
      });

      const texts = existingSvg.querySelectorAll<SVGTextElement>("text");
      texts.forEach((text) => {
        text.style.fill = isDarkMode ? "#ffffff" : "#0f172a";
      });
    };

    const render = async () => {
      if (!mmRef.current) {
        mmRef.current = Markmap.create(existingSvg, options, foldedRoot);
      } else {
        mmRef.current.setOptions(options);
        await mmRef.current.setData(foldedRoot);
      }
      await mmRef.current.fit();
      updateNodeInteractivity();
    };

    void render();

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const group = target?.closest("g.markmap-node") as SVGGElement | null;
      const path = group?.getAttribute("data-path");
      if (!path) {
        return;
      }

      const node = findMarkmapNode(mmRef.current?.state.data, (current) => current.state?.path === path);
      const uid = typeof node?.payload?.uid === "string" ? node.payload.uid : null;
      const seekTime = typeof node?.payload?.seekTime === "number" ? node.payload.seekTime : null;
      if (!uid || seekTime === null || !syncUidSet.has(uid)) {
        return;
      }

      userSeekRef.current = {
        targetTime: seekTime,
        timestamp: Date.now(),
      };
      void focusNodeByUid(uid);
      window.dispatchEvent(new CustomEvent("seek-video", { detail: { time: seekTime } }));
    };

    existingSvg.addEventListener("click", handleClick);

    const resizeObserver = new ResizeObserver(() => {
      void mmRef.current?.fit();
    });
    resizeObserver.observe(containerRef.current);

    onSvgReady?.(existingSvg);

    return () => {
      existingSvg.removeEventListener("click", handleClick);
      resizeObserver.disconnect();
      onSvgReady?.(null);
    };
  }, [foldedRoot, items.length, isDarkMode, focusNodeByUid, onSvgReady, syncUidSet]);

  useEffect(() => {
    if (syncItems.length === 0) {
      return;
    }

    const handleSeekVideo = (event: Event) => {
      const targetTime = (event as CustomEvent<{ time: number }>).detail?.time;
      if (typeof targetTime !== "number") {
        return;
      }

      userSeekRef.current = {
        targetTime,
        timestamp: Date.now(),
      };

      const activeItem = findActiveOutlineItem(syncItems, targetTime);
      if (!activeItem || activeItem.uid === activeUidRef.current) {
        return;
      }

      void focusNodeByUid(activeItem.uid);
    };

    const handleVideoTimeUpdate = (event: Event) => {
      const currentTime = (event as CustomEvent<{ time: number }>).detail?.time;
      if (typeof currentTime !== "number") {
        return;
      }

      const userSeek = userSeekRef.current;
      if (userSeek) {
        const timeSinceSeek = Date.now() - userSeek.timestamp;
        if (timeSinceSeek < 800) {
          return;
        }
        userSeekRef.current = null;
      }

      const activeItem = findActiveOutlineItem(syncItems, currentTime);
      if (!activeItem) {
        if (activeUidRef.current) {
          activeUidRef.current = null;
          void mmRef.current?.setHighlight(null);
        }
        return;
      }

      if (activeItem.uid === activeUidRef.current) {
        return;
      }

      void focusNodeByUid(activeItem.uid);
    };

    window.addEventListener("seek-video", handleSeekVideo);
    window.addEventListener("video-time-update", handleVideoTimeUpdate);
    return () => {
      window.removeEventListener("seek-video", handleSeekVideo);
      window.removeEventListener("video-time-update", handleVideoTimeUpdate);
    };
  }, [syncItems, focusNodeByUid]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const handleZoomIn = useCallback(() => {
    const mm = mmRef.current;
    if (!mm) return;
    void mm.rescale(getScale(mm) * 1.2);
  }, []);

  const handleZoomOut = useCallback(() => {
    const mm = mmRef.current;
    if (!mm) return;
    void mm.rescale(getScale(mm) / 1.2);
  }, []);

  const handleReset = useCallback(() => {
    void mmRef.current?.fit();
  }, []);

  const handleDepthChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextDepth = clampMindmapDepth(Number(event.target.value), treeMaxDepth || 1);
    setMaxDepth(nextDepth);
    window.localStorage.setItem(MINDMAP_DEPTH_STORAGE_KEY, String(nextDepth));
  }, [treeMaxDepth]);

  const shouldShowDepthControl = treeMaxDepth > 2;
  const depthControl = shouldShowDepthControl ? (
    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
      <span className="inline-flex h-6 min-w-7 items-center justify-center rounded-md bg-blue-50 text-xs font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
        H{resolvedMaxDepth}
      </span>
      <input
        type="range"
        min={2}
        max={Math.max(2, treeMaxDepth)}
        value={resolvedMaxDepth}
        onChange={handleDepthChange}
        className="h-1.5 w-20 cursor-pointer accent-blue-500"
        title={`展开到 H${resolvedMaxDepth}`}
      />
    </div>
  ) : null;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-slate-400">
        <BarChart3 className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg mb-2">暂无学习脑图内容</p>
        <p className="text-sm text-center max-w-md">大纲笔记还没有可解析的标题结构，暂时无法生成只读脑图。</p>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${isFullscreen ? "fixed inset-0 z-50" : "w-full h-full"}`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(148, 163, 184, 0.24) 1.2px, transparent 1.2px)",
          backgroundSize: "20px 20px",
          backgroundColor: "transparent",
          opacity: isDarkMode ? 0.7 : 1,
        }}
      />
      {depthControl && depthControlContainer ? createPortal(depthControl, depthControlContainer) : null}
      <div className="absolute bottom-4 left-4 z-10 flex flex-col items-center gap-2 rounded-xl bg-white/85 p-1.5 shadow-sm backdrop-blur-sm dark:bg-slate-900/85">
        <button
          onClick={handleZoomOut}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          title="缩小"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={handleZoomIn}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          title="放大"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={handleReset}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          title="重置视图"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
