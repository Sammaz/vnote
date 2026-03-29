use std::collections::HashMap;

use crate::db::KnowledgeChunk;
use crate::rag::{bytes_to_embedding, cosine_similarity, generate_embedding};
use crate::settings::{defaults, keys, SettingsManager};
use crate::{get_embedding_cache, DATABASE};
use crate::retry::with_retry;

use super::types::KnowledgeSearchResult;

/// Generate embedding with LRU cache and retry
async fn cached_embedding(config: &crate::db::EmbeddingConfig, text: &str) -> Result<Vec<f32>, String> {
    let cache_key = format!("{}::{}", config.model, text);
    {
        let mut cache = get_embedding_cache().lock().await;
        if let Some(v) = cache.get(&cache_key) {
            return Ok(v);
        }
    }
    let config = config.clone();
    let text = text.to_string();
    let embedding = with_retry(3, 500, || {
        let config = config.clone();
        let text = text.clone();
        async move { generate_embedding(&config, &text).await }
    })
    .await?;
    {
        let mut cache = get_embedding_cache().lock().await;
        cache.insert(cache_key, embedding.clone());
    }
    Ok(embedding)
}

/// MMR (Maximal Marginal Relevance) selection
/// lambda: relevance vs diversity balance (higher = more relevance)
fn mmr_select(candidates: &[KnowledgeSearchResult], top_k: usize, lambda: f32, embeddings: &HashMap<String, Vec<f32>>) -> Vec<KnowledgeSearchResult> {
    if candidates.is_empty() {
        return vec![];
    }
    let mut selected: Vec<usize> = Vec::new();
    let mut remaining: Vec<usize> = (0..candidates.len()).collect();

    while selected.len() < top_k && !remaining.is_empty() {
        let best = remaining.iter().copied().max_by(|&a, &b| {
            let rel_a = candidates[a].score;
            let rel_b = candidates[b].score;

            let div_a = if selected.is_empty() {
                0.0_f32
            } else {
                selected.iter().map(|&s| {
                    match (embeddings.get(&candidates[a].chunk_id), embeddings.get(&candidates[s].chunk_id)) {
                        (Some(ea), Some(es)) => cosine_similarity(ea, es),
                        _ => 0.0,
                    }
                }).fold(f32::NEG_INFINITY, f32::max)
            };

            let div_b = if selected.is_empty() {
                0.0_f32
            } else {
                selected.iter().map(|&s| {
                    match (embeddings.get(&candidates[b].chunk_id), embeddings.get(&candidates[s].chunk_id)) {
                        (Some(eb), Some(es)) => cosine_similarity(eb, es),
                        _ => 0.0,
                    }
                }).fold(f32::NEG_INFINITY, f32::max)
            };

            let score_a = lambda * rel_a - (1.0 - lambda) * div_a;
            let score_b = lambda * rel_b - (1.0 - lambda) * div_b;
            score_a.partial_cmp(&score_b).unwrap_or(std::cmp::Ordering::Equal)
        });

        if let Some(best_idx) = best {
            selected.push(best_idx);
            remaining.retain(|&x| x != best_idx);
        } else {
            break;
        }
    }

    selected.into_iter().map(|i| candidates[i].clone()).collect()
}

/// Tokenize text for BM25: CJK single chars + lowercase English words
fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            word.push(ch.to_ascii_lowercase());
        } else {
            if !word.is_empty() {
                tokens.push(std::mem::take(&mut word));
            }
            if ch >= '\u{4E00}' && ch <= '\u{9FFF}'
                || ch >= '\u{3400}' && ch <= '\u{4DBF}'
                || ch >= '\u{F900}' && ch <= '\u{FAFF}'
            {
                tokens.push(ch.to_string());
            }
        }
    }
    if !word.is_empty() {
        tokens.push(word);
    }
    tokens
}

/// BM25 scoring for a query against a set of documents
fn bm25_search(query: &str, chunks: &[KnowledgeChunk], top_k: usize) -> Vec<(f32, usize)> {
    let query_tokens = tokenize(query);
    if query_tokens.is_empty() {
        return vec![];
    }

    let n = chunks.len() as f32;
    let k1: f32 = 1.2;
    let b: f32 = 0.75;

    // Precompute doc tokens and lengths
    let doc_tokens: Vec<Vec<String>> = chunks.iter().map(|c| tokenize(&c.content)).collect();
    let avg_dl: f32 = doc_tokens.iter().map(|t| t.len() as f32).sum::<f32>() / n;

    // Document frequency for query terms
    let mut df: HashMap<&str, u32> = HashMap::new();
    for qt in &query_tokens {
        let count = doc_tokens
            .iter()
            .filter(|dt| dt.iter().any(|t| t == qt))
            .count() as u32;
        df.insert(qt.as_str(), count);
    }

    // Score each document
    let mut scored: Vec<(f32, usize)> = doc_tokens
        .iter()
        .enumerate()
        .map(|(i, dt)| {
            let dl = dt.len() as f32;
            let mut score: f32 = 0.0;
            // Term frequency map
            let mut tf_map: HashMap<&str, u32> = HashMap::new();
            for t in dt {
                *tf_map.entry(t.as_str()).or_default() += 1;
            }
            for qt in &query_tokens {
                let tf = *tf_map.get(qt.as_str()).unwrap_or(&0) as f32;
                let doc_freq = *df.get(qt.as_str()).unwrap_or(&0) as f32;
                if tf > 0.0 && doc_freq > 0.0 {
                    let idf = ((n - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0).ln();
                    let tf_norm = (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * dl / avg_dl));
                    score += idf * tf_norm;
                }
            }
            (score, i)
        })
        .filter(|(s, _)| *s > 0.0)
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);
    scored
}

