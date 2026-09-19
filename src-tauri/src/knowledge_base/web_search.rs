use crate::db::{Database, SearchConfig};
use crate::knowledge_base::types::KnowledgeWebSearchResult;
use crate::settings::{defaults, keys, SettingsManager};
use crate::DATABASE;
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

const MAX_RESULTS: usize = 5;
const MAX_SNIPPET_CHARS: usize = 800;
const DEFAULT_TAVILY_BASE: &str = "https://api.tavily.com";
const DEFAULT_BOCHA_BASE: &str = "https://api.bochaai.com/v1";
const DEFAULT_BAIDU_BASE: &str = "https://qianfan.baidubce.com/v2";
const BAIDU_WEB_PROVIDER: &str = "baidu_web";
const BAIDU_SEARCH_ENDPOINT: &str = "https://www.baidu.com/s";
const BAIDU_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchProvider {
    Tavily,
    Bocha,
    Baidu,
    Custom,
}

impl SearchProvider {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "tavily" => Ok(Self::Tavily),
            "bocha" => Ok(Self::Bocha),
            "baidu" => Ok(Self::Baidu),
            "custom" => Ok(Self::Custom),
            other => Err(format!("不支持的搜索服务: {}", other)),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tavily => "tavily",
            Self::Bocha => "bocha",
            Self::Baidu => "baidu",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RawWebHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub provider: String,
    pub query_text: String,
    pub retrieved_at: String,
}

pub fn should_use_web_search(enable_web_search: bool) -> bool {
    enable_web_search
}

#[allow(dead_code)]
pub fn looks_like_realtime_or_fact_check(query: &str) -> bool {
    const KEYWORDS: &[&str] = &[
        "最新",
        "官网",
        "官方网站",
        "价格",
        "新闻",
        "现在",
        "今年",
        "2025",
        "2026",
        "搜一下",
        "网上",
        "实时",
        "目前",
        "近日",
        "今天",
        "股价",
        "发布了",
        "查一下",
        "latest",
        "official",
        "price",
        "news",
        "search the web",
        "look up",
    ];
    KEYWORDS.iter().any(|keyword| query.contains(keyword))
}

pub fn cache_key(provider: &str, query: &str) -> String {
    let normalized = normalize_query(query);
    let mut hasher = Sha256::new();
    hasher.update(provider.as_bytes());
    hasher.update(b"\n");
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn normalize_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub fn default_base_url(provider: SearchProvider) -> &'static str {
    match provider {
        SearchProvider::Tavily => DEFAULT_TAVILY_BASE,
        SearchProvider::Bocha => DEFAULT_BOCHA_BASE,
        SearchProvider::Baidu => DEFAULT_BAIDU_BASE,
        SearchProvider::Custom => "",
    }
}

fn get_db() -> Result<&'static Database, String> {
    DATABASE.get().ok_or_else(|| "Database not initialized".to_string())
}

fn timeout_secs() -> u64 {
    SettingsManager::get_int(keys::WEB_SEARCH_TIMEOUT, defaults::WEB_SEARCH_TIMEOUT).max(3)
}

fn cache_ttl_secs() -> i64 {
    SettingsManager::get_int(keys::WEB_SEARCH_CACHE_TTL, defaults::WEB_SEARCH_CACHE_TTL).max(60) as i64
}

fn now_local() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn truncate_snippet(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_SNIPPET_CHARS {
        return trimmed.to_string();
    }
    let mut output = trimmed.chars().take(MAX_SNIPPET_CHARS).collect::<String>();
    output.push('…');
    output
}

fn search_endpoint(provider: SearchProvider, base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    match provider {
        SearchProvider::Tavily => {
            if trimmed.ends_with("/search") {
                trimmed.to_string()
            } else {
                format!("{}/search", trimmed)
            }
        }
        SearchProvider::Bocha => {
            if trimmed.ends_with("/web-search") {
                trimmed.to_string()
            } else {
                format!("{}/web-search", trimmed)
            }
        }
        SearchProvider::Baidu => {
            if trimmed.ends_with("/ai_search/web_search") || trimmed.ends_with("/web_search") {
                trimmed.to_string()
            } else {
                format!("{}/ai_search/web_search", trimmed)
            }
        }
        SearchProvider::Custom => {
            if trimmed.ends_with("/search") || trimmed.ends_with("/web-search") {
                trimmed.to_string()
            } else {
                format!("{}/search", trimmed)
            }
        }
    }
}

