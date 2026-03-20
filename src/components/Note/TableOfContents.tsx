import React, { useState, useMemo, useEffect, useRef } from "react";
import { List, ChevronRight } from "lucide-react";

const NOTE_MARKDOWN_SELECTOR = ".note-markdown";
const HEADING_SELECTOR = "h1, h2, h3";

// Helper to strip markdown syntax for display text
export const cleanMarkdown = (text: string) => {
  return text
    .replace(/\[\d{2}:\d{2}:\d{2}\]/g, "") // Remove timestamps
    .replace(/\(\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\)/g, "") // Remove time ranges
    .replace(/!\[.*?\]\(.*?\)/g, "") // Remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove links
    .replace(/`([^`]+)`/g, "$1") // Remove code
    .replace(/[*_~]+/g, "") // Remove formatting
    .replace(/^\s+#+\s+/, "") // Remove leading hashes if caught
    .trim();
};

export interface TOCItem {
  level: number;
  text: string;
  index: number; // Global index among all headers (0, 1, 2...)
  id?: string; // Optional, for reference
}

export const extractMarkdownHeadings = (markdown: string): TOCItem[] => {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const items: TOCItem[] = [];
  let inCodeBlock = false;
  let globalHeaderIndex = 0;

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;

    const match = line.match(/^\s{0,3}(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/);

    if (match) {
      const level = match[1].length;
      const rawText = match[2];
      const displayText = cleanMarkdown(rawText);

      if (displayText) {
        items.push({
          level,
          text: displayText,
          index: globalHeaderIndex,
        });
        globalHeaderIndex++;
      }
    }
  });

  return items;
};

export const getMarkdownContainer = (): HTMLElement | null => {
  return document.querySelector<HTMLElement>(NOTE_MARKDOWN_SELECTOR);
};

export const getMarkdownHeadingElements = (): HTMLElement[] => {
  const container = getMarkdownContainer();
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
};

export const getMarkdownScrollContainer = (
  container: HTMLElement | null = getMarkdownContainer()
): HTMLElement | null => {
  if (!container) return null;

  const containerStyle = window.getComputedStyle(container);
  if (containerStyle.overflowY === "auto" || containerStyle.overflowY === "scroll") {
    return container;
  }

  let scrollContainer = container.parentElement;
  while (scrollContainer && scrollContainer !== document.body) {
    const style = window.getComputedStyle(scrollContainer);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      scrollContainer.scrollHeight > scrollContainer.clientHeight
    ) {
      return scrollContainer;
    }
    scrollContainer = scrollContainer.parentElement;
  }

  return null;
};

export const scrollToMarkdownHeading = (index: number): boolean => {
  const container = getMarkdownContainer();
  if (!container) return false;

  const headers = container.querySelectorAll<HTMLElement>(HEADING_SELECTOR);
  const target = headers[index];
  if (!target) return false;

  const scrollContainer = getMarkdownScrollContainer(container);

  if (scrollContainer) {
    const elementTop = target.getBoundingClientRect().top;
    const containerTop = scrollContainer.getBoundingClientRect().top;
    const offset = elementTop - containerTop + scrollContainer.scrollTop;
    const top = offset - 20;

    scrollContainer.scrollTo({
      top: Math.max(0, top),
      behavior: "smooth",
    });
  } else {
    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return true;
};

interface TableOfContentsProps {
  markdown: string;
  idPrefix?: string; // Kept for interface compatibility but less critical now
}

export function TableOfContents({ markdown }: TableOfContentsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Flag to temporarily disable observer updates during manual navigation
  const isManualScrollingRef = useRef(false);

  // Parse markdown to generate TOC structure
  const toc = useMemo(() => {
    return extractMarkdownHeadings(markdown);
  }, [markdown]);

  // Ref to store the debounce timer for manual scrolling
  const manualScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jumpToHeader = (index: number) => {
    const didScroll = scrollToMarkdownHeading(index);
    if (!didScroll) return;

    isManualScrollingRef.current = true;

    if (manualScrollTimerRef.current) {
      clearTimeout(manualScrollTimerRef.current);
    }

    setActiveIndex(index);

    manualScrollTimerRef.current = setTimeout(() => {
      isManualScrollingRef.current = false;
    }, 800);
  };

  useEffect(() => {
    if (toc.length === 0) {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }, [toc.length]);

  // Setup IntersectionObserver to track reading progress
  useEffect(() => {
    if (toc.length === 0) return;

    let observer: IntersectionObserver | null = null;

    const timer = window.setTimeout(() => {
      const container = getMarkdownContainer();
      const headers = getMarkdownHeadingElements();
      if (!container || headers.length === 0) {
        setActiveIndex(-1);
        return;
      }

      const count = Math.min(headers.length, toc.length);
      const scrollContainer = getMarkdownScrollContainer(container);

      const syncActiveIndex = () => {
        if (isManualScrollingRef.current) return;

        const referenceTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
        let nextActiveIndex = 0;

        for (let i = 0; i < count; i++) {
          const top = headers[i].getBoundingClientRect().top - referenceTop;
          if (top <= 48) {
            nextActiveIndex = i;
          } else {
            break;
          }
        }

        setActiveIndex(nextActiveIndex);
      };

      observer = new IntersectionObserver(
        () => {
          syncActiveIndex();
        },
        {
          root: scrollContainer,
          rootMargin: "-10% 0px -80% 0px",
          threshold: [0, 1],
        }
      );

      for (let i = 0; i < count; i++) {
        observer.observe(headers[i]);
      }

      syncActiveIndex();
    }, 300);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [toc]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (manualScrollTimerRef.current) {
        clearTimeout(manualScrollTimerRef.current);
      }
    };
  }, []);

  if (toc.length === 0) return null;

  return (
    <>
      <button
        data-tauri-drag-region="false"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`absolute right-5 top-0 z-40 p-1.5 rounded-lg glass-button transition-all duration-300 text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 shadow-sm hover:shadow-md cursor-pointer ${
          isOpen ? "opacity-0 pointer-events-none translate-x-4" : "opacity-100 translate-x-0"
        }`}
        title="目录"
      >
        <List size={16} />
      </button>

      <div
        data-tauri-drag-region="false"
        className={`absolute right-2 -top-4 bottom-4 w-72 glass-medium rounded-2xl shadow-2xl z-50 transition-all duration-300 flex flex-col transform ${
          isOpen ? "translate-x-0 opacity-100" : "translate-x-[120%] opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between p-4 pb-2 border-b border-slate-200/50 dark:border-slate-700/50 bg-white/60 dark:bg-slate-800/60 rounded-t-2xl backdrop-blur-sm">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
            <List size={16} className="text-blue-500" />
            目录导航
          </h3>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 rounded-lg text-slate-500 transition-colors cursor-pointer"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          <div className="flex flex-col gap-0.5">
            {toc.map((item) => (
              <button
                key={`toc-${item.index}`}
                data-tauri-drag-region="false"
                className={`cursor-pointer group flex items-start text-left w-full py-2 pr-3 text-sm transition-all duration-200 rounded-lg ${
                  item.level === 1 ? "pl-2 font-medium" : item.level === 2 ? "pl-6 text-[0.95em]" : "pl-10 text-[0.9em]"
                } ${
                  activeIndex === item.index
                    ? "bg-blue-50/80 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  jumpToHeader(item.index);
                }}
              >
                <span
                  className={`mt-1.5 mr-2 w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                    activeIndex === item.index
                      ? "bg-blue-500"
                      : item.level === 1
                        ? "bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-400"
                        : "bg-transparent border border-slate-300 dark:border-slate-600 group-hover:border-blue-400"
                  }`}
                />
                <span className="leading-5 truncate w-full">{item.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// Retain helpers export to match imports in other files, even if unused internally now
export const generateId = (text: string, prefix: string = "heading") => {
  const clean = text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5\-]+/g, "");
  return `${prefix}-${clean || "untitled"}`;
};

export const getTextFromChildren = (children: React.ReactNode): string => {
  if (typeof children === "string") return children;
  if (typeof children === "number") return children.toString();
  if (Array.isArray(children)) return children.map(getTextFromChildren).join("");
  if (React.isValidElement(children)) return getTextFromChildren((children.props as { children?: React.ReactNode }).children);
  return "";
};
