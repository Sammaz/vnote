import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Send,
  Square,
  FileText,
  ChevronDown,
  Trash2,
  ScrollText,
  Bot,
  Paperclip,
  X,
  Copy,
  Check,
  Pencil,
  RefreshCw,
  Save,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import type {
  KnowledgeChatEvent,
  KnowledgeChatImageData,
  KnowledgeChatRequest,
  KnowledgeSearchResult,
} from "./types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: KnowledgeSearchResult[];
  imageUrls?: string[];
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface UploadedImage {
  id: string;
  file: File;
  previewUrl: string;
}

const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,image/tiff,image/heic,image/heif,image/avif";

export function KnowledgeBaseChat() {
  const { aiConfigs, promptConfigs, selectedModelId } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [thinkingStage, setThinkingStage] = useState<"searching" | "thinking" | null>(null);

  // Model & prompt selection
  const [localModelId, setLocalModelId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const promptDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image upload state
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);

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
          setThinkingStage("searching");
          setStatusText(data.message);
          break;
        case "ContextFound":
          setThinkingStage("thinking");
          setStatusText(null);
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                sources: data.sources,
              };
            }
            return updated;
          });
          break;
        case "Streaming":
          setThinkingStage(null);
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
          setThinkingStage(null);
          break;
        case "Error":
          setStreaming(false);
          setRequestId(null);
          setStatusText(null);
          setThinkingStage(null);
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
          setThinkingStage(null);
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

  // Image handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: UploadedImage[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        const previewUrl = URL.createObjectURL(file);
        newImages.push({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          previewUrl,
        });
      }
    });

    setUploadedImages((prev) => [...prev, ...newImages]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveImage = (imageId: string) => {
    setUploadedImages((prev) => {
      const imageToRemove = prev.find((img) => img.id === imageId);
      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.previewUrl);
      }
      return prev.filter((img) => img.id !== imageId);
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && uploadedImages.length === 0) || streaming) return;

    // Capture image preview URLs for display in user message
    const currentImageUrls = uploadedImages.map((img) => img.previewUrl);

    // Convert images to base64 before clearing
    let imageDataArray: KnowledgeChatImageData[] | undefined;
    if (uploadedImages.length > 0) {
      imageDataArray = await Promise.all(
        uploadedImages.map(async (img) => ({
          data: await fileToBase64(img.file),
        }))
      );
    }

    setInput("");
    setUploadedImages([]);
    setStreaming(true);
    setThinkingStage("searching");

    const userMsg: ChatMessage = {
      id: generateMessageId(),
      role: "user",
      content: text,
      imageUrls: currentImageUrls.length > 0 ? currentImageUrls : undefined,
    };
    const assistantMsg: ChatMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const apiMessages = [...messages, { role: userMsg.role, content: userMsg.content }].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const request: KnowledgeChatRequest = {
        messages: apiMessages,
        model_id: localModelId || undefined,
        system_prompt: activePrompt?.content || undefined,
        images: imageDataArray,
      };
      const rid = await invoke<string>("knowledge_base_chat", { request });
      setRequestId(rid);
    } catch (e) {
      setStreaming(false);
      setThinkingStage(null);
      setMessages((prev) => [
        ...prev,
        { id: generateMessageId(), role: "assistant", content: `错误: ${e}` },
      ]);
    }
  }, [input, streaming, messages, localModelId, activePrompt, uploadedImages]);

  const handleAbort = useCallback(async () => {
    if (requestId) {
      try {
        await invoke("knowledge_base_abort_chat", { requestId });
      } catch (e) {
        console.error("Failed to abort chat:", e);
      }
    }
    setThinkingStage(null);
  }, [requestId]);

  const handleClearChat = useCallback(() => {
    if (streaming) return;
    setMessages([]);
    setStatusText(null);
    uploadedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setUploadedImages([]);
  }, [streaming, uploadedImages]);

  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const handleEditMessage = useCallback(async (msgId: string, newContent: string, imageUrls?: string[]) => {
    if (streaming) return;

    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex === -1) return;

    const editedMsg: ChatMessage = { ...messages[msgIndex], content: newContent, imageUrls: imageUrls ?? messages[msgIndex].imageUrls };
    const assistantMsg: ChatMessage = { id: generateMessageId(), role: "assistant", content: "" };
    const truncated = [...messages.slice(0, msgIndex), editedMsg, assistantMsg];
    setMessages(truncated);

    setStreaming(true);
    setThinkingStage("searching");
    const apiMessages = [...messages.slice(0, msgIndex), editedMsg].map((m) => ({ role: m.role, content: m.content }));
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
      setThinkingStage(null);
      setMessages((prev) => [
        ...prev,
        { id: generateMessageId(), role: "assistant", content: `错误: ${e}` },
      ]);
    }
  }, [streaming, messages, localModelId, activePrompt]);

  const handleSaveEditMessage = useCallback((msgId: string, newContent: string, imageUrls?: string[]) => {
    if (streaming) return;
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: newContent, imageUrls: imageUrls ?? m.imageUrls } : m));
  }, [streaming]);

  const handleDeleteMessage = useCallback((msgId: string) => {
    if (streaming) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId);
      if (idx === -1) return prev;
      const next = prev[idx + 1];
      if (next && next.role === "assistant") {
        return [...prev.slice(0, idx), ...prev.slice(idx + 2)];
      }
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, [streaming]);

  const handleRegenerateMessage = useCallback(async (msgId: string) => {
    if (streaming) return;

    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex === -1) return;

    const truncated = messages.slice(0, msgIndex + 1);
    const assistantMsg: ChatMessage = { id: generateMessageId(), role: "assistant", content: "" };
    setMessages([...truncated, assistantMsg]);

    setStreaming(true);
    setThinkingStage("searching");
    const apiMessages = truncated.map((m) => ({ role: m.role, content: m.content }));
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
      setThinkingStage(null);
      setMessages((prev) => [
        ...prev,
        { id: generateMessageId(), role: "assistant", content: `错误: ${e}` },
      ]);
    }
  }, [streaming, messages, localModelId, activePrompt]);

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
          <MessageBubble
            key={msg.id}
            message={msg}
            streaming={streaming}
            thinkingStage={thinkingStage}
            isLast={i === messages.length - 1}
            onCopy={handleCopyMessage}
            onEdit={handleEditMessage}
            onSaveEdit={handleSaveEditMessage}
            onDelete={handleDeleteMessage}
            onRegenerate={handleRegenerateMessage}
          />
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
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/70 dark:bg-vnote-card/44 backdrop-blur-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 transition-shadow shadow-soft">
          {/* Image preview */}
          {uploadedImages.length > 0 && (
            <div className="px-4 pt-3 flex flex-wrap gap-2">
              {uploadedImages.map((image) => (
                <div key={image.id} className="relative group">
                  <img
                    src={image.previewUrl}
                    alt="预览"
                    className="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-neutral-600"
                  />
                  <button
                    onClick={() => handleRemoveImage(image.id)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-slate-700 dark:bg-slate-600 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
              {/* Attach Image */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer border border-transparent"
                title="上传图片"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>

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
                  <div className="absolute bottom-full left-0 mb-2 w-56 rounded-2xl border border-white/45 dark:border-vnote-border/80 bg-white/82 dark:bg-vnote-card/58 backdrop-blur-2xl ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.22)] z-50 py-1 max-h-60 overflow-y-auto">
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
                  <div className="absolute bottom-full left-0 mb-2 w-64 rounded-2xl border border-white/45 dark:border-vnote-border/80 bg-white/82 dark:bg-vnote-card/58 backdrop-blur-2xl ring-1 ring-white/30 dark:ring-white/5 shadow-[0_20px_55px_rgba(15,23,42,0.22)] z-50 py-1 max-h-60 overflow-y-auto">
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
                  disabled={!input.trim() && uploadedImages.length === 0}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer",
                    input.trim() || uploadedImages.length > 0
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

function ActionButton({ icon, tooltip, onClick }: { icon: React.ReactNode; tooltip: string; onClick: () => void }) {
  const [showTooltip, setShowTooltip] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="w-6 h-6 flex items-center justify-center rounded text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-600 transition-colors cursor-pointer"
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-slate-800 dark:bg-neutral-600 rounded whitespace-nowrap pointer-events-none z-10">
          {tooltip}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
  thinkingStage,
  isLast,
  onCopy,
  onEdit,
  onSaveEdit,
  onDelete,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming: boolean;
  thinkingStage: "searching" | "thinking" | null;
  isLast: boolean;
  onCopy: (content: string) => void;
  onEdit: (msgId: string, newContent: string, imageUrls?: string[]) => void;
  onSaveEdit: (msgId: string, newContent: string, imageUrls?: string[]) => void;
  onDelete: (msgId: string) => void;
  onRegenerate: (msgId: string) => void;
}) {
  const isUser = message.role === "user";
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [editImages, setEditImages] = useState<UploadedImage[]>([]);
  const [editExistingImageUrls, setEditExistingImageUrls] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const handleCopy = () => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getEditImageUrls = () => [...editExistingImageUrls, ...editImages.map((img) => img.previewUrl)];

  const handleConfirmEdit = () => {
    const trimmed = editContent.trim();
    const urls = getEditImageUrls();
    if (!trimmed && urls.length === 0) return;
    setIsEditing(false);
    cleanupEditImages();
    onEdit(message.id, trimmed, urls.length > 0 ? urls : undefined);
  };

  const handleSaveOnly = () => {
    const trimmed = editContent.trim();
    const urls = getEditImageUrls();
    if (!trimmed && urls.length === 0) return;
    setIsEditing(false);
    cleanupEditImages();
    onSaveEdit(message.id, trimmed, urls.length > 0 ? urls : undefined);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(message.content);
    setEditExistingImageUrls([]);
    cleanupEditImages();
  };

  const handleEditFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newImages: UploadedImage[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        const previewUrl = URL.createObjectURL(file);
        newImages.push({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          previewUrl,
        });
      }
    });
    setEditImages((prev) => [...prev, ...newImages]);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
  };

  const handleRemoveEditImage = (imageId: string) => {
    setEditImages((prev) => {
      const img = prev.find((i) => i.id === imageId);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter((i) => i.id !== imageId);
    });
  };

  const cleanupEditImages = () => {
    editImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setEditImages([]);
  };

  const showActions = isUser && !streaming && !isEditing;

  return (
    <>
      {/* Edit mode - full-width standalone editor */}
      {isUser && isEditing ? (
        <div className="w-full">
          <input
            ref={editFileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            multiple
            onChange={handleEditFileSelect}
            className="hidden"
          />
          <div className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/70 dark:bg-vnote-card/44 backdrop-blur-xl overflow-hidden shadow-soft">
            {/* Image previews - existing + newly uploaded */}
            {(editExistingImageUrls.length > 0 || editImages.length > 0) && (
              <div className="px-4 pt-3 flex flex-wrap gap-2">
                {editExistingImageUrls.map((url, idx) => (
                  <div key={`existing-${idx}`} className="relative group/img">
                    <img
                      src={url}
                      alt="预览"
                      className="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-neutral-600"
                    />
                    <button
                      onClick={() => setEditExistingImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-slate-700 dark:bg-slate-600 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                {editImages.map((image) => (
                  <div key={image.id} className="relative group/img">
                    <img
                      src={image.previewUrl}
                      alt="预览"
                      className="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-neutral-600"
                    />
                    <button
                      onClick={() => handleRemoveEditImage(image.id)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-slate-700 dark:bg-slate-600 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full bg-transparent text-slate-800 dark:text-slate-100 text-sm px-4 pt-3 pb-2 resize-none focus:outline-none min-h-[60px]"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleConfirmEdit();
                }
                if (e.key === "Escape") handleCancelEdit();
              }}
            />
            <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200/60 dark:border-neutral-700/60">
              <button
                onClick={() => editFileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-slate-400 dark:text-neutral-500 hover:text-slate-600 dark:hover:text-neutral-300 hover:bg-slate-200/60 dark:hover:bg-neutral-700/60 transition-colors cursor-pointer"
                title="附件"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCancelEdit}
                  className="p-1.5 rounded-lg text-slate-400 dark:text-neutral-500 hover:text-slate-600 dark:hover:text-neutral-300 hover:bg-slate-200/60 dark:hover:bg-neutral-700/60 transition-colors cursor-pointer"
                  title="取消"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSaveOnly}
                  className="p-1.5 rounded-lg text-slate-400 dark:text-neutral-500 hover:text-slate-600 dark:hover:text-neutral-300 hover:bg-slate-200/60 dark:hover:bg-neutral-700/60 transition-colors cursor-pointer"
                  title="保存"
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  onClick={handleConfirmEdit}
                  className="p-1.5 rounded-lg text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer"
                  title="发送"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
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

          {/* Content wrapper with group for hover */}
          <div className={cn("max-w-[80%] group", isUser ? "flex flex-col items-end" : "flex flex-col items-start")}>
            {/* Bubble */}
            <div
              className={cn(
                "rounded-xl px-4 py-3",
                isUser
                  ? "bg-slate-200 dark:bg-neutral-700 text-slate-800 dark:text-slate-100 rounded-tr-sm"
                  : "bg-white/78 dark:bg-vnote-card/56 backdrop-blur-lg border border-slate-200/80 dark:border-vnote-border/80 text-slate-700 dark:text-slate-200 rounded-tl-sm shadow-soft"
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
                  {message.imageUrls && message.imageUrls.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {message.imageUrls.map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt="附件"
                          className="w-16 h-16 object-cover rounded-lg border border-slate-300 dark:border-neutral-600"
                        />
                      ))}
                    </div>
                  )}
                  {message.content}
                </div>
              ) : message.content ? (
                <div className="text-sm leading-relaxed chat-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              ) : streaming && isLast ? (
                <div className="flex items-center gap-2 py-1 text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce" />
                  </div>
                  <span className="text-xs animate-pulse">
                    {thinkingStage === "searching" ? "检索中..." : "思考中..."}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-slate-400 italic">生成中...</span>
              )}
            </div>

            {/* Action buttons - below bubble, only for user messages */}
            {showActions && (
              <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ActionButton icon={<RefreshCw className="w-3.5 h-3.5" />} tooltip="重新生成" onClick={() => onRegenerate(message.id)} />
                <ActionButton icon={<Pencil className="w-3.5 h-3.5" />} tooltip="编辑" onClick={() => { setIsEditing(true); setEditContent(message.content); setEditExistingImageUrls(message.imageUrls ?? []); }} />
                <ActionButton
                  icon={copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  tooltip={copied ? "已复制" : "复制"}
                  onClick={handleCopy}
                />
                <ActionButton icon={<Trash2 className="w-3.5 h-3.5" />} tooltip="删除" onClick={() => setShowDeleteConfirm(true)} />
              </div>
            )}
          </div>

          {/* Delete confirm dialog */}
          {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-slate-950/34 backdrop-blur-md"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative w-full max-w-md mx-4 p-6 rounded-[24px] border border-white/45 dark:border-vnote-border/80 bg-white/74 dark:bg-vnote-card/46 backdrop-blur-2xl ring-1 ring-white/30 dark:ring-white/5 shadow-[0_24px_70px_rgba(15,23,42,0.26)]">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              确定要删除这条消息吗？
            </h3>
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
              删除后，对应的 AI 回复也会一并移除，且无法撤销。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white/50 dark:bg-white/5 border border-slate-200/80 dark:border-vnote-border/80 hover:bg-white/75 dark:hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete(message.id);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                删除
              </button>
            </div>
          </div>
        </div>,
        document.body
          )}
        </div>
      )}
    </>
  );
}
