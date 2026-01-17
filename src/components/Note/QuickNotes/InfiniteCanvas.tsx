/**
 * 无限画布组件
 * 基于 React Flow，支持多种节点类型
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Palette, Type, StickyNote as StickyNoteIcon, Image as ImageIcon, FileText, Code, Square, Circle, Diamond, Download, ChevronDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../../../utils/cn";
import ReactMarkdown from "react-markdown";

// 自定义节点组件（简化版，后续可扩展）
function TextNode({ data }: { data: any }) {
  return (
    <div className="px-4 py-2 bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 rounded-lg shadow-sm">
      <div className="text-sm text-slate-800 dark:text-slate-200">{data.label}</div>
    </div>
  );
}

function StickyNoteNode({ data }: { data: any }) {
  return (
    <div className="w-48 bg-yellow-100 dark:bg-yellow-900/30 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg shadow-md p-3">
      <div className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 mb-2">📌 {data.title || "便签"}</div>
      <div className="text-sm text-yellow-900 dark:text-yellow-100 whitespace-pre-wrap">{data.content || ""}</div>
    </div>
  );
}

function ImageNode({ data }: { data: any }) {
  return (
    <div className="bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 rounded-lg shadow-sm overflow-hidden">
      {data.url ? (
        <img src={data.url} alt={data.alt || "图片"} className="max-w-xs max-h-64 object-contain" />
      ) : (
        <div className="w-48 h-32 flex items-center justify-center bg-slate-100 dark:bg-slate-700">
          <ImageIcon className="w-8 h-8 text-slate-400" />
        </div>
      )}
    </div>
  );
}

function MarkdownNode({ data }: { data: any }) {
  return (
    <div className="w-64 bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 rounded-lg shadow-sm p-4">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{data.content || "# Markdown 内容\n\n双击编辑"}</ReactMarkdown>
      </div>
    </div>
  );
}

function CodeNode({ data }: { data: any }) {
  return (
    <div className="w-80 bg-slate-900 dark:bg-slate-950 border-2 border-slate-700 rounded-lg shadow-md overflow-hidden">
      <div className="px-3 py-2 bg-slate-800 dark:bg-slate-900 border-b border-slate-700 flex items-center gap-2">
        <Code className="w-3 h-3 text-slate-400" />
        <span className="text-xs text-slate-400">{data.language || "javascript"}</span>
      </div>
      <pre className="p-3 text-xs text-slate-100 overflow-x-auto">
        <code>{data.code || "// 代码内容\nconsole.log('Hello World');"}</code>
      </pre>
    </div>
  );
}

function ShapeNode({ data }: { data: any }) {
  const shapeType = data.shape || "rectangle";
  const bgColor = data.color || "#3b82f6";

  if (shapeType === "circle") {
    return (
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center text-white text-sm font-medium shadow-lg"
        style={{ backgroundColor: bgColor }}
      >
        {data.label || "圆形"}
      </div>
    );
  }

  if (shapeType === "diamond") {
    return (
      <div className="relative w-24 h-24">
        <div
          className="absolute inset-0 rotate-45 flex items-center justify-center text-white text-sm font-medium shadow-lg"
          style={{ backgroundColor: bgColor }}
        >
          <span className="-rotate-45">{data.label || "菱形"}</span>
        </div>
      </div>
    );
  }

  // rectangle (default)
  return (
    <div
      className="w-32 h-20 rounded-lg flex items-center justify-center text-white text-sm font-medium shadow-lg"
      style={{ backgroundColor: bgColor }}
    >
      {data.label || "矩形"}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  textNode: TextNode,
  stickyNote: StickyNoteNode,
  imageNode: ImageNode,
  markdownNode: MarkdownNode,
  codeNode: CodeNode,
  shapeNode: ShapeNode,
};

interface InfiniteCanvasProps {
  noteId: number;
  initialData: string | null;
  onContentChange?: (content: string) => void;
}

export function InfiniteCanvas({ noteId, initialData, onContentChange }: InfiniteCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedTool, setSelectedTool] = useState<string>("select");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // 加载初始数据
  useEffect(() => {
    if (initialData) {
      try {
        const data = JSON.parse(initialData);
        if (data.nodes) setNodes(data.nodes);
        if (data.edges) setEdges(data.edges);
      } catch (e) {
        console.error("Failed to parse canvas data:", e);
      }
    }
  }, [initialData, setNodes, setEdges]);

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as HTMLElement)) {
        setShowExportMenu(false);
      }
    };
    if (showExportMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  // 自动保存
  const saveContent = useCallback(async (nodes: Node[], edges: Edge[]) => {
    try {
      const data = { nodes, edges };
      const jsonString = JSON.stringify(data);
      await invoke("update_note_content", {
        noteId,
        tabType: "quick_notes_canvas",
        content: jsonString,
      });
      onContentChange?.(jsonString);
    } catch (error) {
      console.error("Failed to save canvas:", error);
    }
  }, [noteId, onContentChange]);

  // 防抖保存
  const handleContentChange = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveContent(nodes, edges);
    }, 1000);
  }, [nodes, edges, saveContent]);

  // 监听节点和边的变化
  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) {
      handleContentChange();
    }
  }, [nodes, edges, handleContentChange]);

  // 连接节点
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // 添加节点
  const addNode = useCallback((type: string, shape?: string) => {
    let data: any;

    switch (type) {
      case "textNode":
        data = { label: "双击编辑" };
        break;
      case "stickyNote":
        data = { title: "便签标题", content: "便签内容" };
        break;
      case "imageNode":
        data = { url: "", alt: "图片" };
        break;
      case "markdownNode":
        data = { content: "# Markdown 内容\n\n双击编辑" };
        break;
      case "codeNode":
        data = { code: "// 代码内容\nconsole.log('Hello World');", language: "javascript" };
        break;
      case "shapeNode":
        data = { label: "形状", shape: shape || "rectangle", color: "#3b82f6" };
        break;
      default:
        data = { label: "节点" };
    }

    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position: { x: 250, y: 250 },
      data,
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedTool("select");
  }, [setNodes]);

  // 清理
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // 导出画布
  const handleExport = useCallback(async (format: 'png' | 'svg') => {
    if (!reactFlowWrapper.current) return;

    try {
      if (format === 'png') {
        // 导出为 PNG
        alert('PNG 导出功能需要额外的库支持，当前版本暂不支持。请使用 SVG 格式导出。');
      } else {
        // 导出为 SVG
        const svgElement = reactFlowWrapper.current.querySelector('svg');
        if (!svgElement) return;

        const svgData = new XMLSerializer().serializeToString(svgElement);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `画布_${Date.now()}.svg`;
        link.click();
        URL.revokeObjectURL(url);
      }

      setShowExportMenu(false);
    } catch (error) {
      console.error('Export failed:', error);
      alert('导出失败');
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center">
            <Palette className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">无限画布</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              自由组织你的想法和笔记
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => addNode("textNode")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
              selectedTool === "textNode"
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600"
            )}
          >
            <Type className="w-4 h-4" />
            文本
          </button>
          <button
            onClick={() => addNode("stickyNote")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
              selectedTool === "stickyNote"
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600"
            )}
          >
            <StickyNoteIcon className="w-4 h-4" />
            便签
          </button>
          <button
            onClick={() => addNode("imageNode")}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <ImageIcon className="w-4 h-4" />
            图片
          </button>
          <button
            onClick={() => addNode("markdownNode")}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            Markdown
          </button>
          <button
            onClick={() => addNode("codeNode")}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <Code className="w-4 h-4" />
            代码
          </button>
          <button
            onClick={() => addNode("shapeNode", "rectangle")}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <Square className="w-4 h-4" />
            矩形
          </button>
          <button
            onClick={() => addNode("shapeNode", "circle")}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <Circle className="w-4 h-4" />
            圆形
          </button>
          <button
            onClick={() => addNode("shapeNode", "diamond")}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <Diamond className="w-4 h-4" />
            菱形
          </button>
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-vnote-hover hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              导出
              <ChevronDown className="w-3 h-3" />
            </button>
            {showExportMenu && (
              <div className="absolute top-full right-0 mt-2 w-40 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 py-1">
                <button
                  onClick={() => handleExport('svg')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  导出为 SVG
                </button>
                <button
                  onClick={() => handleExport('png')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  导出为 PNG
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* React Flow 画布 */}
      <div ref={reactFlowWrapper} className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-slate-50 dark:bg-slate-900"
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
