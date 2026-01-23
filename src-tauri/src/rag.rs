use crate::db::{EmbeddingConfig, RerankerConfig, SubtitleChunk};
use crate::subtitle::{format_timestamp, parse_subtitle_file, SubtitleEntry};
use crate::DATABASE;
use crate::settings::{SettingsManager, keys, defaults};
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

static EMBEDDING_CLIENT: OnceLock<Client> = OnceLock::new();

fn get_client() -> &'static Client {
    EMBEDDING_CLIENT.get_or_init(|| {
        let timeout = SettingsManager::get_int(keys::RAG_TIMEOUT_CLIENT, defaults::RAG_TIMEOUT_CLIENT);
        Client::builder()
            .timeout(std::time::Duration::from_secs(timeout))
            .build()
            .expect("Failed to create HTTP client")
    })
}

/// Get RAG context for a query
/// abort_flag: 可选的中止标志，如果设置则会在长时间操作时检查是否被中止
pub async fn get_rag_context(
    subtitle_path: &str,
    note_id: i64,
    query: &str,
    abort_flag: Option<&Arc<AtomicBool>>,
) -> Result<String, String> {
    // 在开始时检查是否被中止
    if let Some(flag) = abort_flag {
        if flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }
    }

    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Check if subtitle file exists (快速检查，不持有锁太久)
    if !std::path::Path::new(subtitle_path).exists() {
        return Err("Subtitle file not found".to_string());
    }

    // Ensure subtitles are indexed (这个函数内部会获取 embedding config)
    ensure_indexed_with_config(subtitle_path, note_id, abort_flag).await?;

    // Get embedding config for query
    let embedding_config = db
        .get_default_embedding_config()
        .map_err(|e| e.to_string())?
        .ok_or("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认")?;

    // 再次检查是否被中止
    if let Some(flag) = abort_flag {
        if flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }
    }

    // Generate query embedding
    let query_embedding = generate_embedding(&embedding_config, query).await?;

    // Search similar chunks
    let top_k = SettingsManager::get_int(keys::RAG_TOP_K, defaults::RAG_TOP_K);
    let mut chunks = search_similar_chunks(note_id, &query_embedding, top_k)?;

    // Apply reranking if default reranker is configured
    let reranker_config = db.get_default_reranker_config().map_err(|e| e.to_string())?;

    if let Some(config) = reranker_config {
        chunks = rerank_chunks(&config, query, chunks, top_k).await?;
    }

    // Build context string
    let context = chunks
        .iter()
        .map(|chunk| {
            format!(
                "[{} - {}] {}",
                format_timestamp(chunk.start_time),
                format_timestamp(chunk.end_time),
                chunk.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(context)
}

/// Ensure subtitles are indexed for a note (获取 embedding config 并检查 abort)
/// 这个函数会在获取数据库锁之前检查 abort_flag，避免死锁
async fn ensure_indexed_with_config(
    subtitle_path: &str,
    note_id: i64,
    abort_flag: Option<&Arc<AtomicBool>>,
) -> Result<String, String> {
    // 在获取数据库锁之前检查 abort_flag
    if let Some(flag) = abort_flag {
        if flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }
    }

    // 获取 embedding config（可能持有数据库锁）
    let db = DATABASE.get().ok_or("Database not initialized")?;
    let embedding_config = db
        .get_default_embedding_config()
        .map_err(|e| e.to_string())?
        .ok_or("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认")?;

    // 再次检查 abort_flag（在持有锁的时候获取 config，需要尽快释放）
    if let Some(flag) = abort_flag {
        if flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }
    }

    // 调用实际的索引函数
    ensure_indexed(&embedding_config, subtitle_path, note_id, abort_flag).await?;

    // 返回一个空字符串（调用者可能不使用）
    Ok(String::new())
}

