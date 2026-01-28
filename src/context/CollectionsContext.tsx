/**
 * CollectionsContext - 合集与批量操作状态管理
 * 从 AppContext 拆分，减少不必要的重渲染
 */
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Collection, CreateCollectionRequest } from "../types";

interface BatchSelection {
  isSelecting: boolean;
  selectedNoteIds: Set<string>;
}

interface CollectionsContextType {
  // 合集
  collections: Collection[];
  selectedCollectionId: string | null;
  expandedCollections: Set<string>;
  notesInCollections: Set<string>;
  refreshCollections: () => Promise<void>;
  refreshNotesInCollections: () => Promise<void>;
  createCollection: (req: CreateCollectionRequest) => Promise<Collection>;
  updateCollection: (collection: Collection) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  setSelectedCollection: (id: string | null) => void;
  toggleCollectionExpand: (id: string) => void;
  addNoteToCollection: (collectionId: string, noteId: string) => Promise<void>;
  removeNoteFromCollection: (collectionId: string, noteId: string) => Promise<void>;
  updateCollectionsOrder: (collectionIds: string[]) => Promise<void>;

  // 批量操作
  batchSelection: BatchSelection;
  setBatchSelecting: (isSelecting: boolean) => void;
  toggleNoteSelection: (noteId: string) => void;
  selectAllNotes: (noteIds: string[]) => void;
  clearSelection: () => void;
  batchRemoveFromCollection: (collectionId: string, noteIds: string[]) => Promise<void>;
  batchMoveToCollection: (fromCollectionId: string, toCollectionId: string, noteIds: string[]) => Promise<void>;
  batchDeleteNotes: (noteIds: string[], refreshNotes: () => Promise<void>) => Promise<void>;
}

const CollectionsContext = createContext<CollectionsContextType | null>(null);