pub fn parse_search_response(provider: SearchProvider, payload: &Value) -> Vec<RawWebHit> {
    let retrieved_at = now_local();
    let provider_name = provider.as_str().to_string();
    let items: Vec<Value> = match provider {
        SearchProvider::Tavily => payload
            .get("results")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        SearchProvider::Bocha => payload
            .pointer("/data/webPages/value")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        SearchProvider::Baidu => payload
            .get("references")
            .or_else(|| payload.pointer("/data/references"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        SearchProvider::Custom => payload
            .get("results")
            .or_else(|| payload.pointer("/data/results"))
            .or_else(|| payload.get("data"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    };

    let mut seen = std::collections::HashSet::new();
    let mut hits = Vec::new();
    for item in items {
        let title = item
            .get("title")
            .or_else(|| item.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let url = item
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let snippet = item
            .get("content")
            .or_else(|| item.get("snippet"))
            .or_else(|| item.get("summary"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if url.is_empty() || !seen.insert(url.clone()) {
            continue;
        }
        hits.push(RawWebHit {
            title: if title.is_empty() { url.clone() } else { title },
            url,
            snippet: truncate_snippet(&snippet),
            provider: provider_name.clone(),
            query_text: String::new(),
            retrieved_at: retrieved_at.clone(),
        });
        if hits.len() >= MAX_RESULTS {
            break;
        }
    }
    hits
}


fn provider_error_message(payload: &Value) -> Option<String> {
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .or_else(|| error.as_str())
            .unwrap_or("搜索失败");
        return Some(message.to_string());
    }
    let code = payload.get("code");
    let is_ok = match code {
        None => true,
        Some(Value::String(value)) => {
            value.is_empty() || value.eq_ignore_ascii_case("success") || value == "0"
        }
        Some(Value::Number(value)) => value.as_i64() == Some(0),
        Some(_) => true,
    };
    if is_ok {
        return None;
    }
    Some(
        payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("搜索失败")
            .to_string(),
    )
}

fn hits_to_results(hits: &[RawWebHit]) -> Vec<KnowledgeWebSearchResult> {
    hits.iter()
        .enumerate()
        .map(|(index, hit)| KnowledgeWebSearchResult {
            id: String::new(),
            rank: index as i32 + 1,
            title: hit.title.clone(),
            url: hit.url.clone(),
            snippet: hit.snippet.clone(),
            provider: hit.provider.clone(),
            query_text: Some(hit.query_text.clone()).filter(|value| !value.is_empty()),
            retrieved_at: hit.retrieved_at.clone(),
            verified: false,
        })
        .collect()
}

fn load_cached_hits(db: &Database, key: &str) -> Result<Option<Vec<RawWebHit>>, String> {
    let Some((results_json, expires_at)) = db
        .get_web_search_cache(key)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if expires_at < now_local() {
        let _ = db.delete_web_search_cache(key);
        return Ok(None);
    }
    let hits: Vec<RawWebHit> = serde_json::from_str(&results_json).map_err(|e| e.to_string())?;
    Ok(Some(hits))
}


fn mu_url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"\smu="(https?://[^"]+)""#).expect("baidu mu regex"))
}

fn title_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)<h3[^>]*>\s*<a[^>]*>(.*?)</a>").expect("baidu title regex"))
}

fn summary_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?is)class="[^"]*summary-text[^"]*"[^>]*>(.*?)</span>"#).expect("baidu summary regex")
    })
}

fn abstract_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?is)class="[^"]*c-abstract[^"]*"[^>]*>(.*?)</(?:span|div)>"#).expect("baidu abstract regex")
    })
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&ndash;", "-")
        .replace("&mdash;", "—")
}

fn strip_html(value: &str) -> String {
    static TAG_RE: OnceLock<Regex> = OnceLock::new();
    let tag_re = TAG_RE.get_or_init(|| Regex::new(r"<[^>]+>").expect("html tag regex"));
    let without_tags = tag_re.replace_all(value, " ");
    let decoded = decode_html_entities(&without_tags);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn should_keep_baidu_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return false;
    }
    const SKIP: &[&str] = &[
        "recommend_list.baidu.com",
        "pos.baidu.com",
        "top.baidu.com",
        "wappass.baidu.com",
        "baidu.com/s?",
        "chrome-extension://",
    ];
    !SKIP.iter().any(|item| lower.contains(item))
}

