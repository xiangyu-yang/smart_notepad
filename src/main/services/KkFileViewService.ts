import * as childProcess from 'node:child_process';
import * as util from 'node:util';
import * as http from 'node:http';
import * as path from 'node:path';
import os from 'node:os';
import { getAttachmentsStorageRoot } from '../db/repositories/AttachmentRepository';

const exec = util.promisify(childProcess.exec);

/** kkFileView 默认 HTTP 端口（和 chat_assistant_agent / nature_and_humanity 对齐：8012） */
export const KKFILEVIEW_DEFAULT_PORT = 8012;
/** kkFileView 官方稳定版镜像（和同级项目完全对齐） */
export const KKFILEVIEW_IMAGE = 'keking/kkfileview:4.1.0';
/** 容器名（固定，方便 docker ps / docker rm / start 定位；和 chat_assistant_agent 对齐） */
export const KKFILEVIEW_CONTAINER_NAME = 'kkfileview';
/** kkFileView HTTP 健康检查最大等待次数（每次间隔 1s，约 30s 兜底） */
const HEALTH_MAX_RETRIES = 30;
/** Docker daemon 就绪轮询最大次数（Docker Desktop 冷启动通常 20-60s，给到 120s 容错） */
const DOCKER_DAEMON_MAX_RETRIES = 120;
/** 容器内 smart_notepad attachments 挂载点（固定路径，避免跨版本探测） */
export const KK_CONTAINER_ATTACHMENTS_DIR = '/opt/smart_notepad_attachments';

export interface KkViewEnsureOptions {
  /** kkFileView 对外暴露端口，默认 8012 */
  port?: number;
}

/**
 * kkFileView（docker）生命周期封装。
 *
 * 完全对齐同级项目：
 *   - nature_and_humanity/api/src/ai/kkfileview.ts
 *   - chat_assistant_agent/src/services/kkfileview_service.py
 *
 * 关键约定：
 *   1. 固定容器名 `kkfileview`，不存在就 `docker run` 新建（不要求用户预先手动创建）
 *   2. trust 配置：容器创建/启动后自动删除 application.properties 中的 trust.host/trust.dir 行，
 *      让 TrustHostSet 为空 → TrustHostFilter.isEmpty() → 放行所有请求（含 file://）。
 *      （反编译 TrustHostFilter 确认：trust.host="*" 会被解析为 Set{"*"}，但 file:// 的 host 为
 *      空字符串，Set.contains("") 为 false → 被拦截。只有删除该行让 Set 为空才能放行。）
 *   3. 宿主机 ATTACHMENTS_ROOT 通过 volume `-v` 映射到容器内 KK_CONTAINER_ATTACHMENTS_DIR，
 *      附件文件 0 拷贝直接被 kkFileView 读，也绕开 host.docker.internal IP 脏缓存的 HTTP 下载不稳定
 *   4. onlinePreview?url= 入参：`BASE64("file://<容器内映射路径>")`，再 encodeURIComponent 一层（和 nature_and_humanity rag.ts 一致）
 */
export class KkFileViewService {
  /**
   * 找到 kkFileView 容器的 ID（基于容器名 kkfileview 精确匹配，任意状态均可）。
   * 找不到返回 null。供上层「拼接容器内 file:// 路径」复用。
   */
  static async findContainerId(): Promise<string | null> {
    try {
      const { stdout } = await exec(
        `docker ps -a --format '{{.ID}}' --filter "name=^/${KKFILEVIEW_CONTAINER_NAME}$"`,
        { timeout: 10000 }
      );
      const id = stdout.trim();
      return id || null;
    } catch {
      return null;
    }
  }

