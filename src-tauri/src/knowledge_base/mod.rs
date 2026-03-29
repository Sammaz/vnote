pub mod chat;
pub mod indexing;
pub mod search;
pub mod types;

use crate::DATABASE;
use indexing::compute_content_hash;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use types::{
    KnowledgeBaseStats, KnowledgeChatPreferencesPayload, KnowledgeChatRequest,
    KnowledgeChatSessionDetail, KnowledgeChatSubmitResponse, KnowledgeIndexStatusResponse,
    KnowledgeSearchResult, UpdateKnowledgeChatSessionRequest,
};

static INDEXING_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_indexing_abort_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    INDEXING_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_db() -> &'static crate::db::Database {
    DATABASE.get().expect("Database not initialized")
}

#[tauri::command]
pub async fn knowledge_base_index_note(note_id: String) -> Result<(), String> {
    let db = crate::get_db();
    if db.get_default_embedding_config().map_err(|e| e.to_string())?.is_none() {
        return Err("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认".to_string());
    }
    indexing::index_note(&note_id, None).await
}

#[tauri::command]
pub async fn knowledge_base_index_all_notes(app: AppHandle) -> Result<String, String> {
    let db = crate::get_db();
    if db.get_default_embedding_config().map_err(|e| e.to_string())?.is_none() {
        return Err("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认".to_string());
    }
    let task_id = uuid::Uuid::new_v4().to_string();
    let abort_flag = Arc::new(AtomicBool::new(false));

    {
        let mut flags = get_indexing_abort_flags().lock().await;
        flags.insert(task_id.clone(), abort_flag.clone());
    }

    let task_id_clone = task_id.clone();
    tokio::spawn(async move {
        let db = get_db();
        let notes = db.get_all_notes().unwrap_or_default();

        let total = notes
            .iter()
            .filter(|n| n.visual_summary.as_ref().is_some_and(|s| !s.trim().is_empty()))
            .count();
        let mut completed = 0;
        let mut failed = 0;

        let _ = app.emit(
            &format!("knowledge-index-{}", task_id_clone),
            serde_json::json!({ "status": "Started", "total": total }),
        );

        for note in &notes {
            if abort_flag.load(Ordering::Relaxed) {
                let _ = app.emit(
                    &format!("knowledge-index-{}", task_id_clone),
                    serde_json::json!({ "status": "Aborted" }),
                );
                break;
            }

            if note.visual_summary.as_ref().is_none_or(|s| s.trim().is_empty()) {
                continue;
            }

            let _ = app.emit(
                &format!("knowledge-index-{}", task_id_clone),
                serde_json::json!({ "status": "Indexing", "note_id": note.id }),
            );

            match indexing::index_note(&note.id, Some(&abort_flag)).await {
                Ok(()) => completed += 1,
                Err(e) => {
                    tracing::error!("[knowledge_base] 索引笔记 {} 失败: {}", note.id, e);
                    failed += 1;
                }
            }

            let _ = app.emit(
                &format!("knowledge-index-{}", task_id_clone),
                serde_json::json!({
                    "status": "Progress",
                    "completed": completed,
                    "failed": failed,
                    "total": total,
                    "note_title": note.title,
                    "note_id": note.id
                }),
            );
        }

        if !abort_flag.load(Ordering::Relaxed) {
            let _ = app.emit(
                &format!("knowledge-index-{}", task_id_clone),
                serde_json::json!({
                    "status": "Completed",
                    "completed": completed,
                    "failed": failed,
                    "total": total
                }),
            );
        }

        let mut flags = get_indexing_abort_flags().lock().await;
        flags.remove(&task_id_clone);
    });

    Ok(task_id)
}

