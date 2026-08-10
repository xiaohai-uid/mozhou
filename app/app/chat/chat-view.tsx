"use client";

// 写作对话视图：消息列表 + SSE 流式 + 会话切换 + 模型选择 + 内联抽卡（多模型候选选优）
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp, Plus, Shuffle } from "@phosphor-icons/react/dist/ssr";
import { WritingToolsPanel } from "@/components/features/writing-tools-panel";
import { MODELS } from "@/lib/chat/models";

interface Session {
  id: number;
  title: string;
  novelId: number | null;
}

interface NovelSummary {
  id: number;
  name: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 抽卡候选（一次并行生成的多模型结果） */
interface DrawCandidate {
  model: string;
  text: string;
}

export function ChatView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState<string>(MODELS[0]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 12 工单：历史被自动压缩的提示（done.compressed）
  const [compressedNotice, setCompressedNotice] = useState(false);
  // 当前作品绑定（R3 决策）：顶部选择器，RAG 按作品过滤
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [novelId, setNovelId] = useState<number | null>(null);
  // 风格/技能选择（R4 决策）：胶囊单选/多选，注入 system 提示
  const [style, setStyle] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  // 内联抽卡状态：候选列表 + 抽卡中
  const [drawing, setDrawing] = useState(false);
  const [candidates, setCandidates] = useState<DrawCandidate[]>([]);
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
    // 会话绑定的作品回填选择器
    const s = sessions.find((x) => x.id === id);
    if (s) setNovelId(s.novelId);
  }, [sessions]);

  useEffect(() => {
    // 初始加载会话列表 + 作品列表（异步，避免 effect 内同步 setState）
    fetch("/api/v1/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sessions: Session[] } | null) => {
        if (data) setSessions(data.sessions);
      });
    fetch("/api/v1/novels")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { novels: NovelSummary[] } | null) => {
        if (data) setNovels(data.novels);
      });
    // R1/R2 回流：读取蒸馏页暂存风格，自动选中
    try {
      const raw = sessionStorage.getItem("mozhou_pending_style");
      if (raw) {
        const pending = JSON.parse(raw) as { name?: string };
        sessionStorage.removeItem("mozhou_pending_style");
        if (pending?.name) {
          setStyle(pending.name);
          setError(null);
        }
      }
    } catch {
      // 暂存数据损坏则忽略
    }
    // R1/R2 回流：读取拆解页暂存结果，作为消息插入对话流
    try {
      const raw = sessionStorage.getItem("mozhou_pending_deconstruct");
      if (raw) {
        const pending = JSON.parse(raw) as {
          chapter?: string | null;
          blocks?: Array<{ name: string; lines: string[] }>;
        };
        sessionStorage.removeItem("mozhou_pending_deconstruct");
        if (pending?.blocks) {
          const text = [
            `【第 ${pending.chapter ?? "?"} 章拆解结果】`,
            ...pending.blocks.map(
              (b) => `\n${b.name}：\n` + b.lines.map((l) => `  - ${l}`).join("\n"),
            ),
          ].join("");
          setMessages([{ role: "user", content: "（导入拆解结果）" }, { role: "assistant", content: text }]);
        }
      }
    } catch {
      // 暂存数据损坏则忽略
    }
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  async function newSession() {
    setStreaming(false);
    setError(null);
    const res = await fetch("/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ novelId }),
    });
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
        body: JSON.stringify({ sessionId, model, content, novelId, style, skills }),
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
            compressed?: boolean;
          };
          if (data.type === "start" && data.sessionId && !sessionId) {
            setSessionId(data.sessionId);
          } else if (data.type === "done" && data.compressed) {
            setCompressedNotice(true); // 12 工单：历史被压缩，UI 可见
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

  /** 内联抽卡（10 工单真实化）：同一指令多模型并行生成候选，选中后才作为消息插入（不落库） */
  async function drawCandidates() {
    const content = input.trim();
    if (!content || streaming || drawing) return;
    setDrawing(true);
    setError(null);
    setCandidates([]);
    try {
      // 真实抽卡：每个模型并发调 /api/v1/draw（不落库，仅生成候选）
      const results = await Promise.all(
        MODELS.map(async (m) => {
          const res = await fetch("/api/v1/draw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: m, instruction: content }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          if (!res.ok) throw new Error(data.error ?? `模型 ${m} 失败`);
          return { model: m, text: data.text ?? "" };
        }),
      );
      setCandidates(results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDrawing(false);
    }
  }

  /** 选用候选：作为助手消息插入对话流（占位替换，随下一条 send 落库） */
  function adoptCandidate(candidate: DrawCandidate) {
    setMessages((prev) => {
      // 若末尾是抽卡占位（空 assistant），替换之；否则追加
      const last = prev.at(-1);
      if (last && last.role === "assistant" && last.content === "") {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: candidate.text };
        return next;
      }
      return [...prev, { role: "assistant", content: candidate.text }];
    });
    setCandidates([]);
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
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-faint">
              作品
              <select
                value={novelId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setNovelId(v === "" ? null : Number(v));
                }}
                disabled={streaming}
                className="rounded-xl border border-surface-2 bg-zinc-950 px-3 py-1.5 text-zinc-200 outline-none transition focus:border-accent"
              >
                <option value="">未绑定</option>
                {novels.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
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
          </div>
          <div className="flex items-center gap-2">
            {/* 风格胶囊（R4：单选，同时只生效一种文风） */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-faint">风格</span>
              {style && !["无", "灰烬写实", "意象绵长"].includes(style) && (
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs text-accent">
                  {style}
                </span>
              )}
              {["无", "灰烬写实", "意象绵长"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s === "无" ? null : s)}
                  disabled={streaming}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                    style === s
                      ? "bg-accent/15 text-accent"
                      : "border border-surface-2 text-faint hover:text-zinc-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* 技能胶囊（R4：多选叠加） */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-faint">技能</span>
              {["去AI味", "伏笔管理"].map((sk) => (
                <button
                  key={sk}
                  onClick={() =>
                    setSkills((prev) =>
                      prev.includes(sk) ? prev.filter((x) => x !== sk) : [...prev, sk],
                    )
                  }
                  disabled={streaming}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                    skills.includes(sk)
                      ? "bg-accent/15 text-accent"
                      : "border border-surface-2 text-faint hover:text-zinc-300"
                  }`}
                >
                  {sk}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {compressedNotice && (
            <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 text-xs text-accent">
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              历史对话已自动压缩（摘要保留设定与进展），可继续写作
            </div>
          )}
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

          {/* 内联抽卡候选区 */}
          {(drawing || candidates.length > 0) && (
            <div className="space-y-2">
              <p className="text-xs text-faint">
                {drawing ? "抽卡中：多模型并行生成候选…" : "抽卡结果：点选一个作为回复"}
              </p>
              {drawing && (
                <div className="flex items-center gap-3 rounded-2xl border border-surface-2 bg-zinc-950 px-4 py-3">
                  <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />
                  <span className="text-sm text-muted">模型并行生成中…</span>
                </div>
              )}
              {candidates.map((c) => (
                <div
                  key={c.model}
                  className="rounded-2xl border border-surface-2 bg-zinc-950 p-4 transition hover:border-accent/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent">
                      {c.model === "deepseek-v4-flash" ? "DeepSeek" : "GLM"}
                    </span>
                    <button
                      onClick={() => adoptCandidate(c)}
                      className="rounded-full border border-surface-2 px-3 py-1 text-xs text-zinc-200 transition hover:border-accent hover:text-white"
                    >
                      选用
                    </button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                    {c.text}
                  </p>
                </div>
              ))}
            </div>
          )}
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
              onClick={() => void drawCandidates()}
              disabled={!input.trim() || streaming || drawing}
              aria-label="抽卡"
              title="多模型并行生成候选，选优插入"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-surface-2 text-zinc-300 transition hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <Shuffle size={16} weight="bold" />
            </button>
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