  /**
   * 确保 kkFileView 可用，返回 HTTP 端口。
   * 任何一步失败都抛错，上层把错误消息转递给 UI toast。
   *
   * 和 nature_and_humanity ensureKkFileViewAvailable 行为对齐：
   *   - 先查 Docker daemon → macOS 未启动自动 open -a Docker 并等待 120s
   *   - 容器不存在：docker run 新建（固定 name + port + env + volume + add-host）
   *   - 容器存在但 stopped：docker start
   *   - running：轮询 /index 健康检查通过就直接返回
   */
  static async ensureReady(opts: KkViewEnsureOptions = {}): Promise<number> {
    const port = opts.port ?? KKFILEVIEW_DEFAULT_PORT;

    // 1. daemon 就绪（macOS 自动拉起 Docker Desktop）
    await this.ensureDockerDaemon();

    // 2. 容器生命周期：不存在就新建，否则按状态处理
    //    startOrCreateContainer 内部会自动修补 trust 配置（删除 trust.host 行）
    await this.startOrCreateContainer(port);

    // 3. 健康检查轮询（首次 docker run 通常 10~20s；修补 trust 后的 restart 也走这里）
    for (let i = 0; i < HEALTH_MAX_RETRIES; i++) {
      await this.sleep(1000);
      if (await this.httpHealthy(port)) {
        return port;
      }
    }
    throw new Error(`kkFileView 启动超时：端口 ${port} 仍不可访问（${HEALTH_MAX_RETRIES}s），请手动检查容器日志`);
  }

  /**
   * 把「宿主机 attachments/ 下的文件绝对路径」转换为 kkFileView 容器内能直接访问的 file:/// URL。
   *
   * 前提：ATTACHMENTS_ROOT 已经通过 volume 映射到容器内的 KK_CONTAINER_ATTACHMENTS_DIR（docker run -v）。
   * 返回值直接可以：Buffer.from(containerFileUri, 'utf8').toString('base64') → encodeURIComponent → onlinePreview?url=
   */
  static hostAttachmentPathToContainerUri(hostAbsolutePath: string): string {
    const attachmentsRoot = getAttachmentsStorageRoot();
    const normalizedHostRoot = attachmentsRoot.endsWith(path.sep)
      ? attachmentsRoot.slice(0, -1)
      : attachmentsRoot;
    // 先规范化路径分隔符（macOS 上 path.sep='/'，但卷映射都是 '/'，这里直接确保）
    const hostAbs = path.normalize(hostAbsolutePath);
    if (!hostAbs.startsWith(normalizedHostRoot + path.sep) && hostAbs !== normalizedHostRoot) {
      throw new Error(
        `附件路径不在 attachments 存储根目录内：${hostAbsolutePath} (root=${normalizedHostRoot})，` +
        `无法映射到 kkFileView 容器内路径`
      );
    }
    const relFromRoot = hostAbs.slice(normalizedHostRoot.length).split(path.sep).filter(Boolean).join('/');
    return `file://${KK_CONTAINER_ATTACHMENTS_DIR}/${relFromRoot}`;
  }

  /**
   * 确保 Docker daemon 已就绪。
   * - 直接 `docker version` 能拿到 Server version：直接返回
   * - macOS + daemon 不可达：`open -a Docker` 启动 Docker Desktop，随后轮询等待就绪（最长 120s）
   * - 其他系统或启动失败：抛错给用户引导手动处理
   */
  private static async ensureDockerDaemon(): Promise<void> {
    // 先试一次，避免已经在跑的情况
    try {
      await exec('docker version --format {{.Server.Version}}', { timeout: 5000 });
      return;
    } catch {
      // 走到这里说明 daemon 没起来
    }

    const isMac = process.platform === 'darwin';
    if (!isMac) {
      throw new Error(
        'Docker daemon 不可用：请先启动 Docker Desktop / docker daemon，或改用「用本地应用打开」'
      );
    }

    // macOS：调用系统 `open -a Docker` 启动 Docker Desktop（不阻塞、无输出）
    try {
      await exec('open -a Docker', { timeout: 10000 });
    } catch (e) {
      throw new Error(
        `尝试启动 Docker Desktop 失败（${e instanceof Error ? e.message : String(e)}），请手动在启动台打开 Docker`
      );
    }

    // 然后轮询 docker version 直到成功（最长 120s）
    for (let i = 0; i < DOCKER_DAEMON_MAX_RETRIES; i++) {
      await this.sleep(1000);
      try {
        await exec('docker version --format {{.Server.Version}}', { timeout: 5000 });
        return;
      } catch {
        // 继续等
      }
    }
    throw new Error(
      `Docker Desktop 启动超时（${DOCKER_DAEMON_MAX_RETRIES}s），请在 Docker Desktop 界面确认引擎状态后重试，或改用「用本地应用打开」`
    );
  }

