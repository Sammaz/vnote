import { useState, useRef, useCallback } from "react";
import { Search, FileText, ArrowUpRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../context/AppContext";
import { useCollections } from "../../context/CollectionsContext";
import type { KnowledgeSearchResult } from "./types";

export function KnowledgeBaseSearch() {
  const { setSelectedNoteId, setCurrentView } = useApp();
  const { expandCollectionPathForNote } = useCollections();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    try {
      const res = await invoke<KnowledgeSearchResult[]>("knowledge_base_search", {
        query: q,
      });
      setResults(res);
    } catch (e) {
      console.error("Knowledge base search failed:", e);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleNavigateToNote = async (noteId: string) => {
    await expandCollectionPathForNote(noteId);
    setSelectedNoteId(noteId);
    setCurrentView("note");
  };

  return (
    <div className="flex flex-col h-full p-6">
      {/* Search input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入关键词进行语义搜索..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-slate-800 dark:text-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          autoFocus
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {searching && (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2" />
            搜索中...
          </div>
        )}

        {!searching && searched && results.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            未找到相关内容，请尝试其他关键词
          </div>
        )}

        {!searching && !searched && (
          <div className="text-center py-12 text-slate-400 text-sm">
            输入关键词搜索知识库中的笔记内容
          </div>
        )}

        {results.map((result) => (
          <SearchResultCard
            key={result.chunk_id}
            result={result}
            onNavigate={handleNavigateToNote}
          />
        ))}
      </div>
    </div>
  );
}

function SearchResultCard({
  result,
  onNavigate,
}: {
  result: KnowledgeSearchResult;
  onNavigate: (noteId: string) => void;
}) {
  return (
    <div className="p-4 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/80 hover:border-blue-300 dark:hover:border-blue-600/50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400 truncate max-w-[300px]">
            {result.note_title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {(result.score * 100).toFixed(1)}%
          </span>
          <button
            onClick={() => onNavigate(result.note_id)}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
            title="跳转到笔记"
          >
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed">
        {result.content}
      </p>
    </div>
  );
}
