# VNote 后端 API 文档

## 概述

VNote 后端通过 Tauri Commands 暴露 API，前端通过 `@tauri-apps/api` 调用。

## 笔记管理

### get_all_notes

获取所有笔记列表。

```typescript
invoke<Note[]>('get_all_notes')
```

**返回**: `Note[]`

### get_note_by_id

根据 ID 获取笔记详情。

```typescript
invoke<Note | null>('get_note_by_id', { id: string })
```

### create_note

创建新笔记。

```typescript
invoke<Note>('create_note', {
  title: string,
  videoPath: string,
  subtitlePath?: string,
  modelId?: string
})
```

### delete_note

删除笔记。

```typescript
invoke<void>('delete_note', { id: string })
```

## AI 配置管理

### get_all_ai_configs

获取所有 AI 配置。

```typescript
invoke<AiConfig[]>('get_all_ai_configs')
```

### create_ai_config

创建 AI 配置。

```typescript
invoke<string>('create_ai_config', {
  config: {
    title: string,
    base_url: string,
    api_key: string,
    model: string,
    concurrent_limit: number,  // 1-10
    request_timeout: number,   // 0-600
    rate_limit: number         // 0-1000
  }
})
```

### update_ai_config

更新 AI 配置。

```typescript
invoke<void>('update_ai_config', { config: AiConfig })
```

### delete_ai_config

删除 AI 配置。

```typescript
invoke<void>('delete_ai_config', { id: string })
```

## 笔记生成

### start_note_initialization

启动笔记初始化流程。

```typescript
invoke<string>('start_note_initialization', {
  params: {
    note_id: string,
    model_id: string,
    video_path: string,
    subtitle_path?: string,
    start_from_step?: number  // 断点恢复
  }
})
```

**返回**: `initialization_id` 用于跟踪进度

**事件**: `note-initialization-{id}` 推送进度

### abort_note_initialization

中止初始化流程。

```typescript
invoke<void>('abort_note_initialization', {
  initializationId: string
})
```

## 聊天功能

### send_chat_message

发送聊天消息（流式响应）。

```typescript
invoke<void>('send_chat_message', {
  noteId: string,
  modelId: string,
  messages: ChatMessage[],
  images?: ImageData[]
})
```

**事件**: `chat-stream-{noteId}` 推送流式响应

## 合集管理

### get_all_collections

获取所有合集。

```typescript
invoke<Collection[]>('get_all_collections')
```

### create_collection

创建合集。

```typescript
invoke<Collection>('create_collection', {
  name: string,
  description?: string,
  parentId?: string
})
```

### add_note_to_collection

添加笔记到合集。

```typescript
invoke<void>('add_note_to_collection', {
  collectionId: string,
  noteId: string
})
```

## 事件类型

### NoteInitializationEvent

笔记初始化进度事件。

```typescript
type NoteInitializationEvent =
  | { type: 'Starting', initialization_id: string, total_steps: number }
  | { type: 'StepStarting', step: string, step_index: number }
  | { type: 'StepCompleted', step: string, step_index: number }
  | { type: 'StepFailed', step: string, error: string }
  | { type: 'Completed', completed: number, failed: number }
  | { type: 'Aborted' }
```

### StreamEvent

聊天流式响应事件。

```typescript
type StreamEvent =
  | { type: 'Start', message_id: string }
  | { type: 'Delta', content: string }
  | { type: 'Done', success: boolean, error?: string }
```
