import { useEffect } from 'react';
import { useNoteStore } from '../stores/useNoteStore';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const notes = useNoteStore((s) => s.notes);
  const loading = useNoteStore((s) => s.loading);
  const createNew = useNoteStore((s) => s.createNew);
  const setCurrentId = useNoteStore((s) => s.setCurrentId);
  const navigate = useNavigate();

  // Clear current note ID when landing on home
  useEffect(() => {
    setCurrentId(null);
  }, [setCurrentId]);

  const hasNotes = notes.length > 0;

  const handleCreate = async () => {
    try {
      const note = await createNew();
      navigate(`/note/${note.id}`);
    } catch (e) {
      console.error('[HomePage] create error:', e);
    }
  };

  if (loading && notes.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-ink-300 animate-fadeIn">
        加载中…
      </div>
    );
  }

  return (
    <div
      className="h-full w-full flex items-center justify-center p-10 overflow-auto thin-scrollbar relative"
      style={{
        background:
          'radial-gradient(circle at 30% 20%, rgba(127,169,144,0.08), transparent 55%), radial-gradient(circle at 80% 70%, rgba(245,201,169,0.07), transparent 50%), radial-gradient(circle at 55% 85%, rgba(201,192,227,0.08), transparent 50%)'
      }}
    >
      <div className="text-center animate-slideUp max-w-md relative z-10">
        {!hasNotes && (
          <div className="inline-flex items-center justify-center mb-7 relative">
            <div
              className="w-28 h-28 rounded-3xl shadow-card relative overflow-hidden"
              style={{
                background:
                  'linear-gradient(135deg, #FBF9F5 0%, #F6F2E9 100%)'
              }}
            >
              <div
                className="absolute"
                style={{
                  left: '20px',
                  top: '22px',
                  width: '70px',
                  height: '66px',
                  borderRadius: '4px 10px 10px 4px',
                  background:
                    'linear-gradient(180deg, #FFFFFF 0%, #FBF9F5 100%)',
                  boxShadow:
                    'inset 0 0 0 1px rgba(223,211,184,0.6), 2px 3px 8px rgba(43,42,39,0.06)',
                  borderLeft: '3px solid #7FA990'
                }}
              >
                <div
                  className="absolute"
                  style={{
                    left: '8px',
                    top: '14px',
                    width: '46px',
                    height: '2px',
                    borderRadius: '2px',
                    background: 'rgba(182,177,164,0.55)'
                  }}
                />
                <div
                  className="absolute"
                  style={{
                    left: '8px',
                    top: '22px',
                    width: '38px',
                    height: '2px',
                    borderRadius: '2px',
                    background: 'rgba(182,177,164,0.45)'
                  }}
                />
                <div
                  className="absolute"
                  style={{
                    left: '8px',
                    top: '30px',
                    width: '42px',
                    height: '2px',
                    borderRadius: '2px',
                    background: 'rgba(182,177,164,0.4)'
                  }}
                />
                <div
                  className="absolute"
                  style={{
                    left: '8px',
                    top: '38px',
                    width: '30px',
                    height: '2px',
                    borderRadius: '2px',
                    background: 'rgba(182,177,164,0.35)'
                  }}
                />
              </div>

              <div
                className="absolute"
                style={{
                  right: '14px',
                  top: '18px',
                  width: '28px',
                  height: '52px',
                  transform: 'rotate(-18deg)',
                  transformOrigin: 'bottom left',
                  borderRadius: '2px 12px 12px 2px'
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(180deg, #5E8B72 0%, #486F5A 100%)',
                    clipPath:
                      'polygon(0 0, 100% 0, 100% 78%, 62% 100%, 0 100%)',
                    borderRadius: '2px 12px 2px 2px'
                  }}
                />
                <div
                  className="absolute"
                  style={{
                    left: '0',
                    bottom: '0',
                    width: '100%',
                    height: '14px',
                    background: '#F5C9A9',
                    clipPath: 'polygon(0 40%, 60% 100%, 0 100%)',
                    borderRadius: '0 0 0 2px'
                  }}
                />
                <div
                  className="absolute"
                  style={{
                    left: '3px',
                    top: '4px',
                    width: '3px',
                    height: '34px',
                    background: 'rgba(255,255,255,0.2)',
                    borderRadius: '2px'
                  }}
                />
              </div>

              <div
                className="absolute rounded-full pointer-events-none"
                style={{
                  left: '-8px',
                  top: '-4px',
                  width: '14px',
                  height: '14px',
                  background: 'rgba(127,169,144,0.2)',
                  filter: 'blur(2px)'
                }}
              />
              <div
                className="absolute rounded-full pointer-events-none"
                style={{
                  right: '-6px',
                  bottom: '8px',
                  width: '10px',
                  height: '10px',
                  background: 'rgba(245,201,169,0.3)',
                  filter: 'blur(2px)'
                }}
              />
            </div>
          </div>
        )}

        {hasNotes && (
          <div
            className={[
              'inline-flex items-center justify-center w-28 h-28 rounded-3xl mb-7',
              'bg-gradient-to-br from-paper-100 via-sage-50/60 to-accent-peach/20',
              'shadow-card'
            ].join(' ')}
          >
            <span className="text-5xl">📝</span>
          </div>
        )}

        <div className="text-2xl font-bold text-ink-900 mb-2 tracking-tight">
          {hasNotes ? '选择一篇记事开始' : '欢迎使用智能记事本'}
        </div>

        <div className="text-[14px] text-ink-500 leading-relaxed mb-8">
          {hasNotes
            ? '从左侧列表选择要编辑的记事，或点击按钮新建。所有内容保存在本地 SQLite，离线可用。'
            : '还没有记事？点击下方按钮创建你的第一条吧。支持 Markdown、AI 辅助。'}
        </div>

        <button
          onClick={handleCreate}
          className={[
            'no-drag inline-flex items-center gap-2 px-7 py-3 rounded-2xl',
            'text-white font-semibold text-[15px]',
            'bg-gradient-to-br from-sage-500 to-sage-600',
            'shadow-card hover:shadow-cardHover',
            'transition-all duration-150 hover:scale-[1.02] active:scale-[0.99]',
            'hover:brightness-105'
          ].join(' ')}
        >
          <span className="text-xl leading-none">+</span>
          <span>{hasNotes ? '新建记事' : '创建第一条记事'}</span>
        </button>

        {hasNotes && (
          <div className="mt-10 text-xs text-ink-300">
            共 {notes.length} 篇记事 · 本地安全存储
          </div>
        )}
      </div>
    </div>
  );
}
