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
    KnowledgeBaseStats, KnowledgeChatRequest, KnowledgeIndexStatusResponse,
    KnowledgeSearchResult,
};

static INDEXING_ABORT_FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_indexing_abort_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    INDEXING_ABORT_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_db() -> &'static crate::db::Database {
    DATABASE.get().expect("Database not initialized")
}

/// Index a single note's visual_summary
#[tauri::command]
pub async fn knowledge_base_index_note(note_id: String) -> Result<(), String> {
    indexing::index_note(&note_id, None).await
}

/// Index all notes that have visual_summary, returns task_id
#[tauri::command]
pub async fn knowledge_base_index_all_notes(app: AppHandle) -> Result<String, String> {
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
            .filter(|n| n.visual_summary.as_ref().map_or(false, |s| !s.trim().is_empty()))
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

            if note.visual_summary.as_ref().map_or(true, |s| s.trim().is_empty()) {
                continue;
            }

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
                    "note_title": note.title
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

        // Cleanup
        let mut flags = get_indexing_abort_flags().lock().await;
        flags.remove(&task_id_clone);
    });

    Ok(task_id)
}

/// Index only notes whose visual_summary changed since last indexing, returns task_id
#[tauri::command]
pub async fn knowledge_base_index_outdated_notes(app: AppHandle) -> Result<String, String> {
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

        // Collect only notes that need re-indexing (content hash mismatch)
        let outdated_notes: Vec<_> = notes
            .iter()
            .filter(|n| {
                let vs = match n.visual_summary.as_ref() {
                    Some(s) if !s.trim().is_empty() => s,
                    _ => return false,
                };
                match status_map.get(&n.id) {
                    Some(info) if info.status == "completed" => {
                        match &info.content_hash {
                            Some(h) => compute_content_hash(vs) != *h,
                            None => true,
                        }
                    }
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
                    "note_title": note.title
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

        // Cleanup
        let mut flags = get_indexing_abort_flags().lock().await;
        flags.remove(&task_id_clone);
    });

    Ok(task_id)
}

/// Remove index for a single note
#[tauri::command]
pub async fn knowledge_base_remove_index(note_id: String) -> Result<(), String> {
    let db = get_db();
    db.delete_knowledge_chunks(&note_id).map_err(|e| e.to_string())?;
    db.delete_knowledge_index_status(&note_id).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get index status for all notes
#[tauri::command]
pub fn knowledge_base_get_index_status() -> Result<Vec<KnowledgeIndexStatusResponse>, String> {
    let db = get_db();
    let notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let statuses = db.get_all_knowledge_index_statuses().map_err(|e| e.to_string())?;

    let status_map: HashMap<String, _> = statuses.into_iter().map(|s| (s.note_id.clone(), s)).collect();

    let mut results = Vec::new();
    for note in &notes {
        let has_vs = note.visual_summary.as_ref().map_or(false, |s| !s.trim().is_empty());
        let status_info = status_map.get(&note.id);

        // Detect if visual_summary changed since last indexing
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
            status: status_info.map(|s| s.status.clone()).unwrap_or_else(|| "none".to_string()),
            chunk_count: status_info.map(|s| s.chunk_count).unwrap_or(0),
            has_visual_summary: has_vs,
            completed_at: status_info.and_then(|s| s.completed_at.clone()),
            error_message: status_info.and_then(|s| s.error_message.clone()),
            needs_reindex,
        });
    }

    Ok(results)
}

/// Backfill visual_summary for notes that have detailed_reading but no visual_summary
#[tauri::command]
pub fn knowledge_base_backfill_visual_summaries() -> Result<i32, String> {
    let db = get_db();
    let mut notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let mut count = 0;
    for note in &mut notes {
        if note.visual_summary.as_ref().map_or(true, |s| s.trim().is_empty())
            && note.detailed_reading.as_ref().map_or(false, |s| !s.trim().is_empty())
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

/// Abort indexing task
#[tauri::command]
pub async fn knowledge_base_abort_indexing(task_id: String) -> Result<(), String> {
    let flags = get_indexing_abort_flags().lock().await;
    if let Some(flag) = flags.get(&task_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Search knowledge base
#[tauri::command]
pub async fn knowledge_base_search(
    query: String,
    top_k: Option<i32>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    search::search(&query, top_k).await
}

/// RAG chat with knowledge base context
#[tauri::command]
pub async fn knowledge_base_chat(
    app: AppHandle,
    request: KnowledgeChatRequest,
) -> Result<String, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let rid = request_id.clone();

    tokio::spawn(async move {
        if let Err(e) = chat::chat(app.clone(), request, rid.clone()).await {
            let _ = app.emit(
                &format!("knowledge-chat-{}", rid),
                types::KnowledgeChatEvent::Error { error: e },
            );
        }
    });

    Ok(request_id)
}

/// Abort a chat session
#[tauri::command]
pub async fn knowledge_base_abort_chat(request_id: String) -> Result<(), String> {
    chat::abort_chat(&request_id).await
}

/// Get knowledge base statistics
#[tauri::command]
pub fn knowledge_base_get_stats() -> Result<KnowledgeBaseStats, String> {
    let db = get_db();
    let notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let statuses = db.get_all_knowledge_index_statuses().map_err(|e| e.to_string())?;
    let total_chunks = db.count_knowledge_chunks().map_err(|e| e.to_string())?;

    let total_notes = notes.len() as i32;
    let notes_with_summary = notes
        .iter()
        .filter(|n| n.visual_summary.as_ref().map_or(false, |s| !s.trim().is_empty()))
        .count() as i32;
    let indexed_notes = statuses
        .iter()
        .filter(|s| s.status == "completed")
        .count() as i32;

    Ok(KnowledgeBaseStats {
        total_notes,
        indexed_notes,
        total_chunks,
        notes_with_summary,
    })
}
