import { useState, useEffect, memo } from 'react';

interface ReasoningBlockProps {
  reasoning: string;
  isStreaming?: boolean;
}

/**
 * 大模型思考过程展示块
 * - 思考中默认展开 + 脉冲指示器
 * - 思考完成默认折叠为"查看思考过程"，点击可展开
 */
function ReasoningBlock({ reasoning, isStreaming }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(true);

  // 思考完成（streaming 结束）后自动折叠，保持消息区整洁
  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    } else {
      // 思考刚结束 → 折叠
      setExpanded(false);
    }
  }, [isStreaming]);

  return (
    <div className="mb-2 rounded-lg bg-amber-50/60 border border-amber-200/70 overflow-hidden">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-amber-100/60 transition-colors"
      >
        <span className="text-[11px]">{isStreaming ? '💭' : '🧠'}</span>
        <span className="text-[11px] font-medium text-amber-700">
          {isStreaming ? '思考中…' : '思考过程'}
        </span>
        {isStreaming && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-amber-500"
            style={{ animation: 'reasoning-pulse 1.2s ease-in-out infinite' }}
          />
        )}
        <span className="ml-auto text-[10px] text-amber-600/70">
          {expanded ? '收起' : '展开'}
        </span>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 pt-0.5 text-[12px] leading-relaxed text-amber-900/80 whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto thin-scrollbar">
          {reasoning}
        </div>
      )}
      {isStreaming && (
        <style>{`
          @keyframes reasoning-pulse {
            0%, 100% { opacity: 0.4; transform: scale(0.85); }
            50% { opacity: 1; transform: scale(1.1); }
          }
        `}</style>
      )}
    </div>
  );
}

export default memo(ReasoningBlock);
