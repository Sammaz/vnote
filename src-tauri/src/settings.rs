use crate::DATABASE;
use crate::error::Result;
use std::str::FromStr;

pub struct SettingsManager;

impl SettingsManager {
    /// 获取字符串配置
    pub fn get_string(key: &str, default: &str) -> String {
        Self::get_value_internal(key).unwrap_or_else(|| default.to_string())
    }

    /// 获取整数配置
    pub fn get_int<T: FromStr + Copy>(key: &str, default: T) -> T {
        Self::get_parsed_value(key).unwrap_or(default)
    }

    /// 获取浮点数配置
    pub fn get_float<T: FromStr + Copy>(key: &str, default: T) -> T {
        Self::get_parsed_value(key).unwrap_or(default)
    }

    /// 获取布尔配置
    pub fn get_bool(key: &str, default: bool) -> bool {
        Self::get_parsed_value(key).unwrap_or(default)
    }

    /// 设置配置值
    pub fn set_value<T: ToString>(key: &str, value: T) -> Result<()> {
        let db = DATABASE.get().ok_or("Database not initialized")?;
        db.set_app_setting(key, &value.to_string())?;
        Ok(())
    }

    fn get_value_internal(key: &str) -> Option<String> {
        let db = DATABASE.get()?;
        db.get_app_setting(key).ok()?
    }

    fn get_parsed_value<T: FromStr>(key: &str) -> Option<T> {
        let val = Self::get_value_internal(key)?;
        val.parse().ok()
    }
}

// 定义常量 Key
pub mod keys {
    // AI Pool Settings
    pub const AI_POOL_MAX_IDLE: &str = "ai_pool.max_idle_per_host";
    pub const AI_POOL_IDLE_TIMEOUT: &str = "ai_pool.idle_timeout_secs";
    pub const AI_RETRY_MAX_COUNT: &str = "ai_pool.max_retry_count";
    pub const AI_RETRY_DELAY_MS: &str = "ai_pool.retry_delay_ms";
    pub const AI_TIMEOUT_CONNECT: &str = "ai_pool.timeout.connect";
    pub const AI_TIMEOUT_ACQUIRE: &str = "ai_pool.timeout.acquire";
    pub const AI_TIMEOUT_STREAM_IDLE: &str = "ai_pool.timeout.stream_idle";

    // RAG Settings
    pub const RAG_CHUNK_SIZE: &str = "rag.chunk.size";
    pub const RAG_CHUNK_OVERLAP: &str = "rag.chunk.overlap";
    pub const RAG_TOP_K: &str = "rag.search.top_k";
    pub const RAG_RERANK_K: &str = "rag.search.rerank_k";
    pub const RAG_SIMILARITY_THRESHOLD: &str = "rag.search.similarity_threshold";
    pub const RAG_BATCH_SIZE: &str = "rag.embedding.batch_size";
    pub const RAG_TIMEOUT_CLIENT: &str = "rag.timeout.client";
    pub const RAG_TIMEOUT_INDEXING: &str = "rag.timeout.indexing";

    // Processing Settings
    pub const PROCESS_SEGMENT_SIZE: &str = "processing.segment_size";
    pub const PROCESS_TRUNCATION_LIMIT: &str = "processing.truncation_limit";
    pub const PROCESS_DEFAULT_CONCURRENT: &str = "processing.default_concurrent";
}

// 默认值常量
pub mod defaults {
    // AI Pool
    pub const AI_POOL_MAX_IDLE: usize = 20;
    pub const AI_POOL_IDLE_TIMEOUT: u64 = 90;
    pub const AI_RETRY_MAX_COUNT: u32 = 3;
    pub const AI_RETRY_DELAY_MS: u64 = 1000;
    pub const AI_TIMEOUT_CONNECT: u64 = 30;
    pub const AI_TIMEOUT_ACQUIRE: u64 = 300;
    pub const AI_TIMEOUT_STREAM_IDLE: u64 = 90;

    // RAG
    pub const RAG_CHUNK_SIZE: usize = 800;
    pub const RAG_CHUNK_OVERLAP: usize = 160;
    pub const RAG_TOP_K: usize = 30;
    pub const RAG_RERANK_K: usize = 8;
    pub const RAG_SIMILARITY_THRESHOLD: f32 = 0.25;
    pub const RAG_BATCH_SIZE: usize = 50;
    pub const RAG_TIMEOUT_CLIENT: u64 = 120;
    pub const RAG_TIMEOUT_INDEXING: u64 = 600;

    // Processing
    pub const PROCESS_SEGMENT_SIZE: usize = 10000;
    pub const PROCESS_TRUNCATION_LIMIT: usize = 3000;
    pub const PROCESS_DEFAULT_CONCURRENT: usize = 2;
}

