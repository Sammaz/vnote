//! AI线程池统一管理模块
//!
//! 功能：
//! - 为每个 AiConfig 独立管理并发槽位
//! - FIFO队列调度
//! - 统一的请求中止机制
//! - 流式/非流式请求支持

use crate::db::AiConfig;
use crate::prompts;
use futures::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinHandle;

// ============================================================================
// 全局单例
// ============================================================================

/// 全局AI线程池管理器
static AI_POOL_MANAGER: OnceLock<AiPoolManager> = OnceLock::new();

/// 获取全局AI线程池管理器
pub fn get_ai_pool_manager() -> &'static AiPoolManager {
    AI_POOL_MANAGER.get_or_init(|| AiPoolManager::new())
}

// ============================================================================
// 配置常量
// ============================================================================

/// 请求超时时间（秒）
const REQUEST_TIMEOUT_SECS: u64 = 180;

/// HTTP连接池配置
const POOL_MAX_IDLE_PER_HOST: usize = 20;
const POOL_IDLE_TIMEOUT_SECS: u64 = 90;

// ============================================================================
// 公共类型定义（复用chat.rs的结构以保持兼容）
// ============================================================================

/// 聊天消息
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// 图片数据
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ImageData {
    pub data: String, // Base64 encoded with data URL prefix
}

/// 流式事件（与chat.rs保持兼容）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    Start { message_id: String },
    Delta { content: String },
    Done { success: bool, error: Option<String> },
}

// ============================================================================
// 单个配置的并发控制器
// ============================================================================

/// 单个AiConfig的并发控制器
struct ConfigConcurrencyController {
    /// 信号量：控制并发数
    semaphore: Arc<Semaphore>,
    /// 当前活跃请求数（用于监控）
    active_count: Arc<AtomicUsize>,
    /// 等待队列长度（用于监控）
    waiting_count: Arc<AtomicUsize>,
}

