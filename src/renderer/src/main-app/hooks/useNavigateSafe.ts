import { useCallback } from 'react';
import { useEditorStore } from '../stores/useEditorStore';
import { useNoteStore } from '../stores/useNoteStore';
import { useConfirm } from './useConfirm';
import { useToast } from './useToast';

/**
 * useNavigateSafe — manual dirty-check wrapper.
 *
 * We used to rely on React Router's useBlocker, but it has critical races when
 * the component mounts/unmounts together with the router transition itself
 * (e.g. Settings → history.back() → NotePage).  The blocker would see the
 * navigation that *caused* the mount and fire a spurious "unsaved changes"
 * dialog even though the page had literally just loaded from DB with pristine
 * state.
 *
 * Instead of trying to hook into the router's internals, we manually guard all
 * "navigate away" entry points through this hook.  Every call site that can
 * move off a dirty NotePage goes through `navigateIfSafe(go)` where `go`
 * performs the actual navigation.  If there is no dirty editor the navigation
 * proceeds unconditionally.
 */
export function useNavigateSafe() {
  const confirm = useConfirm();
  const toast = useToast();

  return useCallback(
    async <T>(go: () => T): Promise<boolean> => {
      const editor = useEditorStore.getState();
      const noteId = useNoteStore.getState().currentId;
      const dirty = editor.loaded && editor.dirty;

      if (!dirty) {
        go();
        return true;
      }

      const result = await confirm({
        title: '还有未保存的内容',
        description: '离开前需要保存当前记事吗？',
        mode: 'saveDiscardCancel',
        confirmText: '保存',
        discardText: '不保存',
        cancelText: '取消'
      });

      let proceed = false;
      if (result === true || result === 'save') {
        try {
          if (noteId) {
            const snap = useEditorStore.getState();
            const saved = await useNoteStore.getState().save(noteId, {
              title: snap.title,
              content: snap.content
            });
            useEditorStore.getState().markSaved(saved);
          }
          proceed = true;
        } catch (e) {
          console.error(e);
          toast.error('保存失败，已取消离开');
          proceed = false;
        }
      } else if (result === false || result === 'discard') {
        proceed = true;
      } else {
        proceed = false;
      }

      if (proceed) go();
      return proceed;
    },
    [confirm, toast]
  );
}
