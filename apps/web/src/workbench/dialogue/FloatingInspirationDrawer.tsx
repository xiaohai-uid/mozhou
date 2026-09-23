import React, { useState } from 'react';

export interface FloatingInspirationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToEditor: (text: string) => void;
}

export const FloatingInspirationDrawer: React.FC<FloatingInspirationDrawerProps> = ({
  isOpen,
  onClose,
  onInsertToEditor,
}) => {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    {
      role: 'assistant',
      text: '你好！我是你的网文头脑风暴伙伴。你可以向我咨询任何剧情转折、角色动机或世界观设定。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    const newMsgs = [...messages, { role: 'user' as const, text: userText }];
    setMessages(newMsgs);
    setInput('');
    setLoading(true);

    // Simulated streaming response / generation
    setTimeout(() => {
      const reply = `针对你的想法【${userText}】，建议从以下两个方向展开矛盾：\n1. 【伏笔暗扣】：让受害者身上携带一个本该属于主角的信物；\n2. 【情绪反扑】：反派的动机其实是为了掩盖更大的门派旧案。`;
      setMessages([...newMsgs, { role: 'assistant', text: reply }]);
      setLoading(false);
    }, 600);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 bg-zinc-950/95 border-l border-zinc-800 shadow-2xl flex flex-col backdrop-blur-xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
          <h3 className="text-sm font-semibold text-zinc-100">灵感与世界观推演</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-200 text-sm px-2 py-1 rounded-lg hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 font-sans text-xs">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-xl max-w-[90%] space-y-2 ${
              m.role === 'user'
                ? 'ml-auto bg-indigo-600/30 text-indigo-100 border border-indigo-500/40'
                : 'mr-auto bg-zinc-900 text-zinc-200 border border-zinc-800'
            }`}
          >
            <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
            {m.role === 'assistant' && (
              <div className="flex items-center justify-end pt-1 border-t border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => onInsertToEditor(m.text)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  一键插入正文 →
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="text-xs text-zinc-500 italic p-2 animate-pulse">
            灵感正在涌现...
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 border-t border-zinc-800 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="聊聊接下来的剧情脑洞..."
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </div>
  );
};
