import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, X, FileText, Calendar, Video, ArrowUpRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { useCollections } from "../../context/CollectionsContext";

import { parseDetailedReading, parseDetailedReadingData, type Note, type ChapterData, type DetailedReadingData, type SubtitleEntry, type OptimizedSubtitle } from "../../types";
import { assembleChapterMarkdown } from "../../utils/markdownAssembler";

// 从 detailed_reading 中提取第一章的截图路径
function getFirstChapterScreenshot(detailedReading: string | ChapterData | DetailedReadingData | null): string | null {
  if (!detailedReading) return null;
  if (typeof detailedReading === "string") {
    try {
      const parsed = JSON.parse(detailedReading) as ChapterData;
      if (parsed.chapters && Array.isArray(parsed.chapters)) {
        const ch = parsed.chapters.find(c => c.screenshot_path);
        return ch?.screenshot_path || null;
      }
    } catch {
      return null;
    }
  }
  if (typeof detailedReading === "object" && detailedReading.chapters) {
    const ch = detailedReading.chapters.find(c => c.screenshot_path);
    return ch?.screenshot_path || null;
  }
  return null;
}

// 从 full_summary 或章节 content 提取纯文本摘要
function getSnippet(note: Note, maxLen = 80): string {
  // 优先从 full_summary 提取
  if (note.full_summary) {
    let text = note.full_summary;
    // 如果是 JSON，尝试提取 abstract
    if (text.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.abstract) text = parsed.abstract;
      } catch { /* ignore */ }
    }
    // 去除 markdown 标记
    const plain = text.replace(/[#*_`>\[\]()!~|]/g, "").replace(/\n+/g, " ").trim();
    if (plain.length > 0) return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
  }
  // 降级：从章节 content 提取
  const chapterData = parseDetailedReading(note.detailed_reading);
  if (chapterData?.chapters?.length) {
    const plain = chapterData.chapters[0].content.replace(/[#*_`>\[\]()!~|]/g, "").replace(/\n+/g, " ").trim();
    if (plain.length > 0) return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
  }
  return "暂无摘要";
}

// 高亮文本中的搜索关键词（返回 React 元素数组）
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  // split 带捕获组：奇数索引是匹配项
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/30 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

// 递归高亮 React children 中的字符串节点
function highlightChildren(children: React.ReactNode, query: string): React.ReactNode {
  if (!query.trim()) return children;
  if (typeof children === "string") return highlightText(children, query);
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") return <React.Fragment key={i}>{highlightText(child, query)}</React.Fragment>;
      return child;
    });
  }
  return children;
}

// 从思维导图 JSON 节点树中递归提取文本，转为 Markdown 列表
function mindMapNodeToMarkdown(node: any, depth = 0): string {
  if (!node) return "";
  const text = node.data?.text || "";
  const indent = "  ".repeat(depth);
  const prefix = depth === 0 ? "# " : `${indent}- `;
  let md = text ? `${prefix}${text}\n` : "";
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      md += mindMapNodeToMarkdown(child, depth + 1);
    }
  }
  return md;
}

// 提取视觉化总结内容（Markdown 或思维导图 JSON 均支持）
function getVisualContent(note: Note): string | null {
  if (!note.visual_summary) return null;
  if (note.visual_summary.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(note.visual_summary);
      // 有效 JSON = 思维导图数据，转为 Markdown 列表展示
      return mindMapNodeToMarkdown(parsed) || null;
    } catch {
      // 解析失败，当作 Markdown 处理
    }
  }
  return note.visual_summary;
}

