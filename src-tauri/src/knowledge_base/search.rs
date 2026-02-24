use crate::db::KnowledgeChunk;
use crate::rag::{bytes_to_embedding, cosine_similarity, generate_embedding};
use crate::settings::{defaults, keys, SettingsManager};
use crate::DATABASE;

use super::types::KnowledgeSearchResult;

/// Search knowledge base using semantic similarity
pub async fn search(
    query: &str,
    top_k: Option<i32>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    // Get embedding config
    let embedding_config = db
        .get_default_embedding_config()
        .map_err(|e| e.to_string())?
        .ok_or("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认")?;

    // Generate query embedding
    let query_embedding = generate_embedding(&embedding_config, query).await?;

    // Load all chunks with embeddings
    let chunks = db
        .get_all_knowledge_chunks_with_embeddings()
        .map_err(|e| e.to_string())?;

    if chunks.is_empty() {
        return Ok(vec![]);
    }

    let top_k = top_k.unwrap_or_else(|| {
        SettingsManager::get_int(keys::RAG_TOP_K, defaults::RAG_TOP_K) as i32
    }) as usize;

    // Calculate similarities
    let mut scored: Vec<(f32, &KnowledgeChunk)> = chunks
        .iter()
        .filter_map(|chunk| {
            let emb_bytes = chunk.embedding.as_ref()?;
            let embedding = bytes_to_embedding(emb_bytes);
            let score = cosine_similarity(&query_embedding, &embedding);
            Some((score, chunk))
        })
        .collect();

    // Sort descending
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);

    // Build results with note titles
    let mut results = Vec::new();
    for (score, chunk) in scored {
        let note_title = db
            .get_note_by_id(&chunk.note_id)
            .ok()
            .flatten()
            .map(|n| n.title)
            .unwrap_or_else(|| "未知笔记".to_string());

        results.push(KnowledgeSearchResult {
            chunk_id: chunk.id.clone(),
            note_id: chunk.note_id.clone(),
            note_title,
            content: chunk.content.clone(),
            score,
        });
    }

    // Apply reranking if configured
    let reranker_config = db.get_default_reranker_config().map_err(|e| e.to_string())?;
    if let Some(config) = reranker_config {
        let rerank_k = SettingsManager::get_int(keys::RAG_RERANK_K, defaults::RAG_RERANK_K);
        results = rerank_knowledge_results(&config, query, results, rerank_k).await?;
    }

    Ok(results)
}

/// Rerank knowledge search results using reranker API
async fn rerank_knowledge_results(
    config: &crate::db::RerankerConfig,
    query: &str,
    results: Vec<KnowledgeSearchResult>,
    top_k: usize,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    if results.is_empty() {
        return Ok(results);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let base_url = config.base_url.trim_end_matches('/');
    let api_url = format!("{}/rerank", base_url);

    let documents: Vec<&str> = results.iter().map(|r| r.content.as_str()).collect();

    let body = serde_json::json!({
        "model": config.model,
        "query": query,
        "documents": documents,
        "top_n": top_k.min(results.len())
    });

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Rerank request failed: {}", e))?;

    if !response.status().is_success() {
        // Fallback to original order
        return Ok(results);
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let rerank_results = match json["results"].as_array() {
        Some(arr) => arr,
        None => return Ok(results),
    };

    let mut reranked = Vec::new();
    for item in rerank_results {
        if let Some(index) = item["index"].as_u64() {
            if let Some(result) = results.get(index as usize) {
                let mut r = result.clone();
                if let Some(score) = item["relevance_score"].as_f64() {
                    r.score = score as f32;
                }
                reranked.push(r);
            }
        }
    }

    Ok(reranked)
}
