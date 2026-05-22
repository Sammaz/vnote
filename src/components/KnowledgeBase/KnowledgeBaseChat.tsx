import { Fragment, useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Send,
  Square,
  Bot,
  Paperclip,
  X,
  ChevronDown,
  MessageSquarePlus,
  FileText,
  Pin,
  Trash2,
  Pencil,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Copy,
  Sparkles,
  Search,
  ScrollText,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { MarkdownRenderer } from "../Markdown/MarkdownRenderer";
import { listen } from "@tauri-apps/api/event";
import { cn } from "../../utils/cn";
import { useGlassBg } from "../../hooks/useGlassBg";
import { useApp } from "../../context/AppContext";
import { useCollections } from "../../context/CollectionsContext";
import { copyText } from "../../utils/clipboard";
import type {
  KnowledgeAgentRunRecord,
  KnowledgeChatEvent,
  KnowledgeChatImageData,
  KnowledgeChatMessageRecord,
  KnowledgeChatMode,
  KnowledgeChatPreferences,
  KnowledgeChatRequest,
  KnowledgeChatSession,
  KnowledgeChatSessionDetail,
  KnowledgeChatSubmitResponse,
  KnowledgeSearchResult,
} from "./types";

type MessageRole = "user" | "assistant" | "system";

type MessageStatus = "streaming" | "completed" | "error" | "aborted";

interface UiMessage {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  sources: KnowledgeSearchResult[];
  agentRun: KnowledgeAgentRunRecord | null;
  parentMessageId?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  imageUrls?: string[];
}

interface UploadedImage {
  id: string;
  file: File;
  previewUrl: string;
}

interface TraceMetadataSection {
  label: string;
  value: string[];
}

const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,image/tiff,image/heic,image/heif,image/avif";

const DEFAULT_PREFERENCES: KnowledgeChatPreferences = {
  default_mode: "standard",
  default_model_id: null,
  default_prompt_id: null,
  show_agent_trace: true,
  show_sources_expanded: true,
  compact_message_density: false,
};

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mapRecordToUiMessage(record: KnowledgeChatMessageRecord): UiMessage {
  let imageUrls: string[] | undefined;
  if (record.message.images_json) {
    try {
      const parsed = JSON.parse(record.message.images_json) as Array<{ data?: string }>;
      imageUrls = parsed.map((item) => item.data).filter((item): item is string => Boolean(item));
    } catch {
      imageUrls = undefined;
    }
  }

  return {
    id: record.message.id,
    role: record.message.role,
    content: record.message.content,
    status: record.message.status,
    sources: record.sources
      .map((item) => item.result)
      .filter((item): item is KnowledgeSearchResult => Boolean(item)),
    agentRun: record.agent_run,
    parentMessageId: record.message.parent_message_id,
    errorMessage: record.message.error_message,
    createdAt: record.message.created_at,
    imageUrls,
  };
}

function buildRunningAgentRun(runId: string): KnowledgeAgentRunRecord {
  return {
    run: {
      id: runId,
      session_id: "",
      message_id: "",
      status: "running",
      iteration_count: 0,
      plan_summary: null,
      final_summary: null,
      error_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
    },
    trace_steps: [],
  };
}

function mergeStreamingContent(accumulated: string, incoming: string) {
  if (!incoming) {
    return { nextContent: accumulated, appendedDelta: "" };
  }

  if (!accumulated) {
    return { nextContent: incoming, appendedDelta: incoming };
  }

  if (incoming.startsWith(accumulated)) {
    return {
      nextContent: incoming,
      appendedDelta: incoming.slice(accumulated.length),
    };
  }

  if (accumulated.startsWith(incoming) || accumulated.endsWith(incoming)) {
    return { nextContent: accumulated, appendedDelta: "" };
  }

  const maxOverlap = Math.min(accumulated.length, incoming.length);
  let overlap = 0;

  for (let candidate = maxOverlap; candidate > 0; candidate -= 1) {
    if (accumulated.slice(-candidate) === incoming.slice(0, candidate)) {
      overlap = candidate;
      break;
    }
  }

  const appendedDelta = incoming.slice(overlap);
  return {
    nextContent: accumulated + appendedDelta,
    appendedDelta,
  };
}

function isDefaultSessionTitle(title: string) {
  return title === "新建知识库对话" || title === "新建 Agent 对话";
}

function buildSessionTitleFromMessage(content: string) {
  const normalized = content
    .trim()
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim()
    .replace(/\s+/g, " ");

  if (!normalized) return null;

  return normalized.length > 26 ? `${normalized.slice(0, 26)}…` : normalized;
}

function parseTraceMetadata(metadataJson: string | null): TraceMetadataSection[] {
  if (!metadataJson) return [];

  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => {
        if (value == null) return null;
        const values = Array.isArray(value)
          ? value.map((item) => String(item)).filter(Boolean)
          : [String(value)].filter(Boolean);
        if (values.length === 0) return null;
        return {
          label: key.replace(/_/g, " "),
          value: values,
        };
      })
      .filter((item): item is TraceMetadataSection => Boolean(item));
  } catch {
    return [{ label: "metadata", value: [metadataJson] }];
  }
}

const DRAFT_PREFIX = "__draft__";