// 相对日期格式化
function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ open, onClose }: GlobalSearchModalProps) {
  const { notes, setSelectedNoteId, setCurrentView, refreshNotes } = useApp();
  const { expandCollectionPathForNote } = useCollections();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 搜索过滤：匹配 title、visual_summary、detailed_reading 章节内容
  const filteredNotes = useMemo(() => {
    const sorted = [...notes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    if (!searchQuery.trim()) return sorted;
    const query = searchQuery.toLowerCase().trim();
    return sorted.filter((note) => {
      // 匹配标题
      if (note.title.toLowerCase().includes(query)) return true;
      // 匹配已保存的视觉化总结编辑内容
      if (note.visual_summary?.toLowerCase().includes(query)) return true;
      // 匹配 detailed_reading 章节的 title 和 content
      const chapterData = parseDetailedReading(note.detailed_reading);
      if (chapterData) {
        return chapterData.chapters.some(
          (ch) =>
            ch.title.toLowerCase().includes(query) ||
            ch.content.toLowerCase().includes(query)
        );
      }
      return false;
    });
  }, [notes, searchQuery]);

  // 全局 notes 更新时同步 selectedNote（使 refreshNotes 后预览面板能获取到新数据）
  useEffect(() => {
    if (!selectedNote) return;
    const updated = notes.find(n => n.id === selectedNote.id);
    if (updated && updated !== selectedNote) {
      setSelectedNote(updated);
    }
  }, [notes, selectedNote]);

  // 打开时自动聚焦搜索框
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedNote(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // 选中笔记时，如果 visual_summary 为空但有章节数据和字幕文件，自动初始化视觉化总结
  useEffect(() => {
    if (!selectedNote) return;
    if (selectedNote.visual_summary) return;
    if (!selectedNote.subtitle_path) return;
    const detailedReadingData = parseDetailedReadingData(selectedNote.detailed_reading);
    if (!detailedReadingData || detailedReadingData.chapters.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        // 加载优化后的字幕
        const savedSubtitles = await invoke<OptimizedSubtitle[]>("get_optimized_subtitles", { noteId: selectedNote.id });
        if (cancelled) return;
        const optimizedSubtitles = new Map<string, string>();
        if (savedSubtitles && savedSubtitles.length > 0) {
          savedSubtitles.forEach(s => optimizedSubtitles.set(s.chapter_id, s.optimized_text));
        }

        // 加载原始字幕
        const subtitleEntries = await invoke<SubtitleEntry[]>("parse_subtitle_file", { path: selectedNote.subtitle_path });
        if (cancelled) return;

        // 按照 NoteContentPanel 的标准格式转换章节数据
        const chapterData: ChapterData = {
          chapters: detailedReadingData.chapters.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            start_time: chapter.start_time,
            end_time: chapter.end_time,
            content: "",  // 关键：设为空字符串，避免重复显示内容
            screenshot_path: chapter.screenshot_path,
            level: 1,
            parent_id: null,
          })),
          total_duration: detailedReadingData.total_duration,
          generated_at: detailedReadingData.generated_at,
        };

        const content = assembleChapterMarkdown({
          chapters: chapterData.chapters,
          optimizedSubtitles,
          originalSubtitles: subtitleEntries,
          showTimestamp: true,
        });
        if (!content) return;

        // 保存到数据库
        await invoke("update_note_content", {
          noteId: selectedNote.id,
          tabType: "visual_summary",
          content,
        });
        if (cancelled) return;

        // 刷新全局 notes 状态，使预览面板能获取到新数据
        await refreshNotes();
      } catch (error) {
        console.error("[GlobalSearchModal] 初始化视觉化总结失败:", error);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedNote?.id, selectedNote?.visual_summary, selectedNote?.subtitle_path, selectedNote?.detailed_reading, refreshNotes]);

  // 双击打开笔记
  const handleDoubleClick = useCallback(
    async (noteId: string) => {
      await expandCollectionPathForNote(noteId);
      setSelectedNoteId(noteId);
      setCurrentView("note");
      onClose();
    },
    [expandCollectionPathForNote, setSelectedNoteId, setCurrentView, onClose]
  );

  // 右侧预览：始终展示视觉化总结
  const preview = useMemo(() => {
    if (!selectedNote) return { content: null, isVisual: false };
    const visualMd = getVisualContent(selectedNote);
    if (visualMd) return { content: visualMd, isVisual: true };
    return { content: null, isVisual: false };
  }, [selectedNote]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative flex w-full max-w-5xl mx-4 rounded-2xl shadow-2xl overflow-hidden",
          "bg-white dark:bg-vnote-bg",
          "border border-slate-200/60 dark:border-vnote-border",
          "animate-fade-in"
        )}
        style={{ height: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧面板 */}
        <div className="w-[38%] flex flex-col border-r border-slate-200 dark:border-vnote-border">
          {/* 搜索框 */}
          <div className="flex-shrink-0 p-4 border-b border-slate-200 dark:border-vnote-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索笔记标题或内容..."
                className={cn(
                  "w-full pl-10 pr-20 py-2.5 rounded-xl text-sm",
                  "bg-slate-100 dark:bg-vnote-surface",
                  "border border-slate-200 dark:border-vnote-border",
                  "text-slate-700 dark:text-slate-200",
                  "placeholder:text-slate-400 dark:placeholder:text-slate-500",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50",
                  "transition-all duration-200"
                )}
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200/80 dark:bg-vnote-elevated text-slate-500 dark:text-slate-400 border border-slate-300/50 dark:border-vnote-border">
                  Esc
                </kbd>
              </div>
            </div>
            <div className="mt-2 flex items-center text-xs text-slate-500 dark:text-slate-400">
              {searchQuery.trim() ? (
                <span className="flex items-center gap-1.5">
                  找到
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-blue-500 text-white text-[11px] font-semibold">
                    {filteredNotes.length}
                  </span>
                  条结果
                </span>
              ) : (
                <span>共 {notes.length} 条笔记</span>
              )}
            </div>
          </div>

          {/* 笔记列表 */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {filteredNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-vnote-surface flex items-center justify-center mb-3">
                  <FileText className="w-7 h-7" />
                </div>
                <p className="text-sm font-medium">
                  {searchQuery.trim() ? "未找到匹配的笔记" : "暂无笔记"}
                </p>
                {searchQuery.trim() && (
                  <p className="text-xs mt-1 text-slate-400 dark:text-slate-500">
                    试试其他关键词
                  </p>
                )}
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {filteredNotes.map((note) => {
                  const screenshotPath = getFirstChapterScreenshot(note.detailed_reading);
                  const thumbnailUrl = screenshotPath ? convertFileSrc(screenshotPath) : null;
                  const isSelected = selectedNote?.id === note.id;
                  return (
                    <button
                      key={note.id}
                      onClick={() => setSelectedNote(note)}
                      onDoubleClick={() => handleDoubleClick(note.id)}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded-lg transition-all duration-150 cursor-pointer flex items-center gap-3",
                        isSelected
                          ? "bg-blue-50 dark:bg-blue-600/15 ring-1 ring-blue-500/30 dark:ring-blue-500/25"
                          : "hover:bg-slate-100 dark:hover:bg-vnote-hover"
                      )}
                    >
                      {/* 缩略图 */}
                      <div className="flex-shrink-0 w-14 h-10 rounded-md overflow-hidden bg-slate-100 dark:bg-vnote-surface">
                        {thumbnailUrl ? (
                          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Video className="w-5 h-5 text-slate-400 dark:text-vnote-muted" />
                          </div>
                        )}
                      </div>
                      {/* 文字区域 */}
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          "text-sm font-medium truncate",
                          isSelected
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-slate-700 dark:text-slate-200"
                        )}>
                          {note.title}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 line-clamp-1 mt-0.5">
                          {getSnippet(note)}
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                          <Calendar className="w-3 h-3" />
                          <span>{formatRelativeDate(note.created_at)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右侧面板 */}
        <div className="w-[62%] flex flex-col">
          {/* 标题栏 + 关闭按钮 */}
          <div className="flex-shrink-0 px-5 py-3 border-b border-slate-200 dark:border-vnote-border">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0 mr-3">
                {selectedNote ? (
                  <>
                    <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {highlightText(selectedNote.title, searchQuery)}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          {new Date(selectedNote.created_at).toLocaleDateString("zh-CN", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      {preview.isVisual && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">
                          视觉化总结
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <h3 className="text-sm text-slate-400 dark:text-slate-500">
                    视觉化总结预览
                  </h3>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {selectedNote && (
                  <button
                    onClick={() => handleDoubleClick(selectedNote.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-600/15 transition-colors cursor-pointer"
                  >
                    <span>打开笔记</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* 预览内容 */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 text-slate-700 dark:text-slate-300">
            {!selectedNote ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-vnote-surface flex items-center justify-center mb-4">
                  <Search className="w-8 h-8" />
                </div>
                <p className="text-sm font-medium">选择一条笔记查看视觉化总结</p>
                <p className="text-xs mt-1.5 text-slate-400 dark:text-slate-500">
                  单击选择预览，双击打开笔记
                </p>
              </div>
            ) : !preview.content ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-vnote-surface flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8" />
                </div>
                <p className="text-sm font-medium">该笔记暂无视觉化总结</p>
              </div>
            ) : (
              <div className="note-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={searchQuery.trim() ? {
                    text: ({ children }) => <>{highlightText(String(children), searchQuery)}</>,
                    p: ({ children, ...props }) => <p {...props}>{highlightChildren(children, searchQuery)}</p>,
                    li: ({ children, ...props }) => <li {...props}>{highlightChildren(children, searchQuery)}</li>,
                    td: ({ children, ...props }) => <td {...props}>{highlightChildren(children, searchQuery)}</td>,
                    th: ({ children, ...props }) => <th {...props}>{highlightChildren(children, searchQuery)}</th>,
                  } : undefined}
                >
                  {preview.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
