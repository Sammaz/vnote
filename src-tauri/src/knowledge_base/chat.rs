use crate::ai_pool::{
    execute_non_streaming_with_abort, execute_streaming_chat, get_ai_pool_manager, ChatMessage as AiChatMessage,
    ImageData, NonStreamingRequest, StreamingChatRequest,
};
use crate::db::{AiConfig, Database, KnowledgeAgentTraceStep, KnowledgeChatMessage, KnowledgeChatSession};
use crate::DATABASE;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, Listener};
use tokio::sync::Mutex;

use super::search;
use super::types::{
    ChatMessage, KnowledgeAgentRunRecord, KnowledgeChatEvent, KnowledgeChatMode,
    KnowledgeChatRequest, KnowledgeChatSessionDetail, KnowledgeChatSubmitResponse,
    KnowledgeSearchResult,
};

static CHAT_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

const DEFAULT_STANDARD_TITLE: &str = "新建知识库对话";
const DEFAULT_AGENT_TITLE: &str = "新建 Agent 对话";
const DEFAULT_AGENT_STEP_BUDGET: i32 = 3;
const AGENT_TOP_K: i32 = 8;
const STANDARD_TOP_K: i32 = 8;
const AUTO_TITLE_MAX_CHARS: usize = 26;

fn merge_stream_fragment(accumulated: &mut String, incoming: &str) -> String {
    if incoming.is_empty() {
        return String::new();
    }

    if accumulated.is_empty() {
        accumulated.push_str(incoming);
        return incoming.to_string();
    }

    if incoming.starts_with(accumulated.as_str()) {
        let suffix = incoming[accumulated.len()..].to_string();
        accumulated.clear();
        accumulated.push_str(incoming);
        return suffix;
    }

    if accumulated.starts_with(incoming) || accumulated.ends_with(incoming) {
        return String::new();
    }

    let max_overlap = accumulated.len().min(incoming.len());
    let mut overlap = 0;

    for candidate in (1..=max_overlap).rev() {
        let accumulated_start = accumulated.len() - candidate;
        if !accumulated.is_char_boundary(accumulated_start) || !incoming.is_char_boundary(candidate) {
            continue;
        }

        if accumulated[accumulated_start..] == incoming[..candidate] {
            overlap = candidate;
            break;
        }
    }

    let suffix = incoming[overlap..].to_string();
    accumulated.push_str(&suffix);
    suffix
}

fn get_abort_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    CHAT_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_db() -> Result<&'static Database, String> {
    DATABASE.get().ok_or_else(|| "Database not initialized".to_string())
}

struct PreparedChat {
    event_name: String,
    mode: KnowledgeChatMode,
    session: KnowledgeChatSession,
    ai_config: AiConfig,
    user_record: KnowledgeChatMessage,
    assistant_record: KnowledgeChatMessage,
}

pub async fn chat(
    app: AppHandle,
    request: KnowledgeChatRequest,
    request_id: String,
) -> Result<KnowledgeChatSubmitResponse, String> {
    let db = get_db()?;
    let abort_flag = register_abort_flag(&request_id).await;
    let prepared = match prepare_chat(db, &request, &request_id) {
        Ok(prepared) => prepared,
        Err(error) => {
            cleanup_abort_flag(&request_id).await;
            return Err(error);
        }
    };

    let response = KnowledgeChatSubmitResponse {
        request_id: request_id.clone(),
        session_id: prepared.session.id.clone(),
        user_message_id: prepared.user_record.id.clone(),
        assistant_message_id: prepared.assistant_record.id.clone(),
    };
    let assistant_message_id = response.assistant_message_id.clone();

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app_for_task.emit(
            &prepared.event_name,
            KnowledgeChatEvent::SessionReady {
                session_id: prepared.session.id.clone(),
                user_message_id: prepared.user_record.id.clone(),
                assistant_message_id: prepared.assistant_record.id.clone(),
                mode: prepared.mode.clone(),
            },
        );

        let result = run_chat_task(
            app_for_task.clone(),
            db,
            request,
            request_id.clone(),
            abort_flag.clone(),
            prepared,
        )
        .await;

        if let Err(error) = result {
            let status = if abort_flag.load(Ordering::Relaxed) {
                "aborted"
            } else {
                "error"
            };
            let error_message = if status == "error" {
                Some(error.as_str())
            } else {
                None
            };
            let existing_content = db
                .get_knowledge_chat_message_by_id(&assistant_message_id)
                .ok()
                .flatten()
                .map(|message| message.content)
                .unwrap_or_default();
            let _ = db.update_knowledge_chat_message_content(
                &assistant_message_id,
                &existing_content,
                status,
                error_message,
            );
            if status == "error" {
                let _ = app_for_task.emit(&format!("knowledge-chat-{}", request_id), KnowledgeChatEvent::Error {
                    error,
                });
            }
        }

        cleanup_abort_flag(&request_id).await;
    });

    Ok(response)
}

