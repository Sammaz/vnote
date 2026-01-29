# VNote 前端组件文档

## 概述

VNote 前端使用 React 19 + TypeScript 构建，采用组件化架构。

## 页面组件

### HomePage

首页组件，包含上传区域、模型选择、最近笔记。

**路径**: `src/components/HomePage.tsx`

**功能**:
- 视频/字幕文件上传
- AI 模型选择
- 最近笔记列表
- 统计信息展示

### NotePage

笔记详情页，展示视频和生成的笔记内容。

**路径**: `src/components/Note/NotePage.tsx`

**功能**:
- 视频播放器
- 多标签页内容展示
- 聊天窗口
- 字幕同步

### SettingsPage

设置页面，管理 AI 配置和应用设置。

**路径**: `src/SettingsPage.tsx`

**功能**:
- AI 模型配置管理
- Embedding/Reranker 配置
- 提示词模板管理
- 主题切换

## 核心组件

### VideoPlayer

视频播放器组件。

**路径**: `src/components/Note/VideoPlayer.tsx`

**Props**:
```typescript
{
  videoPath: string;
  subtitlePath?: string;
  onTimeUpdate?: (time: number) => void;
}
```

### ChatWindow

聊天窗口组件，支持 RAG 问答。

**路径**: `src/components/Note/ChatWindow.tsx`

**功能**:
- 消息列表展示
- 流式响应显示
- 推荐问题
- 图片上传

### Sidebar

侧边栏组件。

**路径**: `src/components/Sidebar/`

**子组件**:
- `SidebarHeader` - 标题和折叠按钮
- `SidebarNav` - 导航菜单
- `CollectionTree` - 合集树形结构

## 上传组件

### UploadZone

文件上传区域组件，支持拖拽上传。

**路径**: `src/components/Upload/UploadZone.tsx`

**功能**:
- 视频文件拖拽上传
- 字幕文件拖拽上传
- 文件类型验证
- 上传进度显示

### ModelSelector

AI 模型选择器组件。

**路径**: `src/components/Upload/ModelSelector.tsx`

**功能**:
- 显示可用 AI 模型列表
- 模型切换
- 默认模型标记

### GenerateButton

笔记生成按钮组件。

**路径**: `src/components/Upload/GenerateButton.tsx`

**功能**:
- 触发笔记生成流程
- 显示生成状态
- 禁用状态处理

## 统计组件

### StatsSection

统计信息区域组件。

**路径**: `src/components/Stats/StatsSection.tsx`

**功能**:
- 展示多个统计卡片
- 响应式布局

### StatCard

单个统计卡片组件。

**路径**: `src/components/Stats/StatCard.tsx`

**Props**:
```typescript
{
  title: string;
  value: number | string;
  icon?: ReactNode;
}
```

## 笔记列表组件

### RecentNotes

最近笔记列表组件。

**路径**: `src/components/Notes/RecentNotes.tsx`

**功能**:
- 展示最近创建/访问的笔记
- 笔记卡片网格布局

### RecentNotesPage

最近笔记页面组件。

**路径**: `src/components/Notes/RecentNotesPage.tsx`

**功能**:
- 完整的最近笔记列表页
- 分页加载

### NoteCard

笔记卡片组件。

**路径**: `src/components/Notes/NoteCard.tsx`

**功能**:
- 笔记缩略图
- 标题和创建时间
- 点击跳转详情

### VirtualizedNoteGrid

虚拟化笔记网格组件。

**路径**: `src/components/Notes/VirtualizedNoteGrid.tsx`

**功能**:
- 大量笔记的虚拟滚动
- 性能优化

### SearchPage

搜索页面组件。

**路径**: `src/components/Notes/SearchPage.tsx`

**功能**:
- 全局笔记搜索
- 搜索结果展示

## 合集组件

### CollectionPage

合集详情页组件。

**路径**: `src/components/Collection/CollectionPage.tsx`

**功能**:
- 展示合集内的笔记
- 合集信息编辑

### CollectionSection

合集区域组件。

**路径**: `src/components/Collection/CollectionSection.tsx`

**功能**:
- 合集列表展示
- 新建合集入口

### CollectionItem

合集项组件。

**路径**: `src/components/Collection/CollectionItem.tsx`

**功能**:
- 单个合集卡片
- 拖拽排序支持

### CreateCollectionModal

创建合集弹窗。

**路径**: `src/components/Collection/CreateCollectionModal.tsx`

**功能**:
- 合集名称输入
- 父合集选择
- 封面图片设置

### AddNotesToCollectionModal

添加笔记到合集弹窗。

**路径**: `src/components/Collection/AddNotesToCollectionModal.tsx`

