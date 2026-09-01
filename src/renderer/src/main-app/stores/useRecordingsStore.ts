import { create } from 'zustand';
import type { Recording } from '@shared/types';
import { useNoteStore } from './useNoteStore';

interface RecordingsState {
  /** 当前笔记的录音列表（按 created_at DESC） */
  recordings: Recording[];
  /** 当前加载的 noteId，防止切换笔记时旧数据覆盖 */
  loadedNoteId: string | null;
  /** 加载状态 */
  loading: boolean;

  /** 加载指定笔记的录音列表 */
  loadForNote: (noteId: string) => Promise<void>;
  /** 新建录音记录（持久化音频文件 + 转写文本文件 + DB 元数据） */
  createRecording: (input: {
    title: string;
    transcript: string;
    duration: number;
    /** 录音音频 Blob（WAV 格式），转为 number[] 传给主进程写磁盘 */
    audioBlob: Blob;
  }) => Promise<Recording | null>;
  /** 更新录音标题或转写文本 */
  updateRecording: (
    id: string,
    patch: Partial<Pick<Recording, 'title' | 'transcript'>>
  ) => Promise<void>;
  /** 删除录音 */
  deleteRecording: (id: string) => Promise<void>;
  /** 清空内存状态（切换笔记时调用） */
  reset: () => void;
}

export const useRecordingsStore = create<RecordingsState>((set, get) => ({
  recordings: [],
  loadedNoteId: null,
  loading: false,

  loadForNote: async (noteId: string) => {
    if (!noteId) return;
    set({ loading: true });
    try {
      const list = (await window.api['recordings.list'](noteId)) ?? [];
      set({ recordings: list, loadedNoteId: noteId, loading: false });
    } catch (e) {
      console.error('[recordings] loadForNote error:', e);
      set({ recordings: [], loading: false });
    }
  },

  createRecording: async (input) => {
    const noteId = useNoteStore.getState().currentId;
    if (!noteId) return null;
    try {
      // 将 Blob 转为 number[] 以通过 IPC 传输（contextBridge 不支持 Blob/ArrayBuffer）
      const arrayBuffer = await input.audioBlob.arrayBuffer();
      const audioUint8 = Array.from(new Uint8Array(arrayBuffer));
      const rec = await window.api['recordings.create']({
        note_id: noteId,
        title: input.title,
        transcript: input.transcript,
        duration: input.duration,
        audioUint8
      });
      // 插入到列表头部（DESC 排序）
      set((s) => ({ recordings: [rec, ...s.recordings] }));
      return rec;
    } catch (e) {
      console.error('[recordings] create error:', e);
      return null;
    }
  },

  updateRecording: async (id, patch) => {
    try {
      const updated = await window.api['recordings.update'](id, patch);
      if (updated) {
        set((s) => ({
          recordings: s.recordings.map((r) => (r.id === id ? updated : r))
        }));
      }
    } catch (e) {
      console.error('[recordings] update error:', e);
    }
  },

  deleteRecording: async (id) => {
    try {
      const ok = await window.api['recordings.delete'](id);
      if (ok) {
        set((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) }));
      }
    } catch (e) {
      console.error('[recordings] delete error:', e);
    }
  },

  reset: () => set({ recordings: [], loadedNoteId: null, loading: false })
}));