/// Ensure subtitles are indexed for a note
async fn ensure_indexed(
    embedding_config: &EmbeddingConfig,
    subtitle_path: &str,
    note_id: i64,
    abort_flag: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Check current index status from database
    let status = db.get_index_status(note_id).map_err(|e| e.to_string())?;

    match status.as_deref() {
        Some("completed") => {
            // Already indexed, return immediately
            return Ok(());
        }
        Some("indexing") => {
            // Check if indexing task is stuck (timeout: 10 minutes)
            if let Ok(Some(started_at)) = db.get_index_started_at(note_id) {
                if is_indexing_timeout(&started_at) {
                    // Task is stuck, mark as failed and retry
                    let _ = db.set_index_status(note_id, "failed", Some("索引超时"));
                } else {
                    // Wait for indexing to complete
                    return wait_for_indexing_completion(note_id, abort_flag).await;
                }
            }
        }
        Some("failed") | None => {
            // Need to start indexing
        }
        _ => {}
    }

    // Check if chunks already exist (for migration from old version)
    let existing_chunks = db
        .get_subtitle_chunks(note_id)
        .map_err(|e| e.to_string())?;

    if !existing_chunks.is_empty() {
        // Chunks exist but no status record, mark as completed
        let _ = db.set_index_status(note_id, "completed", None);
        return Ok(());
    }

    // Set status to indexing
    db.set_index_status(note_id, "indexing", None)
        .map_err(|e| e.to_string())?;

    // Check abort flag before starting
    if let Some(flag) = abort_flag {
        if flag.load(Ordering::Relaxed) {
            let _ = db.set_index_status(note_id, "failed", Some("请求已取消"));
            return Err("请求已取消".to_string());
        }
    }

    // Perform indexing
    match perform_indexing(embedding_config, subtitle_path, note_id, abort_flag).await {
        Ok(()) => {
            db.set_index_status(note_id, "completed", None)
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => {
            db.set_index_status(note_id, "failed", Some(&e))
                .map_err(|err| err.to_string())?;
            Err(e)
        }
    }
}

/// Check if indexing task has timed out (10 minutes)
fn is_indexing_timeout(started_at: &str) -> bool {
    use chrono::{DateTime, Local, NaiveDateTime};

    // Parse started_at timestamp
    if let Ok(started) = NaiveDateTime::parse_from_str(started_at, "%Y-%m-%d %H:%M:%S") {
        let started_dt = DateTime::<Local>::from_naive_utc_and_offset(started, *Local::now().offset());
        let now = Local::now();
        let duration = now.signed_duration_since(started_dt);

        // Timeout: 10 minutes
        duration.num_minutes() > 10
    } else {
        // Cannot parse, assume timeout
        true
    }
}

/// Wait for indexing to complete
async fn wait_for_indexing_completion(
    note_id: i64,
    abort_flag: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;
    let timeout = SettingsManager::get_int(keys::RAG_TIMEOUT_INDEXING, defaults::RAG_TIMEOUT_INDEXING);
    let max_wait_time = std::time::Duration::from_secs(timeout);
    let start_time = std::time::Instant::now();

    loop {
        // Check abort flag
        if let Some(flag) = abort_flag {
            if flag.load(Ordering::Relaxed) {
                return Err("请求已取消".to_string());
            }
        }

        // Check timeout
        if start_time.elapsed() > max_wait_time {
            return Err("等待索引完成超时".to_string());
        }

        // Check status
        let status = db.get_index_status(note_id).map_err(|e| e.to_string())?;

        match status.as_deref() {
            Some("completed") => return Ok(()),
            Some("failed") => return Err("索引失败".to_string()),
            Some("indexing") => {
                // Still indexing, wait and retry
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            _ => {
                // Status disappeared, something went wrong
                return Err("索引状态异常".to_string());
            }
        }
    }
}

async fn perform_indexing(
    embedding_config: &EmbeddingConfig,
    subtitle_path: &str,
    note_id: i64,
    abort_flag: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Parse subtitles
    let entries = parse_subtitle_file(subtitle_path)?;
    if entries.is_empty() {
        return Err("No subtitle entries found".to_string());
    }

    // Create chunks
    let chunk_size = SettingsManager::get_int(keys::RAG_CHUNK_SIZE, defaults::RAG_CHUNK_SIZE);
    let chunk_overlap = SettingsManager::get_int(keys::RAG_CHUNK_OVERLAP, defaults::RAG_CHUNK_OVERLAP);
    let chunks = create_chunks(&entries, chunk_size, chunk_overlap);
    if chunks.is_empty() {
        return Err("Failed to create chunks".to_string());
    }

    // Generate embeddings in batches
    let mut all_embeddings: Vec<Vec<f32>> = Vec::new();
    let batch_size = SettingsManager::get_int(keys::RAG_BATCH_SIZE, defaults::RAG_BATCH_SIZE);

    for batch in chunks.chunks(batch_size) {
        // Check abort flag
        if let Some(flag) = abort_flag {
            if flag.load(Ordering::Relaxed) {
                return Err("请求已取消".to_string());
            }
        }

        let texts: Vec<&str> = batch.iter().map(|c| c.2.as_str()).collect();
        let embeddings = generate_embeddings_batch(embedding_config, &texts).await?;
        all_embeddings.extend(embeddings);
    }

    // Store chunks with embeddings
    for (i, (start_time, end_time, content)) in chunks.iter().enumerate() {
        let embedding = all_embeddings.get(i).cloned();
        let embedding_bytes = embedding.map(|e| embedding_to_bytes(&e));

        db.create_subtitle_chunk(
            note_id,
            i as i32,
            *start_time,
            *end_time,
            content,
            embedding_bytes.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Create chunks from subtitle entries
fn create_chunks(
    entries: &[SubtitleEntry],
    target_chars: usize,
    overlap_chars: usize,
) -> Vec<(f64, f64, String)> {
    let mut chunks: Vec<(f64, f64, String)> = Vec::new();
    let mut current_chunk = String::new();
    let mut chunk_start_time = 0.0;
    let mut chunk_end_time = 0.0;

    for entry in entries {
        if current_chunk.is_empty() {
            chunk_start_time = entry.start_time;
        }

        // Add text with space
        if !current_chunk.is_empty() {
            current_chunk.push(' ');
        }
        current_chunk.push_str(&entry.text);
        chunk_end_time = entry.end_time;

        // Check if chunk is large enough
        if current_chunk.len() >= target_chars {
            chunks.push((chunk_start_time, chunk_end_time, current_chunk.clone()));

            // Keep overlap for next chunk (using char-safe boundary)
            if current_chunk.chars().count() > overlap_chars {
                // Find a safe char boundary for overlap
                let char_count = current_chunk.chars().count();
                let skip_chars = char_count.saturating_sub(overlap_chars);

                // Get byte index at char boundary
                let overlap_start = current_chunk
                    .char_indices()
                    .nth(skip_chars)
                    .map(|(i, _)| i)
                    .unwrap_or(current_chunk.len());

                // Try to find a space for cleaner break
                let overlap_start = current_chunk[overlap_start..]
                    .char_indices()
                    .find(|(_, c)| *c == ' ')
                    .map(|(i, _)| overlap_start + i + 1)
                    .unwrap_or(current_chunk.len());

                if overlap_start < current_chunk.len() {
                    current_chunk = current_chunk[overlap_start..].to_string();
                    chunk_start_time = entry.start_time;
                } else {
                    current_chunk.clear();
                }
            } else {
                current_chunk.clear();
            }
        }
    }

    // Add remaining text as final chunk
    if !current_chunk.trim().is_empty() {
        chunks.push((chunk_start_time, chunk_end_time, current_chunk));
    }

    chunks
}

/// Generate embedding for a single text
async fn generate_embedding(embedding_config: &EmbeddingConfig, text: &str) -> Result<Vec<f32>, String> {
    let embeddings = generate_embeddings_batch(embedding_config, &[text]).await?;
    embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "No embedding returned".to_string())
}

/// Generate embeddings for multiple texts
async fn generate_embeddings_batch(
    embedding_config: &EmbeddingConfig,
    texts: &[&str],
) -> Result<Vec<Vec<f32>>, String> {
    let client = get_client();

    // Build API URL for embeddings
    let base_url = embedding_config.base_url.trim_end_matches('/');
    let api_url = format!("{}/embeddings", base_url);

    // Build request body
    let body = json!({
        "model": embedding_config.model,
        "input": texts
    });

    // Send request
    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", embedding_config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Embedding request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Embedding API error {}: {}", status, error_text));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

    // Extract embeddings
    let data = json["data"]
        .as_array()
        .ok_or("Invalid embedding response format")?;

    let mut embeddings = Vec::new();
    for item in data {
        let embedding: Vec<f32> = item["embedding"]
            .as_array()
            .ok_or("Missing embedding array")?
            .iter()
            .filter_map(|v| v.as_f64().map(|f| f as f32))
            .collect();
        embeddings.push(embedding);
    }

    Ok(embeddings)
}

/// Search for similar chunks using cosine similarity
fn search_similar_chunks(
    note_id: i64,
    query_embedding: &[f32],
    top_k: usize,
) -> Result<Vec<SubtitleChunk>, String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;
    let chunks = db
        .get_subtitle_chunks(note_id)
        .map_err(|e| e.to_string())?;

    // Calculate similarities
    let mut scored_chunks: Vec<(f32, SubtitleChunk)> = chunks
        .into_iter()
        .filter_map(|chunk| {
            let embedding_bytes = chunk.embedding.as_ref()?;
            let embedding = bytes_to_embedding(embedding_bytes);
            let similarity = cosine_similarity(query_embedding, &embedding);
            Some((similarity, chunk))
        })
        .collect();

    // Sort by similarity descending
    scored_chunks.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Return top-k
    let results: Vec<SubtitleChunk> = scored_chunks
        .into_iter()
        .take(top_k)
        .map(|(_, chunk)| chunk)
        .collect();

    Ok(results)
}

/// Calculate cosine similarity between two vectors
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a * norm_b)
}

