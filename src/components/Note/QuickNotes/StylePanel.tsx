/**
 * 思维导图节点样式面板
 * 以浮层形式定位在触发按钮下方
 */

import { createPortal } from "react-dom";
import { useState, useRef, useEffect, useCallback } from "react";
import { Palette, X, Type } from "lucide-react";
import { cn } from "../../../utils/cn";
import { useGlassBg } from "../../../hooks/useGlassBg";

interface StylePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onStyleChange: (style: NodeStyle) => void;
  initialStyle?: NodeStyle;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export interface NodeStyle {
  fillColor?: string;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  fontSize?: number;
  fontWeight?: string;
  shape?: string;
}

const PRESET_COLORS = [
  { name: "白色", value: "#ffffff" },
  { name: "蓝色", value: "#3b82f6" },
  { name: "紫色", value: "#8b5cf6" },
  { name: "粉色", value: "#ec4899" },
  { name: "红色", value: "#ef4444" },
  { name: "橙色", value: "#f97316" },
  { name: "黄色", value: "#eab308" },
  { name: "绿色", value: "#22c55e" },
  { name: "青色", value: "#06b6d4" },
  { name: "灰色", value: "#6b7280" },
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24];
const BORDER_WIDTHS = [0, 1, 2, 3, 4];

export function StylePanel({ isOpen, onClose, onStyleChange, initialStyle, triggerRef }: StylePanelProps) {
  const [fillColor, setFillColor] = useState(initialStyle?.fillColor ?? "#3b82f6");
  const [textColor, setTextColor] = useState(initialStyle?.color ?? "#ffffff");
  const [borderColor, setBorderColor] = useState(initialStyle?.borderColor ?? "#3b82f6");
  const [borderWidth, setBorderWidth] = useState(initialStyle?.borderWidth ?? 2);
  const [fontSize, setFontSize] = useState(initialStyle?.fontSize ?? 14);
  const panelRef = useRef<HTMLDivElement>(null);
  const glassCard = useGlassBg("card");
  const glassPanel = useGlassBg("panel");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setFillColor(initialStyle?.fillColor ?? "#3b82f6");
    setTextColor(initialStyle?.color ?? "#ffffff");
    setBorderColor(initialStyle?.borderColor ?? "#3b82f6");
    setBorderWidth(initialStyle?.borderWidth ?? 2);
    setFontSize(initialStyle?.fontSize ?? 14);
  }, [initialStyle, isOpen]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const clickedPanel = panelRef.current?.contains(e.target as Node);
      const clickedTrigger = triggerRef?.current?.contains(e.target as Node);
      if (!clickedPanel && !clickedTrigger) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, triggerRef]);

  // 按 ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // 计算面板定位
  const getPosition = useCallback(() => {
    if (!triggerRef?.current) return { top: 0, left: 0 };
    const rect = triggerRef.current.getBoundingClientRect();
    const panelWidth = 370;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + 8;
    let left = rect.right - panelWidth;

    // 保证不超出左侧
    if (left < 8) left = 8;
    // 保证不超出右侧
    if (left + panelWidth > viewportWidth - 8) left = viewportWidth - panelWidth - 8;
    // 如果下方空间不足，放到按钮上方
    if (top + 500 > viewportHeight) {
      top = rect.top - 508 - 8;
    }

    return { top, left };
  }, [triggerRef]);

  const handleApply = () => {
    onStyleChange({
      fillColor,
      color: textColor,
      borderColor,
      borderWidth,
      fontSize,
    });
    onClose();
  };

  if (!isOpen) return null;

  const isLight = (v: string) => v === "#ffffff" || v === "#eab308";
  const position = getPosition();

  const renderColorGrid = (
    selected: string,
    onSelect: (v: string) => void,
    mode: "fill" | "text" | "border"
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_COLORS.map((color) => {
        const isSelected = selected === color.value;
        return (
          <button
            key={`${mode}-${color.value}`}
            onClick={() => onSelect(color.value)}
            className={cn(
              "w-7 h-7 rounded-md transition-all cursor-pointer relative flex-shrink-0 flex items-center justify-center",
              isSelected
                ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900 scale-110"
                : "hover:scale-105",
              isLight(color.value)
                ? "border border-slate-300 dark:border-slate-600"
                : "border border-black/10"
            )}
            style={{ backgroundColor: mode === "border" ? "transparent" : color.value }}
            title={color.name}
          >
            {mode === "text" && (
              <Type className={cn("w-3.5 h-3.5", isLight(color.value) ? "text-slate-700" : "text-white")} />
            )}
            {mode === "border" && (
              <div className="absolute inset-0.5 rounded-sm" style={{ border: `2px solid ${color.value}` }} />
            )}
            {isSelected && mode === "fill" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-sm" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );

  return createPortal(
    <div
      ref={panelRef}
      className={cn("fixed z-[9999] w-[370px] rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700", glassCard)}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      {/* 标题栏 */}
      <div className={cn("flex items-center justify-between px-3.5 py-2 border-b border-slate-200 dark:border-slate-700", glassPanel)}>
        <div className="flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">节点样式</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
        </button>
      </div>

      {/* 内容区域 */}
      <div className="p-3.5 space-y-3 max-h-[60vh] overflow-y-auto">
        {/* 背景色 */}
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            背景颜色
          </label>
          {renderColorGrid(fillColor, setFillColor, "fill")}
        </div>

        {/* 文字颜色 */}
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            文字颜色
          </label>
          {renderColorGrid(textColor, setTextColor, "text")}
        </div>

        {/* 边框颜色 */}
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            边框颜色
          </label>
          {renderColorGrid(borderColor, setBorderColor, "border")}
        </div>

        {/* 边框宽度 & 字体大小 并排 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              边框宽度
            </label>
            <div className="flex gap-1">
              {BORDER_WIDTHS.map((width) => (
                <button
                  key={width}
                  onClick={() => setBorderWidth(width)}
                  className={cn(
                    "flex-1 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                    borderWidth === width
                      ? "bg-blue-500 text-white shadow-sm"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  )}
                >
                  {width}px
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              字体大小
            </label>
            <div className="flex gap-1">
              {FONT_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  className={cn(
                    "flex-1 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer",
                    fontSize === size
                      ? "bg-blue-500 text-white shadow-sm"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 预览 */}
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            预览
          </label>
          <div className={cn("flex items-center justify-center py-2.5 px-3 rounded-lg", glassPanel)}>
            <div
              className="px-4 py-1.5 rounded-md"
              style={{
                backgroundColor: fillColor,
                color: textColor,
                border: `${borderWidth}px solid ${borderColor}`,
                fontSize: `${fontSize}px`,
              }}
            >
              示例节点
            </div>
          </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className={cn("flex items-center justify-end gap-2 px-3.5 py-2 border-t border-slate-200 dark:border-slate-700", glassPanel)}>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
        >
          取消
        </button>
        <button
          onClick={handleApply}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
        >
          应用样式
        </button>
      </div>
    </div>,
    document.body
  );
}