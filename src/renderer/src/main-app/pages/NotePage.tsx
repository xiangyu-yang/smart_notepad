import { useEffect, useState, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { renderToStaticMarkup } from 'react-dom/server';
import { router } from '../App';
import { useNoteStore } from '../stores/useNoteStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useUiStore } from '../stores/useUiStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAttachmentStore } from '../stores/useAttachmentStore';
import { useToast } from '../hooks/useToast';
import IconButton from '../components/IconButton';
import { AttachmentCard } from '../components/AttachmentCard';
import { formatShortDateTime } from '../utils/format-time';

const AiPanel = lazy(() => import('../components/AiPanel'));

type ViewMode = 'edit' | 'preview' | 'split';

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const loadOne = useNoteStore((s) => s.loadOne);
  const saveNote = useNoteStore((s) => s.save);
  const setCurrentId = useNoteStore((s) => s.setCurrentId);

  // --- 附件：状态 + 加载 ---
  const attachmentsById = useAttachmentStore((s) => s.byNoteId);
  const attachmentsLoading = useAttachmentStore((s) => s.loadingNoteId);
  const uploading = useAttachmentStore((s) => s.uploading);
  const setAttachmentsForNote = useAttachmentStore((s) => s.setAttachmentsForNote);
  const addAttachment = useAttachmentStore((s) => s.addAttachment);
  const setLoadingNoteId = useAttachmentStore((s) => s.setLoadingNoteId);
  const setUploading = useAttachmentStore((s) => s.setUploading);
  const attachments = useMemo(
    () => (id ? attachmentsById[id] ?? [] : []),
    [attachmentsById, id]
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // 切换记事时加载附件列表
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoadingNoteId(id);
    (async () => {
      try {
        const list = await window.api['attachments.list'](id);
        if (alive) setAttachmentsForNote(id, list);
      } catch (e) {
        console.error('[NotePage] load attachments error:', e);
      } finally {
        if (alive) setLoadingNoteId(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, setAttachmentsForNote, setLoadingNoteId]);

  /**
   * 上传一个或多个 File。
   * Electron contextBridge 不支持 File 对象直接传输，
   * 这里逐个用 FileReader 读成 base64 dataURL 再发送。
   * 为避免过大文件阻塞 IPC，单文件上限 512MB。
   *
   * 前置条件：记事必须已持久化到 DB。若 URL 上有 id 但未 save 过
   * （AttachmentRepository.create 会 reject 'note not found'），
   * 这里先执行一次 saveNote 再上传，避免"新建记事直接上传附件"场景失败。
   */
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!id) {
        toast.error('请先创建记事再上传附件');
        return;
      }
      const list = Array.from(files);
      if (list.length === 0) return;
      // 超大文件直接拒绝，避免浏览器 OOM / IPC 超时
      const MAX_BYTES = 512 * 1024 * 1024;
      for (const f of list) {
        if (f.size > MAX_BYTES) {
          toast.error(`文件「${f.name}」超过 512MB 上限`);
          return;
        }
      }

      // 先确保记事在 DB 中存在（避免新建记事直接上传报 'note not found'）
      try {
        const current = await window.api['notes.get'](id);
        if (!current) {
          // 注意：uploadFiles 在声明时 editorTitle/editorContent 尚未 declare，
          // 用 useEditorStore.getState() 在运行时取值，避免 TDZ 报错。
          const { title, content } = useEditorStore.getState();
          const saved = await saveNote(id, {
            title,
            content
          });
          useEditorStore.getState().markSaved(saved);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        toast.error(`保存记事失败，无法上传：${msg}`);
        return;
      }

      setUploading(true);
      try {
        for (const f of list) {
          const base64: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error ?? new Error('FileReader 读取失败'));
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(f);
          });
          const att = await window.api['attachments.upload']({
            noteId: id,
            originalName: f.name,
            mimeType: f.type || '',
            base64
          });
          addAttachment(id, att);
        }
        toast.success(
          list.length === 1
            ? `已上传：${list[0].name}`
            : `已上传 ${list.length} 个文件`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        console.error('[NotePage] upload error:', e);
        // 对常见已知错误给出更友好的提示
        if (msg.includes('no such table: attachments')) {
          toast.error('附件表尚未初始化，请重启应用后重试（主进程代码需重启生效）');
        } else if (msg === 'note not found') {
          toast.error('记事不存在，请先保存记事');
        } else {
          toast.error(`上传失败：${msg}`);
        }
      } finally {
        setUploading(false);
      }
    },
    [id, saveNote, addAttachment, setUploading, toast]
  );

  const onPickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
      // 清空：再次选择同一文件时仍会触发 change
      e.target.value = '';
    },
    [uploadFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const items = e.dataTransfer.items;
      const files: File[] = [];
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const f = items[i].kind === 'file' ? items[i].getAsFile() : null;
          if (f) files.push(f);
        }
      } else if (e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          files.push(e.dataTransfer.files[i]);
        }
      }
      if (files.length > 0) uploadFiles(files);
    },
    [uploadFiles]
  );

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

  const [exportingPdf, setExportingPdf] = useState(false);
  const handleExportPdf = async () => {
    // 先保存未保存的修改，使导出的 PDF 与用户当前看到的预览一致
    if (editorDirty && id) {
      try {
        const saved = await saveNote(id, {
          title: editorTitle,
          content: editorContent
        });
        markSaved(saved);
      } catch {
        // 保存失败也继续导出，不要阻塞
      }
    }
    setExportingPdf(true);
    try {
      // 把 Markdown 渲染成 HTML 字符串（与预览完全一致），传给主进程在独立 print 窗口内排版
      // 主进程创建隐藏 BrowserWindow 加载该 HTML，printToPDF 得到纯净 PDF（只含笔记文本，不含应用 UI）
      const innerHtml = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {editorContent || ''}
        </ReactMarkdown>
      );
      const result = await window.api['notes.exportPdf']({
        defaultName: editorTitle?.trim() || '未命名记事',
        html: innerHtml
      });
      if (result.canceled) return;
      if (result.success && result.path) {
        toast.success(`已导出 PDF：${result.path.split(/[/\\]/).pop()}`);
      } else {
        toast.error(result.error ? `导出 PDF 失败：${result.error}` : '导出 PDF 失败');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      console.error('[NotePage] export PDF error:', e);
      toast.error(`导出 PDF 失败：${msg}`);
    } finally {
      setExportingPdf(false);
    }
  };

  const viewLabel =
    viewMode === 'edit' ? '✏️ 编辑' : viewMode === 'preview' ? '👁 预览' : '⇔ 分栏';
  const showPdfButton = viewMode === 'preview' || viewMode === 'split';

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
          {showPdfButton && (
            <button
              onClick={handleExportPdf}
              disabled={exportingPdf}
              title="下载为 PDF"
              className={[
                'no-drag h-8 px-3 rounded-lg text-sm font-medium flex items-center gap-1.5',
                'transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]',
                exportingPdf
                  ? 'bg-paper-200 text-ink-400 cursor-not-allowed'
                  : 'text-ink-600 bg-paper-100 hover:bg-sage-100 hover:text-sage-700'
              ].join(' ')}
            >
              {exportingPdf ? '⏳ 导出中…' : '📄 下载 PDF'}
            </button>
          )}
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
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
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

      {/* 附件区：上传入口 + 附件列表（卡片式） */}
      <div
        className={[
          'shrink-0 border-t border-paper-200/80 bg-paper-50/60',
          'px-6 py-4 transition-colors duration-150',
          dragOver ? 'bg-sage-50/60' : ''
        ].join(' ')}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileInputChange}
        />
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-semibold text-ink-700">
              📎 附件
              <span className="ml-2 text-[11px] font-normal text-ink-400">
                {attachments.length > 0
                  ? `${attachments.length} 个文件`
                  : '暂无'}
              </span>
            </div>
            {uploading && (
              <div className="text-[11px] text-sage-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sage-500 animate-pulseGlow" />
                上传中…
              </div>
            )}
            {attachmentsLoading === id && !uploading && (
              <div className="text-[11px] text-ink-400">加载中…</div>
            )}
          </div>
          <button
            onClick={onPickFiles}
            disabled={uploading || !id}
            className={[
              'h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5',
              'transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]',
              uploading || !id
                ? 'bg-paper-200 text-ink-400 cursor-not-allowed'
                : 'bg-paper-100 hover:bg-sage-100 text-ink-700 hover:text-sage-700'
            ].join(' ')}
            title="从本地选择文件添加附件"
          >
            ➕ 上传文件
          </button>
        </div>

        {/* 拖拽提示覆盖层 */}
        {dragOver && (
          <div className="mb-3 border-2 border-dashed border-sage-400 rounded-xl px-4 py-6 text-center text-sage-700 text-[13px] bg-sage-50/70 animate-pulse">
            松开即可上传文件
          </div>
        )}

        {attachments.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {attachments.map((a) => (
              <AttachmentCard key={a.id} noteId={id!} attachment={a} />
            ))}
          </div>
        )}

        {!dragOver && attachments.length === 0 && (
          <div
            className="border-2 border-dashed border-paper-200 hover:border-paper-300 rounded-xl px-4 py-6 text-center cursor-pointer transition-colors duration-150"
            onClick={onPickFiles}
            title="点击或拖拽文件到这里上传"
          >
            <div className="text-ink-400 text-[13px]">
              <span className="font-medium text-ink-500">点击选择文件</span> 或
              拖拽文件到此处上传
            </div>
            <div className="text-[11px] text-ink-300 mt-1">单文件上限 512MB</div>
          </div>
        )}
      </div>
    </div>
  );
}