impl ConfigConcurrencyController {
    /// 创建新的并发控制器
    fn new(concurrent_limit: i32) -> Self {
        let limit = concurrent_limit.max(1).min(10) as usize;
        Self {
            semaphore: Arc::new(Semaphore::new(limit)),
            active_count: Arc::new(AtomicUsize::new(0)),
            waiting_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// 获取槽位（异步等待，FIFO顺序）
    async fn acquire(&self) -> Arc<Semaphore> {
        self.waiting_count.fetch_add(1, Ordering::Relaxed);
        // 等待获取信号量许可
        let _permit = self.semaphore.acquire().await.unwrap();
        self.waiting_count.fetch_sub(1, Ordering::Relaxed);
        self.active_count.fetch_add(1, Ordering::Relaxed);
        // 返回信号量的引用，用于在Drop时释放
        self.semaphore.clone()
    }

    /// 释放槽位
    fn release(&self) {
        self.active_count.fetch_sub(1, Ordering::Relaxed);
    }

    /// 获取状态（预留用于监控）
    #[allow(dead_code)]
    fn status(&self) -> (usize, usize) {
        (
            self.active_count.load(Ordering::Relaxed),
            self.waiting_count.load(Ordering::Relaxed),
        )
    }
}

// ============================================================================
// 全局线程池管理器
// ============================================================================

/// AI线程池管理器
pub struct AiPoolManager {
    /// HTTP客户端（全局共享）
    http_client: OnceLock<Client>,
    /// 每个AiConfig的并发控制器：config_id -> controller
    controllers: Mutex<HashMap<i64, Arc<ConfigConcurrencyController>>>,
    /// 所有中止标志：request_id -> abort_flag
    abort_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 运行中的任务句柄：request_id -> JoinHandle
    running_tasks: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl AiPoolManager {
    /// 创建新的管理器
    pub fn new() -> Self {
        Self {
            http_client: OnceLock::new(),
            controllers: Mutex::new(HashMap::new()),
            abort_flags: Mutex::new(HashMap::new()),
            running_tasks: Mutex::new(HashMap::new()),
        }
    }

    /// �始化或获取HTTP客户端
    fn get_http_client(&self) -> &Client {
        self.http_client.get_or_init(|| {
            Client::builder()
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .pool_max_idle_per_host(POOL_MAX_IDLE_PER_HOST)
                .pool_idle_timeout(std::time::Duration::from_secs(POOL_IDLE_TIMEOUT_SECS))
                .connect_timeout(std::time::Duration::from_secs(30))
                .http2_keep_alive_interval(std::time::Duration::from_secs(30))
                .http2_keep_alive_timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("Failed to create HTTP client")
        })
    }

    /// 确保并发控制器存在（不存在则创建）
    async fn ensure_controller(
        &self,
        config_id: i64,
        concurrent_limit: i32,
    ) -> Arc<ConfigConcurrencyController> {
        let mut controllers = self.controllers.lock().await;

        if let Some(controller) = controllers.get(&config_id) {
            controller.clone()
        } else {
            let controller = Arc::new(ConfigConcurrencyController::new(concurrent_limit));
            controllers.insert(config_id, controller.clone());
            controller
        }
    }

    /// 更新并发限制（用于配置更新后）
    #[allow(dead_code)]
    pub async fn update_concurrent_limit(&self, config_id: i64, _new_limit: i32) {
        let mut controllers = self.controllers.lock().await;
        // 移除旧的控制器（会在下一次请求时重新创建）
        controllers.remove(&config_id);
    }

    /// 注册中止标志（public供note_generation模块使用）
    pub async fn register_abort_flag(&self, request_id: String) -> Arc<AtomicBool> {
        let mut flags = self.abort_flags.lock().await;
        flags
            .entry(request_id)
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    }

    /// 取消请求
    pub async fn abort_request(&self, request_id: &str) -> Result<(), String> {
        let flags = self.abort_flags.lock().await;
        if let Some(flag) = flags.get(request_id) {
            flag.store(true, Ordering::Relaxed);
            Ok(())
        } else {
            Err("请求不存在".to_string())
        }
    }

    /// 清理中止标志（public供note_generation模块使用）
    pub async fn cleanup_abort_flag(&self, request_id: &str) {
        let mut flags = self.abort_flags.lock().await;
        flags.remove(request_id);

        // 同时清理任务句柄
        let mut tasks = self.running_tasks.lock().await;
        tasks.remove(request_id);
    }

    /// 获取状态（预留用于监控）
    #[allow(dead_code)]
    pub async fn get_status(&self, config_id: i64) -> Option<(usize, usize)> {
        let controllers = self.controllers.lock().await;
        controllers.get(&config_id).map(|c| c.status())
    }

    /// 获取所有状态（预留用于监控）
    #[allow(dead_code)]
    pub async fn get_all_status(&self) -> HashMap<i64, (usize, usize)> {
        let controllers = self.controllers.lock().await;
        controllers
            .iter()
            .map(|(id, c)| (*id, c.status()))
            .collect()
    }
}

// ============================================================================
// 流式聊天实现
// ============================================================================

/// 流式聊天请求参数
pub struct StreamingChatRequest {
    pub app: AppHandle,
    pub event_name: String,
    pub request_id: String,
    pub config: AiConfig,
    pub messages: Vec<ChatMessage>,
    pub images: Option<Vec<ImageData>>,
}

/// 执行流式聊天请求
pub async fn execute_streaming_chat(
    req: StreamingChatRequest,
    rag_context: Option<String>,
) -> Result<(), String> {
    let pool = get_ai_pool_manager();
    let request_id = req.request_id.clone();
    let abort_flag = pool.register_abort_flag(request_id.clone()).await;

    // 获取并发控制器
    let controller = pool
        .ensure_controller(req.config.id, req.config.concurrent_limit)
        .await;

    // 获取许可（FIFO排队）
    let _permit = controller.acquire().await;

    // 保存app和event_name的克隆用于后续发送事件
    let app = req.app.clone();
    let event_name = req.event_name.clone();

    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        controller.release();
        pool.cleanup_abort_flag(&request_id).await;
        let _ = app.emit(&event_name, StreamEvent::Done {
            success: false,
            error: Some("请求已取消".to_string()),
        });
        return Err("请求已取消".to_string());
    }

    // 执行实际的API调用
    let result = execute_streaming_chat_impl(pool, req, rag_context, abort_flag).await;

    // 发送完成事件
    let done_event = match &result {
        Ok(_) => StreamEvent::Done {
            success: true,
            error: None,
        },
        Err(e) => StreamEvent::Done {
            success: false,
            error: Some(e.clone()),
        },
    };
    let _ = app.emit(&event_name, done_event);

    // 清理
    controller.release();
    pool.cleanup_abort_flag(&request_id).await;

    result
}

/// 实际的流式API调用实现
async fn execute_streaming_chat_impl(
    pool: &AiPoolManager,
    req: StreamingChatRequest,
    rag_context: Option<String>,
    abort_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let client = pool.get_http_client();

    // 构建消息数组
    let mut api_messages: Vec<Value> = Vec::new();

    // 添加系统提示词（根据RAG上下文是否可用）
    if let Some(system_prompt) = prompts::build_chat_system_prompt(rag_context) {
        api_messages.push(json!({
            "role": "system",
            "content": system_prompt
        }));
    }

    // 添加对话历史
    for (i, msg) in req.messages.iter().enumerate() {
        let is_last_user_message = i == req.messages.len() - 1 && msg.role == "user";

        // 检查是否是最后一条用户消息且有图片
        if is_last_user_message && req.images.is_some() {
            let images = req.images.as_ref().unwrap();
            if !images.is_empty() {
                // 构建多模态内容
                let mut content: Vec<Value> = vec![json!({
                    "type": "text",
                    "text": msg.content
                })];

                for img in images {
                    content.push(json!({
                        "type": "image_url",
                        "image_url": {
                            "url": img.data
                        }
                    }));
                }

                api_messages.push(json!({
                    "role": "user",
                    "content": content
                }));
                continue;
            }
        }

        api_messages.push(json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    // 构建API URL
    let base_url = req.config.base_url.trim_end_matches('/');
    let api_url = format!("{}/chat/completions", base_url);

    // 构建请求体
    let body = json!({
        "model": req.config.model,
        "messages": api_messages,
        "stream": true
    });

    // 发送请求
    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", req.config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    // 再次检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err("请求已取消".to_string());
    }

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API错误 {}: {}", status, error_text));
    }

    // 发送开始事件
    let message_id = uuid::Uuid::new_v4().to_string();
    let _ = req.app.emit(
        &req.event_name,
        StreamEvent::Start {
            message_id: message_id.clone(),
        },
    );

    // 处理SSE流
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        // 检查中止
        if abort_flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }

        let chunk = chunk_result.map_err(|e| format!("流错误: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // 处理完整的行
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        if !content.is_empty() {
                            let _ = req.app.emit(
                                &req.event_name,
                                StreamEvent::Delta {
                                    content: content.to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

// ============================================================================
// 非流式请求实现
// ============================================================================

/// 非流式AI请求
pub struct NonStreamingRequest {
    pub config: AiConfig,
    pub prompt: String,
}

/// 非流式响应
pub struct NonStreamingResponse {
    pub content: String,
}

/// 执行非流式请求（不带中止支持，用于简单请求）
pub async fn execute_non_streaming(req: NonStreamingRequest) -> Result<NonStreamingResponse, String> {
    let pool = get_ai_pool_manager();

    // 获取并发控制器
    let controller = pool
        .ensure_controller(req.config.id, req.config.concurrent_limit)
        .await;

    // 获取许可（FIFO排队）
    let _permit = controller.acquire().await;

    // 执行实际的API调用
    let result = execute_non_streaming_impl(pool, req).await;

    // 释放许可
    controller.release();

    result
}

/// 实际的非流式API调用实现
async fn execute_non_streaming_impl(
    pool: &AiPoolManager,
    req: NonStreamingRequest,
) -> Result<NonStreamingResponse, String> {
    let client = pool.get_http_client();

    let base_url = req.config.base_url.trim_end_matches('/');
    let api_url = format!("{}/chat/completions", base_url);

    let body = json!({
        "model": req.config.model,
        "messages": [
            {
                "role": "system",
                "content": "你是一个专业的视频内容分析师，擅长提取和总结信息。"
            },
            {
                "role": "user",
                "content": req.prompt
            }
        ],
        "temperature": 0.7
    });

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", req.config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API错误 {}: {}", status, error_text));
    }

    let json_value: Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = json_value["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "响应格式错误".to_string())?;

    Ok(NonStreamingResponse { content })
}

/// 执行非流式请求（带中止支持，用于生成任务）
pub async fn execute_non_streaming_with_abort(
    req: NonStreamingRequest,
    abort_flag: &Arc<AtomicBool>,
) -> Result<NonStreamingResponse, String> {
    let pool = get_ai_pool_manager();

    // 获取并发控制器
    let controller = pool
        .ensure_controller(req.config.id, req.config.concurrent_limit)
        .await;

    // 获取许可（FIFO排队）
    let _permit = controller.acquire().await;

    // 检查中止
    if abort_flag.load(Ordering::Relaxed) {
        controller.release();
        return Err("请求已取消".to_string());
    }

    // 执行实际的API调用
    let result = execute_non_streaming_impl(&pool, req).await;

    // 再次检查中止（处理请求过程中被取消的情况）
    if abort_flag.load(Ordering::Relaxed) {
        controller.release();
        return Err("请求已取消".to_string());
    }

    // 释放许可
    controller.release();

    result
}