export function CollectionsProvider({ children }: { children: ReactNode }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [notesInCollections, setNotesInCollections] = useState<Set<string>>(new Set());

  const [batchSelection, setBatchSelection] = useState<BatchSelection>({
    isSelecting: false,
    selectedNoteIds: new Set(),
  });

  // 加载合集列表
  const refreshCollections = useCallback(async () => {
    try {
      const collectionsList = await invoke<Collection[]>("get_collections");
      setCollections(collectionsList);
    } catch (error) {
      console.error("Failed to load collections:", error);
    }
  }, []);

  // 加载已添加到合集的笔记ID列表
  const refreshNotesInCollections = useCallback(async () => {
    try {
      const noteIds = await invoke<string[]>("get_all_notes_in_collections");
      setNotesInCollections(new Set(noteIds));
    } catch (error) {
      console.error("Failed to load notes in collections:", error);
    }
  }, []);

  // 创建合集
  const createCollection = useCallback(async (req: CreateCollectionRequest): Promise<Collection> => {
    const newCollection = await invoke<Collection>("create_collection", { req });
    await refreshCollections();
    return newCollection;
  }, [refreshCollections]);

  // 更新合集
  const updateCollection = useCallback(async (collection: Collection): Promise<void> => {
    await invoke("update_collection", { collection });
    await refreshCollections();
  }, [refreshCollections]);

  // 删除合集
  const deleteCollection = useCallback(async (id: string): Promise<void> => {
    await invoke("delete_collection", { id });
    await refreshCollections();
    if (selectedCollectionId === id) {
      setSelectedCollectionId(null);
    }
  }, [refreshCollections, selectedCollectionId]);

  // 设置选中的合集
  const setSelectedCollection = useCallback((id: string | null) => {
    setSelectedCollectionId(id);
  }, []);

  // 切换合集展开状态
  const toggleCollectionExpand = useCallback((id: string) => {
    setExpandedCollections((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return newExpanded;
    });
  }, []);

  // 添加笔记到合集
  const addNoteToCollection = useCallback(async (collectionId: string, noteId: string): Promise<void> => {
    await invoke("add_note_to_collection", { collectionId, noteId });
    await refreshCollections();
    await refreshNotesInCollections();
  }, [refreshCollections, refreshNotesInCollections]);

  // 从合集移除笔记
  const removeNoteFromCollection = useCallback(async (collectionId: string, noteId: string): Promise<void> => {
    await invoke("remove_note_from_collection", { collectionId, noteId });
    await refreshCollections();
    await refreshNotesInCollections();
  }, [refreshCollections, refreshNotesInCollections]);

  // 更新合集排序
  const updateCollectionsOrder = useCallback(async (collectionIds: string[]): Promise<void> => {
    await invoke("update_collections_order", { collectionIds });
    await refreshCollections();
  }, [refreshCollections]);

  // 批量操作方法
  const setBatchSelecting = useCallback((isSelecting: boolean) => {
    setBatchSelection(prev => ({
      isSelecting,
      selectedNoteIds: isSelecting ? prev.selectedNoteIds : new Set(),
    }));
  }, []);

  const toggleNoteSelection = useCallback((noteId: string) => {
    setBatchSelection(prev => {
      const newSelected = new Set(prev.selectedNoteIds);
      if (newSelected.has(noteId)) {
        newSelected.delete(noteId);
      } else {
        newSelected.add(noteId);
      }
      return { ...prev, selectedNoteIds: newSelected };
    });
  }, []);

  const selectAllNotes = useCallback((noteIds: string[]) => {
    setBatchSelection(prev => ({
      ...prev,
      selectedNoteIds: new Set(noteIds),
    }));
  }, []);

  const clearSelection = useCallback(() => {
    setBatchSelection(prev => ({
      ...prev,
      selectedNoteIds: new Set(),
    }));
  }, []);

  // 批量从合集移除 - 使用新的批量 API
  const batchRemoveFromCollection = useCallback(async (collectionId: string, noteIds: string[]): Promise<void> => {
    try {
      // 使用批量 API（如果后端支持）
      await invoke("batch_remove_notes_from_collection", { collectionId, noteIds });
    } catch {
      // 降级为逐个调用
      for (const noteId of noteIds) {
        await invoke("remove_note_from_collection", { collectionId, noteId });
      }
    }
    await refreshCollections();
    await refreshNotesInCollections();
    clearSelection();
  }, [refreshCollections, refreshNotesInCollections, clearSelection]);

  // 批量移动到合集
  const batchMoveToCollection = useCallback(async (
    fromCollectionId: string,
    toCollectionId: string,
    noteIds: string[]
  ): Promise<void> => {
    try {
      // 使用批量 API（如果后端支持）
      await invoke("batch_move_notes_to_collection", { fromCollectionId, toCollectionId, noteIds });
    } catch {
      // 降级为逐个调用
      for (const noteId of noteIds) {
        await invoke("remove_note_from_collection", { collectionId: fromCollectionId, noteId });
        await invoke("add_note_to_collection", { collectionId: toCollectionId, noteId });
      }
    }
    await refreshCollections();
    await refreshNotesInCollections();
    clearSelection();
  }, [refreshCollections, refreshNotesInCollections, clearSelection]);

  // 批量删除笔记
  const batchDeleteNotes = useCallback(async (noteIds: string[], refreshNotes: () => Promise<void>): Promise<void> => {
    try {
      // 使用批量 API（如果后端支持）
      await invoke("batch_delete_notes", { noteIds });
    } catch {
      // 降级为逐个调用
      for (const noteId of noteIds) {
        await invoke("delete_note", { id: noteId });
      }
    }
    await refreshNotes();
    await refreshCollections();
    await refreshNotesInCollections();
    clearSelection();
  }, [refreshCollections, refreshNotesInCollections, clearSelection]);

  // 初始加载
  useEffect(() => {
    refreshCollections();
    refreshNotesInCollections();
  }, []);

  const value = useMemo(() => ({
    collections,
    selectedCollectionId,
    expandedCollections,
    notesInCollections,
    refreshCollections,
    refreshNotesInCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    setSelectedCollection,
    toggleCollectionExpand,
    addNoteToCollection,
    removeNoteFromCollection,
    updateCollectionsOrder,
    batchSelection,
    setBatchSelecting,
    toggleNoteSelection,
    selectAllNotes,
    clearSelection,
    batchRemoveFromCollection,
    batchMoveToCollection,
    batchDeleteNotes,
  }), [
    collections,
    selectedCollectionId,
    expandedCollections,
    notesInCollections,
    refreshCollections,
    refreshNotesInCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    setSelectedCollection,
    toggleCollectionExpand,
    addNoteToCollection,
    removeNoteFromCollection,
    updateCollectionsOrder,
    batchSelection,
    setBatchSelecting,
    toggleNoteSelection,
    selectAllNotes,
    clearSelection,
    batchRemoveFromCollection,
    batchMoveToCollection,
    batchDeleteNotes,
  ]);

  return <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>;
}

export function useCollections() {
  const context = useContext(CollectionsContext);
  if (!context) {
    throw new Error("useCollections must be used within a CollectionsProvider");
  }
  return context;
}
