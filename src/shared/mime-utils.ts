/**
 * 共享工具：MIME ↔ 扩展名 ↔ 预览种类（image/pdf/text/unsupported）。
 * 前后端都需要这个映射：
 *   - 后端 AttachmentRepository.create：上传时 File.type 为空，用扩展名兜底推导 mime
 *   - 前端 AttachmentPreview：Blob 创建时需要正确 MIME，否则 PDF iframe 无法启用 Viewer
 * 定义在这里统一维护，避免两边逻辑漂移。
 */

export type PreviewKind = 'image' | 'pdf' | 'text' | 'office' | 'unsupported';

export const IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'svgz', 'ico', 'tiff', 'tif', 'avif', 'heic', 'heif'
]);

export const PDF_EXT = new Set(['pdf']);

/**
 * Office 文档扩展名集合。
 * 这些格式统一由 kkFileView（LibreOffice 转 PDF）预览，不再使用 mammoth 等前端解析方案。
 * 包括：Word（doc/docx 等）、Excel（xls/xlsx 等）、PPT（ppt/pptx 等）、WPS、OpenDocument 等。
 */
export const OFFICE_EXT = new Set([
  'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm',
  'xls', 'xlsx', 'xlt', 'xltx', 'xlsm', 'xltm', 'xlsb',
  'ppt', 'pptx', 'pot', 'potx', 'pptm', 'potm', 'pps', 'ppsx', 'ppsm',
  'odt', 'ods', 'odp', 'odg', 'odc', 'odb', 'odf', 'odi', 'odm', 'ott', 'ots', 'otp',
  'rtf', 'wps', 'et', 'dps',
  'pages', 'numbers', 'keynote'
]);

export const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'mdown', 'mkd',
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'log',
  'xml', 'xsl', 'xslt', 'xsd', 'plist',
  'csv', 'tsv',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1',
  'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx',
  'vue', 'svelte',
  'css', 'scss', 'sass', 'less',
  'html', 'htm', 'xhtml',
  'py', 'pyi', 'ipynb',
  'go', 'rs', 'rb', 'php', 'java', 'kt', 'kts', 'swift', 'scala',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx',
  'cs', 'fs', 'ex', 'exs', 'erl', 'hs', 'lua', 'pl', 'r', 'dart',
  'sql', 'dockerfile', 'makefile', 'cmake', 'gradle', 'sbt',
  'diff', 'patch',
  'rst', 'org', 'textile', 'mdx'
]);

export const CODE_NO_DOT = new Set(['dockerfile', 'makefile']); // 没有扩展名的代码文件名

export function getExt(name: string): string {
  const lower = (name || '').toLowerCase();
  // 无扩展名的代码文件名（e.g. "Dockerfile", "Makefile"）
  if (CODE_NO_DOT.has(lower)) return lower;
  const idx = lower.lastIndexOf('.');
  if (idx < 0 || idx === lower.length - 1) return '';
  return lower.slice(idx + 1).replace(/[^a-z0-9]/g, '');
}

/**
 * 仅依赖文件名扩展名推导 MIME（覆盖常见类型）。不覆盖的类型返回空串。
 */
export function deriveMimeFromName(name: string): string {
  const ext = getExt(name);
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'svg':
    case 'svgz': return 'image/svg+xml';
    case 'ico': return 'image/x-icon';
    case 'tif':
    case 'tiff': return 'image/tiff';
    case 'avif': return 'image/avif';
    case 'heic':
    case 'heif': return 'image/heic';
    case 'pdf': return 'application/pdf';
    case 'json': return 'application/json';
    case 'xml': return 'application/xml';
    case 'yaml':
    case 'yml': return 'application/yaml';
    case 'toml': return 'text/toml';
    case 'html':
    case 'htm':
    case 'xhtml': return 'text/html';
    case 'css': return 'text/css';
    case 'csv': return 'text/csv';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs': return 'text/javascript';
    case 'ts':
    case 'tsx': return 'text/typescript';
    case 'md':
    case 'markdown':
    case 'mdown':
    case 'mkd': return 'text/markdown';
    case 'txt':
    case 'textile':
    case 'log':
    case 'conf':
    case 'cfg':
    case 'ini':
    case 'env':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'bat':
    case 'cmd':
    case 'ps1':
    case 'py':
    case 'go':
    case 'rs':
    case 'rb':
    case 'php':
    case 'java':
    case 'kt':
    case 'kts':
    case 'swift':
    case 'c':
    case 'h':
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hh':
    case 'hxx':
    case 'cs':
    case 'fs':
    case 'vue':
    case 'svelte':
    case 'scss':
    case 'sass':
    case 'less':
    case 'dockerfile':
    case 'makefile':
    case 'sql':
    case 'rst':
    case 'org':
    case 'mdx':
    case 'tsv':
    case 'xml_placeholder':
      return 'text/plain';
    default: return '';
  }
}

