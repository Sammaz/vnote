/**
 * ChatWindow - 聊天窗口组件
 * 重构后的模块化版本
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Eraser, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "../../../utils/cn";
import { useGlassBg } from "../../../hooks/useGlassBg";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// 导入子模块
import { DEFAULT_WIDTH, DEFAULT_HEIGHT, type ResizeDirection } from "./constants";
import type { Message, UploadedImage, StreamEvent, ImageData, ChatRequest } from "./types";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { SuggestedQuestionsPopover } from "./SuggestedQuestionsPopover";
import { ResizeHandles } from "./ResizeHandles";

interface ChatWindowProps {
  noteId: string;
  modelId: string | null;
  suggestedQuestions?: string[];
}

export function ChatWindow({ noteId, modelId, suggestedQuestions = [] }: ChatWindowProps) {
  const questions = suggestedQuestions;
  const glassPanel = useGlassBg("panel");

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
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [currentStreamingMessageId, setCurrentStreamingMessageId] = useState<string | null>(null);
  const [showQuestionPopover, setShowQuestionPopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });

  const questionButtonRef = useRef<HTMLButtonElement>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);
  const popoutRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const isStreamingRef = useRef(false);
  // 流式 token 缓冲：避免每个 chunk 都触发数组拷贝 + setState 重渲染
  const streamBufferRef = useRef<{ messageId: string; pending: string } | null>(null);
  const streamFrameRef = useRef<number | null>(null);

  const flushStreamBuffer = useCallback(() => {
    streamFrameRef.current = null;
    const buffer = streamBufferRef.current;
    if (!buffer || !buffer.pending) return;
    const { messageId, pending } = buffer;
    buffer.pending = "";
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, content: msg.content + pending } : msg
      )
    );
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = window.requestAnimationFrame(flushStreamBuffer);
  }, [flushStreamBuffer]);

  // 卸载时取消未完成的 rAF，避免回调在卸载后执行
  useEffect(() => {
    return () => {
      if (streamFrameRef.current !== null) {
        cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
      streamBufferRef.current = null;
    };
  }, []);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

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

      if (resizeDirection.includes("e")) {
        newWidth = Math.min(800, Math.max(320, resizeStart.width + deltaX));
      }
      if (resizeDirection.includes("w")) {
        const potentialWidth = resizeStart.width - deltaX;
        if (potentialWidth >= 320 && potentialWidth <= 800) {
          newWidth = potentialWidth;
          newX = resizeStart.posX + deltaX;
        }
      }
      if (resizeDirection.includes("s")) {
        newHeight = Math.min(900, Math.max(400, resizeStart.height + deltaY));
      }
      if (resizeDirection.includes("n")) {
        const potentialHeight = resizeStart.height - deltaY;
        if (potentialHeight >= 400 && potentialHeight <= 900) {
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

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    e.preventDefault();
    const newImages: UploadedImage[] = imageFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setUploadedImages((prev) => [...prev, ...newImages]);
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

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleStopGeneration = async () => {
    const requestIdToAbort = currentRequestId;
    const messageIdToCheck = currentStreamingMessageId;

    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    if (messageIdToCheck) {
      setMessages((prev) => {
        return prev.map((msg) => {
          if (msg.id === messageIdToCheck) {
            if (msg.content === "" || msg.content.length < 10) {
              return { ...msg, content: "_已取消_" };
            }
          }
          return msg;
        });
      });
    }

    setIsStreaming(false);
    setCurrentRequestId(null);
    setCurrentStreamingMessageId(null);

    if (requestIdToAbort) {
      try {
        await invoke("abort_chat", { requestId: requestIdToAbort });
      } catch (error) {
        console.error("[handleStopGeneration] Failed to abort chat:", error);
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim() && uploadedImages.length === 0) return;
    if (isStreamingRef.current) return;

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

    let imageDataArray: ImageData[] | undefined;
    const userImageUrls: string[] = [];
    if (uploadedImages.length > 0) {
      const encodedImages = await Promise.all(
        uploadedImages.map(async (img) => await fileToBase64(img.file))
      );
      imageDataArray = encodedImages.map((data) => ({ data }));
      userImageUrls.push(...encodedImages);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userContent,
      timestamp: new Date(),
      imageUrls: userImageUrls.length > 0 ? userImageUrls : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    uploadedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setUploadedImages([]);

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
    setCurrentStreamingMessageId(assistantId);

    try {
      const chatMessages = [
        ...messages.filter((m) => m.id !== "1").map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: userContent },
      ];

      const request: ChatRequest = {
        note_id: noteId,
        messages: chatMessages,
        images: imageDataArray,
        use_rag: basedOnVideo,
        model_id: modelId,
      };

      const requestId = await invoke<string>("chat_stream", { request });
      setCurrentRequestId(requestId);

      const unlisten: UnlistenFn = await listen<StreamEvent>(
        `chat-stream-${requestId}`,
        (event) => {
          const data = event.payload;

          if (data.type === "Delta" && data.content) {
            const buffer = streamBufferRef.current;
            if (buffer && buffer.messageId === assistantId) {
              buffer.pending += data.content;
            } else {
              streamBufferRef.current = { messageId: assistantId, pending: data.content };
            }
            scheduleStreamFlush();
          } else if (data.type === "Done") {
            // 在结束前 flush 残余 buffer，确保最后几个 token 被写入
            flushStreamBuffer();
            unlisten();
            unlistenRef.current = null;
            setIsStreaming(false);
            setCurrentRequestId(null);
            setCurrentStreamingMessageId(null);
            streamBufferRef.current = null;

            if (!data.success && data.error) {
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
      unlistenRef.current = unlisten;
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
      setCurrentStreamingMessageId(null);
      unlistenRef.current = null;
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    setInput(question);
  };

  const handleToggleQuestionPopover = () => {
    if (!showQuestionPopover && questionButtonRef.current) {
      const rect = questionButtonRef.current.getBoundingClientRect();
      setPopoverPosition({
        x: rect.left,
        y: rect.top - 8,
      });
    }
    setShowQuestionPopover(!showQuestionPopover);
  };

  const handlePopout = () => {
    setIsPopout(true);
  };

  const handleMinimize = () => {
    setIsPopout(false);
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
    uploadedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setUploadedImages([]);
  };

  // 聊天窗口内容
  const chatContent = (
    <>
      {/* 头部 */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2 border-b border-slate-200/80 dark:border-vnote-border/80",
          glassPanel,
          isPopout && "cursor-move select-none"
        )}
        onMouseDown={isPopout ? handleMouseDown : undefined}
      >
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          聊天窗口
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded transition-colors cursor-pointer"
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
              className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                handleMinimize();
              }}
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          ) : (
            <button
              className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded transition-colors cursor-pointer"
              onClick={handlePopout}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        currentStreamingMessageId={currentStreamingMessageId}
      />

      {/* 输入区域 */}
      <InputArea
        input={input}
        setInput={setInput}
        uploadedImages={uploadedImages}
        basedOnVideo={basedOnVideo}
        setBasedOnVideo={setBasedOnVideo}
        isStreaming={isStreaming}
        onSend={handleSend}
        onStopGeneration={handleStopGeneration}
        onFileSelect={handleFileSelect}
        onRemoveImage={handleRemoveImage}
        onAttachClick={handleAttachClick}
        onPaste={handlePaste}
        fileInputRef={fileInputRef}
        questions={questions}
        questionButtonRef={questionButtonRef}
        onToggleQuestionPopover={handleToggleQuestionPopover}
        showQuestionPopover={showQuestionPopover}
      />

      {/* 推荐问题弹窗 */}
      {showQuestionPopover && questions.length > 0 && (
        <SuggestedQuestionsPopover
          questions={questions}
          position={popoverPosition}
          onSelectQuestion={handleSuggestedQuestion}
          onClose={() => setShowQuestionPopover(false)}
          popoverContentRef={popoverContentRef}
        />
      )}
    </>
  );

  // 弹出窗口
  if (isPopout) {
    return (
      <>
        <div
          ref={containerRef}
          className={cn("flex flex-col h-full rounded-lg border border-slate-200/75 dark:border-vnote-border/80 overflow-hidden shadow-soft items-center justify-center", glassPanel)}
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
              "flex flex-col rounded-lg border border-slate-200/75 dark:border-vnote-border/80 shadow-2xl overflow-hidden",
              glassPanel,
              isDragging && "cursor-grabbing",
              isResizing && "select-none"
            )}
          >
            {chatContent}
            <ResizeHandles onResizeStart={handleResizeStart} />
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
      className={cn("flex flex-col h-full rounded-lg border border-slate-200/75 dark:border-vnote-border/80 overflow-hidden shadow-soft", glassPanel)}
    >
      {chatContent}
    </div>
  );
}
