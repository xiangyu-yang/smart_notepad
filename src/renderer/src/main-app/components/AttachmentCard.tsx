import { useCallback, useState } from 'react';
import type { Attachment } from '@shared/types';
import { useToast } from '../hooks/useToast';
import { useConfirm } from '../hooks/useConfirm';
import { useAttachmentStore } from '../stores/useAttachmentStore';
import { useUiStore } from '../stores/useUiStore';

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function pickIcon(mime: string, name: string) {
  const m = (mime || '').toLowerCase();
  const n = name.toLowerCase();
  if (m.startsWith('image/')) return '🖼️';
  if (m.includes('pdf') || n.endsWith('.pdf')) return '📕';
  if (
    n.endsWith('.doc') ||
    n.endsWith('.docx') ||
    n.endsWith('.pages') ||
    n.endsWith('.rtf')
  )
    return '📘';
  if (
    n.endsWith('.xls') ||
    n.endsWith('.xlsx') ||
    n.endsWith('.csv') ||
    n.endsWith('.numbers')
  )
    return '📗';
  if (
    n.endsWith('.ppt') ||
    n.endsWith('.pptx') ||
    n.endsWith('.key') ||
    n.endsWith('.odp')
  )
    return '📙';
  if (
    n.endsWith('.zip') ||
    n.endsWith('.rar') ||
    n.endsWith('.7z') ||
    n.endsWith('.tar') ||
    n.endsWith('.gz')
  )
    return '🗜️';
  if (
    n.endsWith('.mp4') ||
    n.endsWith('.mov') ||
    n.endsWith('.webm') ||
    n.endsWith('.mkv')
  )
    return '🎬';
  if (
    n.endsWith('.mp3') ||
    n.endsWith('.wav') ||
    n.endsWith('.flac') ||
    n.endsWith('.m4a')
  )
    return '🎵';
  if (m.startsWith('text/')) return '📝';
  return '📎';
}

export interface AttachmentCardProps {
  noteId: string;
  attachment: Attachment;
}

export function AttachmentCard({ noteId, attachment }: AttachmentCardProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const removeAttachment = useAttachmentStore((s) => s.removeAttachment);
  const openAttachmentPreview = useUiStore((s) => s.openAttachmentPreview);
  const [busy, setBusy] = useState<null | 'download' | 'delete'>(null);

  const handlePreview = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      openAttachmentPreview(attachment);
    },
    [attachment, openAttachmentPreview]
  );

  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setBusy('download');
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
        console.error('[AttachmentCard] download error:', err);
        toast.error(`下载失败：${msg}`);
      } finally {
        setBusy(null);
      }
    },
    [attachment.id, toast]
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const ok = await confirm({
        title: '删除附件？',
        description: `将从记事中移除「${attachment.original_name}」并删除本地副本，此操作不可撤销。`,
        mode: 'okCancel',
        confirmText: '删除',
        cancelText: '取消'
      });
      if (ok !== true) return;
      setBusy('delete');
      try {
        const r = await window.api['attachments.delete'](attachment.id);
        if (r) {
          removeAttachment(noteId, attachment.id);
          toast.success('附件已删除');
        } else {
          toast.error('删除失败');
        }
      } catch (err) {
        console.error('[AttachmentCard] delete error:', err);
        toast.error('删除失败');
      } finally {
        setBusy(null);
      }
    },
    [noteId, attachment, confirm, toast, removeAttachment]
  );

  return (
    <div
      className="group relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-paper-50 hover:bg-paper-100 border border-paper-100 hover:border-paper-200 cursor-pointer transition-all duration-150"
      onClick={handlePreview}
      title="点击预览"
    >
      <div className="w-9 h-9 shrink-0 rounded-lg bg-white shadow-sm border border-paper-100 flex items-center justify-center text-xl select-none">
        {pickIcon(attachment.mime_type, attachment.original_name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink-700 group-hover:text-ink-900">
          {attachment.original_name}
        </div>
        <div className="text-[11px] text-ink-400 mt-0.5 truncate">
          {formatSize(attachment.size)}
          {attachment.mime_type ? ` · ${attachment.mime_type.split(';')[0]}` : ''}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <button
          onClick={handlePreview}
          className="h-7 px-2 rounded-md text-[12px] text-ink-500 hover:text-ink-800 hover:bg-white"
          title="预览"
        >
          👁 预览
        </button>
        <button
          onClick={handleDownload}
          disabled={busy !== null}
          className="h-7 px-2 rounded-md text-[12px] text-ink-500 hover:text-sage-700 hover:bg-sage-50 disabled:opacity-50 disabled:cursor-not-allowed"
          title="下载到本地"
        >
          ⬇ 下载
        </button>
        <button
          onClick={handleDelete}
          disabled={busy !== null}
          className="h-7 px-2 rounded-md text-[12px] text-ink-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
          title="删除"
        >
          🗑 删除
        </button>
      </div>
      {busy === 'delete' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-xl text-[12px] text-ink-500">
          删除中…
        </div>
      )}
      {busy === 'download' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-xl text-[12px] text-ink-500">
          保存中…
        </div>
      )}
    </div>
  );
}
