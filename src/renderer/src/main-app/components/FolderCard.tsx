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
/** 自定义 DnD MIME，标识拖拽源为文件夹 */
const FOLDER_DND_MIME = 'application/x-folder-id';

/**
 * 循环检测：检查 targetId 是否在 folderId 的子树中（含 folderId 自己）。
 * 用于移动文件夹时的合法性校验——不能把文件夹拖到自己或自己的后代下，否则形成环。
 */
function isInSubtree(
  folderId: string,
  targetId: string,
  childrenByParent: Map<string | null, Folder[]>
): boolean {
  if (folderId === targetId) return true;
  const stack = [folderId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenByParent.get(cur) ?? []) {
      if (c.id === targetId) return true;
      stack.push(c.id);
    }
  }
  return false;
}

export default function FolderCard({ folder, depth, childrenByParent, notesByFolder }: Props) {
  // 默认折叠：未记录展开状态的文件夹一律折叠，用户手动展开后由 store 持久化到 localStorage
  const expanded = useFolderStore((s) => s.expanded[folder.id] ?? false);
  const toggleExpand = useFolderStore((s) => s.toggleExpand);
  const setCurrentFolderId = useFolderStore((s) => s.setCurrentFolderId);
  const createFolder = useFolderStore((s) => s.create);
  const renameFolder = useFolderStore((s) => s.rename);
  const removeFolder = useFolderStore((s) => s.remove);
  const moveFolder = useFolderStore((s) => s.move);
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

  // ---- HTML5 DnD：文件夹作为拖拽源 ----
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(FOLDER_DND_MIME, folder.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // ---- HTML5 DnD：作为记事 / 文件夹拖入的 drop target ----
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    // 同时接受记事和文件夹拖拽
    if (!types.includes(NOTE_DND_MIME) && !types.includes(FOLDER_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDropTarget(true);
  };
  const onDragLeave = () => setIsDropTarget(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到根 drop target，避免重复处理
    setIsDropTarget(false);
    // 先尝试文件夹拖拽（getData 在 drop 阶段才有值）
    const srcFolderId = e.dataTransfer.getData(FOLDER_DND_MIME);
    if (srcFolderId) {
      if (srcFolderId === folder.id) return; // 拖到自己，无操作
      // 循环检测：目标不能是源的后代（含源自己），否则形成环
      if (isInSubtree(srcFolderId, folder.id, childrenByParent)) {
        toast.error('不能移动文件夹到自己的子文件夹下');
        return;
      }
      try {
        const updated = await moveFolder(srcFolderId, folder.id);
        if (updated) toast.success('已移动文件夹');
        else toast.error('移动失败');
      } catch (err) {
        // 后端循环检测兜底：捕获错误信息做 toast
        toast.error(err instanceof Error ? err.message : '移动失败');
      }
      return;
    }
    // 再尝试记事拖拽（已有逻辑）
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
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        draggable
        className={[
          'group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all duration-150',
          'hover:bg-paper-200/70',
          'bg-paper-100/60 border border-paper-200/60',
          isDropTarget ? 'ring-2 ring-sage-500 bg-sage-50' : '',
          useFolderStore.getState().currentFolderId === folder.id
            ? 'ring-1 ring-sage-400/60'
            : ''
        ].join(' ')}
        style={{
          marginLeft: depth * 16,
          // 强制启用元素拖拽，绕过父级 select-none（user-select:none）对
          // draggable 元素 dragstart 的抑制（Chromium 已知行为）
          WebkitUserDrag: 'element'
        } as React.CSSProperties}
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
            onMouseDown={(e) => e.stopPropagation()}
            title="新建子文件夹"
            className="no-drag w-6 h-6 rounded-md hover:bg-paper-200 flex items-center justify-center text-ink-500 hover:text-sage-600 transition-colors text-xs"
          >
            ＋
          </button>
          <button
            onClick={handleDelete}
            onMouseDown={(e) => e.stopPropagation()}
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
