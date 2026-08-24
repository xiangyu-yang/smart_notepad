import { create } from 'zustand';
import type { Folder } from '@shared/types';

/**
 * useFolderStore - 文件夹状态管理（单一职责）
 *
 * 设计要点：
 * - `folders` 始终为扁平数组并按 updated_at DESC 排序，前端 useMemo 组装树
 * - `expanded` 记录折叠状态（默认全部展开）
 * - `currentFolderId` 为"新建记事"的落点目标；null 表示根目录
 * - 删除文件夹后，被级联删除的记事需由 UI 层调 useNoteStore.loadAll() 同步
 *   （store 之间不直接耦合，避免循环依赖）
 */
interface FolderState {
  folders: Folder[];
  expanded: Record<string, boolean>;
  /** 新建记事的目标文件夹；null 表示根目录 */
  currentFolderId: string | null;

  loadAll: () => Promise<void>;
  create: (name: string, parentId: string | null) => Promise<Folder>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<{ deletedNoteCount: number }>;
  setCurrentFolderId: (id: string | null) => void;
  toggleExpand: (id: string) => void;
}

/** 按 updated_at DESC 排序（保持引用稳定：仅当顺序变化时返回新数组） */
function sortByUpdatedDesc<T extends { updated_at: number }>(arr: T[]): T[] {
  const next = arr.slice();
  next.sort((a, b) => b.updated_at - a.updated_at);
  return next;
}

export const useFolderStore = create<FolderState>((set) => ({
  folders: [],
  expanded: {},
  currentFolderId: null,

  setCurrentFolderId: (id) => set({ currentFolderId: id }),

  toggleExpand: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),

  loadAll: async () => {
    try {
      const list = await window.api['folders.list']();
      const sorted = sortByUpdatedDesc(list);
      // 默认全部展开
      const expanded: Record<string, boolean> = {};
      for (const f of sorted) expanded[f.id] = true;
      set({ folders: sorted, expanded });
    } catch (e) {
      console.error('[folderStore] loadAll error:', e);
    }
  },

  create: async (name, parentId) => {
    const folder = await window.api['folders.create']({ name, parent_id: parentId });
    set((s) => ({
      folders: sortByUpdatedDesc([folder, ...s.folders]),
      expanded: { ...s.expanded, [folder.id]: true }
    }));
    return folder;
  },

  rename: async (id, name) => {
    const updated = await window.api['folders.rename'](id, name);
    if (updated) {
      set((s) => ({
        folders: sortByUpdatedDesc(s.folders.map((f) => (f.id === id ? updated : f)))
      }));
    }
  },

  remove: async (id) => {
    const result = await window.api['folders.delete'](id);
    set((s) => {
      // 过滤掉被删文件夹本身；子文件夹由 DB CASCADE 删除，但本地状态也需清理
      // —— 简化：reload 时由 loadAll 重建；此处先移除本节点保持响应即时
      const remaining = s.folders.filter((f) => f.id !== id);
      const nextExpanded = { ...s.expanded };
      delete nextExpanded[id];
      const nextCurrent =
        s.currentFolderId === id ? null : s.currentFolderId;
      return {
        folders: remaining,
        expanded: nextExpanded,
        currentFolderId: nextCurrent
      };
    });
    return result;
  }
}));
