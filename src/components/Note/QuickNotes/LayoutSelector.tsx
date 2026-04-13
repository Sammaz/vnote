/**
 * 思维导图布局选择器组件
 */

import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../../../utils/cn";
import { useGlassBg } from "../../../hooks/useGlassBg";

export type MindMapLayout =
  | "logicalStructure"
  | "mindMap"
  | "organizationStructure"
  | "catalogOrganization"
  | "timeline"
  | "fishbone";

interface LayoutOption {
  value: MindMapLayout;
  label: string;
  description: string;
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: "logicalStructure", label: "逻辑结构图", description: "经典的思维导图布局" },
  { value: "mindMap", label: "思维导图", description: "自由发散的思维导图" },
  { value: "organizationStructure", label: "组织架构图", description: "树形组织结构" },
  { value: "catalogOrganization", label: "目录组织图", description: "目录式布局" },
  { value: "timeline", label: "时间轴", description: "时间线布局" },
  { value: "fishbone", label: "鱼骨图", description: "因果分析图" },
];

interface LayoutSelectorProps {
  value: MindMapLayout;
  onChange: (layout: MindMapLayout) => void;
  compact?: boolean;
  compactLabel?: string;
}

export function LayoutSelector({ value, onChange, compact = false, compactLabel }: LayoutSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const glassMenu = useGlassBg("menu");

  const currentLayout = LAYOUT_OPTIONS.find(opt => opt.value === value);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !dropdownRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    dropdownRef.current.style.top = `${rect.bottom + 8}px`;
    dropdownRef.current.style.left = `${rect.left}px`;
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    const handleScroll = () => {
      if (isOpen) {
        setIsOpen(false);
      }
    };
    // 监听所有祖先滚动容器，滚动时关闭下拉框
    const ancestors: Element[] = [];
    let el: HTMLElement | null = triggerRef.current;
    while (el) {
      const parent = el.parentElement;
      if (parent) {
        parent.addEventListener("scroll", handleScroll, { passive: true });
        ancestors.push(parent);
        el = parent;
      } else {
        break;
      }
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      ancestors.forEach(a => a.removeEventListener("scroll", handleScroll));
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap",
          compact ? "h-9 gap-1.5 px-2.5" : "gap-2 px-3 py-2"
        )}
        title={currentLayout?.label || "选择布局"}
        aria-label={currentLayout?.label || "选择布局"}
      >
        <span className={cn("min-w-0 truncate", compact && "max-w-[8.5rem]")}>
          {compact ? (compactLabel || currentLayout?.label || "布局") : (currentLayout?.label || "选择布局")}
        </span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className={cn("fixed w-64 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-[9999] py-1", glassMenu)}
          style={{ top: 0, left: 0 }}
        >
          {LAYOUT_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={cn(
                "w-full px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer",
                value === option.value && "bg-blue-50 dark:bg-blue-900/20"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className={cn(
                    "text-sm font-medium",
                    value === option.value ? "text-blue-600 dark:text-blue-400" : "text-slate-700 dark:text-slate-200"
                  )}>
                    {option.label}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {option.description}
                  </div>
                </div>
                {value === option.value && (
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                )}
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}