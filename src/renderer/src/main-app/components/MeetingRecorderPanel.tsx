import { useState, useEffect, useCallback, memo, useRef } from 'react';
import type { Recording } from '@shared/types';
import { useUiStore } from '../stores/useUiStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useRecordingsStore } from '../stores/useRecordingsStore';
import { useNoteStore } from '../stores/useNoteStore';
import { useToast } from '../hooks/useToast';
import { useMeetingRecorder } from '../hooks/useMeetingRecorder';
import { useTranscription } from '../hooks/useTranscription';

interface MeetingRecorderPanelProps {
  /** 将转写文本插入到编辑器光标位置 */
  onInsert: (text: string) => void;
}

/**
 * 会议录音面板 —— 顶部按钮触发，独立于 AI 面板。
 *
 * 功能：
 * - 录音控制（开始/停止/暂停/恢复），录音中显示计时器
 * - 停止后自动转写，转写完成持久化到 SQLite
 * - 历史录音列表，每条可：查看转写、插入编辑器、编辑标题、删除
 * - 转写文本可编辑后保存
 */
export default memo(function MeetingRecorderPanel({ onInsert }: MeetingRecorderPanelProps) {
  const toast = useToast();
  const currentNoteId = useNoteStore((s) => s.currentId);
  const setShowMeetingRecorderPanel = useUiStore((s) => s.setShowMeetingRecorderPanel);

  const transcribeBaseUrl = useSettingsStore((s) => s.transcribeBaseUrl);
  const transcribeApiKey = useSettingsStore((s) => s.transcribeApiKey);
  const transcribeModel = useSettingsStore((s) => s.transcribeModel);
  const transcribeLanguage = useSettingsStore((s) => s.transcribeLanguage);

  const recordings = useRecordingsStore((s) => s.recordings);
  const loadedNoteId = useRecordingsStore((s) => s.loadedNoteId);
  const loadForNote = useRecordingsStore((s) => s.loadForNote);
  const createRecording = useRecordingsStore((s) => s.createRecording);
  const updateRecording = useRecordingsStore((s) => s.updateRecording);
  const deleteRecording = useRecordingsStore((s) => s.deleteRecording);

  const {
    status: recorderStatus,
    duration: recorderDuration,
    error: recorderError,
    start: startRecording,
    stop: stopRecording,
    pause: pauseRecording,
    resume: resumeRecording,
    reset: resetRecorder
  } = useMeetingRecorder();
  const { isTranscribing, transcribe, reset: resetTranscription } = useTranscription();

  // 当前展开查看的录音 id
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 编辑中的标题（id → 临时值）
  const [editingTitle, setEditingTitle] = useState<Record<string, string>>({});
  // 编辑中的转写文本（id → 临时值）
  const [editingTranscript, setEditingTranscript] = useState<Record<string, string>>({});
  const titleInputRef = useRef<HTMLInputElement>(null);

  // 切换笔记时加载录音列表
  useEffect(() => {
    if (currentNoteId && currentNoteId !== loadedNoteId) {
      loadForNote(currentNoteId);
    }
  }, [currentNoteId, loadedNoteId, loadForNote]);

  // 录音 hook 内部错误通过 toast 提示
  useEffect(() => {
    if (recorderError) toast.error(recorderError);
  }, [recorderError, toast]);

  const isRecording = recorderStatus === 'recording' || recorderStatus === 'paused';
  const isTranscribeConfigured = Boolean(transcribeBaseUrl);

  const formatDuration = useCallback((sec: number): string => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  const formatTimestamp = useCallback((ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (!isTranscribeConfigured) {
      toast.info('请先在设置中配置转写服务');
      return;
    }
    resetTranscription();
    await startRecording();
  }, [isTranscribeConfigured, toast, resetTranscription, startRecording]);

  const handleStopAndTranscribe = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      toast.error('录音内容为空');
      resetRecorder();
      return;
    }
    const recordedDuration = recorderDuration;
    try {
      const text = await transcribe(blob, {
        baseUrl: transcribeBaseUrl,
        apiKey: transcribeApiKey,
        model: transcribeModel,
        language: transcribeLanguage
      });
      if (text.trim()) {
        // 自动生成标题：取前 30 字
        const autoTitle = text.trim().slice(0, 30) + (text.trim().length > 30 ? '…' : '');
        const rec = await createRecording({
          title: autoTitle,
          transcript: text,
          duration: recordedDuration,
          audioBlob: blob
        });
        if (rec) {
          toast.success(`转写完成并已保存（时长 ${formatDuration(recordedDuration)}）`);
          setExpandedId(rec.id);
        } else {
          toast.error('转写完成但保存失败');
        }
      } else {
        toast.info('未识别到语音内容');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '转写失败';
      toast.error(message);
    } finally {
      resetRecorder();
    }
  }, [
    stopRecording,
    resetRecorder,
    recorderDuration,
    transcribe,
    transcribeBaseUrl,
    transcribeApiKey,
    transcribeModel,
    transcribeLanguage,
    createRecording,
    toast,
    formatDuration
  ]);

  const handleInsertTranscript = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      onInsert(text);
      toast.success('已插入到编辑器');
    },
    [onInsert, toast]
  );

  const handleSaveTitle = useCallback(
    async (id: string) => {
      const newTitle = editingTitle[id];
      if (newTitle === undefined) return;
      await updateRecording(id, { title: newTitle });
      toast.success('标题已更新');
    },
    [editingTitle, updateRecording, toast]
  );

  const handleSaveTranscript = useCallback(
    async (id: string) => {
      const newText = editingTranscript[id];
      if (newText === undefined) return;
      await updateRecording(id, { transcript: newText });
      toast.success('转写内容已更新');
    },
    [editingTranscript, updateRecording, toast]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteRecording(id);
      if (expandedId === id) setExpandedId(null);
      toast.success('录音已删除');
    },
    [deleteRecording, expandedId, toast]
  );

  const startEditTitle = useCallback((rec: Recording) => {
    setEditingTitle((s) => ({ ...s, [rec.id]: rec.title }));
  }, []);

  const startEditTranscript = useCallback((rec: Recording) => {
    setEditingTranscript((s) => ({ ...s, [rec.id]: rec.transcript }));
  }, []);

  return (
    <div className="w-full h-full flex flex-col bg-paper-50 min-w-0">
      {/* 顶部标题栏 */}
      <div className="h-11 shrink-0 min-h-[44px] flex items-center justify-between px-4 border-b border-paper-200/80">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">🎙</span>
          <span className="font-semibold text-ink-900 text-[15px] truncate">会议录音</span>
        </div>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowMeetingRecorderPanel(false)}
          title="关闭会议录音面板"
          className="no-drag h-6 w-6 flex items-center justify-center rounded-md text-ink-400 hover:text-ink-700 hover:bg-paper-100 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* 录音控制区 */}
      <div className="shrink-0 px-4 py-3 border-b border-paper-200/80 bg-paper-50/60">
        {!isRecording && !isTranscribing ? (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleStartRecording}
            disabled={!isTranscribeConfigured}
            title={isTranscribeConfigured ? '开始会议录音' : '请先在设置中配置转写服务'}
            className={[
              'no-drag w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2',
              'transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]',
              isTranscribeConfigured
                ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-card'
                : 'bg-paper-200 text-ink-400 cursor-not-allowed'
            ].join(' ')}
          >
            🎤 开始会议录音
          </button>
        ) : isRecording ? (
          /* 录音中：计时器 + 暂停/恢复 + 停止转写 */
          <div className="flex items-center gap-3 h-10 px-3 rounded-xl bg-rose-50 border border-rose-200">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
            <span className="text-[14px] font-mono font-medium text-rose-700 tabular-nums shrink-0">
              {formatDuration(recorderDuration)}
            </span>
            <span className="text-[11px] text-rose-400 shrink-0">
              {recorderStatus === 'paused' ? '已暂停' : '录制中'}
            </span>
            <div className="flex-1" />
            {recorderStatus === 'paused' ? (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={resumeRecording}
                className="no-drag h-7 px-2 rounded-md text-[12px] font-medium text-ink-600 hover:bg-paper-100 border border-paper-300 transition-all duration-150"
              >
                ▶ 恢复
              </button>
            ) : (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={pauseRecording}
                className="no-drag h-7 px-2 rounded-md text-[12px] font-medium text-ink-600 hover:bg-paper-100 border border-paper-300 transition-all duration-150"
              >
                ⏸ 暂停
              </button>
            )}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleStopAndTranscribe}
              className="no-drag h-7 px-2.5 rounded-md text-[12px] font-medium bg-rose-600 text-white hover:bg-rose-700 transition-all duration-150"
            >
              ⏹ 停止转写
            </button>
          </div>
        ) : (
          /* 转写中 */
          <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-sage-50 border border-sage-200">
            <span className="inline-block w-3.5 h-3.5 border-2 border-sage-300 border-t-sage-600 rounded-full animate-spin shrink-0" />
            <span className="text-[13px] text-sage-700">正在转写录音…</span>
          </div>
        )}
      </div>

      {/* 录音列表 */}
      <div className="flex-1 overflow-y-auto thin-scrollbar px-3 py-2 min-h-0">
        {recordings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <span className="text-3xl mb-3 opacity-40">🎙</span>
            <p className="text-sm text-ink-400 leading-relaxed">
              {isTranscribeConfigured
                ? '暂无录音记录\n点击上方按钮开始会议录音'
                : '请先在设置中配置转写服务'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recordings.map((rec) => {
              const isExpanded = expandedId === rec.id;
              const isEditingTitle = editingTitle[rec.id] !== undefined;
              const isEditingTranscript = editingTranscript[rec.id] !== undefined;
              return (
                <div
                  key={rec.id}
                  className={[
                    'rounded-lg border transition-all duration-150',
                    isExpanded
                      ? 'border-sage-300 bg-white shadow-sm'
                      : 'border-paper-200 bg-white/60 hover:bg-white hover:border-paper-300'
                  ].join(' ')}
                >
                  {/* 卡片头部 */}
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                  >
                    <span className="text-sm shrink-0">{isExpanded ? '📂' : '📁'}</span>
                    {isExpanded && isEditingTitle ? (
                      <input
                        ref={titleInputRef}
                        value={editingTitle[rec.id]}
                        onChange={(e) =>
                          setEditingTitle((s) => ({ ...s, [rec.id]: e.target.value }))
                        }
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => handleSaveTitle(rec.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            setEditingTitle((s) => {
                              const next = { ...s };
                              delete next[rec.id];
                              return next;
                            });
                          }
                        }}
                        className="flex-1 min-w-0 text-[14px] font-medium text-ink-900 bg-paper-50 border border-sage-300 rounded px-1.5 py-0.5 outline-none focus:border-sage-500"
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 text-[14px] font-medium text-ink-900 truncate"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startEditTitle(rec);
                        }}
                        title="双击编辑标题"
                      >
                        {rec.title || '未命名录音'}
                      </span>
                    )}
                    <span className="text-[11px] text-ink-400 shrink-0 tabular-nums">
                      {formatDuration(rec.duration)}
                    </span>
                  </div>

                  {/* 展开内容 */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-paper-100">
                      <div className="text-[10px] text-ink-400 mt-2 mb-1.5">
                        {formatTimestamp(rec.created_at)}
                      </div>
                      {isEditingTranscript ? (
                        <div className="mt-1">
                          <textarea
                            value={editingTranscript[rec.id]}
                            onChange={(e) =>
                              setEditingTranscript((s) => ({
                                ...s,
                                [rec.id]: e.target.value
                              }))
                            }
                            rows={6}
                            className="w-full text-[13px] leading-relaxed text-ink-800 bg-paper-50 border border-sage-300 rounded-lg px-2.5 py-2 outline-none focus:border-sage-500 resize-y thin-scrollbar"
                            autoFocus
                          />
                          <div className="flex gap-1.5 mt-1.5">
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSaveTranscript(rec.id)}
                              className="h-6 px-2 rounded-md text-[11px] font-medium bg-sage-600 text-white hover:bg-sage-700"
                            >
                              保存
                            </button>
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setEditingTranscript((s) => {
                                  const next = { ...s };
                                  delete next[rec.id];
                                  return next;
                                });
                              }}
                              className="h-6 px-2 rounded-md text-[11px] font-medium text-ink-500 hover:bg-paper-100 border border-paper-200"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="text-[13px] leading-relaxed text-ink-700 whitespace-pre-wrap break-words mt-1 cursor-text"
                          onDoubleClick={() => startEditTranscript(rec)}
                          title="双击编辑转写内容"
                        >
                          {rec.transcript || '（无转写内容）'}
                        </div>
                      )}

                      {/* 操作按钮 */}
                      <div className="flex gap-1.5 mt-2.5">
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleInsertTranscript(rec.transcript)}
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium bg-sage-100 text-sage-700 hover:bg-sage-200 border border-sage-200"
                        >
                          📝 插入编辑器
                        </button>
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => startEditTranscript(rec)}
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium text-ink-500 hover:bg-paper-100 border border-paper-200"
                        >
                          ✏️ 编辑转写
                        </button>
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => startEditTitle(rec)}
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium text-ink-500 hover:bg-paper-100 border border-paper-200"
                        >
                          改标题
                        </button>
                        <div className="flex-1" />
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleDelete(rec.id)}
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium text-rose-500 hover:bg-rose-50 border border-rose-200"
                        >
                          🗑 删除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
