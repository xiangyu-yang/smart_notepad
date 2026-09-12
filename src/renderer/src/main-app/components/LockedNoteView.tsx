import { useState } from 'react';
import { NOTE_CRYPTO_ERRORS } from '@shared/constants';
import { router } from '../App';
import { useNoteStore } from '../stores/useNoteStore';
import { useToast } from '../hooks/useToast';
import { getCryptoErrorCode, getIpcErrorMessage } from '../utils/ipc-error';

/**
 * LockedNoteView - 加密记事的锁定页
 * 打开加密记事时替代编辑器全屏展示：标题/正文密文绝不进入编辑器状态，
 * 只有输入加密时的同一密码、通过 GCM 认证后才解密加载。
 * 解密成功后 useNoteStore 更新，NotePage 会自动切换回普通编辑器。
 */
export default function LockedNoteView({ noteId }: { noteId: string }) {
  const decrypt = useNoteStore((s) => s.decrypt);
  const toast = useToast();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await decrypt(noteId, password);
      toast.success('已解密');
      // 不跳转：NotePage 监听到 is_encrypted 变 0 后自动加载明文编辑器
    } catch (e) {
      // invoke reject 会被 Electron 包装成
      // "Error invoking remote method ...: Error: <code>"，用归一化工具取真实错误码
      const code = getCryptoErrorCode(e);
      if (code === NOTE_CRYPTO_ERRORS.BAD_PASSWORD) {
        setError('密码错误，请输入加密这篇记事时设置的密码');
      } else if (code === NOTE_CRYPTO_ERRORS.NOT_FOUND) {
        setError('记事不存在或已被删除');
      } else if (code === NOTE_CRYPTO_ERRORS.NOT_ENCRYPTED) {
        // 状态已在其他入口解密，NotePage 会自动切走，这里不提示
      } else {
        setError(`解密失败：${getIpcErrorMessage(e) || '未知错误'}`);
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-10 animate-fadeIn">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 w-20 h-20 rounded-3xl bg-paper-100 shadow-card flex items-center justify-center text-4xl">
          🔒
        </div>
        <div className="text-xl font-bold text-ink-900 mb-2">此记事已加密</div>
        <div className="text-sm text-ink-500 leading-relaxed mb-7">
          标题与正文均已通过 AES-256-GCM 加密保存在本地。
          <br />
          请输入密码解锁后查看与编辑。
        </div>

        <div className="relative mb-2">
          <input
            type={reveal ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKeyDown}
            placeholder="输入密码"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className={[
              'w-full h-12 pl-4 pr-11 rounded-xl bg-paper-100 hover:bg-paper-200/70',
              'focus:bg-paper-100 focus:ring-2 outline-none transition-all text-[15px] text-ink-900 placeholder:text-ink-300',
              error
                ? 'ring-2 ring-rose-400/70 focus:ring-rose-400/80'
                : 'focus:ring-sage-500/50'
            ].join(' ')}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            title={reveal ? '隐藏密码' : '显示密码'}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-paper-200 transition-colors"
          >
            {reveal ? '🙈' : '👁'}
          </button>
        </div>

        {error && (
          <div className="text-[13px] text-rose-600 mb-3 flex items-center justify-center gap-1">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={submit}
          disabled={!password || busy}
          className={[
            'w-full h-11 mt-2 rounded-xl text-white text-sm font-semibold shadow-card',
            'bg-sage-600 hover:bg-sage-700 transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]',
            'disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed'
          ].join(' ')}
        >
          {busy ? '解密中…' : '🔓 解密记事'}
        </button>

        <button
          onClick={() => router.navigate('/')}
          className="mt-4 text-[13px] text-ink-400 hover:text-ink-700 transition-colors"
        >
          ← 返回首页
        </button>
      </div>
    </div>
  );
}
