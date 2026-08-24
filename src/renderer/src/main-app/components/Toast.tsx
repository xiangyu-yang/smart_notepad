import { useUiStore, type Toast as ToastItem } from '../stores/useUiStore';

const typeStyles: Record<ToastItem['type'], string> = {
  success: 'bg-sage-600 text-white',
  error: 'bg-ink-900 text-white',
  info: 'bg-ink-700 text-white'
};

const typeIcon: Record<ToastItem['type'], string> = {
  success: '✓',
  error: '!',
  info: 'i'
};

export function ToastContainer() {
  const toastList = useUiStore((s) => s.toastList);

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[100] flex flex-col gap-2 items-end">
      {toastList.map((t) => (
        <div
          key={t.id}
          className={[
            'pointer-events-auto min-w-[180px] max-w-[360px] px-4 py-2.5 rounded-xl',
            'shadow-popup flex items-center gap-3 animate-toastIn',
            typeStyles[t.type]
          ].join(' ')}
        >
          <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
            {typeIcon[t.type]}
          </div>
          <div className="text-sm font-medium leading-5">{t.text}</div>
        </div>
      ))}
    </div>
  );
}

export default ToastContainer;
