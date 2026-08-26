import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/constants';
import type { Note } from '@shared/types';

// electron-vite 在 dev 模式下设置 NODE_ENV=development
const isDev = process.env.NODE_ENV === 'development';
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

const MAIN_PRELOAD = path.join(__dirname, '../preload/index.js');
const DIST = path.join(__dirname, '../../dist');

/**
 * WindowManager 单例
 * 负责：主窗口创建、位置持久化、广播 note:updated
 */
export class WindowManager {
  static shared = new WindowManager();

  private mainWindow: BrowserWindow | null = null;
  // closeBeforeCheck 期间使用的临时 resolver
  private pendingCloseResolver: null | ((value: 'save' | 'discard' | 'cancel') => void) = null;
  /**
   * 记录"已通过 dirty 守卫、允许直接关闭"的窗口。
   * 替代原 (win as any).__allowClose 标记：避免在 BrowserWindow 实例上挂载未类型化字段。
   * 当 close 事件触发且窗口在此集合中时，不再拦截，让 close 继续完成。
   */
  private readonly allowedCloseWindows = new WeakSet<BrowserWindow>();

  private constructor() {}

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;

    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.min(1200, Math.floor(workArea.width * 0.8));
    const height = Math.min(820, Math.floor(workArea.height * 0.8));

    const win = new BrowserWindow({
      width,
      height,
      minWidth: 900,
      minHeight: 600,
      show: false,
      backgroundColor: '#FBF9F5',
      titleBarStyle: 'hiddenInset',
      frame: process.platform === 'darwin' ? true : false,
      trafficLightPosition: { x: 16, y: 18 },
      autoHideMenuBar: true,
      webPreferences: {
        preload: MAIN_PRELOAD,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        spellcheck: false
      }
    });

    if (isDev) {
      win.loadURL(`${DEV_SERVER_URL}/index.html`);
    } else {
      win.loadFile(path.join(DIST, 'index.html'));
    }

    win.once('ready-to-show', () => win.show());

    // dev 模式下转发渲染进程 console 到主进程终端，便于调试
    if (isDev) {
      win.webContents.on('console-message', (_e, level, message, _line, sourceId) => {
        // 过滤 kkFileView iframe 内部的噪音日志（如 "Knockout groups not supported"）
        // sourceId 是产生 console 消息的源页面 URL，kkFileView 运行在 http://127.0.0.1:8012
        if (typeof sourceId === 'string' && sourceId.includes('8012')) return;
        const tag = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
        // eslint-disable-next-line no-console
        console.log(`[renderer:${tag}]`, message);
      });
    }

    // 关闭前：向渲染进程索要 dirty 状态
    win.on('close', (e) => {
      // 若应用正在退出且已决定保存/丢弃，不再拦截
      if (this.allowedCloseWindows.has(win)) return;

      if (this.pendingCloseResolver) {
        // 已在请求中，继续阻止
        e.preventDefault();
        return;
      }

      // 向渲染进程触发询问
      const listenerPromise = new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
        this.pendingCloseResolver = resolve;
        // 5 秒兜底：防止渲染进程无响应
        setTimeout(() => {
          if (this.pendingCloseResolver) {
            this.pendingCloseResolver = null;
            resolve('discard');
          }
        }, 5000);
      });
      win.webContents.send(IPC_CHANNELS.REQUEST_DIRTY_STATE);

      e.preventDefault();
      listenerPromise.then((action) => {
        this.pendingCloseResolver = null;
        if (action === 'cancel') {
          // 保持窗口不关闭
          return;
        }
        if (action === 'save') {
          // 由渲染进程保存后，通过 IPC 告知允许关闭；此处给一个兜底 2s
          let timeoutId: NodeJS.Timeout | null = null;
          const allowClose = () => {
            if (timeoutId) clearTimeout(timeoutId);
            ipcMain.off('__main:allowClose', handler);
            this.allowedCloseWindows.add(win);
            win.close();
          };
          const handler = () => allowClose();
          ipcMain.once('__main:allowClose', handler);
          timeoutId = setTimeout(() => allowClose(), 2500);
        } else {
          // discard
          this.allowedCloseWindows.add(win);
          win.close();
        }
      });
    });

    win.on('closed', () => {
      this.mainWindow = null;
    });

    this.mainWindow = win;
    return win;
  }

  /**
   * 渲染进程对 REQUEST_DIRTY_STATE 的应答入口
   */
  resolveCloseBefore(action: 'save' | 'discard' | 'cancel'): void {
    if (this.pendingCloseResolver) {
      this.pendingCloseResolver(action);
    }
  }

  broadcastNoteUpdated(note: Note): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.NOTE_UPDATED, note);
    }
  }

  onBeforeQuit(): boolean {
    // 若主窗口还在且有未保存变更，则由主窗口的 close 守卫负责。
    // 此处返回 false，允许关闭；前置的 dirty 守卫在 mainWindow 'close' 中已执行。
    return false;
  }
}
