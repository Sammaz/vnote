# VNote Agent Guide

本文件用于指导在本仓库内工作的智能代理。内容覆盖构建/测试命令与代码风格约定，确保与现有工程保持一致。

## 项目概览
- VNote 是基于 Tauri 2 的桌面应用，前端为 React 19 + TypeScript + Vite 7 + Tailwind CSS 4，后端为 Rust。
- 前端目录：`src/`；后端目录：`src-tauri/`。
- 自定义标题栏：通过 `data-tauri-drag-region` 控制拖拽区。
- 主题系统：默认暗色模式，切换通过 `document.documentElement` 的 `dark` class。

## 构建 / 开发 / 测试命令
### 安装依赖
- `npm install`

### 开发
- 前端开发服务器：`npm run dev`
- 全量 Tauri 开发：`npm run tauri dev`

### 构建
- 前端构建（含类型检查）：`npm run build`
- Tauri 构建：`npm run tauri build`

### 测试（Vitest）
- 全量测试：`npm run test`
- 监听模式：`npm run test:watch`

### 运行单个测试
- 按文件运行：
  - `npm run test -- src/utils/markdownAssembler.test.ts`
  - `npm run test -- src/components/Note/SubtitleRowWithMarker.test.tsx`
- 按用例名运行：
  - `npm run test -- -t "formatTimestamp"`
  - `npm run test -- -t "should render exactly N rows"`

### Lint
- 未发现 ESLint/Prettier 配置或 lint 脚本。保持现有格式与类型规则即可（见下方代码规范）。

## 代码风格与规范
### 通用风格
- 语言：TypeScript + React JSX。
- 缩进：2 空格。
- 引号：双引号（含 import 路径、字符串）。
- 语句结束：使用分号。
- 允许少量必要注释；避免机械式注释。
- 文件命名：组件 PascalCase（如 `SettingsPage.tsx`），工具函数/模块 camelCase（如 `chapterSegmentation.ts`）。

### Import 约定
- 常见分组顺序：
  1. React/框架内置
  2. 第三方库（如 `lucide-react`、`@tauri-apps/*`）
  3. 本地模块（相对路径）
  4. 样式文件（如 `./index.css`）
- 类型导入使用 `import type`。

### TypeScript 约束（来自 tsconfig）
- `strict: true`，必须显式处理可能为 `null/undefined` 的值。
- `noUnusedLocals` / `noUnusedParameters`：禁止未使用变量与参数。
- `isolatedModules: true`：避免依赖类型擦除副作用。
- `noFallthroughCasesInSwitch: true`：switch 必须显式处理。

### 命名与组织
- 组件：PascalCase，如 `NotePage`、`Sidebar`。
- Hook：`useXxx`，如 `useNotes`、`useUpload`。
- 常量：`UPPER_SNAKE_CASE`（如 `VIEW_TYPES`）。
- Context：单一职责分拆（Sidebar/Settings/Upload/Notes/Collections），`useApp` 作为统一入口。

### UI 与样式
- Tailwind CSS + 主题变量：`vnote-bg`、`vnote-card`、`vnote-border`、`vnote-hover`。
- 暗色模式：通过 `document.documentElement.classList.add("dark")` 切换。
- 标题栏拖拽：`data-tauri-drag-region` 标记可拖拽区域；交互元素必须设为 `data-tauri-drag-region="false"`。
- 窗口控制：使用 `@tauri-apps/api/window` 的 `getCurrentWindow()`。

### 错误处理与边界
- Tauri API 调用建议 `try/catch` 并记录 `console.warn`/`console.error`。
- 针对环境差异（非 Tauri）需先检测：
  - `const isTauri = Boolean(window.__TAURI_INTERNALS__)`
- Context hook 在缺少 Provider 时应抛错（示例：`useApp`）。

### 测试风格
- 测试框架：Vitest + Testing Library + fast-check（属性测试）。
- 测试文件：`*.test.ts` / `*.test.tsx`。
- 测试环境：`jsdom`，全局 `vi` 可用（见 `src/test/setup.ts`）。
- Tauri 相关模块可通过 `vi.mock` 进行模拟。

## 业务/架构要点（来自 Copilot 规则）
- AI 配置结构：`{id, title, base_url, api_key, model, sort_order}`。
- 设置页包含模型配置的编辑/删除、测试连接等交互。
- 视图路由：`currentView` 控制 `home` / `settings` / `note` 等页面。
- 自定义标题栏、窗口尺寸与装饰在 `tauri.conf.json` 配置。
- 前端入口：`src/App.tsx`，Rust 入口：`src-tauri/src/main.rs`。

## 代码修改注意事项
- 遵循现有组件结构与 Context 分层，不要破坏拆分后的 Provider 组合顺序。
- 新增 UI 时复用 `cn` 工具合并类名：`src/utils/cn.ts`。
- 保持 Tailwind 主题色一致，避免引入新的硬编码色值。
- 不要引入新的 lint/格式化工具，除非明确被要求。

## 常见操作提示
- 若需新增测试，优先与现有命名/结构保持一致。
- 若需运行 Tauri 相关功能，请使用 `npm run tauri dev` 进行验证。
- Windows 下使用 FFmpeg 处理 TS 视频需确保本机已安装并配置 PATH（参见 README）。

## 现有规则来源
- Copilot 规则：`.github/copilot-instructions.md`
- Cursor 规则：未发现 `.cursor/rules/` 或 `.cursorrules`