pub fn parse_baidu_html(html: &str) -> Vec<RawWebHit> {
    let retrieved_at = now_local();
    let mut seen = std::collections::HashSet::new();
    let mut hits = Vec::new();
    for cap in mu_url_re().captures_iter(html) {
        let url = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        if url.is_empty() || !should_keep_baidu_url(&url) || !seen.insert(url.clone()) {
            continue;
        }
        let start = cap.get(0).map(|m| m.start()).unwrap_or(0);
        let end = html.len().min(start + 16000);
        let block = &html[start..end];
        let title = title_re()
            .captures(block)
            .and_then(|item| item.get(1).map(|m| strip_html(m.as_str())))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| url.clone());
        let snippet = summary_re()
            .captures(block)
            .or_else(|| abstract_re().captures(block))
            .and_then(|item| item.get(1).map(|m| strip_html(m.as_str())))
            .unwrap_or_default();
        hits.push(RawWebHit {
            title,
            url,
            snippet: truncate_snippet(&snippet),
            provider: BAIDU_WEB_PROVIDER.to_string(),
            query_text: String::new(),
            retrieved_at: retrieved_at.clone(),
        });
        if hits.len() >= MAX_RESULTS {
            break;
        }
    }
    hits
}

async fn execute_baidu_web_search(query: &str) -> Result<Vec<RawWebHit>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs()))
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("创建搜索客户端失败: {}", e))?;
    let response = client
        .get(BAIDU_SEARCH_ENDPOINT)
        .query(&[
            ("wd", query),
            ("ie", "utf-8"),
            ("rn", "10"),
        ])
        .header("User-Agent", BAIDU_USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("百度搜索请求失败: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("百度搜索错误 {}", response.status()));
    }
    let html = response
        .text()
        .await
        .map_err(|e| format!("读取百度搜索结果失败: {}", e))?;
    if html.contains("wappass.baidu.com") || html.contains("安全验证") {
        return Err("百度搜索触发验证码，请稍后再试".to_string());
    }
    let mut hits = parse_baidu_html(&html);
    if hits.is_empty() {
        return Err("百度搜索未返回可用结果".to_string());
    }
    for hit in &mut hits {
        hit.query_text = query.to_string();
    }
    Ok(hits)
}

async fn search_baidu_web(
    query: &str,
    abort_flag: Option<&Arc<AtomicBool>>,
    use_cache: bool,
) -> Result<Vec<KnowledgeWebSearchResult>, String> {
    if abort_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("请求已取消".to_string());
    }
    let db = get_db()?;
    let key = cache_key(BAIDU_WEB_PROVIDER, query);
    if use_cache {
        if let Some(hits) = load_cached_hits(db, &key)? {
            return Ok(hits_to_results(&hits));
        }
    }
    if abort_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("请求已取消".to_string());
    }
    let hits = execute_baidu_web_search(query).await?;
    if use_cache {
        let expires_at = (chrono::Local::now() + chrono::Duration::seconds(cache_ttl_secs()))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let results_json = serde_json::to_string(&hits).unwrap_or_else(|_| "[]".to_string());
        let _ = db.upsert_web_search_cache(&key, BAIDU_WEB_PROVIDER, query, &results_json, &expires_at);
    }
    Ok(hits_to_results(&hits))
}

fn search_config_has_api_key(config: &SearchConfig) -> bool {
    let key = config.api_key.trim();
    !key.is_empty() && key != crate::db::API_KEY_MIGRATED_PLACEHOLDER
}

async fn execute_provider_search(
    provider: SearchProvider,
    base_url: &str,
    api_key: &str,
    query: &str,
) -> Result<Vec<RawWebHit>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs()))
        .build()
        .map_err(|e| format!("创建搜索客户端失败: {}", e))?;
    let endpoint = search_endpoint(provider, base_url);
    let body = match provider {
        SearchProvider::Tavily => json!({
            "api_key": api_key,
            "query": query,
            "max_results": MAX_RESULTS,
            "search_depth": "basic",
            "include_answer": false
        }),
        SearchProvider::Bocha => json!({
            "query": query,
            "freshness": "noLimit",
            "summary": true,
            "count": MAX_RESULTS
        }),
        SearchProvider::Baidu => json!({
            "messages": [{
                "role": "user",
                "content": query
            }],
            "search_source": "baidu_search_v2",
            "resource_type_filter": [{
                "type": "web",
                "top_k": MAX_RESULTS
            }]
        }),
        SearchProvider::Custom => json!({
            "query": query,
            "max_results": MAX_RESULTS
        }),
    };

    let response = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("搜索 API 错误 {}: {}", status, error_text));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("解析搜索结果失败: {}", e))?;
    if let Some(message) = provider_error_message(&payload) {
        return Err(format!("搜索 API 错误: {}", message));
    }
    let mut hits = parse_search_response(provider, &payload);
    for hit in &mut hits {
        hit.query_text = query.to_string();
    }
    Ok(hits)
}

