use std::future::Future;
use std::time::Duration;

/// Retry an async operation with exponential backoff.
/// max_attempts: total number of attempts (including the first)
/// initial_delay_ms: delay before the second attempt; doubles each retry
pub async fn with_retry<F, Fut, T, E>(max_attempts: u32, initial_delay_ms: u64, f: F) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut delay = initial_delay_ms;
    for attempt in 1..=max_attempts {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) if attempt == max_attempts => return Err(e),
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                delay *= 2;
            }
        }
    }
    unreachable!()
}