/**
 * 预览分派：
 *   1. 扩展名优先：按 original_name 后缀（去掉 . 后）精确匹配 IMAGE/PDF/TEXT 三大集合。
 *   2. 再校验扩展名是否属于"已知二进制"兜底（docx/xlsx/pptx/zip/rar/exe/dmg/pkg 等），即便 mime 误报 text，也强制为 unsupported——
 *      否则 docx 的 MIME 包含 "xml" 会被下一条误判为 text，导致 ZIP 二进制 UTF-8 解码乱码。
 *   3. 最后 fallback MIME：仅在扩展名完全不认识时用 mime 推断。
 *
 * 历史踩坑：doc/x docx 的 MIME 以 application/vnd.openxml... 形式含 "xml"，
 * mime.includes('xml') 会把它们误判为 'text'，预览必然乱码。
 */
export function pickPreviewKind(mime: string, originalName: string): PreviewKind {
  const ext = getExt(originalName);
  // --- 扩展名精确匹配（最高优先级） ---
  if (ext && IMAGE_EXT.has(ext)) return 'image';
  if (ext && PDF_EXT.has(ext)) return 'pdf';
  if (ext && TEXT_EXT.has(ext)) return 'text';
  if (ext && OFFICE_EXT.has(ext)) return 'office';
  // --- 无扩展名的特殊文件名（Dockerfile / Makefile）---
  if (CODE_NO_DOT.has((originalName || '').toLowerCase())) return 'text';
  // --- 已知二进制格式：扩展名明确是非文本/不可在线预览的，一律 unsupported（无论 mime 写了啥） ---
  if (
    ext &&
    BINARY_EXT.has(ext)
  ) {
    return 'unsupported';
  }
  // --- fallback MIME（仅扩展名完全不认识时才进，且排除"mime 带 xml/openxml"这种臭名昭著的误报） ---
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.includes('pdf')) return 'pdf';
  if (m.startsWith('text/')) return 'text';
  // 结构化文本 MIME（xml/json/javascript/markdown）——必须确认扩展名没被前面 BINARY_EXT 拦掉才进 text
  if (
    !m.includes('vnd.openxml') &&
    !m.includes('officedocument') &&
    (m.includes('javascript') || m.includes('/json') || m === 'application/xml' || m === 'application/xhtml+xml' || m.includes('markdown'))
  ) {
    return 'text';
  }
  return 'unsupported';
}

/**
 * 已知为二进制、不适合用 `<pre>` UTF-8 文本预览的扩展名。
 * 注：office 类型（docx/xlsx/pptx 等）已由 OFFICE_EXT 在上层匹配为 'office'，
 * 不会走到 BINARY_EXT 分支，这里仅保留非 office 的二进制格式。
 */
export const BINARY_EXT = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst',
  'exe', 'msi', 'dll', 'so', 'dylib', 'a', 'o', 'obj', 'lib',
  'apk', 'ipa', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'snap', 'flatpak',
  'class', 'jar', 'war', 'ear', 'jmod',
  'psd', 'ai', 'sketch', 'fig', 'xd', 'xcf',
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'ape', 'alac', 'aiff',
  'mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'f4v', 'm4v', '3gp', 'ts', 'mts', 'm2ts',
  'epub', 'mobi', 'azw', 'azw3', 'fb2', 'ibooks',
  'dwg', 'dxf', 'step', 'stp', 'igs', 'iges',
  'bin', 'dat', 'img', 'iso', 'vdi', 'vhd', 'vmdk', 'qcow2', 'raw',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'ttc'
]);