pub async fn search_web(
    query: &str,
    abort_flag: Option<&Arc<AtomicBool>>,
    use_cache: bool,
) -> Result<Vec<KnowledgeWebSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("搜索词不能为空".to_string());
    }
    if abort_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("请求已取消".to_string());
    }

    let db = get_db()?;
    if let Some(config) = db.get_default_search_config().map_err(|e| e.to_string())? {
        if search_config_has_api_key(&config) {
            return search_web_with_config(&config, query, abort_flag, use_cache).await;
        }
    }
    search_baidu_web(query, abort_flag, use_cache).await
}

pub async fn search_web_with_config(
    config: &SearchConfig,
    query: &str,
    abort_flag: Option<&Arc<AtomicBool>>,
    use_cache: bool,
) -> Result<Vec<KnowledgeWebSearchResult>, String> {
    let provider = SearchProvider::parse(&config.provider)?;
    let base_url = if config.base_url.trim().is_empty() {
        default_base_url(provider).to_string()
    } else {
        config.base_url.trim().to_string()
    };
    if base_url.is_empty() {
        return Err("搜索服务 BaseURL 不能为空".to_string());
    }
    if config.api_key.trim().is_empty() || config.api_key == crate::db::API_KEY_MIGRATED_PLACEHOLDER {
        return Err("搜索 API Key 不能为空".to_string());
    }

    let db = get_db()?;
    let key = cache_key(&config.provider, query);
    if use_cache {
        if let Some(hits) = load_cached_hits(db, &key)? {
            return Ok(hits_to_results(&hits));
        }
    }

    if abort_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("请求已取消".to_string());
    }

    let hits = execute_provider_search(provider, &base_url, &config.api_key, query).await?;
    if use_cache {
        let expires_at = (chrono::Local::now() + chrono::Duration::seconds(cache_ttl_secs()))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let results_json = serde_json::to_string(&hits).unwrap_or_else(|_| "[]".to_string());
        let _ = db.upsert_web_search_cache(&key, &config.provider, query, &results_json, &expires_at);
    }
    Ok(hits_to_results(&hits))
}

pub fn persist_web_sources(
    db: &Database,
    message_id: &str,
    results: &[KnowledgeWebSearchResult],
) -> Result<Vec<KnowledgeWebSearchResult>, String> {
    db.delete_knowledge_chat_web_sources(message_id)
        .map_err(|e| e.to_string())?;
    let mut persisted = Vec::new();
    for (index, result) in results.iter().enumerate() {
        let rank = index as i32 + 1;
        let source = db
            .create_knowledge_chat_web_source(
                message_id,
                rank,
                &result.title,
                &result.url,
                &result.snippet,
                &result.provider,
                result.query_text.as_deref(),
                &result.retrieved_at,
                result.verified,
            )
            .map_err(|e| e.to_string())?;
        persisted.push(KnowledgeWebSearchResult::from(source));
    }
    Ok(persisted)
}

#[tauri::command]
pub async fn test_search_connection(
    provider: String,
    base_url: String,
    api_key: String,
) -> Result<String, String> {
    crate::validation::validate_search_provider(&provider)?;
    crate::validation::validate_url(&base_url)?;
    crate::validation::validate_api_key(&api_key)?;
    let config = SearchConfig {
        id: String::new(),
        title: "test".to_string(),
        provider,
        base_url,
        api_key,
        sort_order: 0,
        is_default: false,
    };
    let results = search_web_with_config(&config, "OpenAI", None, false).await?;
    if results.is_empty() {
        return Err("连接成功，但未返回搜索结果".to_string());
    }
    Ok(format!("连接成功，返回 {} 条结果", results.len()))
}

#[tauri::command]
pub async fn knowledge_base_web_search(query: String) -> Result<Vec<KnowledgeWebSearchResult>, String> {
    search_web(&query, None, true).await
}

