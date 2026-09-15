import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

/**
 * WhisperService - 本地 whisper-server 进程生命周期管理（启动/停止/状态）。
 *
 * 与 OllamaService 对称设计：
 *   - 状态查询：HTTP 探活 127.0.0.1:8000，区分 running / not-running / timeout
 *   - 启动：先探活，已运行直接返回；未运行则 spawn whisper-server，轮询等待就绪
 *   - 停止：优先 kill 本服务 spawn 的子进程；若未跟踪到 PID（外部启动），
 *     回退 lsof 按端口查杀
 *
 * whisper-server 命令行（与 启动智能记事本.command 一致）：
 *   whisper-server --host 127.0.0.1 --port 8000
 *     --model <path> --inference-path /v1/audio/transcriptions --language zh
 */

const WHISPER_HOST = '127.0.0.1';
const WHISPER_PORT = 8000;
const HEALTH_URL = `http://${WHISPER_HOST}:${WHISPER_PORT}/`;
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const START_POLL_INTERVAL_MS = 1000;
const START_POLL_MAX_ATTEMPTS = 30; // 30 * 1s = 30s（与启动脚本一致）

/** 本服务 spawn 的子进程引用（用于 stop） */
let childPid: number | null = null;

export interface WhisperStatusResult {
  running: boolean;
  message: string;
}

export interface WhisperStartResult {
  success: boolean;
  message: string;
}

export interface WhisperStopResult {
  success: boolean;
  message: string;
}

// ────────────────── 模型路径检测 ──────────────────

/**
 * 查找 whisper 模型文件，优先级与 启动智能记事本.command 一致：
 *   1. ~/Documents/whisper-models/ggml-large-v3.bin
 *   2. ~/Documents/whisper-models/ggml-medium.bin
 *   3. ~/Documents/whisper-models/ 下第一个 ggml-*.bin
 */
function findModelPath(): string | null {
  const modelsDir = path.join(homedir(), 'Documents', 'whisper-models');
  if (!existsSync(modelsDir)) return null;

  const large = path.join(modelsDir, 'ggml-large-v3.bin');
  if (existsSync(large)) return large;

  const medium = path.join(modelsDir, 'ggml-medium.bin');
  if (existsSync(medium)) return medium;

  try {
    const files = readdirSync(modelsDir);
    const found = files.find((f) => f.startsWith('ggml-') && f.endsWith('.bin'));
    if (found) return path.join(modelsDir, found);
  } catch {
    // ignore
  }
  return null;
}

// ────────────────── 健康检查 ──────────────────

type HealthState = 'running' | 'not-running' | 'timeout';

function checkHealth(): Promise<HealthState> {
  return new Promise<HealthState>((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: HEALTH_CHECK_TIMEOUT_MS }, (res) => {
      res.destroy();
      // whisper-server 对 GET / 返回 404 或 200 均视为存活
      resolve('running');
    });
    req.on('error', () => resolve('not-running'));
    req.on('timeout', () => {
      req.destroy();
      resolve('timeout');
    });
  });
}

async function isRunning(): Promise<boolean> {
  return (await checkHealth()) === 'running';
}

// ────────────────── 公开 API ──────────────────

export async function getStatus(): Promise<WhisperStatusResult> {
  try {
    const state = await checkHealth();
    switch (state) {
      case 'running':
        return { running: true, message: 'whisper-server 正在运行' };
      case 'timeout':
        return { running: false, message: '连接超时' };
      default:
        return { running: false, message: 'whisper-server 未运行' };
    }
  } catch (e) {
    return { running: false, message: String(e) };
  }
}

export async function start(): Promise<WhisperStartResult> {
  try {
    if (await isRunning()) {
      return { success: true, message: 'whisper-server 已在运行' };
    }

    // 检查 whisper-server 命令是否可用
    let commandExists = false;
    try {
      execSync('command -v whisper-server', { stdio: 'pipe', timeout: 3000 });
      commandExists = true;
    } catch {
      commandExists = false;
    }
    if (!commandExists) {
      return {
        success: false,
        message: '未安装 whisper-cpp，请执行: brew install whisper-cpp'
      };
    }

    // 查找模型文件
    const modelPath = findModelPath();
    if (!modelPath) {
      return {
        success: false,
        message:
          '未找到 whisper 模型文件（已查找 ~/Documents/whisper-models/ggml-*.bin），请下载模型后重试'
      };
    }

    // spawn whisper-server
    const args = [
      '--host', WHISPER_HOST,
      '--port', String(WHISPER_PORT),
      '--model', modelPath,
      '--inference-path', '/v1/audio/transcriptions',
      '--language', 'zh'
    ];
    try {
      const child = spawn('whisper-server', args, {
        detached: true,
        stdio: 'ignore'
      });
      childPid = child.pid ?? null;
      child.unref();
      child.on('error', () => {
        // spawn 失败，清理 PID
        childPid = null;
      });
    } catch {
      return { success: false, message: '无法启动 whisper-server，请检查安装' };
    }

    // 等待就绪（最多 30 秒）
    for (let i = 0; i < START_POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, START_POLL_INTERVAL_MS));
      if (await isRunning()) {
        return { success: true, message: 'whisper-server 已启动' };
      }
    }

    return { success: false, message: 'whisper-server 启动超时，请查看 /tmp/whisper-server.log' };
  } catch (e) {
    return { success: false, message: `启动失败：${String(e)}` };
  }
}

export async function stop(): Promise<WhisperStopResult> {
  try {
    if (!(await isRunning())) {
      childPid = null;
      return { success: true, message: 'whisper-server 未在运行' };
    }

    // 优先 kill 本服务 spawn 的子进程
    if (childPid) {
      try {
        process.kill(childPid, 'SIGTERM');
      } catch {
        // 进程可能已退出
      }
      // 等待 1 秒让它退出
      await new Promise((r) => setTimeout(r, 1000));
      if (!(await isRunning())) {
        childPid = null;
        return { success: true, message: 'whisper-server 已停止' };
      }
      // SIGTERM 无效，尝试 SIGKILL
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 500));
      if (!(await isRunning())) {
        childPid = null;
        return { success: true, message: 'whisper-server 已停止' };
      }
    }

    // 回退：lsof 按端口查杀（适用于外部启动的进程）
    try {
      const pidStr = execSync(`lsof -ti :${WHISPER_PORT} -sTCP:LISTEN`, {
        encoding: 'utf-8',
        timeout: 3000
      }).trim();
      if (pidStr) {
        execSync(`kill ${pidStr}`, { timeout: 3000 });
        await new Promise((r) => setTimeout(r, 1000));
        if (!(await isRunning())) {
          childPid = null;
          return { success: true, message: 'whisper-server 已停止' };
        }
      }
    } catch {
      // lsof/kill 失败
    }

    return { success: false, message: '无法停止 whisper-server，请手动结束进程' };
  } catch (e) {
    return { success: false, message: `停止失败：${String(e)}` };
  }
}

export default { getStatus, start, stop };