pub async fn abort_chat(request_id: &str) -> Result<(), String> {
    {
        let flags = get_abort_flags().lock().await;
        if let Some(flag) = flags.get(request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    get_ai_pool_manager().abort_request(request_id).await.ok();
    Ok(())
}

pub fn list_sessions() -> Result<Vec<KnowledgeChatSession>, String> {
    let db = get_db()?;
    db.get_knowledge_chat_sessions().map_err(|e| e.to_string())
}

pub fn get_session_detail(session_id: &str) -> Result<KnowledgeChatSessionDetail, String> {
    let db = get_db()?;
    let session = db
        .get_knowledge_chat_session_by_id(session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "会话不存在".to_string())?;

    let messages = db
        .get_knowledge_chat_messages(session_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|message| hydrate_message_record(db, message))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(KnowledgeChatSessionDetail { session, messages })
}

pub fn delete_session(session_id: &str) -> Result<(), String> {
    let db = get_db()?;
    db.delete_knowledge_chat_session(session_id)
        .map_err(|e| e.to_string())
}

pub fn rename_session(session_id: &str, title: &str) -> Result<(), String> {
    let db = get_db()?;
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("标题不能为空".to_string());
    }
    db.rename_knowledge_chat_session(session_id, trimmed)
        .map_err(|e| e.to_string())
}

pub fn pin_session(session_id: &str, is_pinned: bool) -> Result<(), String> {
    let db = get_db()?;
    db.set_knowledge_chat_session_pinned(session_id, is_pinned)
        .map_err(|e| e.to_string())
}

pub fn get_preferences() -> Result<Option<super::types::KnowledgeChatPreferencesPayload>, String> {
    let db = get_db()?;
    db.get_knowledge_chat_preferences()
        .map(|pref| pref.map(Into::into))
        .map_err(|e| e.to_string())
}

pub fn save_preferences(
    payload: super::types::KnowledgeChatPreferencesPayload,
) -> Result<super::types::KnowledgeChatPreferencesPayload, String> {
    let db = get_db()?;
    db.upsert_knowledge_chat_preferences(
        payload.id.as_deref(),
        payload.default_mode.as_str(),
        payload.default_model_id.as_deref(),
        payload.default_prompt_id.as_deref(),
        payload.show_agent_trace,
        payload.show_sources_expanded,
        payload.compact_message_density,
    )
    .map(Into::into)
    .map_err(|e| e.to_string())
}

fn hydrate_message_record(
    db: &Database,
    message: KnowledgeChatMessage,
) -> Result<super::types::KnowledgeChatMessageRecord, String> {
    let sources = db
        .get_knowledge_chat_message_sources(&message.id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|source| super::types::KnowledgeChatMessageSourceRecord {
            result: Some(KnowledgeSearchResult {
                chunk_id: source.chunk_id.clone(),
                note_id: source.note_id.clone(),
                note_title: resolve_note_title(db, &source.note_id),
                content: resolve_chunk_content(db, &source.chunk_id),
                score: source.score.unwrap_or_default(),
            }),
            source,
        })
        .collect::<Vec<_>>();

    let agent_run = db
        .get_knowledge_agent_run_by_message_id(&message.id)
        .map_err(|e| e.to_string())?
        .map(|run| -> Result<KnowledgeAgentRunRecord, String> {
            let trace_steps = db
                .get_knowledge_agent_trace_steps(&run.id)
                .map_err(|e| e.to_string())?;
            Ok(KnowledgeAgentRunRecord { run, trace_steps })
        })
        .transpose()?;

    Ok(super::types::KnowledgeChatMessageRecord {
        message,
        sources,
        agent_run,
    })
}

fn prepare_chat(
    db: &Database,
    request: &KnowledgeChatRequest,
    request_id: &str,
) -> Result<PreparedChat, String> {
    let event_name = format!("knowledge-chat-{}", request_id);
    let mode = request.mode.clone().unwrap_or(KnowledgeChatMode::Standard);
    let user_message = extract_last_user_message(&request.messages)?;
    let session = ensure_session(db, request, &mode, &user_message)?;
    let ai_config = resolve_ai_config(db, request.model_id.as_deref(), Some(&session))?;
    let prompt_id = request.prompt_id.clone().or_else(|| session.prompt_id.clone());

    maybe_auto_rename_session(db, &session, &user_message)?;

    let user_record = db
        .create_knowledge_chat_message(
            &session.id,
            "user",
            &user_message,
            "completed",
            Some(request_id),
            None,
            Some(&ai_config.id),
            prompt_id.as_deref(),
            None,
        )
        .map_err(|e| e.to_string())?;

    let assistant_record = db
        .create_knowledge_chat_message(
            &session.id,
            "assistant",
            "",
            "streaming",
            Some(request_id),
            Some(&user_record.id),
            Some(&ai_config.id),
            prompt_id.as_deref(),
            None,
        )
        .map_err(|e| e.to_string())?;

    let session = db
        .get_knowledge_chat_session_by_id(&session.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "会话不存在".to_string())?;

    Ok(PreparedChat {
        event_name,
        mode,
        session,
        ai_config,
        user_record,
        assistant_record,
    })
}

async fn run_chat_task(
    app: AppHandle,
    db: &Database,
    request: KnowledgeChatRequest,
    request_id: String,
    abort_flag: Arc<AtomicBool>,
    prepared: PreparedChat,
) -> Result<(), String> {
    match prepared.mode {
        KnowledgeChatMode::Standard => {
            run_standard_chat(
                app,
                db,
                &prepared.event_name,
                &request_id,
                &abort_flag,
                request,
                prepared.session,
                prepared.ai_config,
                prepared.user_record.id,
                prepared.assistant_record,
            )
            .await?;
        }
        KnowledgeChatMode::Agent => {
            run_agent_chat(
                app,
                db,
                &prepared.event_name,
                &request_id,
                &abort_flag,
                request,
                prepared.session,
                prepared.ai_config,
                prepared.user_record.id,
                prepared.assistant_record,
            )
            .await?;
        }
    }

    Ok(())
}

async fn run_standard_chat(
    app: AppHandle,
    db: &Database,
    event_name: &str,
    request_id: &str,
    abort_flag: &Arc<AtomicBool>,
    request: KnowledgeChatRequest,
    session: KnowledgeChatSession,
    ai_config: AiConfig,
    _user_message_id: String,
    assistant_record: KnowledgeChatMessage,
) -> Result<(), String> {
    let user_message = extract_last_user_message(&request.messages)?;

    let _ = app.emit(
        event_name,
        KnowledgeChatEvent::Searching {
            message: "正在检索相关知识...".to_string(),
        },
    );

    let expanded_queries = expand_queries(&ai_config, &user_message, abort_flag).await;
    let mut queries = vec![user_message.clone()];
    queries.extend(expanded_queries);

    let search_results = search_multi_queries(&queries, Some(STANDARD_TOP_K), abort_flag).await?;
    if abort_flag.load(Ordering::Relaxed) {
        emit_aborted(app, event_name, db, &assistant_record.id).await?;
        return Err("请求已取消".to_string());
    }

    persist_sources(db, &assistant_record.id, &search_results, None)?;

    let _ = app.emit(
        event_name,
        KnowledgeChatEvent::ContextFound {
            sources: search_results.clone(),
        },
    );

    let rag_context = Some(build_standard_context(&search_results, request.system_prompt.as_deref()));
    let history = convert_messages(&request.messages);
    let images = convert_images(request.images);

    let full_content = stream_response_and_collect(
        app.clone(),
        event_name,
        request_id,
        &assistant_record.id,
        ai_config.clone(),
        history,
        images,
        rag_context,
    )
    .await?;

    db.update_knowledge_chat_message_content(&assistant_record.id, &full_content, "completed", None)
        .map_err(|e| e.to_string())?;
    db.touch_knowledge_chat_session(&session.id)
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        event_name,
        KnowledgeChatEvent::Completed {
            full_content: full_content.clone(),
            session_id: session.id.clone(),
            assistant_message_id: assistant_record.id.clone(),
            run_id: None,
        },
    );

    Ok(())
}

