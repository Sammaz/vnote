//! AI线程池统一管理模块
//!
//! 功能：
//! - 为每个 AiConfig 独立管理并发槽位
//! - 统一的请求中止机制
//! - 流式请求支持（含后台收集模式）

use crate::db::AiConfig;
use crate::prompts;
use futures::StreamExt;
use reqwest::Client;
use std::cmp;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::task::AbortHandle;

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
// 配置
// ============================================================================

use crate::settings::{SettingsManager, keys, defaults};

const MAX_ERROR_RESPONSE_PREVIEW_BYTES: usize = 4 * 1024;
const MAX_STREAM_BUFFER_BYTES: usize = 64 * 1024;

async fn read_error_response_preview(mut response: reqwest::Response) -> String {
    let mut preview = Vec::with_capacity(MAX_ERROR_RESPONSE_PREVIEW_BYTES.min(1024));
    let mut truncated = false;
    let mut read_error = None;

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = MAX_ERROR_RESPONSE_PREVIEW_BYTES.saturating_sub(preview.len());
                if remaining == 0 {
                    truncated = true;
                    break;
                }

                if chunk.len() > remaining {
                    preview.extend_from_slice(&chunk[..remaining]);
                    truncated = true;
                    break;
                }

                preview.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(error) => {
                read_error = Some(error.to_string());
                break;
            }
        }
    }

    let mut text = String::from_utf8_lossy(&preview).trim().to_string();

    if text.is_empty() {
        text = match read_error {
            Some(error) => format!("读取错误响应失败: {}", error),
            None => "响应体为空".to_string(),
        };
    } else if let Some(error) = read_error {
        text.push_str(&format!(" [读取剩余响应失败: {}]", error));
    }

    if truncated {
        text.push_str(" …(truncated)");
    }

    text
}

fn ensure_stream_buffer_limit(buffer: &str) -> Result<(), String> {
    if buffer.len() > MAX_STREAM_BUFFER_BYTES {
        Err(format!(
            "流响应异常，缓冲区超过 {}KB",
            MAX_STREAM_BUFFER_BYTES / 1024
        ))
    } else {
        Ok(())
    }
}

fn build_chat_completions_body(
    model: &str,
    messages: Vec<Value>,
    reasoning_effort: &str,
    max_tokens: Option<u32>,
) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true
    });

    if reasoning_effort != "off" {
        body["reasoning_effort"] = Value::String(reasoning_effort.to_string());
    }

    if let Some(max_tokens) = max_tokens {
        body["max_tokens"] = Value::Number(max_tokens.into());
    }

    body
}

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
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    Start { message_id: String },
    Delta { content: String },
    Done { success: bool, error: Option<String> },
}

// ============================================================================
// 单个配置的并发控制器
// ============================================================================

/// 令牌桶速率限制器
struct TokenBucket {
    /// 令牌数量（每分钟允许的请求数）
    tokens: f64,
    /// 令牌桶容量（允许的突发请求数）
    capacity: f64,
    /// 每秒恢复的令牌数
    refill_rate: f64,
    /// 上次更新时间
    last_update: std::time::Instant,
}

impl TokenBucket {
    /// 创建新的令牌桶
    /// rate_limit: 每分钟允许的请求数，0表示不限制
    fn new(rate_limit: i32) -> Self {
        let rate_limit = rate_limit.max(0).min(1000) as f64;
        // 容量设置为速率限制的1.5倍，允许一定的突发
        let capacity = if rate_limit > 0.0 { (rate_limit * 1.5).max(5.0) } else { f64::MAX };
        // 每秒恢复的令牌数 = 每分钟限制 / 60
        let refill_rate = rate_limit / 60.0;

        Self {
            tokens: capacity, // 初始满桶
            capacity,
            refill_rate,
            last_update: std::time::Instant::now(),
        }
    }

    /// 尝试消耗一个令牌
    /// 返回 Ok(()) 如果成功，Err(等待毫秒数) 如果需要等待
    fn try_acquire(&mut self) -> Result<(), u64> {
        // 如果refill_rate为0，表示不限制
        if self.refill_rate <= 0.0 {
            return Ok(());
        }

        // 计算自上次更新以来恢复的令牌
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(self.last_update).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.capacity);
        self.last_update = now;

        // 尝试消耗一个令牌
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Ok(())
        } else {
            // 计算需要等待的时间（毫秒）
            let tokens_needed = 1.0 - self.tokens;
            let wait_secs = tokens_needed / self.refill_rate;
            Err((wait_secs * 1000.0).ceil() as u64)
        }
    }

    /// 更新速率限制
    #[allow(dead_code)]
    fn update_rate_limit(&mut self, rate_limit: i32) {
        let rate_limit = rate_limit.max(0).min(1000) as f64;
        self.capacity = if rate_limit > 0.0 { (rate_limit * 1.5).max(5.0) } else { f64::MAX };
        self.refill_rate = rate_limit / 60.0;
        // 保持当前令牌数，但不超过新容量
        self.tokens = self.tokens.min(self.capacity);
    }
}

struct ActiveSemaphorePermit {
    _permit: OwnedSemaphorePermit,
    active_count: Arc<AtomicUsize>,
}

impl ActiveSemaphorePermit {
    fn new(permit: OwnedSemaphorePermit, active_count: Arc<AtomicUsize>) -> Self {
        active_count.fetch_add(1, Ordering::Relaxed);
        Self {
            _permit: permit,
            active_count,
        }
    }
}

