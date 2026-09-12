import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../stores/useUiStore';

/**
 * PasswordDialog - 密码输入对话框（记事加解密专用）
 * UI 风格与 PromptDialog / ConfirmDialog 保持一致，挂在根 Layout 下统一渲染。
 * - 密码不明文回显（可点 👁 临时查看）
 * - 返回原始密码（不 trim，空格属于密码的一部分）
 * - options.error 用于"密码错误，请重新输入"等内联错误回显
 */
export function PasswordDialog() {
  const options = useUiStore((s) => s.passwordOptions);
  const closePasswordPrompt = useUiStore((s) => s.closePasswordPrompt);

  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次弹窗打开（含密码错误后重新打开）都清空并重新聚焦
  useEffect(() => {
    if (options) {
      setValue('');
      setReveal(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [options]);

  if (!options) return null;

  const confirmText = options.confirmText ?? '确认';
  const cancelText = options.cancelText ?? '取消';
  const radius = 'rounded-[10px]';
  const hasError = Boolean(options.error);

  const submit = () => {
    if (!value) return;
    closePasswordPrompt(value);
  };
  const cancel = () => closePasswordPrompt(null);

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
    <div className="fixed inset-0 z-[95] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-ink-900/30 backdrop-blur-[2px] animate-fadeIn"
        onClick={cancel}
      />
      <div className="relative w-[420px] max-w-[90vw] bg-paper-50 rounded-3xl shadow-popup animate-popIn p-7">
        <div className="text-lg font-semibold text-ink-900 mb-2 flex items-center gap-2">
          <span>🔐</span>
          <span>{options.title}</span>
        </div>
        {options.description && (
          <div className="text-sm text-ink-500 leading-relaxed mb-4">
            {options.description}
          </div>
        )}
        <div className="relative mb-2">
          <input
            ref={inputRef}
            type={reveal ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={options.placeholder ?? '请输入密码'}
            autoComplete="off"
            spellCheck={false}
            className={[
              'w-full h-11 pl-4 pr-11 rounded-xl bg-paper-100 hover:bg-paper-200/70',
              'focus:bg-paper-100 focus:ring-2 outline-none transition-all text-sm text-ink-900 placeholder:text-ink-300',
              hasError
                ? 'ring-2 ring-rose-400/70 focus:ring-rose-400/80'
                : 'focus:ring-sage-500/50'
            ].join(' ')}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            title={reveal ? '隐藏密码' : '显示密码'}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-paper-200 transition-colors text-sm"
          >
            {reveal ? '🙈' : '👁'}
          </button>
        </div>
        {hasError ? (
          <div className="text-[13px] text-rose-600 mb-4 flex items-center gap-1">
            <span>⚠️</span>
            <span>{options.error}</span>
          </div>
        ) : (
          <div className="mb-4" />
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={cancel}
            className={`px-4 py-2 ${radius} text-ink-500 hover:text-ink-900 bg-paper-200 hover:bg-paper-300 transition-all duration-150 hover:scale-[1.02] text-sm font-medium`}
          >
            {cancelText}
          </button>
          <button
            onClick={submit}
            disabled={!value}
            className={`px-5 py-2 ${radius} text-white bg-sage-600 hover:bg-sage-700 transition-all duration-150 hover:scale-[1.02] text-sm font-semibold shadow-card disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PasswordDialog;
