import type { Note } from '@shared/types';
import { useNavigate } from 'react-router-dom';
import { useNoteStore } from '../stores/useNoteStore';
import { useUiStore } from '../stores/useUiStore';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { useNavigateSafe } from '../hooks/useNavigateSafe';
import { formatShortDateTime } from '../utils/format-time';
import { summarize, stripMarkdown } from '../utils/text';

interface NoteCardProps {
  note: Note;
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

export default function NoteCard({ note }: NoteCardProps) {
  const navigate = useNavigate();
  const navigateIfSafe = useNavigateSafe();
  const currentId = useNoteStore((s) => s.currentId);
  const removeNote = useNoteStore((s) => s.remove);
  const sidebarSearch = useUiStore((s) => s.sidebarSearch);
  const confirm = useConfirm();
  const toast = useToast();

  const isActive = currentId === note.id;

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

  const summary = summarize(stripMarkdown(note.content ?? ''), 80);
  const displayTitle = note.title?.trim() || '未命名记事';

  return (
    <div
      onClick={handleClick}
      className={[
        'relative group cursor-pointer rounded-xl2 p-4',
        'transition-all duration-150 ease-out',
        'gradient-border shadow-card bg-paper-50',
        'hover:shadow-cardHover hover:-translate-y-0.5',
        isActive
          ? 'bg-paper-100 ring-2 ring-sage-500/70 shadow-cardHover'
          : ''
      ].join(' ')}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex gap-1 z-10 bg-paper-50/80 backdrop-blur-sm rounded-lg px-1 py-0.5">
        <button
          onClick={handleDelete}
          title="删除"
          className="no-drag w-7 h-7 rounded-md hover:bg-paper-200 flex items-center justify-center text-ink-500 hover:text-rose-600 transition-colors text-sm"
        >
          🗑
        </button>
      </div>

      <div className="pr-14 flex flex-col gap-0 h-full">
        <div className="text-[15px] font-semibold text-ink-900 truncate leading-snug">
          {highlight(displayTitle, sidebarSearch.trim())}
        </div>
        <div className="mt-1.5 text-[13px] text-ink-500 leading-relaxed min-h-[40px] flex-1">
          {summary || (
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
