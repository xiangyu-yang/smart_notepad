import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { router } from '../App';
import { useNoteStore } from '../stores/useNoteStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useUiStore } from '../stores/useUiStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToast } from '../hooks/useToast';
import IconButton from '../components/IconButton';
import { formatShortDateTime } from '../utils/format-time';

const AiPanel = lazy(() => import('../components/AiPanel'));

type ViewMode = 'edit' | 'preview' | 'split';

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const loadOne = useNoteStore((s) => s.loadOne);
  const saveNote = useNoteStore((s) => s.save);
  const setCurrentId = useNoteStore((s) => s.setCurrentId);

  const editorTitle = useEditorStore((s) => s.title);
  const editorContent = useEditorStore((s) => s.content);
  const editorLoaded = useEditorStore((s) => s.loaded);
  const createdAt = useEditorStore((s) => s.createdAt);
  const updatedAt = useEditorStore((s) => s.updatedAt);
  // Inline dirty computation instead of `s.dirty` getter.  Zustand's
  // selector shallow-compare doesn't reliably notice changes to getter-based
  // computed properties on the store, leading to stale "disabled" state on
  // the save button after AI-generated content is inserted via setContent.
  const editorDirty = useEditorStore(
    (s) => s.loaded && (s.title !== s.pristineTitle || s.content !== s.pristineContent)
  );
  const setTitle = useEditorStore((s) => s.setTitle);
  const setContent = useEditorStore((s) => s.setContent);
  const setSelection = useEditorStore((s) => s.setSelection);
  const editorLoad = useEditorStore((s) => s.load);
  const markSaved = useEditorStore((s) => s.markSaved);
  const resetEditor = useEditorStore((s) => s.reset);

  const showAiPanel = useUiStore((s) => s.showAiPanel);
  const toggleShowAiPanel = useUiStore((s) => s.toggleShowAiPanel);
  const aiPanelWidth = useUiStore((s) => s.aiPanelWidth);
  const setAiPanelWidth = useUiStore((s) => s.setAiPanelWidth);

  // 拖动调整 AI 面板宽度
  const resizingRef = useRef(false);
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = aiPanelWidth;

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      // 向左拖 → 面板变宽
      const delta = startX - ev.clientX;
      setAiPanelWidth(startWidth + delta);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [aiPanelWidth, setAiPanelWidth]);

  const loadSettings = useSettingsStore((s) => s.loadAll);

  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const lastLoadedIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInsertAtCursor = useCallback(
    (text: string) => {
      if (!text) return;
      try {
        const st = useEditorStore.getState();
        const baseContent = st.content ?? '';
        // Use the selection SAVED in Zustand (updated by the textarea's
        // onSelect / onMouseUp / onKeyUp handlers).  This is the correct
        // pre-blur selection, unaffected by the user having just clicked
        // "插入到编辑器" inside AiPanel (which would blur the textarea and
        // reset DOM selectionStart/End to 0 or the end in some browsers).
        let start = st.selectionStart;
        let end = st.selectionEnd;

        // Sanity clamp
        const len = baseContent.length;
        start = Math.max(0, Math.min(start, len));
        end = Math.max(start, Math.min(end, len));

        const before = baseContent.slice(0, start);
        const after = baseContent.slice(end);
        const nextContent = before + text + after;
        const newCursor = start + text.length;

        st.setContent(nextContent);
        // Update the stored selection too so multiple back-to-back inserts
        // each land right after their predecessor (as the user would expect).
        st.setSelection(newCursor, newCursor);

        // Focus the textarea and restore the visual cursor in the DOM AFTER
        // React has flushed the new `value` prop to the underlying node.
        requestAnimationFrame(() => {
          try {
            const ta = textareaRef.current;
            if (!ta) return;
            ta.focus();
            const safe = Math.max(0, Math.min(newCursor, (ta.value ?? '').length));
            ta.selectionStart = safe;
            ta.selectionEnd = safe;
          } catch {
            // cursor assignment failures are cosmetic; the content is in
          }
        });
      } catch (e) {
        console.error('[NotePage] handleInsertAtCursor failed:', e);
        // Absolute last-resort: unconditionally append
        try {
          const st = useEditorStore.getState();
          st.setContent((st.content ?? '') + text);
        } catch (fallbackErr) {
          console.error('[NotePage] even fallback insert failed:', fallbackErr);
        }
      }
    },
    []
  );

  const handleSaveSelection = useCallback(
    () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const s = ta.selectionStart ?? 0;
      const e = ta.selectionEnd ?? s;
      setSelection(s, e);
    },
    [setSelection]
  );

  useEffect(() => {
    if (!id) return;
    setCurrentId(id);
  }, [id, setCurrentId]);

  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    loadSettings().catch(() => {});
  }, [loadSettings]);

  useEffect(() => {
    let cancelled = false;
    async function fetchNote() {
      if (!id) return;

      // Read editor state LIVE via getState — never put these in the dep
      // array.  If editorDirty/editorContent were listed as deps, any local
      // edit (typing, AI "插入到编辑器") would trigger this effect to re-run
      // and call loadOne() → editorLoad(note) which re-sets pristine state
      // from the DB, silently OVERWRITING whatever the user just wrote —
      // exactly the "插入内容一闪而过" bug reported by the user.
      const editorSnap = useEditorStore.getState();
      const dirtyNow = editorSnap.loaded && (
        editorSnap.title !== editorSnap.pristineTitle ||
        editorSnap.content !== editorSnap.pristineContent
      );

      // Auto-save current note before loading a DIFFERENT note (id changed).
      // We skip the save when this effect was triggered by a non-id change
      // (shouldn't happen anymore now deps are only [id], but keep the guard
      // for defensive programming.)
      if (
        lastLoadedIdRef.current !== id &&
        dirtyNow &&
        lastLoadedIdRef.current
      ) {
        try {
          await saveNote(lastLoadedIdRef.current, {
            title: editorSnap.title,
            content: editorSnap.content
          });
        } catch {
          // If auto-save fails, still proceed with loading the new note
        }
      }

      // Fast-path: same id already loaded and no local edits.  If the user
      // just made local edits (dirtyNow=true) we MUST NOT reload from DB —
      // that would destroy their in-flight edits (the "insert flash" bug).
      if (lastLoadedIdRef.current === id && !dirtyNow) return;
      // Same id already loaded AND dirty → the user is just editing, skip
      // the DB read.  A reload must only happen when the id changes.
      if (lastLoadedIdRef.current === id && dirtyNow) return;

      setLoading(true);
      setNotFound(false);
      try {
        const note = await loadOne(id);
        if (cancelled) return;
        if (!note) {
          setNotFound(true);
          resetEditor();
          return;
        }
        lastLoadedIdRef.current = id;
        editorLoad(note);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error('加载记事失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchNote();
    return () => {
      cancelled = true;
    };
    // Intentionally narrow deps: only [id, loadOne, editorLoad, resetEditor, toast, saveNote].
    // Do NOT add editorDirty / editorTitle / editorContent here — see long comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadOne, editorLoad, resetEditor, toast, saveNote]);

  // Reset editor state ONLY on actual component unmount, not on id changes.
  // Resetting on id changes would wipe the pristine state of note A while
  // the component is still mounted, making note→note auto-save unreliable.
  useEffect(() => {
    return () => {
      useEditorStore.getState().reset();
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (!id || !editorDirty) return;
    setSaving(true);
    try {
      const saved = await saveNote(id, {
        title: editorTitle,
        content: editorContent
      });
      markSaved(saved);
      toast.success('已保存');
    } catch (e) {
      console.error(e);
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  }, [id, editorDirty, editorTitle, editorContent, saveNote, markSaved, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  const cycleViewMode = () => {
    setViewMode((m) => (m === 'edit' ? 'preview' : m === 'preview' ? 'split' : 'edit'));
  };

  const viewLabel =
    viewMode === 'edit' ? '✏️ 编辑' : viewMode === 'preview' ? '👁 预览' : '⇔ 分栏';

  if (loading && !notFound) {
    return (
      <div className="h-full w-full flex items-center justify-center text-ink-300 animate-fadeIn">
        加载中…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="h-full w-full flex items-center justify-center p-10 animate-slideUp">
        <div className="text-center max-w-sm">
          <div className="text-6xl mb-4">📭</div>
          <div className="text-xl font-bold text-ink-900 mb-2">未找到该记事</div>
          <div className="text-sm text-ink-500 mb-6">可能已被删除，返回首页继续</div>
          <button
            onClick={() => router.navigate('/')}
            className="px-5 py-2.5 rounded-xl bg-sage-600 text-white text-sm font-semibold hover:bg-sage-700 transition-all hover:scale-[1.02] shadow-card"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const showEditPane = viewMode === 'edit' || viewMode === 'split';
  const showPreviewPane = viewMode === 'preview' || viewMode === 'split';

  return (
    <div className="h-full w-full flex flex-col min-h-0 animate-slideUp">
      <div className="h-13 shrink-0 min-h-[52px] flex items-center px-6 gap-3 border-b border-paper-200/80 bg-paper-50">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <input
            value={editorTitle}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="未命名记事"
            className={[
              'flex-1 min-w-0 bg-transparent outline-none text-[22px] font-bold text-ink-900',
              'placeholder:text-ink-300 border-0 px-1 py-1 rounded-md',
              'focus:bg-paper-100/60 transition-colors'
            ].join(' ')}
            style={{ letterSpacing: '-0.2px' }}
          />
          {editorDirty && (
            <span className="text-rose-500 font-bold text-lg leading-none select-none">
              *
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={cycleViewMode}
            title="切换视图模式"
            className={[
              'no-drag h-8 px-3 rounded-lg text-sm font-medium flex items-center gap-1.5',
              'text-ink-500 hover:text-ink-900 hover:bg-paper-100',
              'transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]'
            ].join(' ')}
          >
            {viewLabel}
          </button>
          <IconButton
            size="sm"
            variant={showAiPanel ? 'soft' : 'ghost'}
            onClick={toggleShowAiPanel}
            title={showAiPanel ? '关闭 AI 面板' : '打开 AI 面板'}
          >
            💡
          </IconButton>
          <div className="w-px h-6 bg-paper-200 mx-1" />
          <button
            onClick={handleSave}
            disabled={!editorDirty || saving}
            className={[
              'no-drag h-9 px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5',
              'transition-all duration-150',
              editorDirty && !saving
                ? [
                    'bg-sage-600 text-white shadow-card',
                    'hover:bg-sage-700 hover:scale-[1.02] active:scale-[0.99]',
                    'animate-pulseGlow hover:animate-none'
                  ].join(' ')
                : 'bg-paper-200 text-ink-300 cursor-not-allowed'
            ].join(' ')}
          >
            {saving ? '保存中…' : '保存'}
            {editorDirty && !saving && (
              <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
            )}
          </button>
        </div>
      </div>

      {editorLoaded && createdAt > 0 && (
        <div className="shrink-0 px-6 py-2 flex items-center justify-between gap-4 text-[12px] text-ink-400 border-b border-paper-200/60 bg-paper-50/80">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="opacity-70">创建于</span>
              <span className="text-ink-500 font-medium">{formatShortDateTime(createdAt)}</span>
            </span>
            <span className="opacity-40">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="opacity-70">最后修改</span>
              <span className="text-ink-500 font-medium">{formatShortDateTime(updatedAt)}</span>
            </span>
            {editorDirty && updatedAt > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-rose-500 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulseGlow" />
                  有未保存修改
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex">
          {showEditPane && (
            <div
              className={[
                'min-h-0 flex flex-col bg-paper-50',
                viewMode === 'split' ? 'w-1/2 border-r border-paper-200/80' : 'w-full'
              ].join(' ')}
            >
              <textarea
                ref={textareaRef}
                value={editorContent}
                onChange={(e) => {
                  setContent(e.target.value);
                  const ta = e.currentTarget;
                  setSelection(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
                }}
                onSelect={handleSaveSelection}
                onMouseUp={handleSaveSelection}
                onKeyUp={handleSaveSelection}
                onClick={handleSaveSelection}
                placeholder="从这里开始书写，支持 Markdown 语法…"
                className={[
                  'editor-textarea flex-1 w-full resize-none bg-transparent outline-none',
                  'font-sans text-[15px] leading-[1.85] text-ink-900 placeholder:text-ink-300',
                  'px-6 py-5 thin-scrollbar'
                ].join(' ')}
                spellCheck={false}
              />
            </div>
          )}

          {showPreviewPane && (
            <div
              className={[
                'min-h-0 bg-paper-50 overflow-y-auto thin-scrollbar',
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              ].join(' ')}
            >
              <div className="px-8 py-7 max-w-none prose prose-note animate-fadeIn">
                {editorContent ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editorContent}
                  </ReactMarkdown>
                ) : (
                  <div className="preview-empty-hint italic text-sm mt-4">
                    暂无内容，切换到编辑视图开始书写…
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 拖动分隔条：仅在 AI 面板显示时出现 */}
        {showAiPanel && (
          <div
            onMouseDown={handleResizeStart}
            className="shrink-0 w-1.5 cursor-col-resize hover:bg-sage-400/40 active:bg-sage-500/60 transition-colors bg-paper-200/50"
            title="拖动调整面板宽度"
          />
        )}

        <div
          className="shrink-0 border-l border-paper-200/80 overflow-hidden"
          style={{ width: showAiPanel ? aiPanelWidth : 0, minWidth: 0 }}
        >
          {showAiPanel && (
            <Suspense fallback={<div className="h-full bg-paper-50" />}>
              <AiPanel onInsert={handleInsertAtCursor} textareaRef={textareaRef} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
