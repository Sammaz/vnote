import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "../../utils/cn";
import { copyText } from "../../utils/clipboard";

interface MarkdownCodeBlockProps {
  code: string;
  language?: string;
  variant?: "note" | "chat" | "compact";
}

export function MarkdownCodeBlock({
  code,
  language,
  variant = "note",
}: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDarkMode = document.documentElement.classList.contains("dark");
  const normalizedLanguage = language?.trim().toLowerCase() || "text";

  const customStyle = useMemo(() => ({
    margin: 0,
    padding: 0,
    background: "transparent",
    fontSize: variant === "chat" ? "0.8125rem" : "0.875rem",
    lineHeight: 1.6,
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
  }), [variant]);

  const handleCopy = async () => {
    try {
      await copyText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error("复制代码失败:", error);
    }
  };

  return (
    <div className={cn("markdown-code-block group", variant === "chat" && "markdown-code-block-chat")}>
      <div className="markdown-code-block-header flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200/10 dark:border-white/8 bg-slate-900/95 text-slate-300 rounded-t-[inherit]">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {normalizedLanguage}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <div className="markdown-code-block-body overflow-x-auto">
        <SyntaxHighlighter
          language={normalizedLanguage}
          style={isDarkMode ? oneDark : oneLight}
          customStyle={customStyle}
          PreTag="div"
          CodeTag="code"
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