/// Convert embedding vector to bytes
fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    embedding
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect()
}

/// Convert bytes to embedding vector
fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks(4)
        .filter_map(|chunk| {
            if chunk.len() == 4 {
                Some(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            } else {
                None
            }
        })
        .collect()
}

/// Clear subtitle chunks for a note (for re-indexing)
pub fn clear_subtitle_index(note_id: i64) -> Result<(), String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Delete chunks
    db.delete_subtitle_chunks(note_id)
        .map_err(|e| e.to_string())?;

    // Delete index status
    db.delete_index_status(note_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Rerank chunks using a reranker API
async fn rerank_chunks(
    config: &RerankerConfig,
    query: &str,
    chunks: Vec<SubtitleChunk>,
    top_k: usize,
) -> Result<Vec<SubtitleChunk>, String> {
    if chunks.is_empty() {
        return Ok(chunks);
    }

    let client = get_client();

    // Build API URL
    let base_url = config.base_url.trim_end_matches('/');
    let api_url = format!("{}/rerank", base_url);

    // Prepare documents
    let documents: Vec<&str> = chunks.iter().map(|c| c.content.as_str()).collect();

    // Build request body (Cohere-compatible format)
    let body = json!({
        "model": config.model,
        "query": query,
        "documents": documents,
        "top_n": top_k.min(chunks.len())
    });

    // Send request
    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Rerank request failed: {}", e))?;

    if !response.status().is_success() {
        let _error_text = response.text().await.unwrap_or_default();
        // If reranker fails, fallback to original order
        let mut result = chunks;
        result.truncate(top_k);
        return Ok(result);
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse rerank response: {}", e))?;

    // Parse results
    let results = json["results"]
        .as_array()
        .ok_or("Invalid rerank response format")?;

    let mut reranked: Vec<SubtitleChunk> = Vec::new();
    for result in results {
        if let Some(index) = result["index"].as_u64() {
            if let Some(chunk) = chunks.get(index as usize) {
                reranked.push(chunk.clone());
            }
        }
    }

    // If reranking returned fewer results, append remaining
    if reranked.len() < top_k {
        for chunk in &chunks {
            if !reranked.iter().any(|r| r.id == chunk.id) {
                reranked.push(chunk.clone());
                if reranked.len() >= top_k {
                    break;
                }
            }
        }
    }

    Ok(reranked)
}
