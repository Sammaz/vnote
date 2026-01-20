# VNote 初始化任务可配置化 - 架构设计文档

## 1. 系统架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (React/TypeScript)                    │
├─────────────────────────────────────────────────────────────────┤
│  SettingsPage.tsx          │  NoteContentPanel.tsx              │
│  ├─ InitTaskConfigPanel    │  ├─ useInitTaskExecutor (Hook)     │
│  │   ├─ 拖拽排序           │  │   ├─ 任务编排器                  │
│  │   └─ 开关控制           │  │   ├─ 状态同步                    │
│  └─ 实时保存              │  │   └─ 进度回调                    │
│                           │  └─ 启动恢复检查                    │
├─────────────────────────────────────────────────────────────────┤
│                     InitTaskContext (状态管理)                    │
│  ├─ taskConfigs: 任务配置列表                                     │
│  ├─ pendingTasks: 待执行任务                                      │
│  └─ executeTask / pauseTask / resumeTask                        │
├─────────────────────────────────────────────────────────────────┤
│                        Tauri IPC 层                              │
└─────────────────────────────────────────────────────────────────┘
                              ↕ invoke / listen
┌─────────────────────────────────────────────────────────────────┐
│                        后端 (Rust/Tauri)                         │
├─────────────────────────────────────────────────────────────────┤
│  init_task_config.rs       │  init_task_executor.rs             │
│  ├─ get_init_task_config   │  ├─ execute_next_task              │
│  ├─ save_init_task_config  │  ├─ update_task_status             │
│  └─ get_default_config     │  └─ check_pending_on_startup       │
├─────────────────────────────────────────────────────────────────┤
│                          db.rs (SQLite)                          │
│  ├─ init_task_configs 表   │  ├─ note_init_progress 表          │
│  └─ note_init_tasks 表     │                                    │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 数据库设计

### 2.1 新增表结构

#### 2.1.1 `init_task_configs` - 初始化任务配置表

```sql
CREATE TABLE IF NOT EXISTS init_task_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL UNIQUE,      -- 任务类型标识
    task_name TEXT NOT NULL,             -- 任务显示名称
    enabled INTEGER NOT NULL DEFAULT 1,  -- 是否启用 (0/1)
    sort_order INTEGER NOT NULL,         -- 排序顺序
    is_required INTEGER NOT NULL DEFAULT 0, -- 是否必须 (推荐问题=1)
    depends_on TEXT,                     -- 依赖的任务类型 (JSON数组)
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 默认数据
INSERT INTO init_task_configs (task_type, task_name, enabled, sort_order, is_required, depends_on) VALUES
('full_summary', '全文总结', 1, 1, 0, NULL),
('detailed_reading', '原文细读', 1, 2, 0, '["full_summary"]'),
('subtitle_optimization', '字幕优化', 0, 3, 0, '["detailed_reading"]'),
('highlights', '高光笔记', 1, 4, 0, '["detailed_reading"]'),
('suggested_questions', '推荐问题', 1, 5, 1, '["full_summary"]'),
('flashcards', '闪记卡', 1, 6, 0, NULL);
```

#### 2.1.2 `note_init_progress` - 笔记初始化进度表

```sql
CREATE TABLE IF NOT EXISTS note_init_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL UNIQUE,
    config_snapshot TEXT NOT NULL,       -- 任务配置快照 (JSON)
    current_task_index INTEGER NOT NULL DEFAULT 0,
    overall_status TEXT NOT NULL DEFAULT 'pending', -- pending/running/completed/failed/paused
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

#### 2.1.3 `note_init_tasks` - 笔记初始化任务状态表

```sql
CREATE TABLE IF NOT EXISTS note_init_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending/running/completed/failed/skipped
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    progress_current INTEGER DEFAULT 0,
    progress_total INTEGER DEFAULT 0,
    generation_id TEXT,                  -- 用于中止任务
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(note_id, task_type),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

## 3. 后端模块设计

### 3.1 新增文件: `src-tauri/src/init_task_config.rs`

