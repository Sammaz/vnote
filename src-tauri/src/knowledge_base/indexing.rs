use crate::rag::{
    embedding_to_bytes,
    generate_embedding,
};
use crate::settings::{defaults, keys, SettingsManager};
use crate::DATABASE;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Get the byte offset of the n-th character in a string.
/// Returns `s.len()` if n >= char count.
fn char_offset(s: &str, n: usize) -> usize {
    s.char_indices()
        .nth(n)
        .map(|(i, _)| i)
        .unwrap_or(s.len())
}

/// Hard-split a long text into chunks of at most `max_chars` *characters*,
/// breaking at sentence boundaries (。！？.!?\n) when possible.
fn hard_split_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.chars().count() <= max_chars {
            result.push(remaining.to_string());
            break;
        }

        // Get byte offset for max_chars characters (safe boundary)
        let byte_limit = char_offset(remaining, max_chars);
        let search_region = &remaining[..byte_limit];

        // Try to find the last sentence boundary
        let split_at = search_region
            .rmatch_indices(&['。', '！', '？', '.', '!', '?', '\n'][..])
            .next()
            .map(|(i, s)| i + s.len())
            // Fallback: split at last space or comma
            .or_else(|| {
                search_region
                    .rmatch_indices(&[' ', '，', ',', '；', ';'][..])
                    .next()
                    .map(|(i, s)| i + s.len())
            })
            // Last resort: hard cut at byte_limit (already a char boundary)
            .unwrap_or(byte_limit);

        let split_at = if split_at == 0 { byte_limit } else { split_at };

        result.push(remaining[..split_at].to_string());
        remaining = remaining[split_at..].trim_start();
    }

    result
}

/// Create text chunks from markdown content (no timestamps, unlike subtitle chunks)
pub fn create_text_chunks(
    content: &str,
    target_chars: usize,
    overlap_chars: usize,
) -> Vec<String> {
    // Token safety: ensure no chunk exceeds ~6000 chars (~7500 tokens for CJK)
    // to stay well under the 8192 token API limit
    let max_chars = target_chars.max(200);

    let mut chunks: Vec<String> = Vec::new();

    // Split by paragraphs first (double newline)
    let paragraphs: Vec<&str> = content
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .collect();

    let mut current_chunk = String::new();

    for para in &paragraphs {
        let trimmed = para.trim();
        if trimmed.is_empty() {
            continue;
        }

        // If a single paragraph exceeds max_chars, hard-split it first
        let sub_parts = if trimmed.chars().count() > max_chars {
            hard_split_text(trimmed, max_chars)
        } else {
            vec![trimmed.to_string()]
        };

        for part in sub_parts {
            // Would adding this part exceed target?
            if !current_chunk.is_empty() && current_chunk.chars().count() + 2 + part.chars().count() > max_chars {
                chunks.push(current_chunk.clone());

                // Keep overlap
                if overlap_chars > 0 && current_chunk.chars().count() > overlap_chars {
                    let char_count = current_chunk.chars().count();
                    let skip_chars = char_count.saturating_sub(overlap_chars);
                    let overlap_start = current_chunk
                        .char_indices()
                        .nth(skip_chars)
                        .map(|(i, _)| i)
                        .unwrap_or(current_chunk.len());

                    if overlap_start < current_chunk.len() {
                        current_chunk = current_chunk[overlap_start..].trim_start().to_string();
                    } else {
                        current_chunk.clear();
                    }
                } else {
                    current_chunk.clear();
                }
            }

            if !current_chunk.is_empty() {
                current_chunk.push_str("\n\n");
            }
            current_chunk.push_str(&part);
        }
    }

    // Add remaining text
    if !current_chunk.trim().is_empty() {
        chunks.push(current_chunk);
    }

    chunks
}

/// Compute SHA-256 hash of content for change detection
pub fn compute_content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Index a single note's visual_summary into the knowledge base
pub async fn index_note(
    note_id: &str,
    abort_flag: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Get note
    let note = db
        .get_note_by_id(note_id)
        .map_err(|e| e.to_string())?
        .ok_or("笔记不存在")?;

    // Check visual_summary exists
    let visual_summary = note
        .visual_summary
        .as_ref()
        .ok_or("该笔记没有视觉化总结内容")?;

    if visual_summary.trim().is_empty() {
        return Err("视觉化总结内容为空".to_string());
    }

    // Compute content hash
    let content_hash = compute_content_hash(visual_summary);

    // Check if already indexed with same content
    if let Ok(Some(status)) = db.get_knowledge_index_status(note_id) {
        if status.status == "completed" {
            if let Some(ref existing_hash) = status.content_hash {
                if *existing_hash == content_hash {
                    return Ok(()); // Already indexed, no changes
                }
            }
        }
    }

    // Check abort
    if let Some(flag) = abort_flag {
        if flag.load(Ordering::Relaxed) {
            return Err("索引已取消".to_string());
        }
    }

    // Get embedding config
    let embedding_config = db
        .get_default_embedding_config()
        .map_err(|e| e.to_string())?
        .ok_or("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认")?;

    // Set status to indexing
    db.set_knowledge_index_status(note_id, "indexing", 0, Some(&content_hash), None)
        .map_err(|e| e.to_string())?;

    // Delete old chunks
    db.delete_knowledge_chunks(note_id)
        .map_err(|e| e.to_string())?;

    // Create chunks
    let chunk_size = SettingsManager::get_int(keys::RAG_CHUNK_SIZE, defaults::RAG_CHUNK_SIZE);
    let chunk_overlap = SettingsManager::get_int(keys::RAG_CHUNK_OVERLAP, defaults::RAG_CHUNK_OVERLAP);
    let chunks = create_text_chunks(visual_summary, chunk_size, chunk_overlap);

    if chunks.is_empty() {
        db.set_knowledge_index_status(note_id, "completed", 0, Some(&content_hash), None)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Generate embeddings one by one (avoid batch token limit overflow)
    let mut all_embeddings: Vec<Vec<f32>> = Vec::new();

    for (i, chunk_text) in chunks.iter().enumerate() {
        if let Some(flag) = abort_flag {
            if flag.load(Ordering::Relaxed) {
                let _ = db.set_knowledge_index_status(note_id, "failed", 0, Some(&content_hash), Some("索引已取消"));
                return Err("索引已取消".to_string());
            }
        }

        match generate_embedding(&embedding_config, chunk_text).await {
            Ok(embedding) => all_embeddings.push(embedding),
            Err(e) => {
                let err_msg = format!("分块 {}/{} 嵌入失败: {}", i + 1, chunks.len(), e);
                let _ = db.set_knowledge_index_status(note_id, "failed", 0, Some(&content_hash), Some(&err_msg));
                return Err(err_msg);
            }
        }
    }

    // Store chunks with embeddings
    for (i, content) in chunks.iter().enumerate() {
        let embedding = all_embeddings.get(i).cloned();
        let embedding_bytes = embedding.map(|e| embedding_to_bytes(&e));

        db.create_knowledge_chunk(note_id, i as i32, content, embedding_bytes.as_deref())
            .map_err(|e| e.to_string())?;
    }

    // Update status
    db.set_knowledge_index_status(
        note_id,
        "completed",
        chunks.len() as i32,
        Some(&content_hash),
        None,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
