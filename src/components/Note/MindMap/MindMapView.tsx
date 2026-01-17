/**
 * 思维导图视图组件
 * 封装 simple-mind-map 库，实现章节数据的可视化展示
 */

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { ZoomIn, ZoomOut, Maximize2, BarChart3, Fullscreen, Minimize, X } from "lucide-react";
import MindMap from "simple-mind-map";
// 导入必要的插件
import Drag from "simple-mind-map/src/plugins/Drag.js";
import KeyboardNavigation from "simple-mind-map/src/plugins/KeyboardNavigation.js";
import Select from "simple-mind-map/src/plugins/Select.js";
import type { ChapterData, SubtitleEntry } from "../../../types";
import { convertChapterDataToMindMap } from "./chapterToMindMap";
import { getLightTheme, getDarkTheme } from "./themes";
import { NodeContextMenu } from "./NodeContextMenu";

// 注册插件
MindMap.usePlugin(Drag);
MindMap.usePlugin(KeyboardNavigation);
MindMap.usePlugin(Select);

/**
 * 清理思维导图节点数据，移除 richText 相关属性和 HTML 标签
 */
function cleanMindMapNode(node: any): any {
  if (!node) return node;

  const cleanedNode = { ...node };

  // 清理 data 属性
  if (cleanedNode.data) {
    cleanedNode.data = { ...cleanedNode.data };
    // 设置 richText 为 false，避免在没有 RichText 插件时出错
    cleanedNode.data.richText = false;
    // 清理 HTML 标签
    if (typeof cleanedNode.data.text === 'string') {
      cleanedNode.data.text = cleanedNode.data.text
        .replace(/<[^>]*>/g, '') // 移除所有 HTML 标签
        .trim();
    }
  }

  // 递归清理子节点
  if (cleanedNode.children && Array.isArray(cleanedNode.children)) {
    cleanedNode.children = cleanedNode.children.map(cleanMindMapNode);
  }

  return cleanedNode;
}

interface MindMapViewProps {
  chapterData: ChapterData | null;
  noteTitle: string;
  /** 已保存的思维导图数据（JSON 字符串） */
  savedMindMapData?: string | null;
  /** 优化后的字幕 Map<chapterId, optimizedText> */
  optimizedSubtitles?: Map<string, string>;
  /** 原始字幕数据 */
  originalSubtitles?: SubtitleEntry[];
}

/** 暴露给父组件的方法 */
export interface MindMapViewRef {
  /** 获取当前思维导图数据 */
  getData: () => any;
  /** 获取 MindMap 实例 */
  getInstance: () => MindMap | null;
  /** 重新生成思维导图（从章节数据重新生成） */
  regenerate: () => void;
}

