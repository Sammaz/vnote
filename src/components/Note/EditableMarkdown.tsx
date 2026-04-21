import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { TableOfContents } from "./TableOfContents";
import { MarkdownRenderer } from "../Markdown/MarkdownRenderer";
import { convertJsonToMarkdown } from "../../utils/markdownUtils";

type TabType = "full_summary" | "detailed_reading" | "highlights" | "visual_summary" | "custom_summary" | "ai_note" | "panoramic_blueprint";

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
          <p className="text-sm text-slate-500 dark:text-slate-400">正在生成...</p>
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

  // 预览模式
  return (
    <div className="relative h-full flex flex-row group">
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 h-full custom-scrollbar">
        <MarkdownRenderer
          content={markdown}
          variant="note"
          headingIdPrefix="doc"
          enableHeadingAnchors
          enableSeekTimestamps
          enableHashtags
          enableLocalImages
          interactiveTaskList
          checkedItems={checkedItems}
          onToggleCheckbox={(currentIndex) => {
            setCheckedItems((prev) => {
              const newSet = new Set(prev);
              if (newSet.has(currentIndex)) {
                newSet.delete(currentIndex);
              } else {
                newSet.add(currentIndex);
              }
              return newSet;
            });
          }}
        />
      </div>
      <TableOfContents markdown={markdown} idPrefix="doc" />
    </div>
  );
}