async fn run_agent_chat(
    app: AppHandle,
    db: &Database,
    event_name: &str,
    request_id: &str,
    abort_flag: &Arc<AtomicBool>,
    request: KnowledgeChatRequest,
    session: KnowledgeChatSession,
    ai_config: AiConfig,
    _user_message_id: String,
    assistant_record: KnowledgeChatMessage,
) -> Result<(), String> {
    let user_message = extract_last_user_message(&request.messages)?;
    let step_budget = request.step_budget.unwrap_or(DEFAULT_AGENT_STEP_BUDGET).clamp(2, 4);

    let _ = app.emit(
        event_name,
        KnowledgeChatEvent::Planning {
            message: "正在拆解问题与规划检索步骤...".to_string(),
        },
    );

    let plan = generate_agent_plan(&ai_config, &user_message, step_budget, abort_flag).await;
    let agent_run = db
        .create_knowledge_agent_run(
            &session.id,
            &assistant_record.id,
            "running",
            step_budget,
            Some(&plan),
        )
        .map_err(|e| e.to_string())?;

    persist_trace_step(
        app.clone(),
        event_name,
        db,
        &agent_run.id,
        0,
        "plan",
        "问题规划",
        &plan,
        Some(&json!({ "step_budget": step_budget, "query": user_message }).to_string()),
    )?;

    let mut aggregated_results: Vec<KnowledgeSearchResult> = Vec::new();
    let mut seen_chunks: HashSet<String> = HashSet::new();

    for iteration in 1..=step_budget {
        if abort_flag.load(Ordering::Relaxed) {
            emit_aborted(app, event_name, db, &assistant_record.id).await?;
            db.update_knowledge_agent_run(&agent_run.id, "aborted", iteration - 1, Some(&plan), None, None, true)
                .map_err(|e| e.to_string())?;
            return Err("请求已取消".to_string());
        }

        let queries = generate_agent_queries(&ai_config, &user_message, &plan, iteration, &aggregated_results, abort_flag).await;
        let _ = app.emit(
            event_name,
            KnowledgeChatEvent::Retrieving {
                message: format!("正在执行第 {} 轮检索...", iteration),
                queries: queries.clone(),
                iteration,
                total_iterations: step_budget,
            },
        );

        let query_metadata = json!({ "queries": queries, "iteration": iteration, "total_iterations": step_budget }).to_string();
        persist_trace_step(
            app.clone(),
            event_name,
            db,
            &agent_run.id,
            iteration * 2 - 1,
            "query_expansion",
            format!("第 {} 轮查询", iteration).as_str(),
            &format_query_summary(&queries),
            Some(&query_metadata),
        )?;

        let round_results = search_multi_queries(&queries, Some(AGENT_TOP_K), abort_flag).await?;
        for result in round_results {
            if seen_chunks.insert(result.chunk_id.clone()) {
                aggregated_results.push(result);
            }
        }

        let retrieval_summary = summarize_results_for_trace(&aggregated_results, iteration);
        persist_trace_step(
            app.clone(),
            event_name,
            db,
            &agent_run.id,
            iteration * 2,
            "retrieval",
            format!("第 {} 轮证据", iteration).as_str(),
            &retrieval_summary,
            None,
        )?;
    }

    persist_sources(db, &assistant_record.id, &aggregated_results, Some("agent"))?;

    let _ = app.emit(
        event_name,
        KnowledgeChatEvent::ContextFound {
            sources: aggregated_results.clone(),
        },
    );

    let evidence_summary = build_agent_evidence_summary(&aggregated_results);
    persist_trace_step(
        app.clone(),
        event_name,
        db,
        &agent_run.id,
        step_budget * 2 + 1,
        "evidence",
        "证据汇总",
        &evidence_summary,
        None,
    )?;

    let rag_context = Some(build_agent_context(&plan, &aggregated_results, request.system_prompt.as_deref()));
    let history = convert_messages(&request.messages);
    let images = convert_images(request.images);
    let full_content = stream_response_and_collect(
        app.clone(),
        event_name,
        request_id,
        &assistant_record.id,
        ai_config.clone(),
        history,
        images,
        rag_context,
    )
    .await?;

    db.update_knowledge_chat_message_content(&assistant_record.id, &full_content, "completed", None)
        .map_err(|e| e.to_string())?;
    db.update_knowledge_agent_run(
        &agent_run.id,
        "completed",
        step_budget,
        Some(&plan),
        Some(&full_content),
        None,
        true,
    )
    .map_err(|e| e.to_string())?;
    db.touch_knowledge_chat_session(&session.id)
        .map_err(|e| e.to_string())?;

    persist_trace_step(
        app.clone(),
        event_name,
        db,
        &agent_run.id,
        step_budget * 2 + 2,
        "answer",
        "最终回答",
        &full_content,
        None,
    )?;

    let _ = app.emit(
        event_name,
        KnowledgeChatEvent::Completed {
            full_content: full_content.clone(),
            session_id: session.id.clone(),
            assistant_message_id: assistant_record.id.clone(),
            run_id: Some(agent_run.id.clone()),
        },
    );

    Ok(())
}

