# 📝 Smart Notepad · 智能记事本

一个**本地化、离线优先、隐私不外泄**的 Electron 桌面记事本应用，内置 Markdown 编辑器与 AI 助手面板。所有内容安全存储于本地 SQLite，从笔记到 AI 对话全链路跨重启持久化，离线可用、零云依赖。

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![electron](https://img.shields.io/badge/Electron-32-47848F)
![react](https://img.shields.io/badge/React-18-61DAFB)
![typescript](https://img.shields.io/badge/TypeScript-5.6-3178C6)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 🌟 项目亮点

> 以下是本应用区别于"普通 Electron + Markdown 编辑器"的工程亮点，每一条都在生产代码中落地：

### 💡 AI 助手深度集成

- **Ollama 原生接口适配**：使用原生 `/api/chat` 而非 OpenAI 兼容的 `/v1/chat/completions`。原因：Ollama 的 OpenAI 兼容接口不识别 `think` 参数，`reasoning_effort` 也不可靠；原生接口直接支持 `think: true/false`，能**可靠控制 qwen3 系列模型的思考行为**。
- **🧠 思考过程可视化**：开关切换是否输出模型推理过程。开启时实时流式渲染思考链（CoT），思考完成自动折叠为"查看思考过程"，保持消息区整洁。思考中带脉冲指示器。
- **流式 NDJSON 解析**：原生接口返回 NDJSON（每行一个 JSON 对象），自实现流式 reader + buffer 分行 + 增量累积，`thinking` 与 `content` 字段分别累加渲染，**首 token 延迟可观测**（日志输出 fetch 响应耗时与首 chunk 耗时）。
- **多轮上下文窗口**：自动注入最近 8 条历史消息（user + assistant 混合，≈4 轮对话），过滤空内容与当前轮占位 assistant，**思考过程（reasoning）不回灌**上下文（避免 token 浪费与输出干扰）。
- **`keep_alive: "30m"`**：请求参数显式保持模型驻留显存 30 分钟，避免每次请求重新加载模型（35B 模型冷启动 5-15s，驻留后首 token 延迟显著下降）。
- **请求头精简**：移除 `Accept: text/event-stream` 与 `Authorization`（Ollama 本地无需鉴权），仅保留 `Content-Type`，**避免触发不必要的 CORS 预检**。本地模式仅需 Base URL，不强求 API Key。
- **✨ 润色 / 📝 总结 / 🚀 扩写**：一键模板，自动读取编辑器选中文本并构造 prompt。按钮固定在对话区顶部（sticky + 毛玻璃背景），滚动时始终可达。
- **一键插入到编辑器**：将 AI 回复插入到编辑器光标位置，支持连续多次插入（每次插入后更新选区到新内容末尾）。
- **AbortController 流式中断**：🛑 停止生成按钮可随时中断流式请求，已生成的部分内容保留不丢失。

### 💬 多会话聊天持久化

- **按记事隔离的会话桶**：每篇记事独立维护多会话历史，🔄 新对话不会丢失旧会话——历史会话可通过会话选择器随时切换回看。首页（无记事上下文）的对话同样持久化（`__home__` 哨兵 key）。
- **跨重启恢复**：聊天会话、消息、每篇记事最后选中的会话全部存入 SQLite，应用重启后自动 hydrate 回内存。
- **防抖批量写**：每次消息变更触发 350ms 防抖，**合并流式 token 期间的高频 `updateMessage` 调用**，避免每 token 一次磁盘写入。
- **三重 flush 防丢失**：切换记事时 flush 前一记事待写快照 + `beforeunload` 同步 flush 当前记事 + 防抖窗口兜底，确保最后一段 token 不丢。
- **原子化整批替换**：`ChatRepository.replaceAllForNote` 用事务实现"先删后插"的整批快照替换，避免会话与消息一对一乱序导致的不一致。

### 🛡️ 数据安全与 Dirty 守卫

- **关闭守卫**：窗口关闭前拦截 `close` 事件，向渲染进程 `REQUEST_DIRTY_STATE`，弹出 保存 / 不保存 / 取消 三选一。选"保存"后等待渲染进程保存完成再放行，附 2.5s 兜底超时；5s 渲染进程无响应自动降级为丢弃。
- **导航守卫**：`useNavigateSafe` hook 包装所有 `navigate()` 调用，dirty 时同样弹出确认。**刻意弃用 React Router 的 `useBlocker`**——它在组件 mount/unmount 与路由切换同时发生时存在时序竞态，会误弹"未保存"对话框。
- **Context Bridge 安全模型**：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: false`（兼容本地 better-sqlite3），IPC 通道全部集中在 `IPC_CHANNELS` 常量表白名单化。

### ✍️ 编辑器与选区持久化

- **Store 化的光标选区**：textarea 的 `selectionStart/End` 持久化到 Zustand store（`onSelect` / `onMouseUp` / `onKeyUp` / `onClick` 同步更新），作为插入操作的**唯一真相源**。解决了"点击 AI 面板按钮 → textarea 失焦 → DOM selectionStart/End 归零 → 插入位置错误"的经典 bug。
- **插入位置健壮性**：`handleInsertAtCursor` 读取 store 选区而非 DOM，并对边界做 `Math.max/Math.min` 钳制，多轮插入也能正确落到前次插入末尾。
- **按钮防失焦**：AI 面板所有按钮 `onMouseDown={(e) => e.preventDefault()}`，防止点击瞬间 textarea 失焦导致选区丢失。
- **Inline dirty 计算**：刻意用 `s.title !== s.pristineTitle || s.content !== s.pristineContent` 内联计算 dirty，**而非读取 store 的 getter**——Zustand selector 的浅比较无法可靠感知 getter 计算属性变化，会导致保存按钮在 AI 插入内容后仍禁用。

### 🏗️ 工程架构亮点

- **仓储模式（Repository Pattern）**：`NoteRepository` / `ChatRepository` / `SettingsRepository` 封装全部 SQL，所有写入走 `db.transaction()` 保证原子性。`NoteRepository` 自动维护时间戳。
- **IPC 薄路由 + Service 分层**：`ipc.ts` 仅做通道注册与参数透传，业务逻辑下沉到 `services/OllamaService`，符合单一职责。
- **SRP / DRY 重构**：Ollama 健康检查原本在 STATUS 与 START 两处重复实现，现统一为 `checkHealth()`；chat 持久化 payload 映射原本在 debounce 与 flush 两处逐字重复，现抽出 `buildPersistPayload()` 共用。
- **零 `any` / 零 `require()`**：全量消除 `as any`、`: any`、CommonJS `require()` 反模式。`WeakSet<BrowserWindow>` 替代 `(win as any).__allowClose` 字段挂载；`__chatAbort` 通过 `declare global` 加入 Window 接口；外部 JSON 响应用 `unknown` + 类型守卫收窄。
- **统一类型源**：`ChatMessage` 收敛至 `@shared/types`，主进程与渲染进程共享，避免 store 反向依赖 hook 的方向错误。
- **WAL + 外键级联**：SQLite 启用 `journal_mode = WAL`（读写并发友好）与 `foreign_keys = ON`，删除记事时自动级联清理其下所有会话与消息。
- **轻量 schema 迁移**：`chat_messages.reasoning` 列通过 `PRAGMA table_info` 检测后 `ALTER TABLE` 补列，兼容旧库无该列的场景。
- **多 Store 状态隔离**：note / editor / chat / settings / ui 五个 Zustand store 各司其职，hook 通过 `useMemo`/`useCallback` 返回稳定引用，避免无谓 re-render。

### ⚡ 性能优化

- **上下文窗口裁剪**：历史消息从 20 条裁至 8 条，降低 prompt processing 延迟（输入 token 越多首 token 延迟越高）。
- **模型驻留**：`keep_alive: "30m"` 保持 35B 模型常驻显存。
- **Lazy 路由**：HomePage / NotePage / SettingsPage 均 `lazy()` + `Suspense` 懒加载，AiPanel 仅在 `showAiPanel` 为 true 时挂载。
- **防抖持久化**：聊天高频流式写入合并为 350ms 一次磁盘落盘。
- **Store 不可变更新**：所有 set 返回新对象，配合 Zustand selector 实现细粒度订阅。

---

## ✨ 核心特性

### 📔 笔记管理
- **本地 SQLite 持久化**：所有记事以 SQLite 表存储，离线可用、隐私安全
- **侧栏快速检索**：实时按标题与内容过滤记事列表
- **自动时间戳**：自动记录每篇记事的创建与最后修改时间
- **未保存提示**：编辑器顶部红点 `*` + 底部"有未保存修改"脉冲指示
- **自动保存**：切换记事时自动保存当前内容，避免数据丢失
- **记事卡片信息密度**：标题、内容摘要、创建/修改时间底部排列，搜索关键词高亮

### ✍️ Markdown 编辑
- **三视图模式**：编辑 / 预览 / 分栏（一键循环切换）
- **实时渲染**：基于 `react-markdown` + `remark-gfm`，支持表格、任务列表等 GFM 语法
- **柔和排版**：自定义 `prose-note` 样式，配色与纸张质感统一
- **空状态居中占位**：编辑器与预览空内容时显示居中灰色提示（`#B8B5AC`）
- **快捷键保存**：`⌘/Ctrl + S` 一键保存

### 💡 AI 助手面板
- **本地 Ollama 集成**：原生 `/api/chat` 接口，`think` 参数可靠控制思考过程
- **一键模板**：✨ 润色 / 📝 总结 / 🚀 扩写，针对编辑器选中文本快速处理
- **流式输出**：NDJSON 流式解析，逐 token 渲染回复
- **思考过程**：🧠 开关切换是否显示模型推理过程（qwen3 系列适配）
- **多会话管理**：每篇记事独立的对话历史，🔄 新对话不丢失旧会话
- **跨重启持久化**：聊天会话与消息存入 SQLite，重启应用自动恢复
- **插入到编辑器**：一键将 AI 回复插入到编辑器光标位置
- **流式中断**：🛑 随时停止生成，已生成内容保留
- **可拖动面板宽度**：拖动分隔条调整 AI 面板宽度（280-640px）

### 🛡️ 数据安全
- **关闭守卫**：窗口关闭前检测未保存变更，提供 保存 / 不保存 / 取消 三选一
- **离开守卫**：导航离开编辑页时同样检测脏状态
- **Context Bridge**：渲染进程 `nodeIntegration` 关闭、`contextIsolation` 开启，IPC 通道白名单化
- **API Key 本地存储**：仅存于本地 SQLite，不上传任何服务器

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
│   │       │   │   ├── useNavigateSafe.ts    # 安全导航
│   │       │   │   ├── useConfirm.ts
│   │       │   │   └── useToast.ts
│   │       │   ├── stores/
│   │       │   │   ├── useNoteStore.ts
│   │       │   │   ├── useEditorStore.ts
│   │       │   │   ├── useChatStore.ts       # 聊天状态 + 防抖持久化
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

### AI 上下文窗口

`sendMessage` 构造请求时，从当前会话取历史消息并裁剪：

```typescript
const history = sessionMessages.filter(
  (m) => m.content.trim() && m.id !== assistantId
);
const recent = history.slice(-8);  // 最近 8 条 ≈ 4 轮对话
```

| 项 | 是否计入 | 说明 |
|---|---|---|
| 历史 user / assistant 消息 | ✅ | 混合计数，最近 8 条 |
| 思考过程 (reasoning) | ❌ | 仅 `content` 字段回传，避免 token 浪费与输出干扰 |
| system prompt | ❌ | 调用方传入时单独前置 1 条 |
| 空内容消息 | ❌ | `content.trim()` 为空被过滤 |

裁剪至 8 条是为降低 prompt processing 延迟（从 20 条优化而来），配合 `keep_alive: "30m"` 模型驻留，显著降低首 token 延迟。

### Dirty 守卫

窗口关闭与导航离开均经过两层守卫：

- **窗口关闭**：`WindowManager` 拦截 `close` 事件 → 向渲染进程 `REQUEST_DIRTY_STATE` → `useDirtyGuard` 检查 `useEditorStore.dirty` → 弹出 保存/不保存/取消 对话框 → 根据选择保存或丢弃
- **导航离开**：`useNavigateSafe` hook 包装所有 `navigate()` 调用，dirty 时同样弹出确认对话框。**刻意弃用 React Router 的 `useBlocker`**（存在 mount/unmount 时序竞态）

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
  created_at INTEGER NULL,
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

启用 `journal_mode = WAL` 与 `foreign_keys = ON`。`reasoning` 列通过轻量级 schema 迁移自动补齐。

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
