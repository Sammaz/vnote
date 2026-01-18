/**
 * 无限画布组件
 * 基于 React Flow，支持多种节点类型
 */

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
  MarkerType,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Palette, Type, StickyNote as StickyNoteIcon, Image as ImageIcon, FileText, Code, Square, Circle, Diamond, Copy, Trash2, Fullscreen, Minimize } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../../../utils/cn";
import ReactMarkdown from "react-markdown";

// 自定义节点组件（带选中状态和内联编辑）
function TextNode({ data, selected }: { data: any; selected?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(data.label || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (value !== data.label) {
      // 触发更新
      data.label = value;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    } else if (e.key === 'Escape') {
      setValue(data.label || '');
      setIsEditing(false);
    }
  };

  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-target" />
      <Handle type="source" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-source" />
      <Handle type="target" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-target" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-source" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-target" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-source" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-target" />
      <Handle type="source" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-source" />
      <div
        className={cn(
          "px-4 py-2 bg-white dark:bg-slate-800 border-2 rounded-lg shadow-sm transition-all",
          isEditing ? "cursor-text" : "cursor-pointer",
          selected
            ? "border-blue-500 dark:border-blue-400 shadow-lg ring-2 ring-blue-200 dark:ring-blue-800"
            : "border-slate-300 dark:border-slate-600"
        )}
        onDoubleClick={handleDoubleClick}
        onMouseDown={(e) => {
          if (isEditing) {
            e.stopPropagation();
          }
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="text-sm text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none w-full"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="text-sm text-slate-800 dark:text-slate-200">{value || '双击编辑'}</div>
        )}
      </div>
    </>
  );
}

function StickyNoteNode({ data, selected }: { data: any; selected?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(data.title || '');
  const [content, setContent] = useState(data.content || '');
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // 检查焦点是否移动到容器内的其他元素
    setTimeout(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setIsEditing(false);
        data.title = title;
        data.content = content;
      }
    }, 0);
  };

  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-target" />
      <Handle type="source" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-source" />
      <Handle type="target" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-target" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-source" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-target" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-source" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-target" />
      <Handle type="source" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-source" />
      <div
        ref={containerRef}
        className={cn(
          "w-48 bg-yellow-100 dark:bg-yellow-900/30 border-2 rounded-lg shadow-md p-3 transition-all",
          isEditing ? "cursor-text" : "cursor-pointer",
          selected
            ? "border-blue-500 dark:border-blue-400 shadow-xl ring-2 ring-blue-200 dark:ring-blue-800"
            : "border-yellow-300 dark:border-yellow-700"
        )}
        onDoubleClick={handleDoubleClick}
        onMouseDown={(e) => {
          if (isEditing) {
            e.stopPropagation();
          }
        }}
      >
        {isEditing ? (
          <>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleBlur}
              placeholder="标题"
              className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 mb-2 bg-transparent border-none outline-none w-full"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={handleBlur}
              placeholder="内容"
              rows={3}
              className="text-sm text-yellow-900 dark:text-yellow-100 bg-transparent border-none outline-none w-full resize-none"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </>
        ) : (
          <>
            <div className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 mb-2">📌 {title || "便签"}</div>
            <div className="text-sm text-yellow-900 dark:text-yellow-100 whitespace-pre-wrap">{content || "双击编辑"}</div>
          </>
        )}
      </div>
    </>
  );
}

function ImageNode({ data, selected }: { data: any; selected?: boolean }) {
  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-target" />
      <Handle type="source" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-source" />
      <Handle type="target" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-target" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-source" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-target" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-source" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-target" />
      <Handle type="source" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-source" />
      <div
        className={cn(
          "bg-white dark:bg-slate-800 border-2 rounded-lg shadow-sm overflow-hidden transition-all cursor-pointer",
          selected
            ? "border-blue-500 dark:border-blue-400 shadow-lg ring-2 ring-blue-200 dark:ring-blue-800"
            : "border-slate-300 dark:border-slate-600"
        )}
      >
        {data.url ? (
          <img src={data.url} alt={data.alt || "图片"} className="max-w-xs max-h-64 object-contain" />
        ) : (
          <div className="w-48 h-32 flex items-center justify-center bg-slate-100 dark:bg-slate-700">
            <ImageIcon className="w-8 h-8 text-slate-400" />
            <span className="ml-2 text-sm text-slate-500">右键插入图片</span>
          </div>
        )}
      </div>
    </>
  );
}