```rust
//! 初始化任务配置管理模块

use serde::{Deserialize, Serialize};

/// 初始化任务配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitTaskConfig {
    pub id: i64,
    pub task_type: String,
    pub task_name: String,
    pub enabled: bool,
    pub sort_order: i32,
    pub is_required: bool,
    pub depends_on: Option<Vec<String>>,
}

/// 获取所有任务配置（按 sort_order 排序）
#[tauri::command]
pub async fn get_init_task_configs() -> Result<Vec<InitTaskConfig>, String>;

/// 保存任务配置（批量更新）
#[tauri::command]
pub async fn save_init_task_configs(configs: Vec<InitTaskConfig>) -> Result<(), String>;

/// 获取启用的任务列表（按执行顺序）
#[tauri::command]
pub async fn get_enabled_init_tasks() -> Result<Vec<InitTaskConfig>, String>;
```

### 3.2 新增文件: `src-tauri/src/init_task_executor.rs`

```rust
//! 初始化任务执行器模块

use serde::{Deserialize, Serialize};

/// 笔记初始化进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteInitProgress {
    pub note_id: i64,
    pub config_snapshot: String,
    pub current_task_index: i32,
    pub overall_status: String,
}

/// 单个任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteInitTask {
    pub note_id: i64,
    pub task_type: String,
    pub status: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub progress_current: i32,
    pub progress_total: i32,
    pub generation_id: Option<String>,
}

/// 初始化笔记的任务进度记录
#[tauri::command]
pub async fn init_note_tasks(note_id: i64) -> Result<(), String>;

/// 更新任务状态
#[tauri::command]
pub async fn update_init_task_status(
    note_id: i64,
    task_type: String,
    status: String,
    error_message: Option<String>,
    generation_id: Option<String>,
) -> Result<(), String>;

/// 获取笔记的任务进度
#[tauri::command]
pub async fn get_note_init_progress(note_id: i64) -> Result<Option<NoteInitProgress>, String>;

/// 获取笔记的所有任务状态
#[tauri::command]
pub async fn get_note_init_tasks(note_id: i64) -> Result<Vec<NoteInitTask>, String>;

/// 检查启动时是否有待执行的任务
#[tauri::command]
pub async fn check_pending_init_tasks() -> Result<Vec<NoteInitProgress>, String>;

/// 标记笔记初始化完成
#[tauri::command]
pub async fn complete_note_init(note_id: i64) -> Result<(), String>;
```

## 4. 前端模块设计

### 4.1 新增 Context: `src/context/InitTaskConfigContext.tsx`

```typescript
interface InitTaskConfig {
  id: number;
  task_type: string;
  task_name: string;
  enabled: boolean;
  sort_order: number;
  is_required: boolean;
  depends_on: string[] | null;
}

interface InitTaskConfigContextType {
  configs: InitTaskConfig[];
  loading: boolean;
  refreshConfigs: () => Promise<void>;
  updateConfig: (taskType: string, updates: Partial<InitTaskConfig>) => Promise<void>;
  reorderConfigs: (newOrder: string[]) => Promise<void>;
  getEnabledTasksInOrder: () => InitTaskConfig[];
}
```

### 4.2 新增 Hook: `src/hooks/useInitTaskExecutor.ts`

```typescript
interface UseInitTaskExecutorOptions {
  noteId: number;
  modelId: number;
  onTaskStart?: (taskType: string) => void;
  onTaskComplete?: (taskType: string) => void;
  onTaskError?: (taskType: string, error: string) => void;
  onAllComplete?: () => void;
}

interface UseInitTaskExecutorReturn {
  isExecuting: boolean;
  currentTask: string | null;
  completedTasks: string[];
  failedTasks: Map<string, string>;
  progress: { current: number; total: number };
  startExecution: () => Promise<void>;
  pauseExecution: () => void;
  resumeExecution: () => Promise<void>;
  skipCurrentTask: () => void;
}

export function useInitTaskExecutor(options: UseInitTaskExecutorOptions): UseInitTaskExecutorReturn;
```

### 4.3 新增组件: `src/components/Settings/InitTaskConfigPanel.tsx`

```typescript
interface InitTaskConfigPanelProps {
  // 无需 props，从 Context 获取数据
}

export function InitTaskConfigPanel(): JSX.Element {
  // 实现拖拽排序 + 开关控制
  // 使用 @dnd-kit/core 或 react-beautiful-dnd
}
```

## 5. 任务执行流程

### 5.1 新建笔记时的执行流程

