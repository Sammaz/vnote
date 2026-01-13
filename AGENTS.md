# Repository Guidelines

## 项目结构与模块组织
- `src/`：React + TypeScript 前端入口与页面逻辑；组件在 `src/components/`，状态与上下文在 `src/context/`，工具在 `src/utils/`，类型在 `src/types/`，静态资源在 `src/assets/`。
- `src-tauri/`：Tauri 2 后端与系统能力；核心 Rust 代码在 `src-tauri/src/`，依赖见 `src-tauri/Cargo.toml`，应用配置在 `src-tauri/tauri.conf.json`，权限能力在 `src-tauri/capabilities/`。
- `scripts/`：构建辅助脚本（如图标生成）；`dist/` 为前端构建输出，`index.html` 为 Vite 入口。

## 构建、测试与开发命令
```bash
npm install
npm run dev
npm run tauri dev
npm run build
npm run tauri build
npm run preview
node scripts/generate-icons.mjs
```
- `npm run dev` 启动 Vite 前端预览；`npm run tauri dev` 启动桌面应用开发模式。
- `npm run build` 仅构建前端；`npm run tauri build` 生成可分发的桌面包。
- `npm run preview` 本地预览构建产物；图标更新请运行脚本并检查 `src-tauri/icons/`。
- 仅验证后端时，可在 `src-tauri/` 下运行 `cargo check` 或 `cargo build`。

## 编码风格与命名约定
- 前端：2 空格缩进，双引号字符串；组件与文件用 PascalCase（如 `NotePage.tsx`），Hook 用 `useXxx`，导出入口用 `index.ts`。
- 后端：遵循 Rust 标准格式（rustfmt 默认），类型用 PascalCase，函数与变量用 snake_case。
- 样式：Tailwind CSS 类名直接写在 JSX 中，保持分组与可读性。

## 架构与数据流概览
- 前端入口在 `src/main.tsx` 与 `src/App.tsx`，页面间通过上下文与组件组合协作；桌面能力由 Tauri `invoke` 触发。
- Tauri 命令与核心逻辑集中在 `src-tauri/src/lib.rs`，并拆分到 `db.rs`、`note_generation.rs`、`rag.rs`、`subtitle.rs`、`ai_pool.rs` 等模块。
- 数据持久化使用 SQLite（rusqlite），关注读写接口与错误处理的一致性。

## 依赖与环境
- 前端依赖与脚本在 `package.json`，锁文件在 `package-lock.json`；修改依赖后请同步更新。
- 后端依赖锁在 `src-tauri/Cargo.lock`；如需升级 Rust crate，保持锁文件一致并记录变更影响。

## 测试指南
- 当前未配置自动化测试脚本与覆盖率要求；请在 PR 中描述手工验证步骤与场景。
- 如新增测试，建议与模块同级放置 `*.test.tsx` 或 Rust `mod tests`，并补充运行命令。

## 提交与 PR 规范
- 提交信息遵循 Conventional Commits，示例：`feat: ...`、`fix: ...`、`chore: ...`，可保留历史中的 Emoji 前缀（如 `🐛 fix:`）。
- PR 需包含变更摘要、关联 Issue（如有）、UI 变更截图或录屏，以及已运行的命令（如 `npm run tauri dev`）。
- 如有数据库或数据结构调整，请在 PR 中注明 migration plan 与 rollback plan。

## 安全与配置提示
- 新增 Tauri 命令或系统能力时，同步更新 `src-tauri/capabilities/default.json` 与 `src-tauri/tauri.conf.json`。
- TS 视频处理依赖 FFmpeg，请确保本机可用（`ffmpeg -version`）。
