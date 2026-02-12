import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Square,
  FileText,
  ChevronDown,
  Trash2,
  ScrollText,
  Bot,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
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
  const { aiConfigs, promptConfigs, selectedModelId } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  // Model & prompt selection
  const [localModelId, setLocalModelId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const promptDropdownRef = useRef<HTMLDivElement>(null);

  // Sync global selectedModelId as initial value
  useEffect(() => {
    if (selectedModelId && !localModelId) {
      setLocalModelId(selectedModelId);
    }
  }, [selectedModelId, localModelId]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target as Node)
      ) {
        setShowModelDropdown(false);
      }
      if (
        promptDropdownRef.current &&
        !promptDropdownRef.current.contains(e.target as Node)
      ) {
        setShowPromptDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
              updated[updated.length - 1] = {
                ...last,
                content: currentContent,
              };
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

  const activeModel = aiConfigs.find((c) => c.id === localModelId);
  const qaPromptConfigs = promptConfigs.filter((c) => c.category === "qa");
  const activePrompt = qaPromptConfigs.find((c) => c.id === selectedPromptId);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setStreaming(true);

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const request: KnowledgeChatRequest = {
        messages: apiMessages,
        model_id: localModelId || undefined,
        system_prompt: activePrompt?.content || undefined,
      };
      const rid = await invoke<string>("knowledge_base_chat", { request });
      setRequestId(rid);
    } catch (e) {
      setStreaming(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `错误: ${e}` },
      ]);
    }
  }, [input, streaming, messages, localModelId, activePrompt]);

  const handleAbort = useCallback(async () => {
    if (requestId) {
      try {
        await invoke("knowledge_base_abort_chat", { requestId });
      } catch (e) {
        console.error("Failed to abort chat:", e);
      }
    }
  }, [requestId]);

  const handleClearChat = useCallback(() => {
    if (streaming) return;
    setMessages([]);
    setStatusText(null);
  }, [streaming]);

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
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Bot className="w-6 h-6 text-blue-500" />
            </div>
            <div className="text-slate-400 text-sm text-center leading-relaxed">
              基于知识库内容进行对话
              <br />
              <span className="text-xs text-slate-400/70">
                AI 会自动检索相关笔记作为上下文
              </span>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} streaming={streaming} isLast={i === messages.length - 1} />
        ))}

        {statusText && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            {statusText}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-slate-200 dark:border-neutral-700">
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 transition-shadow">
          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行..."
            rows={3}
            className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 resize-none focus:outline-none"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1">
              {/* Model Selector */}
              <div ref={modelDropdownRef} className="relative">
                <button
                  onClick={() => {
                    setShowModelDropdown(!showModelDropdown);
                    setShowPromptDropdown(false);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors cursor-pointer",
                    showModelDropdown
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-700 border border-transparent"
                  )}
                  title="选择 AI 模型"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span className="max-w-[120px] truncate">
                    {activeModel?.title || "选择模型"}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showModelDropdown && (
                  <div className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
                    {aiConfigs.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400">
                        未配置 AI 模型，请在设置中添加
                      </div>
                    ) : (
                      aiConfigs.map((config) => (
                        <button
                          key={config.id}
                          onClick={() => {
                            setLocalModelId(config.id);
                            setShowModelDropdown(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer",
                            config.id === localModelId
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700"
                          )}
                        >
                          <div className="font-medium truncate">
                            {config.title}
                          </div>
                          <div className="text-slate-400 dark:text-slate-500 truncate mt-0.5">
                            {config.model}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Prompt Selector */}
              <div ref={promptDropdownRef} className="relative">
                <button
                  onClick={() => {
                    setShowPromptDropdown(!showPromptDropdown);
                    setShowModelDropdown(false);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors cursor-pointer",
                    selectedPromptId
                      ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                      : showPromptDropdown
                        ? "bg-slate-100 dark:bg-neutral-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-neutral-600"
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-700 border border-transparent"
                  )}
                  title="选择提示词"
                >
                  <ScrollText className="w-3.5 h-3.5" />
                  <span className="max-w-[120px] truncate">
                    {activePrompt?.title || "提示词"}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showPromptDropdown && (
                  <div className="absolute bottom-full left-0 mb-1 w-64 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
                    {/* Clear selection */}
                    <button
                      onClick={() => {
                        setSelectedPromptId(null);
                        setShowPromptDropdown(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer",
                        !selectedPromptId
                          ? "bg-slate-50 dark:bg-neutral-700 text-slate-600 dark:text-slate-300"
                          : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-700"
                      )}
                    >
                      <div className="font-medium">无提示词</div>
                      <div className="text-slate-400 dark:text-slate-500 mt-0.5">
                        使用默认 RAG 对话模式
                      </div>
                    </button>

                    {qaPromptConfigs.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400">
                        未配置提示词，请在设置中添加
                      </div>
                    ) : (
                      qaPromptConfigs.map((prompt) => (
                        <button
                          key={prompt.id}
                          onClick={() => {
                            setSelectedPromptId(prompt.id);
                            setShowPromptDropdown(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer",
                            prompt.id === selectedPromptId
                              ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-700"
                          )}
                        >
                          <div className="font-medium truncate">
                            {prompt.title}
                          </div>
                          {prompt.description && (
                            <div className="text-slate-400 dark:text-slate-500 truncate mt-0.5">
                              {prompt.description}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Clear Chat */}
              {messages.length > 0 && !streaming && (
                <button
                  onClick={handleClearChat}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 rounded-lg transition-colors cursor-pointer border border-transparent"
                  title="清空对话"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Send / Stop */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">
                ⏎ 发送 · ⇧⏎ 换行
              </span>
              {streaming ? (
                <button
                  onClick={handleAbort}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors cursor-pointer"
                  title="停止生成"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer",
                    input.trim()
                      ? "bg-blue-500 hover:bg-blue-600 text-white"
                      : "bg-slate-100 dark:bg-neutral-700 text-slate-400 cursor-not-allowed"
                  )}
                  title="发送"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
  isLast,
}: {
  message: ChatMessage;
  streaming: boolean;
  isLast: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
          isUser
            ? "bg-gradient-to-br from-blue-500 to-purple-500"
            : "bg-gradient-to-br from-orange-400 to-orange-500"
        )}
      >
        <span className="text-white text-[10px] font-medium">
          {isUser ? "我" : "AI"}
        </span>
      </div>

      {/* Content */}
      <div
        className={cn(
          "max-w-[80%] rounded-xl px-4 py-3",
          isUser
            ? "bg-blue-500 text-white rounded-tr-sm"
            : "bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-200 rounded-tl-sm"
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

        {/* Message content */}
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
        ) : message.content ? (
          <div className="text-sm leading-relaxed chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        ) : streaming && isLast ? (
          <div className="flex items-center gap-1 py-1">
            <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce" />
          </div>
        ) : (
          <span className="text-sm text-slate-400 italic">生成中...</span>
        )}
      </div>
    </div>
  );
}
