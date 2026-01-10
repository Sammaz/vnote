import { Search } from "lucide-react";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useApp();

  return (
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜索笔记..."
        className={cn(
          "w-full h-12 pl-12 pr-4 rounded-xl",
          "bg-white dark:bg-vnote-card/80 border border-slate-200 dark:border-vnote-border",
          "text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500",
          "focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20",
          "transition-all duration-200"
        )}
      />
    </div>
  );
}