fn ensure_session(
    db: &Database,
    request: &KnowledgeChatRequest,
    mode: &KnowledgeChatMode,
    user_message: &str,
) -> Result<KnowledgeChatSession, String> {
    if let Some(session_id) = request.session_id.as_deref() {
        if let Some(existing) = db
            .get_knowledge_chat_session_by_id(session_id)
            .map_err(|e| e.to_string())?
        {
            return Ok(existing);
        }
    }

    let fallback_title = match mode {
        KnowledgeChatMode::Standard => DEFAULT_STANDARD_TITLE,
        KnowledgeChatMode::Agent => DEFAULT_AGENT_TITLE,
    };
    let title = build_auto_session_title(user_message, mode).unwrap_or_else(|| fallback_title.to_string());

    db.create_knowledge_chat_session(
        &title,
        mode.as_str(),
        request.model_id.as_deref(),
        request.prompt_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

fn maybe_auto_rename_session(
    db: &Database,
    session: &KnowledgeChatSession,
    user_message: &str,
) -> Result<(), String> {
    if !is_default_session_title(&session.title) {
        return Ok(());
    }

    let session_mode = if session.mode == KnowledgeChatMode::Agent.as_str() {
        KnowledgeChatMode::Agent
    } else {
        KnowledgeChatMode::Standard
    };

    let Some(title) = build_auto_session_title(user_message, &session_mode) else {
        return Ok(());
    };

    if title == session.title {
        return Ok(());
    }

    db.rename_knowledge_chat_session(&session.id, &title)
        .map_err(|e| e.to_string())
}

fn is_default_session_title(title: &str) -> bool {
    matches!(title.trim(), DEFAULT_STANDARD_TITLE | DEFAULT_AGENT_TITLE)
}

fn build_auto_session_title(user_message: &str, mode: &KnowledgeChatMode) -> Option<String> {
    let trimmed = user_message.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut title = trimmed
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(trimmed)
        .trim()
        .replace(['\r', '\n'], " ");

    while title.contains("  ") {
        title = title.replace("  ", " ");
    }

    let char_count = title.chars().count();
    if char_count > AUTO_TITLE_MAX_CHARS {
        title = format!("{}…", title.chars().take(AUTO_TITLE_MAX_CHARS).collect::<String>());
    }

    if title.is_empty() {
        return None;
    }

    Some(match mode {
        KnowledgeChatMode::Agent => format!("Agent：{}", title),
        KnowledgeChatMode::Standard => title,
    })
}

fn resolve_ai_config(
    db: &Database,
    model_id: Option<&str>,
    session: Option<&KnowledgeChatSession>,
) -> Result<AiConfig, String> {
    let candidate_id = model_id.or_else(|| session.and_then(|s| s.model_id.as_deref()));
    if let Some(id) = candidate_id {
        return db
            .get_ai_config_by_id(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "指定的 AI 模型不存在".to_string());
    }

    db.get_default_ai_config()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "未配置默认 AI 模型，请在设置中配置".to_string())
}

fn extract_last_user_message(messages: &[ChatMessage]) -> Result<String, String> {
    messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "没有用户消息".to_string())
}

