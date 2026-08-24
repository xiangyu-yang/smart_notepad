import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUiStore } from '../stores/useUiStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useToast } from '../hooks/useToast';
import { useNavigateSafe } from '../hooks/useNavigateSafe';
import { useChat } from '../hooks/useChat';
import IconButton from './IconButton';
import ReasoningBlock from './ReasoningBlock';

interface AiPanelProps {
  onInsert: (text: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

export default memo(function AiPanel({ onInsert, textareaRef }: AiPanelProps) {
  const navigate = useNavigate();
  const navigateIfSafe = useNavigateSafe();
  const toast = useToast();
  const apiKey = useSettingsStore((s) => s.apiKey);
  const baseUrl = useSettingsStore((s) => s.baseUrl);
  const setShowAiPanel = useUiStore((s) => s.setShowAiPanel);
  const reasoningEnabled = useUiStore((s) => s.reasoningEnabled);
  const toggleReasoning = useUiStore((s) => s.toggleReasoning);

  const {
    currentSession,
    sessionsForCurrentNote,
    switchToSession,
    newSession,
    messages,
    loading,
    error,
    streamingId,
    sendMessage,
    stopStreaming,
    clear
  } = useChat();

  const [inputValue, setInputValue] = useState('');
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const sessionPickerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiTextareaRef = useRef<HTMLTextAreaElement>(null);

  // 本地 Ollama 不需要 API Key，只需 Base URL 即可
  const isConfigured = Boolean(baseUrl);

  useEffect(() => {
    // Close session picker when clicking outside.
    const onDocClick = (e: MouseEvent) => {
      if (!sessionPickerRef.current) return;
      if (!sessionPickerRef.current.contains(e.target as Node)) {
        setShowSessionPicker(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingId, scrollToBottom]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || loading) return;
    setInputValue('');
    sendMessage(text).catch((err) => {
      console.error('[AiPanel] sendMessage failed:', err);
    });
  }, [inputValue, loading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const sendKey = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'Enter' && !e.shiftKey && !sendKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getSelectionText = (): string => {
    const ta = textareaRef?.current;
    // Prefer the editor store's LAST SAVED selection instead of DOM because
    // the user already clicked this button → textarea blurred and DOM
    // selection info is unreliable.
    const store = useEditorStore.getState();
    const base = ta?.value ?? store.content ?? '';
    let start: number;
    let end: number;
    if (ta && typeof ta.selectionStart === 'number' && ta.selectionStart !== ta.selectionEnd) {
      // DOM still has a REAL non-empty selection, trust it
      start = ta.selectionStart;
      end = ta.selectionEnd;
    } else {
      // Fall back to the persisted pre-blur selection
      start = store.selectionStart;
      end = store.selectionEnd;
    }
    const len = base.length;
    start = Math.max(0, Math.min(start, len));
    end = Math.max(start, Math.min(end, len));
    if (start === end) return '';
    return base.slice(start, end);
  };

  const handleTemplate = (type: 'polish' | 'summary' | 'expand') => {
    if (loading) {
      toast.info('请先等待当前生成结束');
      return;
    }
    const selected = getSelectionText();
    let prompt = '';
    if (type === 'polish') {
      if (!selected) {
        toast.info('请先在编辑器中选中要润色的内容');
        return;
      }
      prompt = `请帮我润色以下内容，保持原意但语言更流畅自然：\n\n${selected}`;
    } else if (type === 'summary') {
      if (!selected) {
        toast.info('请先在编辑器中选中要总结的内容');
        return;
      }
      prompt = `请为以下内容写一段简洁的总结：\n\n${selected}`;
    } else if (type === 'expand') {
      if (!selected) {
        toast.info('请先在编辑器中选中要扩写的内容');
        return;
      }
      prompt = `请基于以下内容继续扩写，补充细节，保持上下文连贯：\n\n${selected}`;
    }
    // Directly call sendMessage (not via handleSend) so we don't depend on
    // inputValue state being flushed.
    sendMessage(prompt).catch((err) => {
      console.error('[AiPanel] template send failed:', err);
    });
  };

  const handleInsert = (content: string, idx: number) => {
    if (!content.trim()) {
      toast.info('内容为空，无法插入');
      return;
    }
    try {
      onInsert(content);
      toast.success(`已插入第 ${idx + 1} 条回复到光标位置`);
    } catch (e) {
      console.error('[AiPanel] insert failed:', e);
      toast.error('插入编辑器失败，请重试');
    }
  };

  const handleGoSettings = async () => {
    // Close panel first (so it's not visible during the guard dialog),
    // then go through the dirty-safe gate before actually navigating.
    setShowAiPanel(false);
    await navigateIfSafe(() => navigate('/settings'));
  };

  return (
    <div className="w-full h-full flex flex-col bg-paper-50 min-w-0">
      <div className="h-11 shrink-0 min-h-[44px] flex items-center justify-between px-4 border-b border-paper-200/80">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">💡</span>
          <div ref={sessionPickerRef} className="relative min-w-0">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowSessionPicker((v) => !v)}
              className="flex items-center gap-1 max-w-[210px] text-left min-w-0"
              title={sessionsForCurrentNote.length > 1 ? '点击查看本记事的所有对话会话' : undefined}
            >
              <span className="font-semibold text-ink-900 text-[15px] truncate min-w-0">
                {currentSession.title || '新对话'}
              </span>
              {sessionsForCurrentNote.length > 1 && (
                <span className="shrink-0 text-[10px] font-medium text-ink-400 bg-paper-100 border border-paper-200 rounded px-1.5 py-0.5">
                  {sessionsForCurrentNote.length}
                </span>
              )}
            </button>
            {showSessionPicker && sessionsForCurrentNote.length > 0 && (
              <div className="absolute z-40 left-0 top-full mt-1 w-[300px] max-h-[360px] overflow-y-auto bg-white border border-paper-200 rounded-xl shadow-lg py-1.5 animate-fadeIn thin-scrollbar">
                <div className="px-3 py-1 text-[10px] font-medium text-ink-400 uppercase tracking-wide">
                  本记事的对话历史
                </div>
                {sessionsForCurrentNote.map((se) => {
                  const isActive = se.id === currentSession.id;
                  return (
                    <button
                      key={se.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        switchToSession(se.id);
                        setShowSessionPicker(false);
                      }}
                      className={[
                        'w-full text-left px-3 py-2 flex flex-col gap-0.5 border-l-2 transition-colors duration-150',
                        isActive
                          ? 'bg-sage-50 border-sage-200'
                          : 'border-transparent hover:bg-paper-50'
                      ].join(' ')}
                    >
                      <div
                        className={[
                          'text-[13px] truncate',
                          isActive ? 'text-ink-900 font-semibold' : 'text-ink-800'
                        ].join(' ')}
                      >
                        {se.title || '新对话'}
                      </div>
                      <div className="text-[11px] text-ink-400 flex items-center gap-2">
                        <span>{se.messageCount} 条</span>
                        <span>·</span>
                        <span>
                          {new Date(se.updatedAt).toLocaleString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            month: '2-digit',
                            day: '2-digit'
                          })}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              stopStreaming();
              newSession();
            }}
            title="开启新对话（之前的对话会留在对话历史里）"
            className={[
              'no-drag h-7 px-2 rounded-lg text-[11px] font-medium',
              'text-ink-500 hover:text-ink-900 hover:bg-paper-100',
              'transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]'
            ].join(' ')}
          >
            🔄 新对话
          </button>
          <IconButton size="sm" variant="ghost" onClick={() => setShowAiPanel(false)} title="关闭">
            ✕
          </IconButton>
        </div>
      </div>

      {!isConfigured && (
        <div className="shrink-0 px-4 py-3 mx-3 mt-3 rounded-xl bg-accent-peach/25 border border-accent-peach/50">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-ink-700 leading-relaxed">
              ⚠️ 请先在设置中配置大模型 API
            </div>
            <button
              onClick={handleGoSettings}
              className="shrink-0 no-drag h-7 px-3 rounded-lg text-xs font-medium bg-white/70 text-ink-700 border border-paper-300 hover:bg-white hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
            >
              去设置
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">
        <div className="px-4 py-4 flex flex-col gap-3">
          {messages.length > 0 && (
            <div
              className="sticky top-0 z-10 -mx-4 -mt-4 mb-1 px-4 pt-4 pb-3 bg-paper-50/90 backdrop-blur-[2px] border-b border-paper-200/80 shrink-0 flex gap-2 animate-fadeIn"
              style={{ WebkitBackdropFilter: 'blur(2px)' }}
            >
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTemplate('polish')}
                disabled={!isConfigured || loading}
                title="润色当前编辑器选中文本"
                className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-sage-50 border border-sage-100 text-ink-700 hover:bg-sage-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                ✨ 润色
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTemplate('summary')}
                disabled={!isConfigured || loading}
                title="总结当前编辑器选中文本"
                className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-paper-100 border border-paper-200 text-ink-700 hover:bg-paper-200/60 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                📝 总结
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTemplate('expand')}
                disabled={!isConfigured || loading}
                title="扩写当前编辑器选中文本"
                className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-accent-mint/30 border border-accent-mint/50 text-ink-700 hover:bg-accent-mint/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                🚀 扩写
              </button>
            </div>
          )}
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8 animate-fadeIn">
            <div className="text-4xl mb-4 opacity-70">✍️</div>
            <div className="text-sm text-ink-500 mb-6 leading-relaxed">
              告诉我你想写什么，或者向我提问～
            </div>
            <div className="w-full flex flex-col gap-2">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTemplate('polish')}
                disabled={!isConfigured}
                className="w-full text-left px-4 py-3 rounded-xl bg-sage-50 border border-sage-100 text-sm text-ink-700 hover:bg-sage-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                ✨ 润色当前选中内容
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTemplate('summary')}
                disabled={!isConfigured}
                className="w-full text-left px-4 py-3 rounded-xl bg-paper-100 border border-paper-200 text-sm text-ink-700 hover:bg-paper-200/60 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                📝 为这段写个总结
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTemplate('expand')}
                disabled={!isConfigured}
                className="w-full text-left px-4 py-3 rounded-xl bg-accent-mint/30 border border-accent-mint/50 text-sm text-ink-700 hover:bg-accent-mint/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
              >
                🚀 继续扩写
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={msg.id}
              className={[
                'flex animate-slideUp',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              ].join(' ')}
            >
              <div
                className={[
                  'max-w-[88%] relative group',
                  msg.role === 'user'
                    ? 'bg-sage-100 rounded-tl-2xl rounded-br-lg rounded-tr-2xl px-3.5 py-2.5'
                    : 'bg-paper-200/60 border border-paper-300 rounded-tr-2xl rounded-bl-lg rounded-tl-2xl px-3.5 py-2.5'
                ].join(' ')}
              >
                {msg.role === 'user' ? (
                  <div className="text-[14px] text-ink-900 leading-relaxed whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                ) : (
                  <div className="text-[14px] text-ink-900 leading-relaxed">
                    {msg.reasoning && msg.reasoning.trim() && (
                      <ReasoningBlock
                        reasoning={msg.reasoning}
                        isStreaming={streamingId === msg.id && !msg.content.trim()}
                      />
                    )}
                    <div className="prose prose-note max-w-none prose-p:my-2 prose-headings:my-3 prose-headings:text-base prose-p:text-[14px] prose-li:text-[14px] prose-strong:text-ink-900 prose-code:text-[13px] prose-pre:text-[13px]">
                      {msg.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      ) : streamingId === msg.id && !msg.reasoning?.trim() ? (
                        <TypingDots />
                      ) : null}
                    </div>
                    {msg.content.trim() && (
                      <div className="flex justify-end mt-1 -mb-1 -mr-1">
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleInsert(msg.content, idx)}
                          className="no-drag h-6 px-2 rounded-md text-[11px] font-medium text-sage-700 bg-sage-50/70 border border-sage-100 opacity-0 group-hover:opacity-100 hover:bg-sage-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
                        >
                          插入到编辑器
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-4 py-2 mx-3 mb-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="shrink-0 px-3 pt-2 pb-3 border-t border-paper-200/80">
        <div className="flex items-center justify-between mb-1.5">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleReasoning}
            title={reasoningEnabled ? '思考过程：开（点击关闭，直接输出答案）' : '思考过程：关（点击开启，显示模型推理过程）'}
            className={[
              'no-drag h-6 px-2 rounded-md text-[11px] font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]',
              reasoningEnabled
                ? 'bg-amber-100 text-amber-700 border border-amber-200/70 hover:bg-amber-200/70'
                : 'text-ink-400 hover:text-ink-700 hover:bg-paper-100 border border-transparent'
            ].join(' ')}
          >
            🧠 思考 {reasoningEnabled ? '开' : '关'}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={aiTextareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConfigured ? '输入你的问题… (Enter 发送, Shift+Enter 换行)' : '请先在设置中配置 Base URL'}
            disabled={!isConfigured}
            rows={1}
            style={{ maxHeight: '144px', minHeight: '38px' }}
            className={[
              'flex-1 resize-none rounded-xl border border-paper-300 bg-white',
              'px-3 py-2 text-[14px] leading-relaxed text-ink-900 placeholder:text-ink-300',
              'outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 transition-all duration-150',
              'thin-scrollbar disabled:bg-paper-100 disabled:cursor-not-allowed'
            ].join(' ')}
          />
          {loading ? (
            <IconButton
              size="md"
              variant="solid"
              onClick={stopStreaming}
              title="停止生成"
              className="shrink-0"
            >
              ■
            </IconButton>
          ) : (
            <IconButton
              size="md"
              variant="solid"
              onClick={handleSend}
              disabled={!inputValue.trim() || !isConfigured}
              title="发送"
              className="shrink-0"
            >
              ➤
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
});

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5 px-1 inline-flex">
      <span
        className="w-1.5 h-1.5 rounded-full bg-ink-400"
        style={{ animation: 'typingDot 1.2s infinite 0s' }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-ink-400"
        style={{ animation: 'typingDot 1.2s infinite 0.2s' }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-ink-400"
        style={{ animation: 'typingDot 1.2s infinite 0.4s' }}
      />
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </div>
  );
}
