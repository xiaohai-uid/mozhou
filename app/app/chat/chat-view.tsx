"use client";

// 写作对话视图：消息列表 + SSE 流式 + 会话切换 + 模型选择（深色编辑器风）
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
    <main className="flex flex-1 gap-4 px-6 py-6">
      {/* 会话侧栏 */}
      <aside className="flex w-56 flex-col gap-2">
        <Button
          onClick={newSession}
          disabled={streaming}
          className="w-full bg-violet-600 hover:bg-violet-500"
        >
          ＋ 新会话
        </Button>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => void loadSession(s.id)}
              disabled={streaming}
              className={`truncate rounded-md px-3 py-2 text-left text-sm transition ${
                s.id === sessionId
                  ? "bg-violet-600/20 text-violet-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              title={s.title}
            >
              {s.title}
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-2 text-sm text-zinc-600">还没有会话</p>
          )}
        </div>
      </aside>

      {/* 对话区 */}
      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-zinc-800 bg-zinc-900/40">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h1 className="text-sm font-medium text-zinc-300">写作对话</h1>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            模型
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={streaming}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 outline-none focus:border-violet-500"
            >
              {MODELS.map((id) => (
                <option key={id} value={id}>
                  {id === "deepseek-v4-flash" ? "DeepSeek（免费）" : "GLM（免费）"}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !streaming && (
            <p className="pt-16 text-center text-zinc-600">
              与 AI 一起写作——发送第一句话开始
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6 ${
                  m.role === "user"
                    ? "bg-violet-600 text-white"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-200"
                }`}
              >
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
        </div>

        <footer className="border-t border-zinc-800 p-3">
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-400">
              {error}
            </p>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={streaming}
            rows={3}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </footer>
      </section>
    </main>
  );
}
