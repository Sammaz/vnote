/**
 * NotesContext - 笔记数据管理
 * 从 AppContext 拆分，减少不必要的重渲染
 */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Note, CreateNoteRequest, UpdateNoteMetadataRequest, ViewType, AppStats } from "../types";
import { getNoteGenerationState, getActiveGenerationIds, clearNoteGenerationState } from "../utils/noteGenerationState";

interface NotesContextType {
  notes: Note[];
  refreshNotes: () => Promise<void>;
  refreshNoteById: (noteId: string) => Promise<void>;
  createNote: (req: CreateNoteRequest) => Promise<Note>;
  updateNote: (req: UpdateNoteMetadataRequest) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  updateNoteSuggestedQuestions: (noteId: string, questions: string[]) => void;

  // 生成状态
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;

  // 搜索
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // 视图
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;

  // 统计更新回调
  updateStats: (notesList: Note[]) => void;
}

const NotesContext = createContext<NotesContextType | null>(null);

interface NotesProviderProps {
  children: ReactNode;
  onStatsUpdate?: (stats: Partial<AppStats>) => void;
  /** 删除笔记前的回调（用于清理初始化运行任务等） */
  onBeforeNoteDelete?: (noteId: string) => Promise<void>;
}

export function NotesProvider({ children, onStatsUpdate, onBeforeNoteDelete }: NotesProviderProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentView, setCurrentView] = useState<ViewType>("home");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const latestRefreshRequestIdRef = useRef(0);

  // 更新统计
  const updateStats = useCallback((notesList: Note[]) => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const notesThisWeek = notesList.filter(note => {
      const createdAt = new Date(note.created_at);
      return createdAt >= startOfWeek;
    }).length;

    let lastActivityDate: Date | null = null;
    if (notesList.length > 0) {
      const latestNote = notesList.reduce((latest, note) => {
        const noteDate = new Date(note.updated_at);
        const latestDate = new Date(latest.updated_at);
        return noteDate > latestDate ? note : latest;
      });
      lastActivityDate = new Date(latestNote.updated_at);
    }

    onStatsUpdate?.({
      totalNotes: notesList.length,
      notesThisWeek,
      lastActivityDate,
    });
  }, [onStatsUpdate]);

  // 加载笔记列表
  const refreshNotes = useCallback(async () => {
    const requestId = ++latestRefreshRequestIdRef.current;

    try {
      const notesList = await invoke<Note[]>("get_notes");
      if (requestId !== latestRefreshRequestIdRef.current) {
        return;
      }
      setNotes(notesList);
      updateStats(notesList);
    } catch (error) {
      if (requestId !== latestRefreshRequestIdRef.current) {
        return;
      }
      console.error("Failed to load notes:", error);
    }
  }, [updateStats]);

  const refreshNoteById = useCallback(async (noteId: string) => {
    if (!noteId) return;

    try {
      const latestNote = await invoke<Note | null>("get_note", { id: noteId });
      setNotes(prev => {
        if (!latestNote) {
          const nextNotes = prev.filter(note => note.id !== noteId);
          updateStats(nextNotes);
          return nextNotes;
        }

        const existingIndex = prev.findIndex(note => note.id === noteId);
        let nextNotes: Note[];

        if (existingIndex >= 0) {
          nextNotes = [...prev];
          nextNotes[existingIndex] = latestNote;
        } else {
          nextNotes = [latestNote, ...prev];
        }

        nextNotes.sort((a, b) => {
          const createdAtDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          if (createdAtDiff !== 0) {
            return createdAtDiff;
          }
          return b.id.localeCompare(a.id);
        });

        updateStats(nextNotes);
        return nextNotes;
      });
    } catch (error) {
      console.error(`Failed to refresh note ${noteId}:`, error);
    }
  }, [updateStats]);
  const createNote = useCallback(async (req: CreateNoteRequest): Promise<Note> => {
    const newNote = await invoke<Note>("create_note", { req });
    setNotes(prev => {
      const nextNotes = [newNote, ...prev];
      updateStats(nextNotes);
      return nextNotes;
    });
    return newNote;
  }, [updateStats]);

  // 更新笔记元数据
  const updateNote = useCallback(async (req: UpdateNoteMetadataRequest): Promise<void> => {
    await invoke("update_note_metadata", { req });
    await refreshNotes();
  }, [refreshNotes]);

  // 删除笔记
  const deleteNote = useCallback(async (id: string): Promise<void> => {
    // 先调用删除前回调（清理初始化运行任务等）
    if (onBeforeNoteDelete) {
      await onBeforeNoteDelete(id);
    }

    // 获取笔记所有活动的生成任务
    const activeIds = getActiveGenerationIds(id);
    const generationState = getNoteGenerationState(id);

    // 中止所有活动的生成任务
    for (const generationId of activeIds) {
      try {
        await Promise.allSettled([
          invoke("abort_note_generation", { generationId }),
          invoke("abort_chapter_generation", { generationId }),
          invoke("abort_highlight_generation", { generationId }),
          invoke("abort_flashcard_generation", { generationId }),
        ]);
      } catch (error) {
        console.error(`[deleteNote] 中止任务失败: generationId=${generationId}`, error);
      }
    }

    // 如果有主生成任务但不在 activeIds 中，也尝试中止
    if (generationState.generationId && !activeIds.includes(generationState.generationId)) {
      try {
        await invoke("abort_note_generation", { generationId: generationState.generationId });
      } catch (error) {
        console.error("中止主生成任务失败:", error);
      }
    }

    // 清理前端状态
    clearNoteGenerationState(id);

    await invoke("delete_note", { id });
    await refreshNotes();

    // 如果删除的是当前选中的笔记，清除选中状态并返回首页
    if (selectedNoteId === id) {
      setSelectedNoteId(null);
      setCurrentView("home");
    }
  }, [refreshNotes, selectedNoteId, onBeforeNoteDelete]);

  // 更新笔记的建议问题
  const updateNoteSuggestedQuestions = useCallback((noteId: string, questions: string[]) => {
    setNotes(prev => prev.map(note =>
      note.id === noteId
        ? { ...note, suggested_questions: JSON.stringify(questions) }
        : note
    ));
  }, []);

  // 初始加载
  useEffect(() => {
    refreshNotes();
  }, [refreshNotes]);

  const value = useMemo(() => ({
    notes,
    refreshNotes,
    refreshNoteById,
    createNote,
    updateNote,
    deleteNote,
    updateNoteSuggestedQuestions,
    isGenerating,
    setIsGenerating,
    searchQuery,
    setSearchQuery,
    currentView,
    setCurrentView,
    selectedNoteId,
    setSelectedNoteId,
    updateStats,
  }), [
    notes,
    refreshNotes,
    refreshNoteById,
    createNote,
    updateNote,
    deleteNote,
    updateNoteSuggestedQuestions,
    isGenerating,
    searchQuery,
    currentView,
    selectedNoteId,
    updateStats,
  ]);

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const context = useContext(NotesContext);
  if (!context) {
    throw new Error("useNotes must be used within a NotesProvider");
  }
  return context;
}