fn convert_messages(messages: &[ChatMessage]) -> Vec<AiChatMessage> {
    messages
        .iter()
        .map(|m| AiChatMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect()
}

fn convert_images(images: Option<Vec<super::types::KnowledgeChatImageData>>) -> Option<Vec<ImageData>> {
    images.map(|items| {
        items
            .into_iter()
            .map(|item| ImageData { data: item.data })
            .collect()
    })
}

async fn stream_response_and_collect(
    app: AppHandle,
    event_name: &str,
    request_id: &str,
    assistant_message_id: &str,
    ai_config: AiConfig,
    messages: Vec<AiChatMessage>,
    images: Option<Vec<ImageData>>,
    rag_context: Option<String>,
) -> Result<String, String> {
    let capture_event = format!("{}-capture", event_name);
    let forward_event = event_name.to_string();
    let assistant_message_id = assistant_message_id.to_string();
    let full_content = Arc::new(std::sync::Mutex::new(String::new()));
    let full_content_clone = full_content.clone();

    use crate::ai_pool::StreamEvent;
    let app_for_listener = app.clone();
    let listener_id = app.listen_any(capture_event.clone(), move |event| {
        if let Ok(payload) = serde_json::from_str::<StreamEvent>(&event.payload()) {
            match payload {
                StreamEvent::Delta { content } => {
                    if let Ok(mut full_content) = full_content_clone.lock() {
                        let delta = merge_stream_fragment(&mut full_content, &content);
                        if delta.is_empty() {
                            return;
                        }
                        if let Some(db) = DATABASE.get() {
                            let _ = db.update_knowledge_chat_message_content(
                                &assistant_message_id,
                                &full_content,
                                "streaming",
                                None,
                            );
                        }
                        let _ = app_for_listener.emit(
                            &forward_event,
                            KnowledgeChatEvent::Streaming {
                                content: delta,
                            },
                        );
                    }
                }
                StreamEvent::Done { success: false, error } => {
                    if let Some(error) = error {
                        let _ = app_for_listener.emit(
                            &forward_event,
                            KnowledgeChatEvent::Error { error },
                        );
                    }
                }
                StreamEvent::Start { .. } | StreamEvent::Done { .. } => {}
            }
        }
    });

    let stream_req = StreamingChatRequest {
        app: app.clone(),
        event_name: capture_event,
        request_id: request_id.to_string(),
        config: ai_config,
        messages,
        images,
    };

    let result = execute_streaming_chat(stream_req, rag_context).await;
    app.unlisten(listener_id);

    match result {
        Ok(_) => Ok(full_content
            .lock()
            .map(|content| content.clone())
            .unwrap_or_default()),
        Err(e) => Err(e),
    }
}

async fn search_multi_queries(
    queries: &[String],
    top_k: Option<i32>,
    abort_flag: &Arc<AtomicBool>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    let mut all_results = Vec::new();
    let mut seen_chunks = HashSet::new();

    for query in queries {
        if abort_flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }
        if let Ok(results) = search::search(query, top_k).await {
            for result in results {
                if seen_chunks.insert(result.chunk_id.clone()) {
                    all_results.push(result);
                }
            }
        }
    }

    Ok(all_results)
}

