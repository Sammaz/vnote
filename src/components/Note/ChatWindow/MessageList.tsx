/**
 * 消息列表组件
 */

import { useRef, useEffect } from "react";
import { cn } from "../../../utils/cn";
import { MarkdownRenderer } from "../../Markdown/MarkdownRenderer";
import type { Message } from "./types";

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  currentStreamingMessageId: string | null;
}

export function MessageList({
  messages,
  isStreaming,
  currentStreamingMessageId,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
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
            {message.role === "assistant" && message.content === "" && isStreaming && message.id === currentStreamingMessageId ? (
              <div className="flex items-center gap-1 py-1">
                <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-2 h-2 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce"></span>
              </div>
            ) : message.role === "assistant" ? (
              <MarkdownRenderer
                content={message.content}
                variant="chat"
              />
            ) : (
              <span className="whitespace-pre-wrap">{message.content}</span>
            )}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
