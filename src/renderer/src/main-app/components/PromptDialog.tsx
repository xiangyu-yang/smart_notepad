import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../stores/useUiStore';

/**
 * PromptDialog - 文本输入对话框（替代 Electron 不支持的 window.prompt）
 * UI 风格与 ConfirmDialog 保持一致，挂在根 Layout 下统一渲染。
 */
export function PromptDialog() {
  const options = useUiStore((s) => s.promptOptions);
  const closePrompt = useUiStore((s) => s.closePrompt);

  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 对话框打开时初始化值并聚焦
  useEffect(() => {
    if (options) {
      setValue(options.defaultValue ?? '');
      // 下一帧聚焦并全选，便于直接输入
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [options]);

  if (!options) return null;

  const confirmText = options.confirmText ?? '确认';
  const cancelText = options.cancelText ?? '取消';
  const radius = 'rounded-[10px]';

  const submit = () => {
    const trimmed = value.trim();
    closePrompt(trimmed || null);
  };
  const cancel = () => closePrompt(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-ink-900/30 backdrop-blur-[2px] animate-fadeIn"
        onClick={cancel}
      />
      <div className="relative w-[420px] max-w-[90vw] bg-paper-50 rounded-3xl shadow-popup animate-popIn p-7">
        <div className="text-lg font-semibold text-ink-900 mb-2">{options.title}</div>
        {options.description && (
          <div className="text-sm text-ink-500 leading-relaxed mb-4">{options.description}</div>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={options.placeholder ?? ''}
          className="w-full h-11 px-4 mb-6 rounded-xl bg-paper-100 hover:bg-paper-200/70 focus:bg-paper-100 focus:ring-2 focus:ring-sage-500/50 text-sm text-ink-900 placeholder:text-ink-300 outline-none transition-all"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={cancel}
            className={`px-4 py-2 ${radius} text-ink-500 hover:text-ink-900 bg-paper-200 hover:bg-paper-300 transition-all duration-150 hover:scale-[1.02] text-sm font-medium`}
          >
            {cancelText}
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className={`px-5 py-2 ${radius} text-white bg-sage-600 hover:bg-sage-700 transition-all duration-150 hover:scale-[1.02] text-sm font-semibold shadow-card disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PromptDialog;
