//! 初始化任务队列管理模块
//!
//! 管理笔记的 AI 初始化任务队列，确保同一时间只有一个笔记在执行初始化任务。
//! 使用线程安全的全局单例模式。

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

// ============================================================================
// 数据结构定义
// ============================================================================

/// 任务提交结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum SubmitResult {
    /// 立即执行（队列为空，直接开始）
    Running,
    /// 排队等待中
    Queued {
        /// 队列位置（从1开始）
        position: usize,
    },
}

/// 队列状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStatus {
    /// 当前正在执行的笔记ID
    pub current_task_note_id: Option<i64>,
    /// 等待队列中的笔记ID列表
    pub waiting_note_ids: Vec<i64>,
}

/// 队列更新事件
#[derive(Debug, Clone, Serialize)]
pub struct QueueUpdatedEvent {
    pub current_task_note_id: Option<i64>,
    pub waiting_note_ids: Vec<i64>,
}

/// 任务就绪事件（通知某个笔记可以开始执行了）
#[derive(Debug, Clone, Serialize)]
pub struct TaskReadyEvent {
    pub note_id: i64,
}

// ============================================================================
// 全局任务队列管理器
// ============================================================================

/// 初始化任务队列管理器
struct InitTaskQueueManager {
    /// 当前正在执行的笔记ID
    current_task: RwLock<Option<i64>>,
    /// 等待队列
    waiting_queue: RwLock<VecDeque<i64>>,
}

impl InitTaskQueueManager {
    fn new() -> Self {
        Self {
            current_task: RwLock::new(None),
            waiting_queue: RwLock::new(VecDeque::new()),
        }
    }

    /// 提交任务到队列
    async fn submit_task(&self, note_id: i64) -> SubmitResult {
        let mut current = self.current_task.write().await;
        let mut queue = self.waiting_queue.write().await;

        // 检查是否已经在队列中或正在执行
        if *current == Some(note_id) {
            return SubmitResult::Running;
        }
        if queue.contains(&note_id) {
            let position = queue.iter().position(|&id| id == note_id).unwrap() + 1;
            return SubmitResult::Queued { position };
        }

        if current.is_none() {
            // 队列为空，直接执行
            *current = Some(note_id);
            SubmitResult::Running
        } else {
            // 加入等待队列
            queue.push_back(note_id);
            let position = queue.len();
            SubmitResult::Queued { position }
        }
    }

    /// 任务完成，处理下一个
    async fn task_completed(&self, note_id: i64) -> Option<i64> {
        let mut current = self.current_task.write().await;
        let mut queue = self.waiting_queue.write().await;

        // 验证是否是当前任务
        if *current != Some(note_id) {
            eprintln!(
                "[InitTaskQueue] 警告: task_completed 调用的 note_id({}) 不是当前任务({:?})",
                note_id, *current
            );
            return None;
        }

        // 清除当前任务
        *current = None;

        // 取出下一个任务
        if let Some(next_note_id) = queue.pop_front() {
            *current = Some(next_note_id);
            eprintln!(
                "[InitTaskQueue] 任务 {} 完成，开始处理下一个任务: {}",
                note_id, next_note_id
            );
            Some(next_note_id)
        } else {
            eprintln!("[InitTaskQueue] 任务 {} 完成，队列已空", note_id);
            None
        }
    }

    /// 获取队列状态
    async fn get_status(&self) -> QueueStatus {
        let current = self.current_task.read().await;
        let queue = self.waiting_queue.read().await;

        QueueStatus {
            current_task_note_id: *current,
            waiting_note_ids: queue.iter().cloned().collect(),
        }
    }

    /// 获取笔记在队列中的位置
    /// 返回 None 表示不在队列中
    /// 返回 Some(0) 表示正在执行
    /// 返回 Some(n) 表示在等待队列的第 n 位（从1开始）
    async fn get_note_position(&self, note_id: i64) -> Option<usize> {
        let current = self.current_task.read().await;
        let queue = self.waiting_queue.read().await;

        if *current == Some(note_id) {
            return Some(0); // 正在执行
        }

        queue
            .iter()
            .position(|&id| id == note_id)
            .map(|pos| pos + 1)
    }

    /// 从队列中移除笔记（用于笔记被删除的情况）
    async fn remove_note(&self, note_id: i64) -> bool {
        let current = self.current_task.read().await;
        let mut queue = self.waiting_queue.write().await;

        // 不能移除正在执行的任务
        if *current == Some(note_id) {
            return false;
        }

        // 从等待队列中移除
        if let Some(pos) = queue.iter().position(|&id| id == note_id) {
            queue.remove(pos);
            eprintln!("[InitTaskQueue] 从队列中移除笔记: {}", note_id);
            true
        } else {
            false
        }
    }
}

/// 全局队列管理器实例
static INIT_TASK_QUEUE: OnceLock<InitTaskQueueManager> = OnceLock::new();

/// 获取队列管理器实例
fn get_queue_manager() -> &'static InitTaskQueueManager {
    INIT_TASK_QUEUE.get_or_init(InitTaskQueueManager::new)
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 提交初始化任务到队列
#[tauri::command]
pub async fn submit_init_task(app: AppHandle, note_id: i64) -> Result<SubmitResult, String> {
    let manager = get_queue_manager();
    let result = manager.submit_task(note_id).await;

    eprintln!(
        "[InitTaskQueue] 提交任务: note_id={}, result={:?}",
        note_id, result
    );

    // 发送队列更新事件
    let status = manager.get_status().await;
    let _ = app.emit(
        "init-queue-updated",
        QueueUpdatedEvent {
            current_task_note_id: status.current_task_note_id,
            waiting_note_ids: status.waiting_note_ids,
        },
    );

    Ok(result)
}

/// 标记任务完成（公开函数，供其他模块调用）
pub async fn complete_init_task(app: AppHandle, note_id: i64) -> Result<(), String> {
    let manager = get_queue_manager();
    let next_note_id = manager.task_completed(note_id).await;

    // 发送队列更新事件
    let status = manager.get_status().await;
    let _ = app.emit(
        "init-queue-updated",
        QueueUpdatedEvent {
            current_task_note_id: status.current_task_note_id,
            waiting_note_ids: status.waiting_note_ids,
        },
    );

    // 如果有下一个任务，发送就绪事件
    if let Some(next_id) = next_note_id {
        let _ = app.emit("init-task-ready", TaskReadyEvent { note_id: next_id });
    }

    Ok(())
}

/// Tauri 命令包装器
#[tauri::command]
pub async fn complete_init_task_command(app: AppHandle, note_id: i64) -> Result<(), String> {
    complete_init_task(app, note_id).await
}

/// 获取队列状态
#[tauri::command]
pub async fn get_init_queue_status() -> Result<QueueStatus, String> {
    let manager = get_queue_manager();
    Ok(manager.get_status().await)
}

/// 获取笔记在队列中的位置
#[tauri::command]
pub async fn get_note_queue_position(note_id: i64) -> Result<Option<usize>, String> {
    let manager = get_queue_manager();
    Ok(manager.get_note_position(note_id).await)
}

/// 从队列中移除笔记
#[tauri::command]
pub async fn remove_note_from_queue(app: AppHandle, note_id: i64) -> Result<bool, String> {
    let manager = get_queue_manager();
    let removed = manager.remove_note(note_id).await;

    if removed {
        // 发送队列更新事件
        let status = manager.get_status().await;
        let _ = app.emit(
            "init-queue-updated",
            QueueUpdatedEvent {
                current_task_note_id: status.current_task_note_id,
                waiting_note_ids: status.waiting_note_ids,
            },
        );
    }

    Ok(removed)
}
