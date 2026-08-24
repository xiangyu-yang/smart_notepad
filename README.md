# 📝 Smart Notepad · 智能记事本

一个本地化、离线优先的 Electron 桌面记事本应用，内置 Markdown 编辑器与 AI 助手面板，所有内容安全存储于本地 SQLite，离线可用、隐私不外泄。

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![electron](https://img.shields.io/badge/Electron-32-47848F)
![react](https://img.shields.io/badge/React-18-61DAFB)
![typescript](https://img.shields.io/badge/TypeScript-5.6-3178C6)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 🌟 设计亮点

不只是"记事本 + AI 对话框"，而是在工程细节上反复打磨过的产品级实现：

- **🧠 思考过程可视化与可控**：通过 Ollama 原生 `/api/chat` 的 `think` 参数（而非 OpenAI 兼容接口的 `reasoning_effort`）可靠控制 qwen3 系列的思考行为——开关一开实时展示模型推理链路，一关跳过思考直出答案，告别"关了思考却仍卡十几秒"
- **⚡ 显存驻留零冷启**：请求体携带 `keep_alive: "30m"`，模型常驻 GPU 显存，连续对话不再每次重新加载 35B 权重
- **🎯 精剪上下文降延迟**：多轮对话仅回灌最近 8 条消息（≈ 4 轮），主动剔除 `reasoning` 中间产物，显著缩短首 token 延迟而不损失多轮连贯性
- **📍 光标选区持久化**：编辑器选区写入 Zustand store 作为唯一真值，点 AI 按钮导致 textarea 失焦后仍能精准插入到原光标位置——彻底解决了"插入内容一闪而过"的经典竞态
- **💾 聊天防抖批量持久化**：流式 token 期间 350ms 防抖合并写入，切换记事 / 退出应用时同步 flush，最后一截 token 也不丢；每篇记事独立会话桶，重启自动恢复
- **🛡️ 双重 Dirty 守卫**：窗口关闭 + 路由导航两层拦截，手动 navigateIfSafe 替代 React Router useBlocker 的时序竞态，再不会误弹"未保存"提示
- **🔒 安全 IPC 桥**：`contextIsolation` 开启 + `nodeIntegration` 关闭，通道常量化白名单，渲染进程拿不到 Node 能力
- **🧩 工程化代码质量**：仓储模式事务化写入、SRP 拆分服务层、Zustand 多 store 单一职责、TypeScript 严格模式零 `any` 零 `require()`

---

## ✨ 核心特性

### 📔 笔记管理
- **本地 SQLite 持久化**：所有记事以 SQLite 表存储，离线可用、隐私安全
- **侧栏快速检索**：实时按标题与内容过滤记事列表
- **自动时间戳**：自动记录每篇记事的创建与最后修改时间
- **未保存提示**：编辑器顶部红点 + 底部"有未保存修改"脉冲指示
- **自动保存**：切换记事时自动保存当前内容，避免数据丢失

### ✍️ Markdown 编辑
- **三视图模式**：编辑 / 预览 / 分栏（一键循环切换）
- **实时渲染**：基于 `react-markdown` + `remark-gfm`，支持表格、任务列表等 GFM 语法
- **柔和排版**：自定义 `prose-note` 样式，配色与纸张质感统一
- **快捷键保存**：`⌘/Ctrl + S` 一键保存

### 💡 AI 助手面板
- **本地 Ollama 集成**：原生 `/api/chat` 接口，支持 `think` 参数可靠控制思考过程
- **一键模板**：✨ 润色 / 📝 总结 / 🚀 扩写，针对编辑器选中文本快速处理
- **流式输出**：NDJSON 流式解析，逐 token 渲染回复
- **思考过程**：🧠 开关切换是否显示模型推理过程（qwen3 系列适配）
- **多会话管理**：每篇记事独立的对话历史，🔄 新对话不丢失旧会话
- **跨重启持久化**：聊天会话与消息存入 SQLite，重启应用自动恢复
- **插入到编辑器**：一键将 AI 回复插入到编辑器光标位置

### 🛡️ 数据安全
- **关闭守卫**：窗口关闭前检测未保存变更，提供 保存 / 不保存 / 取消 三选一
- **离开守卫**：导航离开编辑页时同样检测脏状态
- **Context Bridge**：渲染进程 `nodeIntegration` 关闭、`contextIsolation` 开启，IPC 通道白名单化

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| **桌面框架** | Electron 32 + electron-vite |
| **前端框架** | React 18 + React Router 6 (hash router) |
| **状态管理** | Zustand 4（多 store：note / editor / chat / settings / ui） |
| **样式** | Tailwind CSS 3 + `@tailwindcss/typography` |
| **数据库** | better-sqlite3（WAL 模式 + 外键级联） |
| **AI 接口** | Ollama 原生 `/api/chat`（NDJSON 流式） |
| **构建工具** | Vite 5 + TypeScript 5.6 |
| **包管理** | pnpm（node-linker=hoisted） |

---

## 📁 项目结构

```
smart_notepad/
├── src/
│   ├── main/                          # Electron 主进程
│   │   ├── index.ts                   # 入口：app 生命周期、单例锁
│   │   ├── ipc.ts                     # IPC 处理器（薄路由层）
│   │   ├── window/
│   │   │   └── WindowManager.ts       # 主窗口单例 + dirty 关闭守卫
│   │   ├── db/
│   │   │   ├── init.ts                # SQLite 初始化 + schema 迁移
│   │   │   └── repositories/          # 仓储模式
│   │   │       ├── NoteRepository.ts
│   │   │       ├── ChatRepository.ts
│   │   │       └── SettingsRepository.ts
│   │   └── services/
│   │       └── OllamaService.ts        # Ollama 健康检查 + 启动
│   │
│   ├── preload/
│   │   └── index.ts                   # contextBridge 安全桥
│   │
│   ├── renderer/
│   │   └── src/
│   │       ├── main-app/
│   │       │   ├── App.tsx            # 路由 + lazy 懒加载
│   │       │   ├── main.tsx           # React 入口
│   │       │   ├── components/
│   │       │   │   ├── Layout.tsx     # 侧栏 + 搜索 + 主区
│   │       │   │   ├── AiPanel.tsx    # AI 助手面板
│   │       │   │   ├── NoteCard.tsx   # 记事卡片
│   │       │   │   ├── ConfirmDialog.tsx
│   │       │   │   ├── IconButton.tsx
│   │       │   │   ├── ReasoningBlock.tsx  # 思考过程折叠块
│   │       │   │   └── Toast.tsx
│   │       │   ├── pages/
│   │       │   │   ├── HomePage.tsx
│   │       │   │   ├── NotePage.tsx   # 编辑器主页面
│   │       │   │   └── SettingsPage.tsx
│   │       │   ├── hooks/
│   │       │   │   ├── useChat.ts            # 聊天流式请求
│   │       │   │   ├── useDirtyGuard.ts      # 关闭 dirty 守卫
│   │       │   │   ├── useNavigateSafe.ts     # 安全导航
│   │       │   │   ├── useConfirm.ts
│   │       │   │   └── useToast.ts
│   │       │   ├── stores/
│   │       │   │   ├── useNoteStore.ts
│   │       │   │   ├── useEditorStore.ts
│   │       │   │   ├── useChatStore.ts        # 聊天状态 + 防抖持久化
│   │       │   │   ├── useSettingsStore.ts
│   │       │   │   └── useUiStore.ts
│   │       │   └── utils/
│   │       │       ├── format-time.ts
│   │       │       └── text.ts
│   │       └── styles/
│   │           └── index.css
│   │
│   └── shared/
│       ├── types.ts                   # 主进程 / 渲染进程共享类型
│       └── constants.ts               # IPC 通道常量、DB 文件名
│
├── electron.vite.config.ts            # main / preload / renderer 三入口
├── tailwind.config.js
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
└── package.json
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **pnpm**（推荐）或 npm
- **Ollama**（可选，用于 AI 助手功能）— [安装指引](https://ollama.com/)

### 安装与运行

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发模式（同时拉起 Vite 与 Electron）
pnpm run dev

# 3. 类型检查
pnpm run typecheck

# 4. 生产构建
pnpm run build

# 5. 打包 macOS 应用（dmg）
pnpm run build:mac
```

### 配置 AI 助手

1. 启动应用后进入 **设置** 页（右上角 ⚙️）
2. 填写 **Base URL**：
   - 本地 Ollama：`http://localhost:11434`
   - OpenAI 兼容：`https://api.openai.com/v1`
3. （Ollama 无需 API Key）填写 **API Key**
4. **Model 名称**：填写 Ollama Base URL 后自动列出可用模型，或手动输入
5. 点击 **测试连接** 验证；若 Ollama 未运行，可点击 **🚀 启动 Ollama** 自动拉起

---

## 🏛️ 架构与设计

### 主进程 ↔ 渲染进程通信

采用 **Context Bridge + IPC 白名单** 的安全模型：

```
渲染进程                    Preload                     主进程
   │                          │                           │
   │── window.api.notes.save ─▶ ipcRenderer.invoke ─▶ ipcMain.handle
   │                          │                           │
   │◀── note:updated 事件 ────│◀── webContents.send ─────│
```

- `nodeIntegration: false`、`contextIsolation: true`
- IPC 通道集中在 `shared/constants.ts` 的 `IPC_CHANNELS` 常量表
- Preload 仅暴露最小必要 API（`IpcApi` / `WindowApi` / `WindowEvents`）

### 仓储模式（Repository Pattern）

数据访问层封装在 `db/repositories/` 下，每个 Repository 封装对应表的所有 SQL：

- 所有写入走 `db.transaction()` 保证原子性
- `ChatRepository.replaceAllForNote` 用事务实现"整批快照替换"，避免会话与消息一对一乱序
- `NoteRepository` 自动维护 `created_at` / `updated_at` 时间戳

### 状态管理（多 Store）

| Store | 职责 |
|---|---|
| `useNoteStore` | 记事列表、当前选中、CRUD |
| `useEditorStore` | 编辑器内容、pristine 状态、光标选区（dirty 计算依据） |
| `useChatStore` | 按 noteId 隔离的会话桶、流式状态、防抖持久化（350ms） |
| `useSettingsStore` | LLM 配置（baseUrl / apiKey / model） |
| `useUiStore` | 侧栏搜索、AI 面板开关与宽度、Toast、Confirm 对话框、思考过程开关 |

### 聊天持久化策略

- **防抖批量写**：每次 `appendMessage` / `updateMessage` 触发 350ms 防抖，合并流式 token 期间的高频写入
- **切换 flush**：切换记事时立即 flush 前一记事的待写快照
- **退出 flush**：`beforeunload` 同步 flush 当前记事，防止最后一段 token 丢失
- **首页会话**：`__home__` 哨兵 key，首页聊天同样持久化

### Dirty 守卫

窗口关闭与导航离开均经过两层守卫：

- **窗口关闭**：`WindowManager` 拦截 `close` 事件 → 向渲染进程 `REQUEST_DIRTY_STATE` → `useDirtyGuard` 检查 `useEditorStore.dirty` → 弹出 保存/不保存/取消 对话框 → 根据选择保存或丢弃
- **导航离开**：`useNavigateSafe` hook 包装所有 `navigate()` 调用，dirty 时同样弹出确认对话框

---

## 💾 数据库 Schema

```sql
-- 记事
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- AI 聊天会话（与 notes 1:N，CASCADE 删除）
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

-- AI 聊天消息
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  reasoning TEXT,                    -- 大模型思考过程
  ordering INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- 每篇记事最后选中的会话
CREATE TABLE chat_active_session (
  note_id TEXT PRIMARY KEY,
  session_id TEXT
);

-- 应用设置（key-value）
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
```

数据库位置：
- **开发模式**：项目根目录 `smart_notepad.db`
- **生产模式**：`userData/SmartNotepad/smart_notepad.db`

启用 `journal_mode = WAL` 与 `foreign_keys = ON`。

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
| `pnpm run dev` | 启动开发模式（Vite HMR + Electron） |
| `pnpm run build` | 构建生产产物（main + preload + renderer） |
| `pnpm run build:mac` | 构建并打包 macOS dmg |
| `pnpm run typecheck` | TypeScript 类型检查（node + web 双配置） |
| `pnpm run preview` | 预览生产构建 |

---

## 🔒 隐私说明

- 所有记事内容、AI 对话历史、应用设置**仅存储于本地 SQLite**
- AI 请求直接从渲染进程发往你配置的 Base URL（Ollama 本地或你自己的 API 端点）
- API Key 仅保存在本地，不会上传到任何服务器
- 无任何遥测、无任何远程上报

---

## 📄 License

MIT