impl Drop for ActiveSemaphorePermit {
    fn drop(&mut self) {
        self.active_count.fetch_sub(1, Ordering::Relaxed);
    }
}

/// 单个AiConfig的并发控制器
struct ConfigConcurrencyController {
    /// 信号量：控制并发数
    semaphore: Arc<Mutex<Arc<Semaphore>>>,
    /// 当前并发限制（用于读取配置）
    concurrent_limit: Arc<Mutex<usize>>,
    /// 当前活跃请求数（用于监控）
    active_count: Arc<AtomicUsize>,
    /// 等待数量（用于监控）
    waiting_count: Arc<AtomicUsize>,
    /// 令牌桶速率限制器
    rate_limiter: Arc<Mutex<TokenBucket>>,
}

impl ConfigConcurrencyController {
    /// 创建新的并发控制器
    fn new(concurrent_limit: i32, rate_limit: i32) -> Self {
        let limit = concurrent_limit.max(1).min(10) as usize;
        Self {
            semaphore: Arc::new(Mutex::new(Arc::new(Semaphore::new(limit)))),
            concurrent_limit: Arc::new(Mutex::new(limit)),
            active_count: Arc::new(AtomicUsize::new(0)),
            waiting_count: Arc::new(AtomicUsize::new(0)),
            rate_limiter: Arc::new(Mutex::new(TokenBucket::new(rate_limit))),
        }
    }

    /// 动态更新并发限制
    pub async fn update_concurrent_limit(&self, new_limit: i32) {
        let limit = new_limit.max(1).min(10) as usize;

        let mut limit_guard = self.concurrent_limit.lock().await;
        let previous_limit = *limit_guard;
        *limit_guard = limit;
        drop(limit_guard);

        if limit > previous_limit {
            let semaphore = {
                let guard = self.semaphore.lock().await;
                guard.clone()
            };
            semaphore.add_permits(limit - previous_limit);
        }
    }

    /// 动态更新速率限制
    #[allow(dead_code)]
    pub async fn update_rate_limit(&self, new_limit: i32) {
        let mut rate_limiter = self.rate_limiter.lock().await;
        rate_limiter.update_rate_limit(new_limit);
        tracing::info!("[AI线程池] 速率限制已更新为 {} 次/分钟", new_limit);
    }

    /// 检查速率限制（异步等待直到有令牌可用）
    #[allow(dead_code)]
    async fn check_rate_limit(&self) {
        loop {
            let result = {
                let mut rate_limiter = self.rate_limiter.lock().await;
                rate_limiter.try_acquire()
            };

            match result {
                Ok(()) => return, // 获取到令牌，可以继续
                Err(wait_ms) => {
                    if wait_ms > 0 {
                        tracing::debug!("[AI线程池] 速率限制：等待 {}ms 后重试", wait_ms);
                        tokio::time::sleep(tokio::time::Duration::from_millis(wait_ms.min(1000))).await;
                    }
                }
            }
        }
    }

