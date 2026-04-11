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

interface ResponsiveTabsProps {
  items: TabItem[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  renderTab: (item: TabItem, isDropdown: boolean) => ReactNode;
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
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const glassMenu = useGlassBg("menu");

  // 监听容器宽度变化
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

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 计算可见和隐藏项目，确保 activeTab 始终可见
  const { visibleItems, hiddenItems } = (() => {
    const baseVisible = items.slice(0, visibleCount);
    const baseHidden = items.slice(visibleCount);

    // 检查 activeTab 是否在隐藏列表中
    const activeHiddenIndex = baseHidden.findIndex(item => item.id === activeTabId);

    if (activeHiddenIndex === -1 || baseVisible.length === 0) {
      // activeTab 已经可见，或者没有可见项目，直接返回
      return { visibleItems: baseVisible, hiddenItems: baseHidden };
    }

    // activeTab 在隐藏列表中，将其与可见列表的最后一个交换
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
            {renderTab(item, false)}
          </div>
        ))}

        {isOverflowing && (
          <div className="relative dropdown-trigger z-20 flex-shrink-0 ml-auto pl-1">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center justify-center w-[30px] h-[30px] rounded-lg border border-slate-200/75 bg-white/72 text-slate-500 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:text-slate-700 hover:shadow-md dark:border-slate-700/80 dark:bg-slate-800/78 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showDropdown && (
              <div
                ref={dropdownRef}
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
                    {renderTab(item, true)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 隐藏的测量容器：渲染所有项目以获取宽度 */}
      <div
        className="absolute top-0 left-0 invisible pointer-events-none flex"
        style={{ height: 0, overflow: 'hidden', width: 'max-content' }}
        aria-hidden="true"
      >
        <WidthMeasurer
          items={items}
          containerWidth={containerWidth}
          onMeasure={setVisibleCount}
        />
      </div>
    </div>
  );
}

// 辅助组件：测量计算可见数量
function WidthMeasurer({ items, containerWidth, onMeasure }: {
  items: TabItem[],
  containerWidth: number,
  onMeasure: (count: number) => void
}) {
  const itemsRef = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    // 即使 containerWidth 为 0，如果我们能确定可以 measure，可以尝试。
    // 但通常 0 意味着未挂载或隐藏，保留原状比较好。
    if (!containerWidth || items.length === 0) {
      return;
    }

    let currentWidth = 0;
    let count = 0;
    // 预留 More 按钮的宽度（按钮与间距合计约 32px）
    const moreButtonWidth = 32;

    for (let i = 0; i < items.length; i++) {
      const element = itemsRef.current[i];
      if (element) {
        // 使用 getBoundingClientRect 更加精确（包括小数）
        const width = element.getBoundingClientRect().width;

        // 最后一个元素如果不溢出，不需要 More 按钮
        // 如果当前加入这一个元素后，总宽度 > 容器宽度，则它放不下。

        // 判定逻辑：
        // 如果是最后一个元素，它可以用完剩下的空间（limit = containerWidth）
        // 如果不是最后一个元素，我们需要保留 More 按钮的空间（limit = containerWidth - moreButtonWidth）
        const isLastItem = i === items.length - 1;
        const limit = isLastItem ? containerWidth : (containerWidth - moreButtonWidth);

        if (currentWidth + width > limit) {
          // 放不下了
          break;
        }

        currentWidth += width;
        count++;
      }
    }

    onMeasure(count);
  }, [containerWidth, items]);

  return (
    <div className="flex">
      {items.map((item, index) => (
        <div
          key={item.id}
          ref={el => { itemsRef.current[index] = el; }}
          // 关键修正：确保测量容器内的元素不会被压缩，以获取真实所需的宽度
          className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex-shrink-0"
        >
          <span className="w-4 h-4 inline-block" />
          {item.label}
        </div>
      ))}
    </div>
  );
}
