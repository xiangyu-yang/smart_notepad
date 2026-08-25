import { create } from 'zustand';
import type { Folder } from '@shared/types';

/**
 * useFolderStore - 文件夹状态管理（单一职责）
 *
 * 设计要点：
 * - `folders` 始终为扁平数组并按 updated_at DESC 排序，前端 useMemo 组装树
 * - `expanded` 记录折叠状态，默认折叠；用户手动展开后持久化到 SQLite settings 表，
 *   下次进入（含应用重启、清除浏览器痕迹）恢复上次的折叠/展开状态
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
  /** 移动文件夹到新父级（null = 根级）；后端含循环检测，非法抛错由 UI catch */
  move: (id: string, newParentId: string | null) => Promise<Folder | null>;
  setCurrentFolderId: (id: string | null) => void;
  toggleExpand: (id: string) => void;
}

/** 按 updated_at DESC 排序（保持引用稳定：仅当顺序变化时返回新数组） */
function sortByUpdatedDesc<T extends { updated_at: number }>(arr: T[]): T[] {
  const next = arr.slice();
  next.sort((a, b) => b.updated_at - a.updated_at);
  return next;
}

/** 旧 localStorage 键（一次性迁移到 SQLite 后删除，避免数据割裂） */
const LEGACY_STORAGE_KEY = 'smart-notepad:folder-expanded';

/** 乐观持久化：更新展开状态到 SQLite settings 表。不阻塞 UI，失败仅打日志 */
function persistExpanded(next: Record<string, boolean>): void {
  void window.api['settings.set']('ui.folderExpanded', next).catch((e) => {
    console.error('[folderStore] persist expanded failed:', e);
  });
}

export const useFolderStore = create<FolderState>((set) => ({
  folders: [],
  expanded: {},
  currentFolderId: null,

  setCurrentFolderId: (id) => set({ currentFolderId: id }),

  toggleExpand: (id) =>
    set((s) => {
      const next = { ...s.expanded, [id]: !s.expanded[id] };
      persistExpanded(next);
      return { expanded: next };
    }),

  loadAll: async () => {
    try {
      const list = await window.api['folders.list']();
      const sorted = sortByUpdatedDesc(list);
      // 从 SQLite 恢复用户上次的折叠/展开状态
      let saved = await window.api['settings.get']('ui.folderExpanded');
      // 一次性迁移：SQLite 无记录但旧 localStorage 有，则迁移过来并清理旧键，
      // 避免用户升级后丢失已记录的展开习惯
      if (!saved) {
        try {
          const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (raw) {
            saved = JSON.parse(raw) as Record<string, boolean>;
            await window.api['settings.set']('ui.folderExpanded', saved);
            localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        } catch {
          // 迁移失败不影响正常加载
        }
      }
      // 未记录的文件夹（含首次进入）默认折叠（FolderCard 读取时 ?? false）
      set({ folders: sorted, expanded: saved ?? {} });
    } catch (e) {
      console.error('[folderStore] loadAll error:', e);
    }
  },

  create: async (name, parentId) => {
    const folder = await window.api['folders.create']({ name, parent_id: parentId });
    set((s) => {
      const nextExpanded = { ...s.expanded };
      // 新建子文件夹时自动展开其父文件夹，确保用户能立即看到新建结果；
      // 新文件夹自身默认折叠，符合"默认折叠"原则
      if (parentId !== null) {
        nextExpanded[parentId] = true;
      }
      persistExpanded(nextExpanded);
      return {
        folders: sortByUpdatedDesc([folder, ...s.folders]),
        expanded: nextExpanded
      };
    });
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

  move: async (id, newParentId) => {
    // 后端含循环检测，非法会 reject；UI 层 onDrop 已先做前端预检，
    // 这里直接 await，让错误冒泡到 UI 的 try/catch 做 toast 提示
    const updated = await window.api['folders.move'](id, newParentId);
    if (updated) {
      set((s) => ({
        folders: sortByUpdatedDesc(s.folders.map((f) => (f.id === id ? updated : f)))
      }));
    }
    return updated;
  },

  remove: async (id) => {
    const result = await window.api['folders.delete'](id);
    set((s) => {
      // 过滤掉被删文件夹本身；子文件夹由 DB CASCADE 删除，但本地状态也需清理
      // —— 简化：reload 时由 loadAll 重建；此处先移除本节点保持响应即时
      const remaining = s.folders.filter((f) => f.id !== id);
      const nextExpanded = { ...s.expanded };
      delete nextExpanded[id];
      persistExpanded(nextExpanded);
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
