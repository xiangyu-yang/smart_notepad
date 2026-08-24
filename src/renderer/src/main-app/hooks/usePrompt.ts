import { useCallback } from 'react';
import { useUiStore, type PromptOptions } from '../stores/useUiStore';

/**
 * usePrompt - 文本输入对话框 hook（替代 Electron 不支持的 window.prompt）
 *
 * 用法：
 *   const prompt = usePrompt();
 *   const name = await prompt({ title: '新建文件夹', defaultValue: '新建文件夹' });
 *   if (!name) return; // 用户取消
 */
export function usePrompt() {
  const openPrompt = useUiStore((s) => s.openPrompt);
  return useCallback((options: PromptOptions): Promise<string | null> => {
    return openPrompt(options);
  }, [openPrompt]);
}
