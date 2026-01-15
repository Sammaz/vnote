// 笔记生成状态管理工具函数
// 将这些函数从组件文件中分离出来，以避免 React Fast Refresh 警告

interface NoteGenerationState {
  isGenerating: boolean;
  generationId: string | null;
  regeneratingTabs: Set<string>;
  progress: { current: number; total: number; message: string };
  completedTabs: Set<string>;
  failedTabs: Map<string, string>;
  isGeneratingChapters: boolean; // 是否正在生成章节（原文细读）
  isInitialAutoGeneration: boolean; // 是否正在进行首次自动生成流程
}

// 全局存储每个笔记的生成状态
const noteGenerationStates = new Map<number, NoteGenerationState>();

// 全局事件监听器管理（避免重复监听同一个generationId）
export const activeListeners = new Map<string, () => void>();

// 获取或初始化笔记的生成状态
export function getNoteGenerationState(noteId: number): NoteGenerationState {
  if (!noteGenerationStates.has(noteId)) {
    noteGenerationStates.set(noteId, {
      isGenerating: false,
      generationId: null,
      regeneratingTabs: new Set(),
      progress: { current: 0, total: 0, message: "" },
      completedTabs: new Set(),
      failedTabs: new Map(),
      isGeneratingChapters: false,
      isInitialAutoGeneration: false,
    });
  }
  return noteGenerationStates.get(noteId)!;
}

// 设置笔记的生成状态
export function setNoteGenerationState(noteId: number, updates: Partial<NoteGenerationState>) {
  const state = getNoteGenerationState(noteId);
  Object.assign(state, updates);
}

// 清理笔记的生成状态
export function clearNoteGenerationState(noteId: number) {
  const state = noteGenerationStates.get(noteId);
  if (state?.generationId) {
    // 清理事件监听器
    const unlisten = activeListeners.get(state.generationId);
    if (unlisten) {
      unlisten();
      activeListeners.delete(state.generationId);
    }
  }
  noteGenerationStates.delete(noteId);
}

// 判断笔记是否正在生成中
export function isNoteGenerating(noteId: number): boolean {
  return getNoteGenerationState(noteId).isGenerating;
}

// 全局追踪已尝试自动生成的笔记ID（避免重复触发）
export const attemptedAutoGenerateNoteIds = new Set<number>();

// 设置章节生成状态
export function setChapterGenerating(noteId: number, isGenerating: boolean) {
  setNoteGenerationState(noteId, { isGeneratingChapters: isGenerating });
}

// 获取章节生成状态
export function isChapterGenerating(noteId: number): boolean {
  return getNoteGenerationState(noteId).isGeneratingChapters;
}

// 设置首次自动生成流程状态
export function setInitialAutoGeneration(noteId: number, isInitial: boolean) {
  setNoteGenerationState(noteId, { isInitialAutoGeneration: isInitial });
}

// 获取首次自动生成流程状态
export function isInitialAutoGeneration(noteId: number): boolean {
  return getNoteGenerationState(noteId).isInitialAutoGeneration;
}
