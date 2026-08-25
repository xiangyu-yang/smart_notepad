import { useMemo } from 'react';
import type { Folder, Note } from '@shared/types';
import { useFolderStore } from '../stores/useFolderStore';
import { useNoteStore } from '../stores/useNoteStore';
import { useToast } from '../hooks/useToast';
import FolderCard from './FolderCard';
import NoteCard from './NoteCard';

const NOTE_DND_MIME = 'application/x-note-id';
const FOLDER_DND_MIME = 'application/x-folder-id';

/**
 * 顶层文件夹树容器：
 * - 把扁平 folders + notes 按 parent_id / folder_id 分组为 Map
 * - 渲染根级 folders（递归 FolderCard）+ 根级 notes
 * - 外层 div 作为根 drop target：拖记事/文件夹到空白处 = 移回根目录
 */
export default function FolderTree() {
  const folders = useFolderStore((s) => s.folders);
  const notes = useNoteStore((s) => s.notes);
  const moveNote = useNoteStore((s) => s.move);
  const moveFolder = useFolderStore((s) => s.move);
  const toast = useToast();

  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const k = f.parent_id ?? null;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.updated_at - a.updated_at);
    return m;
  }, [folders]);

  const notesByFolder = useMemo(() => {
    const m = new Map<string | null, Note[]>();
    for (const n of notes) {
      const k = n.folder_id ?? null;
      const arr = m.get(k) ?? [];
      arr.push(n);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.updated_at - a.updated_at);
    return m;
  }, [notes]);

  const rootFolders = childrenByParent.get(null) ?? [];
  const rootNotes = notesByFolder.get(null) ?? [];
  const isEmpty = rootFolders.length === 0 && rootNotes.length === 0;

  const onDragOver = (e: React.DragEvent) => {
    // 同时接受记事和文件夹拖拽
    if (
      e.dataTransfer.types.includes(NOTE_DND_MIME) ||
      e.dataTransfer.types.includes(FOLDER_DND_MIME)
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    // 先尝试文件夹拖拽（拖到根空白处 = 移回根级）
    const folderId = e.dataTransfer.getData(FOLDER_DND_MIME);
    if (folderId) {
      const f = useFolderStore.getState().folders.find((x) => x.id === folderId);
      if (!f || f.parent_id == null) return; // 已在根目录无需移动
      try {
        const updated = await moveFolder(folderId, null);
        if (updated) toast.success('已移回根目录');
        else toast.error('移动失败');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '移动失败');
      }
      return;
    }
    // 再尝试记事拖拽
    const noteId = e.dataTransfer.getData(NOTE_DND_MIME);
    if (!noteId) return;
    const note = useNoteStore.getState().notes.find((n) => n.id === noteId);
    if (!note || note.folder_id == null) return; // 已在根目录无需移动
    const updated = await moveNote(noteId, null);
    if (updated) toast.success('已移回根目录');
  };

  return (
    <div onDragOver={onDragOver} onDrop={onDrop} className="space-y-2.5">
      {rootFolders.map((f) => (
        <FolderCard
          key={f.id}
          folder={f}
          depth={0}
          childrenByParent={childrenByParent}
          notesByFolder={notesByFolder}
        />
      ))}
      <div className="space-y-2.5 mt-2">
        {rootNotes.map((n) => (
          <NoteCard key={n.id} note={n} depth={0} />
        ))}
      </div>
      {isEmpty && (
        <div className="text-center py-10 animate-fadeIn">
          <div className="text-4xl mb-3 opacity-60">🗂️</div>
          <div className="text-sm text-ink-500">还没有记事，点击上方 + 创建</div>
        </div>
      )}
    </div>
  );
}
