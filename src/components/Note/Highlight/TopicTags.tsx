/**
 * 主题标签组件 - 显示和筛选主题标签
 */

import { useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../../utils/cn";

interface TopicTagsProps {
  tags: string[];
  selectedTags: Set<string>;
  onTagToggle: (tag: string) => void;
  onClearAll: () => void;
}

export function TopicTags({
  tags,
  selectedTags,
  onTagToggle,
  onClearAll,
}: TopicTagsProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTags = tags.filter((tag) =>
    tag.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (tags.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索标签..."
          className={cn(
            "w-full pl-8 pr-3 py-1.5 text-xs rounded-lg",
            "bg-slate-100 dark:bg-slate-800 border border-transparent",
            "focus:border-blue-300 dark:focus:border-blue-600 focus:outline-none",
            "placeholder:text-slate-400 dark:placeholder:text-slate-500"
          )}
        />
      </div>

      {/* 标签列表 */}
      <div className="flex flex-wrap gap-1.5">
        {selectedTags.size > 0 && (
          <button
            onClick={onClearAll}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs rounded-full cursor-pointer",
              "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400",
              "hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            )}
          >
            <X className="w-3 h-3" />
            清除筛选
          </button>
        )}
        
        {filteredTags.map((tag) => {
          const isSelected = selectedTags.has(tag);
          return (
            <button
              key={tag}
              onClick={() => onTagToggle(tag)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full transition-all duration-200 cursor-pointer",
                isSelected
                  ? "bg-blue-500 text-white shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              )}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {filteredTags.length === 0 && searchQuery && (
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-2">
          未找到匹配的标签
        </p>
      )}
    </div>
  );
}