    /// 检查速率限制（支持中止检查）
    async fn check_rate_limit_with_abort(&self, abort_flag: &Arc<AtomicBool>) -> Result<(), &'static str> {
        loop {
            // 检查是否被中止
            if abort_flag.load(Ordering::Relaxed) {
                return Err("请求已取消");
            }

            let result = {
                let mut rate_limiter = self.rate_limiter.lock().await;
                rate_limiter.try_acquire()
            };

            match result {
                Ok(()) => return Ok(()), // 获取到令牌，可以继续
                Err(wait_ms) => {
                    if wait_ms > 0 {
                        tracing::debug!("[AI线程池] 速率限制：等待 {}ms 后重试", wait_ms);
                        tokio::time::sleep(tokio::time::Duration::from_millis(wait_ms.min(1000))).await;
                    }
                }
            }
        }
    }

    /// 获取当前并发限制
    #[allow(dead_code)]
    pub async fn get_concurrent_limit(&self) -> usize {
        *self.concurrent_limit.lock().await
    }

    /// 获取槽位（异步等待，带超时保护）
    /// 返回 ActiveSemaphorePermit，持有这个 permit 会保持信号量被占用
    /// 超时时间：5分钟，防止任务永久卡住
    #[allow(dead_code)]
    async fn acquire(&self) -> Result<ActiveSemaphorePermit, String> {
        self.check_rate_limit().await;
        self.waiting_count.fetch_add(1, Ordering::Relaxed);

        let start_time = std::time::Instant::now();
        let timeout_secs = SettingsManager::get_int(keys::AI_TIMEOUT_ACQUIRE, defaults::AI_TIMEOUT_ACQUIRE);
        let timeout_duration = std::time::Duration::from_secs(timeout_secs);

        loop {
            if start_time.elapsed() > timeout_duration {
                self.waiting_count.fetch_sub(1, Ordering::Relaxed);
                tracing::warn!("[AI线程池] 获取信号量超时（{}秒）", timeout_secs);
                return Err(format!("获取并发许可超时（{}秒）", timeout_secs));
            }

            let semaphore = {
                let guard = self.semaphore.lock().await;
                guard.clone()
            };

            if let Ok(permit) = semaphore.clone().try_acquire_owned() {
                self.waiting_count.fetch_sub(1, Ordering::Relaxed);
                return Ok(ActiveSemaphorePermit::new(permit, self.active_count.clone()));
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        }
    }

    /// 获取槽位（支持中止检查，带超时保护）
    /// 返回 ActiveSemaphorePermit，持有这个 permit 会保持信号量被占用
    /// 超时时间：5分钟，防止任务永久卡住
    async fn acquire_with_abort(&self, abort_flag: &Arc<AtomicBool>) -> Result<ActiveSemaphorePermit, String> {
        self.check_rate_limit_with_abort(abort_flag)
            .await
            .map_err(|e| e.to_string())?;
        self.waiting_count.fetch_add(1, Ordering::Relaxed);

        let start_time = std::time::Instant::now();
        let timeout_secs = SettingsManager::get_int(keys::AI_TIMEOUT_ACQUIRE, defaults::AI_TIMEOUT_ACQUIRE);
        let timeout_duration = std::time::Duration::from_secs(timeout_secs);

        loop {
            if abort_flag.load(Ordering::Relaxed) {
                self.waiting_count.fetch_sub(1, Ordering::Relaxed);
                return Err("请求已取消".to_string());
            }

            if start_time.elapsed() > timeout_duration {
                self.waiting_count.fetch_sub(1, Ordering::Relaxed);
                tracing::warn!("[AI线程池] acquire_with_abort 获取信号量超时（{}秒）", timeout_secs);
                return Err(format!("获取并发许可超时（{}秒）", timeout_secs));
            }

            let semaphore = {
                let guard = self.semaphore.lock().await;
                guard.clone()
            };

            if let Ok(permit) = semaphore.try_acquire_owned() {
                self.waiting_count.fetch_sub(1, Ordering::Relaxed);
                return Ok(ActiveSemaphorePermit::new(permit, self.active_count.clone()));
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
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
    /// 每个AiConfig的HTTP客户端：config_id -> (client, timeout_secs)
    http_clients: Mutex<HashMap<String, (Client, u64)>>,
    /// 每个AiConfig的并发控制器：config_id -> controller
    controllers: Mutex<HashMap<String, Arc<ConfigConcurrencyController>>>,
    /// 所有中止标志：request_id -> abort_flag
    abort_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 运行中的任务中止句柄：request_id -> AbortHandle
    abort_handles: Mutex<HashMap<String, AbortHandle>>,
}

impl AiPoolManager {
    /// 创建新的管理器
    pub fn new() -> Self {
        Self {
            http_clients: Mutex::new(HashMap::new()),
            controllers: Mutex::new(HashMap::new()),
            abort_flags: Mutex::new(HashMap::new()),
            abort_handles: Mutex::new(HashMap::new()),
        }
    }

    /// 获取或创建指定配置的HTTP客户端
    async fn get_or_create_http_client(&self, config_id: &str, timeout_secs: i32) -> Client {
        let timeout = if timeout_secs <= 0 {
            None // 0 表示不设置超时
        } else {
            Some(timeout_secs.min(600) as u64)
        };

        let mut clients = self.http_clients.lock().await;

        // 检查是否已有客户端且超时配置相同
        if let Some((client, existing_timeout)) = clients.get(config_id) {
            let current_timeout = timeout.unwrap_or(0);
            if *existing_timeout == current_timeout {
                return client.clone();
            }
        }

        // 获取配置
        let max_idle = SettingsManager::get_int(keys::AI_POOL_MAX_IDLE, defaults::AI_POOL_MAX_IDLE);
        let idle_timeout = SettingsManager::get_int(keys::AI_POOL_IDLE_TIMEOUT, defaults::AI_POOL_IDLE_TIMEOUT);
        let connect_timeout = SettingsManager::get_int(keys::AI_TIMEOUT_CONNECT, defaults::AI_TIMEOUT_CONNECT);

        // 创建新的客户端
        let mut builder = Client::builder()
            .pool_max_idle_per_host(max_idle)
            .pool_idle_timeout(std::time::Duration::from_secs(idle_timeout))
            .connect_timeout(std::time::Duration::from_secs(connect_timeout))
            .http2_keep_alive_interval(std::time::Duration::from_secs(30))
            .http2_keep_alive_timeout(std::time::Duration::from_secs(10));

        if let Some(t) = timeout {
            builder = builder.timeout(std::time::Duration::from_secs(t));
        }

        let client = builder.build().expect("Failed to create HTTP client");
        let stored_timeout = timeout.unwrap_or(0);
        clients.insert(config_id.to_string(), (client.clone(), stored_timeout));
        client
    }

    /// 更新HTTP客户端的超时配置
    pub async fn update_request_timeout(&self, config_id: &str, _timeout_secs: i32) {
        // 移除旧的客户端，下次请求时会创建新的
        let mut clients = self.http_clients.lock().await;
        clients.remove(config_id);
    }

    /// 确保并发控制器存在（不存在则创建）
    async fn ensure_controller(
        &self,
        config_id: &str,
        concurrent_limit: i32,
        rate_limit: i32,
    ) -> Arc<ConfigConcurrencyController> {
        let mut controllers = self.controllers.lock().await;

        if let Some(controller) = controllers.get(config_id) {
            controller.clone()
        } else {
            let controller = Arc::new(ConfigConcurrencyController::new(concurrent_limit, rate_limit));
            controllers.insert(config_id.to_string(), controller.clone());
            controller
        }
    }

    /// 更新并发限制（动态更新，不影响正在进行的请求）
    pub async fn update_concurrent_limit(&self, config_id: &str, new_limit: i32) -> Result<(), String> {
        let controllers = self.controllers.lock().await;

        if let Some(controller) = controllers.get(config_id) {
            // 动态更新现有控制器的并发限制
            controller.update_concurrent_limit(new_limit).await;
            Ok(())
        } else {
            // 控制器不存在，可能还没有创建过
            // 这是正常情况，下次请求时会使用新的并发限制创建控制器
            Err("AI配置不存在，尚未创建过并发控制器".to_string())
        }
    }

    /// 更新速率限制（动态更新，不影响正在进行的请求）
    #[allow(dead_code)]
    pub async fn update_rate_limit(&self, config_id: &str, new_limit: i32) -> Result<(), String> {
        let controllers = self.controllers.lock().await;

        if let Some(controller) = controllers.get(config_id) {
            // 动态更新现有控制器的速率限制
            controller.update_rate_limit(new_limit).await;
            Ok(())
        } else {
            // 控制器不存在，可能还没有创建过
            // 这是正常情况，下次请求时会使用新的速率限制创建控制器
            Err("AI配置不存在，尚未创建过并发控制器".to_string())
        }
    }

    /// 注册中止标志（public供note_generation模块使用）
    pub async fn register_abort_flag(&self, request_id: String) -> Arc<AtomicBool> {
        let mut flags = self.abort_flags.lock().await;
        flags
            .entry(request_id)
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    }

    /// 注册中止句柄
    pub async fn register_abort_handle(&self, request_id: String, handle: AbortHandle) {
        let mut handles = self.abort_handles.lock().await;
        handles.insert(request_id, handle);
    }

    /// 取消请求
    pub async fn abort_request(&self, request_id: &str) -> Result<(), String> {
        // 设置中止标志
        let flags = self.abort_flags.lock().await;
        if let Some(flag) = flags.get(request_id) {
            flag.store(true, Ordering::Relaxed);
        }
        drop(flags);

        // 调用 AbortHandle 来真正中断任务
        let handles = self.abort_handles.lock().await;
        if let Some(handle) = handles.get(request_id) {
            handle.abort();
            Ok(())
        } else {
            Err("请求不存在".to_string())
        }
    }

    /// 清理中止标志（public供note_generation模块使用）
    pub async fn cleanup_abort_flag(&self, request_id: &str) {
        let mut flags = self.abort_flags.lock().await;
        flags.remove(request_id);

        // 同时清理中止句柄
        let mut handles = self.abort_handles.lock().await;
        handles.remove(request_id);
    }

    /// 获取状态（预留用于监控）
    #[allow(dead_code)]
    pub async fn get_status(&self, config_id: &str) -> Option<(usize, usize)> {
        let controllers = self.controllers.lock().await;
        controllers.get(config_id).map(|c| c.status())
    }

    /// 获取所有状态（预留用于监控）
    #[allow(dead_code)]
    pub async fn get_all_status(&self) -> HashMap<String, (usize, usize)> {
        let controllers = self.controllers.lock().await;
        controllers
            .iter()
            .map(|(id, c)| (id.clone(), c.status()))
            .collect()
    }
}

// ============================================================================
// 流式聊天实现
// ============================================================================

#[derive(Debug, Clone, Copy)]
pub enum ChatSystemPromptKind {
    Default,
    KnowledgeBaseQuickChat,
}

/// 流式聊天请求参数
pub struct StreamingChatRequest {
    pub app: AppHandle,
    pub event_name: String,
    pub request_id: String,
    pub config: AiConfig,
    pub messages: Vec<ChatMessage>,
    pub images: Option<Vec<ImageData>>,
    pub system_prompt_kind: ChatSystemPromptKind,
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
        .ensure_controller(&req.config.id, req.config.concurrent_limit, req.config.rate_limit)
        .await;

    // 保存app和event_name的克隆用于后续发送事件
    let app = req.app.clone();
    let event_name = req.event_name.clone();

    // 获取许可（支持中止）
    // permit 会被持有直到函数结束，确保信号量在整个请求期间被占用
    let _permit = match controller.acquire_with_abort(&abort_flag).await {
        Ok(p) => p,
        Err(error) => {
            pool.cleanup_abort_flag(&request_id).await;
            let _ = app.emit(&event_name, StreamEvent::Done {
                success: false,
                error: Some(error.clone()),
            });
            return Err(error);
        }
    };

    // 再次检查中止（在获取许可后）
    if abort_flag.load(Ordering::Relaxed) {
        // permit 会在 drop 时自动释放
        pool.cleanup_abort_flag(&request_id).await;
        let _ = app.emit(&event_name, StreamEvent::Done {
            success: false,
            error: Some("请求已取消".to_string()),
        });
        return Err("请求已取消".to_string());
    }

    // 执行实际的API调用
    // permit 在此作用域内被持有，确保信号量不会被释放
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
    // permit 在这里 drop，自动释放信号量
    pool.cleanup_abort_flag(&request_id).await;

    result
}

/// 判断错误是否可重试
fn is_retryable_error(error: &str) -> bool {
    // 网络错误、超时、服务端错误（5xx）、空响应可重试
    let normalized = error.to_ascii_lowercase();

    error.contains("请求失败")
        || error.contains("流错误")
        || error.contains("超时")
        || error.contains("连接")
        || error.contains("API错误 5")  // 5xx 错误
        || error.contains("API错误 429") // 限流错误
        || error.contains("响应内容为空") // 模型拒答/内容过滤等瞬时空响应
        || normalized.contains("timeout")
        || normalized.contains("timed out")
        || normalized.contains("connection")
        || normalized.contains("temporarily unavailable")
}

/// 计算重试延迟（指数退避）
fn calculate_retry_delay(attempt: u32) -> std::time::Duration {
    let base_delay = SettingsManager::get_int(keys::AI_RETRY_DELAY_MS, defaults::AI_RETRY_DELAY_MS);
    let delay_ms = base_delay * (1 << (attempt - 1));
    std::time::Duration::from_millis(delay_ms)
}

fn effective_max_attempts() -> u32 {
    let configured = SettingsManager::get_int(keys::AI_RETRY_MAX_COUNT, defaults::AI_RETRY_MAX_COUNT);
    cmp::min(cmp::max(configured, 1), 3)
}

#[derive(Debug, Clone)]
struct StreamingAttemptError {
    message: String,
    emitted_content: bool,
}

fn normalize_stream_delta(accumulated: &mut String, incoming: &str) -> String {
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

/// 实际的流式API调用实现（带重试）
async fn execute_streaming_chat_impl(
    pool: &AiPoolManager,
    req: StreamingChatRequest,
    rag_context: Option<String>,
    abort_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut last_error = String::new();
    let max_attempts = effective_max_attempts();
    let model_id = req.config.model.clone();
    let config_id = req.config.id.clone();

    for attempt in 1..=max_attempts {
        tracing::info!(
            config_id = %config_id,
            model_id = %model_id,
            attempt,
            max_attempts,
            "[AI池] 开始流式请求尝试"
        );
        // 检查中止
        if abort_flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }

        match execute_streaming_chat_single_attempt(pool, &req, &rag_context, &abort_flag).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error.message.clone();

                // 如果已经输出过内容，则不要重试，避免新一次请求重复输出前缀内容
                if error.emitted_content {
                    return Err(error.message);
                }

                // 如果是取消请求，不重试
                if error.message.contains("请求已取消") {
                    return Err(error.message);
                }

                let retryable = is_retryable_error(&error.message);
                tracing::warn!(
                    config_id = %config_id,
                    model_id = %model_id,
                    attempt,
                    max_attempts,
                    retryable,
                    error = %error.message,
                    emitted_content = error.emitted_content,
                    "[AI池] 流式请求尝试失败"
                );

                // 如果错误不可重试，直接返回
                if !retryable {
                    return Err(error.message);
                }

                // 如果还有重试机会，等待后重试
                if attempt < max_attempts {
                    let delay = calculate_retry_delay(attempt);
                    tracing::warn!(
                        config_id = %config_id,
                        model_id = %model_id,
                        attempt,
                        max_attempts,
                        delay_ms = delay.as_millis(),
                        "[AI池] 准备重试流式请求"
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    tracing::error!(
        config_id = %config_id,
        model_id = %model_id,
        max_attempts,
        error = %last_error,
        "[AI池] 流式请求已耗尽重试次数"
    );

    Err(format!(
        "请求失败，已重试 {} 次: {}",
        max_attempts, last_error
    ))
}

/// 单次流式API调用尝试
async fn execute_streaming_chat_single_attempt(
    pool: &AiPoolManager,
    req: &StreamingChatRequest,
    rag_context: &Option<String>,
    abort_flag: &Arc<AtomicBool>,
) -> Result<(), StreamingAttemptError> {
    let client = pool.get_or_create_http_client(&req.config.id, req.config.request_timeout).await;

    // 构建消息数组
    let mut api_messages: Vec<Value> = Vec::new();

    // 添加系统提示词（根据场景选择提示词构建路径）
    let system_prompt = match req.system_prompt_kind {
        ChatSystemPromptKind::Default => prompts::build_chat_system_prompt(rag_context.clone()),
        ChatSystemPromptKind::KnowledgeBaseQuickChat => {
            prompts::build_knowledge_base_chat_system_prompt(rag_context.clone())
        }
    };

    if let Some(system_prompt) = system_prompt {
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
    let body = build_chat_completions_body(
        &req.config.model,
        api_messages,
        &req.config.reasoning_effort,
        None,
    );

    // 发送请求
    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", req.config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| StreamingAttemptError {
            message: format!("请求失败: {}", e),
            emitted_content: false,
        })?;

    // 再次检查中止
    if abort_flag.load(Ordering::Relaxed) {
        return Err(StreamingAttemptError {
            message: "请求已取消".to_string(),
            emitted_content: false,
        });
    }

    if !response.status().is_success() {
        let status = response.status();
        let error_text = read_error_response_preview(response).await;
        return Err(StreamingAttemptError {
            message: format!("API错误 {}: {}", status, error_text),
            emitted_content: false,
        });
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
    let mut normalized_content = String::new();
    let mut emitted_content = false;

    let stream_idle_timeout = std::time::Duration::from_secs(
        SettingsManager::get_int(
            keys::AI_TIMEOUT_STREAM_IDLE,
            defaults::AI_TIMEOUT_STREAM_IDLE,
        )
        .max(1),
    );

    loop {
        let chunk_result = match tokio::time::timeout(stream_idle_timeout, stream.next()).await {
            Ok(Some(chunk_result)) => chunk_result,
            Ok(None) => break,
            Err(_) => {
                return Err(StreamingAttemptError {
                    message: format!(
                        "流式响应空闲超时（{}秒内未收到数据）",
                        stream_idle_timeout.as_secs()
                    ),
                    emitted_content,
                });
            }
        };
        // 检查中止
        if abort_flag.load(Ordering::Relaxed) {
            return Err(StreamingAttemptError {
                message: "请求已取消".to_string(),
                emitted_content,
            });
        }

        let chunk = chunk_result.map_err(|e| StreamingAttemptError {
            message: format!("流错误: {}", e),
            emitted_content,
        })?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);
        ensure_stream_buffer_limit(&buffer).map_err(|message| StreamingAttemptError {
            message,
            emitted_content,
        })?;

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
                        let delta = normalize_stream_delta(&mut normalized_content, content);
                        if !delta.is_empty() {
                            emitted_content = true;
                            let _ = req.app.emit(
                                &req.event_name,
                                StreamEvent::Delta {
                                    content: delta,
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
// 流式收集（无事件发射，适用于后台生成任务）
// ============================================================================

pub async fn execute_streaming_and_collect(
    config: AiConfig,
    prompt: String,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    execute_streaming_and_collect_with_max_tokens(config, prompt, abort_flag, None).await
}

pub async fn execute_streaming_and_collect_with_max_tokens(
    config: AiConfig,
    prompt: String,
    abort_flag: &Arc<AtomicBool>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let pool = get_ai_pool_manager();
    let controller = pool
        .ensure_controller(&config.id, config.concurrent_limit, config.rate_limit)
        .await;
    let _permit = controller.acquire_with_abort(abort_flag).await?;
    if abort_flag.load(Ordering::Relaxed) {
        return Err("请求已取消".to_string());
    }
    streaming_collect_with_retry(pool, &config, &prompt, abort_flag, max_tokens).await
}

async fn streaming_collect_with_retry(
    pool: &AiPoolManager,
    config: &AiConfig,
    prompt: &str,
    abort_flag: &Arc<AtomicBool>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let mut last_error = String::new();
    let max_attempts = effective_max_attempts();
    let config_id = config.id.clone();
    let model_id = config.model.clone();

    for attempt in 1..=max_attempts {
        if abort_flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }
        tracing::info!(
            config_id = %config_id, model_id = %model_id, attempt, max_attempts,
            "[AI池] 开始流式收集请求尝试"
        );
        match streaming_collect_single(pool, config, prompt, abort_flag, max_tokens).await {
            Ok(content) => return Ok(content),
            Err(e) => {
                last_error = e.clone();
                if e.contains("请求已取消") { return Err(e); }
                if !is_retryable_error(&e) { return Err(e); }
                tracing::warn!(
                    config_id = %config_id, model_id = %model_id, attempt, error = %e,
                    "[AI池] 流式收集请求尝试失败"
                );
                if attempt < max_attempts && !abort_flag.load(Ordering::Relaxed) {
                    tokio::time::sleep(calculate_retry_delay(attempt)).await;
                }
            }
        }
    }

    tracing::error!(
        config_id = %config_id, model_id = %model_id, error = %last_error,
        "[AI池] 流式收集请求已耗尽重试次数"
    );
    Err(format!("请求失败，已重试 {} 次: {}", max_attempts, last_error))
}

async fn streaming_collect_single(
    pool: &AiPoolManager,
    config: &AiConfig,
    prompt: &str,
    abort_flag: &Arc<AtomicBool>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let body = build_chat_completions_body(
        &config.model,
        vec![
            json!({ "role": "system", "content": "你是一个专业的视频内容分析师，擅长提取和总结信息。" }),
            json!({ "role": "user", "content": prompt })
        ],
        &config.reasoning_effort,
        max_tokens,
    );
    streaming_collect_with_body(pool, config, body, abort_flag).await
}

/// 参数兼容重试：400 且错误提示 max_tokens / reasoning_effort 不被支持时，
/// 去掉对应参数重试一次（部分 API 要求 max_completion_tokens 或不支持这些参数）
fn strip_unsupported_param(error: &str, body: &mut Value) -> bool {
    let normalized = error.to_ascii_lowercase();
    if !error.contains("API错误 400") && !normalized.contains("400") {
        return false;
    }
    if normalized.contains("max_tokens") || normalized.contains("max_completion_tokens") {
        if body.get("max_tokens").is_some() {
            body.as_object_mut().map(|o| o.remove("max_tokens"));
            return true;
        }
    }
    if normalized.contains("reasoning_effort") {
        if body.get("reasoning_effort").is_some() {
            body.as_object_mut().map(|o| o.remove("reasoning_effort"));
            return true;
        }
    }
    false
}

async fn streaming_collect_with_body(
    pool: &AiPoolManager,
    config: &AiConfig,
    mut body: Value,
    abort_flag: &Arc<AtomicBool>,
) -> Result<String, String> {
    let client = pool.get_or_create_http_client(&config.id, config.request_timeout).await;
    let api_url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));

    let response = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if abort_flag.load(Ordering::Relaxed) {
        return Err("请求已取消".to_string());
    }

    if !response.status().is_success() {
        let status = response.status();
        let error_text = read_error_response_preview(response).await;
        let error = format!("API错误 {}: {}", status, error_text);
        // 参数兼容处理：去掉不支持的参数后重试一次
        if status.as_u16() == 400 && strip_unsupported_param(&error, &mut body) {
            tracing::warn!("[AI池] 收到 400，去掉不支持的参数后重试: {}", error_text);
            return Box::pin(streaming_collect_with_body(pool, config, body, abort_flag)).await;
        }
        return Err(error);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut content = String::new();

    let stream_idle_timeout = std::time::Duration::from_secs(
        SettingsManager::get_int(
            keys::AI_TIMEOUT_STREAM_IDLE,
            defaults::AI_TIMEOUT_STREAM_IDLE,
        )
        .max(1),
    );

    loop {
        let chunk_result = match tokio::time::timeout(stream_idle_timeout, stream.next()).await {
            Ok(Some(chunk_result)) => chunk_result,
            Ok(None) => break,
            Err(_) => {
                return Err(format!(
                    "流式响应空闲超时（{}秒内未收到数据）",
                    stream_idle_timeout.as_secs()
                ));
            }
        };
        if abort_flag.load(Ordering::Relaxed) {
            return Err("请求已取消".to_string());
        }
        let chunk = chunk_result.map_err(|e| format!("流错误: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        ensure_stream_buffer_limit(&buffer)?;

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();
            if line.is_empty() || line == "data: [DONE]" { continue; }
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(json) = serde_json::from_str::<Value>(data) {
                    if let Some(delta) = json["choices"][0]["delta"]["content"].as_str() {
                        content.push_str(delta);
                    }
                }
            }
        }
    }

    if content.trim().is_empty() {
        return Err("响应内容为空".to_string());
    }
    Ok(content)
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retryable_error_recognizes_chinese_stream_idle_timeout() {
        assert!(is_retryable_error("流式响应空闲超时（90秒内未收到数据）"));
    }

    #[test]
    fn test_retryable_error_recognizes_common_network_failures_case_insensitively() {
        assert!(is_retryable_error("Connection reset by peer"));
        assert!(is_retryable_error("request TIMED OUT"));
        assert!(is_retryable_error("service temporarily unavailable"));
    }

    #[test]
    fn test_retryable_error_rejects_non_transient_api_error() {
        assert!(!is_retryable_error("API错误 400: invalid request"));
    }

    #[test]
    fn test_retryable_error_recognizes_empty_response() {
        assert!(is_retryable_error("响应内容为空"));
    }

    #[test]
    fn test_strip_unsupported_param_removes_max_tokens_on_400() {
        let mut body = serde_json::json!({
            "model": "test-model",
            "max_tokens": 768,
            "reasoning_effort": "high"
        });
        assert!(strip_unsupported_param(
            "API错误 400: max_tokens is not supported, use max_completion_tokens",
            &mut body
        ));
        assert!(body.get("max_tokens").is_none());
        assert_eq!(body["reasoning_effort"], "high");
    }

    #[test]
    fn test_strip_unsupported_param_removes_reasoning_effort_on_400() {
        let mut body = serde_json::json!({
            "model": "test-model",
            "reasoning_effort": "high"
        });
        assert!(strip_unsupported_param(
            "API错误 400: reasoning_effort is not supported by this model",
            &mut body
        ));
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn test_strip_unsupported_param_ignores_non_400_errors() {
        let mut body = serde_json::json!({ "model": "test-model", "max_tokens": 768 });
        assert!(!strip_unsupported_param("API错误 500: internal error", &mut body));
        assert_eq!(body["max_tokens"], 768);
    }

    #[test]
    fn test_chat_request_body_omits_reasoning_effort_when_off() {
        let body = build_chat_completions_body(
            "test-model",
            vec![json!({ "role": "user", "content": "hello" })],
            "off",
            None,
        );

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["stream"], true);
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn test_chat_request_body_serializes_enabled_reasoning_efforts() {
        for effort in ["low", "medium", "high", "xhigh", "max", "ultra"] {
            let body = build_chat_completions_body(
                "test-model",
                vec![json!({ "role": "user", "content": "hello" })],
                effort,
                None,
            );

            assert_eq!(body["reasoning_effort"], effort);
        }
    }

    #[test]
    fn test_chat_request_body_serializes_max_tokens_when_present() {
        let body = build_chat_completions_body(
            "test-model",
            vec![json!({ "role": "user", "content": "hello" })],
            "off",
            Some(768),
        );

        assert_eq!(body["max_tokens"], 768);
    }

    #[test]
    fn test_chat_request_body_omits_max_tokens_when_absent() {
        let body = build_chat_completions_body(
            "test-model",
            vec![json!({ "role": "user", "content": "hello" })],
            "off",
            None,
        );

        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn test_stream_buffer_limit_allows_small_buffer() {
        let buffer = "a".repeat(MAX_STREAM_BUFFER_BYTES);
        assert!(ensure_stream_buffer_limit(&buffer).is_ok());
    }

    #[test]
    fn test_stream_buffer_limit_rejects_large_buffer() {
        let buffer = "a".repeat(MAX_STREAM_BUFFER_BYTES + 1);
        let result = ensure_stream_buffer_limit(&buffer);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("缓冲区超过"));
    }

    #[test]
    fn test_token_bucket_creation() {
        // 测试正常速率限制
        let bucket = TokenBucket::new(60);
        assert_eq!(bucket.capacity, 90.0); // 60 * 1.5 = 90
        assert_eq!(bucket.refill_rate, 1.0); // 60 / 60 = 1

        // 测试无限制
        let bucket = TokenBucket::new(0);
        assert_eq!(bucket.capacity, f64::MAX);
        assert_eq!(bucket.refill_rate, 0.0);

        // 测试最小值
        let bucket = TokenBucket::new(-10);
        assert_eq!(bucket.capacity, f64::MAX);
        assert_eq!(bucket.refill_rate, 0.0);

        // 测试最大值限制
        let bucket = TokenBucket::new(2000);
        assert_eq!(bucket.capacity, 1500.0); // 1000 * 1.5 = 1500 (capped at 1000)
    }

    #[test]
    fn test_token_bucket_acquire() {
        let mut bucket = TokenBucket::new(60);

        // 初始容量是 90 (60 * 1.5)
        // 初始时应该有令牌
        assert!(bucket.try_acquire().is_ok());

        // 直接设置 tokens 为 0.5，模拟即使消耗状态，避免依赖循环运行时间
        // 注意：由于测试模块定义在 ai_pool.rs 内部，可以访问私有字段
        bucket.tokens = 0.5;

        // 令牌不足 (0.5 < 1.0)，应该返回失败
        let result = bucket.try_acquire();
        assert!(result.is_err(), "当 tokens < 1.0 时应该返回 Err");

        // 验证等待时间
        // 缺 0.5 个令牌，速率 1.0 个/秒，需要 0.5s = 500ms
        if let Err(wait_ms) = result {
            // 允许微小误差
            assert!(wait_ms >= 490 && wait_ms <= 510, "等待时间应约为500ms，实际: {}ms", wait_ms);
        }

        // 再次设置 tokens > 1
        bucket.tokens = 1.1;
        assert!(bucket.try_acquire().is_ok(), "当 tokens >= 1.0 时应该成功");

        // 消耗后剩余 0.1，再次获取应失败
        assert!(bucket.try_acquire().is_err(), "消耗后令牌不足应该失败");
    }

    #[test]
    fn test_token_bucket_no_limit() {
        let mut bucket = TokenBucket::new(0);
        
        // 无限制时，总是成功
        for _ in 0..1000 {
            assert!(bucket.try_acquire().is_ok());
        }
    }

    #[test]
    fn test_token_bucket_update_rate_limit() {
        let mut bucket = TokenBucket::new(60);
        
        // 更新速率限制
        bucket.update_rate_limit(120);
        assert_eq!(bucket.capacity, 180.0); // 120 * 1.5 = 180
        assert_eq!(bucket.refill_rate, 2.0); // 120 / 60 = 2
        
        // 更新为无限制
        bucket.update_rate_limit(0);
        assert_eq!(bucket.capacity, f64::MAX);
        assert_eq!(bucket.refill_rate, 0.0);
    }

    #[test]
    fn test_active_semaphore_permit_decrements_on_drop() {
        let semaphore = Arc::new(Semaphore::new(1));
        let permit = semaphore.clone().try_acquire_owned().expect("permit");
        let active_count = Arc::new(AtomicUsize::new(0));

        {
            let _tracked = ActiveSemaphorePermit::new(permit, active_count.clone());
            assert_eq!(active_count.load(Ordering::Relaxed), 1);
        }

        assert_eq!(active_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn test_config_concurrency_controller_creation() {
        let controller = ConfigConcurrencyController::new(5, 60);
        assert_eq!(controller.active_count.load(Ordering::Relaxed), 0);
        assert_eq!(controller.waiting_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn test_config_concurrency_controller_limits() {
        // 测试并发限制边界
        let _controller_min = ConfigConcurrencyController::new(0, 60);
        // 0 应该被限制为 1

        let _controller_max = ConfigConcurrencyController::new(100, 60);
        // 100 应该被限制为 10
    }

    #[tokio::test]
    async fn test_update_concurrent_limit_increase_adds_permits() {
        let controller = ConfigConcurrencyController::new(1, 60);
        let semaphore = {
            let guard = controller.semaphore.lock().await;
            guard.clone()
        };

        let permit = semaphore.clone().try_acquire_owned().expect("first permit");
        assert!(semaphore.clone().try_acquire_owned().is_err());

        controller.update_concurrent_limit(2).await;
        assert!(semaphore.clone().try_acquire_owned().is_ok());

        drop(permit);
    }

    #[tokio::test]
    async fn test_acquire_with_abort_returns_canceled_error() {
        let controller = ConfigConcurrencyController::new(1, 60);
        let abort_flag = Arc::new(AtomicBool::new(true));

        let result = controller.acquire_with_abort(&abort_flag).await;

        assert!(matches!(result, Err(ref error) if error == "请求已取消"));
    }

    #[test]
    fn test_ai_pool_manager_creation() {
        let _manager = AiPoolManager::new();
        // 验证管理器创建成功
        assert!(true);
    }

    #[tokio::test]
    async fn test_ensure_controller() {
        let manager = AiPoolManager::new();

        // 创建控制器
        let controller1 = manager.ensure_controller("1", 5, 60).await;

        // 再次获取同一个控制器
        let controller2 = manager.ensure_controller("1", 10, 120).await;
        
        // 应该是同一个控制器（使用第一次的配置）
        assert!(Arc::ptr_eq(&controller1, &controller2));
    }

    #[tokio::test]
    async fn test_abort_flag_registration() {
        let manager = AiPoolManager::new();
        
        // 注册中止标志
        let flag1 = manager.register_abort_flag("request-1".to_string()).await;
        let flag2 = manager.register_abort_flag("request-1".to_string()).await;
        
        // 应该是同一个标志
        assert!(Arc::ptr_eq(&flag1, &flag2));
        
        // 初始值应该是 false
        assert!(!flag1.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_abort_request() {
        let manager = AiPoolManager::new();
        
        // 注册中止标志
        let flag = manager.register_abort_flag("request-2".to_string()).await;
        assert!(!flag.load(Ordering::Relaxed));
        
        // 中止请求（没有句柄会失败，但标志会被设置）
        let _ = manager.abort_request("request-2").await;
        
        // 标志应该被设置为 true
        assert!(flag.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_cleanup_abort_flag() {
        let manager = AiPoolManager::new();
        
        // 注册中止标志
        let _flag = manager.register_abort_flag("request-3".to_string()).await;
        
        // 清理
        manager.cleanup_abort_flag("request-3").await;
        
        // 再次注册应该得到新的标志
        let new_flag = manager.register_abort_flag("request-3".to_string()).await;
        assert!(!new_flag.load(Ordering::Relaxed));
    }
}