#[tauri::command]
pub async fn knowledge_base_index_outdated_notes(app: AppHandle) -> Result<String, String> {
    let db = crate::get_db();
    if db.get_default_embedding_config().map_err(|e| e.to_string())?.is_none() {
        return Err("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认".to_string());
    }
    let task_id = uuid::Uuid::new_v4().to_string();
    let abort_flag = Arc::new(AtomicBool::new(false));

    {
        let mut flags = get_indexing_abort_flags().lock().await;
        flags.insert(task_id.clone(), abort_flag.clone());
    }

    let task_id_clone = task_id.clone();
    tokio::spawn(async move {
        let db = get_db();
        let notes = db.get_all_notes().unwrap_or_default();
        let statuses = db.get_all_knowledge_index_statuses().unwrap_or_default();
        let status_map: HashMap<String, _> = statuses.into_iter().map(|s| (s.note_id.clone(), s)).collect();

        let outdated_notes: Vec<_> = notes
            .iter()
            .filter(|n| {
                let vs = match n.visual_summary.as_ref() {
                    Some(s) if !s.trim().is_empty() => s,
                    _ => return false,
                };
                match status_map.get(&n.id) {
                    Some(info) if info.status == "completed" => match &info.content_hash {
                        Some(h) => compute_content_hash(vs) != *h,
                        None => true,
                    },
                    _ => false,
                }
            })
            .collect();

        let total = outdated_notes.len();
        let mut completed = 0;
        let mut failed = 0;

        let _ = app.emit(
            &format!("knowledge-index-{}", task_id_clone),
            serde_json::json!({ "status": "Started", "total": total }),
        );

        for note in &outdated_notes {
            if abort_flag.load(Ordering::Relaxed) {
                let _ = app.emit(
                    &format!("knowledge-index-{}", task_id_clone),
                    serde_json::json!({ "status": "Aborted" }),
                );
                break;
            }

            let _ = app.emit(
                &format!("knowledge-index-{}", task_id_clone),
                serde_json::json!({ "status": "Indexing", "note_id": note.id }),
            );

            match indexing::index_note(&note.id, Some(&abort_flag)).await {
                Ok(()) => completed += 1,
                Err(e) => {
                    tracing::error!("[knowledge_base] 索引笔记 {} 失败: {}", note.id, e);
                    failed += 1;
                }
            }

            let _ = app.emit(
                &format!("knowledge-index-{}", task_id_clone),
                serde_json::json!({
                    "status": "Progress",
                    "completed": completed,
                    "failed": failed,
                    "total": total,
                    "note_title": note.title,
                    "note_id": note.id
                }),
            );
        }

        if !abort_flag.load(Ordering::Relaxed) {
            let _ = app.emit(
                &format!("knowledge-index-{}", task_id_clone),
                serde_json::json!({
                    "status": "Completed",
                    "completed": completed,
                    "failed": failed,
                    "total": total
                }),
            );
        }

        let mut flags = get_indexing_abort_flags().lock().await;
        flags.remove(&task_id_clone);
    });

    Ok(task_id)
}

