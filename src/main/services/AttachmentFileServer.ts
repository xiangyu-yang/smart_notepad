import * as http from 'node:http';
import * as fs from 'node:fs';
import { AddressInfo } from 'node:net';
import * as querystring from 'node:querystring';
import { getAttachmentPathOrThrow } from '../db/repositories/AttachmentRepository';
import { deriveMimeFromName } from '../../shared/mime-utils';

/**
 * 为 kkFileView 提供的本地临时 HTTP 文件服务器。
 *
 * kkFileView 的 onlinePreview 机制要求传入一个公网/内网可访问的 URL（?url=...），
 * 它会从该 URL 拉取文件内容做转码。kkFileView 运行在 docker 容器内，需要访问宿主机，
 * 因此本服务**绑定 0.0.0.0 + 自动端口**（docker 内通过 host.docker.internal 访问），
 * 端口仅在本地防火墙内可见，不暴露到公网。
 *
 * 主进程对该服务做懒启动：第一次调用 `attachments.prepareKkView` 时才启动，
 * 应用退出/主窗口关闭时自动关闭。
 */
export class AttachmentFileServer {
  private static _server: http.Server | null = null;
  private static _port: number | null = null;

  /**
   * 保证服务器已启动并返回端口号。单例。
   */
  static async ensureListening(bindHost = '0.0.0.0'): Promise<number> {
    if (this._server && this._port != null) return this._port;
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        // 不等待 handler 的 Promise，直接让它在微任务中收尾；错误由内部捕获
        this.handle(req, res).catch((e) => {
          console.error('[AttachmentFileServer] handle unhandled:', e);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          }
          if (!res.writableEnded) res.end('Internal Server Error');
        });
      });
      // 端口 0 = 操作系统自动分配空闲端口
      server.listen(0, bindHost, () => {
        const addr = server.address() as AddressInfo;
        this._server = server;
        this._port = addr.port;
        console.log(`[AttachmentFileServer] listening on ${bindHost}:${addr.port}`);
        resolve(addr.port);
      });
      server.on('error', (e) => {
        console.error('[AttachmentFileServer] error:', e);
        reject(e);
      });
    });
  }

  /** 返回当前端口（未启动抛错，上层应先 ensureListening） */
  static get port(): number {
    if (this._port == null) throw new Error('AttachmentFileServer not started');
    return this._port;
  }

  static async shutdown(): Promise<void> {
    const s = this._server;
    this._server = null;
    this._port = null;
    if (s) return new Promise<void>((resolve) => s.close(() => resolve()));
  }

  /**
   * HTTP 路由（单端点）：
   *   GET /file/:id                            → 按附件 id 返回二进制流（含 Content-Disposition 头保留文件名）
   *   GET /                                   → 健康检查（200 ok）
   *   其他                                     → 404
   *
   * kkFileView 通过 URL 拉流时要求响应头包含正确的 Content-Type 与 Content-Disposition，
   * 否则它会按 URL 后缀推断格式，容易误判。
   * 实际文件内容由 getAttachmentPathOrThrow 负责从 DB base64 解出并落到 attachments/ 目录，
   * 这里直接读已落盘的真实文件，避免重复 decode。
   */
  private static async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startAt = Date.now();
    const peer = req.socket.remoteAddress;
    const reqDesc = `${req.method} ${req.url}`;
    try {
      const url = req.url || '/';
      // 健康检查（忽略日志，避免刷屏）
      if (url === '/' || url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
      }

      // 同时兼容两种 URL：
      //   /file/<uuid>                     ← 向后兼容
      //   /file/<uuid>/原始文件名.pptx      ← 给 kkFileView 识别格式用（必须保留扩展名）
      const match = url.match(/^\/file\/([^/?#]+?)(?:\/[^/?#]*)?(?:[?#].*)?$/);
      if (!match) {
        console.log(`[AttachmentFileServer] ${reqDesc} <- ${peer} | 404 (${Date.now() - startAt}ms)`);
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const id = querystring.unescape(match[1]);
      const { attachment, absolutePath } = getAttachmentPathOrThrow(id);
      const stat = await fs.promises.stat(absolutePath);
      const mime = attachment.mime_type || deriveMimeFromName(attachment.original_name) || 'application/octet-stream';
      const encodedName = encodeURIComponent(attachment.original_name).replace(/['()]/g, escape);
      const safeName = attachment.original_name.replace(/[^\x20-\x7E]/g, '_');
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`
      });
      // 流式 pipe，不一次性加载到内存，避免大附件 OOM
      const stream = fs.createReadStream(absolutePath);
      stream.on('error', (err) => {
        console.error(`[AttachmentFileServer] ${reqDesc} <- ${peer} | read stream error:`, err);
        if (!res.headersSent) res.writeHead(500);
        if (!res.writableEnded) res.end('Read Error');
      });
      stream.on('end', () => {
        console.log(`[AttachmentFileServer] ${reqDesc} <- ${peer} | 200 size=${stat.size} name=${JSON.stringify(attachment.original_name)} (${Date.now() - startAt}ms)`);
      });
      stream.pipe(res);
    } catch (e) {
      console.error(`[AttachmentFileServer] ${reqDesc} <- ${peer} | 500 (${Date.now() - startAt}ms):`, e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (!res.writableEnded) res.end(e instanceof Error ? e.message : 'Internal Server Error');
    }
  }
}
