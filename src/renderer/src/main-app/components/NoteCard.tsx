import { useState } from 'react';
import type { Note } from '@shared/types';
import { NOTE_CRYPTO_ERRORS } from '@shared/constants';
import { useNavigate } from 'react-router-dom';
import { useNoteStore } from '../stores/useNoteStore';
import { useUiStore } from '../stores/useUiStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { usePasswordPrompt } from '../hooks/usePasswordPrompt';
import { useNavigateSafe } from '../hooks/useNavigateSafe';
import { formatShortDateTime } from '../utils/format-time';
import { summarize, stripMarkdown } from '../utils/text';
import { getCryptoErrorCode, getIpcErrorMessage } from '../utils/ipc-error';

interface NoteCardProps {
  note: Note;
  /** 树形层级缩进（文件夹内嵌套时 >0）；默认 0 */
  depth?: number;
}

function highlight(text: string, kw: string) {
  if (!kw) return text;
  const idx = text.toLowerCase().indexOf(kw.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-sage-100 text-sage-700 rounded px-0.5">
        {text.slice(idx, idx + kw.length)}
      </mark>
      {text.slice(idx + kw.length)}
    </>
  );
}

export default function NoteCard({ note, depth = 0 }: NoteCardProps) {
  const navigate = useNavigate();
  const navigateIfSafe = useNavigateSafe();
  const currentId = useNoteStore((s) => s.currentId);
  const removeNote = useNoteStore((s) => s.remove);
  const saveNote = useNoteStore((s) => s.save);
  const encryptNote = useNoteStore((s) => s.encrypt);
  const decryptNote = useNoteStore((s) => s.decrypt);
  const sidebarSearch = useUiStore((s) => s.sidebarSearch);
  const confirm = useConfirm();
  const toast = useToast();
  const askPassword = usePasswordPrompt();
  const [cryptoBusy, setCryptoBusy] = useState(false);

  const isActive = currentId === note.id;
  const encrypted = Boolean(note.is_encrypted);

  // 拖拽源：把记事拖入文件夹或拖到空白处移回根目录
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-note-id', note.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleClick = () => {
    useNoteStore.getState().setCurrentId(note.id);
    // Note A → Note B is treated as "stay within editor" and is NOT
    // guarded by dirty-confirm.  The editor itself will auto-save in
    // fetchNote when id changes.  Only block note→home/settings/etc.
    if (isActive) return;
    navigate(`/note/${note.id}`);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: '删除记事？',
      description: '删除后无法恢复，确认继续吗？',
      confirmText: '删除',
      cancelText: '取消'
    });
    if (!ok) return;
    const removed = await removeNote(note.id);
    if (removed) {
      toast.success('已删除');
      if (isActive) {
        // Leaving the editor; run the dirty guard in case the user was
        // editing another note's dirty content while this card was clicked.
        // (In practice this note is already gone, so the guard mostly just
        // ensures a consistent path back to home.)
        await navigateIfSafe(() => navigate('/', { replace: true }));
      }
    } else {
      toast.error('删除失败');
    }
  };

  /**
   * 加密当前正打开的记事前，先把编辑器未落盘的内容保存，
   * 否则主进程只会加密 DB 里的旧内容，随后的自动保存还可能用明文覆盖密文。
   */
  const flushActiveEditorIfDirty = async () => {
    if (!isActive) return;
    const st = useEditorStore.getState();
    const dirty =
      st.loaded && (st.title !== st.pristineTitle || st.content !== st.pristineContent);
    if (dirty) {
      const saved = await saveNote(note.id, { title: st.title, content: st.content });
      st.markSaved(saved);
    }
  };

  const handleToggleEncryption = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cryptoBusy) return;

    try {
      if (!encrypted) {
        // ---- 加密 ----
        await flushActiveEditorIfDirty();
        const password = await askPassword({
          title: '加密记事',
          description:
            '将加密整篇记事的标题与正文。请牢记密码，密码一旦丢失，密文在数学上无法恢复。',
          placeholder: '设置加密密码',
          confirmText: '加密'
        });
        if (password === null) return;
        setCryptoBusy(true);
        await encryptNote(note.id, password);
        toast.success('已加密');
      } else {
        // ---- 解密：密码错误时保留弹窗并允许反复重试，取消则退出 ----
        let password: string | null = await askPassword({
          title: '解密记事',
          description: '请输入加密这篇记事时设置的密码。',
          placeholder: '输入密码',
          confirmText: '解密'
        });
        while (password !== null) {
          setCryptoBusy(true);
          try {
            await decryptNote(note.id, password);
            toast.success('已解密');
            return;
          } catch (err) {
            // invoke reject 会被 Electron 包装，用归一化工具识别真实错误码
            const code = getCryptoErrorCode(err);
            if (code === NOTE_CRYPTO_ERRORS.BAD_PASSWORD) {
              password = await askPassword({
                title: '解密记事',
                description: '请输入加密这篇记事时设置的密码。',
                placeholder: '输入密码',
                confirmText: '解密',
                error: '密码错误，请重新输入'
              });
            } else if (code === NOTE_CRYPTO_ERRORS.NOT_FOUND) {
              toast.error('记事不存在');
              return;
            } else {
              toast.error(`解密失败：${getIpcErrorMessage(err) || '未知错误'}`);
              return;
            }
          } finally {
            setCryptoBusy(false);
          }
        }
      }
    } catch (err) {
      const code = getCryptoErrorCode(err);
      if (code === NOTE_CRYPTO_ERRORS.ALREADY_ENCRYPTED) {
        toast.error('该记事已处于加密状态');
      } else if (code === NOTE_CRYPTO_ERRORS.NOT_FOUND) {
        toast.error('记事不存在');
      } else {
        toast.error(`操作失败：${getIpcErrorMessage(err) || '未知错误'}`);
      }
    } finally {
      setCryptoBusy(false);
    }
  };

  const summary = encrypted ? '' : summarize(stripMarkdown(note.content ?? ''), 80);
  const displayTitle = encrypted
    ? '已加密记事'
    : note.title?.trim() || '未命名记事';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={handleClick}
      style={{ marginLeft: depth * 16 }}
      className={[
        'relative group cursor-pointer rounded-xl2 p-4',
        'transition-all duration-150 ease-out',
        'gradient-border shadow-card bg-paper-50',
        'hover:shadow-cardHover hover:-translate-y-0.5',
        'active:cursor-grabbing',
        isActive
          ? 'bg-paper-100 ring-2 ring-sage-500/70 shadow-cardHover'
          : ''
      ].join(' ')}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex gap-1 z-10 bg-paper-50/80 backdrop-blur-sm rounded-lg px-1 py-0.5">
        <button
          onClick={handleToggleEncryption}
          disabled={cryptoBusy}
          title={encrypted ? '解密' : '加密'}
          className={[
            'no-drag w-7 h-7 rounded-md hover:bg-paper-200 flex items-center justify-center transition-colors text-sm',
            encrypted
              ? 'text-amber-600 hover:text-amber-700'
              : 'text-ink-500 hover:text-sage-700',
            cryptoBusy ? 'opacity-50 cursor-wait' : ''
          ].join(' ')}
        >
          {cryptoBusy ? '⏳' : encrypted ? '🔓' : '🔒'}
        </button>
        <button
          onClick={handleDelete}
          title="删除"
          className="no-drag w-7 h-7 rounded-md hover:bg-paper-200 flex items-center justify-center text-ink-500 hover:text-rose-600 transition-colors text-sm"
        >
          🗑
        </button>
      </div>

      <div className="pr-14 flex flex-col gap-0 h-full">
        <div
          className={[
            'text-[15px] font-semibold truncate leading-snug flex items-center gap-1.5',
            encrypted ? 'text-ink-500' : 'text-ink-900'
          ].join(' ')}
        >
          {encrypted && <span className="shrink-0" title="已加密">🔒</span>}
          <span className="truncate">
            {encrypted ? displayTitle : highlight(displayTitle, sidebarSearch.trim())}
          </span>
        </div>
        <div className="mt-1.5 text-[13px] text-ink-500 leading-relaxed min-h-[40px] flex-1">
          {encrypted ? (
            <span className="text-ink-400 italic flex items-center gap-1">
              <span>🔐</span>
              <span>内容已加密，点击卡片输入密码解锁</span>
            </span>
          ) : summary ? (
            summary
          ) : (
            <span className="text-ink-300 italic">暂无内容</span>
          )}
        </div>
        <div className="mt-3 pt-2 border-t border-paper-200/70 flex flex-col gap-0.5 text-[11px] text-ink-400">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 truncate">
              <span className="opacity-70">创建</span>
              <span className="truncate">{formatShortDateTime(note.created_at)}</span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <span className="opacity-70">修改</span>
              <span>{formatShortDateTime(note.updated_at)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
