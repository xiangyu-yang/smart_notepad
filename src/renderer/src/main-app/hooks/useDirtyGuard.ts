import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/useEditorStore';
import { useNoteStore } from '../stores/useNoteStore';
import { useUiStore } from '../stores/useUiStore';
import type { CloseAction } from '@shared/types';

type DirtyAction = CloseAction;

export function useDirtyGuard() {
  const uiOpenConfirm = useUiStore((s) => s.openConfirm);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!window.events?.on) return;
    const unsub = window.events.on('requestDirtyState', async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const editor = useEditorStore.getState();
        const dirty = editor.dirty;

        if (!dirty) {
          await window.api['window.respondCloseBefore']('discard');
          return;
        }

        const result = await uiOpenConfirm({
          title: '还有未保存的内容',
          description: '离开前需要保存当前记事吗？',
          mode: 'saveDiscardCancel',
          confirmText: '保存',
          discardText: '不保存',
          cancelText: '取消'
        });

        let action: DirtyAction;
        if (result === true || result === 'save') action = 'save';
        else if (result === false || result === 'discard') action = 'discard';
        else action = 'cancel';

        if (action === 'save') {
          try {
            const noteId = useNoteStore.getState().currentId;
            if (noteId) {
              const s = useEditorStore.getState();
              const saved = await useNoteStore.getState().save(noteId, {
                title: s.title,
                content: s.content
              });
              useEditorStore.getState().markSaved(saved);
            }
            await window.api['window.allowClose']();
            await window.api['window.respondCloseBefore']('save');
          } catch (e) {
            console.error(e);
            await window.api['window.respondCloseBefore']('cancel');
          }
        } else {
          await window.api['window.respondCloseBefore'](action);
        }
      } finally {
        busyRef.current = false;
      }
    });
    return () => unsub && unsub();
  }, [uiOpenConfirm]);
}
