import { useCallback } from 'react';
import { useUiStore, type ConfirmOptions, type ConfirmResult } from '../stores/useUiStore';

type ConfirmInput = Omit<ConfirmOptions, 'mode'> & { mode?: ConfirmOptions['mode'] };

export function useConfirm() {
  const openConfirm = useUiStore((s) => s.openConfirm);

  return useCallback(async (options: ConfirmInput): Promise<ConfirmResult> => {
    const mode: ConfirmOptions['mode'] = options.mode ?? 'okCancel';
    return openConfirm({
      title: options.title,
      description: options.description,
      mode,
      confirmText: options.confirmText,
      cancelText: options.cancelText,
      discardText: options.discardText
    });
  }, [openConfirm]);
}