async fn expand_queries(
    ai_config: &AiConfig,
    user_message: &str,
    abort_flag: &Arc<AtomicBool>,
) -> Vec<String> {
    let prompt = format!(
        "你是知识库检索扩展助手。请基于用户问题生成 2 条适合语义检索的中文查询语句。\n要求：\n1. 每行一条\n2. 不要编号\n3. 不要解释\n4. 查询要覆盖不同角度\n\n用户问题：{}",
        user_message
    );

    match execute_non_streaming_with_abort(
        NonStreamingRequest {
            config: ai_config.clone(),
            prompt,
        },
        abort_flag,
    )
    .await
    {
        Ok(response) => response
            .content
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .take(2)
            .map(ToOwned::to_owned)
            .collect(),
        Err(_) => Vec::new(),
    }
}

async fn generate_agent_plan(
    ai_config: &AiConfig,
    user_message: &str,
    step_budget: i32,
    abort_flag: &Arc<AtomicBool>,
) -> String {
    let prompt = format!(
        "你是本地知识库 Agent 规划助手。请围绕用户问题输出一份简洁计划。\n要求：\n1. 输出 3-5 条要点\n2. 包含要回答的核心问题、需要比较的维度、可能的证据缺口\n3. 不要输出 Markdown 标题\n4. 计划应适合最多 {} 轮检索\n\n用户问题：{}",
        step_budget, user_message
    );

    execute_non_streaming_with_abort(
        NonStreamingRequest {
            config: ai_config.clone(),
            prompt,
        },
        abort_flag,
    )
    .await
    .map(|response| response.content.trim().to_string())
    .unwrap_or_else(|_| {
        format!(
            "- 明确用户问题的核心目标\n- 按主题检索相关 visual_summary 片段\n- 汇总跨笔记证据并标出缺口\n- 基于检索结果给出结构化回答\n- 若依据不足，明确说明不确定项\n\n原始问题：{}",
            user_message
        )
    })
}

