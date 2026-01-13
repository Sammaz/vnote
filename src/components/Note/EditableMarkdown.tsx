import { useState, useEffect, useCallback, useMemo } from "react";
import MDEditor from "@uiw/react-md-editor";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type TabType = "full_summary" | "detailed_reading" | "highlights" | "visual_summary" | "custom_summary";

interface EditableMarkdownProps {
  noteId: number;
  tabType: TabType;
  content: string | null;
  isGenerating: boolean;
  emptyMessage?: string;
  isEditMode: boolean;
  onContentUpdate?: (newContent: string) => void;
}

// 时间戳正则：匹配 [00:01:23] 格式
const TIMESTAMP_REGEX = /\[(\d{2}:\d{2}:\d{2})\]/g;

// 将旧的 JSON 格式转换为 Markdown 格式
function convertJsonToMarkdown(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return content;

    // 检查是否是旧的 FullSummaryData 格式
    if (parsed.abstract && parsed.highlights && Array.isArray(parsed.highlights)) {
      let md = "";

      // 摘要
      md += `# 摘要\n${parsed.abstract}\n\n`;

      // 亮点
      md += `# 核心亮点\n\n`;
      for (const item of parsed.highlights) {
        const emoji = item.emoji || '📌';
        md += `## ${emoji} ${item.title}\n${item.description}\n\n`;
      }

      // 问答
      if (parsed.qa_pairs && Array.isArray(parsed.qa_pairs) && parsed.qa_pairs.length > 0) {
        md += `# 疑问解答\n\n`;
        for (const pair of parsed.qa_pairs) {
          md += `**Q: ${pair.question}**\n\nA: ${pair.answer}\n\n`;
        }
      }

      // 思考
      if (parsed.thoughts && Array.isArray(parsed.thoughts) && parsed.thoughts.length > 0) {
        md += `# 思考\n\n`;
        for (const thought of parsed.thoughts) {
          md += `- ${thought}\n`;
        }
        md += `\n`;
      }

      // 术语表
      if (parsed.glossary && Array.isArray(parsed.glossary) && parsed.glossary.length > 0) {
        md += `# 关键术语\n\n`;
        for (const item of parsed.glossary) {
          md += `- **${item.term}**：${item.explanation}\n`;
        }
      }

      return md;
    }

    return content;
  } catch {
    return content;
  }
}

export function EditableMarkdown({
  noteId,
  tabType,
  content,
  isGenerating,
  emptyMessage,
  isEditMode,
  onContentUpdate,
}: EditableMarkdownProps) {
  // 转换 JSON 格式为 Markdown（兼容旧数据）
  const displayContent = useMemo(() => {
    if (!content) return "";
    // 只对全文总结做 JSON 转换
    if (tabType === "full_summary" && content.trim().startsWith("{")) {
      return convertJsonToMarkdown(content);
    }
    return content;
  }, [content, tabType]);

  const [markdown, setMarkdown] = useState(displayContent);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 检测当前主题模式
  const isDarkMode = document.documentElement.classList.contains("dark");

  // 同步外部 content 变化（当不在编辑模式且有新内容时）
  useEffect(() => {
    if (!isEditMode && displayContent !== markdown) {
      setMarkdown(displayContent);
    }
  }, [displayContent, isEditMode, markdown]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await invoke("update_note_content", {
        noteId,
        tabType,
        content: markdown,
      });
      setHasUnsavedChanges(false);
      onContentUpdate?.(markdown);
    } catch (error) {
      setSaveError(`保存失败: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkdownChange = useCallback((value: string | undefined) => {
    const newValue = value || "";
    setMarkdown(newValue);
    setHasUnsavedChanges(newValue !== displayContent);
  }, [displayContent]);

  // 加载状态
  if (isGenerating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">正在生成...</p>
        </div>
      </div>
    );
  }

  // 空状态
  if (!displayContent && !isEditMode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p>{emptyMessage || "暂无内容"}</p>
      </div>
    );
  }

  // 编辑模式
  if (isEditMode) {
    return (
      <div className="h-full flex flex-col -m-6">
        <div className="flex-1 min-h-0">
          <MDEditor
            value={markdown}
            onChange={handleMarkdownChange}
            height="100%"
            preview="live"
            hideToolbar={false}
            visibleDragbar={false}
            data-color-mode={isDarkMode ? "dark" : "light"}
            className="!border-0 !rounded-none"
            textareaProps={{
              placeholder: "在此输入 Markdown 内容...",
            }}
          />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-vnote-border bg-slate-50 dark:bg-vnote-surface">
          <div className="flex items-center gap-3">
            {hasUnsavedChanges && (
              <span className="text-sm text-orange-500 flex items-center gap-1">
                <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                有未保存的更改
              </span>
            )}
            {!hasUnsavedChanges && (
              <span className="text-sm text-slate-500">已保存</span>
            )}
            {saveError && (
              <span className="text-sm text-red-500">{saveError}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMarkdown(displayContent);
                setHasUnsavedChanges(false);
                setSaveError(null);
              }}
              disabled={!hasUnsavedChanges}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              重置
            </button>
            <button
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  保存中...
                </>
              ) : (
                "保存更改"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 预览模式（使用现有的 ReactMarkdown 样式）
  return (
    <div className="note-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 处理标题中的时间戳
          h2: ({ children }) => {
            const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
            return <h2>{renderWithTimestamp(content)}</h2>;
          },
          h3: ({ children }) => {
            const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
            return <h3>{renderWithTimestamp(content)}</h3>;
          },
          // 处理段落中的时间戳
          p: ({ children }) => {
            const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
            return <p>{renderWithTimestamp(content)}</p>;
          },
          // 处理强调文本中的时间戳
          strong: ({ children }) => {
            const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
            return <strong>{renderWithTimestamp(content)}</strong>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

// 渲染带时间戳样式的内容
function renderWithTimestamp(children: React.ReactNode[]): React.ReactNode {
  return children.map((child, index) => {
    if (typeof child === 'string') {
      // 检查是否包含时间戳
      if (TIMESTAMP_REGEX.test(child)) {
        const parts = child.split(TIMESTAMP_REGEX);
        const matches = child.match(TIMESTAMP_REGEX) || [];
        let matchIndex = 0;

        return parts.map((part, partIndex) => {
          // 检查这个部分是否是时间戳（通过与原始匹配对比）
          if (matchIndex < matches.length && matches[matchIndex] === `[${part}]`) {
            matchIndex++;
            return <span key={`${index}-${partIndex}`} className="timestamp">{part}</span>;
          }
          return <span key={`${index}-${partIndex}`}>{part}</span>;
        });
      }
    }
    return <span key={index}>{child}</span>;
  });
}