```
用户创建笔记
    ↓
前端调用 init_note_tasks(note_id)
    ↓
后端创建任务进度记录 (config_snapshot 保存当前配置)
    ↓
前端 useInitTaskExecutor 开始执行
    ↓
┌─────────────────────────────────┐
│  循环执行每个启用的任务          │
│  1. 检查依赖是否满足             │
│  2. 更新状态为 running          │
│  3. 调用对应的生成函数           │
│  4. 监听事件，更新进度           │
│  5. 完成后更新状态为 completed   │
│  6. 失败时更新状态为 failed      │
│  7. 继续下一个任务               │
└─────────────────────────────────┘
    ↓
所有任务完成，调用 complete_note_init(note_id)
```

### 5.2 应用启动时的恢复流程

```
应用启动 / 窗口显示
    ↓
前端调用 check_pending_init_tasks()
    ↓
后端返回 overall_status='running' 的笔记列表
    ↓
对于每个未完成的笔记:
    ↓
前端自动导航到该笔记 (或显示恢复提示)
    ↓
useInitTaskExecutor 读取 config_snapshot
    ↓
从 current_task_index 继续执行
    ↓
跳过已完成的任务 (status='completed')
```

## 6. 任务类型与执行函数映射

```typescript
const TASK_EXECUTORS: Record<string, (context: TaskContext) => Promise<void>> = {
  full_summary: async (ctx) => {
    // 调用 handleGenerate 逻辑
  },
  detailed_reading: async (ctx) => {
    // 调用 ChapterGrid.generateChapters 逻辑
  },
  subtitle_optimization: async (ctx) => {
    // 调用 triggerVisualSummaryOptimizationSilent 逻辑
  },
  highlights: async (ctx) => {
    // 调用 generateHighlightsDirectly 逻辑
  },
  suggested_questions: async (ctx) => {
    // 调用 generate_questions_for_note 命令
  },
  flashcards: async (ctx) => {
    // 调用 generateFlashcardsDirectly 逻辑
  },
};
```

## 7. 事件通信

### 7.1 新增事件

| 事件名称 | 方向 | 说明 |
|---------|------|------|
| `init-task-started` | 后端→前端 | 任务开始执行 |
| `init-task-progress` | 后端→前端 | 任务进度更新 |
| `init-task-completed` | 后端→前端 | 任务完成 |
| `init-task-failed` | 后端→前端 | 任务失败 |
| `init-all-completed` | 后端→前端 | 所有任务完成 |

### 7.2 事件数据结构

```typescript
interface InitTaskEvent {
  note_id: number;
  task_type: string;
  status: 'started' | 'progress' | 'completed' | 'failed';
  progress?: { current: number; total: number; message: string };
  error?: string;
}
```

## 8. 文件变更清单

### 8.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src-tauri/src/init_task_config.rs` | 任务配置管理 |
| `src-tauri/src/init_task_executor.rs` | 任务执行器 |
| `src/context/InitTaskConfigContext.tsx` | 任务配置状态管理 |
| `src/hooks/useInitTaskExecutor.ts` | 任务执行 Hook |
| `src/components/Settings/InitTaskConfigPanel.tsx` | 配置面板组件 |

### 8.2 修改文件

| 文件路径 | 变更说明 |
|---------|---------|
| `src-tauri/src/db.rs` | 新增3个数据表 |
| `src-tauri/src/lib.rs` | 注册新命令 |
| `src/SettingsPage.tsx` | 新增"初始化任务"标签页 |
| `src/context/AppContext.tsx` | 集成 InitTaskConfigContext |
| `src/components/Note/NoteContentPanel.tsx` | 使用 useInitTaskExecutor 重构 |
| `src/App.tsx` | 添加启动恢复检查 |

## 9. 依赖项

### 9.1 前端新增依赖

```json
{
  "@dnd-kit/core": "^6.1.0",
  "@dnd-kit/sortable": "^8.0.0",
  "@dnd-kit/utilities": "^3.2.2"
}
```

## 10. 迁移策略

### 10.1 数据库迁移

1. 应用启动时检查表是否存在
2. 不存在则创建表并插入默认数据
3. 现有笔记不受影响（仅新建笔记使用新流程）

### 10.2 渐进式重构

1. 第一阶段：实现配置存储和 UI
2. 第二阶段：重构任务执行逻辑
3. 第三阶段：实现启动恢复功能
