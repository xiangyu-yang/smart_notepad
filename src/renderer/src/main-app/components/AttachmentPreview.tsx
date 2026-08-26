import { useEffect, useMemo, useState } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { useToast } from '../hooks/useToast';
import type { Attachment } from '@shared/types';
import { deriveMimeFromName, pickPreviewKind, type PreviewKind } from '@shared/mime-utils';

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function AttachmentPreview() {
  const toast = useToast();
  const { attachmentPreview, closeAttachmentPreview } = useUiStore();
  const visible = Boolean(attachmentPreview);
  const attachment = attachmentPreview?.attachment ?? null;

  const [base64, setBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [textError, setTextError] = useState(false);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [docxError, setDocxError] = useState(false);
  // kkFileView 在线预览
  const [kkLoading, setKkLoading] = useState(false);
  const [kkPreviewUrl, setKkPreviewUrl] = useState<string | null>(null);

  // 扩展名优先的分派 + 派生 MIME，修复 File.type 为空时 PDF iframe 无法启动 Viewer
  const { kind, effectiveMime } = useMemo(() => {
    if (!attachment) return { kind: 'unsupported' as PreviewKind, effectiveMime: '' };
    const k = pickPreviewKind(attachment.mime_type, attachment.original_name);
    return {
      kind: k,
      effectiveMime: attachment.mime_type || deriveMimeFromName(attachment.original_name)
    };
  }, [attachment]);

  useEffect(() => {
    if (!visible || !attachment) {
      setBase64(null);
      setLoading(false);
      setTextError(false);
      setDocxHtml(null);
      setDocxError(false);
      setKkLoading(false);
      setKkPreviewUrl(null);
      return;
    }
    setLoading(true);
    setBase64(null);
    setTextError(false);
    setDocxHtml(null);
    setDocxError(false);
    setKkLoading(false);
    setKkPreviewUrl(null);
    (async () => {
      try {
        const res = await window.api['attachments.get'](attachment.id);
        setBase64(res.base64);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        console.error('[AttachmentPreview] load error:', e);
        toast.error(`加载文件失败：${msg}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, attachment?.id, toast]);

  const blobUrl = useMemo(() => {
    if (!base64) return null;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const mime = effectiveMime || 'application/octet-stream';
      const blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      console.error('[AttachmentPreview] blob decode error:', e);
      toast.error(`解码失败：${msg}`);
      return null;
    }
  }, [base64, effectiveMime, toast]);

  // 卸载时释放
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const decodedText = useMemo<string | null>(() => {
    if (kind !== 'text' || !base64) return null;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const MAX = 2 * 1024 * 1024;
      if (decoded.length > MAX) {
        return decoded.slice(0, MAX) + '\n\n...（文件过大，已截断）';
      }
      return decoded;
    } catch {
      setTextError(true);
      return null;
    }
  }, [base64, kind]);

  // Word 文档（.docx）用 mammoth 转 HTML 预览
  // mammoth 体积较大（~500KB），用 dynamic import 仅在需要时加载，不影响首屏
  useEffect(() => {
    if (kind !== 'docx' || !base64) {
      setDocxHtml(null);
      setDocxError(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // mammoth 内部使用全局 Buffer，浏览器端默认无，需手动 polyfill（按需加载，不污染其他场景）
        const g = globalThis as { Buffer?: unknown };
        if (typeof g.Buffer === 'undefined') {
          const { Buffer } = await import('buffer');
          g.Buffer = Buffer;
        }
        const mammoth = await import('mammoth');
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
        if (!cancelled) setDocxHtml(result.value);
      } catch (e) {
        console.error('[AttachmentPreview] docx convert error:', e);
        if (!cancelled) setDocxError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, base64]);

  const handleDownload = async () => {
    if (!attachment) return;
    try {
      const r = await window.api['attachments.download'](attachment.id);
      if (r.canceled) return;
      if (r.success && r.path) {
        toast.success(`已保存：${r.path.split(/[/\\]/).pop()}`);
      } else {
        toast.error(r.error ? `下载失败：${r.error}` : '下载失败');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      console.error('[AttachmentPreview] download error:', err);
      toast.error(`下载失败：${msg}`);
    }
  };

  const handleOpenDefaultApp = async () => {
    if (!attachment) return;
    try {
      const r = await window.api['attachments.openDefault'](attachment.id);
      if (r.success) toast.success(`已启动系统默认应用打开：${attachment.original_name}`);
      else toast.error(r.error ? `打开失败：${r.error}` : '打开失败');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      console.error('[AttachmentPreview] openDefault error:', err);
      toast.error(`打开失败：${msg}`);
    }
  };

  const handleTryKkView = async () => {
    if (!attachment) return;
    setKkLoading(true);
    setKkPreviewUrl(null);
    try {
      const r = await window.api['attachments.prepareKkView'](attachment.id);
      if (r.success && r.previewUrl) {
        setKkPreviewUrl(r.previewUrl);
      } else {
        toast.error(r.error ? `在线预览不可用：${r.error}` : '在线预览不可用');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      console.error('[AttachmentPreview] prepareKkView error:', err);
      toast.error(`在线预览失败：${msg}`);
    } finally {
      setKkLoading(false);
    }
  };

  if (!visible || !attachment) return null;

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex items-center justify-center h-full text-ink-400">
        加载中…
      </div>
    );
  } else if (kind === 'image' && blobUrl) {
    body = (
      <div className="flex items-center justify-center w-full h-full overflow-auto bg-paper-100/60 rounded-lg p-4">
        <img
          src={blobUrl}
          alt={attachment.original_name}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />
      </div>
    );
  } else if (kind === 'pdf' && blobUrl) {
    body = (
      <iframe
        title={attachment.original_name}
        src={blobUrl}
        className="w-full h-full border-0 rounded-lg bg-white shadow-inner"
      />
    );
  } else if (kind === 'text') {
    body = textError ? (
      <div className="flex items-center justify-center h-full text-ink-400">文本解码失败</div>
    ) : decodedText != null ? (
      <pre className="w-full h-full overflow-auto p-5 bg-paper-50 border border-paper-200 rounded-lg text-[13px] leading-6 text-ink-700 whitespace-pre-wrap break-words font-mono select-text">
        {decodedText}
      </pre>
    ) : (
      <div className="flex items-center justify-center h-full text-ink-400">加载中…</div>
    );
  } else if (kind === 'docx') {
    body = docxError ? (
      <div className="flex items-center justify-center h-full text-ink-400">
        Word 文档解析失败，可点击右上角「下载」后用 Office 打开
      </div>
    ) : docxHtml != null ? (
      <div
        className="w-full h-full overflow-auto bg-white border border-paper-200 rounded-lg p-6 prose prose-note text-[14px] leading-7 select-text"
        dangerouslySetInnerHTML={{ __html: docxHtml }}
      />
    ) : (
      <div className="flex items-center justify-center h-full text-ink-400">解析中…</div>
    );
  } else if (kkPreviewUrl) {
    // ---- kkFileView 在线预览：iframe 嵌入 kkFileView 的 onlinePreview 页面 ----
    body = (
      <iframe
        title={`kkFileView 预览 - ${attachment.original_name}`}
        src={kkPreviewUrl}
        className="w-full h-full border-0 rounded-lg bg-white shadow-inner"
      />
    );
  } else {
    // ---- unsupported 初始状态：提供 3 种操作 ----
    body = (
      <div className="flex flex-col items-center justify-center h-full text-ink-500 gap-4">
        <div className="text-5xl">📄</div>
        <div className="text-center max-w-[520px]">
          <div className="font-medium text-ink-700 mb-1">
            {attachment.original_name}
          </div>
          <div className="text-[12px] text-ink-400 mb-3">
            {attachment.mime_type || (effectiveMime ? `${effectiveMime}（按扩展名推导）` : '未知格式')} · {formatSize(attachment.size)}
          </div>
          <div className="text-[13px] leading-6 mb-5">
            当前格式未做内嵌预览渲染，可选择下列方式打开。
          </div>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={handleOpenDefaultApp}
              className="h-9 px-4 rounded-lg text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 transition-all duration-150 shadow-sm hover:shadow"
            >
              🚀 用本地应用打开
            </button>
            <button
              onClick={handleTryKkView}
              disabled={kkLoading}
              className="h-9 px-4 rounded-lg text-sm font-medium text-ink-700 bg-paper-100 hover:bg-paper-200 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150"
            >
              {kkLoading ? '⏳ 正在启动 kkFileView…' : '👁️ kkFileView 在线预览'}
            </button>
            <button
              onClick={handleDownload}
              className="h-9 px-4 rounded-lg text-sm font-medium text-ink-700 border border-paper-200 bg-white hover:bg-paper-100 transition-all duration-150"
            >
              ⬇ 下载到本地
            </button>
          </div>
          <div className="mt-4 text-[11px] text-ink-400 leading-5">
            「本地应用」：调用系统安装的 PowerPoint / WPS / Keynote / Excel 等直接打开<br />
            「在线预览」：自动启动本地 kkFileView（Docker），通过 LibreOffice 转码后嵌入展示
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeAttachmentPreview();
      }}
    >
      <div className="absolute inset-0 bg-ink-500/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]" />
      <div className="relative z-10 w-[86%] h-[82%] bg-paper-50 rounded-2xl shadow-2xl flex flex-col animate-[dialogIn_0.18s_ease-out]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-paper-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-2xl">
              {kind === 'image' ? '🖼️' : kind === 'pdf' ? '📕' : kind === 'text' ? '📝' : kind === 'docx' ? '📄' : '📎'}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[15px] text-ink-800 truncate">
                {attachment.original_name}
              </div>
              <div className="text-[11px] text-ink-400 mt-0.5">
                {effectiveMime || attachment.mime_type || '未知类型'} · {formatSize(attachment.size)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              onClick={handleDownload}
              className="h-8 px-3 rounded-lg text-sm font-medium text-ink-700 bg-paper-100 hover:bg-sage-100 hover:text-sage-700 transition-all duration-150"
            >
              ⬇ 下载
            </button>
            <button
              onClick={closeAttachmentPreview}
              className="h-8 w-8 rounded-lg text-ink-500 hover:bg-paper-200 hover:text-ink-800 transition-all duration-150 flex items-center justify-center"
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 p-4">{body}</div>
      </div>
    </div>
  );
}