function MarkdownNode({ data, selected }: { data: any; selected?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(data.content || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    data.content = content;
  };

  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-target" />
      <Handle type="source" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-source" />
      <Handle type="target" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-target" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-source" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-target" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-source" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-target" />
      <Handle type="source" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-source" />
      <div
        className={cn(
          "w-64 bg-white dark:bg-slate-800 border-2 rounded-lg shadow-sm p-4 transition-all",
          isEditing ? "cursor-text" : "cursor-pointer",
          selected
            ? "border-blue-500 dark:border-blue-400 shadow-lg ring-2 ring-blue-200 dark:ring-blue-800"
            : "border-slate-300 dark:border-slate-600"
        )}
        onDoubleClick={handleDoubleClick}
        onMouseDown={(e) => {
          if (isEditing) {
            e.stopPropagation();
          }
        }}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleBlur}
            rows={8}
            placeholder="Markdown内容"
            className="w-full text-sm bg-transparent border border-slate-300 dark:border-slate-600 rounded p-2 outline-none font-mono text-slate-800 dark:text-slate-200"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{content || "# Markdown\n\n双击编辑"}</ReactMarkdown>
          </div>
        )}
      </div>
    </>
  );
}

function CodeNode({ data, selected }: { data: any; selected?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [code, setCode] = useState(data.code || '');
  const [language, setLanguage] = useState(data.language || 'javascript');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    data.code = code;
    data.language = language;
  };

  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-target" />
      <Handle type="source" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-source" />
      <Handle type="target" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-target" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-source" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-target" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-source" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-target" />
      <Handle type="source" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-source" />
      <div
        className={cn(
          "w-80 bg-slate-900 dark:bg-slate-950 border-2 rounded-lg shadow-md overflow-hidden transition-all",
          isEditing ? "cursor-text" : "cursor-pointer",
          selected
            ? "border-blue-500 dark:border-blue-400 shadow-xl ring-2 ring-blue-200 dark:ring-blue-800"
            : "border-slate-700"
        )}
        onDoubleClick={handleDoubleClick}
        onMouseDown={(e) => {
          if (isEditing) {
            e.stopPropagation();
          }
        }}
      >
        <div className="px-3 py-2 bg-slate-800 dark:bg-slate-900 border-b border-slate-700 flex items-center gap-2">
          <Code className="w-3 h-3 text-slate-400" />
          {isEditing ? (
            <input
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="text-xs text-slate-400 bg-transparent border-none outline-none"
              placeholder="语言"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-xs text-slate-400">{language}</span>
          )}
        </div>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onBlur={handleBlur}
            rows={10}
            placeholder="代码内容"
            className="w-full p-3 text-xs text-slate-100 bg-slate-900 dark:bg-slate-950 font-mono outline-none resize-none"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <pre className="p-3 text-xs text-slate-100 overflow-x-auto">
            <code>{code || "// 双击编辑代码"}</code>
          </pre>
        )}
      </div>
    </>
  );
}

