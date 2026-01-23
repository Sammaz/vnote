//! 输入验证模块
//!
//! 提供统一的输入验证功能，防止异常数据导致程序出错或安全问题

/// 验证常量配置
pub mod limits {
    /// 聊天消息最大长度（字符）
    pub const MAX_MESSAGE_LENGTH: usize = 10000;

    /// 笔记标题最大长度（字符）
    pub const MAX_TITLE_LENGTH: usize = 200;

    /// 合集名称最大长度（字符）
    pub const MAX_COLLECTION_NAME_LENGTH: usize = 100;

    /// 描述最大长度（字符）
    pub const MAX_DESCRIPTION_LENGTH: usize = 1000;

    /// 自定义提示词最大长度（字符）
    pub const MAX_PROMPT_LENGTH: usize = 50000;

    /// AI配置标题最大长度（字符）
    pub const MAX_CONFIG_TITLE_LENGTH: usize = 100;

    /// URL最大长度（字符）
    pub const MAX_URL_LENGTH: usize = 500;

    /// API密钥最大长度（字符）
    pub const MAX_API_KEY_LENGTH: usize = 500;

    /// 模型名称最大长度（字符）
    pub const MAX_MODEL_NAME_LENGTH: usize = 200;
}

/// 验证聊天消息内容
///
/// # 规则
/// - 不能为空
/// - 长度不能超过 MAX_MESSAGE_LENGTH
///
/// # 示例
/// ```
/// use vnote_lib::validation::validate_message;
///
/// assert!(validate_message("Hello").is_ok());
/// assert!(validate_message("").is_err());
/// ```
pub fn validate_message(content: &str) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("消息不能为空".to_string());
    }

    if content.len() > limits::MAX_MESSAGE_LENGTH {
        return Err(format!(
            "消息长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_MESSAGE_LENGTH,
            content.len()
        ));
    }

    Ok(())
}

/// 验证笔记标题
///
/// # 规则
/// - 不能为空或只有空格
/// - 长度不能超过 MAX_TITLE_LENGTH
///
/// # 示例
/// ```
/// use vnote_lib::validation::validate_title;
///
/// assert!(validate_title("我的笔记").is_ok());
/// assert!(validate_title("   ").is_err());
/// ```
pub fn validate_title(title: &str) -> Result<(), String> {
    let trimmed = title.trim();

    if trimmed.is_empty() {
        return Err("标题不能为空".to_string());
    }

    if title.len() > limits::MAX_TITLE_LENGTH {
        return Err(format!(
            "标题长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_TITLE_LENGTH,
            title.len()
        ));
    }

    Ok(())
}

/// 验证合集名称
///
/// # 规则
/// - 不能为空或只有空格
/// - 长度不能超过 MAX_COLLECTION_NAME_LENGTH
pub fn validate_collection_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("合集名称不能为空".to_string());
    }

    if name.len() > limits::MAX_COLLECTION_NAME_LENGTH {
        return Err(format!(
            "合集名称长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_COLLECTION_NAME_LENGTH,
            name.len()
        ));
    }

    Ok(())
}

/// 验证描述文本（可选字段）
///
/// # 规则
/// - 可以为空
/// - 长度不能超过 MAX_DESCRIPTION_LENGTH
pub fn validate_description(description: &str) -> Result<(), String> {
    if description.len() > limits::MAX_DESCRIPTION_LENGTH {
        return Err(format!(
            "描述长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_DESCRIPTION_LENGTH,
            description.len()
        ));
    }

    Ok(())
}

/// 验证自定义提示词
///
/// # 规则
/// - 不能为空
/// - 长度不能超过 MAX_PROMPT_LENGTH
pub fn validate_prompt(prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty() {
        return Err("提示词不能为空".to_string());
    }

    if prompt.len() > limits::MAX_PROMPT_LENGTH {
        return Err(format!(
            "提示词长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_PROMPT_LENGTH,
            prompt.len()
        ));
    }

    Ok(())
}

/// 验证AI配置标题
///
/// # 规则
/// - 不能为空
/// - 长度不能超过 MAX_CONFIG_TITLE_LENGTH
pub fn validate_config_title(title: &str) -> Result<(), String> {
    let trimmed = title.trim();

    if trimmed.is_empty() {
        return Err("配置标题不能为空".to_string());
    }

    if title.len() > limits::MAX_CONFIG_TITLE_LENGTH {
        return Err(format!(
            "配置标题长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_CONFIG_TITLE_LENGTH,
            title.len()
        ));
    }

    Ok(())
}

/// 验证URL
///
/// # 规则
/// - 不能为空
/// - 必须以 http:// 或 https:// 开头
/// - 长度不能超过 MAX_URL_LENGTH
pub fn validate_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();

    if trimmed.is_empty() {
        return Err("URL不能为空".to_string());
    }

    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("URL必须以 http:// 或 https:// 开头".to_string());
    }

    if url.len() > limits::MAX_URL_LENGTH {
        return Err(format!(
            "URL长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_URL_LENGTH,
            url.len()
        ));
    }

    Ok(())
}

