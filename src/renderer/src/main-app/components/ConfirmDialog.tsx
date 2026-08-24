import { useUiStore } from '../stores/useUiStore';

export function ConfirmDialog() {
  const options = useUiStore((s) => s.confirmOptions);
  const closeConfirm = useUiStore((s) => s.closeConfirm);

  if (!options) return null;

  const isSaveMode = options.mode === 'saveDiscardCancel';
  const confirmText = options.confirmText ?? (isSaveMode ? '保存' : '确认');
  const discardText = options.discardText ?? '不保存';
  const cancelText = options.cancelText ?? '取消';

  const radius = 'rounded-[10px]';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-ink-900/30 backdrop-blur-[2px] animate-fadeIn"
        onClick={() => isSaveMode ? closeConfirm('cancel') : closeConfirm(false)}
      />
      <div className="relative w-[420px] max-w-[90vw] bg-paper-50 rounded-3xl shadow-popup animate-popIn p-7">
        <div className="text-lg font-semibold text-ink-900 mb-2">{options.title}</div>
        {options.description && (
          <div className="text-sm text-ink-500 leading-relaxed mb-6">{options.description}</div>
        )}
        <div className={[
          'flex gap-2',
          isSaveMode ? 'justify-end' : 'justify-end'
        ].join(' ')}>
          {isSaveMode ? (
            <>
              <button
                onClick={() => closeConfirm('cancel')}
                className={`px-4 py-2 ${radius} text-ink-500 hover:text-ink-900 bg-paper-200 hover:bg-paper-300 transition-all duration-150 hover:scale-[1.02] text-sm font-medium`}
              >
                {cancelText}
              </button>
              <button
                onClick={() => closeConfirm('discard')}
                className={`px-4 py-2 ${radius} text-ink-700 bg-paper-200 hover:bg-paper-300 transition-all duration-150 hover:scale-[1.02] text-sm font-medium`}
              >
                {discardText}
              </button>
              <button
                onClick={() => closeConfirm('save')}
                className={`px-5 py-2 ${radius} text-white bg-sage-600 hover:bg-sage-700 transition-all duration-150 hover:scale-[1.02] text-sm font-semibold shadow-card`}
              >
                {confirmText}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => closeConfirm(false)}
                className={`px-4 py-2 ${radius} text-ink-500 hover:text-ink-900 bg-paper-200 hover:bg-paper-300 transition-all duration-150 hover:scale-[1.02] text-sm font-medium`}
              >
                {cancelText}
              </button>
              <button
                onClick={() => closeConfirm(true)}
                className={`px-5 py-2 ${radius} text-white bg-sage-600 hover:bg-sage-700 transition-all duration-150 hover:scale-[1.02] text-sm font-semibold shadow-card`}
              >
                {confirmText}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
