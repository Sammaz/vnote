import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Video, Send, Maximize2, Minimize2, Eraser, X, Square, Lightbulb } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../utils/cn";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface UploadedImage {
  id: string;
  file: File;
  previewUrl: string;
}

interface ChatWindowProps {
  noteId: number;
  modelId: number | null;
  noteTitle?: string;
  suggestedQuestions?: string[];
}

interface StreamEvent {
  type: "Start" | "Delta" | "Done";
  message_id?: string;
  content?: string;
  success?: boolean;
  error?: string;
}

interface ImageData {
  data: string; // Base64 encoded with data URL prefix
}

interface ChatRequest {
  note_id: number;
  messages: Array<{ role: string; content: string }>;
  images?: ImageData[];
  use_rag: boolean;
  model_id: number | null;
}

// 最小和最大尺寸限制
const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 900;

// 支持的图片类型
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,image/tiff,image/heic,image/heif,image/avif";

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

export function ChatWindow({ noteId, modelId, noteTitle: _noteTitle, suggestedQuestions = [] }: ChatWindowProps) {
  // 直接使用传入的问题，不再 fallback 到默认问题
  // 如果没有问题（新笔记等待生成），显示空数组
  const questions = suggestedQuestions;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "嗨！请问你想知道点儿什么？",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [basedOnVideo, setBasedOnVideo] = useState(true);
  const [isPopout, setIsPopout] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 420, height: 550 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [showQuestionPopover, setShowQuestionPopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const questionPopoverRef = useRef<HTMLDivElement>(null);
  const questionButtonRef = useRef<HTMLButtonElement>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);
  const popoutRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 清理预览URL
  useEffect(() => {
    return () => {
      uploadedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, []);

  // 点击外部关闭推荐问题 Popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // 检查点击是否在按钮或弹出菜单外部
      const isOutsideButton = questionButtonRef.current && !questionButtonRef.current.contains(target);
      const isOutsidePopover = popoverContentRef.current && !popoverContentRef.current.contains(target);

      if (isOutsideButton && isOutsidePopover) {
        setShowQuestionPopover(false);
      }
    };

    if (showQuestionPopover) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showQuestionPopover]);

  // 初始化弹窗位置
  useEffect(() => {
    if (isPopout && position.x === 0 && position.y === 0) {
      // 设置初始位置为屏幕右下角
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      setPosition({
        x: windowWidth - size.width - 30,
        y: windowHeight - size.height - 50,
      });
    }
  }, [isPopout, position.x, position.y, size.width, size.height]);

  // 拖动处理
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!popoutRef.current) return;

    const rect = popoutRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // 限制在屏幕范围内
      const maxX = window.innerWidth - size.width;
      const maxY = window.innerHeight - 100;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    }

    if (isResizing && resizeDirection) {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      let newX = resizeStart.posX;
      let newY = resizeStart.posY;

      // 根据方向计算新尺寸
      if (resizeDirection.includes("e")) {
        newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStart.width + deltaX));
      }
      if (resizeDirection.includes("w")) {
        const potentialWidth = resizeStart.width - deltaX;
        if (potentialWidth >= MIN_WIDTH && potentialWidth <= MAX_WIDTH) {
          newWidth = potentialWidth;
          newX = resizeStart.posX + deltaX;
        }
      }
      if (resizeDirection.includes("s")) {
        newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStart.height + deltaY));
      }
      if (resizeDirection.includes("n")) {
        const potentialHeight = resizeStart.height - deltaY;
        if (potentialHeight >= MIN_HEIGHT && potentialHeight <= MAX_HEIGHT) {
          newHeight = potentialHeight;
          newY = resizeStart.posY + deltaY;
        }
      }

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    }
  }, [isDragging, isResizing, dragOffset, resizeDirection, resizeStart, size.width]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  // 开始调整大小
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: ResizeDirection) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y,
    });
  }, [size, position]);

  // 添加全局鼠标事件监听
  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: UploadedImage[] = [];

    Array.from(files).forEach((file) => {
      // 检查是否为图片类型
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

    // 重置input以允许选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 删除上传的图片
  const handleRemoveImage = (imageId: string) => {
    setUploadedImages((prev) => {
      const imageToRemove = prev.find((img) => img.id === imageId);
      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.previewUrl);
      }
      return prev.filter((img) => img.id !== imageId);
    });
  };

  // 触发文件选择
  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  // 将文件转换为 Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 停止生成
  const handleStopGeneration = async () => {
    if (currentRequestId) {
      try {
        await invoke("abort_chat", { requestId: currentRequestId });
      } catch (error) {
        console.error("Failed to abort chat:", error);
      }
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && uploadedImages.length === 0) || isStreaming) return;

    // 检查是否选择了模型
    if (!modelId) {
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: "请先在设置中配置 AI 模型，然后在工具栏中选择一个模型。",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    const userContent = input.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userContent,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    // 准备图片数据
    let imageDataArray: ImageData[] | undefined;
    if (uploadedImages.length > 0) {
      imageDataArray = await Promise.all(
        uploadedImages.map(async (img) => ({
          data: await fileToBase64(img.file),
        }))
      );
    }

    // 清除上传的图片
    uploadedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setUploadedImages([]);

    // 创建 assistant 消息占位符
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      },
    ]);

    setIsStreaming(true);

    try {
      // 构建消息历史（不包括刚添加的空 assistant 消息）
      const chatMessages = messages
        .filter((m) => m.id !== "1") // 排除初始欢迎消息
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      // 添加当前用户消息
      chatMessages.push({ role: "user", content: userContent });

      const request: ChatRequest = {
        note_id: noteId,
        messages: chatMessages,
        images: imageDataArray,
        use_rag: basedOnVideo,
        model_id: modelId,
      };

      // 调用流式聊天 API
      const requestId = await invoke<string>("chat_stream", { request });
      setCurrentRequestId(requestId);

      // 监听流式事件
      const unlisten: UnlistenFn = await listen<StreamEvent>(
        `chat-stream-${requestId}`,
        (event) => {
          const data = event.payload;

          if (data.type === "Delta" && data.content) {
            // 追加内容到 assistant 消息
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, content: msg.content + data.content }
                  : msg
              )
            );
          } else if (data.type === "Done") {
            unlisten();
            setIsStreaming(false);
            setCurrentRequestId(null);

            if (!data.success && data.error) {
              // 显示错误
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, content: `错误: ${data.error}` }
                    : msg
                )
              );
            }
          }
        }
      );
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: `错误: ${error}` }
            : msg
        )
      );
      setIsStreaming(false);
      setCurrentRequestId(null);
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    setInput(question);
  };

  const handleToggleQuestionPopover = () => {
    if (!showQuestionPopover && questionButtonRef.current) {
      const rect = questionButtonRef.current.getBoundingClientRect();
      // 计算弹出菜单位置：在按钮上方，左对齐
      setPopoverPosition({
        x: rect.left,
        y: rect.top - 8, // 8px 间距
      });
    }
    setShowQuestionPopover(!showQuestionPopover);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePopout = () => {
    setIsPopout(true);
  };

  const handleMinimize = () => {
    setIsPopout(false);
    // 重置位置，下次弹出时重新计算
    setPosition({ x: 0, y: 0 });
  };

  const handleClearMessages = () => {
    setMessages([
      {
        id: "1",
        role: "assistant",
        content: "嗨！请问你想知道点儿什么？",
        timestamp: new Date(),
      },
    ]);
    // 同时清除上传的图片
    uploadedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setUploadedImages([]);
  };

  // 调整大小的手柄
  const resizeHandles = (
    <>
      {/* 四边 */}
      <div
        className="absolute top-0 left-2 right-2 h-1 cursor-n-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "n")}
      />
      <div
        className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "s")}
      />
      <div
        className="absolute left-0 top-2 bottom-2 w-1 cursor-w-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "w")}
      />
      <div
        className="absolute right-0 top-2 bottom-2 w-1 cursor-e-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "e")}
      />
      {/* 四角 */}
      <div
        className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "nw")}
      />
      <div
        className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "ne")}
      />
      <div
        className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "sw")}
      />
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize hover:bg-blue-500/30"
        onMouseDown={(e) => handleResizeStart(e, "se")}
      />
    </>
  );

  // 聊天窗口内容
  const chatContent = (
    <>
      {/* 头部 */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-vnote-border",
          isPopout && "cursor-move select-none"
        )}
        onMouseDown={isPopout ? handleMouseDown : undefined}
      >
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          聊天窗口
        </span>
        <div className="flex items-center gap-1">
          {/* 清空对话按钮 */}
          <button
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              handleClearMessages();
            }}
            title="清空对话"
          >
            <Eraser className="w-4 h-4" />
          </button>
          {isPopout ? (
            <button
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                handleMinimize();
              }}
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          ) : (
            <button
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded transition-colors cursor-pointer"
              onClick={handlePopout}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 chat-container">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "chat-message flex gap-3",
              message.role === "user" ? "flex-row-reverse" : ""
            )}
          >
            {/* 头像 */}
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                message.role === "assistant"
                  ? "bg-gradient-to-br from-orange-400 to-orange-500"
                  : "bg-gradient-to-br from-blue-500 to-purple-500"
              )}
            >
              {message.role === "assistant" ? (
                <span className="text-white text-xs">AI</span>
              ) : (
                <span className="text-white text-xs">我</span>
              )}
            </div>

            {/* 消息内容 */}
            <div
              className={cn(
                "max-w-[80%] px-4 py-2 rounded-2xl text-sm",
                message.role === "assistant"
                  ? "bg-slate-100 dark:bg-vnote-surface text-slate-700 dark:text-slate-200 rounded-tl-sm"
                  : "bg-blue-500 text-white rounded-tr-sm"
              )}
            >
              {message.role === "assistant" && message.content === "" && isStreaming ? (
                <div className="flex items-center gap-1 py-1">
                  <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce"></span>
                </div>
              ) : message.role === "assistant" ? (
                <div className="chat-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="p-4 border-t border-slate-200 dark:border-vnote-border">
        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* 图片预览区域 */}
        {uploadedImages.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {uploadedImages.map((image) => (
              <div
                key={image.id}
                className="relative group"
              >
                <img
                  src={image.previewUrl}
                  alt="预览"
                  className="w-24 h-24 object-cover rounded-lg border border-slate-200 dark:border-vnote-border"
                />
                <button
                  onClick={() => handleRemoveImage(image.id)}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 dark:bg-slate-600 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 文本输入框 */}
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="你的问题..."
            className="w-full px-4 py-3 bg-slate-50 dark:bg-vnote-surface border border-slate-200 dark:border-vnote-border rounded-xl text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            rows={2}
          />
        </div>
        {/* 底部操作栏 */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={handleAttachClick}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors cursor-pointer"
              title="上传图片"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <button
              onClick={() => setBasedOnVideo(!basedOnVideo)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                basedOnVideo
                  ? "text-cyan-400 border border-cyan-400/50 bg-cyan-400/10"
                  : "text-slate-400 hover:text-slate-300"
              )}
            >
              <Video className="w-4 h-4" />
              {basedOnVideo ? "基于视频" : "不基于视频"}
            </button>
            {/* 推荐问题按钮 + Popover */}
            {questions.length > 0 && (
              <div className="relative" ref={questionPopoverRef}>
                <button
                  ref={questionButtonRef}
                  onClick={handleToggleQuestionPopover}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer",
                    showQuestionPopover
                      ? "text-amber-400 border border-amber-400/50 bg-amber-400/10"
                      : "text-slate-400 hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover"
                  )}
                >
                  <Lightbulb className="w-4 h-4" />
                  <span>推荐问题</span>
                  <span className="ml-0.5 px-1.5 py-0.5 text-xs bg-slate-200 dark:bg-vnote-surface rounded-full">
                    {questions.length}
                  </span>
                </button>
                {/* Popover 内容 - 使用 Portal 渲染到 body 避免被父容器 overflow 裁剪 */}
                {showQuestionPopover && createPortal(
                  <div
                    ref={popoverContentRef}
                    className="w-80 bg-white dark:bg-vnote-card border border-slate-200 dark:border-vnote-border rounded-xl shadow-lg overflow-hidden"
                    style={{
                      position: "fixed",
                      left: popoverPosition.x,
                      top: popoverPosition.y,
                      transform: "translateY(-100%)",
                      zIndex: 9999,
                      animation: "popoverSlideUp 0.2s ease-out",
                    }}
                  >
                    <div className="px-3 py-2 border-b border-slate-200 dark:border-vnote-border">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                        推荐问题
                      </div>
                    </div>
                    <div className="p-2 max-h-64 overflow-y-auto">
                      {questions.map((question, index) => (
                        <button
                          key={index}
                          onClick={() => {
                            handleSuggestedQuestion(question);
                            setShowQuestionPopover(false);
                          }}
                          className="w-full text-left px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors mb-1 last:mb-0 cursor-pointer"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            )}
          </div>
          {isStreaming ? (
            <button
              onClick={handleStopGeneration}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors cursor-pointer"
              title="停止生成"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() && uploadedImages.length === 0}
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-full transition-colors",
                input.trim() || uploadedImages.length > 0
                  ? "bg-slate-700 dark:bg-slate-600 text-white hover:bg-slate-600 dark:hover:bg-slate-500"
                  : "bg-slate-200 dark:bg-vnote-surface text-slate-400 cursor-not-allowed"
              )}
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </>
  );

  // 弹出窗口
  if (isPopout) {
    return (
      <>
        {/* 原位置占位符 */}
        <div
          ref={containerRef}
          className="flex flex-col h-full bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border overflow-hidden items-center justify-center"
        >
          <div className="text-slate-400 dark:text-slate-500 text-sm">
            聊天窗口已弹出
          </div>
          <button
            onClick={handleMinimize}
            className="mt-2 px-3 py-1.5 text-xs text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors cursor-pointer"
          >
            点击收回
          </button>
        </div>

        {/* 弹出窗口 - 使用 Portal 渲染到 body */}
        {createPortal(
          <div
            ref={popoutRef}
            style={{
              position: "fixed",
              left: position.x,
              top: position.y,
              width: size.width,
              height: size.height,
              zIndex: 9999,
            }}
            className={cn(
              "flex flex-col bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border shadow-2xl overflow-hidden",
              isDragging && "cursor-grabbing",
              isResizing && "select-none"
            )}
          >
            {chatContent}
            {/* 调整大小的手柄 */}
            {resizeHandles}
          </div>,
          document.body
        )}
      </>
    );
  }

  // 正常嵌入模式
  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border overflow-hidden"
    >
      {chatContent}
    </div>
  );
}