async fn generate_agent_queries(
    ai_config: &AiConfig,
    user_message: &str,
    plan: &str,
    iteration: i32,
    accumulated_results: &[KnowledgeSearchResult],
    abort_flag: &Arc<AtomicBool>,
) -> Vec<String> {
    if iteration == 1 {
        let mut queries = vec![user_message.to_string()];
        queries.extend(expand_queries(ai_config, user_message, abort_flag).await);
        return dedupe_queries(queries, 3);
    }

    let evidence_titles = accumulated_results
        .iter()
        .take(6)
        .map(|r| format!("- {}", r.note_title))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "你是本地知识库 Agent 查询细化助手。\n当前用户问题：{}\n\n已有计划：\n{}\n\n已有命中笔记：\n{}\n\n请输出 2 条下一轮检索查询，用于补足证据或做对比。\n要求：每行一条，不要解释，不要编号。",
        user_message,
        plan,
        if evidence_titles.is_empty() { "- 暂无命中" } else { &evidence_titles }
    );

    match execute_non_streaming_with_abort(
        NonStreamingRequest {
            config: ai_config.clone(),
            prompt,
        },
        abort_flag,
    )
    .await
    {
        Ok(response) => {
            let lines = response
                .content
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            let mut queries = vec![user_message.to_string()];
            queries.extend(lines);
            dedupe_queries(queries, 3)
        }
        Err(_) => dedupe_queries(vec![user_message.to_string()], 1),
    }
}

fn dedupe_queries(queries: Vec<String>, limit: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    queries
        .into_iter()
        .map(|q| q.trim().to_string())
        .filter(|q| !q.is_empty())
        .filter(|q| seen.insert(q.clone()))
        .take(limit)
        .collect()
}

fn build_standard_context(results: &[KnowledgeSearchResult], custom_prompt: Option<&str>) -> String {
    let references = if results.is_empty() {
        "未找到相关 visual_summary 内容。请明确说明依据不足，并尽量给出可执行的后续提问建议。".to_string()
    } else {
        results
            .iter()
            .map(|result| format!("笔记《{}》\n{}", result.note_title, result.content))
            .collect::<Vec<_>>()
            .join("\n\n---\n\n")
    };

    let custom = custom_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("\n\n【用户附加要求】\n{}", value))
        .unwrap_or_default();

    format!(
        "你是本地知识库问答助手，只能基于 visual_summary 检索结果回答。\n\n【知识库证据】\n{}\n\n【回答要求】\n1. 先直接回答问题\n2. 再给出结构化要点\n3. 明确标注证据不足的部分\n4. 不要编造知识库中不存在的信息{}",
        references, custom
    )
}

