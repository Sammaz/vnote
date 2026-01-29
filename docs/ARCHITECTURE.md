# VNote 架构设计文档

## 系统概述

VNote 是一个基于 Tauri 2 的桌面应用，采用前后端分离架构。

```
┌─────────────────────────────────────────────────────────┐
│                    VNote Desktop App                     │
├─────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript)                          │
│  ├── UI Components (Tailwind CSS)                       │
│  ├── State Management (React Context)                   │
│  └── Tauri IPC Bridge                                   │
├─────────────────────────────────────────────────────────┤
│  Backend (Rust + Tauri 2)                               │
│  ├── Tauri Commands                                     │
│  ├── AI Pool Manager                                    │
│  ├── Database (SQLite + r2d2)                          │
│  └── External Services (AI APIs)                        │
└─────────────────────────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 19 |
| 类型系统 | TypeScript | 5.x |
| 构建工具 | Vite | 7 |
| 样式 | Tailwind CSS | 4 |
| 桌面框架 | Tauri | 2 |
| 后端语言 | Rust | 1.75+ |
| 数据库 | SQLite | 3.x |
| 连接池 | r2d2 | - |

## 后端模块结构

```
src-tauri/src/
├── main.rs                 # 应用入口
├── lib.rs                  # Tauri 命令导出
├── db.rs                   # 数据库操作
├── error.rs                # 统一错误处理
├── validation.rs           # 输入验证
├── snowflake.rs            # ID 生成器
├── keyring_manager.rs      # 密钥管理
├── settings.rs             # 设置管理
├── prompts.rs              # 提示词模板
│
├── ai_pool.rs              # AI 连接池管理
├── chat.rs                 # 聊天功能
├── rag.rs                  # RAG 检索增强
│
├── note_initialization.rs  # 笔记初始化流程
├── note_generation.rs      # 笔记内容生成
├── chapter.rs              # 章节处理
├── highlight_generation.rs # 高光生成
├── flashcard_generation.rs # 闪卡生成
├── blueprint_generation.rs # 蓝图生成
│
├── subtitle.rs             # 字幕解析
├── subtitle_optimizer.rs   # 字幕优化
└── bcut_asr.rs             # 必剪 ASR 集成
```

## 前端模块结构

```
src/
├── main.tsx                # 应用入口
├── App.tsx                 # 主组件
├── index.css               # 全局样式
├── SettingsPage.tsx        # 设置页面
│
├── context/                # 状态管理
│   ├── AppContext.tsx      # 统一 API 入口
│   ├── SidebarContext.tsx  # 侧边栏状态
│   ├── SettingsContext.tsx # 设置状态
│   ├── UploadContext.tsx   # 上传状态
│   ├── NotesContext.tsx    # 笔记状态
│   └── CollectionsContext.tsx # 合集状态
│
├── components/             # UI 组件
│   ├── HomePage.tsx        # 首页
│   ├── Sidebar/            # 侧边栏
│   ├── Upload/             # 上传组件
│   ├── Note/               # 笔记相关
│   ├── Collection/         # 合集相关
│   └── ui/                 # 基础 UI
│
├── types/                  # 类型定义
│   └── index.ts
│
└── utils/                  # 工具函数
    ├── cn.ts               # 类名合并
    └── message.tsx         # 消息提示
```

## 核心流程

### 1. 笔记初始化流程

```
用户上传视频 → 创建笔记记录 → 启动初始化
                                    │
    ┌───────────────────────────────┘
    ▼
┌─────────────────────────────────────────┐
│ Step 0: 字幕生成 (可选，无字幕时触发)    │
├─────────────────────────────────────────┤
│ Step 1: 推荐问题生成                     │
├─────────────────────────────────────────┤
│ Step 2: 全文总结                         │
├─────────────────────────────────────────┤
│ Step 3: 章节生成                         │
├─────────────────────────────────────────┤
│ Step 4: 字幕优化                         │
├─────────────────────────────────────────┤
│ Step 5: 高光笔记                         │
├─────────────────────────────────────────┤
│ Step 6: 闪记卡                           │
└─────────────────────────────────────────┘
                    │
                    ▼
              初始化完成
```

### 2. AI 连接池架构

```
┌─────────────────────────────────────────────────┐
│              AiPoolManager (全局单例)            │
├─────────────────────────────────────────────────┤
│  http_clients: HashMap<config_id, Client>       │
│  controllers: HashMap<config_id, Controller>    │
│  abort_flags: HashMap<request_id, AtomicBool>   │
└─────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Controller 1 │ │ Controller 2 │ │ Controller N │
│ (Config A)   │ │ (Config B)   │ │ (Config N)   │
├──────────────┤ ├──────────────┤ ├──────────────┤
│ Semaphore    │ │ Semaphore    │ │ Semaphore    │
│ TokenBucket  │ │ TokenBucket  │ │ TokenBucket  │
└──────────────┘ └──────────────┘ └──────────────┘
```

**特性**:
- 每个 AI 配置独立的并发控制
- 令牌桶速率限制
- 支持动态更新限制
- 请求中止机制

### 3. 前端状态管理

```
┌─────────────────────────────────────────┐
│           AppContext (统一 API)          │
│  useApp() - 向后兼容的统一 Hook          │
└─────────────────────────────────────────┘
                    │
    ┌───────┬───────┼───────┬───────┐
    ▼       ▼       ▼       ▼       ▼
┌───────┐┌───────┐┌───────┐┌───────┐┌───────┐
│Sidebar││Settings││Upload││Notes ││Collec-│
│Context││Context ││Context││Context││tions  │
└───────┘└───────┘└───────┘└───────┘└───────┘
```

**设计原则**:
- 分层 Context 避免过度重渲染
- 各 Context 可独立使用
- 统一 API 保持向后兼容

## 安全设计

### API 密钥存储

```
┌─────────────┐    优先     ┌─────────────┐
│  用户输入   │ ─────────▶ │ 系统密钥环   │
│  API Key    │            │ (Keyring)   │
└─────────────┘            └─────────────┘
                                 │
                           不可用时降级
                                 ▼
                          ┌─────────────┐
                          │  SQLite DB  │
                          │ (明文存储)  │
                          └─────────────┘
```

### 输入验证

所有用户输入在 `validation.rs` 中统一验证：
- 消息长度限制 (10,000 字符)
- URL 格式校验
- 数值范围检查