/// Reciprocal Rank Fusion: merge two ranked lists by chunk index
fn rrf_merge(
    vec_ranked: &[(f32, usize)],
    bm25_ranked: &[(f32, usize)],
    top_k: usize,
) -> Vec<usize> {
    let k: f32 = 60.0;
    let mut scores: HashMap<usize, f32> = HashMap::new();
    for (rank, &(_, idx)) in vec_ranked.iter().enumerate() {
        *scores.entry(idx).or_default() += 1.0 / (k + rank as f32 + 1.0);
    }
    for (rank, &(_, idx)) in bm25_ranked.iter().enumerate() {
        *scores.entry(idx).or_default() += 1.0 / (k + rank as f32 + 1.0);
    }
    let mut fused: Vec<(usize, f32)> = scores.into_iter().collect();
    fused.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    fused.truncate(top_k);
    fused.into_iter().map(|(idx, _)| idx).collect()
}

/// Deduplicate: keep at most max_per_note chunks per note
fn deduplicate_results(results: Vec<KnowledgeSearchResult>, max_per_note: usize) -> Vec<KnowledgeSearchResult> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    results
        .into_iter()
        .filter(|r| {
            let count = counts.entry(r.note_id.clone()).or_default();
            if *count < max_per_note {
                *count += 1;
                true
            } else {
                false
            }
        })
        .collect()
}

/// Search knowledge base using hybrid vector + BM25 search
pub async fn search(
    query: &str,
    top_k: Option<i32>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    let db = DATABASE.get().ok_or("Database not initialized")?;

    let embedding_config = db
        .get_default_embedding_config()
        .map_err(|e| e.to_string())?
        .ok_or("Embedding 模型未配置，请在设置中配置 Embedding 模型并设为默认")?;

    let query_embedding = cached_embedding(&embedding_config, query).await?;

    let chunks = db
        .get_all_knowledge_chunks_with_embeddings()
        .map_err(|e| e.to_string())?;

    if chunks.is_empty() {
        return Ok(vec![]);
    }

    let top_k = top_k.unwrap_or_else(|| {
        SettingsManager::get_int(keys::RAG_TOP_K, defaults::RAG_TOP_K) as i32
    }) as usize;

    // Use a larger candidate pool to allow MMR selection and low-confidence expansion
    let candidate_top_k = top_k * 4;

    let threshold =
        SettingsManager::get_float(keys::RAG_SIMILARITY_THRESHOLD, defaults::RAG_SIMILARITY_THRESHOLD);

    // Vector search with similarity threshold
    let mut vec_scored: Vec<(f32, usize)> = chunks
        .iter()
        .enumerate()
        .filter_map(|(i, chunk)| {
            let emb_bytes = chunk.embedding.as_ref()?;
            let embedding = bytes_to_embedding(emb_bytes);
            let score = cosine_similarity(&query_embedding, &embedding);
            if score >= threshold {
                Some((score, i))
            } else {
                None
            }
        })
        .collect();

    vec_scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Low-confidence expansion: if top score is weak, double the candidate pool
    let effective_candidate_k = if vec_scored.first().map(|(s, _)| *s).unwrap_or(0.0) < 0.22 {
        candidate_top_k * 2
    } else {
        candidate_top_k
    };

    vec_scored.truncate(effective_candidate_k);

    // BM25 search
    let bm25_scored = bm25_search(query, &chunks, effective_candidate_k);

    // RRF merge
    let merged_indices = rrf_merge(&vec_scored, &bm25_scored, effective_candidate_k);

    // Build results with chunk-length scoring
    let mut results = Vec::new();
    let vec_score_map: HashMap<usize, f32> = vec_scored.into_iter().map(|(s, i)| (i, s)).collect();

    // Build chunk_id -> embedding map for MMR
    let mut chunk_embeddings: HashMap<String, Vec<f32>> = HashMap::new();

    for idx in merged_indices {
        let chunk = &chunks[idx];
        let base_score = vec_score_map.get(&idx).copied().unwrap_or(0.0);

        // Chunk length scoring
        let char_count = chunk.content.chars().count();
        let length_bonus: f32 = if char_count >= 80 && char_count <= 220 {
            0.05
        } else if char_count < 30 {
            -0.15
        } else {
            0.0
        };
        let score = (base_score + length_bonus).clamp(0.0, 1.0);

        let note_title = db
            .get_note_by_id(&chunk.note_id)
            .ok()
            .flatten()
            .map(|n| n.title)
            .unwrap_or_else(|| "未知笔记".to_string());

        // Collect embedding for MMR
        if let Some(emb_bytes) = &chunk.embedding {
            chunk_embeddings.insert(chunk.id.clone(), bytes_to_embedding(emb_bytes));
        }

        results.push(KnowledgeSearchResult {
            chunk_id: chunk.id.clone(),
            note_id: chunk.note_id.clone(),
            note_title,
            content: chunk.content.clone(),
            score,
        });
    }

    // Rerank if configured
    let reranker_config = db.get_default_reranker_config().map_err(|e| e.to_string())?;
    if let Some(config) = reranker_config {
        let rerank_k = SettingsManager::get_int(keys::RAG_RERANK_K, defaults::RAG_RERANK_K);
        results = rerank_knowledge_results(&config, query, results, rerank_k).await?;
    }

    // MMR selection for diversity (lambda=0.75: 75% relevance, 25% diversity)
    results = mmr_select(&results, top_k, 0.75, &chunk_embeddings);

    // Deduplicate: max 3 chunks per note
    results = deduplicate_results(results, 3);

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