#[tauri::command]
pub async fn knowledge_base_remove_index(note_id: String) -> Result<(), String> {
    let db = get_db();
    db.delete_knowledge_chunks(&note_id).map_err(|e| e.to_string())?;
    db.delete_knowledge_index_status(&note_id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn knowledge_base_get_index_status() -> Result<Vec<KnowledgeIndexStatusResponse>, String> {
    let db = get_db();
    let notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let statuses = db.get_all_knowledge_index_statuses().map_err(|e| e.to_string())?;

    let status_map: HashMap<String, _> = statuses.into_iter().map(|s| (s.note_id.clone(), s)).collect();

    let mut results = Vec::new();
    for note in &notes {
        let has_vs = note.visual_summary.as_ref().is_some_and(|s| !s.trim().is_empty());
        let status_info = status_map.get(&note.id);

        let needs_reindex = if let Some(info) = status_info {
            if info.status == "completed" {
                match (&info.content_hash, &note.visual_summary) {
                    (Some(indexed_hash), Some(vs)) if !vs.trim().is_empty() => {
                        compute_content_hash(vs) != *indexed_hash
                    }
                    _ => false,
                }
            } else {
                false
            }
        } else {
            false
        };

        results.push(KnowledgeIndexStatusResponse {
            note_id: note.id.clone(),
            note_title: note.title.clone(),
            status: status_info
                .map(|s| {
                    if s.status == "indexing" {
                        "none".to_string()
                    } else {
                        s.status.clone()
                    }
                })
                .unwrap_or_else(|| "none".to_string()),
            chunk_count: status_info.map(|s| s.chunk_count).unwrap_or(0),
            has_visual_summary: has_vs,
            completed_at: status_info.and_then(|s| s.completed_at.clone()),
            error_message: status_info.and_then(|s| s.error_message.clone()),
            needs_reindex,
            init_completed: has_vs,
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn knowledge_base_backfill_visual_summaries() -> Result<i32, String> {
    let db = get_db();
    let mut notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let mut count = 0;
    for note in &mut notes {
        if note.visual_summary.as_ref().is_none_or(|s| s.trim().is_empty())
            && note.detailed_reading.as_ref().is_some_and(|s| !s.trim().is_empty())
        {
            match crate::assemble_and_save_visual_summary(db, note) {
                Ok(true) => count += 1,
                Ok(false) => {}
                Err(e) => {
                    tracing::warn!("[knowledge_base] backfill visual_summary failed for {}: {}", note.id, e);
                }
            }
        }
    }
    Ok(count)
}

#[tauri::command]
pub async fn knowledge_base_abort_indexing(task_id: String) -> Result<(), String> {
    let flags = get_indexing_abort_flags().lock().await;
    if let Some(flag) = flags.get(&task_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn knowledge_base_search(
    query: String,
    top_k: Option<i32>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    search::search(&query, top_k).await
}

#[tauri::command]
pub async fn knowledge_base_chat(
    app: AppHandle,
    request: KnowledgeChatRequest,
) -> Result<KnowledgeChatSubmitResponse, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = chat::chat(app.clone(), request, request_id.clone()).await;

    match response {
        Ok(payload) => Ok(payload),
        Err(error) => {
            let _ = app.emit(
                &format!("knowledge-chat-{}", request_id),
                types::KnowledgeChatEvent::Error { error: error.clone() },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn knowledge_base_abort_chat(request_id: String) -> Result<(), String> {
    chat::abort_chat(&request_id).await
}

#[tauri::command]
pub fn knowledge_base_list_chat_sessions() -> Result<Vec<crate::db::KnowledgeChatSession>, String> {
    chat::list_sessions()
}

#[tauri::command]
pub fn knowledge_base_get_chat_session(
    session_id: String,
) -> Result<KnowledgeChatSessionDetail, String> {
    chat::get_session_detail(&session_id)
}

#[tauri::command]
pub fn knowledge_base_delete_chat_session(session_id: String) -> Result<(), String> {
    chat::delete_session(&session_id)
}

#[tauri::command]
pub fn knowledge_base_rename_chat_session(session_id: String, title: String) -> Result<(), String> {
    chat::rename_session(&session_id, &title)
}

#[tauri::command]
pub fn knowledge_base_set_chat_session_pinned(
    session_id: String,
    is_pinned: bool,
) -> Result<(), String> {
    chat::pin_session(&session_id, is_pinned)
}

#[tauri::command]
pub fn knowledge_base_update_chat_session(
    request: UpdateKnowledgeChatSessionRequest,
) -> Result<(), String> {
    let db = get_db();
    let title = request.title.trim();
    if title.is_empty() {
        return Err("标题不能为空".to_string());
    }
    db.update_knowledge_chat_session(
        &request.session_id,
        title,
        request.mode.as_str(),
        request.model_id.as_deref(),
        request.prompt_id.as_deref(),
        request.is_pinned,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn knowledge_base_get_chat_preferences() -> Result<Option<KnowledgeChatPreferencesPayload>, String> {
    chat::get_preferences()
}

#[tauri::command]
pub fn knowledge_base_save_chat_preferences(
    payload: KnowledgeChatPreferencesPayload,
) -> Result<KnowledgeChatPreferencesPayload, String> {
    chat::save_preferences(payload)
}

#[tauri::command]
pub fn knowledge_base_get_stats() -> Result<KnowledgeBaseStats, String> {
    let db = get_db();
    let notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let statuses = db.get_all_knowledge_index_statuses().map_err(|e| e.to_string())?;
    let total_chunks = db.count_knowledge_chunks().map_err(|e| e.to_string())?;

    let total_notes = notes.len() as i32;
    let notes_with_summary = notes
        .iter()
        .filter(|n| n.visual_summary.as_ref().is_some_and(|s| !s.trim().is_empty()))
        .count() as i32;
    let indexed_notes = statuses.iter().filter(|s| s.status == "completed").count() as i32;

    Ok(KnowledgeBaseStats {
        total_notes,
        indexed_notes,
        total_chunks,
        notes_with_summary,
    })
}
