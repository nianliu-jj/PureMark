# CLAUDE.md

本文件为仓库内协作代理提供上下文说明。

## 项目概述

简墨（PureMark）是一个基于 **Tauri + Vue 3 + 自研 ProseMirror 内核** 的桌面端 Markdown 编辑器，目标是提供接近 Typora 的即时渲染体验，同时支持源码模式、多标签页、多窗口、主题系统、图片上传、导出和工作区浏览。

## 常用命令

所有命令都使用 `pnpm`：

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run lint
pnpm run format
pnpm run tauri:dev
pnpm run tauri:build
pnpm run publish
```

补充说明：

- `pnpm run dev` 启动 Tauri 开发环境
- `pnpm run build` 构建桌面应用
- 当前仓库没有完整自动化测试体系，核心改动需要手工回归

## 当前架构

### 桌面宿主

- `src-tauri/`：唯一桌面宿主实现
- Rust command 负责文件系统、窗口、多标签跨窗路由、更新器、外链打开等系统能力
- 桌面宿主仅使用 `src-tauri/`，不要新增 `src/main/`、`src/preload.ts` 这类旧目录

### 渲染层

- `src/`：Vue 应用入口与页面组件
- `src/services/api/`：渲染层访问 Tauri 能力的统一封装
- `src/hooks/`：模块级共享状态与业务逻辑
- `src/components/ui/`：通用 UI 组件

### 编辑器内核

- `src/core/`：自研 ProseMirror 内核
- `editor.ts` 负责组合 schema、parser、serializer、plugins、nodeviews、快捷键
- `plugins/`、`nodeviews/`、`commands/` 为编辑器功能扩展主落点

## 开发约定

- 默认使用中文文案、注释和文档
- 新的系统能力接入必须优先放在 `src/services/api/`
- 不要重新引入旧宿主架构依赖或旁路实现，桌面能力统一走 Tauri API 层
- 通用 UI 组件统一放在 `src/components/ui/`
- 编辑器相关改动优先复用 `src/core/` 现有 schema / command / plugin 体系
- 涉及文件读写、图片路径、多窗口、自动更新时，要优先检查 `src-tauri/` 已有实现，不要在前端绕开宿主层

## 验证建议

仓库目前没有完善的自动化测试，请在相关改动后手工验证：

- Markdown 文件打开、保存、另存为
- 多标签切换、关闭、拖拽分离与合并
- 本地图片保存、远程图片上传、图片渲染
- 外链与本地 Markdown 链接打开
- 工作区浏览与文件变化同步
- 自动更新状态展示
