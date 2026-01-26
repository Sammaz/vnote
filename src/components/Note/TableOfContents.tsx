import React, { useState, useMemo, useEffect, useRef } from "react";
import { List, ChevronRight } from "lucide-react";

// Helper to strip markdown syntax for display text
const cleanMarkdown = (text: string) => {
  return text
    .replace(/\[\d{2}:\d{2}:\d{2}\]/g, "") // Remove timestamps
    .replace(/!\[.*?\]\(.*?\)/g, "")       // Remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove links
    .replace(/`([^`]+)`/g, "$1")           // Remove code
    .replace(/[*_~]+/g, "")                // Remove formatting
    .replace(/^\s+#+\s+/, "")              // Remove leading hashes if caught
    .trim();
};

interface TOCItem {
  level: number;
  text: string;
  index: number; // Global index among all headers (0, 1, 2...)
  id?: string;   // Optional, for reference
}

interface TableOfContentsProps {
  markdown: string;
  idPrefix?: string; // Kept for interface compatibility but less critical now
}

export function TableOfContents({ markdown }: TableOfContentsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Use a ref to store the latest TOC items for the observer to access
  const tocItemsRef = useRef<TOCItem[]>([]);

  // Parse markdown to generate TOC structure
  const toc = useMemo(() => {
    if (!markdown) return [];

    const lines = markdown.split(/\r?\n/);
    const items: TOCItem[] = [];
    let inCodeBlock = false;
    let globalHeaderIndex = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();

      // Handle code blocks
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inCodeBlock = !inCodeBlock;
        return;
      }
      if (inCodeBlock) return;

      // Match headers (H1-H3)
      // Regex: Start of line, optional indent, 1-3 hashes, space, content
      // Allow trailing whitespace for robustness (especially with CRLF issues)
      const match = line.match(/^\s{0,3}(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/);

      if (match) {
        const level = match[1].length;
        const rawText = match[2];
        const displayText = cleanMarkdown(rawText);

        if (displayText) {
          items.push({
            level,
            text: displayText,
            index: globalHeaderIndex
          });
          globalHeaderIndex++;
        }
      }
    });

    tocItemsRef.current = items;
    return items;
  }, [markdown]);

  // Robust Scroll Function based on Index
  const jumpToHeader = (index: number) => {
    // Select all headers within the note content area
    // matches the component structure: .note-markdown > h1, h2, h3
    // Use a more specific selector strategy to avoid conflicts if multiple exist (though unlikely in tabs)
    const container = document.querySelector('.note-markdown');
    if (!container) return;

    const headers = container.querySelectorAll('h1, h2, h3');
    const target = headers[index];

    if (target && target instanceof HTMLElement) {
      // Find the scrollable parent container
      // Traverse up to find the element with overflow-y auto/scroll
      let scrollContainer: HTMLElement | null = container.parentElement;
      while (scrollContainer && scrollContainer !== document.body) {
        const style = window.getComputedStyle(scrollContainer);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }

      // If no valid scroll container found, check if container itself is scrollable (case for EditableMarkdown)
      if (!scrollContainer) {
         const containerStyle = window.getComputedStyle(container as HTMLElement);
         if ((containerStyle.overflowY === 'auto' || containerStyle.overflowY === 'scroll') && container.scrollHeight > container.clientHeight) {
            scrollContainer = container as HTMLElement;
         }
      }

      // Fallback to minimal scrolling logic
      if (scrollContainer) {
        // Calculate position relative to scroll container
        // offsetTop is relative to offsetParent. We need to be careful.
        // Simple approach: element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
        const elementTop = target.getBoundingClientRect().top;
        const containerTop = scrollContainer.getBoundingClientRect().top;
        const offset = elementTop - containerTop + scrollContainer.scrollTop;

        // Scroll to offset minus padding (e.g. 20px)
        const top = offset - 20;

        scrollContainer.scrollTo({
          top: Math.max(0, top),
          behavior: 'smooth'
        });
      } else {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }

      setActiveIndex(index);
    }
  };

  // Setup IntersectionObserver to track reading progress
  useEffect(() => {
    if (toc.length === 0) return;

    // Wait for DOM to stabilize
    const timer = setTimeout(() => {
      const container = document.querySelector('.note-markdown');
      if (!container) return;

      const headers = container.querySelectorAll('h1, h2, h3');
      if (headers.length === 0) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              // Find which header this element corresponds to
              // We compare DOM elements directly
              for (let i = 0; i < headers.length; i++) {
                if (headers[i] === entry.target) {
                  setActiveIndex(i);
                  break;
                }
              }
            }
          });
        },
        {
          root: null, // viewport
          rootMargin: '-10% 0px -80% 0px', // Trigger when element is near top
          threshold: 0
        }
      );

      // Only observe headers that correspond to our TOC items
      // (Safety check: if TOC has 5 items but DOM has 6, we assume 1:1 mapping for first N)
      const count = Math.min(headers.length, toc.length);
      for (let i = 0; i < count; i++) {
        observer.observe(headers[i]);
      }

      return () => {
        observer.disconnect();
      };
    }, 500); // 500ms delay to ensure React rendering is done

    return () => clearTimeout(timer);
  }, [toc]);

  if (toc.length === 0) return null;

  return (
    <>
      <button
        data-tauri-drag-region="false"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`absolute right-5 top-0 z-40 p-1.5 rounded-lg glass-button transition-all duration-300 text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 shadow-sm hover:shadow-md ${
          isOpen ? "opacity-0 pointer-events-none translate-x-4" : "opacity-100 translate-x-0"
        }`}
        title="目录"
      >
        <List size={16} />
      </button>

      <div
        data-tauri-drag-region="false"
        className={`absolute right-2 -top-4 bottom-4 w-72 glass-medium rounded-2xl border border-white/20 dark:border-white/5 shadow-2xl z-50 transition-all duration-300 flex flex-col transform ${
          isOpen ? "translate-x-0 opacity-100" : "translate-x-[120%] opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between p-4 pb-2 border-b border-slate-200/50 dark:border-slate-700/50 bg-white/30 dark:bg-black/20 rounded-t-2xl backdrop-blur-sm">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
            <List size={16} className="text-blue-500" />
            目录导航
          </h3>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded-lg text-slate-500 transition-colors"
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
                  item.level === 1 ? "pl-2 font-medium" :
                  item.level === 2 ? "pl-6 text-[0.95em]" : "pl-10 text-[0.9em]"
                } ${
                  activeIndex === item.index
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  jumpToHeader(item.index);
                }}
              >
                <span className={`mt-1.5 mr-2 w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                   activeIndex === item.index
                    ? "bg-blue-500"
                    : item.level === 1 ? "bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-400" : "bg-transparent border border-slate-300 dark:border-slate-600 group-hover:border-blue-400"
                }`} />
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
  if (React.isValidElement(children)) return getTextFromChildren(children.props.children);
  return "";
};
