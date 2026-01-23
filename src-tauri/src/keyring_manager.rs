//! 密钥链管理模块
//!
//! 使用系统密钥链安全存储API密钥，替代明文存储
//!
//! 支持的平台：
//! - Windows: Windows Credential Manager
//! - macOS: Keychain
//! - Linux: Secret Service API (libsecret)

use keyring::Entry;

/// 服务名称前缀
const SERVICE_PREFIX: &str = "com.leica.vnote";

/// 密钥类型
#[derive(Debug, Clone, Copy)]
pub enum KeyType {
    AiConfig,
    EmbeddingConfig,
    RerankerConfig,
}

impl KeyType {
    fn service_name(&self) -> &'static str {
        match self {
            KeyType::AiConfig => "ai_config",
            KeyType::EmbeddingConfig => "embedding_config",
            KeyType::RerankerConfig => "reranker_config",
        }
    }
}

/// 存储API密钥到系统密钥链
///
/// # 参数
/// - `key_type`: 密钥类型
/// - `config_id`: 配置ID
/// - `api_key`: API密钥
///
/// # 返回
/// - `Ok(())`: 存储成功
/// - `Err(String)`: 存储失败，返回错误信息
pub fn store_api_key(key_type: KeyType, config_id: i64, api_key: &str) -> Result<(), String> {
    let service = format!("{}.{}", SERVICE_PREFIX, key_type.service_name());
    let username = config_id.to_string();

    let entry = Entry::new(&service, &username)
        .map_err(|e| format!("创建密钥链条目失败: {}", e))?;

    entry
        .set_password(api_key)
        .map_err(|e| format!("存储密钥失败: {}", e))?;

    Ok(())
}

/// 从系统密钥链获取API密钥
///
/// # 参数
/// - `key_type`: 密钥类型
/// - `config_id`: 配置ID
///
/// # 返回
/// - `Ok(String)`: 获取成功，返回API密钥
/// - `Err(String)`: 获取失败，返回错误信息
pub fn get_api_key(key_type: KeyType, config_id: i64) -> Result<String, String> {
    let service = format!("{}.{}", SERVICE_PREFIX, key_type.service_name());
    let username = config_id.to_string();

    let entry = Entry::new(&service, &username)
        .map_err(|e| format!("创建密钥链条目失败: {}", e))?;

    entry
        .get_password()
        .map_err(|e| format!("获取密钥失败: {}", e))
}

/// 从系统密钥链删除API密钥
///
/// # 参数
/// - `key_type`: 密钥类型
/// - `config_id`: 配置ID
///
/// # 返回
/// - `Ok(())`: 删除成功
/// - `Err(String)`: 删除失败，返回错误信息
pub fn delete_api_key(key_type: KeyType, config_id: i64) -> Result<(), String> {
    let service = format!("{}.{}", SERVICE_PREFIX, key_type.service_name());
    let username = config_id.to_string();

    let entry = Entry::new(&service, &username)
        .map_err(|e| format!("创建密钥链条目失败: {}", e))?;

    entry
        .delete_password()
        .map_err(|e| format!("删除密钥失败: {}", e))
}

/// 检查系统是否支持密钥链
///
/// # 返回
/// - `true`: 支持密钥链
/// - `false`: 不支持密钥链
pub fn is_keyring_available() -> bool {
    // 尝试创建一个测试条目
    let test_service = format!("{}.test", SERVICE_PREFIX);
    let test_username = "test";

    match Entry::new(&test_service, test_username) {
        Ok(entry) => {
            // 尝试设置和删除一个测试密码
            if entry.set_password("test").is_ok() {
                let _ = entry.delete_password();
                true
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyring_availability() {
        // 测试系统是否支持密钥链
        let available = is_keyring_available();
        tracing::debug!("Keyring available: {}", available);
    }

    #[test]
    fn test_store_and_get_api_key() {
        if !is_keyring_available() {
            tracing::debug!("Keyring not available, skipping test");
            return;
        }

        let test_config_id = 999999;
        let test_api_key = "sk-test-1234567890";

        // 存储密钥
        let store_result = store_api_key(KeyType::AiConfig, test_config_id, test_api_key);
        assert!(store_result.is_ok(), "Failed to store API key");

        // 获取密钥
        let get_result = get_api_key(KeyType::AiConfig, test_config_id);
        assert!(get_result.is_ok(), "Failed to get API key");
        assert_eq!(get_result.unwrap(), test_api_key);

        // 删除密钥
        let delete_result = delete_api_key(KeyType::AiConfig, test_config_id);
        assert!(delete_result.is_ok(), "Failed to delete API key");

        // 验证已删除
        let get_after_delete = get_api_key(KeyType::AiConfig, test_config_id);
        assert!(get_after_delete.is_err(), "API key should be deleted");
    }

    #[test]
    fn test_different_key_types() {
        if !is_keyring_available() {
            tracing::debug!("Keyring not available, skipping test");
            return;
        }

        let test_config_id = 999998;
        let ai_key = "sk-ai-key";
        let embedding_key = "sk-embedding-key";
        let reranker_key = "sk-reranker-key";

        // 存储不同类型的密钥
        assert!(store_api_key(KeyType::AiConfig, test_config_id, ai_key).is_ok());
        assert!(store_api_key(KeyType::EmbeddingConfig, test_config_id, embedding_key).is_ok());
        assert!(store_api_key(KeyType::RerankerConfig, test_config_id, reranker_key).is_ok());

        // 验证可以正确获取
        assert_eq!(get_api_key(KeyType::AiConfig, test_config_id).unwrap(), ai_key);
        assert_eq!(get_api_key(KeyType::EmbeddingConfig, test_config_id).unwrap(), embedding_key);
        assert_eq!(get_api_key(KeyType::RerankerConfig, test_config_id).unwrap(), reranker_key);

        // 清理
        let _ = delete_api_key(KeyType::AiConfig, test_config_id);
        let _ = delete_api_key(KeyType::EmbeddingConfig, test_config_id);
        let _ = delete_api_key(KeyType::RerankerConfig, test_config_id);
    }
}
