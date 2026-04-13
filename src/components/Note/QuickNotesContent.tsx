import { useState, useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import type { Editor } from "@tiptap/core";
import {
  Camera,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Code,
  List,
  ListOrdered,
  ListChecks,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  ChevronDown,
  Undo,
  Redo,
  StickyNote,
  Plus,
  Trash2,
  GripVertical,
  X,
  ExternalLink,
  Unlink,
  Upload,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { message } from "../../utils/message";

interface QuickNotesContentProps {
  noteId: string;
  initialContent: string | null;
  onContentChange?: (content: string) => void;
}

// Block type options
const BLOCK_TYPES = [
  { value: "paragraph", label: "正文" },
  { value: "heading1", label: "标题 1" },
  { value: "heading2", label: "标题 2" },
  { value: "heading3", label: "标题 3" },
  { value: "blockquote", label: "引用" },
  { value: "codeBlock", label: "代码块" },
];

// Table floating menu component
interface TableFloatingMenuProps {
  editor: Editor;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
}

function TableFloatingMenu({ editor, editorContainerRef }: TableFloatingMenuProps) {
  const glassMenu = useGlassBg("menu");
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    tableRect: DOMRect | null;
    columnCount: number;
    rowCount: number;
    currentCol: number;
    currentRow: number;
  }>({
    visible: false,
    tableRect: null,
    columnCount: 0,
    rowCount: 0,
    currentCol: 0,
    currentRow: 0,
  });

  const [activeMenu, setActiveMenu] = useState<{ type: 'column' | 'row'; index: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Update menu position when selection changes
  useEffect(() => {
    const updateMenuPosition = () => {
      if (!editor.isActive("table")) {
        setMenuState(prev => ({ ...prev, visible: false }));
        setActiveMenu(null);
        return;
      }

      const tableNode = editor.view.dom.querySelector("table");
      if (!tableNode || !editorContainerRef.current) {
        setMenuState(prev => ({ ...prev, visible: false }));
        return;
      }

      const tableRect = tableNode.getBoundingClientRect();
      const containerRect = editorContainerRef.current.getBoundingClientRect();

      // Get table dimensions
      const rows = tableNode.querySelectorAll("tr");
      const rowCount = rows.length;
      const columnCount = rows[0]?.querySelectorAll("th, td").length || 0;

      // Get current cell position
      const { $from } = editor.state.selection;
      let currentRow = 0;
      let currentCol = 0;

      // Find current row and column
      const cellPos = $from.before($from.depth);

      // Try to find the row index
      let foundRow = false;
      editor.state.doc.descendants((node, pos, _parent, index) => {
        if (foundRow) return false;
        if (node.type.name === "tableRow") {
          const rowStart = pos;
          const rowEnd = pos + node.nodeSize;
          if (cellPos >= rowStart && cellPos < rowEnd) {
            currentRow = index;
            // Find column index
            let colIndex = 0;
            node.forEach((cell, offset) => {
              const cellStart = pos + 1 + offset;
              const cellEnd = cellStart + cell.nodeSize;
              if (cellPos >= cellStart && cellPos < cellEnd) {
                currentCol = colIndex;
              }
              colIndex++;
            });
            foundRow = true;
            return false;
          }
        }
        return true;
      });

      setMenuState({
        visible: true,
        tableRect: new DOMRect(
          tableRect.left - containerRect.left,
          tableRect.top - containerRect.top,
          tableRect.width,
          tableRect.height
        ),
        columnCount,
        rowCount,
        currentCol,
        currentRow,
      });
    };

    editor.on("selectionUpdate", updateMenuPosition);
    editor.on("update", updateMenuPosition);

    return () => {
      editor.off("selectionUpdate", updateMenuPosition);
      editor.off("update", updateMenuPosition);
    };
  }, [editor, editorContainerRef]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!menuState.visible || !menuState.tableRect) return null;

  const { tableRect, columnCount, rowCount } = menuState;

  // Get column widths from the actual table
  const getColumnWidths = (): number[] => {
    const tableNode = editor.view.dom.querySelector("table");
    if (!tableNode) return Array(columnCount).fill(tableRect.width / columnCount);

    const firstRow = tableNode.querySelector("tr");
    if (!firstRow) return Array(columnCount).fill(tableRect.width / columnCount);

    const cells = firstRow.querySelectorAll("th, td");
    return Array.from(cells).map(cell => cell.getBoundingClientRect().width);
  };

  // Get row heights from the actual table
  const getRowHeights = (): number[] => {
    const tableNode = editor.view.dom.querySelector("table");
    if (!tableNode) return Array(rowCount).fill(36);

    const rows = tableNode.querySelectorAll("tr");
    return Array.from(rows).map(row => row.getBoundingClientRect().height);
  };

  const columnWidths = getColumnWidths();
  const rowHeights = getRowHeights();

  // Calculate column button positions
  const getColumnButtonX = (colIndex: number): number => {
    let x = 0;
    for (let i = 0; i < colIndex; i++) {
      x += columnWidths[i];
    }
    return x + columnWidths[colIndex] / 2;
  };

  // Calculate row button positions
  const getRowButtonY = (rowIndex: number): number => {
    let y = 0;
    for (let i = 0; i < rowIndex; i++) {
      y += rowHeights[i];
    }
    return y + rowHeights[rowIndex] / 2;
  };

  const menuBtnClass = "flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap";

  return (
    <div ref={menuRef} className="pointer-events-none" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
      {/* Column control buttons - on top of each column */}
      {Array.from({ length: columnCount }).map((_, colIndex) => (
        <div
          key={`col-${colIndex}`}
          className="pointer-events-auto absolute"
          style={{
            left: tableRect.left + getColumnButtonX(colIndex) - 10,
            top: tableRect.top - 24,
          }}
        >
          <button
            onClick={() => setActiveMenu(activeMenu?.type === 'column' && activeMenu.index === colIndex ? null : { type: 'column', index: colIndex })}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
            title={`列 ${colIndex + 1} 操作`}
          >
            <GripVertical className="w-3 h-3" />
          </button>
          {activeMenu?.type === 'column' && activeMenu.index === colIndex && (
            <div className={cn("absolute top-full left-1/2 -translate-x-1/2 mt-1 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50 py-1 min-w-[120px]", glassMenu)}>
              <button
                onClick={() => {
                  // Select this column first
                  const tableNode = editor.view.dom.querySelector("table");
                  const cell = tableNode?.querySelectorAll("tr")[0]?.querySelectorAll("th, td")[colIndex];
                  if (cell) {
                    const pos = editor.view.posAtDOM(cell, 0);
                    editor.chain().focus().setTextSelection(pos).run();
                  }
                  editor.chain().focus().addColumnBefore().run();
                  setActiveMenu(null);
                }}
                className={menuBtnClass}
              >
                <Plus className="w-3 h-3" />
                在左侧插入列
              </button>
              <button
                onClick={() => {
                  const tableNode = editor.view.dom.querySelector("table");
                  const cell = tableNode?.querySelectorAll("tr")[0]?.querySelectorAll("th, td")[colIndex];
                  if (cell) {
                    const pos = editor.view.posAtDOM(cell, 0);
                    editor.chain().focus().setTextSelection(pos).run();
                  }
                  editor.chain().focus().addColumnAfter().run();
                  setActiveMenu(null);
                }}
                className={menuBtnClass}
              >
                <Plus className="w-3 h-3" />
                在右侧插入列
              </button>
              <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
              <button
                onClick={() => {
                  const tableNode = editor.view.dom.querySelector("table");
                  const cell = tableNode?.querySelectorAll("tr")[0]?.querySelectorAll("th, td")[colIndex];
                  if (cell) {
                    const pos = editor.view.posAtDOM(cell, 0);
                    editor.chain().focus().setTextSelection(pos).run();
                  }
                  editor.chain().focus().deleteColumn().run();
                  setActiveMenu(null);
                }}
                className={cn(menuBtnClass, "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20")}
              >
                <Trash2 className="w-3 h-3" />
                删除此列
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Row control buttons - on left of each row */}
      {Array.from({ length: rowCount }).map((_, rowIndex) => (
        <div
          key={`row-${rowIndex}`}
          className="pointer-events-auto absolute"
          style={{
            left: tableRect.left - 20,
            top: tableRect.top + getRowButtonY(rowIndex) - 10,
          }}
        >
          <button
            onClick={() => setActiveMenu(activeMenu?.type === 'row' && activeMenu.index === rowIndex ? null : { type: 'row', index: rowIndex })}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
            title={`行 ${rowIndex + 1} 操作`}
          >
            <GripVertical className="w-3 h-3 rotate-90" />
          </button>
          {activeMenu?.type === 'row' && activeMenu.index === rowIndex && (
            <div className={cn("absolute top-1/2 left-full -translate-y-1/2 ml-1 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50 py-1 min-w-[120px]", glassMenu)}>
              <button
                onClick={() => {
                  const tableNode = editor.view.dom.querySelector("table");
                  const cell = tableNode?.querySelectorAll("tr")[rowIndex]?.querySelector("th, td");
                  if (cell) {
                    const pos = editor.view.posAtDOM(cell, 0);
                    editor.chain().focus().setTextSelection(pos).run();
                  }
                  editor.chain().focus().addRowBefore().run();
                  setActiveMenu(null);
                }}
                className={menuBtnClass}
              >
                <Plus className="w-3 h-3" />
                在上方插入行
              </button>
              <button
                onClick={() => {
                  const tableNode = editor.view.dom.querySelector("table");
                  const cell = tableNode?.querySelectorAll("tr")[rowIndex]?.querySelector("th, td");
                  if (cell) {
                    const pos = editor.view.posAtDOM(cell, 0);
                    editor.chain().focus().setTextSelection(pos).run();
                  }
                  editor.chain().focus().addRowAfter().run();
                  setActiveMenu(null);
                }}
                className={menuBtnClass}
              >
                <Plus className="w-3 h-3" />
                在下方插入行
              </button>
              <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
              <button
                onClick={() => {
                  const tableNode = editor.view.dom.querySelector("table");
                  const cell = tableNode?.querySelectorAll("tr")[rowIndex]?.querySelector("th, td");
                  if (cell) {
                    const pos = editor.view.posAtDOM(cell, 0);
                    editor.chain().focus().setTextSelection(pos).run();
                  }
                  editor.chain().focus().deleteRow().run();
                  setActiveMenu(null);
                }}
                className={cn(menuBtnClass, "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20")}
              >
                <Trash2 className="w-3 h-3" />
                删除此行
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Add row button at bottom */}
      <div
        className="pointer-events-auto absolute"
        style={{
          left: tableRect.left + tableRect.width / 2 - 10,
          top: tableRect.top + tableRect.height + 4,
        }}
      >
        <button
          onClick={() => editor.chain().focus().addRowAfter().run()}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
          title="添加行"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Add column button at right */}
      <div
        className="pointer-events-auto absolute"
        style={{
          left: tableRect.left + tableRect.width + 4,
          top: tableRect.top + tableRect.height / 2 - 10,
        }}
      >
        <button
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
          title="添加列"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Delete table button at top right */}
      <div
        className="pointer-events-auto absolute"
        style={{
          left: tableRect.left + tableRect.width + 4,
          top: tableRect.top - 24,
        }}
      >
        <button
          onClick={() => editor.chain().focus().deleteTable().run()}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-500 hover:text-red-500 transition-colors cursor-pointer"
          title="删除表格"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function QuickNotesContent({
  noteId,
  initialContent,
  onContentChange,
}: QuickNotesContentProps) {
  const glassMenu = useGlassBg("menu");
  const glassPanel = useGlassBg("panel");
  const glassInput = useGlassBg("input");
  const [showBlockTypeDropdown, setShowBlockTypeDropdown] = useState(false);
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [showImagePopover, setShowImagePopover] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockTypeDropdownRef = useRef<HTMLDivElement>(null);
  const linkPopoverRef = useRef<HTMLDivElement>(null);
  const imagePopoverRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-500 hover:text-blue-600 underline cursor-pointer",
        },
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: "max-w-full h-auto rounded-lg my-2",
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: "border-collapse table-auto w-full",
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: "border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 px-3 py-2 text-left font-medium",
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: "border border-slate-300 dark:border-slate-600 px-3 py-2",
        },
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: "list-none pl-0",
        },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: "flex items-start gap-2",
        },
      }),
      Placeholder.configure({
        placeholder: "直接输入或粘贴截图，记录你的想法与灵感...",
      }),
    ],
    content: initialContent || "",
    editorProps: {
      attributes: {
        class: "prose prose-slate dark:prose-invert max-w-none focus:outline-none min-h-full p-4",
      },
      handleKeyDown: (view, event) => {
        const { state } = view;
        const { $from, empty } = state.selection;

        // Handle Backspace or Delete key for table deletion
        if (event.key === "Backspace" || event.key === "Delete") {
          // First check: Shift key + inside table = always delete table
          if (event.shiftKey) {
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === "table") {
                const tablePos = $from.before(d);
                const tableNode = $from.node(d);
                view.dispatch(
                  state.tr.delete(tablePos, tablePos + tableNode.nodeSize)
                );
                return true;
              }
            }
          }

          // Second check: Backspace at start of paragraph right after a table
          if (event.key === "Backspace" && empty) {
            // Check if we're at the start of a block
            const parentOffset = $from.parentOffset;
            if (parentOffset === 0) {
              // Look for a table node right before our current position
              const posBefore = $from.before($from.depth);
              if (posBefore > 0) {
                const nodeBefore = state.doc.resolve(posBefore - 1);
                // Check all ancestors of the position before
                for (let d = nodeBefore.depth; d >= 0; d--) {
                  const node = nodeBefore.node(d);
                  if (node.type.name === "table") {
                    const tablePos = nodeBefore.before(d);
                    view.dispatch(
                      state.tr.delete(tablePos, tablePos + node.nodeSize)
                    );
                    return true;
                  }
                }
                // Also check if the node directly before is a table
                const resolvedBefore = state.doc.resolve(posBefore);
                if (resolvedBefore.nodeBefore?.type.name === "table") {
                  const tableNode = resolvedBefore.nodeBefore;
                  const tablePos = posBefore - tableNode.nodeSize;
                  view.dispatch(
                    state.tr.delete(tablePos, posBefore)
                  );
                  return true;
                }
              }
            }
          }

          // Third check: Delete at end of paragraph right before a table
          if (event.key === "Delete" && empty) {
            const parent = $from.parent;
            const parentOffset = $from.parentOffset;
            // Check if we're at the end of the current node
            if (parentOffset === parent.content.size) {
              const posAfter = $from.after($from.depth);
              const resolvedAfter = state.doc.resolve(posAfter);
              if (resolvedAfter.nodeAfter?.type.name === "table") {
                const tableNode = resolvedAfter.nodeAfter;
                view.dispatch(
                  state.tr.delete(posAfter, posAfter + tableNode.nodeSize)
                );
                return true;
              }
            }
          }

          // Fourth check: Inside empty table cell - delete entire table
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === "table") {
              const tablePos = $from.before(d);
              const tableNode = $from.node(d);
              // Only delete if the entire table content is empty
              if (tableNode.textContent === "") {
                view.dispatch(
                  state.tr.delete(tablePos, tablePos + tableNode.nodeSize)
                );
                return true;
              }
              break;
            }
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      handleContentChange(html);
    },
  });

  // Handle external content updates (only when noteId changes, not on every save)
  const prevNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;

    // Only update editor content when switching to a different note
    if (prevNoteIdRef.current !== null && prevNoteIdRef.current !== noteId) {
      const currentContent = editor.getHTML();
      const newContent = initialContent || "";

      // Only update if content actually changed to avoid unnecessary resets
      if (currentContent !== newContent) {
        editor.commands.setContent(newContent);
      }
    }

    prevNoteIdRef.current = noteId;
  }, [editor, noteId, initialContent]);

  // Auto-save with debounce
  const saveContent = useCallback(async (newContent: string) => {
    try {
      await invoke("update_note_content", {
        noteId,
        tabType: "quick_notes",
        content: newContent,
      });
      onContentChange?.(newContent);
    } catch (error) {
      console.error("Failed to save quick notes:", error);
    }
  }, [noteId, onContentChange]);

  // Debounced save
  const handleContentChange = useCallback((newContent: string) => {
    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save (1 second delay)
    saveTimeoutRef.current = setTimeout(() => {
      saveContent(newContent);
    }, 1000);
  }, [saveContent]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (blockTypeDropdownRef.current && !blockTypeDropdownRef.current.contains(event.target as Node)) {
        setShowBlockTypeDropdown(false);
      }
      if (linkPopoverRef.current && !linkPopoverRef.current.contains(event.target as Node)) {
        setShowLinkPopover(false);
      }
      if (imagePopoverRef.current && !imagePopoverRef.current.contains(event.target as Node)) {
        setShowImagePopover(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Insert current screenshot
  const handleInsertScreenshot = useCallback(async () => {
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

      // Get current video time for timestamp
      const currentTime = videoElement.currentTime;
      const hours = Math.floor(currentTime / 3600);
      const minutes = Math.floor((currentTime % 3600) / 60);
      const seconds = Math.floor(currentTime % 60);

      let timestamp: string;
      if (hours > 0) {
        timestamp = `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
      } else {
        timestamp = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      }

      // Convert to data URL (use JPEG for smaller size)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

      // Insert image with timestamp
      if (editor) {
        editor.chain().focus()
          .insertContent(`⏱${timestamp}`)
          .setImage({ src: dataUrl, alt: `截图 ${timestamp}` })
          .run();
      }

      message.success("截图已插入");
    } catch (error) {
      console.error("Screenshot error:", error);
      message.error("截图失败");
    }
  }, [editor]);

  // Get current block type
  const getCurrentBlockType = () => {
    if (!editor) return "paragraph";
    if (editor.isActive("heading", { level: 1 })) return "heading1";
    if (editor.isActive("heading", { level: 2 })) return "heading2";
    if (editor.isActive("heading", { level: 3 })) return "heading3";
    if (editor.isActive("blockquote")) return "blockquote";
    if (editor.isActive("codeBlock")) return "codeBlock";
    return "paragraph";
  };

  // Handle block type change
  const handleBlockTypeChange = (type: string) => {
    if (!editor) return;

    switch (type) {
      case "heading1":
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case "heading2":
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case "heading3":
        editor.chain().focus().toggleHeading({ level: 3 }).run();
        break;
      case "blockquote":
        editor.chain().focus().toggleBlockquote().run();
        break;
      case "codeBlock":
        editor.chain().focus().toggleCodeBlock().run();
        break;
      default:
        editor.chain().focus().setParagraph().run();
    }
    setShowBlockTypeDropdown(false);
  };

  // Open link popover
  const handleOpenLinkPopover = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setShowLinkPopover(true);
    setShowImagePopover(false);
  };

  // Apply link
  const handleApplyLink = () => {
    if (!editor) return;
    if (linkUrl === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: linkUrl }).run();
    }
    setShowLinkPopover(false);
    setLinkUrl("");
  };

  // Remove link
  const handleRemoveLink = () => {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
    setShowLinkPopover(false);
    setLinkUrl("");
  };

  // Open image popover
  const handleOpenImagePopover = () => {
    setImageUrl("");
    setShowImagePopover(true);
    setShowLinkPopover(false);
  };

  // Apply image
  const handleApplyImage = () => {
    if (!editor || !imageUrl) return;
    editor.chain().focus().setImage({ src: imageUrl }).run();
    setShowImagePopover(false);
    setImageUrl("");
  };

  // Select local image file
  const handleSelectLocalImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: "图片文件",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]
        }]
      });

      if (selected && typeof selected === "string") {
        // Read file as base64
        const fileData = await readFile(selected);
        const base64 = btoa(
          new Uint8Array(fileData).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        // Determine MIME type from extension
        const ext = selected.split(".").pop()?.toLowerCase() || "png";
        const mimeTypes: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          bmp: "image/bmp",
          svg: "image/svg+xml"
        };
        const mimeType = mimeTypes[ext] || "image/png";

        const dataUrl = `data:${mimeType};base64,${base64}`;

        if (editor) {
          editor.chain().focus().setImage({ src: dataUrl }).run();
        }

        setShowImagePopover(false);
        message.success("图片已插入");
      }
    } catch (error) {
      console.error("Failed to select image:", error);
      message.error("选择图片失败");
    }
  };

  // Insert table
  const handleInsertTable = () => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  // Toolbar button style
  const toolbarBtnClass = (isActive: boolean = false) => cn(
    "p-2 rounded transition-colors cursor-pointer",
    isActive
      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-vnote-hover"
  );

  if (!editor) {
    return null;
  }

  const currentBlockType = getCurrentBlockType();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-vnote-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
            <StickyNote className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">随手笔记</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              支持截图（粘贴/上传），自动保存，无需手动提交。
            </p>
          </div>
        </div>
        <button
          onClick={handleInsertScreenshot}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 rounded-lg transition-all cursor-pointer shadow-sm"
        >
          <Camera className="w-4 h-4" />
          插入当前截图
        </button>
      </div>

      {/* Toolbar */}
      <div className={cn("flex items-center gap-1 px-4 py-2 border-b border-slate-200 dark:border-vnote-border", glassPanel)}>
        {/* Undo/Redo */}
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className={cn(toolbarBtnClass(), "disabled:opacity-40 disabled:cursor-not-allowed")}
          title="撤销"
        >
          <Undo className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className={cn(toolbarBtnClass(), "disabled:opacity-40 disabled:cursor-not-allowed")}
          title="重做"
        >
          <Redo className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

        {/* Text formatting */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={toolbarBtnClass(editor.isActive("bold"))}
          title="粗体"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={toolbarBtnClass(editor.isActive("italic"))}
          title="斜体"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={toolbarBtnClass(editor.isActive("underline"))}
          title="下划线"
        >
          <UnderlineIcon className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={toolbarBtnClass(editor.isActive("code"))}
          title="行内代码"
        >
          <Code className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

        {/* List formatting */}
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={toolbarBtnClass(editor.isActive("bulletList"))}
          title="无序列表"
        >
          <List className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={toolbarBtnClass(editor.isActive("orderedList"))}
          title="有序列表"
        >
          <ListOrdered className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={toolbarBtnClass(editor.isActive("taskList"))}
          title="任务列表"
        >
          <ListChecks className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

        {/* Block type dropdown */}
        <div className="relative" ref={blockTypeDropdownRef}>
          <button
            onClick={() => setShowBlockTypeDropdown(!showBlockTypeDropdown)}
            className={cn(toolbarBtnClass(), "flex items-center gap-1 px-2 min-w-[80px] justify-between")}
          >
            <span className="text-sm">{BLOCK_TYPES.find(t => t.value === currentBlockType)?.label || "正文"}</span>
            <ChevronDown className={cn("w-3 h-3 transition-transform", showBlockTypeDropdown && "rotate-180")} />
          </button>
          {showBlockTypeDropdown && (
            <div className={cn("absolute top-full left-0 mt-1 w-32 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50 py-1", glassMenu)}>
              {BLOCK_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => handleBlockTypeChange(type.value)}
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer",
                    currentBlockType === type.value
                      ? "text-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "text-slate-700 dark:text-slate-300"
                  )}
                >
                  {type.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />

        {/* Link button with popover */}
        <div className="relative" ref={linkPopoverRef}>
          <button
            onClick={handleOpenLinkPopover}
            className={toolbarBtnClass(editor.isActive("link"))}
            title="插入链接"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          {showLinkPopover && (
            <div className={cn("absolute top-full left-0 mt-2 w-80 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden", glassMenu)}>
              <div className={cn("flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700", glassPanel)}>
                <div className="flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">插入链接</span>
                </div>
                <button
                  onClick={() => setShowLinkPopover(false)}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">链接地址</label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleApplyLink()}
                    placeholder="https://example.com"
                    className={cn("w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all", glassInput)}
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  {editor.isActive("link") && (
                    <button
                      onClick={handleRemoveLink}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      移除链接
                    </button>
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      onClick={() => setShowLinkPopover(false)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleApplyLink}
                      disabled={!linkUrl}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      应用
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Image button with popover */}
        <div className="relative" ref={imagePopoverRef}>
          <button
            onClick={handleOpenImagePopover}
            className={toolbarBtnClass()}
            title="插入图片"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          {showImagePopover && (
            <div className={cn("absolute top-full left-0 mt-2 w-80 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden", glassMenu)}>
              <div className={cn("flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700", glassPanel)}>
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">插入图片</span>
                </div>
                <button
                  onClick={() => setShowImagePopover(false)}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {/* Local file upload */}
                <button
                  onClick={handleSelectLocalImage}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all cursor-pointer group"
                >
                  <Upload className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    选择本地图片
                  </span>
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-600" />
                  <span className="text-xs text-slate-400">或</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-600" />
                </div>

                {/* URL input */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">图片地址</label>
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleApplyImage()}
                    placeholder="https://example.com/image.jpg"
                    className={cn("w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all", glassInput)}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setShowImagePopover(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleApplyImage}
                    disabled={!imageUrl}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    插入图片
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Table button - simple insert only */}
        <button
          onClick={handleInsertTable}
          className={toolbarBtnClass(editor.isActive("table"))}
          title="插入表格"
        >
          <TableIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Editor area with table floating menu */}
      <div className="flex-1 overflow-y-auto relative" ref={editorContainerRef}>
        <EditorContent editor={editor} className="h-full" />
        <TableFloatingMenu editor={editor} editorContainerRef={editorContainerRef} />
      </div>

      {/* TipTap styles */}
      <style>{`
        .ProseMirror {
          min-height: 100%;
          padding: 2rem 2.5rem 2rem 2.5rem;
        }
        .ProseMirror:focus {
          outline: none;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9ca3af;
          pointer-events: none;
          height: 0;
        }
        .ProseMirror h1 {
          font-size: 1.875rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
        }
        .ProseMirror h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }
        .ProseMirror h3 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }
        .ProseMirror p {
          margin-bottom: 0.75rem;
        }
        .ProseMirror ul, .ProseMirror ol {
          padding-left: 1.5rem;
          margin-bottom: 0.75rem;
        }
        .ProseMirror ul {
          list-style-type: disc;
        }
        .ProseMirror ol {
          list-style-type: decimal;
        }
        .ProseMirror ul[data-type="taskList"] {
          list-style-type: none;
          padding-left: 0;
        }
        .ProseMirror ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
        }
        .ProseMirror ul[data-type="taskList"] li > label {
          flex-shrink: 0;
          margin-top: 0.25rem;
        }
        .ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"] {
          width: 1rem;
          height: 1rem;
          cursor: pointer;
        }
        .ProseMirror blockquote {
          border-left: 3px solid #3b82f6;
          padding-left: 1rem;
          margin-left: 0;
          margin-bottom: 0.75rem;
          color: #6b7280;
        }
        .ProseMirror pre {
          background: #1e293b;
          color: #e2e8f0;
          padding: 1rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin-bottom: 0.75rem;
        }
        .ProseMirror code {
          background: #f1f5f9;
          color: #dc2626;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875rem;
        }
        .dark .ProseMirror code {
          background: #334155;
          color: #f87171;
        }
        .ProseMirror pre code {
          background: none;
          color: inherit;
          padding: 0;
        }
        .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 0.5rem 0;
        }
        .ProseMirror table {
          border-collapse: collapse;
          width: calc(100% - 48px);
          margin: 0.75rem 24px;
        }
        .ProseMirror th, .ProseMirror td {
          border: 1px solid #e2e8f0;
          padding: 0.5rem 0.75rem;
          text-align: left;
          position: relative;
        }
        .dark .ProseMirror th, .dark .ProseMirror td {
          border-color: #475569;
        }
        .ProseMirror th {
          background: #f8fafc;
          font-weight: 600;
        }
        .dark .ProseMirror th {
          background: #334155;
        }
        .ProseMirror .selectedCell {
          background: #dbeafe;
        }
        .dark .ProseMirror .selectedCell {
          background: #1e3a5f;
        }
        .ProseMirror .selectedCell:after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          border: 2px solid #3b82f6;
        }
        .ProseMirror a {
          color: #3b82f6;
          text-decoration: underline;
        }
        .ProseMirror a:hover {
          color: #2563eb;
        }
        .ProseMirror .tableWrapper {
          overflow: visible;
          padding-top: 28px;
          padding-bottom: 28px;
          margin-top: -4px;
        }
        .ProseMirror .resize-cursor {
          cursor: col-resize;
        }
      `}</style>
    </div>
  );
}
