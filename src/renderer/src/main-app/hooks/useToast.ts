import { useMemo } from 'react';
import { useUiStore, type ToastType } from '../stores/useUiStore';

export function useToast() {
  const pushToast = useUiStore((s) => s.pushToast);

  return useMemo(() => ({
    pushToast: (text: string, type: ToastType = 'info') => {
      pushToast({ text, type });
    },
    success: (text: string) => pushToast({ text, type: 'success' }),
    error: (text: string) => pushToast({ text, type: 'error' }),
    info: (text: string) => pushToast({ text, type: 'info' })
  }), [pushToast]);
}
