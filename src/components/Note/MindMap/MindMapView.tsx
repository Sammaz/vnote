/**
 * 思维导图视图组件
 * 封装 simple-mind-map 库，实现章节数据的可视化展示
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2, BarChart3 } from "lucide-react";
import MindMap from "simple-mind-map";
import type { ChapterData } from "../../../types";
import { convertChapterDataToMindMap } from "./chapterToMindMap";
import { getLightTheme, getDarkTheme } from "./themes";

interface MindMapViewProps {
  chapterData: ChapterData | null;
  noteTitle: string;
}

export function MindMapView({ chapterData, noteTitle }: MindMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mindMapRef = useRef<MindMap | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  // 监听主题变化
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const isDark = document.documentElement.classList.contains("dark");
          setIsDarkMode(isDark);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // 初始化思维导图
  useEffect(() => {
    if (!containerRef.current || !chapterData || chapterData.chapters.length === 0) {
      return;
    }

    const data = convertChapterDataToMindMap(chapterData, noteTitle);
    const themeConfig = isDarkMode ? getDarkTheme() : getLightTheme();

    const mindMap = new MindMap({
      el: containerRef.current,
      data,
      readonly: true,
      layout: "logicalStructure",
      themeConfig,
      mousewheelAction: "zoom",
      scaleRatio: 0.1,
      enableDblclickBackToRootNode: false,
      // 设置根节点初始位置：左侧留出边距，垂直居中
      initRootNodePosition: ["5%", "center"],
    });

    mindMapRef.current = mindMap;

    // 设置 SVG 背景透明，让容器的点状背景显示
    const setSvgTransparent = () => {
      const svg = containerRef.current?.querySelector("svg");
      if (svg) {
        svg.style.background = "transparent";
        svg.style.backgroundColor = "transparent";
      }
    };

    // 初始设置和延迟设置
    setSvgTransparent();
    setTimeout(setSvgTransparent, 100);

    // 阻止双击事件冒泡和文本选择
    const handleDblClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleMouseDown = (e: MouseEvent) => {
      // 阻止双击选择文本
      if (e.detail > 1) {
        e.preventDefault();
      }
    };
    containerRef.current.addEventListener("dblclick", handleDblClick, true);
    containerRef.current.addEventListener("mousedown", handleMouseDown, true);

    // 监听容器大小变化，重新调整思维导图
    const resizeObserver = new ResizeObserver(() => {
      if (mindMapRef.current) {
        mindMapRef.current.resize();
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      containerRef.current?.removeEventListener("dblclick", handleDblClick, true);
      containerRef.current?.removeEventListener("mousedown", handleMouseDown, true);
      if (mindMapRef.current) {
        mindMapRef.current.destroy();
        mindMapRef.current = null;
      }
    };
  }, [chapterData, noteTitle, isDarkMode]);

  // 主题切换时更新配置
  useEffect(() => {
    if (mindMapRef.current && containerRef.current) {
      const themeConfig = isDarkMode ? getDarkTheme() : getLightTheme();
      mindMapRef.current.setThemeConfig(themeConfig);

      // 设置 SVG 背景透明
      const svg = containerRef.current.querySelector("svg");
      if (svg) {
        svg.style.background = "transparent";
        svg.style.backgroundColor = "transparent";
      }
    }
  }, [isDarkMode]);

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    if (mindMapRef.current) {
      mindMapRef.current.view.enlarge();
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (mindMapRef.current) {
      mindMapRef.current.view.narrow();
    }
  }, []);

  const handleReset = useCallback(() => {
    if (mindMapRef.current) {
      mindMapRef.current.view.reset();
    }
  }, []);

  // 空状态
  if (!chapterData || chapterData.chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-slate-400">
        <BarChart3 className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg mb-2">暂无思维导图内容</p>
        <p className="text-sm text-center max-w-md">
          请先在「原文细读」标签页生成章节内容，然后返回此页面查看思维导图
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full select-none"
      style={{
        backgroundImage: isDarkMode
          ? "radial-gradient(circle, #333333 1px, transparent 1px)"
          : "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        backgroundColor: isDarkMode ? "#0d0d0d" : "#f8fafc",
      }}
      onMouseDown={(e) => {
        // 阻止双击选择文本
        if (e.detail > 1) {
          e.preventDefault();
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {/* 思维导图容器 */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ overflow: "visible" }}
      />

      {/* 缩放控制工具栏 */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-1 z-10">
        <button
          onClick={handleZoomOut}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors cursor-pointer"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4 text-slate-600 dark:text-slate-300" />
        </button>
        <button
          onClick={handleReset}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors cursor-pointer"
          title="重置视图"
        >
          <Maximize2 className="w-4 h-4 text-slate-600 dark:text-slate-300" />
        </button>
        <button
          onClick={handleZoomIn}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors cursor-pointer"
          title="放大"
        >
          <ZoomIn className="w-4 h-4 text-slate-600 dark:text-slate-300" />
        </button>
      </div>
    </div>
  );
}
