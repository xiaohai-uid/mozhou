"use client";

// 写作对话视图：消息列表 + SSE 流式 + 会话切换 + 模型选择（深色编辑器风）
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp, Plus } from "@phosphor-icons/react/dist/ssr";
import { WritingToolsPanel } from "@/components/features/writing-tools-panel";
import { MODELS } from "@/lib/chat/models";

interface Session {
  id: number;
  title: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function ChatView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState<string>(MODELS[0]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/v1/sessions");
    if (!res.ok) return;
    const data = (await res.json()) as { sessions: Session[] };
    setSessions(data.sessions);
  }, []);

  const loadSession = useCallback(async (id: number) => {
    const res = await fetch(`/api/v1/sessions/${id}/messages`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ChatMessage[] };
    setMessages(data.messages);
    setSessionId(id);
  }, []);

  useEffect(() => {
    // 初始加载会话列表（异步，避免 effect 内同步 setState）
    fetch("/api/v1/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sessions: Session[] } | null) => {
        if (data) setSessions(data.sessions);
      });
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  async function newSession() {
    setStreaming(false);
    setError(null);
    const res = await fetch("/api/v1/sessions", { method: "POST" });
    if (!res.ok) return;
    const data = (await res.json()) as { session: Session };
    setMessages([]);
    setSessionId(data.session.id);
    await refreshSessions();
  }

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    setError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content }]);
    // 流式期间先插入占位 assistant 消息
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    let body = "";
    try {
      const res = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, model, content }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `请求失败（${res.status}）`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let current = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith("data:")) continue;
          const data = JSON.parse(line.slice(5).trim()) as {
            type: string;
            text?: string;
            sessionId?: number;
            message?: string;
          };
          if (data.type === "start" && data.sessionId && !sessionId) {
            setSessionId(data.sessionId);
          } else if (data.type === "delta" && data.text) {
            current += data.text;
            body = current;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: current };
              return next;
            });
          } else if (data.type === "error") {
            throw new Error(data.message ?? "生成失败");
          }
        }
      }
      if (!body) throw new Error("没有收到回复");
    } catch (err) {
      setError((err as Error).message);
      setMessages((prev) => prev.slice(0, -1)); // 移除占位消息
    } finally {
      setStreaming(false);
      await refreshSessions();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-1 gap-4 px-6 py-6">
      {/* 会话侧栏 */}
      <aside className="flex w-60 shrink-0 flex-col gap-3">
        <Button
          onClick={newSession}
          disabled={streaming}
          className="w-full rounded-full bg-accent hover:bg-violet-500"
        >
          <Plus size={16} weight="bold" className="mr-1" />
          新会话
        </Button>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => void loadSession(s.id)}
              disabled={streaming}
              className={`relative truncate rounded-xl px-3.5 py-2.5 text-left text-sm transition ${
                s.id === sessionId
                  ? "bg-accent/10 text-zinc-100"
                  : "text-zinc-400 hover:bg-surface hover:text-zinc-200"
              }`}
              title={s.title}
            >
              {s.id === sessionId && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
                />
              )}
              {s.title}
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="px-3.5 py-8 text-center">
              <p className="text-sm text-faint">还没有会话</p>
              <p className="mt-1 text-xs text-zinc-600">新建一个，开始与 AI 共同创作</p>
            </div>
          )}
        </div>
      </aside>

      {/* 对话区 */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-surface-2 bg-surface/40">
        <header className="flex items-center justify-between border-b border-surface-2 px-5 py-3.5">
          <h1 className="text-sm font-medium text-zinc-300">写作对话</h1>
          <label className="flex items-center gap-2 text-sm text-faint">
            模型
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={streaming}
              className="rounded-xl border border-surface-2 bg-zinc-950 px-3 py-1.5 text-zinc-200 outline-none transition focus:border-accent"
            >
              {MODELS.map((id) => (
                <option key={id} value={id}>
                  {id === "deepseek-v4-flash" ? "DeepSeek（免费）" : "GLM（免费）"}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 && !streaming && (
            <div className="flex h-full flex-col items-center justify-center gap-2 pt-16">
              <p className="text-sm text-faint">与 AI 一起写作</p>
              <p className="text-xs text-zinc-600">发送第一句话开始</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] whitespace-pre-wrap px-4 py-2.5 text-sm leading-6 ${
                  m.role === "user"
                    ? "rounded-2xl rounded-br-sm bg-accent text-white"
                    : "rounded-2xl rounded-bl-sm border border-surface-2 bg-zinc-950 text-zinc-200"
                }`}
              >
                {m.content}
                {m.role === "assistant" && streaming && i === messages.length - 1 && (
                  <span
                    aria-label="正在生成"
                    className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent"
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <footer className="border-t border-surface-2 p-4">
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-surface-2 bg-zinc-950 p-2 transition focus-within:border-accent">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={streaming}
              rows={3}
              placeholder={streaming ? "正在生成…" : "输入消息，Enter 发送，Shift+Enter 换行"}
              className="w-full resize-none bg-transparent px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-faint"
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || streaming}
              aria-label="发送"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-violet-500 active:translate-y-px disabled:opacity-40"
            >
              <ArrowUp size={16} weight="bold" />
            </button>
          </div>
        </footer>
      </section>

      {/* 写作工具面板（合同/任务书/机检/上下文） */}
      <WritingToolsPanel />
    </main>
  );
}
