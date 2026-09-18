import { parseDetailedReadingData, type DetailedReadingChapter, type DetailedReadingData } from "../types";
import { mergeDetailedReadingChapter } from "./detailedReadingChapters";

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
  isGeneratingHighlights: boolean; // 是否正在生成高光笔记
  isGeneratingFlashcards: boolean; // 是否正在生成闪记卡
  isInitialAutoGeneration: boolean; // 是否正在进行首次自动生成流程
  // 跟踪该笔记所有正在运行的 generation_id（用于删除时中止所有任务）
  activeGenerationIds: Set<string>;
  // 深度蓝图生成状态
  blueprintIsGenerating: boolean;
  blueprintProgress: { current: number; total: number } | null;
  blueprintGenerationId: string | null;
}

// 全局存储每个笔记的生成状态
const noteGenerationStates = new Map<string, NoteGenerationState>();

// 全局事件监听器管理（避免重复监听同一个generationId）
export const activeListeners = new Map<string, () => void>();

// 隐藏笔记页时暂存原文细读快照，回页后再灌入，避免后台全量重绘。
const pendingDetailedReadingData = new Map<string, DetailedReadingData>();
const pendingDetailedReadingRaw = new Map<string, string>();
const pendingNoteRefresh = new Set<string>();

export function stashDetailedReadingPartial(noteId: string, content: string) {
  if (!content) return;
  if (pendingDetailedReadingData.has(noteId)) return;
  pendingDetailedReadingRaw.set(noteId, content);
}

export function stashDetailedReadingData(noteId: string, data: DetailedReadingData) {
  pendingDetailedReadingData.set(noteId, data);
  pendingDetailedReadingRaw.delete(noteId);
}

export function seedDetailedReadingStash(noteId: string, current: DetailedReadingData | null) {
  if (pendingDetailedReadingData.has(noteId)) return;
  if (current) {
    pendingDetailedReadingData.set(noteId, current);
  }
}

export function stashDetailedReadingChapter(
  noteId: string,
  chapter: DetailedReadingChapter,
  totalDuration: number,
) {
  const prev = pendingDetailedReadingData.get(noteId) ?? null;
  pendingDetailedReadingData.set(
    noteId,
    mergeDetailedReadingChapter(prev, chapter, totalDuration),
  );
}

export function takeDetailedReadingData(noteId: string): DetailedReadingData | null {
  const data = pendingDetailedReadingData.get(noteId) ?? null;
  pendingDetailedReadingData.delete(noteId);
  const raw = pendingDetailedReadingRaw.get(noteId) ?? null;
  pendingDetailedReadingRaw.delete(noteId);
  if (data) return data;
  if (!raw) return null;
  return parseDetailedReadingData(raw);
}