export const MindMapView = forwardRef<MindMapViewRef, MindMapViewProps>(function MindMapView({ chapterData, noteTitle, savedMindMapData, optimizedSubtitles, originalSubtitles }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mindMapRef = useRef<MindMap | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    node: any;
  }>({
    visible: false,
    x: 0,
    y: 0,
    node: null,
  });

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    getData: () => {
      if (mindMapRef.current) {
        return mindMapRef.current.getData();
      }
      return null;
    },
    getInstance: () => mindMapRef.current,
    regenerate: () => {
      if (mindMapRef.current && chapterData && chapterData.chapters.length > 0) {
        // 从章节数据重新生成思维导图（始终显示图片）
        const data = convertChapterDataToMindMap(chapterData, noteTitle, {
          optimizedSubtitles,
          originalSubtitles,
          showImages: true,
        });
        mindMapRef.current.setData(data);
        // 重置视图
        mindMapRef.current.view.reset();
      }
    },
  }), [chapterData, noteTitle, optimizedSubtitles, originalSubtitles]);

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

    // 优先使用已保存的思维导图数据，否则从章节数据生成
    let data;
    if (savedMindMapData) {
      try {
        const parsedData = JSON.parse(savedMindMapData);
        // 清理 richText 相关属性，避免在没有 RichText 插件时出错
        data = cleanMindMapNode(parsedData);
      } catch (e) {
        data = convertChapterDataToMindMap(chapterData, noteTitle, {
          optimizedSubtitles,
          originalSubtitles,
          showImages: true,
        });
      }
    } else {
      data = convertChapterDataToMindMap(chapterData, noteTitle, {
        optimizedSubtitles,
        originalSubtitles,
        showImages: true,
      });
    }

    const themeConfig = isDarkMode ? getDarkTheme() : getLightTheme();

    const mindMap = new MindMap({
      el: containerRef.current,
      data,
      readonly: false,
      layout: "logicalStructure",
      themeConfig,
      mousewheelAction: "zoom",
      scaleRatio: 0.1,
      enableDblclickBackToRootNode: false,
      // 设置根节点初始位置：左侧留出边距，垂直居中
      initRootNodePosition: ["5%", "center"],
      // 启用全局快捷键（不仅限于鼠标在SVG内时）
      enableShortcutOnlyWhenMouseInSvg: false,
      // 拖拽配置
      autoMoveWhenMouseInEdgeOnDrag: true,
      // 超长文本自动换行配置（单位：像素）
      textAutoWrapWidth: 300,
      // 文本与图片的间距
      imgTextMargin: 10,
      // 文本内容的间距
      textContentMargin: 10,
    });

    mindMapRef.current = mindMap;

    // 监听节点右键菜单事件
    const handleNodeContextMenu = (e: MouseEvent, node: any) => {
      e.preventDefault();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        node,
      });
    };

    mindMap.on("node_contextmenu", handleNodeContextMenu);

    // 监听节点图片点击事件
    const handleNodeImgClick = (_node: any, e: MouseEvent, _imgNode: any, src: string) => {
      e.stopPropagation();
      setPreviewImage(src);
    };

    mindMap.on("node_img_click", handleNodeImgClick);

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

    // 监听容器大小变化，重新调整思维导图
    const resizeObserver = new ResizeObserver(() => {
      if (mindMapRef.current) {
        mindMapRef.current.resize();
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (mindMapRef.current) {
        mindMapRef.current.off("node_contextmenu", handleNodeContextMenu);
        mindMapRef.current.off("node_img_click", handleNodeImgClick);
        mindMapRef.current.destroy();
        mindMapRef.current = null;
      }
    };
  }, [chapterData, noteTitle, isDarkMode, savedMindMapData]);

  // 处理右键菜单操作
  const handleMenuAction = useCallback((action: string) => {
    if (!mindMapRef.current || !contextMenu.node) return;

    const mindMap = mindMapRef.current;

    switch (action) {
      case "insertSibling":
        mindMap.execCommand("INSERT_NODE");
        break;
      case "insertChild":
        mindMap.execCommand("INSERT_CHILD_NODE");
        break;
      case "insertParent":
        mindMap.execCommand("INSERT_PARENT_NODE");
        break;
      case "edit":
        // 激活节点并进入编辑模式
        contextMenu.node.active();
        setTimeout(() => {
          mindMap.execCommand("SET_NODE_TEXT", contextMenu.node, contextMenu.node.getData("text"));
        }, 50);
        break;
      case "copy":
        mindMap.execCommand("COPY_NODE");
        break;
      case "cut":
        mindMap.execCommand("CUT_NODE");
        break;
      case "paste":
        mindMap.execCommand("PASTE_NODE");
        break;
      case "toggleExpand":
        if (contextMenu.node.nodeData.children && contextMenu.node.nodeData.children.length > 0) {
          mindMap.execCommand("TOGGLE_NODE_EXPAND", contextMenu.node);
        }
        break;
      case "moveUp":
        mindMap.execCommand("UP_NODE");
        break;
      case "moveDown":
        mindMap.execCommand("DOWN_NODE");
        break;
      case "delete":
        mindMap.execCommand("REMOVE_NODE");
        break;
      default:
        break;
    }
  }, [contextMenu.node]);

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

  // 全屏控制（画布全屏，覆盖整个应用窗口）
  const handleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // 全屏时按 ESC 退出
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

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
      className={`${
        isFullscreen
          ? "fixed inset-0 z-50"
          : "relative w-full h-full"
      }`}
      style={{
        backgroundImage: isDarkMode
          ? "radial-gradient(circle, #333333 1px, transparent 1px)"
          : "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        backgroundColor: isDarkMode ? "#0d0d0d" : "#f8fafc",
      }}
    >
      {/* 思维导图容器 */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ overflow: "visible" }}
      />

      {/* 缩放控制工具栏 */}
      <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-1 z-10">
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
        <button
          onClick={handleFullscreen}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors cursor-pointer"
          title={isFullscreen ? "退出全屏" : "全屏"}
        >
          {isFullscreen ? (
            <Minimize className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          ) : (
            <Fullscreen className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          )}
        </button>
      </div>

      {/* 节点右键菜单 */}
      <NodeContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu({ ...contextMenu, visible: false })}
        onAction={handleMenuAction}
        hasChildren={
          contextMenu.node?.nodeData?.children &&
          contextMenu.node.nodeData.children.length > 0
        }
        isExpanded={contextMenu.node?.nodeData?.data?.expand !== false}
      />

      {/* 图片预览模态框 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => setPreviewImage(null)}
        >
          {/* 关闭按钮 */}
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
            onClick={() => setPreviewImage(null)}
            title="关闭预览"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          {/* 图片 */}
          <img
            src={previewImage}
            alt="预览图片"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
});
