import { create } from 'zustand';
import type { Note } from '@shared/types';

interface EditorState {
  title: string;
  content: string;
  pristineTitle: string;
  pristineContent: string;
  loaded: boolean;

  // Note metadata timestamps (from the Note loaded into this editor) so
  // UI can display 创建/修改时间 without re-fetching.
  createdAt: number;
  updatedAt: number;

  selectionStart: number;
  selectionEnd: number;

  get dirty(): boolean;

  load: (note: Note) => void;
  setTitle: (v: string) => void;
  setContent: (v: string) => void;
  setSelection: (start: number, end: number) => void;
  markSaved: (note: Note) => void;
  reset: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  title: '',
  content: '',
  pristineTitle: '',
  pristineContent: '',
  loaded: false,
  createdAt: 0,
  updatedAt: 0,
  selectionStart: 0,
  selectionEnd: 0,

  get dirty() {
    const s = get();
    if (!s.loaded) return false;
    return s.title !== s.pristineTitle || s.content !== s.pristineContent;
  },

  load: (note) => {
    const c = note.content ?? '';
    const pos = c.length;
    set({
      title: note.title ?? '',
      content: c,
      pristineTitle: note.title ?? '',
      pristineContent: c,
      loaded: true,
      createdAt: note.created_at ?? 0,
      updatedAt: note.updated_at ?? 0,
      selectionStart: pos,
      selectionEnd: pos
    });
  },

  setTitle: (v) => set({ title: v }),
  setContent: (v) => set({ content: v }),
  setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),

  markSaved: (note) => {
    const c = note.content ?? '';
    set({
      title: note.title ?? '',
      content: c,
      pristineTitle: note.title ?? '',
      pristineContent: c,
      loaded: true,
      createdAt: note.created_at ?? 0,
      updatedAt: note.updated_at ?? 0
    });
  },

  reset: () =>
    set({
      title: '',
      content: '',
      pristineTitle: '',
      pristineContent: '',
      loaded: false,
      createdAt: 0,
      updatedAt: 0,
      selectionStart: 0,
      selectionEnd: 0
    })
}));
