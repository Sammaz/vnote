use crate::db::{EmbeddingConfig, RerankerConfig, SubtitleChunk};
use crate::subtitle::{format_timestamp, parse_subtitle_file, SubtitleEntry};
use crate::DATABASE;
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use tokio::sync::Mutex;

static EMBEDDING_CLIENT: OnceLock<Client> = OnceLock::new();
static INDEXING_LOCKS: OnceLock<Mutex<HashMap<i64, bool>>> = OnceLock::new();

fn get_client() -> &'static Client {
    EMBEDDING_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client")
    })
}

fn get_indexing_locks() -> &'static Mutex<HashMap<i64, bool>> {
    INDEXING_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Chunk configuration
const CHUNK_TARGET_CHARS: usize = 500;
const CHUNK_OVERLAP_CHARS: usize = 50;
const TOP_K_RESULTS: usize = 10;  // Get more for reranking
const RERANK_TOP_K: usize = 5;    // Final results after reranking
const EMBEDDING_BATCH_SIZE: usize = 50;

/// Get RAG context for a query
pub async fn get_rag_context(
    subtitle_path: &str,
    note_id: i64,
    query: &str,
) -> Result<String, String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Get default embedding config
    let embedding_config = db
        .get_default_embedding_config()
        .map_err(|e| e.to_string())?
        .ok_or("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认")?;

    // Check if subtitle file exists
    if !std::path::Path::new(subtitle_path).exists() {
        return Err("Subtitle file not found".to_string());
    }

    // Ensure subtitles are indexed
    ensure_indexed(&embedding_config, subtitle_path, note_id).await?;

    // Generate query embedding
    let query_embedding = generate_embedding(&embedding_config, query).await?;

    // Search similar chunks
    let mut chunks = search_similar_chunks(note_id, &query_embedding, TOP_K_RESULTS)?;

    // Apply reranking if default reranker is configured
    let reranker_config = db.get_default_reranker_config().map_err(|e| e.to_string())?;
    if let Some(ref config) = reranker_config {
        chunks = rerank_chunks(config, query, chunks, RERANK_TOP_K).await?;
    } else {
        chunks.truncate(RERANK_TOP_K);
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

/// Ensure subtitles are indexed for a note
async fn ensure_indexed(
    embedding_config: &EmbeddingConfig,
    subtitle_path: &str,
    note_id: i64,
) -> Result<(), String> {
    // Check if already indexing
    {
        let mut locks = get_indexing_locks().lock().await;
        if locks.get(&note_id).copied().unwrap_or(false) {
            // Wait for indexing to complete
            drop(locks);
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let locks = get_indexing_locks().lock().await;
                if !locks.get(&note_id).copied().unwrap_or(false) {
                    break;
                }
            }
            return Ok(());
        }
        locks.insert(note_id, true);
    }

    // Check if chunks exist
    let db = DATABASE.get().ok_or("Database not initialized")?;
    let existing_chunks = db
        .get_subtitle_chunks(note_id)
        .map_err(|e| e.to_string())?;

    if !existing_chunks.is_empty() {
        // Already indexed
        let mut locks = get_indexing_locks().lock().await;
        locks.remove(&note_id);
        return Ok(());
    }

    // Parse subtitles
    let entries = parse_subtitle_file(subtitle_path)?;
    if entries.is_empty() {
        let mut locks = get_indexing_locks().lock().await;
        locks.remove(&note_id);
        return Err("No subtitle entries found".to_string());
    }

    // Create chunks
    let chunks = create_chunks(&entries);
    if chunks.is_empty() {
        let mut locks = get_indexing_locks().lock().await;
        locks.remove(&note_id);
        return Err("Failed to create chunks".to_string());
    }

    // Generate embeddings in batches
    let mut all_embeddings: Vec<Vec<f32>> = Vec::new();

    for batch in chunks.chunks(EMBEDDING_BATCH_SIZE) {
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

    // Release lock
    let mut locks = get_indexing_locks().lock().await;
    locks.remove(&note_id);

    Ok(())
}

/// Create chunks from subtitle entries
fn create_chunks(entries: &[SubtitleEntry]) -> Vec<(f64, f64, String)> {
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
        if current_chunk.len() >= CHUNK_TARGET_CHARS {
            chunks.push((chunk_start_time, chunk_end_time, current_chunk.clone()));

            // Keep overlap for next chunk (using char-safe boundary)
            if current_chunk.chars().count() > CHUNK_OVERLAP_CHARS {
                // Find a safe char boundary for overlap
                let char_count = current_chunk.chars().count();
                let skip_chars = char_count.saturating_sub(CHUNK_OVERLAP_CHARS);

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
    db.delete_subtitle_chunks(note_id)
        .map_err(|e| e.to_string())
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
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        // If reranker fails, fallback to original order
        eprintln!("Reranker API error {}: {}", status, error_text);
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
