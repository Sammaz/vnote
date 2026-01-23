//! 统一错误处理模块
//!
//! 提供全局统一的错误类型，用于替代分散的 String 错误返回

use std::fmt;

/// VNote 统一错误类型
#[derive(Debug)]
pub enum VNoteError {
    /// 数据库错误
    Database(String),
    /// AI API 错误
    AiApi(String),
    /// 验证错误
    Validation(String),
    /// 文件操作错误
    FileSystem(String),
    /// 网络错误
    Network(String),
    /// 配置错误
    Config(String),
    /// 序列化/反序列化错误
    Serialization(String),
    /// 资源未找到
    NotFound(String),
    /// 操作被取消
    Cancelled(String),
    /// 超时错误
    Timeout(String),
    /// 速率限制错误
    RateLimited(String),
    /// 其他错误
    Other(String),
}

impl fmt::Display for VNoteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VNoteError::Database(msg) => write!(f, "数据库错误: {}", msg),
            VNoteError::AiApi(msg) => write!(f, "AI API错误: {}", msg),
            VNoteError::Validation(msg) => write!(f, "验证错误: {}", msg),
            VNoteError::FileSystem(msg) => write!(f, "文件系统错误: {}", msg),
            VNoteError::Network(msg) => write!(f, "网络错误: {}", msg),
            VNoteError::Config(msg) => write!(f, "配置错误: {}", msg),
            VNoteError::Serialization(msg) => write!(f, "序列化错误: {}", msg),
            VNoteError::NotFound(msg) => write!(f, "资源未找到: {}", msg),
            VNoteError::Cancelled(msg) => write!(f, "操作已取消: {}", msg),
            VNoteError::Timeout(msg) => write!(f, "操作超时: {}", msg),
            VNoteError::RateLimited(msg) => write!(f, "速率限制: {}", msg),
            VNoteError::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl std::error::Error for VNoteError {}

/// 统一的 Result 类型
pub type Result<T> = std::result::Result<T, VNoteError>;

// ============================================================================
// 从其他错误类型转换
// ============================================================================

impl From<rusqlite::Error> for VNoteError {
    fn from(err: rusqlite::Error) -> Self {
        VNoteError::Database(err.to_string())
    }
}

impl From<std::io::Error> for VNoteError {
    fn from(err: std::io::Error) -> Self {
        VNoteError::FileSystem(err.to_string())
    }
}

impl From<reqwest::Error> for VNoteError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            VNoteError::Timeout(err.to_string())
        } else if err.is_connect() {
            VNoteError::Network(format!("连接失败: {}", err))
        } else {
            VNoteError::Network(err.to_string())
        }
    }
}

impl From<serde_json::Error> for VNoteError {
    fn from(err: serde_json::Error) -> Self {
        VNoteError::Serialization(err.to_string())
    }
}

impl From<String> for VNoteError {
    fn from(err: String) -> Self {
        VNoteError::Other(err)
    }
}

impl From<&str> for VNoteError {
    fn from(err: &str) -> Self {
        VNoteError::Other(err.to_string())
    }
}

// ============================================================================
// 转换为 String（用于 Tauri 命令返回）
// ============================================================================

impl From<VNoteError> for String {
    fn from(err: VNoteError) -> Self {
        err.to_string()
    }
}

// ============================================================================
// 辅助宏
// ============================================================================

/// 快速创建验证错误
#[macro_export]
macro_rules! validation_error {
    ($($arg:tt)*) => {
        $crate::error::VNoteError::Validation(format!($($arg)*))
    };
}

/// 快速创建数据库错误
#[macro_export]
macro_rules! db_error {
    ($($arg:tt)*) => {
        $crate::error::VNoteError::Database(format!($($arg)*))
    };
}

/// 快速创建AI API错误
#[macro_export]
macro_rules! ai_error {
    ($($arg:tt)*) => {
        $crate::error::VNoteError::AiApi(format!($($arg)*))
    };
}

/// 快速创建未找到错误
#[macro_export]
macro_rules! not_found_error {
    ($($arg:tt)*) => {
        $crate::error::VNoteError::NotFound(format!($($arg)*))
    };
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = VNoteError::Database("连接失败".to_string());
        assert_eq!(err.to_string(), "数据库错误: 连接失败");

        let err = VNoteError::Validation("标题不能为空".to_string());
        assert_eq!(err.to_string(), "验证错误: 标题不能为空");

        let err = VNoteError::AiApi("API密钥无效".to_string());
        assert_eq!(err.to_string(), "AI API错误: API密钥无效");
    }

    #[test]
    fn test_error_from_string() {
        let err: VNoteError = "测试错误".into();
        assert!(matches!(err, VNoteError::Other(_)));
        assert_eq!(err.to_string(), "测试错误");
    }

    #[test]
    fn test_error_to_string() {
        let err = VNoteError::NotFound("笔记不存在".to_string());
        let s: String = err.into();
        assert_eq!(s, "资源未找到: 笔记不存在");
    }

    #[test]
    fn test_error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<VNoteError>();
    }

    #[test]
    fn test_all_error_variants() {
        let variants = vec![
            VNoteError::Database("db".to_string()),
            VNoteError::AiApi("ai".to_string()),
            VNoteError::Validation("val".to_string()),
            VNoteError::FileSystem("fs".to_string()),
            VNoteError::Network("net".to_string()),
            VNoteError::Config("cfg".to_string()),
            VNoteError::Serialization("ser".to_string()),
            VNoteError::NotFound("nf".to_string()),
            VNoteError::Cancelled("cancel".to_string()),
            VNoteError::Timeout("timeout".to_string()),
            VNoteError::RateLimited("rate".to_string()),
            VNoteError::Other("other".to_string()),
        ];

        for err in variants {
            // 确保所有变体都能正确转换为字符串
            let _ = err.to_string();
        }
    }
}