  /**
   * 创建或启动固定容器名 `kkfileview` 的容器。
   *
   * 环境变量名必须严格对齐 application.properties 里的 ${KK_...} 占位符（已从容器内 grep 出）：
   *   server.port              = ${KK_SERVER_PORT:8012}
   *   file.dir                 = ${KK_FILE_DIR:default}
   *   local.preview.dir        = ${KK_LOCAL_PREVIEW_DIR:default}
   *   trust.host               = ${KK_TRUST_HOST:default}
   *
   * ⚠️ trust.host 关键问题（已解决）：
   *   kkFileView 4.1.0 原始 application.properties 第56行自带 `trust.host = ${KK_TRUST_HOST:default}`。
   *   无论设不设 KK_TRUST_HOST 环境变量，trust.host 都会有值（"*" 或 "default"），
   *   导致 TrustHostFilter 的 trustHostSet 不为空。而 file:// 协议的 URL host 为空字符串，
   *   Set.contains("") 为 false（精确匹配，"*" ≠ ""），从而被拦截返回"不受信任"错误页。
   *
   *   修复：在容器创建/启动后，用 sed 删除 application.properties 中的 trust.host 和 trust.dir 行，
   *   让 trustHostSet 为空 → TrustHostFilter.isEmpty() 为 true → 放行所有请求（含 file://）。
   *   这与 chat_assistant_agent 的成功行为一致（该项目不设任何 trust 环境变量也能工作，
   *   实际上是因为 trust.host 解析为 "default" 但... 不，只有删除该行才真正解决 file:// 拦截）。
   *
   * 核心原则：
   *   - KK_FILE_DIR=<挂载点>            → 设置 kkFileView 工作目录 = 附件挂载点
   *   - KK_LOCAL_PREVIEW_DIR=<挂载点>   → 设置本地预览根目录
   *   - KK_OFFICE_PREVIEW_TYPE=pdf      → Office 转 PDF 再展示（稳定）
   *   - --add-host=host.docker.internal:host-gateway → 修正容器内宿主机别名解析
   */
  private static async startOrCreateContainer(port: number): Promise<void> {
    // 1. 查容器是否存在（任意状态）
    const cid = await this.findContainerId();

    // 2. 不存在 → docker run 新建
    if (!cid) {
      const volSrc = getAttachmentsStorageRoot();
      const volDst = KK_CONTAINER_ATTACHMENTS_DIR;
      const cmdArray: string[] = [
        'docker', 'run', '-d',
        '--name', KKFILEVIEW_CONTAINER_NAME,
        '-p', `${port}:8012`,
        '-e', `KK_SERVER_PORT=${port}`,
        '-e', `KK_FILE_DIR=${volDst}`,
        '-e', `KK_LOCAL_PREVIEW_DIR=${volDst}`,
        '-e', 'KK_OFFICE_PREVIEW_TYPE=pdf',
        '--add-host', 'host.docker.internal:host-gateway',
        '-v', `${volSrc}:${volDst}`,
        '--restart=unless-stopped',
        KKFILEVIEW_IMAGE
      ];
      const cmdStr = cmdArray.map((s) =>
        /[^\w@%+=:,./-]/.test(s) ? `'${s.replace(/'/g, "'\\''")}'` : s
      ).join(' ');
      console.log(`[KkFileViewService] 未找到 kkfileview 容器，首次创建：\n    ${cmdStr}`);
      try {
        await exec(cmdStr, { timeout: 240000 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/image not found|manifest for .* not found|pull access denied/i.test(msg)) {
          throw new Error(
            `拉取 kkFileView 镜像失败（${msg}）。请先手动执行：\n` +
            `  docker pull ${KKFILEVIEW_IMAGE}\n` +
            `完成后重新点击预览，或改用「用本地应用打开」`
          );
        }
        throw new Error(`创建 kkFileView 容器失败：${msg}`);
      }
      // 新容器创建后，修补 trust 配置（删除 trust.host 行 + restart）
      await this.ensureTrustConfigPatched();
      return;
    }

    // 3. 容器存在 → 看状态
    let state = 'unknown';
    try {
      const { stdout } = await exec(
        `docker inspect --format '{{.State.Status}}' ${cid}`,
        { timeout: 10000 }
      );
      state = stdout.trim();
    } catch (e) {
      throw new Error(`查询 kkFileView 容器状态失败：${e instanceof Error ? e.message : String(e)}`);
    }

    switch (state) {
      case 'running': {
        const volumeOk = await this.containerHasAttachmentsVolume(cid);
        const hasOldTrustEnv = await this.containerHasOldTrustEnv(cid);

        if (volumeOk && !hasOldTrustEnv) {
          // 配置正确，仅检查 trust 配置是否已修补
          await this.ensureTrustConfigPatched();
          return;
        }

        // 配置不对 → 重建
        const reasons: string[] = [];
        if (!volumeOk) reasons.push('volume 配置不对');
        if (hasOldTrustEnv) reasons.push('容器含旧 KK_TRUST_HOST 环境变量');
        console.log(
          `[KkFileViewService] 现有 kkfileview 容器需要重建（${reasons.join(' + ')}），` +
          `附件文件保留在宿主机 ${getAttachmentsStorageRoot()}，不会丢失...`
        );
        try {
          await exec(`docker rm -f ${cid}`, { timeout: 20000 });
        } catch (e) {
          throw new Error(`移除旧 kkFileView 容器失败：${e instanceof Error ? e.message : String(e)}`);
        }
        await this.startOrCreateContainer(port);
        return;
      }
      case 'exited':
      case 'created':
      case 'stopped':
      case 'paused':
      case 'dead': {
        try {
          await exec(`docker start ${cid}`, { timeout: 20000 });
        } catch (e) {
          throw new Error(`docker start 失败：${e instanceof Error ? e.message : String(e)}`);
        }
        // 等待容器进入 running 状态后检查配置
        await this.sleep(2000);
        const v = await this.containerHasAttachmentsVolume(cid);
        const t = await this.containerHasOldTrustEnv(cid);
        if (!v || t) {
          const reasons: string[] = [];
          if (!v) reasons.push('volume 配置不对');
          if (t) reasons.push('容器含旧 KK_TRUST_HOST 环境变量');
          console.log(
            `[KkFileViewService] 重启后的 kkfileview 容器需要重建（${reasons.join(' + ')}），正在重建...`
          );
          try {
            await exec(`docker rm -f ${cid}`, { timeout: 20000 });
          } catch (err) {
            throw new Error(`移除旧 kkFileView 容器失败：${err instanceof Error ? err.message : String(err)}`);
          }
          await this.startOrCreateContainer(port);
          return;
        }
        // 检查 trust 配置
        await this.ensureTrustConfigPatched();
        return;
      }
      default:
        throw new Error(`kkFileView 容器处于未知状态「${state}」，请手动处理`);
    }
  }

  /**
   * 检查容器 Binds 里是否已经把宿主机 ATTACHMENTS_ROOT 映射到 KK_CONTAINER_ATTACHMENTS_DIR。
   * 对我们之前那版"没有 -v 启动、靠 docker cp"的老容器会返回 false，触发重建。
   */
  private static async containerHasAttachmentsVolume(cid: string): Promise<boolean> {
    try {
      const { stdout } = await exec(
        `docker inspect --format '{{json .Mounts}}' ${cid}`,
        { timeout: 10000 }
      );
      const mounts: Array<{ Source?: string; Destination?: string; Type?: string }> = JSON.parse(
        stdout.trim() || '[]'
      );
      const wantSource = getAttachmentsStorageRoot();
      const wantDest = KK_CONTAINER_ATTACHMENTS_DIR;
      return mounts.some((m) => {
        if (!m.Source || !m.Destination || m.Type !== 'bind') return false;
        const srcEq = this.pathEqualOnMac(m.Source, wantSource);
        const dstEq = m.Destination.replace(/\/+$/, '') === wantDest.replace(/\/+$/, '');
        return srcEq && dstEq;
      });
    } catch {
      return false;
    }
  }

  /**
   * 检查容器是否包含旧的 KK_TRUST_HOST 环境变量（需要重建容器）。
   * 旧容器用 -e KK_TRUST_HOST=* 创建，该环境变量无法通过 restart 移除，
   * 会导致 application.properties 中 trust.host 被 Spring 注入值，
   * 即使 sed 删除后，下次启动仍会被 ${KK_TRUST_HOST:default} 占位符重新写入。
   */
  private static async containerHasOldTrustEnv(cid: string): Promise<boolean> {
    try {
      const { stdout } = await exec(
        `docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' ${cid}`,
        { timeout: 10000 }
      );
      const entries = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      return entries.some((e) => e.startsWith('KK_TRUST_HOST='));
    } catch {
      return false;
    }
  }

  /**
   * 修补容器内 trust 配置：删除 application.properties 中非注释的 trust.host / trust.dir 行。
   *
   * 根源（反编译 TrustHostFilter 字节码确认）：
   *   1. `host = WebUtils.getSourceUrl(url).getHost()` — 对于 file:// 协议，host 是空字符串 ""
   *   2. `if (host == null) → 放行` — 空字符串不是 null，不触发
   *   3. `if (trustHostSet.isEmpty()) → 放行` — 只要 trust.host 有值（"*"、"default"…），Set 不为空
   *   4. `if (trustHostSet.contains(host)) → 放行` — Set.contains("") 对 Set{"*"} 为 false（精确匹配）
   *   5. 否则 → 返回 notTrustHost.html 错误页
   *
   * 所以必须删除 trust.host 行，让 trustHostSet 为空 → isEmpty() 为 true → 放行所有请求（含 file://）。
   *
   * 幂等：如果 trust.host 行已不存在（已修补过），直接返回不重启。
   *
   * 注意：调用前必须确保容器已经存在且在运行中。
   */
  private static async ensureTrustConfigPatched(): Promise<void> {
    const propsPath = '/opt/kkFileView-4.1.0/config/application.properties';

    // 1. 检查是否还有非注释的 trust.host / trust.dir 行
    //    使用 grep -E (扩展正则) 支持 [[:space:]] 字符类
    //    exit code 0 = 有匹配, 1 = 无匹配, >1 = 真实错误
    let hasTrustHost = false;
    let hasTrustDir = false;
    try {
      const { stdout } = await exec(
        `docker exec ${KKFILEVIEW_CONTAINER_NAME} grep -cE '^trust\\.host[[:space:]]*=' ${propsPath}`,
        { timeout: 10000 }
      );
      hasTrustHost = parseInt(stdout.trim(), 10) > 0;
    } catch {
      // grep 无匹配退出码 1 → 该行不存在
    }
    try {
      const { stdout } = await exec(
        `docker exec ${KKFILEVIEW_CONTAINER_NAME} grep -cE '^trust\\.dir[[:space:]]*=' ${propsPath}`,
        { timeout: 10000 }
      );
      hasTrustDir = parseInt(stdout.trim(), 10) > 0;
    } catch {
      // 无匹配
    }

    if (!hasTrustHost && !hasTrustDir) {
      console.log('[KkFileViewService] trust 配置已修补（trust.host/trust.dir 行均不存在），无需操作');
      return;
    }

    console.log(
      `[KkFileViewService] 检测到 application.properties 中仍有 trust 配置行 ` +
      `(trust.host=${hasTrustHost ? '存在' : '不存在'}, trust.dir=${hasTrustDir ? '存在' : '不存在'})，` +
      `正在删除并重启容器...`
    );

    // 2. 删除 trust.host 和 trust.dir 行（用两条独立 sed，兼容性更好）
    try {
      await exec(
        `docker exec ${KKFILEVIEW_CONTAINER_NAME} sed -i '/^trust\\.host[[:space:]]*=/d' ${propsPath}`,
        { timeout: 15000 }
      );
      await exec(
        `docker exec ${KKFILEVIEW_CONTAINER_NAME} sed -i '/^trust\\.dir[[:space:]]*=/d' ${propsPath}`,
        { timeout: 15000 }
      );
    } catch (e) {
      throw new Error(
        `删除 trust 配置失败：${e instanceof Error ? e.message : String(e)}。` +
        `请手动执行：docker exec ${KKFILEVIEW_CONTAINER_NAME} ` +
        `sed -i '/^trust\\.host/d; /^trust\\.dir/d' ${propsPath} && docker restart ${KKFILEVIEW_CONTAINER_NAME}`
      );
    }

    // 3. 验证删除结果
    let remainingLines = 0;
    try {
      const { stdout } = await exec(
        `docker exec ${KKFILEVIEW_CONTAINER_NAME} grep -cE '^trust\\.(host|dir)[[:space:]]*=' ${propsPath}`,
        { timeout: 10000 }
      );
      remainingLines = parseInt(stdout.trim(), 10);
    } catch {
      // 无匹配 → 成功
    }
    if (remainingLines > 0) {
      console.warn('[KkFileViewService] sed 删除后仍有 trust 行，尝试备用匹配方式...');
      // 备用：匹配所有以 trust.host/trust.dir 开头的行（不限定 = 号）
      await exec(
        `docker exec ${KKFILEVIEW_CONTAINER_NAME} sed -i '/^trust\\.host/d; /^trust\\.dir/d' ${propsPath}`,
        { timeout: 15000 }
      );
    }

    // 4. 重启容器让配置生效
    try {
      await exec(`docker restart ${KKFILEVIEW_CONTAINER_NAME}`, { timeout: 30000 });
    } catch (e) {
      throw new Error(`重启 kkFileView 容器失败：${e instanceof Error ? e.message : String(e)}`);
    }

    // 5. 等待容器重启后 Docker 层面就绪（Spring 启动交给健康检查处理）
    await this.sleep(3000);
    console.log('[KkFileViewService] trust 配置已修补，容器已重启，等待健康检查...');
  }

  /** macOS 上同一个目录可能出现 /private/var vs /var、或 trailing '/' 差异，这里归一化比较。 */
  private static pathEqualOnMac(a: string, b: string): boolean {
    if (a === b) return true;
    const norm = (p: string) => {
      let r = p.replace(/\/+$/, '');
      if (process.platform === 'darwin' && r.startsWith('/private/var/')) {
        r = r.slice('/private'.length);
      } else if (process.platform === 'darwin' && os.tmpdir().startsWith('/private')) {
        // 不动
      }
      return r;
    };
    return norm(a) === norm(b);
  }

  /** kkFileView HTTP 健康检查：GET /index（和 chat_assistant_agent is_kkfileview_available 对齐）必须 2xx/3xx */
  private static async httpHealthy(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/index',
          timeout: 1500,
          method: 'GET'
        },
        (res) => {
          const ok = res.statusCode != null && res.statusCode >= 200 && res.statusCode < 400;
          res.resume();
          resolve(ok);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
