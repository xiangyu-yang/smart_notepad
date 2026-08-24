import { create } from 'zustand';
import type { Note } from '@shared/types';

interface NoteState {
  notes: Note[];
  loading: boolean;
  currentId: string | null;

  loadAll: () => Promise<void>;
  loadOne: (id: string) => Promise<Note | null>;
  createNew: () => Promise<Note>;
  save: (noteId: string, patch: Partial<Note>) => Promise<Note>;
  remove: (id: string) => Promise<boolean>;
  setCurrentId: (id: string | null) => void;
  _updateOrPrepend: (note: Note) => void;
}

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],
  loading: false,
  currentId: null,

  setCurrentId: (id) => set({ currentId: id }),

  _updateOrPrepend: (note) => {
    set((s) => {
      const idx = s.notes.findIndex((n) => n.id === note.id);
      if (idx >= 0) {
        const next = s.notes.slice();
        next[idx] = note;
        next.sort((a, b) => b.updated_at - a.updated_at);
        return { notes: next };
      }
      return { notes: [note, ...s.notes] };
    });
  },

  loadAll: async () => {
    set({ loading: true });
    try {
      const list = await window.api['notes.list']();
      list.sort((a, b) => b.updated_at - a.updated_at);
      set({ notes: list });
    } finally {
      set({ loading: false });
    }
  },

  loadOne: async (id) => {
    const note = await window.api['notes.get'](id);
    if (note) {
      get()._updateOrPrepend(note);
    }
    return note;
  },

  createNew: async () => {
    const note = await window.api['notes.save']({
      title: '未命名记事',
      content: ''
    });
    get()._updateOrPrepend(note);
    set({ currentId: note.id });
    return note;
  },

  save: async (noteId, patch) => {
    const updated = await window.api['notes.save']({
      id: noteId,
      ...patch
    });
    get()._updateOrPrepend(updated);
    return updated;
  },

  remove: async (id) => {
    const ok = await window.api['notes.delete'](id);
    if (ok) {
      set((s) => {
        const next = s.notes.filter((n) => n.id !== id);
        const currentId = s.currentId === id ? null : s.currentId;
        return { notes: next, currentId };
      });
    }
    return ok;
  }
}));

if (typeof window !== 'undefined' && window.windowApi?.onNoteUpdated) {
  window.windowApi.onNoteUpdated((note) => {
    const state = useNoteStore.getState();
    if (state && typeof state._updateOrPrepend === 'function') {
      state._updateOrPrepend(note);
    }
  });
}