function ShapeNode({ data, selected }: { data: any; selected?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(data.label || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const shapeType = data.shape || "rectangle";
  const bgColor = data.color || "#3b82f6";

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    data.label = label;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    } else if (e.key === 'Escape') {
      setLabel(data.label || '');
      setIsEditing(false);
    }
  };

  if (shapeType === "circle") {
    return (
      <>
        <Handle type="target" position={Position.Top} className="w-3 h-3" />
        <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
        <div
          className={cn(
            "w-24 h-24 rounded-full flex items-center justify-center text-white text-sm font-medium shadow-lg transition-all",
            isEditing ? "cursor-text" : "cursor-pointer",
            selected && "ring-4 ring-blue-300 dark:ring-blue-700 shadow-xl"
          )}
          style={{ backgroundColor: bgColor }}
          onDoubleClick={handleDoubleClick}
          onMouseDown={(e) => {
            if (isEditing) {
              e.stopPropagation();
            }
          }}
        >
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="w-16 text-center text-sm bg-white/20 border-none outline-none text-white"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            label || "圆形"
          )}
        </div>
      </>
    );
  }

  if (shapeType === "diamond") {
    return (
      <>
        <Handle type="target" position={Position.Top} className="w-3 h-3" style={{ top: -6 }} />
        <Handle type="source" position={Position.Bottom} className="w-3 h-3" style={{ bottom: -6 }} />
        <div
          className={cn("relative w-24 h-24", selected && "scale-110 transition-transform")}
          onDoubleClick={handleDoubleClick}
          onMouseDown={(e) => {
            if (isEditing) {
              e.stopPropagation();
            }
          }}
        >
          <div
            className={cn(
              "absolute inset-0 rotate-45 flex items-center justify-center text-white text-sm font-medium shadow-lg",
              isEditing ? "cursor-text" : "cursor-pointer",
              selected && "ring-4 ring-blue-300 dark:ring-blue-700 shadow-xl"
            )}
            style={{ backgroundColor: bgColor }}
          >
            <span className="-rotate-45">
              {isEditing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  className="w-16 text-center text-sm bg-white/20 border-none outline-none text-white"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              ) : (
                label || "菱形"
              )}
            </span>
          </div>
        </div>
      </>
    );
  }

  // rectangle (default)
  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-target" />
      <Handle type="source" position={Position.Top} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="top-source" />
      <Handle type="target" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-target" />
      <Handle type="source" position={Position.Right} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="right-source" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-target" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="bottom-source" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-target" />
      <Handle type="source" position={Position.Left} className="w-2 h-2 opacity-0 hover:opacity-100 transition-opacity" id="left-source" />
      <div
        className={cn(
          "w-32 h-20 rounded-lg flex items-center justify-center text-white text-sm font-medium shadow-lg transition-all",
          isEditing ? "cursor-text" : "cursor-pointer",
          selected && "ring-4 ring-blue-300 dark:ring-blue-700 shadow-xl"
        )}
        style={{ backgroundColor: bgColor }}
        onDoubleClick={handleDoubleClick}
        onMouseDown={(e) => {
          if (isEditing) {
            e.stopPropagation();
          }
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-24 text-center text-sm bg-white/20 border-none outline-none text-white"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          label || "矩形"
        )}
      </div>
    </>
  );
}

// 定义 nodeTypes 在组件外部，避免每次渲染都创建新对象
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
  noteTitle?: string;
}

// 连线类型定义
type EdgeType = 'default' | 'straight' | 'step' | 'smoothstep' | 'simplebezier';

const edgeTypeOptions: { value: EdgeType; label: string; description: string }[] = [
  { value: 'default', label: '默认', description: '贝塞尔曲线' },
  { value: 'straight', label: '直线', description: '直线连接' },
  { value: 'step', label: '阶梯', description: '直角阶梯线' },
  { value: 'smoothstep', label: '平滑阶梯', description: '圆角阶梯线' },
  { value: 'simplebezier', label: '简单曲线', description: '简单贝塞尔曲线' },
];

