import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "../../utils/cn";
import type {
  KnowledgeChatEvent,
  KnowledgeChatRequest,
  KnowledgeSearchResult,
} from "./types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: KnowledgeSearchResult[];
}

export function KnowledgeBaseChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusText]);

  // Listen to chat events
  useEffect(() => {
    if (!requestId) return;

    const eventName = `knowledge-chat-${requestId}`;
    let currentContent = "";

    const unlisten = listen<KnowledgeChatEvent>(eventName, (event) => {
      const data = event.payload;

      switch (data.status) {
        case "Searching":
          setStatusText(data.message);
          break;
        case "ContextFound":
          setStatusText(null);
          // Store sources for the upcoming assistant message
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "", sources: data.sources },
          ]);
          break;
        case "Streaming":
          currentContent += data.content;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: currentContent };
            }
            return updated;
          });
          break;
        case "Completed":
          setStreaming(false);
          setRequestId(null);
          setStatusText(null);
          break;
        case "Error":
          setStreaming(false);
          setRequestId(null);
          setStatusText(null);
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: `错误: ${data.error}`,
              };
            }
            return updated;
          });
          break;
        case "Aborted":
          setStreaming(false);
          setRequestId(null);
          setStatusText(null);
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [requestId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setStreaming(true);

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    // Build request with conversation history
    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const rid = await invoke<string>("knowledge_base_chat", {
        request: { messages: apiMessages } as KnowledgeChatRequest,
      });
      setRequestId(rid);
    } catch (e) {
      setStreaming(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `错误: ${e}` },
      ]);
    }
  }, [input, streaming, messages]);

  const handleAbort = useCallback(async () => {
    if (requestId) {
      try {
        await invoke("knowledge_base_abort_chat", { requestId });
      } catch (e) {
        console.error("Failed to abort chat:", e);
      }
    }
  }, [requestId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && !statusText && (
          <div className="text-center py-16 text-slate-400 text-sm">
            基于知识库内容进行对话，AI 会自动检索相关笔记作为上下文
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {statusText && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            {statusText}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-200 dark:border-neutral-700">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题..."
            rows={1}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-slate-800 dark:text-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
          />
          {streaming ? (
            <button
              onClick={handleAbort}
              className="p-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors cursor-pointer"
              title="停止生成"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className={cn(
                "p-2.5 rounded-lg transition-colors cursor-pointer",
                input.trim()
                  ? "bg-blue-500 hover:bg-blue-600 text-white"
                  : "bg-slate-200 dark:bg-neutral-700 text-slate-400 cursor-not-allowed"
              )}
              title="发送"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-xl px-4 py-3",
          isUser
            ? "bg-blue-500 text-white"
            : "bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-200"
        )}
      >
        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mb-2 pb-2 border-b border-slate-100 dark:border-neutral-700">
            <div className="text-xs text-slate-400 mb-1">引用来源:</div>
            <div className="flex flex-wrap gap-1">
              {message.sources.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-xs text-blue-600 dark:text-blue-400"
                >
                  <FileText className="w-3 h-3" />
                  {s.note_title}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {message.content || (
            <span className="text-slate-400 italic">生成中...</span>
          )}
        </div>
      </div>
    </div>
  );
}
