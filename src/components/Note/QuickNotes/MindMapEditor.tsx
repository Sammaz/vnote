/**
 * 思维导图编辑器组件（可编辑版本）
 * 基于 simple-mind-map，支持从零开始创建思维导图
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Network, ZoomIn, ZoomOut, Maximize2, Download, Palette, ChevronDown, X } from "lucide-react";
import MindMap from "simple-mind-map";
import Drag from "simple-mind-map/src/plugins/Drag.js";
import KeyboardNavigation from "simple-mind-map/src/plugins/KeyboardNavigation.js";
import Select from "simple-mind-map/src/plugins/Select.js";
import NodeImgAdjust from "simple-mind-map/src/plugins/NodeImgAdjust.js";
import Export from "simple-mind-map/src/plugins/Export.js";
import ExportPDF from "simple-mind-map/src/plugins/ExportPDF.js";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { message } from "../../../utils/message";
import { LayoutSelector, type MindMapLayout } from "./LayoutSelector";
import { StylePanel, type NodeStyle } from "./StylePanel";
import { NodeContextMenu } from "../../Note/MindMap/NodeContextMenu";
import { cn } from "../../../utils/cn";
import { useGlassBg } from "../../../hooks/useGlassBg";

// 注册插件
MindMap.usePlugin(Drag);
MindMap.usePlugin(KeyboardNavigation);
MindMap.usePlugin(Select);
MindMap.usePlugin(NodeImgAdjust);
MindMap.usePlugin(Export);
MindMap.usePlugin(ExportPDF);

interface MindMapEditorProps {
  noteId: string;
  noteTitle: string;
  initialData: string | null;
  onContentChange?: (content: string) => void;
}

function getElementContentWidth(element: HTMLElement | null): number {
  if (!element) return 0;
  return Math.max(element.scrollWidth, element.offsetWidth);
}

const LAYOUT_LABELS: Record<MindMapLayout, string> = {
  logicalStructure: "逻辑结构图",
  mindMap: "思维导图",
  organizationStructure: "组织架构图",
  catalogOrganization: "目录组织图",
  timeline: "时间轴",
  fishbone: "鱼骨图",
};

export function MindMapEditor({ noteId, noteTitle, initialData, onContentChange }: MindMapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mindMapRef = useRef<MindMap | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const glassPanel = useGlassBg("panel");
  const glassMenu = useGlassBg("menu");
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [currentLayout, setCurrentLayout] = useState<MindMapLayout>("logicalStructure");
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isCompactLayoutSelector, setIsCompactLayoutSelector] = useState(false);
  const [isCompactToolbar, setIsCompactToolbar] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarLeftRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureSelectorExpandedRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureSelectorCompactRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureRightExpandedRef = useRef<HTMLDivElement>(null);
  const toolbarMeasureRightCompactRef = useRef<HTMLDivElement>(null);
  const toolbarCompactStateRef = useRef({ selector: false, right: false });
  const pendingImageNodeRef = useRef<any>(null);

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

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    if (showExportMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  useEffect(() => {
    const toolbarElement = toolbarRef.current;
    const leftElement = toolbarLeftRef.current;
    const selectorExpandedElement = toolbarMeasureSelectorExpandedRef.current;
    const selectorCompactElement = toolbarMeasureSelectorCompactRef.current;
    const rightExpandedElement = toolbarMeasureRightExpandedRef.current;
    const rightCompactElement = toolbarMeasureRightCompactRef.current;
    if (!toolbarElement || !leftElement || !selectorExpandedElement || !selectorCompactElement || !rightExpandedElement || !rightCompactElement) {
      return;
    }

    const updateCompactMode = () => {
      const toolbarWidth = toolbarElement.clientWidth;
      const leftWidth = leftElement.offsetWidth;
      const selectorExpandedWidth = getElementContentWidth(selectorExpandedElement);
      const selectorCompactWidth = getElementContentWidth(selectorCompactElement);
      const rightExpandedWidth = getElementContentWidth(rightExpandedElement);
      const rightCompactWidth = getElementContentWidth(rightCompactElement);

      let nextSelectorCompact = false;
      let nextRightCompact = false;

      if (leftWidth + selectorExpandedWidth + rightExpandedWidth <= toolbarWidth + 1) {
        nextSelectorCompact = false;
        nextRightCompact = false;
      } else if (leftWidth + selectorCompactWidth + rightExpandedWidth <= toolbarWidth + 1) {
        nextSelectorCompact = true;
        nextRightCompact = false;
      } else {
        nextSelectorCompact = true;
        nextRightCompact = true;
      }

      if (
        toolbarCompactStateRef.current.selector !== nextSelectorCompact ||
        toolbarCompactStateRef.current.right !== nextRightCompact
      ) {
        toolbarCompactStateRef.current = { selector: nextSelectorCompact, right: nextRightCompact };
        setIsCompactLayoutSelector(nextSelectorCompact);
        setIsCompactToolbar(nextRightCompact);
      }
    };

    updateCompactMode();

    const observer = new ResizeObserver(() => {
      updateCompactMode();
    });
    observer.observe(toolbarElement);
    observer.observe(leftElement);
    observer.observe(selectorExpandedElement);
    observer.observe(selectorCompactElement);
    observer.observe(rightExpandedElement);
    observer.observe(rightCompactElement);

    return () => observer.disconnect();
  }, [currentLayout]);

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

  // 自动保存
  const saveContent = useCallback(async (data: any) => {
    try {
      const jsonString = JSON.stringify(data);
      await invoke("update_note_content", {
        noteId,
        tabType: "quick_notes_mindmap",
        content: jsonString,
      });
      onContentChange?.(jsonString);
    } catch (error) {
      console.error("Failed to save mindmap:", error);
    }
  }, [noteId, onContentChange]);

  // 防抖保存
  const handleContentChange = useCallback((data: any) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveContent(data);
    }, 1000);
  }, [saveContent]);

  // 初始化思维导图
  useEffect(() => {
    if (!containerRef.current) return;

    // 解析初始数据或使用默认数据
    let data;
    if (initialData) {
      try {
        data = JSON.parse(initialData);
      } catch (e) {
        data = {
          data: {
            text: "中心主题",
          },
          children: [],
        };
      }
    } else {
      data = {
        data: {
          text: "中心主题",
        },
        children: [],
      };
    }

    const mindMap = new MindMap({
      el: containerRef.current,
      data,
      readonly: false,
      layout: "logicalStructure",
      themeConfig: isDarkMode ? {
        backgroundColor: "transparent",
        lineColor: "#475569",
        lineWidth: 2,
        generalizationLineColor: "#475569",
        generalizationLineWidth: 2,
        root: {
          fillColor: "#3b82f6",
          color: "#ffffff",
          borderColor: "#3b82f6",
          borderWidth: 2,
          fontSize: 16,
        },
        second: {
          fillColor: "#1e293b",
          color: "#ffffff",
          borderColor: "#475569",
          borderWidth: 2,
          fontSize: 14,
        },
        node: {
          fillColor: "#1e293b",
          color: "#ffffff",
          borderColor: "#475569",
          borderWidth: 1,
          fontSize: 12,
        },
      } : {
        backgroundColor: "transparent",
        lineColor: "#cbd5e1",
        lineWidth: 2,
        generalizationLineColor: "#cbd5e1",
        generalizationLineWidth: 2,
        root: {
          fillColor: "#3b82f6",
          color: "#ffffff",
          borderColor: "#3b82f6",
          borderWidth: 2,
          fontSize: 16,
        },
        second: {
          fillColor: "#ffffff",
          color: "#1e293b",
          borderColor: "#cbd5e1",
          borderWidth: 2,
          fontSize: 14,
        },
        node: {
          fillColor: "#ffffff",
          color: "#1e293b",
          borderColor: "#cbd5e1",
          borderWidth: 1,
          fontSize: 12,
        },
      },
      mousewheelAction: "zoom",
      scaleRatio: 0.1,
      enableDblclickBackToRootNode: false,
      initRootNodePosition: ["5%", "center"],
      enableShortcutOnlyWhenMouseInSvg: false,
      autoMoveWhenMouseInEdgeOnDrag: true,
      textAutoWrapWidth: 300,
      imgTextMargin: 10,
      textContentMargin: 10,
    });

    mindMapRef.current = mindMap;

    // 监听数据变化
    const handleDataChange = () => {
      const data = mindMap.getData();
      handleContentChange(data);
    };

    mindMap.on("data_change", handleDataChange);

    // 监听节点右键菜单事件
    const handleNodeContextMenu = (e: any, node: any) => {
      e.preventDefault();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        node,
      });
    };

    mindMap.on("node_contextmenu", handleNodeContextMenu);

    // 监听节点图片双击事件（用于放大预览）
    const handleNodeImgDblClick = (_node: any, e: any, imgNode: any) => {
      e.stopPropagation();
      // 从 imgNode 获取图片 src（SVG image 元素）
      const src = imgNode?.node?.href?.baseVal || imgNode?.attr?.('href') || '';
      if (src) {
        setPreviewImage(src);
      }
    };

    mindMap.on("node_img_dblclick", handleNodeImgDblClick);

    // 设置 SVG 背景透明
    const setSvgTransparent = () => {
      const svg = containerRef.current?.querySelector("svg");
      if (svg) {
        svg.style.background = "transparent";
        svg.style.backgroundColor = "transparent";
        const texts = svg.querySelectorAll<SVGTextElement>("text");
        texts.forEach((text) => {
          text.style.fill = isDarkMode ? "#ffffff" : "#0f172a";
        });
      }
    };

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
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (mindMapRef.current) {
        mindMapRef.current.off("data_change", handleDataChange);
        mindMapRef.current.off("node_contextmenu", handleNodeContextMenu);
        mindMapRef.current.off("node_img_dblclick", handleNodeImgDblClick);
        mindMapRef.current.destroy();
        mindMapRef.current = null;
      }
    };
  }, [isDarkMode, initialData, handleContentChange]);

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

  // 切换布局
  const handleLayoutChange = useCallback((layout: MindMapLayout) => {
    if (mindMapRef.current) {
      mindMapRef.current.setLayout(layout);
      setCurrentLayout(layout);
    }
  }, []);

  // 修改节点样式
  const handleStyleChange = useCallback((style: NodeStyle) => {
    if (mindMapRef.current) {
      // 获取当前选中的节点（使用类型断言绕过TypeScript检查）
      const activeNodes = (mindMapRef.current as any).renderer?.activeNodeList;

      if (activeNodes && activeNodes.length > 0) {
        // 修改选中节点的样式
        activeNodes.forEach((node: any) => {
          const styleConfig: any = {};
          if (style.fillColor) styleConfig.fillColor = style.fillColor;
          if (style.color) styleConfig.color = style.color;
          if (style.borderColor) styleConfig.borderColor = style.borderColor;
          if (style.borderWidth !== undefined) styleConfig.borderWidth = style.borderWidth;
          if (style.fontSize) styleConfig.fontSize = style.fontSize;

          // 使用 SET_NODE_STYLES 命令修改节点样式（注意是复数形式）
          mindMapRef.current?.execCommand('SET_NODE_STYLES', node, styleConfig);
        });
        message.success('样式已应用到选中节点');
      } else {
        message.warning('请先选中要修改样式的节点');
      }
    }
  }, []);

  // 导出为不同格式
  const handleExport = useCallback(async (format: 'png' | 'svg' | 'pdf') => {
    if (mindMapRef.current) {
      try {
        // 让用户选择保存位置
        const filePath = await save({
          defaultPath: `${noteTitle}.${format}`,
          filters: [{
            name: format.toUpperCase(),
            extensions: [format]
          }]
        });

        if (!filePath) {
          // 用户取消了保存
          return;
        }

        // 导出思维导图数据
        const dataUrl = await mindMapRef.current.export(format, true, noteTitle);

        // 将 data URL 转换为 Blob
        const response = await fetch(dataUrl as string);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // 写入文件
        await writeFile(filePath, uint8Array);

        message.success(`导出${format.toUpperCase()}成功`);
        setShowExportMenu(false);
      } catch (error) {
        console.error("Export failed:", error);
        message.error(`导出${format.toUpperCase()}失败: ${error}`);
      }
    }
  }, [noteTitle]);

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
      case "insertImage":
        // 保存当前节点引用，触发文件选择
        pendingImageNodeRef.current = contextMenu.node;
        fileInputRef.current?.click();
        break;
      case "insertCurrentScreenshot":
        // 插入当前视频截图
        handleInsertCurrentScreenshot(contextMenu.node);
        break;
      default:
        break;
    }
  }, [contextMenu.node]);

  // 处理图片选择
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !mindMapRef.current || !pendingImageNodeRef.current) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;

      // 创建图片对象获取尺寸
      const img = new window.Image();
      img.onload = () => {
        // 限制最大尺寸
        const maxWidth = 300;
        const maxHeight = 200;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }

        // 使用 SET_NODE_IMAGE 命令插入图片
        mindMapRef.current?.execCommand("SET_NODE_IMAGE", pendingImageNodeRef.current, {
          url: dataUrl,
          title: file.name,
          width: Math.round(width),
          height: Math.round(height),
        });

        pendingImageNodeRef.current = null;
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);

    // 清空 input 值，允许重复选择同一文件
    e.target.value = "";
  }, []);

  // 插入当前视频截图
  const handleInsertCurrentScreenshot = useCallback(async (node: any) => {
    try {
      const videoElement = document.querySelector("video");
      if (!videoElement) {
        message.warning("未找到视频播放器");
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        message.error("无法创建画布");
        return;
      }

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // Convert to data URL (use JPEG for smaller size)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

      // 限制最大尺寸
      const maxWidth = 300;
      const maxHeight = 200;
      let width = videoElement.videoWidth;
      let height = videoElement.videoHeight;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }

      // 使用 SET_NODE_IMAGE 命令插入图片
      mindMapRef.current?.execCommand("SET_NODE_IMAGE", node, {
        url: dataUrl,
        title: "视频截图",
        width: Math.round(width),
        height: Math.round(height),
      });

      message.success("截图已插入");
    } catch (error) {
      console.error("Screenshot error:", error);
      message.error("截图失败");
    }
  }, []);

  return (
    <div
      className={`relative overflow-hidden ${
        isFullscreen
          ? "fixed inset-0 z-50 flex flex-col"
          : "flex flex-col h-full"
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(148, 163, 184, 0.24) 1.2px, transparent 1.2px)",
          backgroundSize: "20px 20px",
          backgroundColor: "transparent",
          opacity: isDarkMode ? 0.7 : 1,
        }}
      />
      {/* 工具栏 */}
      <div className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
        <div className={cn("flex items-center justify-between gap-3 overflow-hidden px-4 py-3 border-b border-slate-200 dark:border-vnote-border", glassPanel)}>
          <div className="flex items-center gap-2 shrink-0 overflow-hidden">
            <div ref={toolbarMeasureSelectorExpandedRef}>
              <LayoutSelector value={currentLayout} onChange={handleLayoutChange} />
            </div>
            <div ref={toolbarMeasureSelectorCompactRef}>
              <LayoutSelector
                value={currentLayout}
                onChange={handleLayoutChange}
                compact
                compactLabel={LAYOUT_LABELS[currentLayout]}
              />
            </div>
            <div ref={toolbarMeasureRightExpandedRef} className="flex items-center gap-2 shrink-0 overflow-hidden">
              <button
                type="button"
                className="flex items-center justify-center rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover gap-1.5 px-3 py-2"
              >
                <Palette className="w-4 h-4" />
                样式
              </button>
              <button
                type="button"
                className="flex items-center justify-center rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover gap-1.5 px-3 py-2"
              >
                <Download className="w-4 h-4" />
                导出
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            <div ref={toolbarMeasureRightCompactRef} className="flex items-center gap-2 shrink-0 overflow-hidden">
              <button
                type="button"
                className="flex items-center justify-center rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover h-9 w-9 px-0"
              >
                <Palette className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="flex items-center justify-center rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover h-9 w-9 px-0"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        ref={toolbarRef}
        className={cn(
          "flex items-center justify-between gap-3 overflow-hidden border-b border-slate-200 dark:border-vnote-border flex-nowrap",
          (isCompactLayoutSelector || isCompactToolbar) ? "px-3 py-2.5" : "px-4 py-3",
          glassPanel
        )}
      >
        <div ref={toolbarLeftRef} className="flex min-w-0 items-center gap-3 overflow-hidden" data-toolbar-row>
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
            <Network className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 overflow-hidden">
            <h3 className="truncate text-base font-medium text-slate-800 dark:text-slate-100">思维导图</h3>
            <p className="truncate text-sm text-slate-500 dark:text-slate-400">
              双击节点编辑，Tab 添加子节点，Enter 添加兄弟节点，右键打开菜单
            </p>
          </div>
        </div>
        <div className={cn("flex items-center gap-2 shrink-0 overflow-hidden flex-nowrap", (isCompactLayoutSelector || isCompactToolbar) && "gap-1.5")}>
          <LayoutSelector
            value={currentLayout}
            onChange={handleLayoutChange}
            compact={isCompactLayoutSelector}
            compactLabel={LAYOUT_LABELS[currentLayout]}
          />
          <button
            onClick={() => setShowStylePanel(true)}
            className={cn(
              "flex items-center justify-center rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer",
              isCompactToolbar ? "h-9 w-9 px-0" : "gap-1.5 px-3 py-2"
            )}
            title="样式"
            aria-label="样式"
          >
            <Palette className="w-4 h-4" />
            {!isCompactToolbar && "样式"}
          </button>
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className={cn(
                "flex items-center justify-center rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer",
                isCompactToolbar ? "h-9 w-9 px-0" : "gap-1.5 px-3 py-2"
              )}
              title="导出"
              aria-label="导出"
            >
              <Download className="w-4 h-4" />
              {!isCompactToolbar && "导出"}
              {!isCompactToolbar && <ChevronDown className="w-3 h-3" />}
            </button>
            {showExportMenu && (
              <div className={cn("absolute top-full right-0 mt-2 w-40 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 py-1", glassMenu)}>
                <button
                  onClick={() => handleExport('png')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  导出为 PNG
                </button>
                <button
                  onClick={() => handleExport('svg')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  导出为 SVG
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  导出为 PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 思维导图画布 */}
      <div className="flex-1 relative">
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{
            overflow: "visible",
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none'
          }}
        />

        {/* 缩放控制工具栏 */}
        <div className={cn("absolute bottom-4 left-4 flex flex-col items-center gap-1 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-1 z-[100]", glassPanel)}>
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

      {/* 隐藏的图片选择输入框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageSelect}
      />

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

      {/* 样式面板 */}
      <StylePanel
        isOpen={showStylePanel}
        onClose={() => setShowStylePanel(false)}
        onStyleChange={handleStyleChange}
      />
    </div>
  );
}