export function takeDetailedReadingPartial(noteId: string): string | null {
  const data = takeDetailedReadingData(noteId);
  if (!data) return null;
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

export function clearDetailedReadingPartial(noteId: string) {
  pendingDetailedReadingData.delete(noteId);
  pendingDetailedReadingRaw.delete(noteId);
}

export function markPendingNoteRefresh(noteId: string) {
  pendingNoteRefresh.add(noteId);
}

export function takePendingNoteRefresh(noteId: string): boolean {
  const had = pendingNoteRefresh.has(noteId);
  pendingNoteRefresh.delete(noteId);
  return had;
}

// 订阅者：noteId -> Set<callback>，使外部组件能在状态变更时被动接收通知，
// 替代 setInterval 轮询，避免每秒 5 次无谓的整面板重渲染。
type NoteStateListener = (state: NoteGenerationState) => void;
const noteStateListeners = new Map<string, Set<NoteStateListener>>();

function notifyNoteStateListeners(noteId: string) {
  const set = noteStateListeners.get(noteId);
  if (!set || set.size === 0) return;
  const state = getNoteGenerationState(noteId);
  for (const listener of set) {
    try {
      listener(state);
    } catch (err) {
      console.error("[noteGenerationState] listener error:", err);
    }
  }
}

/**
 * 订阅指定笔记生成状态变化。
 * 返回取消订阅函数。回调会在 setNoteGenerationState 被调用后同步触发。
 */
export function subscribeNoteGenerationState(
  noteId: string,
  listener: NoteStateListener
): () => void {
  let set = noteStateListeners.get(noteId);
  if (!set) {
    set = new Set();
    noteStateListeners.set(noteId, set);
  }
  set.add(listener);
  return () => {
    const current = noteStateListeners.get(noteId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      noteStateListeners.delete(noteId);
    }
  };
}

// 获取或初始化笔记的生成状态
export function getNoteGenerationState(noteId: string): NoteGenerationState {
  if (!noteGenerationStates.has(noteId)) {
    noteGenerationStates.set(noteId, {
      isGenerating: false,
      generationId: null,
      regeneratingTabs: new Set(),
      progress: { current: 0, total: 0, message: "" },
      completedTabs: new Set(),
      failedTabs: new Map(),
      isGeneratingChapters: false,
      isGeneratingHighlights: false,
      isGeneratingFlashcards: false,
      isInitialAutoGeneration: false,
      activeGenerationIds: new Set(),
      blueprintIsGenerating: false,
      blueprintProgress: null,
      blueprintGenerationId: null,
    });
  }
  return noteGenerationStates.get(noteId)!;
}

// 设置笔记的生成状态
export function setNoteGenerationState(noteId: string, updates: Partial<NoteGenerationState>) {
  const state = getNoteGenerationState(noteId);
  Object.assign(state, updates);
  // 记录活动时间，供看门狗判断是否卡死
  if (updates.isGenerating || (updates.regeneratingTabs && updates.regeneratingTabs.size > 0)) {
    lastActivityAt.set(noteId, Date.now());
  }
  notifyNoteStateListeners(noteId);
}

// 清理笔记的生成状态
export function clearNoteGenerationState(noteId: string) {
  const state = noteGenerationStates.get(noteId);
  if (state) {
    // 清理所有活动的事件监听器（遍历 activeGenerationIds）
    for (const generationId of state.activeGenerationIds) {
      const unlisten = activeListeners.get(generationId);
      if (unlisten) {
        unlisten();
        activeListeners.delete(generationId);
      }
    }
    // 也清理主 generationId 的监听器（如果不在 activeGenerationIds 中）
    if (state.generationId && !state.activeGenerationIds.has(state.generationId)) {
      const unlisten = activeListeners.get(state.generationId);
      if (unlisten) {
        unlisten();
        activeListeners.delete(state.generationId);
      }
    }
  }
  // 清理生成状态
  noteGenerationStates.delete(noteId);
  // 清理活动时间记录
  lastActivityAt.delete(noteId);
  // 清理订阅者，避免外部仍持有过期回调
  noteStateListeners.delete(noteId);
  // 清理自动生成尝试记录（允许重新触发）
  attemptedAutoGenerateNoteIds.delete(noteId);
  pendingDetailedReadingData.delete(noteId);
  pendingDetailedReadingRaw.delete(noteId);
  pendingNoteRefresh.delete(noteId);
}

// 判断笔记是否正在生成中
export function isNoteGenerating(noteId: string): boolean {
  return getNoteGenerationState(noteId).isGenerating;
}

// 全局追踪已尝试自动生成的笔记ID（避免重复触发）
export const attemptedAutoGenerateNoteIds = new Set<string>();

// 设置章节生成状态
export function setChapterGenerating(noteId: string, isGenerating: boolean) {
  setNoteGenerationState(noteId, { isGeneratingChapters: isGenerating });
}

// 获取章节生成状态
export function isChapterGenerating(noteId: string): boolean {
  return getNoteGenerationState(noteId).isGeneratingChapters;
}

// 设置高光笔记生成状态
export function setHighlightGenerating(noteId: string, isGenerating: boolean) {
  setNoteGenerationState(noteId, { isGeneratingHighlights: isGenerating });
}

// 设置闪记卡生成状态
export function setFlashcardGenerating(noteId: string, isGenerating: boolean) {
  setNoteGenerationState(noteId, { isGeneratingFlashcards: isGenerating });
}

// 设置首次自动生成流程状态
export function setInitialAutoGeneration(noteId: string, isInitial: boolean) {
  setNoteGenerationState(noteId, { isInitialAutoGeneration: isInitial });
}

// 获取首次自动生成流程状态
export function isInitialAutoGeneration(noteId: string): boolean {
  return getNoteGenerationState(noteId).isInitialAutoGeneration;
}

// 注册一个活动的 generation_id
export function registerActiveGenerationId(noteId: string, generationId: string) {
  const state = getNoteGenerationState(noteId);
  state.activeGenerationIds.add(generationId);
}

// 注销一个活动的 generation_id
export function unregisterActiveGenerationId(noteId: string, generationId: string) {
  const state = getNoteGenerationState(noteId);
  state.activeGenerationIds.delete(generationId);
}

// 获取笔记所有活动的 generation_id
export function getActiveGenerationIds(noteId: string): string[] {
  return Array.from(getNoteGenerationState(noteId).activeGenerationIds);
}

// ============================================================================
// 生成状态看门狗
// ============================================================================

// 每个笔记的上次活动时间戳（任何状态更新都视为活动）
const lastActivityAt = new Map<string, number>();

// 看门狗轮询间隔与超时阈值
const WATCHDOG_INTERVAL_MS = 30_000;
const WATCHDOG_TIMEOUT_MS = 10 * 60_000; // 10 分钟无任何事件则判定为卡死

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

// 看门狗触发时的回调（由 UI 层注入，用于弹出提示）
type WatchdogHandler = (noteId: string, stalledTabs: string[]) => void;
let watchdogHandler: WatchdogHandler | null = null;

function ensureWatchdog() {
  if (watchdogTimer !== null) return;
  watchdogTimer = setInterval(() => {
    const now = Date.now();
    for (const [noteId, state] of noteGenerationStates) {
      const stalledTabs = Array.from(state.regeneratingTabs);
      if (stalledTabs.length === 0) continue;

      const lastActive = lastActivityAt.get(noteId) ?? 0;
      if (now - lastActive < WATCHDOG_TIMEOUT_MS) continue;

      // 判定卡死：复位 regeneratingTabs / isGenerating，记录失败信息
      console.warn(`[noteGenerationState] 看门狗: ${noteId} 的 ${stalledTabs.join(", ")} 超过 10 分钟无事件，自动复位状态`);
      setNoteGenerationState(noteId, {
        isGenerating: false,
        generationId: null,
        regeneratingTabs: new Set(),
        progress: { current: 0, total: 0, message: "生成超时，已自动复位" },
      });
      const failed = new Map(state.failedTabs);
      for (const tab of stalledTabs) {
        failed.set(tab, "生成超时（超过 10 分钟无响应），已自动复位，请重试");
      }
      setNoteGenerationState(noteId, { failedTabs: failed });
      lastActivityAt.set(noteId, now); // 避免下次循环立即重复触发
      if (watchdogHandler) {
        try {
          watchdogHandler(noteId, stalledTabs);
        } catch (err) {
          console.error("[noteGenerationState] watchdog handler error:", err);
        }
      }
    }
  }, WATCHDOG_INTERVAL_MS);
}

/**
 * 注册看门狗触发回调（UI 层调用一次即可，用于弹出提示）。
 * 返回取消注册函数。
 */
export function registerWatchdogHandler(handler: WatchdogHandler): () => void {
  watchdogHandler = handler;
  ensureWatchdog();
  return () => {
    if (watchdogHandler === handler) {
      watchdogHandler = null;
    }
  };
}