fn build_agent_context(
    plan: &str,
    results: &[KnowledgeSearchResult],
    custom_prompt: Option<&str>,
) -> String {
    let evidence = if results.is_empty() {
        "当前没有找到有效证据，请明确说明依据不足。".to_string()
    } else {
        results
            .iter()
            .enumerate()
            .map(|(index, result)| {
                format!(
                    "[证据 {}] 笔记《{}》\n{}",
                    index + 1,
                    result.note_title,
                    result.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    let custom = custom_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("\n\n【用户附加要求】\n{}", value))
        .unwrap_or_default();

    format!(
        "你是本地知识库 Agent 助手，只能在 visual_summary 检索结果范围内推理。\n\n【任务计划】\n{}\n\n【证据池】\n{}\n\n【回答结构】\n1. 直接结论\n2. 核心要点\n3. 证据依据\n4. 不确定项 / 缺失项\n5. 建议的后续追问\n\n【约束】\n- 不得编造不存在的事实\n- 如果证据冲突，要明确指出\n- 优先归纳跨笔记共识，再补充差异{}",
        plan, evidence, custom
    )
}

fn persist_sources(
    db: &Database,
    assistant_message_id: &str,
    results: &[KnowledgeSearchResult],
    query_text: Option<&str>,
) -> Result<(), String> {
    db.delete_knowledge_chat_message_sources(assistant_message_id)
        .map_err(|e| e.to_string())?;

    for (index, result) in results.iter().enumerate() {
        db.create_knowledge_chat_message_source(
            assistant_message_id,
            &result.chunk_id,
            &result.note_id,
            index as i32 + 1,
            Some(result.score),
            query_text,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn persist_trace_step(
    app: AppHandle,
    event_name: &str,
    db: &Database,
    run_id: &str,
    step_index: i32,
    step_type: &str,
    title: &str,
    content: &str,
    metadata_json: Option<&str>,
) -> Result<KnowledgeAgentTraceStep, String> {
    let step = db
        .create_knowledge_agent_trace_step(run_id, step_index, step_type, title, content, metadata_json)
        .map_err(|e| e.to_string())?;
    let _ = app.emit(
        event_name,
        KnowledgeChatEvent::TraceStep {
            run_id: run_id.to_string(),
            step: step.clone(),
        },
    );
    Ok(step)
}

fn format_query_summary(queries: &[String]) -> String {
    queries
        .iter()
        .enumerate()
        .map(|(index, query)| format!("{}. {}", index + 1, query))
        .collect::<Vec<_>>()
        .join("\n")
}

fn summarize_results_for_trace(results: &[KnowledgeSearchResult], iteration: i32) -> String {
    if results.is_empty() {
        return format!("第 {} 轮检索未命中有效证据。", iteration);
    }

    let note_count = results
        .iter()
        .map(|result| result.note_id.as_str())
        .collect::<HashSet<_>>()
        .len();

    let preview = results
        .iter()
        .take(4)
        .map(|result| format!("- {}（{:.1}%）", result.note_title, result.score * 100.0))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "累计命中 {} 条证据，覆盖 {} 篇笔记。\n{}",
        results.len(),
        note_count,
        preview
    )
}

fn build_agent_evidence_summary(results: &[KnowledgeSearchResult]) -> String {
    if results.is_empty() {
        return "当前没有可用证据，最终回答需要明确说明依据不足。".to_string();
    }

    let by_note = results.iter().fold(HashMap::<String, usize>::new(), |mut acc, result| {
        *acc.entry(result.note_title.clone()).or_default() += 1;
        acc
    });

    let note_summary = by_note
        .into_iter()
        .map(|(title, count)| format!("- {}：{} 条证据", title, count))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "本次 Agent 共汇总 {} 条去重证据。\n覆盖情况：\n{}\n\n回答时请优先提炼跨笔记共识，再补充差异与不确定项。",
        results.len(),
        note_summary
    )
}

async fn emit_aborted(
    app: AppHandle,
    event_name: &str,
    db: &Database,
    assistant_message_id: &str,
) -> Result<(), String> {
    let existing_content = db
        .get_knowledge_chat_message_by_id(assistant_message_id)
        .map_err(|e| e.to_string())?
        .map(|message| message.content)
        .unwrap_or_default();
    db.update_knowledge_chat_message_content(assistant_message_id, &existing_content, "aborted", None)
        .map_err(|e| e.to_string())?;
    let _ = app.emit(event_name, KnowledgeChatEvent::Aborted);
    Ok(())
}

async fn register_abort_flag(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut flags = get_abort_flags().lock().await;
    flags.insert(request_id.to_string(), flag.clone());
    flag
}

async fn cleanup_abort_flag(request_id: &str) {
    let mut flags = get_abort_flags().lock().await;
    flags.remove(request_id);
    get_ai_pool_manager().cleanup_abort_flag(request_id).await;
}

fn resolve_note_title(db: &Database, note_id: &str) -> String {
    db.get_note_by_id(note_id)
        .ok()
        .flatten()
        .map(|note| note.title)
        .unwrap_or_else(|| "未知笔记".to_string())
}

fn resolve_chunk_content(db: &Database, chunk_id: &str) -> String {
    let conn = db.connection();
    conn.query_row(
        "SELECT content FROM knowledge_chunks WHERE id = ?1",
        [chunk_id],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_default()
}
