/**
 * 视频视觉总结内容组件
 * 将原文细读的章节数据组装为 Markdown 格式并使用 ReactMarkdown 渲染展示
 */

import { useMemo, useEffect, useRef } from "react";
import { BarChart3 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TableOfContents, generateId, getTextFromChildren } from "./TableOfContents";

interface VisualSummaryContentProps {
  isEditMode?: boolean;
  editContent?: string;
  onEditContentChange?: (content: string) => void;
  showTimestamp?: boolean;
  /** 已保存的 Markdown 编辑内容（用户编辑后保存的内容） */
  savedMarkdownContent?: string | null;
}

export function VisualSummaryContent({
  isEditMode = false,
  editContent = "",
  onEditContentChange,
  showTimestamp = true,
  savedMarkdownContent,
}: VisualSummaryContentProps) {
  // 用于生成唯一标题 ID 的计数器（必须在所有条件返回之前声明）
  const slugCountsRef = useRef<Record<string, number>>({});

  // 从数据库字段读取 Markdown 内容
  const markdownContent = useMemo(() => {
    return savedMarkdownContent || "";
  }, [savedMarkdownContent]);

  // 当进入编辑模式且 editContent 为空时，初始化内容
  useEffect(() => {
    if (isEditMode && !editContent && markdownContent && onEditContentChange) {
      onEditContentChange(markdownContent);
    }
  }, [isEditMode, editContent, markdownContent, onEditContentChange]);

  if (!markdownContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-slate-400">
        <BarChart3 className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg mb-2">暂无视觉总结内容</p>
        <p className="text-sm text-center max-w-md">
          请先在「原文细读」标签页生成章节内容，然后返回此页面查看视觉化总结
        </p>
      </div>
    );
  }

  // 编辑模式（仅 Markdown 模式支持）
  if (isEditMode) {
    return (
      <div className="flex flex-col h-full">
        <textarea
          value={editContent}
          onChange={(e) => onEditContentChange?.(e.target.value)}
          className="flex-1 w-full p-4 bg-white dark:bg-vnote-bg text-slate-800 dark:text-slate-200 font-mono text-sm resize-none focus:outline-none border-none"
          placeholder="编辑 Markdown 内容..."
        />
      </div>
    );
  }

  // Reset slug counts before render (technically inside render phase, consistent with React patterns for this use case)
  slugCountsRef.current = {};

  const generateHeaderId = (children: React.ReactNode) => {
    const rawText = getTextFromChildren(children).replace(/\[\d{2}:\d{2}:\d{2}\]/g, "").trim();
    let id = generateId(rawText, "viz");
    // console.log("Viz ID Gen:", { rawText, id }); // Debug
    if (slugCountsRef.current[id]) {
        slugCountsRef.current[id]++;
        id = `${id}-${slugCountsRef.current[id]}`;
    } else {
        slugCountsRef.current[id] = 1;
    }
    return id;
  };

  // Stack component for timestamp and hashtag rendering (copied from EditableMarkdown to ensure consistency)
  const renderWithTimestamp = (children: React.ReactNode[]) => {
    return children.map((child, index) => {
      if (typeof child === 'string') {
        // 合并正则：同时匹配时间戳、章节时间范围和标签
        // match[1]: 时间戳 [00:01:30]
        // match[2]: 章节时间范围 (0:00 - 1:30) 或 (0:00:00 - 1:30:00)
        // match[3]: 标签 #tag
        const combinedRegex = /(\[\d{2}:\d{2}:\d{2}\])|(\(\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\))|(#[^\s]+)/g;

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
              // 章节时间范围匹配 (0:00 - 1:30)
              result.push(
                <span key={`${index}-${partIndex++}`} className="timestamp-range">
                  {matchedText}
                </span>
              );
            } else if (match[3]) {
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
  };

  // Markdown 预览模式
  return (
    <div className="relative h-full flex flex-row group">
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 custom-scrollbar">
        <div className={`note-markdown${showTimestamp ? '' : ' hide-timestamps'}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
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
              p: ({ children }) => {
                const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
                return <p>{renderWithTimestamp(content)}</p>;
              },
              strong: ({ children }) => {
                const content = Array.isArray(children) ? children as React.ReactNode[] : [children];
                return <strong>{renderWithTimestamp(content)}</strong>;
              },
              img: ({ src, alt, ...props }) => {
                return (
                  <span className="flex justify-center items-center w-full my-4">
                    <img
                      src={src}
                      alt={alt}
                      {...props}
                      className="rounded-lg max-w-full h-auto object-contain"
                      style={{ maxHeight: '80vh' }}
                    />
                  </span>
                );
              },
            }}
          >
            {markdownContent}
          </ReactMarkdown>
        </div>
      </div>
      <TableOfContents markdown={markdownContent} idPrefix="viz" />
    </div>
  );
}
