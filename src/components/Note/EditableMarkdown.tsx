import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TableOfContents, generateId, getTextFromChildren } from "./TableOfContents";
import { convertJsonToMarkdown } from "../../utils/markdownUtils";

type TabType = "full_summary" | "detailed_reading" | "highlights" | "visual_summary" | "custom_summary" | "panoramic_blueprint";

interface EditableMarkdownProps {
  noteId: string;
  tabType: TabType;
  content: string | null;
  isGenerating: boolean;
  emptyMessage?: string;
  isEditMode: boolean;
  onContentUpdate?: (newContent: string) => void;
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
  const prevIsEditMode = useRef(isEditMode);

  // 用于跟踪checkbox选中状态的本地状态（不保存到markdown）
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const checkboxIndexRef = useRef(0);
  const slugCountsRef = useRef<Record<string, number>>({});

  // 当内容变化时重置checkbox状态
  useEffect(() => {
    setCheckedItems(new Set());
  }, [displayContent]);

  // 检测当前主题模式
  const isDarkMode = document.documentElement.classList.contains("dark");

  // Markdown 扩展配置 + 自动换行
  const extensions = useMemo(() => [
    markdownLanguage({ codeLanguages: languages }),
    EditorView.lineWrapping,
  ], []);

  // 退出编辑模式时自动保存
  useEffect(() => {
    // 当从编辑模式退出到预览模式时，保存内容
    if (prevIsEditMode.current && !isEditMode) {
      const saveContent = async () => {
        try {
          await invoke("update_note_content", {
            noteId,
            tabType,
            content: markdown,
          });
          // 保存成功后通知父组件刷新
          onContentUpdate?.(markdown);
        } catch (error) {
          console.error("保存失败:", error);
        }
      };
      saveContent();
    }
    prevIsEditMode.current = isEditMode;
  }, [isEditMode, noteId, tabType, markdown, onContentUpdate]);

  // 同步外部 content 变化（当不在编辑模式且有新内容时）
  useEffect(() => {
    if (!isEditMode && displayContent !== markdown) {
      setMarkdown(displayContent);
    }
  }, [displayContent, isEditMode, markdown]);

  const handleMarkdownChange = useCallback((value: string) => {
    setMarkdown(value);
    // 不再实时更新父组件，只在退出时保存
  }, []);

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

  // 编辑模式 - 使用 CodeMirror 6 + GitHub 主题
  if (isEditMode) {
    return (
      <div className="h-full">
        <CodeMirror
          value={markdown}
          height="100%"
          onChange={handleMarkdownChange}
          extensions={extensions}
          className="cm-editor-vnote"
          basicSetup={{
            lineNumbers: false,
            highlightActiveLineGutter: false,
            highlightSpecialChars: true,
            foldGutter: false,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            searchKeymap: true,
            foldKeymap: false,
            completionKeymap: true,
            lintKeymap: true,
          }}
          theme={isDarkMode ? githubDark : githubLight}
          placeholder="在此输入 Markdown 内容..."
        />
      </div>
    );
  }

  // 预览模式（使用现有的 ReactMarkdown 样式）
  // 在每次渲染前重置checkbox索引和标题ID计数
  checkboxIndexRef.current = 0;
  slugCountsRef.current = {};

  const generateHeaderId = (children: React.ReactNode) => {
    const rawText = getTextFromChildren(children).replace(/\[\d{2}:\d{2}:\d{2}\]/g, "").trim();
    let id = generateId(rawText, "doc");
    if (slugCountsRef.current[id]) {
        slugCountsRef.current[id]++;
        id = `${id}-${slugCountsRef.current[id]}`;
    } else {
        slugCountsRef.current[id] = 1;
    }
    return id;
  };

  return (
    <div className="relative h-full flex flex-row group">
      <div className="note-markdown flex-1 overflow-y-auto overflow-x-hidden px-4 h-full custom-scrollbar">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // 自定义checkbox渲染
            input: ({ node, ...props }) => {
              if (props.type === 'checkbox') {
                const currentIndex = checkboxIndexRef.current++;
                const isChecked = checkedItems.has(currentIndex);

                return (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      setCheckedItems(prev => {
                        const newSet = new Set(prev);
                        if (newSet.has(currentIndex)) {
                          newSet.delete(currentIndex);
                        } else {
                          newSet.add(currentIndex);
                        }
                        return newSet;
                      });
                    }}
                    className="cursor-pointer mr-2"
                  />
                );
              }
              return <input {...props} />;
            },
            // 处理标题中的时间戳并添加ID
            h1: ({ children }) => {
              const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
              const id = generateHeaderId(children);
              return <h1 id={id} style={{ scrollMarginTop: "100px" }} className="scroll-mt-24">{renderWithTimestamp(content)}</h1>;
            },
            h2: ({ children }) => {
              const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
              const id = generateHeaderId(children);
              return <h2 id={id} style={{ scrollMarginTop: "100px" }} className="scroll-mt-24">{renderWithTimestamp(content)}</h2>;
            },
            h3: ({ children }) => {
              const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
              const id = generateHeaderId(children);
              return <h3 id={id} style={{ scrollMarginTop: "100px" }} className="scroll-mt-24">{renderWithTimestamp(content)}</h3>;
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
      <TableOfContents markdown={markdown} idPrefix="doc" />
    </div>
  );
}

// 渲染带时间戳和标签样式的内容
function renderWithTimestamp(children: React.ReactNode[]): React.ReactNode {
  return children.map((child, index) => {
    if (typeof child === 'string') {
      // 合并正则：同时匹配时间戳和标签
      const combinedRegex = /(\[\d{2}:\d{2}:\d{2}\])|(#[^\s]+)/g;

      if (combinedRegex.test(child)) {
        // 重置正则的 lastIndex
        combinedRegex.lastIndex = 0;

        const result: React.ReactNode[] = [];
        let lastIndex = 0;
        let match;
        let partIndex = 0;

        while ((match = combinedRegex.exec(child)) !== null) {
          // 添加匹配前的普通文本
          if (match.index > lastIndex) {
            result.push(
              <span key={`${index}-${partIndex++}`}>
                {child.slice(lastIndex, match.index)}
              </span>
            );
          }

          const matchedText = match[0];

          if (match[1]) {
            // 时间戳匹配 - 提取时间部分（去掉方括号）
            const timeText = matchedText.slice(1, -1);
            result.push(
              <span key={`${index}-${partIndex++}`} className="timestamp">
                {timeText}
              </span>
            );
          } else if (match[2]) {
            // 标签匹配
            result.push(
              <span
                key={`${index}-${partIndex++}`}
                className="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
              >
                {matchedText}
              </span>
            );
          }

          lastIndex = match.index + matchedText.length;
        }

        // 添加剩余的普通文本
        if (lastIndex < child.length) {
          result.push(
            <span key={`${index}-${partIndex++}`}>
              {child.slice(lastIndex)}
            </span>
          );
        }

        return result;
      }
    }
    return <span key={index}>{child}</span>;
  });
}
