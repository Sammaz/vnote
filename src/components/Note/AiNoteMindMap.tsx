import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { BarChart3, ZoomIn, ZoomOut, Maximize2, Fullscreen, Minimize } from "lucide-react";
import { Transformer, type IMarkmapJSONOptions } from "markmap-lib";
import { Markmap, loadCSS, loadJS } from "markmap-view";
import type { INode, IPureNode } from "markmap-common";
import { deriveOptions } from "markmap-view";

interface AiNoteMindMapProps {
  markdown: string;
  noteTitle: string;
  onSvgReady?: (svg: SVGSVGElement | null) => void;
}

interface OutlineItem {
  level: number;
  text: string;
  uid: string;
  seekTime: number | null;
  isSyncTarget: boolean;
}

const transformer = new Transformer();
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const TIMESTAMP_PATTERNS = [
  /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/,
  /⏱\s*(\d{1,2}:\d{2}(?::\d{2})?)/,
  /（时间：(\d{1,2}:\d{2}(?::\d{2})?)）/,
  /\((\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\)/,
];

function parseTimestamp(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) {
    return null;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function findFirstTimestamp(text: string): number | null {
  for (const pattern of TIMESTAMP_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return parseTimestamp(match[1]);
    }
  }
  return null;
}

function cleanMarkdownText(text: string): string {
  return text
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, "")
    .replace(/⏱\s*\d{1,2}:\d{2}(?::\d{2})?/g, "")
    .replace(/（时间：\d{1,2}:\d{2}(?::\d{2})?）/g, "")
    .replace(/\(\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\)/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim();
}

function isSummaryHeading(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return normalized === "总结" || normalized === "总结：" || normalized === "总结:";
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
    const seekTime = findFirstTimestamp(heading.rawText);
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
      if (isHeadingNode && headingIndex < items.length) {
        headingIndex += 1;
      }
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

export function AiNoteMindMap({ markdown, noteTitle, onSvgReady }: AiNoteMindMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  const activeUidRef = useRef<string | null>(null);
  const userSeekRef = useRef<{ targetTime: number; timestamp: number } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains("dark"));
  const [isFullscreen, setIsFullscreen] = useState(false);

  const items = useMemo(() => collectOutlineItems(markdown), [markdown]);
  const syncItems = useMemo(() => items.filter((item) => item.isSyncTarget), [items]);
  const syncUidSet = useMemo(() => new Set(syncItems.map((item) => item.uid)), [syncItems]);
  const transformed = useMemo(() => {
    const { root, features } = transformer.transform(markdown);
    return {
      root: enhanceNodeKeys(root, items, `${noteTitle} · 大纲笔记`),
      assets: transformer.getUsedAssets(features),
    };
  }, [markdown, items, noteTitle]);

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
    if (transformed.assets.styles) {
      loadCSS(transformed.assets.styles);
    }
    if (transformed.assets.scripts) {
      loadJS(transformed.assets.scripts, {
        getMarkmap: () => ({ Markmap, loadCSS, loadJS }),
      });
    }
  }, [transformed.assets]);

  useEffect(() => {
    if (!containerRef.current || items.length === 0) {
      onSvgReady?.(null);
      return;
    }

    const existingSvg = svgRef.current ?? document.createElementNS("http://www.w3.org/2000/svg", "svg");
    existingSvg.classList.add("markmap", "h-full", "w-full");
    existingSvg.setAttribute("width", "100%");
    existingSvg.setAttribute("height", "100%");
    existingSvg.style.background = "transparent";

    if (!svgRef.current) {
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(existingSvg);
      svgRef.current = existingSvg;
    }

    const options = deriveOptions(getMarkmapOptions(isDarkMode) as IMarkmapJSONOptions);

    const render = async () => {
      if (!mmRef.current) {
        mmRef.current = Markmap.create(existingSvg, options, transformed.root);
      } else {
        mmRef.current.setOptions(options);
        await mmRef.current.setData(transformed.root);
      }
      await mmRef.current.fit();
    };

    render();

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
    };

    queueMicrotask(updateNodeInteractivity);

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
  }, [transformed.root, items.length, isDarkMode, focusNodeByUid, onSvgReady, syncUidSet]);

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
      className={isFullscreen ? "fixed inset-0 z-50" : "relative w-full h-full"}
      style={{
        backgroundImage: isDarkMode
          ? "radial-gradient(circle, #333333 1px, transparent 1px)"
          : "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        backgroundColor: isDarkMode ? "#0d0d0d" : "#f8fafc",
      }}
    >
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-xl bg-white/85 p-1 shadow-sm backdrop-blur-sm dark:bg-slate-900/85">
        <button
          onClick={handleZoomOut}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title="缩小"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={handleZoomIn}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title="放大"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={handleReset}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title="重置视图"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => setIsFullscreen((value) => !value)}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title={isFullscreen ? "退出全屏" : "全屏"}
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Fullscreen className="h-4 w-4" />}
        </button>
      </div>

      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
