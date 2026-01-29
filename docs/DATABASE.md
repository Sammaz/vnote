# VNote 数据库设计文档

## 概述

VNote 使用 SQLite 数据库存储应用数据，通过 r2d2 连接池管理数据库连接。

- **数据库文件**: `{app_data_dir}/vnote.db`
- **连接池大小**: 10
- **日志模式**: WAL (Write-Ahead Logging)

## 表结构

### 1. notes - 笔记表

存储用户创建的视频笔记及其生成的内容。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| title | TEXT | 笔记标题 |
| video_path | TEXT | 视频文件路径 |
| subtitle_path | TEXT | 字幕文件路径（可选） |
| model_id | TEXT | 使用的 AI 模型 ID |
| init_status | INTEGER | 初始化状态 (0-7) |
| full_summary | TEXT | 全文总结 |
| detailed_reading | TEXT | 原文细读（章节 JSON） |
| highlights | TEXT | 高光笔记 JSON |
| visual_summary | TEXT | 可视化总结 |
| custom_summary | TEXT | 自定义总结 |
| flashcards | TEXT | 闪记卡 JSON |
| panoramic_blueprint | TEXT | 全景蓝图 Markdown |
| quick_notes | TEXT | 快速笔记 Markdown |
| quick_notes_mindmap | TEXT | 思维导图 JSON |
| quick_notes_canvas | TEXT | 画布数据 JSON |
| suggested_questions | TEXT | 推荐问题 JSON |
| last_playback_position | REAL | 最后播放位置（秒） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

**init_status 状态值**:
- 0: 未开始
- 1: 字幕生成完成
- 2: 推荐问题完成
- 3: 全文总结完成
- 4: 章节生成完成
- 5: 字幕优化完成
- 6: 高光笔记完成
- 7: 闪记卡完成（全部完成）

### 2. ai_configs - AI 配置表

存储用户配置的 AI 模型信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| title | TEXT | 配置名称 |
| base_url | TEXT | API 基础 URL |
| api_key | TEXT | API 密钥（或占位符） |
| model | TEXT | 模型名称 |
| sort_order | INTEGER | 排序顺序 |
| is_default | INTEGER | 是否默认 (0/1) |
| concurrent_limit | INTEGER | 并发限制 (1-10) |
| request_timeout | INTEGER | 请求超时（秒，0-600） |
| rate_limit | INTEGER | 速率限制（次/分钟） |

> **安全说明**: API 密钥优先存储在系统密钥环中，数据库仅存储占位符 `***MIGRATED***`

### 3. collections - 合集表

存储用户创建的笔记合集（资源库）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| name | TEXT | 合集名称 |
| description | TEXT | 描述（可选） |
| parent_id | TEXT | 父合集 ID（支持嵌套） |
| sort_order | INTEGER | 排序顺序 |
| cover_image | TEXT | 封面图片路径 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 4. collection_items - 合集内容关联表

关联合集与笔记的多对多关系。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| collection_id | TEXT | 合集 ID（外键） |
| note_id | TEXT | 笔记 ID（外键） |
| sort_order | INTEGER | 排序顺序 |
| created_at | TEXT | 创建时间 |

**约束**: `UNIQUE(collection_id, note_id)`

### 5. subtitle_chunks - 字幕分块表

存储用于 RAG 检索的字幕分块及其向量嵌入。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| note_id | TEXT | 笔记 ID（外键） |
| chunk_index | INTEGER | 分块索引 |
| start_time | REAL | 开始时间（秒） |
| end_time | REAL | 结束时间（秒） |
| content | TEXT | 分块内容 |
| embedding | BLOB | 向量嵌入（二进制） |
| created_at | TEXT | 创建时间 |

**约束**: `UNIQUE(note_id, chunk_index)`

### 6. optimized_subtitles - 优化字幕缓存表

缓存 AI 优化后的字幕内容。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| note_id | TEXT | 笔记 ID（外键） |
| chapter_id | TEXT | 章节 ID |
| optimized_text | TEXT | 优化后的文本 |
| created_at | TEXT | 创建时间 |

**约束**: `UNIQUE(note_id, chapter_id)`

### 7. embedding_configs - Embedding 配置表

存储向量嵌入模型配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| title | TEXT | 配置名称 |
| base_url | TEXT | API 基础 URL |
| api_key | TEXT | API 密钥 |
| model | TEXT | 模型名称 |
| sort_order | INTEGER | 排序顺序 |
| is_default | INTEGER | 是否默认 (0/1) |

### 8. reranker_configs - Reranker 配置表

存储重排序模型配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| title | TEXT | 配置名称 |
| base_url | TEXT | API 基础 URL |
| api_key | TEXT | API 密钥 |
| model | TEXT | 模型名称 |
| sort_order | INTEGER | 排序顺序 |
| is_default | INTEGER | 是否默认 (0/1) |

### 9. prompt_configs - 提示词配置表

存储用户自定义的提示词模板。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键，Snowflake ID |
| title | TEXT | 提示词标题 |
| description | TEXT | 描述（可选） |
| content | TEXT | 提示词内容 |
| category | TEXT | 分类 |
| recommended_model_id | TEXT | 推荐模型 ID |
| sort_order | INTEGER | 排序顺序 |
| is_default | INTEGER | 是否默认 (0/1) |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 10. app_settings - 应用设置表

存储应用级别的键值配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT | 主键，设置键名 |
| value | TEXT | 设置值 |

**预置设置**:
- `theme`: 主题 (dark/light)
- `tray_enabled`: 是否启用托盘

## 索引

| 索引名 | 表 | 字段 |
|--------|-----|------|
| idx_subtitle_chunks_note | subtitle_chunks | note_id |
| idx_optimized_subtitles_note | optimized_subtitles | note_id |
| idx_screenshot_markers_note_id | screenshot_markers | note_id |
| idx_collection_items_collection | collection_items | collection_id |
| idx_collection_items_note | collection_items | note_id |
| idx_subtitle_index_status_status | subtitle_index_status | status |

## 外键关系

```
notes
  ├── subtitle_chunks (note_id → notes.id, CASCADE)
  ├── optimized_subtitles (note_id → notes.id, CASCADE)
  ├── collection_items (note_id → notes.id, CASCADE)
  └── screenshot_markers (note_id → notes.id, CASCADE)

collections
  ├── collections (parent_id → collections.id, CASCADE)
  └── collection_items (collection_id → collections.id, CASCADE)

ai_configs
  └── prompt_configs (recommended_model_id → ai_configs.id, SET NULL)
```
