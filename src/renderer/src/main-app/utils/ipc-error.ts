import { NOTE_CRYPTO_ERRORS } from '@shared/constants';

const KNOWN_CRYPTO_CODES = Object.values(NOTE_CRYPTO_ERRORS);

/**
 * 从 IPC 错误中提取记事加解密的业务错误码。
 *
 * 背景：Electron ipcRenderer.invoke 会把主进程 reject 的 Error 包装成
 *   "Error invoking remote method 'notes.decrypt': Error: BAD_PASSWORD"
 * 直接对 err.message 做全等比较会失败，必须从包装文本中识别真实错误码。
 *
 * @returns 命中的 NOTE_CRYPTO_ERRORS 码；非已知错误返回 null
 */
export function getCryptoErrorCode(err: unknown): string | null {
  const msg =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg) return null;
  return KNOWN_CRYPTO_CODES.find((code) => msg.includes(code)) ?? null;
}

/**
 * 取 IPC 包装错误的原始消息尾巴（最后一个 "Error: " 之后的部分），
 * 用于展示非错误码类异常（如主进程的中文校验信息），避免把整串
 * "Error invoking remote method ..." 暴露给用户。
 */
export function getIpcErrorMessage(err: unknown): string {
  const msg =
    err instanceof Error ? err.message : err == null ? '' : String(err);
  const idx = msg.lastIndexOf('Error: ');
  return idx >= 0 ? msg.slice(idx + 'Error: '.length).trim() : msg.trim();
}