export function InfiniteCanvas({ noteId, initialData, onContentChange, noteTitle }: InfiniteCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedTool, setSelectedTool] = useState<string>("select");
  const [selectedEdgeType, setSelectedEdgeType] = useState<EdgeType>('smoothstep');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string; edgeId?: string } | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [history, setHistory] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [clipboard, setClipboard] = useState<Node[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reactFlowInstanceRef = useRef<any>(null);
  const pendingImageNodeIdRef = useRef<string | null>(null);

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

  // 选中变化处理
  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedNodes(params.nodes.map(n => n.id));
  }, []);

  // 键盘删除功能
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 删除选中的节点和边
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setNodes((nds) => nds.filter((n) => !n.selected));
        setEdges((eds) => eds.filter((e) => !e.selected));
      }
      // 复制
      if (e.ctrlKey && e.key === 'c' && selectedNodes.length > 0) {
        e.preventDefault();
        const nodesToCopy = nodes.filter((n) => selectedNodes.includes(n.id));
        setClipboard(nodesToCopy);
      }
      // 粘贴
      if (e.ctrlKey && e.key === 'v' && clipboard.length > 0) {
        e.preventDefault();
        const newNodes = clipboard.map((n) => ({
          ...n,
          id: `${n.type}-${Date.now()}-${Math.random()}`,
          position: { x: n.position.x + 50, y: n.position.y + 50 },
          selected: false,
        }));
        setNodes((nds) => [...nds, ...newNodes]);
      }
      // 撤销
      if (e.ctrlKey && e.key === 'z' && historyIndex > 0) {
        e.preventDefault();
        const prevState = history[historyIndex - 1];
        setNodes(prevState.nodes);
        setEdges(prevState.edges);
        setHistoryIndex(historyIndex - 1);
      }
      // 重做
      if (e.ctrlKey && e.key === 'y' && historyIndex < history.length - 1) {
        e.preventDefault();
        const nextState = history[historyIndex + 1];
        setNodes(nextState.nodes);
        setEdges(nextState.edges);
        setHistoryIndex(historyIndex + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, edges, selectedNodes, clipboard, history, historyIndex, setNodes, setEdges]);

  // 保存历史记录
  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push({ nodes, edges });
      if (newHistory.length > 50) newHistory.shift(); // 限制历史记录数量
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [nodes, edges]);

  // 连接节点
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      type: selectedEdgeType,
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed },
    }, eds)),
    [setEdges, selectedEdgeType]
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

  // 右键菜单
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
  }, []);

  // 关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // 右键菜单操作
  const handleContextMenuAction = useCallback((action: string) => {
    if (!contextMenu) return;

    if (action === 'delete') {
      if (contextMenu.nodeId) {
        setNodes((nds) => nds.filter((n) => n.id !== contextMenu.nodeId));
      } else if (contextMenu.edgeId) {
        setEdges((eds) => eds.filter((e) => e.id !== contextMenu.edgeId));
      }
    } else if (action === 'copy' && contextMenu.nodeId) {
      const node = nodes.find((n) => n.id === contextMenu.nodeId);
      if (node) setClipboard([node]);
    } else if (action === 'insertImage' && contextMenu.nodeId) {
      pendingImageNodeIdRef.current = contextMenu.nodeId;
      // 触发文件选择
      fileInputRef.current?.click();
    } else if (action === 'insertCurrentScreenshot' && contextMenu.nodeId) {
      // 插入当前视频截图
      handleInsertCurrentScreenshot(contextMenu.nodeId);
    } else if (action.startsWith('changeEdgeType:') && contextMenu.edgeId) {
      // 修改连线类型
      const newType = action.replace('changeEdgeType:', '') as EdgeType;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === contextMenu.edgeId
            ? { ...e, type: newType }
            : e
        )
      );
    }

    setContextMenu(null);
  }, [contextMenu, nodes, setNodes, setEdges]);

  // 处理图片选择
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetNodeId = pendingImageNodeIdRef.current || contextMenu?.nodeId;
    if (!file || !targetNodeId) {
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

        // 更新节点数据
        setNodes((nds) =>
          nds.map((n) =>
            n.id === targetNodeId
              ? { ...n, data: { ...n.data, url: dataUrl, width: Math.round(width), height: Math.round(height) } }
              : n
          )
        );
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);

    // 清空 input 值，允许重复选择同一文件
    e.target.value = "";
    pendingImageNodeIdRef.current = null;
  }, [contextMenu, setNodes]);

  // 插入当前视频截图
  const handleInsertCurrentScreenshot = useCallback(async (nodeId: string) => {
    try {
      const videoElement = document.querySelector("video");
      if (!videoElement) {
        alert("未找到视频播放器");
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        alert("无法创建画布");
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

      // 更新节点数据
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, url: dataUrl, width: Math.round(width), height: Math.round(height) } }
            : n
        )
      );
    } catch (error) {
      console.error("截图失败:", error);
      alert("截图失败");
    }
  }, [setNodes]);

  // 清理
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // 全屏控制
  const handleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // 全屏切换后重新适配视图
  useEffect(() => {
    if (reactFlowInstanceRef.current) {
      // 延迟执行以确保 DOM 已更新
      setTimeout(() => {
        reactFlowInstanceRef.current?.fitView({ duration: 200 });
      }, 100);
    }
  }, [isFullscreen]);

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

  return (
    <div className={`flex flex-col ${
      isFullscreen
        ? "fixed inset-0 z-50 bg-white dark:bg-slate-900"
        : "h-full"
    }`}>
      {/* React Flow 画布 */}
      <div
        ref={reactFlowWrapper}
        className="flex-1 relative"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          width: '100%',
          height: '100%'
        }}
      >
        {/* 浮动工具栏 */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-2 rounded-xl bg-white/80 dark:bg-slate-800/80 backdrop-blur-md shadow-lg border border-slate-200/50 dark:border-slate-700/50">
          <button
            onClick={() => addNode("textNode")}
            title="文本"
            className={cn(
              "p-2 rounded-lg transition-all cursor-pointer hover:scale-110",
              selectedTool === "textNode"
                ? "bg-blue-500 text-white shadow-md"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            )}
          >
            <Type className="w-5 h-5" />
          </button>
          <button
            onClick={() => addNode("stickyNote")}
            title="便签"
            className={cn(
              "p-2 rounded-lg transition-all cursor-pointer hover:scale-110",
              selectedTool === "stickyNote"
                ? "bg-blue-500 text-white shadow-md"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            )}
          >
            <StickyNoteIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => addNode("imageNode")}
            title="图片"
            className="p-2 rounded-lg transition-all cursor-pointer hover:scale-110 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ImageIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => addNode("markdownNode")}
            title="Markdown"
            className="p-2 rounded-lg transition-all cursor-pointer hover:scale-110 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <FileText className="w-5 h-5" />
          </button>
          <button
            onClick={() => addNode("codeNode")}
            title="代码"
            className="p-2 rounded-lg transition-all cursor-pointer hover:scale-110 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Code className="w-5 h-5" />
          </button>

          {/* 分隔线 */}
          <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />

          <button
            onClick={() => addNode("shapeNode", "rectangle")}
            title="矩形"
            className="p-2 rounded-lg transition-all cursor-pointer hover:scale-110 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Square className="w-5 h-5" />
          </button>
          <button
            onClick={() => addNode("shapeNode", "circle")}
            title="圆形"
            className="p-2 rounded-lg transition-all cursor-pointer hover:scale-110 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Circle className="w-5 h-5" />
          </button>
          <button
            onClick={() => addNode("shapeNode", "diamond")}
            title="菱形"
            className="p-2 rounded-lg transition-all cursor-pointer hover:scale-110 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <Diamond className="w-5 h-5" />
          </button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onSelectionChange={onSelectionChange}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
          }}
          nodeTypes={nodeTypes}
          fitView
          className="bg-slate-50 dark:bg-slate-900"
          deleteKeyCode={null}
        >
          <Background />
          <Controls>
            <button
              onClick={handleFullscreen}
              className="react-flow__controls-button"
              title={isFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Fullscreen className="w-4 h-4" />
              )}
            </button>
          </Controls>
          <MiniMap />
        </ReactFlow>

        {/* 右键菜单 */}
        {contextMenu && (
          <div
            className="fixed bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.nodeId && (
              <>
                {/* 检查是否是图片节点 */}
                {nodes.find(n => n.id === contextMenu.nodeId)?.type === 'imageNode' && (
                  <>
                    <button
                      onClick={() => handleContextMenuAction('insertImage')}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                    >
                      <ImageIcon className="w-4 h-4" />
                      插入图片
                    </button>
                    <button
                      onClick={() => handleContextMenuAction('insertCurrentScreenshot')}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                    >
                      <ImageIcon className="w-4 h-4" />
                      插入当前截图
                    </button>
                    <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                  </>
                )}
                <button
                  onClick={() => handleContextMenuAction('copy')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  复制
                </button>
              </>
            )}
            {contextMenu.edgeId && (
              <>
                <div className="px-4 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  连线类型
                </div>
                {edgeTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleContextMenuAction(`changeEdgeType:${option.value}`)}
                    className={cn(
                      "w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex flex-col",
                      edges.find(e => e.id === contextMenu.edgeId)?.type === option.value
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                        : "text-slate-700 dark:text-slate-200"
                    )}
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{option.description}</span>
                  </button>
                ))}
                <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
              </>
            )}
            <button
              onClick={() => handleContextMenuAction('delete')}
              className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
          </div>
        )}

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />
      </div>
    </div>
  );
}
