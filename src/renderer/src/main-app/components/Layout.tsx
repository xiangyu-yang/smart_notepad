import { useEffect, useMemo } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useNoteStore } from '../stores/useNoteStore';
import { useFolderStore } from '../stores/useFolderStore';
import { useUiStore } from '../stores/useUiStore';
import NoteCard from './NoteCard';
import FolderTree from './FolderTree';
import ConfirmDialog from './ConfirmDialog';
import PromptDialog from './PromptDialog';
import ToastContainer from './Toast';
import { AttachmentPreview } from './AttachmentPreview';
import IconButton from './IconButton';
import { useToast } from '../hooks/useToast';
import { useNavigateSafe } from '../hooks/useNavigateSafe';
import { usePrompt } from '../hooks/usePrompt';

export default function Layout() {
  const navigate = useNavigate();
  const toast = useToast();
  const navigateIfSafe = useNavigateSafe();
  const prompt = usePrompt();

  const notes = useNoteStore((s) => s.notes);
  const loading = useNoteStore((s) => s.loading);
  const loadAll = useNoteStore((s) => s.loadAll);
  const createNew = useNoteStore((s) => s.createNew);

  const sidebarSearch = useUiStore((s) => s.sidebarSearch);
  const setSidebarSearch = useUiStore((s) => s.setSidebarSearch);

  useEffect(() => {
    // 并行加载记事与文件夹
    Promise.all([loadAll(), useFolderStore.getState().loadAll()]).catch((e) => {
      console.error(e);
      toast.error('加载失败');
    });
  }, []);

  const filteredNotes = useMemo(() => {
    const kw = sidebarSearch.trim().toLowerCase();
    if (!kw) return notes;
    return notes.filter(
      (n) =>
        (n.title ?? '').toLowerCase().includes(kw) ||
        (n.content ?? '').toLowerCase().includes(kw)
    );
  }, [notes, sidebarSearch]);

  const handleCreate = async () => {
    try {
      // 新建记事默认进入当前选中文件夹；未选中则根目录
      const targetFolder = useFolderStore.getState().currentFolderId;
      const note = await createNew(targetFolder);
      if (sidebarSearch) setSidebarSearch('');
      await navigateIfSafe(() => navigate(`/note/${note.id}`));
    } catch (e) {
      console.error(e);
      toast.error('创建失败');
    }
  };

  const handleCreateFolder = async () => {
    const name = await prompt({
      title: '新建文件夹',
      description: '为文件夹输入名称',
      defaultValue: '新建文件夹',
      placeholder: '文件夹名称',
      confirmText: '新建'
    });
    if (!name) return;
    try {
      // 顶部按钮始终创建根级文件夹；子文件夹通过 FolderCard 上的"＋"创建
      await useFolderStore.getState().create(name, null);
      toast.success('已新建文件夹');
    } catch (e) {
      console.error(e);
      toast.error('新建文件夹失败');
    }
  };

  const handleOpenSettings = () => navigateIfSafe(() => navigate('/settings'));

  const hasSearch = sidebarSearch.trim().length > 0;

  return (
    <div className="h-full w-full flex flex-col bg-paper-50 overflow-hidden">
      <div className="h-12 shrink-0 flex items-center drag-region border-b border-paper-200/80 relative">
        <div className="pl-20 w-[320px] shrink-0" />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md relative no-drag">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300 text-sm pointer-events-none">
              🔍
            </div>
            <input
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="搜索记事标题或内容…"
              className="w-full h-8 pl-9 pr-3 rounded-lg bg-paper-100 hover:bg-paper-200/70 focus:bg-paper-100 focus:ring-2 focus:ring-sage-500/50 text-sm text-ink-900 placeholder:text-ink-300 outline-none transition-all"
            />
          </div>
        </div>
        <div className="pr-4 shrink-0 flex items-center gap-1 no-drag">
          <IconButton
            size="sm"
            variant="ghost"
            onClick={handleOpenSettings}
            title="设置"
          >
            ⚙️
          </IconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-[320px] shrink-0 flex flex-col border-r border-paper-200/80 bg-paper-50/60">
          <div className="p-4 pb-2 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCreate}
                className={[
                  'no-drag h-12 rounded-[14px]',
                  'flex items-center justify-center gap-1.5',
                  'text-white font-semibold text-[14px]',
                  'bg-gradient-to-br from-sage-500 to-sage-600',
                  'shadow-card hover:shadow-cardHover',
                  'transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]',
                  'hover:brightness-105'
                ].join(' ')}
              >
                <span className="text-lg leading-none">+</span>
                <span>新建记事</span>
              </button>
              <button
                onClick={handleCreateFolder}
                className={[
                  'no-drag h-12 rounded-[14px]',
                  'flex items-center justify-center gap-1.5',
                  'font-semibold text-[14px] text-ink-700',
                  'bg-paper-100 hover:bg-paper-200/80',
                  'border border-paper-200',
                  'transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]'
                ].join(' ')}
              >
                <span className="text-base leading-none">📁</span>
                <span>新建文件夹</span>
              </button>
            </div>
            <div className="relative no-drag">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300 text-xs pointer-events-none">
                🔍
              </div>
              <input
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="在列表中筛选…"
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-paper-100 hover:bg-paper-200/70 focus:bg-paper-100 focus:ring-2 focus:ring-sage-500/50 text-sm text-ink-900 placeholder:text-ink-300 outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar px-4 pb-4 space-y-2.5">
            {loading && notes.length === 0 ? (
              <div className="text-center text-ink-300 text-sm py-10">加载中…</div>
            ) : hasSearch ? (
              filteredNotes.length === 0 ? (
                <div className="text-center py-10 animate-fadeIn">
                  <div className="text-4xl mb-3 opacity-60">🗂️</div>
                  <div className="text-sm text-ink-500">没有匹配的记事</div>
                </div>
              ) : (
                filteredNotes.map((note) => <NoteCard key={note.id} note={note} />)
              )
            ) : (
              <FolderTree />
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col bg-paper-50 animate-fadeIn">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
      <ConfirmDialog />
      <PromptDialog />
      <AttachmentPreview />
    </div>
  );
}
