# 📝 Smart Notepad · 智能记事本

> 一个**离线优先、隐私不外泄**的 Electron 桌面记事本。Markdown 编辑器 + 本地 AI 助手，从笔记到对话全链路本地存储，零云依赖。

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![electron](https://img.shields.io/badge/Electron-32-47848F)
![react](https://img.shields.io/badge/React-18-61DAFB)
![typescript](https://img.shields.io/badge/TypeScript-5.6-3178C6)
![license](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 特性一览

| | 特性 | 说明 |
|---|---|---|
| ✍️ | **Markdown 三视图** | 编辑 / 预览 / 分栏一键切换，GFM 语法、柔和排版 |
| 💡 | **本地 AI 助手** | 接入 Ollama，✨ 润色 / 📝 总结 / 🚀 扩写一键处理选中文本 |
| 🧠 | **思考过程可视化** | 开关控制是否输出模型推理链（qwen3 系列适配），完成后自动折叠 |
| 💬 | **多轮对话** | 每篇记事独立的会话历史，🔄 新对话不丢旧会话 |
| 💾 | **跨重启恢复** | 笔记 + AI 对话全部存入本地 SQLite，重启自动还原 |
| 🛡️ | **Dirty 双守卫** | 关闭窗口 / 切换页面时检测未保存变更，三选一确认 |
| 🔒 | **零云隐私** | 内容、对话、API Key 仅存本地，无任何遥测上报 |
| ⚡ | **流式中断** | 🛑 随时停止生成，已输出内容保留 |

---

## 🚀 快速开始

**前置**：Node.js ≥ 18 · pnpm · [Ollama](https://ollama.com/)（可选，用于 AI 功能）

```bash
pnpm install      # 安装依赖
pnpm run dev      # 启动开发模式（Vite HMR + Electron）
pnpm run typecheck # 类型检查
pnpm run build    # 生产构建
pnpm run build:mac # 打包 macOS dmg
```

**配置 AI**：启动应用 → 右上角 ⚙️ 设置 → 填 Base URL（`http://localhost:11434`）→ 自动列出模型 / 测试连接 / 🚀 一键启动 Ollama。

---

## 🧱 技术栈

**Electron 32** · **React 18** · **Zustand 4** · **better-sqlite3** · **Tailwind CSS 3** · **Vite 5** · **TypeScript 5.6**

AI 接口采用 **Ollama 原生 `/api/chat`**（NDJSON 流式），而非 OpenAI 兼容接口——后者不识别 `think` 参数，无法可靠控制思考过程。

---

## 🏛️ 设计亮点

**为什么不用 React Router 的 `useBlocker` 做 Dirty 守卫？**
它在组件 mount/unmount 与路由切换同时发生时存在时序竞态，会误弹"未保存"对话框。本项目改用 `useNavigateSafe` hook 手动包装所有导航入口，更可靠。

**为什么把 textarea 选区持久化到 Zustand？**
点击 AI 面板按钮会令 textarea 失焦，DOM `selectionStart/End` 归零，导致"插入到编辑器"位置错误。将选区存入 store 作为唯一真相源，插入时读 store 而非 DOM，彻底解决。

**为什么聊天写入要 350ms 防抖？**
流式输出时每个 token 都触发 `updateMessage`，若每 token 落盘一次磁盘 IO 不可承受。防抖合并 + 切换记事 flush + 退出 flush 三重保障，既不丢数据又不卡盘。

**为什么 AI 上下文只取最近 8 条？**
本地跑 35B 模型，输入 token 越多首 token 延迟越高。8 条 ≈ 4 轮对话，兼顾上下文连贯与响应速度；思考过程（reasoning）不回灌，避免 token 浪费与输出干扰。

---

## 📁 项目结构

```
src/
├── main/              # Electron 主进程
│   ├── ipc.ts         # IPC 薄路由
│   ├── window/        # 窗口管理 + 关闭守卫
│   ├── db/            # SQLite + 仓储模式（Note/Chat/Settings）
│   └── services/      # OllamaService（健康检查 + 启动）
├── preload/           # contextBridge 安全桥
├── renderer/          # React 应用
│   └── src/main-app/
│       ├── components/  # AiPanel / NoteCard / Layout ...
│       ├── pages/       # Home / Note / Settings
│       ├── hooks/       # useChat / useDirtyGuard / useNavigateSafe ...
│       ├── stores/      # note / editor / chat / settings / ui
│       └── utils/
└── shared/            # 主进程与渲染进程共享类型、IPC 通道常量
```

完整数据库 schema 见 [`src/main/db/init.ts`](src/main/db/init.ts)。

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|---|---|
| `⌘/Ctrl + S` | 保存当前记事 |
| `Enter` | 发送 AI 消息 |
| `Shift + Enter` | AI 输入框换行 |

---

## 📦 NPM Scripts

| 命令 | 说明 |
|---|---|
| `pnpm run dev` | 开发模式（Vite HMR + Electron） |
| `pnpm run build` | 生产构建 |
| `pnpm run build:mac` | 打包 macOS dmg |
| `pnpm run typecheck` | 类型检查（node + web 双配置） |

---

## 🔒 隐私

所有记事、AI 对话、应用设置**仅存于本地 SQLite**。AI 请求直连你配置的端点（Ollama 本地或自有 API），API Key 不上传任何服务器，无遥测无上报。

---

## 📄 License

MIT