#[tauri::command]
pub fn knowledge_base_set_web_source_verified(id: String, verified: bool) -> Result<(), String> {
    let db = get_db()?;
    db.set_knowledge_chat_web_source_verified(&id, verified)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn web_search_stays_off_by_default() {
        assert!(!should_use_web_search(false));
        assert!(should_use_web_search(true));
        assert!(looks_like_realtime_or_fact_check("最新官网价格"));
        assert!(!looks_like_realtime_or_fact_check("笔记里怎么分段"));
    }

    #[test]
    fn cache_key_is_stable_after_normalizing_query() {
        let left = cache_key("tavily", "  OpenAI   官网 ");
        let right = cache_key("tavily", "openai 官网");
        assert_eq!(left, right);
        assert_ne!(left, cache_key("bocha", "openai 官网"));
    }

    #[test]
    fn parse_tavily_results_uses_content_and_dedupes_url() {
        let payload = json!({
            "results": [
                {"title": "OpenAI", "url": "https://openai.com", "content": "官方网站"},
                {"title": "Duplicate", "url": "https://openai.com", "content": "重复"},
                {"title": "Docs", "url": "https://platform.openai.com", "content": "文档"}
            ]
        });
        let hits = parse_search_response(SearchProvider::Tavily, &payload);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "OpenAI");
        assert_eq!(hits[0].snippet, "官方网站");
        assert_eq!(hits[1].url, "https://platform.openai.com");
    }

    #[test]
    fn parse_bocha_results_uses_nested_web_pages() {
        let payload = json!({
            "data": {
                "webPages": {
                    "value": [
                        {
                            "name": "博查",
                            "url": "https://bochaai.com",
                            "snippet": "中文搜索",
                            "summary": "摘要优先"
                        }
                    ]
                }
            }
        });
        let hits = parse_search_response(SearchProvider::Bocha, &payload);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "博查");
        assert_eq!(hits[0].snippet, "中文搜索");

    }

    #[test]
    fn search_endpoint_appends_baidu_ai_search_path() {
        assert_eq!(
            search_endpoint(SearchProvider::Baidu, "https://qianfan.baidubce.com/v2"),
            "https://qianfan.baidubce.com/v2/ai_search/web_search"
        );
        assert_eq!(
            search_endpoint(
                SearchProvider::Baidu,
                "https://qianfan.baidubce.com/v2/ai_search/web_search/"
            ),
            "https://qianfan.baidubce.com/v2/ai_search/web_search"
        );
    }

    #[test]
    fn parse_baidu_results_uses_references() {
        let payload = json!({
            "references": [
                {
                    "title": "Baidu",
                    "url": "https://www.baidu.com",
                    "content": "official-site"
                },
                {
                    "title": "Duplicate",
                    "url": "https://www.baidu.com",
                    "snippet": "dup"
                },
                {
                    "title": "News",
                    "url": "https://news.baidu.com",
                    "snippet": "latest-news"
                }
            ]
        });
        let hits = parse_search_response(SearchProvider::Baidu, &payload);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "Baidu");
        assert_eq!(hits[0].snippet, "official-site");
        assert_eq!(hits[1].url, "https://news.baidu.com");
        assert_eq!(hits[1].snippet, "latest-news");
    }

    #[test]
    fn parse_baidu_results_uses_nested_data_references() {
        let payload = json!({
            "data": {
                "references": [
                    {
                        "title": "Qianfan",
                        "url": "https://qianfan.cloud.baidu.com",
                        "content": "ai-search"
                    }
                ]
            }
        });
        let hits = parse_search_response(SearchProvider::Baidu, &payload);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Qianfan");
        assert_eq!(hits[0].snippet, "ai-search");
    }

    #[test]
    fn parse_baidu_html_uses_mu_title_and_summary() {
        let html = r#"
<div class="result c-container xpath-log new-pmd"
    mu="https://www.openai.com/"
>
    <h3 class="t"><a href="http://www.baidu.com/link?url=abc">OpenAI | Research &amp; Deployment</a></h3>
    <span class="    summary-text_15QGa">An <em>OpenAI</em> model proposes a solution</span>
</div>
<div class="result c-container"
    mu="http://28616.recommend_list.baidu.com"
>
    <h3><a>广告</a></h3>
</div>
<div class="result c-container"
    mu="https://www.openai.com/"
>
    <h3><a>重复</a></h3>
</div>
<div class="result c-container"
    mu="https://baike.baidu.com/item/OpenAI/19758408"
>
    <span class="c-abstract">百科摘要</span>
</div>
"#;
        let hits = parse_baidu_html(html);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "OpenAI | Research & Deployment");
        assert_eq!(hits[0].url, "https://www.openai.com/");
        assert_eq!(hits[0].snippet, "An OpenAI model proposes a solution");
        assert_eq!(hits[0].provider, "baidu_web");
        assert_eq!(hits[1].url, "https://baike.baidu.com/item/OpenAI/19758408");
        assert_eq!(hits[1].snippet, "百科摘要");
    }
}