function generateDraftId() {
  return `${DRAFT_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isDraftKey(key: string | null | undefined) {
  return Boolean(key && key.startsWith(DRAFT_PREFIX));
}

interface SessionRuntime {
  messages: UiMessage[];
  mode: KnowledgeChatMode;
  modelId: string | null;
  promptId: string | null;
  streaming: boolean;
  stopping: boolean;
  pendingAbort: boolean;
  requestId: string | null;
  statusText: string | null;
  statusQueries: string[];
  accumulatedContent: string;
  composerError: string | null;
  inspectorMessageId: string | null;
}

function createInitialRuntime(overrides?: Partial<SessionRuntime>): SessionRuntime {
  return {
    messages: [],
    mode: DEFAULT_PREFERENCES.default_mode,
    modelId: null,
    promptId: null,
    streaming: false,
    stopping: false,
    pendingAbort: false,
    requestId: null,
    statusText: null,
    statusQueries: [],
    accumulatedContent: "",
    composerError: null,
    inspectorMessageId: null,
    ...overrides,
  };
}

const INITIAL_RUNTIME_SNAPSHOT: SessionRuntime = createInitialRuntime();

export function KnowledgeBaseChat() {
  const {
    aiConfigs,
    promptConfigs,
    selectedModelId,
    setSelectedNoteId,
    setCurrentView,
  } = useApp();
  const { expandCollectionPathForNote } = useCollections();

  const glassCard = useGlassBg("card");
  const glassModal = useGlassBg("modal");
  const glassInput = useGlassBg("input");
  const glassMenu = useGlassBg("menu");

  const [sessions, setSessions] = useState<KnowledgeChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string>(() => generateDraftId());
  const [sessionRuntimes, setSessionRuntimes] = useState<Record<string, SessionRuntime>>({});
  const [input, setInput] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showAgentTrace, setShowAgentTrace] = useState(DEFAULT_PREFERENCES.show_agent_trace);
  const [showSourcesExpanded, setShowSourcesExpanded] = useState(DEFAULT_PREFERENCES.show_sources_expanded);
  const [compactMessageDensity, setCompactMessageDensity] = useState(DEFAULT_PREFERENCES.compact_message_density);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageValue, setEditingMessageValue] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [pendingDeleteSessionTitle, setPendingDeleteSessionTitle] = useState("");
  const [deleteConfirmPosition, setDeleteConfirmPosition] = useState<{
    top: number;
    left: number;
    arrowTop: number;
    arrowSide: "left" | "right";
  } | null>(null);
  const [deleteConfirmPanelMinWidth, setDeleteConfirmPanelMinWidth] = useState<number | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [activeCitation, setActiveCitation] = useState<{ messageId: string; rank: number } | null>(null);

  const deleteConfirmPanelRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const deleteConfirmAnchorRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const promptDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadedImagesRef = useRef<UploadedImage[]>([]);
  const sessionRuntimesRef = useRef<Record<string, SessionRuntime>>({});
  const listenersRef = useRef<Record<string, () => void>>({});
  const draftIdRef = useRef(draftId);
  const selectedSessionIdRef = useRef(selectedSessionId);
  const activeCitationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    sessionRuntimesRef.current = sessionRuntimes;
  }, [sessionRuntimes]);

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    return () => {
      Object.values(listenersRef.current).forEach((unlisten) => {
        try { unlisten(); } catch { /* noop */ }
      });
      listenersRef.current = {};
    };
  }, []);

  useEffect(() => {
    return () => {
      if (activeCitationTimerRef.current !== null) {
        window.clearTimeout(activeCitationTimerRef.current);
        activeCitationTimerRef.current = null;
      }
    };
  }, []);

  const availablePromptConfigs = useMemo(() => promptConfigs, [promptConfigs]);

  const activeRuntimeKey = selectedSessionId ?? draftId;
  const currentRuntime = sessionRuntimes[activeRuntimeKey] ?? INITIAL_RUNTIME_SNAPSHOT;
  const messages = currentRuntime.messages;
  const streaming = currentRuntime.streaming;
  const stopping = currentRuntime.stopping;
  const statusText = currentRuntime.statusText;
  const statusQueries = currentRuntime.statusQueries;
  const mode = currentRuntime.mode;
  const localModelId = currentRuntime.modelId;
  const selectedPromptId = currentRuntime.promptId;
  const composerError = currentRuntime.composerError;
  const inspectorMessageId = currentRuntime.inspectorMessageId;

  const activeModel = useMemo(
    () => aiConfigs.find((config) => config.id === localModelId) ?? null,
    [aiConfigs, localModelId]
  );
  const activePrompt = useMemo(
    () => availablePromptConfigs.find((config) => config.id === selectedPromptId) ?? null,
    [availablePromptConfigs, selectedPromptId]
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );
  const filteredSessions = useMemo(
    () => sessions.filter((session) => session.mode === mode),
    [sessions, mode]
  );
  const selectedInspectorMessage = useMemo(() => {
    if (inspectorMessageId) {
      const matched = messages.find((message) => message.id === inspectorMessageId);
      if (matched) return matched;
    }
    return [...messages].reverse().find((message) => message.role === "assistant") ?? null;
  }, [messages, inspectorMessageId]);
  const streamingAssistantIndex = useMemo(() => {
    const reversedIndex = [...messages].reverse().findIndex(
      (message) => message.role === "assistant" && message.status === "streaming"
    );
    return reversedIndex === -1 ? -1 : messages.length - 1 - reversedIndex;
  }, [messages]);

  const patchRuntime = useCallback((key: string, updates: Partial<SessionRuntime>) => {
    setSessionRuntimes((prev) => {
      const base = prev[key] ?? createInitialRuntime();
      return { ...prev, [key]: { ...base, ...updates } };
    });
  }, []);

  const mergeRuntime = useCallback(
    (key: string, updater: (prev: SessionRuntime) => SessionRuntime | null) => {
      setSessionRuntimes((prev) => {
        const base = prev[key] ?? createInitialRuntime();
        const next = updater(base);
        if (!next || next === base) return prev;
        return { ...prev, [key]: next };
      });
    },
    []
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const refreshSessions = useCallback(async () => {
    const data = await invoke<KnowledgeChatSession[]>("knowledge_base_list_chat_sessions");
    setSessions(data);
    return data;
  }, []);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const existing = sessionRuntimesRef.current[sessionId];
    if (existing?.streaming) {
      // 会话正处于流式生成中,不覆盖 runtime,只同步选中
      setSelectedSessionId(sessionId);
      return null;
    }
    const detail = await invoke<KnowledgeChatSessionDetail>("knowledge_base_get_chat_session", { sessionId });
    const nextMessages = detail.messages.map(mapRecordToUiMessage);
    const latestAssistant = [...nextMessages].reverse().find((message) => message.role === "assistant") ?? null;
    setSelectedSessionId(detail.session.id);
    setSessionRuntimes((prev) => {
      const base = prev[detail.session.id] ?? createInitialRuntime();
      return {
        ...prev,
        [detail.session.id]: {
          ...base,
          messages: nextMessages,
          mode: detail.session.mode,
          modelId: detail.session.model_id,
          promptId: detail.session.prompt_id,
          streaming: false,
          stopping: false,
          pendingAbort: false,
          requestId: null,
          statusText: null,
          statusQueries: [],
          accumulatedContent: "",
          composerError: null,
          inspectorMessageId: latestAssistant?.id ?? null,
        },
      };
    });
    return detail;
  }, []);

  const resetDraft = useCallback((preferred?: KnowledgeChatPreferences | null) => {
    const newDraft = generateDraftId();
    const prefs = preferred ?? null;
    setSessionRuntimes((prev) => ({
      ...prev,
      [newDraft]: createInitialRuntime({
        mode: prefs?.default_mode ?? DEFAULT_PREFERENCES.default_mode,
        modelId: prefs?.default_model_id ?? selectedModelId ?? null,
        promptId: prefs?.default_prompt_id ?? null,
      }),
    }));
    setDraftId(newDraft);
    setSelectedSessionId(null);
    setInput("");
    setEditingMessageId(null);
    setEditingMessageValue("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [selectedModelId]);

  useEffect(() => {
    if (selectedModelId || selectedSessionId) return;
    const currentDraftId = draftIdRef.current;
    const current = sessionRuntimesRef.current[currentDraftId];
    if (current && !current.modelId) {
      patchRuntime(currentDraftId, { modelId: selectedModelId ?? null });
    }
  }, [selectedModelId, selectedSessionId, patchRuntime]);

  useEffect(() => {
    uploadedImagesRef.current = uploadedImages;
  }, [uploadedImages]);

  useEffect(() => {
    return () => {
      uploadedImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
      if (promptDropdownRef.current && !promptDropdownRef.current.contains(event.target as Node)) {
        setShowPromptDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, statusText, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [prefs, sessionList] = await Promise.all([
          invoke<KnowledgeChatPreferences | null>("knowledge_base_get_chat_preferences"),
          refreshSessions(),
        ]);
        if (cancelled) return;

        const mergedPrefs = prefs ?? DEFAULT_PREFERENCES;
        setShowAgentTrace(mergedPrefs.show_agent_trace);
        setShowSourcesExpanded(mergedPrefs.show_sources_expanded);
        setCompactMessageDensity(mergedPrefs.compact_message_density);

        // 用首选项初始化当前 draft
        const initialDraft = draftIdRef.current;
        setSessionRuntimes((prev) => {
          const base = prev[initialDraft] ?? createInitialRuntime();
          return {
            ...prev,
            [initialDraft]: {
              ...base,
              mode: mergedPrefs.default_mode,
              modelId: mergedPrefs.default_model_id ?? selectedModelId ?? null,
              promptId: mergedPrefs.default_prompt_id ?? null,
            },
          };
        });
        setPreferencesReady(true);

        if (!initializedRef.current) {
          initializedRef.current = true;
          if (sessionList.length > 0) {
            await loadSessionDetail(sessionList[0].id);
          } else {
            resetDraft(mergedPrefs);
          }
        }
      } catch (error) {
        console.error("Failed to bootstrap knowledge chat:", error);
        setPreferencesReady(true);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadSessionDetail, refreshSessions, resetDraft, selectedModelId]);

  useEffect(() => {
    if (!preferencesReady) return;
    void invoke("knowledge_base_save_chat_preferences", {
      payload: {
        default_mode: mode,
        default_model_id: localModelId,
        default_prompt_id: selectedPromptId,
        show_agent_trace: showAgentTrace,
        show_sources_expanded: showSourcesExpanded,
        compact_message_density: compactMessageDensity,
      },
    }).catch((error) => {
      console.error("Failed to save knowledge chat preferences:", error);
    });
  }, [
    compactMessageDensity,
    localModelId,
    mode,
    preferencesReady,
    selectedPromptId,
    showAgentTrace,
    showSourcesExpanded,
  ]);

  const startChatListener = useCallback(
    (sessionKey: string, targetRequestId: string, chatMode: KnowledgeChatMode) => {
      const eventName = `knowledge-chat-${targetRequestId}`;
      let disposed = false;

      const cleanup = (reason: "completed" | "error" | "aborted") => {
        const unlisten = listenersRef.current[targetRequestId];
        if (unlisten) {
          try { unlisten(); } catch { /* noop */ }
          delete listenersRef.current[targetRequestId];
        }
        void refreshSessions();
        // 仅对非 draft key(即已落库的 sessionId)才从后端同步最终状态
        if (!isDraftKey(sessionKey)) {
          void loadSessionDetail(sessionKey).catch(() => undefined);
        }
        void reason;
      };

      void listen<KnowledgeChatEvent>(eventName, (event) => {
        const data = event.payload;

        mergeRuntime(sessionKey, (runtime) => {
          const messagesList = [...runtime.messages];
          const assistantIndex = [...messagesList]
            .reverse()
            .findIndex((message) => message.role === "assistant");
          if (assistantIndex === -1) return runtime;
          const targetIndex = messagesList.length - 1 - assistantIndex;
          const current = messagesList[targetIndex];

          if (
            runtime.pendingAbort &&
            data.status !== "Aborted" &&
            data.status !== "Completed" &&
            data.status !== "Error"
          ) {
            return runtime;
          }

          switch (data.status) {
            case "ContextFound":
              messagesList[targetIndex] = { ...current, sources: data.sources };
              return { ...runtime, messages: messagesList };
            case "TraceStep": {
              const currentRun = current.agentRun ?? buildRunningAgentRun(data.run_id);
              const existingSteps = currentRun.trace_steps.filter((step) => step.id !== data.step.id);
              messagesList[targetIndex] = {
                ...current,
                agentRun: {
                  run: { ...currentRun.run, id: data.run_id, status: "running" },
                  trace_steps: [...existingSteps, data.step].sort((a, b) => a.step_index - b.step_index),
                },
              };
              return { ...runtime, messages: messagesList };
            }
            case "Streaming": {
              const merged = mergeStreamingContent(runtime.accumulatedContent, data.content);
              if (!merged.appendedDelta && current.content === merged.nextContent) {
                return runtime;
              }
              messagesList[targetIndex] = {
                ...current,
                content: merged.nextContent,
                status: "streaming",
              };
              return {
                ...runtime,
                messages: messagesList,
                accumulatedContent: merged.nextContent,
                statusText: null,
                statusQueries: [],
              };
            }
            case "Searching":
            case "Planning":
              if (runtime.pendingAbort) return runtime;
              return { ...runtime, statusText: data.message, statusQueries: [] };
            case "Retrieving":
              if (runtime.pendingAbort) return runtime;
              return { ...runtime, statusText: data.message, statusQueries: data.queries };
            case "Degraded":
              return { ...runtime, composerError: data.message };
            case "Completed":
              messagesList[targetIndex] = {
                ...current,
                content: data.full_content,
                status: "completed",
                agentRun:
                  data.run_id && current.agentRun
                    ? {
                        ...current.agentRun,
                        run: {
                          ...current.agentRun.run,
                          id: data.run_id,
                          status: "completed",
                          final_summary: data.full_content,
                          completed_at: new Date().toISOString(),
                        },
                      }
                    : current.agentRun,
              };
              return {
                ...runtime,
                messages: messagesList,
                streaming: false,
                stopping: false,
                pendingAbort: false,
                requestId: null,
                statusText: null,
                statusQueries: [],
              };
            case "Error":
              messagesList[targetIndex] = {
                ...current,
                content: current.content || `错误: ${data.error}`,
                status: "error",
              };
              return {
                ...runtime,
                messages: messagesList,
                streaming: false,
                stopping: false,
                pendingAbort: false,
                requestId: null,
                statusText: null,
                statusQueries: [],
                composerError: `本次回答失败：${data.error}`,
              };
            case "Aborted":
              messagesList[targetIndex] = { ...current, status: "aborted" };
              return {
                ...runtime,
                messages: messagesList,
                streaming: false,
                stopping: false,
                pendingAbort: false,
                requestId: null,
                statusText: null,
                statusQueries: [],
                composerError: "已停止当前回答。你可以直接修改问题后重新发送。",
              };
            case "SessionReady":
            default:
              return runtime;
          }
        });

        // ContextFound 阶段切换到"整理证据"提示
        if (data.status === "ContextFound") {
          mergeRuntime(sessionKey, (runtime) => {
            if (runtime.pendingAbort) return runtime;
            return {
              ...runtime,
              statusText: chatMode === "agent" ? "正在整理证据与组织回答..." : "正在整理证据并生成回答...",
              statusQueries: [],
            };
          });
        }

        if (data.status === "Completed") {
          cleanup("completed");
        } else if (data.status === "Error") {
          cleanup("error");
        } else if (data.status === "Aborted") {
          cleanup("aborted");
        }
      }).then((fn) => {
        if (disposed) {
          try { fn(); } catch { /* noop */ }
          return;
        }
        listenersRef.current[targetRequestId] = fn;
        // 若在 listener 就位前已触发 abort,补发一次 abort 调用
        const runtime = sessionRuntimesRef.current[sessionKey];
        if (runtime?.pendingAbort && runtime.requestId === targetRequestId) {
          void invoke("knowledge_base_abort_chat", { requestId: targetRequestId }).catch((error) => {
            console.error("Failed to abort knowledge chat:", error);
          });
        }
      });

      return () => {
        disposed = true;
        const unlisten = listenersRef.current[targetRequestId];
        if (unlisten) {
          try { unlisten(); } catch { /* noop */ }
          delete listenersRef.current[targetRequestId];
        }
      };
    },
    [loadSessionDetail, mergeRuntime, refreshSessions]
  );

  const handleNavigateToNote = useCallback(async (noteId: string) => {
    await expandCollectionPathForNote(noteId);
    setSelectedNoteId(noteId);
    setCurrentView("note");
  }, [expandCollectionPathForNote, setCurrentView, setSelectedNoteId]);

  const handleCitationClick = useCallback((messageId: string, rank: number) => {
    patchRuntime(activeRuntimeKey, { inspectorMessageId: messageId });
    setShowRightPanel((prev) => (prev ? prev : true));
    setActiveCitation({ messageId, rank });
    if (activeCitationTimerRef.current !== null) {
      window.clearTimeout(activeCitationTimerRef.current);
    }
    const scrollToSource = () => {
      const element = document.getElementById(`kb-source-${messageId}-${rank}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToSource);
    });
    activeCitationTimerRef.current = window.setTimeout(() => {
      setActiveCitation(null);
      activeCitationTimerRef.current = null;
    }, 2400);
  }, [activeRuntimeKey, patchRuntime]);

  const persistCurrentSessionMeta = useCallback(async (
    next: Partial<Pick<KnowledgeChatSession, "mode" | "model_id" | "prompt_id" | "is_pinned" | "title">>
  ) => {
    if (!selectedSessionId) return;
    const currentSession = sessions.find((session) => session.id === selectedSessionId);
    if (!currentSession) return;

    await invoke("knowledge_base_update_chat_session", {
      request: {
        session_id: selectedSessionId,
        title: next.title ?? currentSession.title,
        mode: next.mode ?? currentSession.mode,
        model_id: next.model_id ?? localModelId,
        prompt_id: next.prompt_id ?? selectedPromptId,
        is_pinned: next.is_pinned ?? currentSession.is_pinned,
      },
    });
    await refreshSessions();
  }, [localModelId, refreshSessions, selectedPromptId, selectedSessionId, sessions]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      uploadedImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setUploadedImages([]);
      setEditingMessageId(null);
      setEditingMessageValue("");
      if (sessionRuntimesRef.current[sessionId]) {
        setSelectedSessionId(sessionId);
      } else {
        await loadSessionDetail(sessionId);
      }
    } catch (error) {
      console.error("Failed to load knowledge chat session:", error);
    }
  }, [loadSessionDetail, uploadedImages]);

  const handleCreateSession = useCallback(() => {
    uploadedImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setUploadedImages([]);
    const currentMode = sessionRuntimesRef.current[selectedSessionIdRef.current ?? draftIdRef.current]?.mode ?? mode;
    resetDraft({ ...DEFAULT_PREFERENCES, default_mode: currentMode });
  }, [resetDraft, uploadedImages, mode]);

  const handleRenameSession = useCallback(async (sessionId: string) => {
    const title = editingSessionTitle.trim();
    if (!title) {
      setEditingSessionId(null);
      return;
    }
    try {
      await invoke("knowledge_base_rename_chat_session", { sessionId, title });
      await refreshSessions();
      if (selectedSessionId === sessionId) {
        await loadSessionDetail(sessionId);
      }
    } catch (error) {
      console.error("Failed to rename knowledge chat session:", error);
    } finally {
      setEditingSessionId(null);
      setEditingSessionTitle("");
    }
  }, [editingSessionTitle, loadSessionDetail, refreshSessions, selectedSessionId]);

  const handleRequestDeleteSession = useCallback((
    sessionId: string,
    sessionTitle: string,
    triggerRect?: DOMRect | null,
  ) => {
    const runtime = sessionRuntimesRef.current[sessionId];
    if (runtime?.streaming && !runtime.stopping) return;

    if (triggerRect && deleteConfirmAnchorRef.current) {
      const anchorRect = deleteConfirmAnchorRef.current.getBoundingClientRect();
      const horizontalPadding = 12;
      const verticalPadding = 12;
      const panelWidth = Math.min(420, Math.max(320, anchorRect.width - horizontalPadding * 2));
      const panelHeight = 220;
      const gap = 10;
      const arrowSize = 14;
      const triggerLeft = triggerRect.left - anchorRect.left;
      const triggerRight = triggerRect.right - anchorRect.left;
      const triggerTop = triggerRect.top - anchorRect.top;
      const triggerBottom = triggerRect.bottom - anchorRect.top;
      const triggerCenterY = (triggerTop + triggerBottom) / 2;
      const spaceOnLeft = triggerLeft - horizontalPadding;
      const spaceOnRight = anchorRect.width - triggerRight - horizontalPadding;
      const placeOnRight = spaceOnRight >= panelWidth || spaceOnRight >= spaceOnLeft;

      const preferredLeft = placeOnRight
        ? triggerRight + gap
        : triggerLeft - panelWidth - gap;
      const preferredTop = triggerCenterY - panelHeight / 2;
      const maxLeft = anchorRect.width - panelWidth - horizontalPadding;
      const maxTop = anchorRect.height - panelHeight - verticalPadding;
      const top = Math.max(verticalPadding, Math.min(preferredTop, Math.max(verticalPadding, maxTop)));
      const left = Math.max(horizontalPadding, Math.min(preferredLeft, Math.max(horizontalPadding, maxLeft)));
      const arrowTop = Math.max(
        22,
        Math.min(triggerCenterY - top - arrowSize / 2, panelHeight - arrowSize - 22)
      );

      setDeleteConfirmPanelMinWidth(panelWidth);
      setDeleteConfirmPosition({
        top,
        left,
        arrowTop,
        arrowSide: placeOnRight ? "left" : "right",
      });
    } else {
      setDeleteConfirmPanelMinWidth(360);
      setDeleteConfirmPosition({ top: 16, left: 16, arrowTop: 40, arrowSide: "left" });
    }

    setPendingDeleteSessionId(sessionId);
    setPendingDeleteSessionTitle(sessionTitle);
    setDeleteConfirmOpen(true);
  }, []);

  const handleCancelDeleteSession = useCallback(() => {
    setDeleteConfirmOpen(false);
    setPendingDeleteSessionId(null);
    setPendingDeleteSessionTitle("");
    setDeleteConfirmPosition(null);
    setDeleteConfirmPanelMinWidth(null);
  }, []);

  useEffect(() => {
    if (!deleteConfirmOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (deleteConfirmPanelRef.current?.contains(target)) return;
      handleCancelDeleteSession();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [deleteConfirmOpen, handleCancelDeleteSession]);

  const handleConfirmDeleteSession = useCallback(async () => {
    if (!pendingDeleteSessionId) return;
    try {
      await invoke("knowledge_base_delete_chat_session", { sessionId: pendingDeleteSessionId });
      const nextSessions = await refreshSessions();
      if (selectedSessionId === pendingDeleteSessionId) {
        if (nextSessions[0]) {
          await loadSessionDetail(nextSessions[0].id);
        } else {
          resetDraft();
        }
      }
      setDeleteConfirmOpen(false);
      setPendingDeleteSessionId(null);
      setPendingDeleteSessionTitle("");
      setDeleteConfirmPosition(null);
      setDeleteConfirmPanelMinWidth(null);
    } catch (error) {
      console.error("Failed to delete knowledge chat session:", error);
    }
  }, [loadSessionDetail, pendingDeleteSessionId, refreshSessions, resetDraft, selectedSessionId]);

  const handleTogglePinSession = useCallback(async (session: KnowledgeChatSession) => {
    try {
      await invoke("knowledge_base_set_chat_session_pinned", {
        sessionId: session.id,
        isPinned: !session.is_pinned,
      });
      await refreshSessions();
    } catch (error) {
      console.error("Failed to pin knowledge chat session:", error);
    }
  }, [refreshSessions]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const nextImages: UploadedImage[] = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      nextImages.push({
        id: generateTempId(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    });

    setUploadedImages((prev) => [...prev, ...nextImages]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
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
    const nextImages: UploadedImage[] = imageFiles.map((file) => ({
      id: generateTempId(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setUploadedImages((prev) => [...prev, ...nextImages]);
  }, []);

  const handleRemoveImage = useCallback((imageId: string) => {
    setUploadedImages((prev) => {
      const matched = prev.find((item) => item.id === imageId);
      if (matched) URL.revokeObjectURL(matched.previewUrl);
      return prev.filter((item) => item.id !== imageId);
    });
  }, []);

  const fileToBase64 = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const dataUrlToFile = useCallback((dataUrl: string, filename: string) => {
    const [header, base64] = dataUrl.split(",");
    const mime = header.match(/data:(.*?);base64/)?.[1] ?? "image/png";
    const binary = atob(base64 ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mime });
  }, []);

  const handleSend = useCallback(async (
    overrideText?: string,
    overrideEditMessageId?: string | null,
    overrideImageUrls?: string[]
  ) => {
    const sendKey = selectedSessionIdRef.current ?? draftIdRef.current;
    const runtime = sessionRuntimesRef.current[sendKey] ?? createInitialRuntime();

    const normalizedOverride = typeof overrideText === "string" ? overrideText : undefined;
    const text = (normalizedOverride ?? input).trim();
    const effectiveEditMessageId = overrideEditMessageId ?? editingMessageId;
    const usingOverride = typeof normalizedOverride === "string";
    const effectiveImageUrls = overrideImageUrls ?? null;
    const imageCount = effectiveImageUrls ? effectiveImageUrls.length : uploadedImages.length;
    if ((!text && imageCount === 0) || (runtime.streaming && !runtime.stopping)) return;

    if (!runtime.modelId && aiConfigs.length === 0) {
      patchRuntime(sendKey, { composerError: "当前没有可用模型，请先到设置页配置 AI 模型。" });
      return;
    }

    let imagePayload: KnowledgeChatImageData[] | undefined;
    const userImageUrls: string[] = [];
    if (effectiveImageUrls) {
      imagePayload = effectiveImageUrls.map((data) => ({ data }));
      userImageUrls.push(...effectiveImageUrls);
    } else if (uploadedImages.length > 0) {
      const encodedImages = await Promise.all(
        uploadedImages.map(async (item) => await fileToBase64(item.file))
      );
      imagePayload = encodedImages.map((data) => ({ data }));
      userImageUrls.push(...encodedImages);
    }

    const tempUserId = generateTempId();
    const tempAssistantId = generateTempId();
    const optimisticUserMessage: UiMessage = {
      id: tempUserId,
      role: "user",
      content: text,
      status: "completed",
      sources: [],
      agentRun: null,
      imageUrls: userImageUrls.length > 0 ? userImageUrls : undefined,
    };
    const optimisticAssistantMessage: UiMessage = {
      id: tempAssistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      sources: [],
      agentRun: null,
    };

    const editTargetIndex = usingOverride && effectiveEditMessageId
      ? runtime.messages.findIndex((message) => message.id === effectiveEditMessageId)
      : -1;
    const baseMessages = usingOverride && editTargetIndex >= 0
      ? runtime.messages.slice(0, editTargetIndex)
      : runtime.messages;

    const apiMessages = [...baseMessages, optimisticUserMessage]
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }));

    const chatMode = runtime.mode;
    const modelId = runtime.modelId;
    const promptId = runtime.promptId;
    const existingSessionId = isDraftKey(sendKey) ? null : sendKey;

    // 乐观更新 runtime:注入消息并进入流式态
    setSessionRuntimes((prev) => {
      const base = prev[sendKey] ?? createInitialRuntime();
      const messagesList = [...baseMessages, optimisticUserMessage, optimisticAssistantMessage];
      return {
        ...prev,
        [sendKey]: {
          ...base,
          messages: messagesList,
          streaming: true,
          stopping: false,
          pendingAbort: false,
          accumulatedContent: "",
          statusText: chatMode === "agent" ? "正在拆解问题与规划检索步骤..." : "正在检索相关知识...",
          statusQueries: [],
          composerError: null,
          inspectorMessageId: tempAssistantId,
        },
      };
    });

    setInput("");
    uploadedImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setUploadedImages([]);
    setEditingMessageId(null);
    setEditingMessageValue("");

    try {
      const request: KnowledgeChatRequest = {
        session_id: existingSessionId ?? undefined,
        messages: apiMessages,
        model_id: modelId ?? undefined,
        system_prompt: activePrompt?.content ?? undefined,
        prompt_id: promptId ?? undefined,
        images: imagePayload,
        mode: chatMode,
        step_budget: chatMode === "agent" ? 3 : undefined,
        rewrite_from_message_id: usingOverride && effectiveEditMessageId ? effectiveEditMessageId : undefined,
      };

      const response = await invoke<KnowledgeChatSubmitResponse>("knowledge_base_chat", { request });
      const realSessionId = response.session_id;

      // 若 sendKey 是 draft,迁移到真实 sessionId;否则原地更新
      setSessionRuntimes((prev) => {
        const source = prev[sendKey];
        if (!source) return prev;
        const updatedMessages = source.messages.map((m) => {
          if (m.id === tempUserId) return { ...m, id: response.user_message_id };
          if (m.id === tempAssistantId) return { ...m, id: response.assistant_message_id };
          return m;
        });
        const nextRuntime: SessionRuntime = {
          ...source,
          messages: updatedMessages,
          requestId: response.request_id,
          inspectorMessageId: response.assistant_message_id,
        };
        if (sendKey === realSessionId) {
          return { ...prev, [realSessionId]: nextRuntime };
        }
        const { [sendKey]: _removed, ...rest } = prev;
        void _removed;
        return { ...rest, [realSessionId]: nextRuntime };
      });

      // 同步选中态:若用户还在发送时的会话上,跟随迁移到真实 sessionId;否则保持当前选中
      if (isDraftKey(sendKey)) {
        if (selectedSessionIdRef.current === null && draftIdRef.current === sendKey) {
          setSelectedSessionId(realSessionId);
          // 为下次新建分配一个全新的 draftId(避免与迁移后的 key 冲突)
          setDraftId(generateDraftId());
        }
      } else if (selectedSessionIdRef.current === sendKey) {
        setSelectedSessionId(realSessionId);
      }

      startChatListener(realSessionId, response.request_id, chatMode);
      await refreshSessions();
    } catch (error) {
      console.error("Failed to send knowledge chat message:", error);
      setSessionRuntimes((prev) => {
        const source = prev[sendKey];
        if (!source) return prev;
        const updatedMessages = source.messages.map((message) =>
          message.id === tempAssistantId
            ? { ...message, content: `错误: ${error}`, status: "error" as const }
            : message
        );
        return {
          ...prev,
          [sendKey]: {
            ...source,
            messages: updatedMessages,
            streaming: false,
            stopping: false,
            pendingAbort: false,
            requestId: null,
            statusText: null,
            statusQueries: [],
            composerError: `发送失败：${String(error)}`,
          },
        };
      });
    }
  }, [
    activePrompt,
    aiConfigs.length,
    editingMessageId,
    fileToBase64,
    input,
    patchRuntime,
    refreshSessions,
    startChatListener,
    uploadedImages,
  ]);

  const handleAbort = useCallback(async () => {
    const key = selectedSessionIdRef.current ?? draftIdRef.current;
    const runtime = sessionRuntimesRef.current[key];
    if (!runtime?.streaming || runtime.stopping) return;
    const targetRequestId = runtime.requestId;
    mergeRuntime(key, (prev) => {
      const messagesList = [...prev.messages];
      const assistantIndex = [...messagesList].reverse().findIndex((message) => message.role === "assistant");
      if (assistantIndex !== -1) {
        const targetIndex = messagesList.length - 1 - assistantIndex;
        messagesList[targetIndex] = { ...messagesList[targetIndex], status: "aborted" };
      }
      return {
        ...prev,
        messages: messagesList,
        pendingAbort: true,
        stopping: true,
        statusText: null,
        statusQueries: [],
      };
    });
    if (!targetRequestId) return;
    try {
      await invoke("knowledge_base_abort_chat", { requestId: targetRequestId });
    } catch (error) {
      console.error("Failed to abort knowledge chat:", error);
    }
  }, [mergeRuntime]);

  const handleEditMessage = useCallback((message: UiMessage) => {
    uploadedImagesRef.current.forEach((image) => {
      if (image.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(image.previewUrl);
      }
    });
    const restoredImages = (message.imageUrls ?? []).map((url, index) => ({
      id: generateTempId(),
      file: dataUrlToFile(url, `knowledge-chat-image-${index + 1}.png`),
      previewUrl: url,
    }));
    setUploadedImages(restoredImages);
    setEditingMessageId(message.id);
    setEditingMessageValue(message.content);
    setInput(message.content);
    patchRuntime(selectedSessionIdRef.current ?? draftIdRef.current, { composerError: null });
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [dataUrlToFile, patchRuntime]);

  const handleRetryMessage = useCallback((message: UiMessage) => {
    patchRuntime(selectedSessionIdRef.current ?? draftIdRef.current, { composerError: null });
    void handleSend(message.content, message.id, message.imageUrls);
  }, [handleSend, patchRuntime]);

  const handleCancelEdit = useCallback(() => {
    uploadedImagesRef.current.forEach((image) => {
      if (image.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(image.previewUrl);
      }
    });
    setUploadedImages([]);
    setEditingMessageId(null);
    setEditingMessageValue("");
    setInput("");
    patchRuntime(selectedSessionIdRef.current ?? draftIdRef.current, { composerError: null });
  }, [patchRuntime]);

  const handleCopyMessage = useCallback((content: string) => {
    void copyText(content);
  }, []);

  const handleModeChange = useCallback((nextMode: KnowledgeChatMode) => {
    const currentKey = selectedSessionIdRef.current ?? draftIdRef.current;
    const runtime = sessionRuntimesRef.current[currentKey];
    if (runtime?.mode === nextMode) return;

    const currentSession = sessions.find((item) => item.id === selectedSessionIdRef.current);
    if (!currentSession || currentSession.mode !== nextMode) {
      // 切到另一模式的新 draft;现有 runtime(含后台流式)保留在 map 中
      const newDraft = generateDraftId();
      setSessionRuntimes((prev) => ({
        ...prev,
        [newDraft]: createInitialRuntime({
          mode: nextMode,
          modelId: runtime?.modelId ?? null,
          promptId: runtime?.promptId ?? null,
        }),
      }));
      setDraftId(newDraft);
      setSelectedSessionId(null);
      setInput("");
      setEditingMessageId(null);
      setEditingMessageValue("");
      uploadedImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setUploadedImages([]);
    } else {
      patchRuntime(currentKey, { mode: nextMode });
    }
  }, [patchRuntime, sessions]);

  const handleModelChange = useCallback(async (nextModelId: string | null) => {
    const currentKey = selectedSessionIdRef.current ?? draftIdRef.current;
    patchRuntime(currentKey, { modelId: nextModelId });
    setShowModelDropdown(false);
    if (selectedSessionIdRef.current) {
      try {
        await persistCurrentSessionMeta({ model_id: nextModelId });
      } catch (error) {
        console.error("Failed to update session model:", error);
      }
    }
  }, [patchRuntime, persistCurrentSessionMeta]);

  const handlePromptChange = useCallback(async (nextPromptId: string | null) => {
    const currentKey = selectedSessionIdRef.current ?? draftIdRef.current;
    patchRuntime(currentKey, { promptId: nextPromptId });
    setShowPromptDropdown(false);
    if (selectedSessionIdRef.current) {
      try {
        await persistCurrentSessionMeta({ prompt_id: nextPromptId });
      } catch (error) {
        console.error("Failed to update session prompt:", error);
      }
    }
  }, [patchRuntime, persistCurrentSessionMeta]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend(editingMessageId ? editingMessageValue : undefined, editingMessageId);
    }
  }, [editingMessageId, editingMessageValue, handleSend]);

  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant") ?? null;

  useEffect(() => {
    if (!selectedSessionId || messages.length === 0 || streaming) return;
    const firstUserMessage = messages.find((message) => message.role === "user");
    const session = sessions.find((item) => item.id === selectedSessionId);
    if (!firstUserMessage || !session || !isDefaultSessionTitle(session.title)) return;

    const nextTitle = buildSessionTitleFromMessage(firstUserMessage.content);
    if (!nextTitle || nextTitle === session.title) return;

    void persistCurrentSessionMeta({ title: nextTitle }).catch((error) => {
      console.error("Failed to auto update session title:", error);
    });
  }, [messages, persistCurrentSessionMeta, selectedSessionId, sessions, streaming]);

  return (
    <div ref={rootRef} className="flex h-full overflow-hidden">
      <aside className="w-[280px] border-r border-slate-200/70 dark:border-vnote-border/70 bg-white/56 dark:bg-vnote-card/28 backdrop-blur-xl flex flex-col">
        <div className="p-4 border-b border-slate-200/70 dark:border-vnote-border/70">
          <button
            onClick={handleCreateSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4" />
            新建对话
          </button>
        </div>

        <div className="px-4 pt-4 space-y-3 border-b border-slate-200/70 dark:border-vnote-border/70 pb-4">
          <div className="flex items-center gap-2 rounded-xl bg-slate-100/80 dark:bg-black/20 p-1">
            <button
              onClick={() => void handleModeChange("standard")}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                mode === "standard"
                  ? cn(glassMenu, "text-blue-600 dark:text-blue-400 shadow-sm")
                  : "text-slate-600 dark:text-slate-400"
              )}
            >
              标准模式
            </button>
            <button
              onClick={() => void handleModeChange("agent")}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                mode === "agent"
                  ? cn(glassMenu, "text-violet-600 dark:text-violet-400 shadow-sm")
                  : "text-slate-600 dark:text-slate-400"
              )}
            >
              Agent 模式
            </button>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {mode === "agent"
              ? "适合复杂问题：自动规划、多轮检索、证据汇总与轨迹展示。"
              : "适合快速问答：单次检索、直接回答、重点展示引用来源。"}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredSessions.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-500">
              {mode === "agent" ? "Agent 模式下还没有历史会话" : "标准模式下还没有历史会话"}
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isSelected = session.id === selectedSessionId;
              const isEditing = session.id === editingSessionId;
              const sessionRuntime = sessionRuntimes[session.id];
              const isSessionStreaming = Boolean(sessionRuntime?.streaming);
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group rounded-2xl border transition-colors",
                    isSelected
                      ? "border-blue-300/80 dark:border-blue-700/70 bg-blue-50/70 dark:bg-blue-900/10"
                      : "border-transparent hover:border-slate-200/80 dark:hover:border-vnote-border/80 hover:bg-white/55 dark:hover:bg-white/5"
                  )}
                >
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => void handleSelectSession(session.id)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                              session.mode === "agent"
                                ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                            )}
                          >
                            {session.mode === "agent" ? "Agent" : "标准"}
                          </span>
                          {session.is_pinned && <Pin className="w-3 h-3 text-amber-500" />}
                          {isSessionStreaming && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                              生成中
                            </span>
                          )}
                        </div>
                        {isEditing ? (
                          <input
                            value={editingSessionTitle}
                            onChange={(event) => setEditingSessionTitle(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onBlur={() => void handleRenameSession(session.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleRenameSession(session.id);
                              }
                              if (event.key === "Escape") {
                                setEditingSessionId(null);
                                setEditingSessionTitle("");
                              }
                            }}
                            className={cn("w-full px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20", glassInput)}
                            autoFocus
                          />
                        ) : (
                          <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                            {session.title}
                          </div>
                        )}
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500 truncate">
                          {session.last_message_at ?? session.updated_at}
                        </div>
                      </button>

                      {!isEditing && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => void handleTogglePinSession(session)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 cursor-pointer transition-colors"
                            title={session.is_pinned ? "取消固定" : "固定会话"}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingSessionId(session.id);
                              setEditingSessionTitle(session.title);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 cursor-pointer transition-colors"
                            title="重命名"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(event) => handleRequestDeleteSession(
                              session.id,
                              session.title,
                              event.currentTarget.getBoundingClientRect()
                            )}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <div ref={deleteConfirmAnchorRef} className="flex-1 min-w-0 flex relative">
        {deleteConfirmOpen && deleteConfirmPosition && (
          <div
            ref={deleteConfirmPanelRef}
            className={cn("absolute z-20 w-[420px] max-w-[calc(100%-1.5rem)] rounded-[22px] border border-slate-200/80 dark:border-vnote-border/80 shadow-[0_24px_80px_rgba(15,23,42,0.16)] overflow-visible animate-fade-in", glassModal)}
            style={{ top: deleteConfirmPosition.top, left: deleteConfirmPosition.left, minWidth: deleteConfirmPanelMinWidth ?? undefined }}
          >
            <div
              className={cn(
                cn("absolute h-3.5 w-3.5 border-t border-l border-slate-200/80 dark:border-vnote-border/80", glassModal),
                deleteConfirmPosition.arrowSide === "left"
                  ? "-left-[7px] rotate-[-45deg]"
                  : "-right-[7px] rotate-[135deg]"
              )}
              style={{ top: deleteConfirmPosition.arrowTop }}
            />
            <div className="overflow-hidden rounded-[22px]">
              <div className={cn("flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 py-4 dark:border-vnote-border/70", glassModal)}>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-red-500/80 dark:text-red-300/80">
                    Danger Zone
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
                    确认删除对话
                  </div>
                </div>
                <button
                  onClick={handleCancelDeleteSession}
                  className="cursor-pointer rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-200"
                  data-tauri-drag-region="false"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-5 py-4">
                <div className="rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-500 text-white shadow-sm">
                      <Trash2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        删除后将无法恢复
                      </div>
                      <div className="mt-1 break-all text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {pendingDeleteSessionTitle ? (
                          <>
                            你将删除对话
                            <span
                              className="mx-1 inline-flex max-w-[240px] truncate rounded-lg bg-white/40 px-2 py-0.5 align-bottom font-medium text-slate-700 dark:bg-black/20 dark:text-slate-200"
                              title={pendingDeleteSessionTitle}
                            >
                              “{pendingDeleteSessionTitle}”
                            </span>
                          </>
                        ) : "你将删除当前对话。"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={handleCancelDeleteSession}
                    className="cursor-pointer rounded-xl border border-slate-200/80 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-vnote-border/80 dark:text-slate-300 dark:hover:bg-white/5"
                    data-tauri-drag-region="false"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => void handleConfirmDeleteSession()}
                    className="cursor-pointer rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(239,68,68,0.28)] transition-colors hover:bg-red-600"
                    data-tauri-drag-region="false"
                  >
                    确认删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200/70 dark:border-vnote-border/70 bg-white/48 dark:bg-vnote-card/22 backdrop-blur-xl">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {selectedSession?.title ?? (mode === "agent" ? "新建 Agent 对话" : "新建知识库对话")}
                </h3>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                    mode === "agent"
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                  )}
                >
                  {mode === "agent" ? "多步检索" : "快速问答"}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-400 truncate">
                回答严格基于当前知识库内容
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCompactMessageDensity((prev) => !prev)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer",
                  compactMessageDensity
                    ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                    : "border-slate-200/80 dark:border-vnote-border/80 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5"
                )}
              >
                紧凑显示
              </button>
              <button
                onClick={() => setShowRightPanel((prev) => !prev)}
                className="p-2 rounded-xl border border-slate-200/80 dark:border-vnote-border/80 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                title={showRightPanel ? "隐藏侧栏" : "显示侧栏"}
              >
                {showRightPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className={cn("flex-1 overflow-y-auto px-5", compactMessageDensity ? "py-3 space-y-3" : "py-5 space-y-4") }>
            {messages.length === 0 && !streaming ? (
              <div className="h-full flex items-center justify-center">
                <div className="max-w-xl text-center">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-blue-500 flex items-center justify-center mb-4">
                    {mode === "agent" ? <Sparkles className="w-7 h-7" /> : <Bot className="w-7 h-7" />}
                  </div>
                  <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-2">
                    {mode === "agent" ? "让 Agent 在本地知识库中多步检索与分析" : "基于本地知识库快速问答"}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 leading-7">
                    {mode === "agent"
                      ? "适合比较、归纳、找差异、查证据缺口等复杂问题。右侧会展示检索轨迹与证据汇总。"
                      : "适合快速追问某个主题。系统会先检索知识片段，再基于证据生成回答。"}
                  </div>
                  <div className="mt-5 grid gap-3 text-left sm:grid-cols-2">
                    <div className={cn("rounded-2xl border border-white/60 dark:border-white/8 p-4", glassCard)}>
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">推荐提问方式</div>
                      <div className="mt-2 text-xs leading-6 text-slate-600 dark:text-slate-400">
                        {mode === "agent"
                          ? "例如：比较几篇笔记对同一主题的共识与差异，指出证据缺口。"
                          : "例如：这组笔记里如何定义某个概念？有哪些关键结论？"}
                      </div>
                    </div>
                    <div className={cn("rounded-2xl border border-white/60 dark:border-white/8 p-4", glassCard)}>
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">当前回答范围</div>
                      <div className="mt-2 text-xs leading-6 text-slate-600 dark:text-slate-400">
                        只基于当前知识库检索结果回答；如果证据不足，会明确说明缺少哪些依据。
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <Fragment key={message.id}>
                    {statusText && index === streamingAssistantIndex && (
                      <div className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/36 dark:bg-vnote-card/42 backdrop-blur-xl px-4 py-3 shadow-soft">
                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          <span>{statusText}</span>
                        </div>
                        {statusQueries.length > 0 && (
                          <>
                            <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                              当前检索子问题
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {statusQueries.map((query) => (
                                <span
                                  key={query}
                                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] bg-slate-100 dark:bg-black/20 text-slate-600 dark:text-slate-400"
                                >
                                  {query}
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    <MessageCard
                      message={message}
                      compact={compactMessageDensity}
                      isSelected={selectedInspectorMessage?.id === message.id}
                      onSelect={() => {
                        if (message.role === "assistant") {
                          patchRuntime(activeRuntimeKey, { inspectorMessageId: message.id });
                        }
                      }}
                      onCopy={handleCopyMessage}
                      onEdit={handleEditMessage}
                      onRetry={handleRetryMessage}
                      canEdit={(!streaming || stopping) && message.role === "user"}
                      canRetry={(!streaming || stopping) && message.role === "user"}
                      onCitationClick={(rank) => handleCitationClick(message.id, rank)}
                      activeCitationRank={
                        activeCitation?.messageId === message.id ? activeCitation.rank : null
                      }
                    />
                  </Fragment>
                ))}
                {statusText && streamingAssistantIndex === -1 && (
                  <div className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/36 dark:bg-vnote-card/42 backdrop-blur-xl px-4 py-3 shadow-soft">
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span>{statusText}</span>
                    </div>
                    {statusQueries.length > 0 && (
                      <>
                        <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                          当前检索子问题
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {statusQueries.map((query) => (
                            <span
                              key={query}
                              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] bg-slate-100 dark:bg-black/20 text-slate-600 dark:text-slate-400"
                            >
                              {query}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 border-t border-slate-200/70 dark:border-vnote-border/70 bg-white/42 dark:bg-vnote-card/18 backdrop-blur-xl">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="rounded-[24px] border border-slate-200/80 dark:border-vnote-border/80 bg-white/40 dark:bg-vnote-card/44 backdrop-blur-xl overflow-hidden shadow-soft focus-within:ring-2 focus-within:ring-blue-500/20">
              {editingMessageId && (
                <div className="px-4 pt-4 pb-1 flex items-center justify-between gap-3">
                  <div className="text-xs text-amber-600 dark:text-amber-300">
                    正在编辑上一条提问，发送后会从这里重新生成后续回答。
                  </div>
                  <button
                    onClick={handleCancelEdit}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
                  >
                    取消编辑
                  </button>
                </div>
              )}
              {uploadedImages.length > 0 && (
                <div className="px-4 pt-4 flex flex-wrap gap-2">
                  {uploadedImages.map((image) => (
                    <div key={image.id} className="relative">
                      <img
                        src={image.previewUrl}
                        alt="预览"
                        className="w-16 h-16 rounded-xl object-cover border border-slate-200/80 dark:border-vnote-border/80"
                      />
                      <button
                        onClick={() => handleRemoveImage(image.id)}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-700 text-white flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (editingMessageId) {
                    setEditingMessageValue(event.target.value);
                  }
                  if (composerError) {
                    patchRuntime(activeRuntimeKey, { composerError: null });
                  }
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={4}
                placeholder={mode === "agent" ? "输入复杂问题，Agent 会自动规划、多轮检索并给出结论..." : "输入问题，系统会检索知识库并回答..."}
                className="w-full px-4 pt-4 pb-2 bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 resize-none focus:outline-none"
              />

              {composerError && (
                <div className="mx-4 mt-1 mb-0 rounded-2xl border border-red-200/80 dark:border-red-900/60 bg-red-50/80 dark:bg-red-900/10 px-3 py-2">
                  <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-300">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{composerError}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 px-3 py-3 border-t border-slate-200/60 dark:border-vnote-border/60">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    title="上传图片"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <div ref={modelDropdownRef} className="relative">
                    <button
                      onClick={() => {
                        setShowModelDropdown((prev) => !prev);
                        setShowPromptDropdown(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-slate-200/80 dark:border-vnote-border/80 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span className="max-w-[140px] truncate">{activeModel?.title ?? "选择模型"}</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showModelDropdown && (
                      <div className="absolute bottom-full left-0 mb-2 w-60 rounded-2xl border border-white/45 dark:border-vnote-border/80 bg-white/45 dark:bg-vnote-card/68 backdrop-blur-2xl shadow-[0_20px_55px_rgba(15,23,42,0.22)] z-50 p-1 max-h-64 overflow-y-auto">
                        {aiConfigs.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">未配置 AI 模型</div>
                        ) : (
                          aiConfigs.map((config) => (
                            <button
                              key={config.id}
                              onClick={() => void handleModelChange(config.id)}
                              className={cn(
                                "w-full text-left px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors",
                                config.id === localModelId
                                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300"
                                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
                              )}
                            >
                              {config.title}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div ref={promptDropdownRef} className="relative">
                    <button
                      onClick={() => {
                        setShowPromptDropdown((prev) => !prev);
                        setShowModelDropdown(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-slate-200/80 dark:border-vnote-border/80 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <ScrollText className="w-3.5 h-3.5" />
                      <span className="max-w-[140px] truncate">{activePrompt?.title ?? "提示词"}</span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showPromptDropdown && (
                      <div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-white/45 dark:border-vnote-border/80 bg-white/45 dark:bg-vnote-card/68 backdrop-blur-2xl shadow-[0_20px_55px_rgba(15,23,42,0.22)] z-50 p-1 max-h-72 overflow-y-auto">
                        <button
                          onClick={() => void handlePromptChange(null)}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors",
                            !selectedPromptId
                              ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
                          )}
                        >
                          无提示词
                        </button>
                        {availablePromptConfigs.map((config) => (
                          <button
                            key={config.id}
                            onClick={() => void handlePromptChange(config.id)}
                            className={cn(
                              "w-full text-left px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors",
                              config.id === selectedPromptId
                                ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
                            )}
                          >
                            <div className="font-medium truncate">{config.title}</div>
                            {config.description && (
                              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500 truncate">
                                {config.description}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="hidden md:inline text-[11px] text-slate-400 dark:text-slate-500">
                    Enter 发送 · Shift+Enter 换行
                  </span>
                  {streaming && !stopping ? (
                    <button
                      onClick={handleAbort}
                      className="w-10 h-10 rounded-xl bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors cursor-pointer"
                      title="停止生成"
                    >
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleSend(editingMessageId ? editingMessageValue : undefined, editingMessageId)}
                      disabled={((streaming && !stopping) || (!(editingMessageId ? editingMessageValue.trim() : input.trim()) && uploadedImages.length === 0))}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer",
                        (editingMessageId ? editingMessageValue.trim() : input.trim()) || uploadedImages.length > 0
                          ? "bg-blue-500 hover:bg-blue-600 text-white"
                          : "bg-slate-100 dark:bg-neutral-700 text-slate-400 cursor-not-allowed"
                      )}
                      title="发送"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {showRightPanel && (
          <aside className="w-[340px] border-l border-slate-200/70 dark:border-vnote-border/70 bg-white/56 dark:bg-vnote-card/28 backdrop-blur-xl flex flex-col">
            <div className="px-4 py-4 border-b border-slate-200/70 dark:border-vnote-border/70">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">证据与轨迹</div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {selectedInspectorMessage ? "查看当前回答的引用与执行过程" : "选择一条 AI 回答查看详情"}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => setShowSourcesExpanded((prev) => !prev)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors",
                    showSourcesExpanded
                      ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                      : "border-slate-200/80 dark:border-vnote-border/80 text-slate-600 dark:text-slate-400"
                  )}
                >
                  来源展开
                </button>
                <button
                  onClick={() => setShowAgentTrace((prev) => !prev)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors",
                    showAgentTrace
                      ? "border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300"
                      : "border-slate-200/80 dark:border-vnote-border/80 text-slate-600 dark:text-slate-400"
                  )}
                >
                  轨迹展示
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <section className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/36 dark:bg-vnote-card/38 backdrop-blur-xl overflow-hidden shadow-soft">
                <div className="px-4 py-3 border-b border-slate-200/60 dark:border-vnote-border/60 flex items-center gap-2">
                  <Search className="w-4 h-4 text-blue-500" />
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">引用来源</div>
                  <div className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                    {selectedInspectorMessage?.sources.length ?? latestAssistantMessage?.sources.length ?? 0} 条
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  {(selectedInspectorMessage?.sources ?? latestAssistantMessage?.sources ?? []).length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-500 leading-6">
                      {selectedInspectorMessage?.status === "error"
                        ? "这次回答在生成阶段报错，还没有成功落库来源。"
                        : selectedInspectorMessage?.status === "aborted"
                          ? "这次回答已中止，系统没有保留完整来源。"
                          : "当前回答暂无可展示来源，可能是检索未命中或结果仍在整理中。"}
                    </div>
                  ) : (
                    (selectedInspectorMessage?.sources ?? latestAssistantMessage?.sources ?? []).map((source, index) => {
                      const rank = index + 1;
                      const sourceMessageId = selectedInspectorMessage?.id ?? latestAssistantMessage?.id;
                      const isActive =
                        !!sourceMessageId &&
                        activeCitation?.messageId === sourceMessageId &&
                        activeCitation?.rank === rank;
                      return (
                        <button
                          key={source.chunk_id}
                          id={sourceMessageId ? `kb-source-${sourceMessageId}-${rank}` : undefined}
                          onClick={() => void handleNavigateToNote(source.note_id)}
                          className={cn(
                            "w-full text-left p-3 rounded-xl border bg-white/36 dark:bg-black/10 transition-all cursor-pointer",
                            isActive
                              ? "border-blue-400 dark:border-blue-500 ring-2 ring-blue-400/40 citation-pulse"
                              : "border-slate-200/70 dark:border-vnote-border/70 hover:border-blue-300 dark:hover:border-blue-700"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                                <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-md border border-blue-200 bg-blue-50 text-[11px] font-medium text-blue-600 leading-none flex-shrink-0 dark:border-blue-800/70 dark:bg-blue-900/25 dark:text-blue-200">
                                  {rank}
                                </span>
                                <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{source.note_title}</span>
                              </div>
                              {showSourcesExpanded && (
                                <div className="mt-2 text-xs leading-6 text-slate-600 dark:text-slate-400 line-clamp-5">
                                  {source.content}
                                </div>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-500 flex-shrink-0">
                              {(source.score * 100).toFixed(1)}%
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              {showAgentTrace && (
                <section className="rounded-2xl border border-slate-200/80 dark:border-vnote-border/80 bg-white/36 dark:bg-vnote-card/38 backdrop-blur-xl overflow-hidden shadow-soft">
                  <div className="px-4 py-3 border-b border-slate-200/60 dark:border-vnote-border/60 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-500" />
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Agent 轨迹</div>
                    <div className="ml-auto text-xs text-slate-500 dark:text-slate-500">
                      {selectedInspectorMessage?.agentRun?.trace_steps.length ?? 0} 步
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {!selectedInspectorMessage?.agentRun ? (
                      <div className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-500 leading-6">
                        {selectedInspectorMessage?.status === "error"
                          ? "这次 Agent 执行在完成前出错，轨迹可能只有部分步骤。"
                          : "当前回答不是 Agent 结果，或轨迹尚未生成。"}
                      </div>
                    ) : (
                      <>
                        <div className="px-1 pb-2 text-[11px] text-slate-400 dark:text-slate-500">
                          状态：{selectedInspectorMessage.agentRun.run.status} · 检索轮次预算：{selectedInspectorMessage.agentRun.run.iteration_count}
                        </div>
                        {selectedInspectorMessage.agentRun.trace_steps.map((step) => {
                          const metadataSections = parseTraceMetadata(step.metadata_json);
                          return (
                            <div
                              key={step.id}
                              className="p-3 rounded-xl border border-slate-200/70 dark:border-vnote-border/70 bg-white/36 dark:bg-black/10"
                            >
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                                  {step.step_index + 1}
                                </span>
                                <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{step.title}</div>
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">
                                  {step.step_type}
                                </span>
                              </div>
                              <div className="text-xs leading-6 text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                                {step.content}
                              </div>
                              {metadataSections.length > 0 && (
                                <div className="mt-3 space-y-2 border-t border-slate-200/60 dark:border-vnote-border/60 pt-3">
                                  {metadataSections.map((section) => (
                                    <div key={`${step.id}-${section.label}`}>
                                      <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                        {section.label}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-2">
                                        {section.value.map((item, index) => (
                                          <span
                                            key={`${step.id}-${section.label}-${index}`}
                                            className="inline-flex items-center rounded-full px-2 py-1 text-[11px] bg-slate-100 dark:bg-black/20 text-slate-600 dark:text-slate-400 max-w-full break-all"
                                          >
                                            {item}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </section>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function MessageCard({
  message,
  compact,
  isSelected,
  onSelect,
  onCopy,
  onEdit,
  onRetry,
  canEdit,
  canRetry,
  onCitationClick,
  activeCitationRank,
}: {
  message: UiMessage;
  compact: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onCopy: (content: string) => void;
  onEdit: (message: UiMessage) => void;
  onRetry: (message: UiMessage) => void;
  canEdit: boolean;
  canRetry: boolean;
  onCitationClick?: (rank: number) => void;
  activeCitationRank?: number | null;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!message.content) return;
    onCopy(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "", compact ? "" : "") }>
      <div
        className={cn(
          "w-8 h-8 rounded-2xl flex items-center justify-center flex-shrink-0 text-white text-[11px] font-semibold",
          isUser ? "bg-gradient-to-br from-blue-500 to-indigo-500" : "bg-gradient-to-br from-orange-400 to-amber-500"
        )}
      >
        {isUser ? "我" : "AI"}
      </div>

      <div className={cn("min-w-0 max-w-[82%] group", isUser ? "items-end" : "items-start") }>
        <div
          onClick={onSelect}
          className={cn(
            "rounded-2xl px-4 transition-all",
            compact ? "py-3" : "py-3.5",
            isUser
              ? "bg-slate-200 dark:bg-neutral-700 text-slate-800 dark:text-slate-100 rounded-tr-sm"
              : "bg-white/42 dark:bg-vnote-card/56 border border-slate-200/80 dark:border-vnote-border/80 text-slate-700 dark:text-slate-200 rounded-tl-sm shadow-soft cursor-default",
            !isUser && isSelected && "border-blue-300 dark:border-blue-700 ring-2 ring-blue-500/10"
          )}
        >
          {isUser ? (
            <div className="text-sm leading-7 whitespace-pre-wrap">
              {message.imageUrls && message.imageUrls.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {message.imageUrls.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt="附件"
                      className="max-w-full w-auto h-auto max-h-64 object-contain rounded-xl border border-slate-300 dark:border-neutral-600"
                    />
                  ))}
                </div>
              )}
              {message.content}
            </div>
          ) : message.content ? (
            <MarkdownRenderer
              content={message.content}
              variant="chat"
              className="text-sm leading-7"
              enableEvidenceCitations={!isUser}
              citationSources={message.sources}
              onCitationClick={onCitationClick}
              activeCitationRank={activeCitationRank}
            />
          ) : message.status === "streaming" ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-500 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.25s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.12s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
            </div>
          ) : (
            <div className="text-sm leading-7 text-slate-500 dark:text-slate-500">
              已中止
            </div>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-wrap">
          {!isUser && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-600 dark:text-slate-400 bg-white/70 dark:bg-transparent hover:text-slate-800 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "已复制" : "复制"}
            </button>
          )}
          {isUser && canEdit && (
            <button
              onClick={() => onEdit(message)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-600 dark:text-slate-400 bg-white/70 dark:bg-transparent hover:text-blue-600 dark:hover:text-blue-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              编辑后重问
            </button>
          )}
          {isUser && canRetry && (
            <button
              onClick={() => onRetry(message)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-600 dark:text-slate-400 bg-white/70 dark:bg-transparent hover:text-violet-600 dark:hover:text-violet-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重新生成
            </button>
          )}
          {message.agentRun && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-300 cursor-default">
              <Sparkles className="w-3.5 h-3.5" />
              Agent
            </span>
          )}
          {message.sources.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300 cursor-default">
              <FileText className="w-3.5 h-3.5" />
              {message.sources.length} 条来源
            </span>
          )}
          {message.status === "error" && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300 cursor-default">
              <AlertCircle className="w-3.5 h-3.5" />
              生成失败
            </span>
          )}
          {message.status === "aborted" && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300 cursor-default">
              <Square className="w-3 h-3 fill-current" />
              已中止
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