/// 验证API密钥
///
/// # 规则
/// - 不能为空
/// - 长度不能超过 MAX_API_KEY_LENGTH
pub fn validate_api_key(api_key: &str) -> Result<(), String> {
    let trimmed = api_key.trim();

    if trimmed.is_empty() {
        return Err("API密钥不能为空".to_string());
    }

    if api_key.len() > limits::MAX_API_KEY_LENGTH {
        return Err(format!(
            "API密钥长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_API_KEY_LENGTH,
            api_key.len()
        ));
    }

    Ok(())
}

/// 验证模型名称
///
/// # 规则
/// - 不能为空
/// - 长度不能超过 MAX_MODEL_NAME_LENGTH
pub fn validate_model_name(model: &str) -> Result<(), String> {
    let trimmed = model.trim();

    if trimmed.is_empty() {
        return Err("模型名称不能为空".to_string());
    }

    if model.len() > limits::MAX_MODEL_NAME_LENGTH {
        return Err(format!(
            "模型名称长度不能超过 {} 字符（当前 {} 字符）",
            limits::MAX_MODEL_NAME_LENGTH,
            model.len()
        ));
    }

    Ok(())
}

/// 验证并发限制数值
///
/// # 规则
/// - 必须在 1-10 之间
pub fn validate_concurrent_limit(limit: i32) -> Result<(), String> {
    if limit < 1 || limit > 10 {
        return Err("并发限制必须在 1-10 之间".to_string());
    }

    Ok(())
}

/// 验证请求超时时间
///
/// # 规则
/// - 必须在 0-600 之间（0表示不设置超时，最大10分钟）
pub fn validate_request_timeout(timeout: i32) -> Result<(), String> {
    if timeout < 0 || timeout > 600 {
        return Err("请求超时时间必须在 0-600 秒之间".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_message() {
        // 正常消息
        assert!(validate_message("Hello").is_ok());
        assert!(validate_message("你好世界").is_ok());

        // 空消息
        assert!(validate_message("").is_err());
        assert!(validate_message("   ").is_err());

        // 超长消息
        let long_message = "a".repeat(limits::MAX_MESSAGE_LENGTH + 1);
        assert!(validate_message(&long_message).is_err());

        // 边界值
        let boundary_message = "a".repeat(limits::MAX_MESSAGE_LENGTH);
        assert!(validate_message(&boundary_message).is_ok());
    }

    #[test]
    fn test_validate_title() {
        // 正常标题
        assert!(validate_title("我的笔记").is_ok());

        // 空标题
        assert!(validate_title("").is_err());
        assert!(validate_title("   ").is_err());

        // 超长标题
        let long_title = "标".repeat(limits::MAX_TITLE_LENGTH + 1);
        assert!(validate_title(&long_title).is_err());
    }

    #[test]
    fn test_validate_collection_name() {
        // 正常名称
        assert!(validate_collection_name("我的合集").is_ok());

        // 空名称
        assert!(validate_collection_name("").is_err());

        // 超长名称
        let long_name = "a".repeat(limits::MAX_COLLECTION_NAME_LENGTH + 1);
        assert!(validate_collection_name(&long_name).is_err());
    }

    #[test]
    fn test_validate_description() {
        // 正常描述
        assert!(validate_description("这是一个描述").is_ok());

        // 空描述（允许）
        assert!(validate_description("").is_ok());

        // 超长描述
        let long_desc = "a".repeat(limits::MAX_DESCRIPTION_LENGTH + 1);
        assert!(validate_description(&long_desc).is_err());
    }

    #[test]
    fn test_validate_url() {
        // 正常URL
        assert!(validate_url("https://api.openai.com").is_ok());
        assert!(validate_url("http://localhost:8080").is_ok());

        // 无效URL
        assert!(validate_url("").is_err());
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("not-a-url").is_err());
    }

    #[test]
    fn test_validate_api_key() {
        // 正常密钥
        assert!(validate_api_key("sk-1234567890").is_ok());

        // 空密钥
        assert!(validate_api_key("").is_err());
        assert!(validate_api_key("   ").is_err());
    }

    #[test]
    fn test_validate_concurrent_limit() {
        // 正常值
        assert!(validate_concurrent_limit(1).is_ok());
        assert!(validate_concurrent_limit(5).is_ok());
        assert!(validate_concurrent_limit(10).is_ok());

        // 无效值
        assert!(validate_concurrent_limit(0).is_err());
        assert!(validate_concurrent_limit(11).is_err());
        assert!(validate_concurrent_limit(-1).is_err());
    }

    #[test]
    fn test_validate_request_timeout() {
        // 正常值
        assert!(validate_request_timeout(0).is_ok());
        assert!(validate_request_timeout(180).is_ok());
        assert!(validate_request_timeout(600).is_ok());

        // 无效值
        assert!(validate_request_timeout(-1).is_err());
        assert!(validate_request_timeout(601).is_err());
    }
}
