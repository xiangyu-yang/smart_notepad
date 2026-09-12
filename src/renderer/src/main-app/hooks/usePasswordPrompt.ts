import { useCallback } from 'react';
import { useUiStore, type PasswordPromptOptions } from '../stores/useUiStore';

/**
 * usePasswordPrompt - 密码输入对话框 hook
 *
 * 与 usePrompt 的区别：
 *   - 输入框 type=password，返回值不做 trim（空格可以是密码的一部分）
 *   - 支持 error 选项，密码错误时可重新弹窗并内联提示
 *
 * 用法：
 *   const askPassword = usePasswordPrompt();
 *   const pwd = await askPassword({ title: '加密记事', confirmText: '加密' });
 *   if (pwd === null) return; // 用户取消
 */
export function usePasswordPrompt() {
  const openPasswordPrompt = useUiStore((s) => s.openPasswordPrompt);

  return useCallback(
    (options: PasswordPromptOptions): Promise<string | null> => {
      return openPasswordPrompt(options);
    },
    [openPasswordPrompt]
  );
}
