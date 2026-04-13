import { useState, useRef, useEffect, useLayoutEffect } from "react";
import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";

export interface TabItem {
  id: string;
  label: string;
  icon: ReactNode;
}

type TabDisplayMode = "full" | "icon";

interface ResponsiveTabsProps {
  items: TabItem[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  renderTab: (item: TabItem, isDropdown: boolean, displayMode: TabDisplayMode) => ReactNode;
  className?: string;
}

export function ResponsiveTabs({
  items,
  activeTabId,
  onTabClick,
  renderTab,
  className
}: ResponsiveTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [displayMode, setDisplayMode] = useState<TabDisplayMode>("full");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const glassMenu = useGlassBg("menu");

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { visibleItems, hiddenItems } = (() => {
    const baseVisible = items.slice(0, visibleCount);
    const baseHidden = items.slice(visibleCount);

    const activeHiddenIndex = baseHidden.findIndex(item => item.id === activeTabId);

    if (activeHiddenIndex === -1 || baseVisible.length === 0) {
      return { visibleItems: baseVisible, hiddenItems: baseHidden };
    }

    const activeItem = baseHidden[activeHiddenIndex];
    const lastVisibleItem = baseVisible[baseVisible.length - 1];

    const newVisible = [...baseVisible.slice(0, -1), activeItem];
    const newHidden = [
      lastVisibleItem,
      ...baseHidden.slice(0, activeHiddenIndex),
      ...baseHidden.slice(activeHiddenIndex + 1)
    ];

    return { visibleItems: newVisible, hiddenItems: newHidden };
  })();

  const isOverflowing = hiddenItems.length > 0;

  return (
    <div className={cn("relative z-40 flex-1 min-w-0 overflow-visible", className)} ref={containerRef}>
      <div className="flex items-center gap-1.5 w-full min-w-0">
        {visibleItems.map(item => (
          <div key={item.id} className="flex-shrink-0 cursor-pointer" onClick={() => onTabClick(item.id)}>
            {renderTab(item, false, displayMode)}
          </div>
        ))}

        {isOverflowing && (
          <div className="relative dropdown-trigger z-20 flex-shrink-0 ml-auto pl-1" ref={dropdownRef}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center justify-center w-[30px] h-[30px] rounded-lg border border-slate-200/75 bg-white/72 text-slate-500 shadow-sm transition-all hover:bg-white hover:text-slate-700 hover:shadow-md dark:border-slate-700/80 dark:bg-slate-800/78 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showDropdown && (
              <div
                className={`absolute top-full right-0 mt-2 w-52 ${glassMenu} rounded-2xl border border-slate-200/90 bg-white/96 shadow-[0_24px_70px_rgba(15,23,42,0.24)] ring-1 ring-slate-200/70 backdrop-blur-xl dark:border-slate-700/90 dark:bg-slate-900/96 dark:ring-white/8 z-[80] py-1.5 overflow-hidden`}
              >
                {hiddenItems.map(item => (
                  <div
                    key={item.id}
                    onClick={() => {
                      onTabClick(item.id);
                      setShowDropdown(false);
                    }}
                  >
                    {renderTab(item, true, "full")}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="absolute top-0 left-0 invisible pointer-events-none"
        style={{ height: 0, overflow: "hidden", width: "max-content" }}
        aria-hidden="true"
      >
        <WidthMeasurer
          items={items}
          containerWidth={containerWidth}
          onMeasure={setVisibleCount}
          onDisplayModeChange={setDisplayMode}
        />
      </div>
    </div>
  );
}

function WidthMeasurer({ items, containerWidth, onMeasure, onDisplayModeChange }: {
  items: TabItem[],
  containerWidth: number,
  onMeasure: (count: number) => void,
  onDisplayModeChange: (mode: TabDisplayMode) => void,
}) {
  const fullItemsRef = useRef<(HTMLDivElement | null)[]>([]);
  const iconItemsRef = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    if (!containerWidth || items.length === 0) {
      return;
    }

    const moreButtonWidth = 32;

    const measureVisibleCount = (refs: React.MutableRefObject<(HTMLDivElement | null)[]>) => {
      let currentWidth = 0;
      let count = 0;

      for (let i = 0; i < items.length; i++) {
        const element = refs.current[i];
        if (!element) {
          continue;
        }

        const width = element.getBoundingClientRect().width;
        const isLastItem = i === items.length - 1;
        const limit = isLastItem ? containerWidth : (containerWidth - moreButtonWidth);

        if (currentWidth + width > limit) {
          break;
        }

        currentWidth += width;
        count++;
      }

      return count;
    };

    const fullVisibleCount = measureVisibleCount(fullItemsRef);
    if (fullVisibleCount === items.length) {
      onDisplayModeChange("full");
      onMeasure(fullVisibleCount);
      return;
    }

    const iconVisibleCount = measureVisibleCount(iconItemsRef);
    onDisplayModeChange("icon");
    onMeasure(iconVisibleCount);
  }, [containerWidth, items, onDisplayModeChange, onMeasure]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex">
        {items.map((item, index) => (
          <div
            key={`${item.id}-full`}
            ref={el => { fullItemsRef.current[index] = el; }}
            className="flex items-center gap-1.5 px-2.5 h-[30px] text-sm font-medium border whitespace-nowrap flex-shrink-0 rounded-xl"
          >
            {item.icon}
            {item.label}
          </div>
        ))}
      </div>
      <div className="flex">
        {items.map((item, index) => (
          <div
            key={`${item.id}-icon`}
            ref={el => { iconItemsRef.current[index] = el; }}
            className="flex items-center justify-center w-[30px] h-[30px] border whitespace-nowrap flex-shrink-0 rounded-xl"
          >
            {item.icon}
          </div>
        ))}
      </div>
    </div>
  );
}
