import { useState } from 'react';
import type { Folder, Note } from '@shared/types';
import { useFolderStore } from '../stores/useFolderStore';
import { useNoteStore } from '../stores/useNoteStore';
import { useConfirm } from '../hooks/useConfirm';
import { usePrompt } from '../hooks/usePrompt';
import { useToast } from '../hooks/useToast';
import NoteCard from './NoteCard';

interface Props {
  folder: Folder;
  depth: number;
  childrenByParent: Map<string | null, Folder[]>;
  notesByFolder: Map<string | null, Note[]>;
}

/** 递归统计文件夹（含所有后代）下的记事总数 */
export function countNotesUnder(
  folderId: string,
  childrenByParent: Map<string | null, Folder[]>,
  notesByFolder: Map<string | null, Note[]>
): number {
  let count = (notesByFolder.get(folderId) ?? []).length;
  const childFolders = childrenByParent.get(folderId) ?? [];
  for (const cf of childFolders) {
    count += countNotesUnder(cf.id, childrenByParent, notesByFolder);
  }
  return count;
}

/** 自定义 DnD MIME，标识拖拽源为记事 */
const NOTE_DND_MIME = 'application/x-note-id';

export default function FolderCard({ folder, depth, childrenByParent, notesByFolder }: Props) {
  const expanded = useFolderStore((s) => s.expanded[folder.id] ?? true);
  const toggleExpand = useFolderStore((s) => s.toggleExpand);
  const setCurrentFolderId = useFolderStore((s) => s.setCurrentFolderId);
  const createFolder = useFolderStore((s) => s.create);
  const renameFolder = useFolderStore((s) => s.rename);
  const removeFolder = useFolderStore((s) => s.remove);
  const moveNote = useNoteStore((s) => s.move);
  const loadAllNotes = useNoteStore((s) => s.loadAll);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();
  const [isDropTarget, setIsDropTarget] = useState(false);

  const childFolders = childrenByParent.get(folder.id) ?? [];
  const childNotes = notesByFolder.get(folder.id) ?? [];
  const totalCount = countNotesUnder(folder.id, childrenByParent, notesByFolder);

  const handleHeaderClick = () => {
    setCurrentFolderId(folder.id);
    toggleExpand(folder.id);
  };

  const handleCreateChild = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = await prompt({
      title: '新建子文件夹',
      description: '在「' + (folder.name || '未命名文件夹') + '」下新建子文件夹',
      defaultValue: '新建文件夹',
      placeholder: '文件夹名称',
      confirmText: '新建'
    });
    if (!name) return;
    try {
      await createFolder(name, folder.id);
      toast.success('已新建子文件夹');
    } catch {
      toast.error('新建失败');
    }
  };

  const handleRename = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = await prompt({
      title: '重命名文件夹',
      defaultValue: folder.name || '新建文件夹',
      placeholder: '文件夹名称',
      confirmText: '保存'
    });
    if (!name) return;
    await renameFolder(folder.id, name);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: '删除文件夹？',
      description:
        totalCount > 0
          ? `将连带删除 ${totalCount} 篇记事及其全部聊天历史，且无法恢复。`
          : '该文件夹为空，确认删除吗？',
      confirmText: '删除',
      cancelText: '取消'
    });
    if (!ok) return;
    const result = await removeFolder(folder.id);
    // 被级联删除的记事需同步到本地 notes 状态
    await loadAllNotes();
    toast.success(
      result.deletedNoteCount > 0
        ? `已删除文件夹（含 ${result.deletedNoteCount} 篇记事）`
        : '已删除文件夹'
    );
  };

  // ---- HTML5 DnD：作为记事拖入的 drop target ----
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(NOTE_DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsDropTarget(true);
    }
  };
  const onDragLeave = () => setIsDropTarget(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到根 drop target，避免重复处理
    setIsDropTarget(false);
    const noteId = e.dataTransfer.getData(NOTE_DND_MIME);
    if (!noteId) return;
    const note = useNoteStore.getState().notes.find((n) => n.id === noteId);
    if (!note) return;
    if (note.folder_id === folder.id) return; // 同文件夹无需移动
    const updated = await moveNote(noteId, folder.id);
    if (updated) toast.success('已移入文件夹');
    else toast.error('移动失败');
  };

  return (
    <div className="select-none">
      <div
        onClick={handleHeaderClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          'group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all duration-150',
          'hover:bg-paper-200/70',
          'bg-paper-100/60 border border-paper-200/60',
          isDropTarget ? 'ring-2 ring-sage-500 bg-sage-50' : '',
          useFolderStore.getState().currentFolderId === folder.id
            ? 'ring-1 ring-sage-400/60'
            : ''
        ].join(' ')}
        style={{ marginLeft: depth * 16 }}
      >
        <span className="text-sm shrink-0">{expanded ? '📂' : '📁'}</span>
        <span
          onDoubleClick={handleRename}
          className="flex-1 text-sm font-medium text-ink-800 truncate"
          title="双击重命名"
        >
          {folder.name?.trim() || '未命名文件夹'}
        </span>
        <span className="text-[11px] text-ink-400 shrink-0 tabular-nums">{totalCount}</span>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex gap-0.5 shrink-0">
          <button
            onClick={handleCreateChild}
            title="新建子文件夹"
            className="no-drag w-6 h-6 rounded-md hover:bg-paper-200 flex items-center justify-center text-ink-500 hover:text-sage-600 transition-colors text-xs"
          >
            ＋
          </button>
          <button
            onClick={handleDelete}
            title="删除文件夹"
            className="no-drag w-6 h-6 rounded-md hover:bg-paper-200 flex items-center justify-center text-ink-500 hover:text-rose-600 transition-colors text-xs"
          >
            🗑
          </button>
        </div>
      </div>

      {expanded && (childFolders.length > 0 || childNotes.length > 0) && (
        <div className="mt-1 space-y-1.5">
          {childFolders.map((cf) => (
            <FolderCard
              key={cf.id}
              folder={cf}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              notesByFolder={notesByFolder}
            />
          ))}
          {childNotes.map((n) => (
            <NoteCard key={n.id} note={n} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
