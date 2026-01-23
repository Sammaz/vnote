#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn main() {
    // 初始化日志系统
    init_logging();

    tracing::info!("VNote 启动");

    vnote_lib::run()
}

fn init_logging() {
    // 创建日志目录
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("logs");

    std::fs::create_dir_all(&log_dir).ok();

    // 创建文件日志 appender（按天轮转）
    let file_appender = tracing_appender::rolling::daily(log_dir, "vnote.log");
    let (non_blocking_file, _guard) = tracing_appender::non_blocking(file_appender);

    // 创建控制台日志 appender
    let (non_blocking_stdout, _guard2) = tracing_appender::non_blocking(std::io::stdout());

    // 配置日志级别
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            // 默认级别：info
            // 可以通过环境变量 RUST_LOG 覆盖，例如：RUST_LOG=debug
            tracing_subscriber::EnvFilter::new("info")
        });

    // 初始化订阅器
    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking_file)
                .with_ansi(false) // 文件日志不使用颜色
                .with_target(true)
                .with_thread_ids(true)
                .with_line_number(true)
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking_stdout)
                .with_ansi(true) // 控制台日志使用颜色
                .with_target(false)
        )
        .init();

    // 防止 _guard 和 _guard2 被提前释放
    // 将它们存储在静态变量中
    std::mem::forget(_guard);
    std::mem::forget(_guard2);
}
