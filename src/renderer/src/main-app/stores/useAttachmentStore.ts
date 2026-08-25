import { create } from 'zustand';
import type { Attachment } from '@shared/types';

export interface AttachmentState {
  /** Map<noteId, Attachment[]> */
  byNoteId: Record<string, Attachment[]>;
  loadingNoteId: string | null;
  uploading: boolean;
  setAttachmentsForNote: (noteId: string, items: Attachment[]) => void;
  addAttachment: (noteId: string, att: Attachment) => void;
  removeAttachment: (noteId: string, attId: string) => void;
  setLoadingNoteId: (noteId: string | null) => void;
  setUploading: (v: boolean) => void;
}

export const useAttachmentStore = create<AttachmentState>((set) => ({
  byNoteId: {},
  loadingNoteId: null,
  uploading: false,

  setAttachmentsForNote: (noteId, items) =>
    set((s) => ({
      byNoteId: { ...s.byNoteId, [noteId]: items }
    })),

  addAttachment: (noteId, att) =>
    set((s) => {
      const cur = s.byNoteId[noteId] ?? [];
      if (cur.some((a) => a.id === att.id)) {
        return {
          byNoteId: {
            ...s.byNoteId,
            [noteId]: cur.map((a) => (a.id === att.id ? att : a))
          }
        };
      }
      return {
        byNoteId: {
          ...s.byNoteId,
          [noteId]: [...cur, att]
        }
      };
    }),

  removeAttachment: (noteId, attId) =>
    set((s) => ({
      byNoteId: {
        ...s.byNoteId,
        [noteId]: (s.byNoteId[noteId] ?? []).filter((a) => a.id !== attId)
      }
    })),

  setLoadingNoteId: (noteId) => set({ loadingNoteId: noteId }),
  setUploading: (v) => set({ uploading: v })
}));
