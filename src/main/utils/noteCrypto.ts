/**
 * noteCrypto - 记事标题/内容的端到端加密工具（仅主进程使用）
 *
 * 算法选型（行业最佳实践，全部基于 Node 内置 node:crypto，无第三方依赖）：
 *   - 密钥派生：scrypt（RFC 7914，内存硬化 KDF，抗 GPU/ASIC 暴力破解）
 *       N = 2^15, r = 8, p = 1, keylen = 32 字节
 *       每篇记事使用独立随机盐（16 字节），相同密码不会产生相同密钥
 *   - 对称加密：AES-256-GCM（带 GMAC 认证标签）
 *       机密性 + 完整性一体；密码错误或密文被篡改时解密必然失败
 *       标题、正文各自使用独立随机 12 字节 IV，共用同一派生密钥
 *
 * 持久化格式（自描述、可向前演进）：
 *   密文字段落库为字符串：`enc:v1:<base64url(JSON)>`
 *   JSON = { i: IV(b64), a: authTag(b64), d: 密文(b64) }
 *   记事级盐存放在 notes.encryption_meta 列：{ v: 1, s: salt(b64) }
 *
 * 安全说明：
 *   - 用户密码本身绝不落库、不记录日志；重启后必须重新输入原密码，
 *     GCM 认证标签即"密码校验器"，密码错误无法通过认证。
 *   - 密码丢失在数学上不可恢复，请在 UI 层明确提示用户牢记密码。
 */
import crypto from 'node:crypto';
import { NOTE_CRYPTO_ERRORS } from '@shared/constants';

// 透传给 IPC 层使用，避免多处直接依赖 shared 常量
export { NOTE_CRYPTO_ERRORS };

const ENVELOPE_PREFIX = 'enc:v1:';
const ENVELOPE_VERSION = 1;

const SCRYPT_N = 32768; // 2^15
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // GCM 推荐 96-bit IV
const AUTH_TAG_LEN = 16;

/** scrypt 实际内存占用约 128 * N * r = 32 MiB，显式放宽 maxmem 到 64 MiB */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** 密码错误或密文损坏时统一抛出的错误码，渲染层据此提示并允许重试 */
export const BAD_PASSWORD_ERROR = NOTE_CRYPTO_ERRORS.BAD_PASSWORD;

export interface EncryptedNotePayload {
  /** notes.encryption_meta 列内容：JSON { v, s(salt b64) } */
  meta: string;
  /** 加密后的标题（envelope 字符串） */
  title: string;
  /** 加密后的正文（envelope 字符串） */
  content: string;
}

interface EncryptionMeta {
  v: number;
  s: string;
}

interface FieldEnvelope {
  i: string; // IV base64
  a: string; // authTag base64
  d: string; // ciphertext base64
}

/** scrypt 从用户密码 + 记事级随机盐派生 256-bit 密钥 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  });
}

/** 用派生密钥加密单个文本字段，返回自描述 envelope 字符串 */
function encryptField(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: AUTH_TAG_LEN
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  const envelope: FieldEnvelope = {
    i: iv.toString('base64'),
    a: authTag.toString('base64'),
    d: ciphertext.toString('base64')
  };
  return ENVELOPE_PREFIX + Buffer.from(JSON.stringify(envelope)).toString('base64url');
}

/** 用派生密钥解密单个 envelope；任何失败（密码错/格式坏/被篡改）统一转 BAD_PASSWORD */
function decryptField(envelope: string, key: Buffer): string {
  try {
    if (!envelope.startsWith(ENVELOPE_PREFIX)) {
      throw new Error('invalid envelope prefix');
    }
    const json = Buffer.from(
      envelope.slice(ENVELOPE_PREFIX.length),
      'base64url'
    ).toString('utf8');
    const parsed = JSON.parse(json) as FieldEnvelope;
    if (!parsed.i || !parsed.a || !parsed.d) throw new Error('invalid envelope');

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parsed.i, 'base64'),
      { authTagLength: AUTH_TAG_LEN }
    );
    decipher.setAuthTag(Buffer.from(parsed.a, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.d, 'base64')),
      decipher.final() // GCM 认证失败在此抛错
    ]).toString('utf8');
  } catch {
    // 不区分"密码错误"与"数据损坏"：统一提示，避免给攻击者额外信息
    throw new Error(BAD_PASSWORD_ERROR);
  }
}

/**
 * 加密整篇记事（标题 + 正文）。
 * 一次 scrypt 派生，两个字段各用独立 IV。
 */
export function encryptNote(
  title: string,
  content: string,
  password: string
): EncryptedNotePayload {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(password, salt);
  const meta: EncryptionMeta = {
    v: ENVELOPE_VERSION,
    s: salt.toString('base64')
  };
  return {
    meta: JSON.stringify(meta),
    title: encryptField(title ?? '', key),
    content: encryptField(content ?? '', key)
  };
}

/**
 * 解密整篇记事。
 * @throws Error(BAD_PASSWORD) 密码错误、盐/密文损坏或被篡改
 */
export function decryptNote(
  encrypted: { title: string; content: string; meta: string },
  password: string
): { title: string; content: string } {
  let meta: EncryptionMeta;
  let salt: Buffer;
  try {
    meta = JSON.parse(encrypted.meta) as EncryptionMeta;
    if (meta.v !== ENVELOPE_VERSION || !meta.s) {
      throw new Error('unsupported meta version');
    }
    salt = Buffer.from(meta.s, 'base64');
    if (salt.length !== SALT_LEN) throw new Error('invalid salt');
  } catch {
    throw new Error(BAD_PASSWORD_ERROR);
  }

  const key = deriveKey(password, salt);
  // 先解密标题做认证，失败即抛 BAD_PASSWORD，避免无谓的第二次计算
  const title = decryptField(encrypted.title, key);
  const content = decryptField(encrypted.content, key);
  return { title, content };
}
