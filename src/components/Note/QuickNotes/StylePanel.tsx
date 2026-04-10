/**
 * 思维导图节点样式面板
 */

import { useState, useRef, useEffect } from "react";
import { Palette, X, Type } from "lucide-react";
import { cn } from "../../../utils/cn";
import { useGlassBg } from "../../../hooks/useGlassBg";

interface StylePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onStyleChange: (style: NodeStyle) => void;
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

export function StylePanel({ isOpen, onClose, onStyleChange }: StylePanelProps) {
  const [fillColor, setFillColor] = useState("#3b82f6");
  const [textColor, setTextColor] = useState("#ffffff");
  const [borderColor, setBorderColor] = useState("#3b82f6");
  const [borderWidth, setBorderWidth] = useState(2);
  const [fontSize, setFontSize] = useState(14);
  const panelRef = useRef<HTMLDivElement>(null);
  const glassCard = useGlassBg("card");
  const glassPanel = useGlassBg("panel");

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={panelRef}
        className={cn("rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-[680px] max-h-[90vh] overflow-y-auto", glassCard)}
      >
        {/* 标题栏 */}
        <div className={cn("flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700", glassPanel)}>
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-blue-500" />
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">节点样式</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="p-5 space-y-5">
          {/* 背景色 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              背景颜色
            </label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setFillColor(color.value)}
                  className={cn(
                    "w-12 h-12 rounded-lg transition-all cursor-pointer relative flex-shrink-0",
                    fillColor === color.value
                      ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-800 scale-110"
                      : "hover:scale-105",
                    color.value === "#ffffff"
                      ? "border-2 border-slate-300 dark:border-slate-600"
                      : "border border-slate-200 dark:border-slate-700"
                  )}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                >
                  {fillColor === color.value && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-blue-500 shadow-lg" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 文字颜色 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              文字颜色
            </label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setTextColor(color.value)}
                  className={cn(
                    "w-12 h-12 rounded-lg transition-all cursor-pointer flex items-center justify-center relative flex-shrink-0",
                    textColor === color.value
                      ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-800 scale-110"
                      : "hover:scale-105",
                    color.value === "#ffffff"
                      ? "border-2 border-slate-300 dark:border-slate-600"
                      : "border border-slate-200 dark:border-slate-700"
                  )}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                >
                  <Type className={cn(
                    "w-4 h-4",
                    color.value === "#ffffff" || color.value === "#eab308" ? "text-slate-700" : "text-white"
                  )} />
                </button>
              ))}
            </div>
          </div>

          {/* 边框颜色 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              边框颜色
            </label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setBorderColor(color.value)}
                  className={cn(
                    "w-12 h-12 rounded-lg transition-all cursor-pointer bg-slate-50 dark:bg-slate-900 relative flex-shrink-0",
                    borderColor === color.value
                      ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-800 scale-110"
                      : "hover:scale-105"
                  )}
                  style={{
                    border: `3px solid ${color.value}`,
                  }}
                  title={color.name}
                >
                  {borderColor === color.value && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-blue-500 shadow-lg" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 边框宽度 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              边框宽度
            </label>
            <div className="flex gap-2">
              {BORDER_WIDTHS.map((width) => (
                <button
                  key={width}
                  onClick={() => setBorderWidth(width)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer",
                    borderWidth === width
                      ? "bg-blue-500 text-white shadow-md"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  )}
                >
                  {width}px
                </button>
              ))}
            </div>
          </div>

          {/* 字体大小 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              字体大小
            </label>
            <div className="grid grid-cols-6 gap-2">
              {FONT_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  className={cn(
                    "py-2 rounded-lg text-sm font-medium transition-all cursor-pointer",
                    fontSize === size
                      ? "bg-blue-500 text-white shadow-md"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* 预览 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              预览
            </label>
            <div className={cn("flex items-center justify-center p-6 rounded-lg", glassPanel)}>
              <div
                className="px-6 py-3 rounded-lg"
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
        <div className={cn("flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-200 dark:border-slate-700", glassPanel)}>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
          >
            应用样式
          </button>
        </div>
      </div>
    </div>
  );
}
