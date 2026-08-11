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

/** 风格库引用（工单 15）：chat 只持 id+name，四维指南由服务端按 styleId 注入 */
interface StyleRef {
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
  // Retrying 态（UVSD Stage 2）：失败后保留最后输入，可一键重试
  const [lastSentContent, setLastSentContent] = useState<string | null>(null);
  // 12 工单：历史被自动压缩的提示（done.compressed）
  const [compressedNotice, setCompressedNotice] = useState(false);
  // 当前作品绑定（R3 决策）：顶部选择器，RAG 按作品过滤
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [novelId, setNovelId] = useState<number | null>(null);
  // 风格/技能选择（R4 决策）：胶囊单选/多选，注入 system 提示
  // 工单 15：风格引用真实风格库（{id,name}），请求带 styleId；演示三件套已删除
  const [style, setStyle] = useState<StyleRef | null>(null);
  const [styleLibrary, setStyleLibrary] = useState<StyleRef[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  // 技能链路（真实化）：从 /api/v1/skills 加载我的技能名，胶囊可选中注入
  const [mySkillNames, setMySkillNames] = useState<string[]>([]);
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
    // 初始加载会话列表 + 作品列表 + 技能（异步 fetch，setState 均在 promise 回调）
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
    // 技能链路（真实化）：加载我的技能名 → 胶囊可选中注入
    fetch("/api/v1/skills?scope=mine")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { skills: Array<{ name: string }> } | null) => {
        if (data) setMySkillNames(data.skills.map((s) => s.name));
      });
    // 风格库（工单 15）：加载我的风格库 → 胶囊可选中；蒸馏页回流（{styleId,name}）校验后选中
    fetch("/api/v1/styles")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { styles: StyleRef[] } | null) => {
        const lib = data ? data.styles : [];
        setStyleLibrary(lib);
        // R1/R2 回流：蒸馏页保存后"应用到对话"（styleId 引用），校验存在于库中才选中
        try {
          const raw = sessionStorage.getItem("mozhou_pending_style");
          if (raw) {
            const pending = JSON.parse(raw) as { styleId?: number; name?: string };
            sessionStorage.removeItem("mozhou_pending_style");
            const match = lib.find((s) => s.id === pending.styleId);
            if (match) {
              setStyle({ id: match.id, name: match.name });
              setError(null);
            } else if (pending.name) {
              // 旧格式/未知 id 兜底：按名匹配
              const byName = lib.find((s) => s.name === pending.name);
              if (byName) {
                setStyle({ id: byName.id, name: byName.name });
                setError(null);
              }
            }
          }
        } catch {
          // 暂存数据损坏则忽略
        }
      });
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
          setMessages([{ role: "user", content: "（导入拆解结果）" }, { role: "assistant", content: text }]); // eslint-disable-line react-hooks/set-state-in-effect -- 一次性初始化回流，同类豁免
        }
      }
    } catch {
      // 暂存数据损坏则忽略
    }
    // R1/R2 回流：读取搜索页暂存引用，作为消息插入对话流（工单 21，契约 23）
    try {
      const raw = sessionStorage.getItem("mozhou_pending_websearch");
      if (raw) {
        const pending = JSON.parse(raw) as {
          items?: Array<{ title: string; source: string; snippet: string; url: string }>;
        };
        sessionStorage.removeItem("mozhou_pending_websearch");
        if (pending?.items && pending.items.length > 0) {
          const text = pending.items
            .map(
              (i) => `【引用资料】${i.title}（${i.source}）：${i.snippet}\n来源：${i.url}`,
            )
            .join("\n\n");
          setMessages([{ role: "user", content: "（导入搜索引用）" }, { role: "assistant", content: text }]);
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
    setLastSentContent(content);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content }]);
    // 流式期间先插入占位 assistant 消息
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    let body = "";
    try {
      const res = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, model, content, novelId, styleId: style?.id ?? null, skills }),
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
      setLastSentContent(null); // 成功即清空重试缓存
    } catch (err) {
      setError((err as Error).message);
      setMessages((prev) => prev.slice(0, -1)); // 移除占位消息
    } finally {
      setStreaming(false);
      await refreshSessions();
    }
  }

  /** Retrying 态：重发上一次失败的内容 */
  async function retryLast() {
    if (!lastSentContent || streaming) return;
    setInput(lastSentContent);
    await send();
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
            {/* 风格胶囊（R4：单选，同时只生效一种文风；工单 15：数据源 = 我的风格库） */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-faint">风格</span>
              <button
                onClick={() => setStyle(null)}
                disabled={streaming}
                className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                  style === null
                    ? "bg-accent/15 text-accent"
                    : "border border-surface-2 text-faint hover:text-zinc-300"
                }`}
              >
                无
              </button>
              {styleLibrary.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyle({ id: s.id, name: s.name })}
                  disabled={streaming}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                    style?.id === s.id
                      ? "bg-accent/15 text-accent"
                      : "border border-surface-2 text-faint hover:text-zinc-300"
                  }`}
                >
                  {s.name}
                </button>
              ))}
              {styleLibrary.length === 0 && (
                <span className="text-xs text-zinc-600">（蒸馏页保存后出现）</span>
              )}
            </div>
            {/* 技能胶囊（R4 多选 + 真实技能库） */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-faint">技能</span>
              {mySkillNames.length === 0 && (
                <span className="text-xs text-zinc-600">（技能广场创建后出现）</span>
              )}
              {mySkillNames.map((sk) => (
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
            <div
              role="alert"
              className={`mb-2 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${
                /额度|次数已用完|402|429/.test(error)
                  ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-400"
                  : "border-red-500/30 bg-red-500/5 text-red-400"
              }`}
            >
              <span>
                {/额度|次数已用完|402|429/.test(error) && (
                  <span className="mr-2 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px]">
                    额度不足
                  </span>
                )}
                {error}
              </span>
              {/* Retrying 态：失败后提供重试（重发最后一条输入） */}
              {!streaming && lastSentContent && (
                <button
                  onClick={() => void retryLast()}
                  disabled={streaming}
                  className="shrink-0 rounded-full border border-current px-3 py-1 text-xs transition hover:bg-current/10 disabled:opacity-40"
                >
                  重试
                </button>
              )}
            </div>
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
