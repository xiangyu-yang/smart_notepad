import http from 'node:http';
import { spawn } from 'node:child_process';

/**
 * OllamaService - 本地 Ollama 服务管理（健康检查 + 启动）。
 *
 * 抽离自 ipc.ts，遵循单一职责：
 *   - 健康检查复用同一份 HTTP 探针逻辑（原 ipc.ts 中重复实现两次）
 *   - 使用 ES Module 顶层 import，替代原内联 require('http') / require('child_process')
 *   - 删除原仅赋值从不读取的 ollamaProcess.pid 局部状态
 *
 * 行为与原 ipc.ts 内 OLLAMA_STATUS / OLLAMA_START 处理器完全一致：
 *   - 状态查询区分 running / not-running / timeout 三种文案
 *   - 启动时先探活，已运行直接返回；未运行则 spawn `ollama serve`，
 *     spawn 失败回退 macOS `open -a Ollama`，再以 500ms 间隔轮询最多 10s
 */

const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const START_POLL_INTERVAL_MS = 500;
const START_POLL_MAX_ATTEMPTS = 20; // 20 * 500ms = 10s

export interface OllamaStatusResult {
  running: boolean;
  message: string;
}

export interface OllamaStartResult {
  success: boolean;
  message: string;
}

/** 健康检查细分状态：用于 STATUS 返回差异化文案（START 仅关心 running）。 */
type HealthState = 'running' | 'not-running' | 'timeout';

/**
 * 探活 Ollama /api/tags 端点。
 * - 成功响应 → 'running'
 * - 网络错误 → 'not-running'
 * - 2s 超时   → 'timeout'（保留原 STATUS 的"连接超时"文案）
 */
function checkHealth(): Promise<HealthState> {
  return new Promise<HealthState>((resolve) => {
    const req = http.get(OLLAMA_TAGS_URL, { timeout: HEALTH_CHECK_TIMEOUT_MS }, (res) => {
      res.destroy();
      resolve('running');
    });
    req.on('error', () => resolve('not-running'));
    req.on('timeout', () => {
      req.destroy();
      resolve('timeout');
    });
  });
}

/** START 流程只需布尔结果（原实现也是把 timeout / error 都折叠为 false）。 */
async function isRunning(): Promise<boolean> {
  return (await checkHealth()) === 'running';
}

export async function getStatus(): Promise<OllamaStatusResult> {
  try {
    const state = await checkHealth();
    switch (state) {
      case 'running':
        return { running: true, message: 'Ollama 服务正在运行' };
      case 'timeout':
        return { running: false, message: '连接超时' };
      default:
        return { running: false, message: 'Ollama 服务未运行' };
    }
  } catch (e) {
    return { running: false, message: String(e) };
  }
}

export async function start(): Promise<OllamaStartResult> {
  try {
    // First check if already running
    if (await isRunning()) {
      return { success: true, message: 'Ollama 服务已在运行' };
    }

    // Try to start `ollama serve`
    const platform = process.platform;
    const cmd = platform === 'win32' ? 'ollama.exe' : 'ollama';

    try {
      const child = spawn(cmd, ['serve'], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch {
      // spawn 失败：macOS 回退 `open -a Ollama` 启动 Ollama 桌面端
      if (platform === 'darwin') {
        try {
          const child = spawn('open', ['-a', 'Ollama'], {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
        } catch {
          return { success: false, message: '无法启动 Ollama，请手动运行 ollama serve' };
        }
      } else {
        return { success: false, message: '未找到 ollama 命令，请确认已安装 Ollama' };
      }
    }

    // Wait for ollama to start (up to 10 seconds)
    for (let i = 0; i < START_POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, START_POLL_INTERVAL_MS));
      if (await isRunning()) {
        return { success: true, message: 'Ollama 服务已启动' };
      }
    }

    return { success: false, message: 'Ollama 启动超时，请手动检查' };
  } catch (e) {
    return { success: false, message: `启动失败：${String(e)}` };
  }
}

export default { getStatus, start };
