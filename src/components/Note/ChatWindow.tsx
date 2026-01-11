import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Video } from "lucide-react";
import { cn } from "../../utils/cn";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatWindowProps {
  noteTitle?: string;
  suggestedQuestions?: string[];
}

const DEFAULT_QUESTIONS = [
  "这个视频的核心内容是什么?",
  "有哪些关键知识点?",
  "如何在实际项目中应用?",
];

export function ChatWindow({ noteTitle: _noteTitle, suggestedQuestions = [] }: ChatWindowProps) {
  // 使用数据库中的问题，如果没有则使用默认问题
  const questions = suggestedQuestions.length > 0 ? suggestedQuestions : DEFAULT_QUESTIONS;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "嗨！请问你想知道点儿什么？",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    // 模拟 AI 回复
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "这是一个模拟的 AI 回复。实际功能将在后续版本中实现。",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }, 1000);
  };

  const handleSuggestedQuestion = (question: string) => {
    setInput(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-vnote-card rounded-lg border border-slate-200 dark:border-vnote-border overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center px-4 py-2 border-b border-slate-200 dark:border-vnote-border">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          聊天窗口
        </span>
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
              {message.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 建议问题 */}
      <div className="px-4 py-2 border-t border-slate-200 dark:border-vnote-border">
        <div className="flex flex-wrap gap-2">
          {questions.map((question, index) => (
            <button
              key={index}
              onClick={() => handleSuggestedQuestion(question)}
              className="suggestion-tag px-3 py-1.5 text-xs bg-slate-100 dark:bg-vnote-surface text-slate-600 dark:text-slate-400 rounded-full hover:bg-slate-200 dark:hover:bg-vnote-hover hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              {question}
            </button>
          ))}
        </div>
      </div>

      {/* 输入区域 */}
      <div className="p-4 border-t border-slate-200 dark:border-vnote-border">
        <div className="flex items-center gap-2">
          <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-vnote-hover rounded-lg transition-colors">
            <Paperclip className="w-5 h-5" />
          </button>
          <button className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-500 bg-blue-50 dark:bg-blue-500/10 rounded-full hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors">
            <Video className="w-3.5 h-3.5" />
            基于视频
          </button>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="你的问题..."
              className="w-full px-4 py-3 bg-slate-50 dark:bg-vnote-surface border border-slate-200 dark:border-vnote-border rounded-xl text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              rows={1}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={cn(
              "p-3 rounded-xl transition-colors",
              input.trim()
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "bg-slate-200 dark:bg-vnote-surface text-slate-400 cursor-not-allowed"
            )}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