### MoveToCollectionModal

移动笔记到合集弹窗。

**路径**: `src/components/Collection/MoveToCollectionModal.tsx`

### BatchActionBar

批量操作工具栏。

**路径**: `src/components/Collection/BatchActionBar.tsx`

**功能**:
- 批量选择笔记
- 批量删除/移动

## 笔记详情子组件

### NoteContentPanel

笔记内容面板组件。

**路径**: `src/components/Note/NoteContentPanel.tsx`

**功能**:
- 多标签页切换
- 内容区域渲染

### ResponsiveTabs

响应式标签页组件。

**路径**: `src/components/Note/ResponsiveTabs.tsx`

**功能**:
- 自适应标签页布局
- 溢出菜单处理

### TableOfContents

目录组件。

**路径**: `src/components/Note/TableOfContents.tsx`

**功能**:
- 章节目录展示
- 点击跳转定位

### ChapterGrid

章节网格组件。

**路径**: `src/components/Note/ChapterGrid.tsx`

**功能**:
- 章节卡片网格布局
- 章节预览

### Highlight 组件

高光笔记相关组件集合。

**路径**: `src/components/Note/Highlight/`

**子组件**:
- `HighlightGrid` - 高光卡片网格
- `HighlightCard` - 单个高光卡片
- `HighlightToolbar` - 高光工具栏
- `TimelineBar` - 时间轴进度条
- `TopicTags` - 主题标签

### QuickNotes 组件

快速笔记相关组件集合。

**路径**: `src/components/Note/QuickNotes/`

**子组件**:
- `SubTabBar` - 子标签栏
- `LayoutSelector` - 布局选择器
- `StylePanel` - 样式面板
- `MindMapEditor` - 思维导图编辑器
- `InfiniteCanvas` - 无限画布

### MindMap 组件

思维导图相关组件。

**路径**: `src/components/Note/MindMap/`

**子组件**:
- `MindMapView` - 思维导图视图
- `NodeContextMenu` - 节点右键菜单

### FlashcardContent

闪记卡内容组件。

**路径**: `src/components/Note/FlashcardContent.tsx`

**功能**:
- 闪记卡翻转动画
- 卡片导航

### VirtualizedSubtitleList

虚拟化字幕列表组件。

**路径**: `src/components/Note/VirtualizedSubtitleList.tsx`

**功能**:
- 大量字幕的虚拟滚动
- 当前播放位置高亮

### InitializationOverlay

初始化进度遮罩组件。

**路径**: `src/components/Note/InitializationOverlay.tsx`

**功能**:
- 显示初始化步骤进度
- 支持中止操作

### InitializationQueuePanel

初始化队列面板组件。

**路径**: `src/components/Note/InitializationQueuePanel.tsx`

**功能**:
- 显示待初始化笔记队列
- 队列管理操作

## 基础 UI 组件

### Message

消息提示组件。

**路径**: `src/components/ui/Message.tsx`

**功能**:
- Toast 消息提示
- 支持 success/error/warning/info 类型

### ErrorBoundary

错误边界组件。

**路径**: `src/components/ErrorBoundary.tsx`

**功能**:
- 捕获子组件渲染错误
- 显示友好错误界面
- 支持错误恢复

## Context 状态管理

### AppContext

统一 API 入口。

**路径**: `src/context/AppContext.tsx`

**Hook**: `useApp()`

**功能**:
- 聚合所有子 Context
- 提供向后兼容的统一接口

### SidebarContext

侧边栏状态管理。

**路径**: `src/context/SidebarContext.tsx`

**Hook**: `useSidebar()`

**状态**:
- `isCollapsed` - 折叠状态
- `activeSection` - 当前激活区域

### NotesContext

笔记状态管理。

**路径**: `src/context/NotesContext.tsx`

**Hook**: `useNotes()`

**状态**:
- `notes` - 笔记列表
- `currentNote` - 当前笔记
- `loading` - 加载状态

### CollectionsContext

合集状态管理。

**路径**: `src/context/CollectionsContext.tsx`

**Hook**: `useCollections()`

**状态**:
- `collections` - 合集列表
- `currentCollection` - 当前合集

### SettingsContext

设置状态管理。

**路径**: `src/context/SettingsContext.tsx`

**Hook**: `useSettings()`

**状态**:
- `aiConfigs` - AI 配置列表
- `theme` - 主题设置

### UploadContext

上传状态管理。

**路径**: `src/context/UploadContext.tsx`

**Hook**: `useUpload()`

**状态**:
- `videoFile` - 视频文件
- `subtitleFile` - 字幕文件
- `selectedModel` - 选中的模型
- `isUploading` - 上传状态
