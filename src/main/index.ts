/**
 * Electron 主进程入口
 * - 初始化数据库
 * - 创建主窗口
 * - 注册 IPC
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { WindowManager } from './window/WindowManager';
import { initializeDatabase } from './db/init';
import { registerIpcHandlers } from './ipc';

// macOS 开发环境：未签名 Electron 二进制无法初始化 Chromium 沙箱，需禁用
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// 设置应用名称，确保 userData 目录独立
app.setName('SmartNotepad');
// 显式设置 userData 路径，确保 SingletonLock 写入可控目录
const userDataPath = path.join(app.getPath('appData'), 'SmartNotepad');
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}
app.setPath('userData', userDataPath);

process.env.DIST_ELECTRON = path.join(__dirname, '..');
process.env.DIST = path.join(__dirname, '../../dist');

let dbInitialized = false;

async function bootstrap() {
  // 单实例锁（dev 模式跳过，沙箱环境下可能无法创建锁文件）
  if (process.env.NODE_ENV !== 'development') {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
      return;
    }
  }

  app.on('second-instance', () => {
    const mainWin = WindowManager.shared.getMainWindow();
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  // macOS 点击 dock 图标
  app.on('activate', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length === 0) {
      WindowManager.shared.createMainWindow();
    } else {
      wins[0].focus();
    }
  });

  await app.whenReady();

  initializeDatabase();
  dbInitialized = true;

  registerIpcHandlers();

  WindowManager.shared.createMainWindow();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

app.on('before-quit', (e) => {
  // 若 dirty 守卫未通过，由 WindowManager 处理
  if (dbInitialized) {
    const prevented = WindowManager.shared.onBeforeQuit();
    if (prevented) e.preventDefault();
  }
});

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('App bootstrap error:', err);
  app.exit(1);
});
