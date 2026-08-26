import { app, BrowserWindow, dialog, ipcMain, shell, type SaveDialogOptions } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/constants';
import type { ChatSession, Folder, Note, SettingsKey, SettingsMap } from '@shared/types';
import { ChatRepository } from './db/repositories/ChatRepository';
import { FolderRepository } from './db/repositories/FolderRepository';
import { NoteRepository } from './db/repositories/NoteRepository';
import { SettingsRepository } from './db/repositories/SettingsRepository';
import {
  AttachmentRepository,
  getAttachmentPathOrThrow
} from './db/repositories/AttachmentRepository';
import { WindowManager } from './window/WindowManager';
import * as OllamaService from './services/OllamaService';
import { AttachmentFileServer } from './services/AttachmentFileServer';
import { KkFileViewService, KKFILEVIEW_DEFAULT_PORT } from './services/KkFileViewService';

export function registerIpcHandlers(): void {
  // ---------- notes ----------
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST, () => {
    try {
      return NoteRepository.list();
    } catch (e) {
      console.error('[ipc] notes.list error:', e);
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.NOTES_GET, (_e, id: string) => {
    try {
      return NoteRepository.get(id);
    } catch (e) {
      console.error('[ipc] notes.get error:', e);
      return null;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTES_SAVE,
    (_e, payload: Partial<Note> & { id?: string }): Note => {
      try {
        const note = NoteRepository.upsert(payload);
        // 向主窗口广播更新
        WindowManager.shared.broadcastNoteUpdated(note);
        return note;
      } catch (e) {
        console.error('[ipc] notes.save error:', e);
        throw e;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE, (_e, id: string): boolean => {
    try {
      return NoteRepository.remove(id);
    } catch (e) {
      console.error('[ipc] notes.delete error:', e);
      return false;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTES_MOVE,
    (_e, noteId: string, folderId: string | null): Note | null => {
      try {
        const note = NoteRepository.move(noteId, folderId);
        if (note) {
          // 复用现有广播，多窗口天然同步
          WindowManager.shared.broadcastNoteUpdated(note);
        }
        return note;
      } catch (e) {
        console.error('[ipc] notes.move error:', e);
        return null;
      }
    }
  );

  /**
   * 构造独立 print 窗口加载的完整 HTML 文档。
   * 内嵌 prose-note 样式（与渲染进程预览一致）+ 打印分页优化，避免长代码块/表格被分页截断。
   * innerHtml 由渲染进程 renderToStaticMarkup 生成，是受信任的用户笔记内容，无需转义。
   */
  function buildPrintHtml(innerHtml: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, system-ui, sans-serif;
    color: #3A3832;
    line-height: 1.75;
    font-size: 15px;
  }
  .prose-note { max-width: none; }
  .prose-note h1, .prose-note h2, .prose-note h3, .prose-note h4, .prose-note h5, .prose-note h6 {
    color: #2B2A27;
    font-weight: 600;
    letter-spacing: 0.2px;
    margin-top: 1.4em;
    margin-bottom: 0.6em;
  }
  .prose-note h1 { font-size: 1.8em; }
  .prose-note h2 { font-size: 1.5em; }
  .prose-note h3 { font-size: 1.25em; }
  .prose-note p { margin: 0.6em 0; }
  .prose-note code {
    background: #F1ECE0;
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 0.9em;
    font-family: "SF Mono", Menlo, Consolas, monospace;
  }
  .prose-note pre {
    background: #2B2A27;
    color: #F6F2E9;
    border-radius: 10px;
    padding: 14px 16px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .prose-note pre code { background: transparent; color: inherit; padding: 0; }
  .prose-note a { color: #5E8B72; }
  .prose-note blockquote {
    border-left: 3px solid #DFD3B8;
    padding-left: 14px;
    color: #53514A;
    margin: 0.8em 0;
    margin-left: 0;
  }
  .prose-note ul, .prose-note ol { padding-left: 1.6em; margin: 0.6em 0; }
  .prose-note li { margin: 0.25em 0; }
  .prose-note table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.8em 0;
  }
  .prose-note th, .prose-note td {
    border: 1px solid #DFD3B8;
    padding: 6px 12px;
    text-align: left;
  }
  .prose-note th { background: #F1ECE0; font-weight: 600; }
  .prose-note img { max-width: 100%; height: auto; }
  .prose-note hr { border: none; border-top: 1px solid #DFD3B8; margin: 1.4em 0; }
  /* 行内 HTML 标签样式（rehype-raw 解析后生效，与渲染进程预览一致） */
  .prose-note mark { background: #FFF3B0; color: #3A3832; padding: 1px 2px; border-radius: 3px; }
  .prose-note u { text-decoration: underline; text-decoration-color: #53514A; text-underline-offset: 2px; }
  .prose-note ins { text-decoration: underline; text-decoration-color: #5E8B72; text-underline-offset: 2px; }
  .prose-note del { color: #9B9890; }
  .prose-note sub, .prose-note sup { font-size: 0.75em; line-height: 0; position: relative; vertical-align: baseline; }
  .prose-note sub { top: 0.3em; }
  .prose-note sup { bottom: 0.5em; }
  /* 打印分页优化：避免标题孤立在页底、代码块/表格被分页截断 */
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; break-after: avoid; }
  pre, table, img, blockquote { page-break-inside: avoid; break-inside: avoid; }
</style>
</head>
<body>
  <div class="prose-note">${innerHtml}</div>
</body>
</html>`;
  }

  /**
   * 导出当前笔记为 PDF。
   * 流程：
   *   1. 接收渲染进程传来的 Markdown 渲染后 HTML 片段（与预览 1:1 一致）
   *   2. 构造完整 HTML 文档（含 prose-note 样式 + 打印分页优化），写入临时文件
   *   3. 创建隐藏 BrowserWindow 加载该文件，等待字体就绪
   *   4. webContents.printToPDF 得到纯净 PDF（只含笔记文本，不含侧边栏/AI 面板等应用 UI）
   *   5. 校验 PDF 头部、写入用户选择路径，销毁 print 窗口并清理临时文件
   *
   * 设计要点：
   *   - 不再打印主窗口整个 webContents（会包含侧边栏、AI 面板等 UI，是"截屏式"PDF）
   *   - 独立 print 窗口加载纯净 HTML，PDF 文本可选可复制，与所见预览内容一致
   *   - Electron 的 printToPDF 不遵守 @media print 规则（issue #20927），故不能用 CSS 隐藏元素方案
   */
  ipcMain.handle(
    IPC_CHANNELS.NOTES_EXPORT_PDF,
    async (
      _e,
      payload: { defaultName: string; html: string }
    ): Promise<{ success: boolean; canceled: boolean; path?: string; error?: string }> => {
      const fs = await import('node:fs/promises');
      // 用主窗口作为保存对话框的父窗口（modal），独立 print 窗口不显示
      const parentWin = WindowManager.shared.getMainWindow();
      const escapeHtml = (s: string): string =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

      let printWin: BrowserWindow | null = null;
      let tmpHtmlPath: string | null = null;
      try {
        const rawName = (payload.defaultName || '未命名记事').trim() || '未命名记事';
        // 文件名非法字符替换为下划线；HTML 转义后的版本用于页脚，避免注入与渲染异常
        const cleanName = rawName.replace(/[\\/:*?"<>|\s]+/g, '_') || '未命名记事';
        const footerName = escapeHtml(rawName);
        // 强制把 defaultPath 落到 Downloads 目录：macOS 对 Documents 根有沙箱 EPERM 限制，
        // 而 Downloads 目录在 Electron 下是权限最宽松且用户预期下载到的位置。
        const defaultPath = path.join(app.getPath('downloads'), `${cleanName}.pdf`);
        const dialogOptions: SaveDialogOptions = {
          title: '导出为 PDF',
          defaultPath,
          filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
          properties: ['createDirectory']
        };
        const saveResult =
          parentWin && !parentWin.isDestroyed()
            ? await dialog.showSaveDialog(parentWin, dialogOptions)
            : await dialog.showSaveDialog(dialogOptions);
        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, canceled: true };
        }

        // 构造完整 HTML 文档：prose-note 样式 + 打印分页优化，确保 PDF 与预览 1:1
        const htmlDoc = buildPrintHtml(payload.html);
        tmpHtmlPath = path.join(app.getPath('temp'), `smart-notepad-export-${Date.now()}.html`);
        await fs.writeFile(tmpHtmlPath, htmlDoc, 'utf8');

        // 创建隐藏 print 窗口：sandbox + contextIsolation + 关闭 nodeIntegration，最小化攻击面
        printWin = new BrowserWindow({
          show: false,
          width: 1200,
          height: 1600,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        await printWin.loadFile(tmpHtmlPath);
        // 等待字体就绪，避免 PDF 中文字体回退成方框
        await printWin.webContents.executeJavaScript(
          `Promise.race([
            (document.fonts && document.fonts.ready) || Promise.resolve(),
            new Promise((r) => setTimeout(r, 1500))
          ])`
        );

        // printToPDF：margins 单位是 inches，1cm ≈ 0.3937"
        // 设计目标：上下 1.8cm = 0.7087"，左右 1.6cm = 0.6299"
        const pdfData = await printWin.webContents.printToPDF({
          margins: {
            marginType: 'custom',
            top: 0.71,
            bottom: 0.71,
            left: 0.63,
            right: 0.63
          },
          pageSize: 'A4',
          printBackground: true,
          preferCSSPageSize: false,
          displayHeaderFooter: true,
          headerTemplate:
            '<div style="font-size:10px;color:#666;width:100%;text-align:center;margin-top:6px;"></div>',
          footerTemplate:
            `<div style="font-size:10px;color:#999;width:100%;display:flex;justify-content:space-between;padding:0 20px;">` +
            `<span>${footerName}</span>` +
            `<span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span>` +
            `</div>`
        });

        // 关键修复：Electron 23+ 起 printToPDF 运行时实际返回 Uint8Array（而非类型签名标注的 Buffer）。
        // 若直接将 Uint8Array 传给 fs.writeFile，在 Node 的某些处理路径下会按 UTF-8 字符串解码，
        // 导致 PDF 二进制头部（%PDF-1.x）中的非 ASCII 字节被替换或截断，文件即损坏、打开后是乱码。
        // 用 Buffer.from 显式包装为 Node Buffer，强制按二进制写入，杜绝此类编码损伤。
        const pdfBuffer = Buffer.from(
          pdfData instanceof Buffer ? pdfData : new Uint8Array(pdfData)
        );
        // 有效性校验：PDF 头部必为 "%PDF-"，否则视为渲染异常，避免把空数据/错误页当成成功导出
        if (pdfBuffer.length < 8 || pdfBuffer.slice(0, 5).toString('latin1') !== '%PDF-') {
          console.error(
            '[ipc] notes.exportPdf: 生成的数据不是有效 PDF，长度=',
            pdfBuffer.length,
            '头部=',
            pdfBuffer.slice(0, 16).toString('latin1')
          );
          return {
            success: false,
            canceled: false,
            error: 'PDF 数据无效，请重试或检查预览内容是否正常'
          };
        }
        await fs.writeFile(saveResult.filePath, pdfBuffer);
        return { success: true, canceled: false, path: saveResult.filePath };
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        console.error('[ipc] notes.exportPdf error:', e);
        return { success: false, canceled: false, error: msg };
      } finally {
        // 销毁 print 窗口并清理临时 HTML 文件，避免残留
        if (printWin && !printWin.isDestroyed()) {
          printWin.destroy();
        }
        if (tmpHtmlPath) {
          fs.unlink(tmpHtmlPath).catch(() => {});
        }
      }
    }
  );

  // ---------- folders ----------
  ipcMain.handle(IPC_CHANNELS.FOLDERS_LIST, (): Folder[] => {
    try {
      return FolderRepository.list();
    } catch (e) {
      console.error('[ipc] folders.list error:', e);
      return [];
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_CREATE,
    (_e, input: { name: string; parent_id: string | null }): Folder => {
      try {
        return FolderRepository.create(input);
      } catch (e) {
        console.error('[ipc] folders.create error:', e);
        throw e;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_RENAME,
    (_e, id: string, name: string): Folder | null => {
      try {
        return FolderRepository.rename(id, name);
      } catch (e) {
        console.error('[ipc] folders.rename error:', e);
        return null;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_DELETE,
    (_e, id: string): { deletedNoteCount: number } => {
      try {
        return FolderRepository.remove(id);
      } catch (e) {
        console.error('[ipc] folders.delete error:', e);
        return { deletedNoteCount: 0 };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_MOVE,
    (_e, id: string, newParentId: string | null): Folder | null => {
      // move 会抛错（循环检测 / 目标不存在），throw 让前端 catch 获取错误信息做 toast
      try {
        return FolderRepository.move(id, newParentId);
      } catch (e) {
        console.error('[ipc] folders.move error:', e);
        throw e;
      }
    }
  );

  // ---------- attachments ----------
  ipcMain.handle(
    IPC_CHANNELS.ATTACHMENTS_LIST,
    (_e, noteId: string) => AttachmentRepository.listByNote(noteId)
  );

  ipcMain.handle(
    IPC_CHANNELS.ATTACHMENTS_UPLOAD,
    async (
      _e,
      input: {
        noteId: string;
        originalName: string;
        mimeType: string;
        base64?: string;
        uint8?: number[];
      }
    ) => {
      try {
        // base64 优先（通常是 FileReader.readAsDataURL 后切出的纯 body）
        let buffer: Uint8Array | undefined;
        if (input.base64) {
          const body = input.base64.includes(',')
            ? input.base64.split(',')[1]
            : input.base64;
          buffer = Uint8Array.from(Buffer.from(body, 'base64'));
        } else if (Array.isArray(input.uint8)) {
          buffer = Uint8Array.from(input.uint8);
        }
        return AttachmentRepository.create({
          noteId: input.noteId,
          originalName: input.originalName,
          mimeType: input.mimeType,
          buffer
        });
      } catch (e) {
        console.error('[ipc] attachments.upload error:', e);
        throw e;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ATTACHMENTS_GET,
    async (_e, id: string) => {
      const fs = await import('node:fs/promises');
      const { attachment, absolutePath } = getAttachmentPathOrThrow(id);
      const raw = await fs.readFile(absolutePath);
      const base64 = raw.toString('base64');
      return { attachment, base64 };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ATTACHMENTS_DOWNLOAD,
    async (
      _e,
      id: string
    ): Promise<{ success: boolean; canceled: boolean; path?: string; error?: string }> => {
      const fs = await import('node:fs/promises');
      try {
        const { attachment, absolutePath } = getAttachmentPathOrThrow(id);
        const win = WindowManager.shared.getMainWindow();
        const safeWin = win && !win.isDestroyed() ? (win as BrowserWindow) : null;
        const ext = path.extname(attachment.original_name || '').slice(1);
        const filters: { name: string; extensions: string[] }[] = [];
        if (ext) {
          filters.push({
            name: `${ext.toUpperCase()} 文件`,
            extensions: [ext.replace(/[^a-zA-Z0-9]/g, '')]
          });
        }
        const defaultPath = path.join(app.getPath('downloads'), attachment.original_name || '未命名附件');
        const result = await dialog.showSaveDialog(safeWin as BrowserWindow, {
          title: '下载附件',
          defaultPath,
          ...(filters.length ? { filters } : {}),
          properties: ['createDirectory']
        });
        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }
        await fs.copyFile(absolutePath, result.filePath);
        return { success: true, canceled: false, path: result.filePath };
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        console.error('[ipc] attachments.download error:', e);
        return { success: false, canceled: false, error: msg };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.ATTACHMENTS_DELETE, (_e, id: string) => {
    try {
      return AttachmentRepository.remove(id);
    } catch (e) {
      console.error('[ipc] attachments.delete error:', e);
      return false;
    }
  });

  // ---- 用系统默认应用打开附件 ----
  // 先把附件 base64 落到临时目录（保留原始文件名），再调 shell.openPath 交给 PowerPoint/WPS/Keynote 等处理。
  ipcMain.handle(
    IPC_CHANNELS.ATTACHMENTS_OPEN_DEFAULT,
    async (
      _e,
      id: string
    ): Promise<{ success: boolean; canceled?: boolean; error?: string }> => {
      try {
        const { attachment, absolutePath } = getAttachmentPathOrThrow(id);
        // getAttachmentPathOrThrow 已负责把附件写到 attachments/ 目录下并返回绝对路径，
        // 这里直接调用 Electron 的 shell.openPath 打开（由系统决定用什么应用）
        const openErr = await shell.openPath(absolutePath);
        if (openErr) {
          console.error('[ipc] attachments.openDefault shell.openPath error:', openErr);
          return {
            success: false,
            error: `无法打开「${attachment.original_name}」：系统未安装可处理该文件类型的应用，请先安装对应软件`
          };
        }
        return { success: true };
      } catch (e) {
        console.error('[ipc] attachments.openDefault error:', e);
        return {
          success: false,
          error: e instanceof Error ? e.message : '打开失败'
        };
      }
    }
  );

  // ---- kkFileView 在线预览准备 ----
  // 方案对齐同级项目 nature_and_humanity / chat_assistant_agent：
  //   1. 容器名固定为 `kkfileview`；不存在就 docker run -d --name kkfileview ... --add-host=host.docker.internal:host-gateway -v <宿主机attachments根>:/opt/smart_notepad_attachments
  //   2. 不再 docker cp 注入文件：宿主机 attachments/ 目录已直接 volume 映射进容器内的 /opt/smart_notepad_attachments，0 拷贝可读
  //   3. 传参：file:///opt/smart_notepad_attachments/<note_id>/<uuid>.<ext>  → Buffer.from(...,'utf8').toString('base64') → encodeURIComponent → ?url=
  //   4. trust 配置：容器创建/启动后自动删除 application.properties 中的 trust.host/trust.dir 行（让 TrustHostSet 为空 → 放行 file://）
  ipcMain.handle(
    IPC_CHANNELS.ATTACHMENTS_PREPARE_KKVIEW,
    async (
      _e,
      id: string
    ): Promise<{ success: boolean; previewUrl?: string; error?: string }> => {
      try {
        // 1. kkFileView 健康检查 + 自动 docker daemon 拉起 + 容器创建/启动/旧容器重建
        const kkPort = await KkFileViewService.ensureReady({ port: KKFILEVIEW_DEFAULT_PORT });

        // 2. 拿宿主机真实磁盘路径（包含路径穿越防御 + note_id 白名单校验）
        const { attachment, absolutePath: hostAbsolutePath } = getAttachmentPathOrThrow(id);

        // 3. 拼容器内 file:/// URL（基于 volume 映射 /opt/smart_notepad_attachments/...）
        const containerFileUri = KkFileViewService.hostAttachmentPathToContainerUri(hostAbsolutePath);

        // 4. 组装 onlinePreview URL（和 nature_and_humanity/api/src/routes/rag.ts:L93-L95 完全一致：utf8→base64→encodeURIComponent）
        const fileUrlBase64 = Buffer.from(containerFileUri, 'utf-8').toString('base64');
        const previewUrl = `http://127.0.0.1:${kkPort}/onlinePreview?url=${encodeURIComponent(fileUrlBase64)}`;
        console.log(
          `[ipc] attachments.prepareKkView id=${id} kkPort=${kkPort} original=${JSON.stringify(attachment.original_name)}\n` +
          `  -> 宿主机文件:                ${hostAbsolutePath}\n` +
          `  -> 容器内映射 file:// URL:    ${containerFileUri}\n` +
          `  -> file:// URL base64:        ${fileUrlBase64}\n` +
          `  -> iframe 打开的预览 URL:     ${previewUrl}`
        );
        return { success: true, previewUrl };
      } catch (e) {
        console.error('[ipc] attachments.prepareKkView error:', e);
        return {
          success: false,
          error: e instanceof Error ? e.message : 'kkFileView 启动失败'
        };
      }
    }
  );

  // ---------- settings ----------
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET,
    <K extends SettingsKey>(_e: unknown, key: K): SettingsMap[K] | undefined =>
      SettingsRepository.get(key)
  );

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, <K extends SettingsKey>(
    _e: unknown,
    key: K,
    value: SettingsMap[K]
  ) => {
    SettingsRepository.set(key, value);
  });

  // ---------- main window controls ----------
  ipcMain.handle(IPC_CHANNELS.WIN_MIN_MAIN, () => {
    const w = WindowManager.shared.getMainWindow();
    if (w) w.minimize();
  });
  ipcMain.handle(IPC_CHANNELS.WIN_MAX_MAIN, (): boolean => {
    const w = WindowManager.shared.getMainWindow();
    if (!w) return false;
    if (w.isMaximized()) {
      w.unmaximize();
      return false;
    }
    w.maximize();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.WIN_CLOSE_MAIN, () => {
    const w = WindowManager.shared.getMainWindow();
    if (w && !w.isDestroyed()) w.close();
  });

  // 渲染进程对 dirty 询问的回应（三选一）- 旧版 on 兼容
  ipcMain.on(IPC_CHANNELS.WIN_CLOSE_BEFORE_CHECK, (_e, action: 'save' | 'discard' | 'cancel') => {
    WindowManager.shared.resolveCloseBefore(action);
  });

  // 新版：渲染进程通过 invoke 回应 dirty 询问
  ipcMain.handle(IPC_CHANNELS.WIN_RESPOND_CLOSE_BEFORE, (_e, action: 'save' | 'discard' | 'cancel') => {
    WindowManager.shared.resolveCloseBefore(action);
  });

  // 渲染进程执行完保存动作后允许关闭主窗口（invoke 版本）
  ipcMain.handle(IPC_CHANNELS.WIN_ALLOW_CLOSE, () => {
    const w = WindowManager.shared.getMainWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('__main:allowClose');
    }
  });

  // 渲染进程执行完保存动作后允许关闭主窗口（on 版本，兼容旧逻辑）
  ipcMain.on('__main:allowClose', () => {
    /* handled in WindowManager by once('__main:allowClose') */
  });

  // ---------- Ollama service management ----------
  // 业务实现见 services/OllamaService.ts，IPC 层仅做薄路由
  ipcMain.handle(IPC_CHANNELS.OLLAMA_STATUS, () => OllamaService.getStatus());
  ipcMain.handle(IPC_CHANNELS.OLLAMA_START, () => OllamaService.start());

  // ---------- chat persistence ----------
  ipcMain.handle(IPC_CHANNELS.CHAT_LIST_SESSIONS, (_e, noteId: string) => {
    try {
      const sessions = ChatRepository.listSessionsForNote(noteId);
      const activeSessionId = ChatRepository.getActiveSessionId(noteId);
      return { sessions, activeSessionId };
    } catch (e) {
      console.error('[ipc] chat.listSessions error:', e);
      return { sessions: [], activeSessionId: null };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_UPSERT_SESSION, (_e, session: ChatSession) => {
    try {
      return ChatRepository.upsertSession(session);
    } catch (e) {
      console.error('[ipc] chat.upsertSession error:', e);
      throw e;
    }
  });

  ipcMain.handle(IPC_CHANNELS.CHAT_DELETE_SESSION, (_e, id: string) => {
    try {
      return ChatRepository.deleteSession(id);
    } catch (e) {
      console.error('[ipc] chat.deleteSession error:', e);
      return false;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.CHAT_REPLACE_ALL_FOR_NOTE,
    (_e, noteId: string, sessions: ChatSession[], activeSessionId: string | null) => {
      try {
        ChatRepository.replaceAllForNote(noteId, sessions, activeSessionId);
      } catch (e) {
        console.error('[ipc] chat.replaceAllForNote error:', e);
        throw e;
      }
    }
  );
}
