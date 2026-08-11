"use client";

// 章节编辑器 Mock Preview v2（V1.1 Journey ⑦ 章节级续写，UI-First 阶段）
// ⚠️ 全前端 Mock：无 DB / 无 API / 无 Provider——纯本地假数据 + 定时器模拟流式。
//
// 工作方式（用户定案 B：对话代理式，接写作对话的形态）：
//   正文编辑器 + 右侧 AI 对话面板。用户在章节上下文里与 AI 多轮对话，
//   AI 回复流式出现，完成后可「插入正文」；正文在对话期间**不锁定**，
//   可随时编辑；正文变化时旧消息的插入走冲突确认（灵笔 DocumentConflict/CandidateStale 语义）。
//   保存状态（未保存/已保存）为本地态展示。
//
// 状态机（对话式）：ChatIdle → ChatStreaming(Preparing/Streaming/Cancelling) → MessageDone
//   → InsertConfirm(正文已变) / Inserted / Cancelled / Error。Empty 变体：空章节空态"让 AI 起笔"。
// UI Frozen 后 progressive swap：mock 函数族换真实契约，组件形态保持。
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  DotsThree,
  Pause,
  Sparkle,
  Warning,
} from "@phosphor-icons/react/dist/ssr";

type MessageStatus = "streaming" | "done" | "stopped" | "error";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  /** 本次回复生效的技能（发送时快照，UI 展示注入语义） */
  skills: string[];
  /** 生成时的正文快照（冲突检测：插入时与当前正文比对） */
  snapshot: string;
  /** 已插入正文 */
  inserted: boolean;
  /** 冲突确认中 */
  confirmInsert: boolean;
  /** 演示用错误码 */
  errorCode?: string;
}

type DemoMode = "normal" | "no-model" | "fail" | "empty";

/** Mock 模型（仅演示；UI Frozen 后换真实模型契约） */
const MOCK_MODELS = ["deepseek-v4-flash", "glm-4.5-flash"] as const;

/** 示例正文（有正文示例；与产品文风一致） */
const EXAMPLE_BODY = `黄土坡上，老周把锄头抡起来，一下，一下。土腥气顺着风钻进鼻子里，他嗅了嗅，又嗅了嗅。这地是沉的，锄刃磕下去，像是磕在铁上。

村里人叫他周三两，因为他称地从来只称三两。他蹲在田埂上，把土块捻碎了，凑到眼前看。墒够，他说。旁边的后生不信，拿脚跺了跺，果然湿气上来。

天擦黑的时候，沟里的水声大起来。老周收了锄，沿着垄沟走回去。家里灶上煨着粥，他媳妇在门口纳鞋底，见他回来，也不说话，只把粥碗往前推了推。`;


let msgSeq = 0;

export function ChapterEditorView() {
  const params = useSearchParams();
  const { chapterId: pathChapterId } = useParams<{ chapterId: string }>();
  const chapterId = Number(pathChapterId);
  const novelId = Number(params.get("novelId") ?? 0);
  const ch = params.get("ch") ?? "001";
  const title = params.get("title") ?? "第一章";

  // 工单 16：正文从真实 API 加载；工单 17：对话消息真实持久化（留存 Q1）
  const [body, setBody] = useState("");
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "failed">("saved");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 工单 17：我的技能（真实 /api/v1/skills?scope=mine）+ 场景技能（内置）
  const [mySkillNames, setMySkillNames] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [subphase, setSubphase] = useState<"preparing" | "streaming" | "cancelling">("preparing");
  const [model, setModel] = useState<string>(MOCK_MODELS[0]);
  const [styleId, setStyleId] = useState<number | null>(null);
  // v3 技能驱动对话：可用技能按章节状态切换（空章节=起笔，非空=续写），默认选中场景技能
  const [activeSkills, setActiveSkills] = useState<string[]>(["章节续写"]);
  const [demoMode, setDemoMode] = useState<DemoMode>("normal");
  const [demoOpen, setDemoOpen] = useState(false);

  // 代际计数：每条消息一轮生成；+1 使旧代定时回调全部失效（防竞态）
  const genIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dirtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 工单 17：真实风格库（styleId 注入路径）
  const [styleLibrary, setStyleLibrary] = useState<Array<{ id: number; name: string }>>([]);
  // 工单 18：插入中 + 插入错误提示
  const [insertingId, setInsertingId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** 工单 16：加载真实正文（GET 单章含 content）+ 工单 17：加载对话历史（留存 Q1）+ 我的技能 */
  useEffect(() => {
    if (!novelId || !chapterId) return;
    fetch(`/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { chapter?: { content?: string } } | null) => {
        if (data?.chapter) {
          setBody(data.chapter.content ?? "");
          setBodyLoaded(true);
        }
      });
    fetch(`/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { messages?: ChatMessage[] } | null) => {
        if (data?.messages) setMessages(data.messages);
      });
    fetch("/api/v1/skills?scope=mine")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { skills?: Array<{ name: string }> } | null) => {
        if (data?.skills) setMySkillNames(data.skills.map((s) => s.name));
      });
    fetch("/api/v1/styles")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { styles?: Array<{ id: number; name: string }> } | null) => {
        if (data?.styles) setStyleLibrary(data.styles);
      });
  }, [novelId, chapterId]);

  /** 工单 16：保存正文（PATCH content；自动保存与显式保存同端点；content 显式传参防闭包过期） */
  async function saveBody(content: string): Promise<boolean> {
    if (!novelId || !chapterId) return false;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("保存失败");
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("failed");
      return false;
    }
  }

  const emptyChapter = body.trim().length === 0;

  /** 可用技能（空章节=起笔场景；非空=续写场景；内置场景技能 + 我的技能） */
  const availableSkills: string[] = [
    ...(emptyChapter ? ["章节起笔"] : ["章节续写"]),
    ...mySkillNames,
  ].filter((n, i, arr) => arr.indexOf(n) === i); // 去重（我的技能里可能有同名）

  function toggleSkill(name: string) {
    setActiveSkills((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  }

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /** 正文编辑：对话期间正文永不锁定；编辑置未保存 + 2s 防抖自动保存（工单 16 真实落盘） */
  function onBodyChange(v: string) {
    setBody(v);
    setSaveState("dirty");
    if (dirtyTimerRef.current) clearTimeout(dirtyTimerRef.current);
    dirtyTimerRef.current = setTimeout(() => {
      void saveBody(v);
    }, 2000);
  }

  /** mockSendChat → sendChat（工单 17 真实化）：POST chat SSE 流式，技能驱动；停止=abort */
  async function sendChat(text?: string, skillsOverride?: string[]) {
    const content = (text ?? input).trim();
    if (!content || streaming || demoMode === "no-model") return;
    const skills =
      skillsOverride ??
      (() => {
        const kept = activeSkills.filter((s) => availableSkills.includes(s));
        return kept.length > 0 ? kept : [emptyChapter ? "章节起笔" : "章节续写"];
      })();
    setInput("");
    setSubphase("preparing");
    setStreaming(true);
    const replyId = ++msgSeq;
    const snapshot = body; // 本地快照（工单 18 换服务端快照比对）
    setMessages((prev) => [
      ...prev,
      { id: ++msgSeq, role: "user", content, status: "done", skills: [], snapshot, inserted: false, confirmInsert: false },
      { id: replyId, role: "assistant", content: "", status: "streaming", skills, snapshot, inserted: false, confirmInsert: false },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(
        `/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, model, styleId, skills }),
          signal: controller.signal,
        },
      );
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`);
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
            messageId?: number;
            code?: string;
            message?: string;
          };
          if (data.type === "delta" && data.text) {
            current += data.text;
            setMessages((prev) =>
              prev.map((m) => (m.id === replyId ? { ...m, content: current } : m)),
            );
          } else if (data.type === "done") {
            // 用服务端 messageId 替换本地临时 id（插入/后续操作必须用真实 id）
            setMessages((prev) =>
              prev.map((m) =>
                m.id === replyId
                  ? { ...m, id: data.messageId ?? m.id, content: current, status: "done" }
                  : m,
              ),
            );
          } else if (data.type === "error") {
            throw new Error(data.message ?? "生成失败");
          }
        }
      }
    } catch (err) {
      // 停止（abort）→ 保留已生成部分，标记 stopped；其他 → error
      const aborted = controller.signal.aborted;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === replyId
            ? {
                ...m,
                content:
                  m.content ||
                  (aborted ? "" : (err as Error).message === "生成失败" ? "" : m.content),
                status: aborted ? "stopped" : "error",
              }
            : m,
        ),
      );
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  /** stopReply → stopReply（工单 17）：abort 当前 SSE */
  function stopReply() {
    abortRef.current?.abort();
  }

  /** insertToChapter（工单 18 真实化）：POST insert，快照冲突 → 409 → 本地确认态；force 重发 */
  async function insertToChapter(msgId: number) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.status === "streaming" || msg.inserted) return;
    const content = msg.content.trim();
    if (!content) return;
    setInsertingId(msgId);
    setErrorMsg(null);
    try {
      // 插入前先落盘本地编辑（防抖可能未触发）：确保服务端 content 为最新，快照比对才有意义
      const saved = await saveBody(body);
      if (!saved) throw new Error("正文保存失败，请重试");
      const res = await fetch(
        `/api/v1/novels/${novelId}/chapters/messages/${msgId}/insert?chapterId=${chapterId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, force: msg.confirmInsert }),
        },
      );
      if (res.status === 409) {
        // 正文已变化：先确认，不覆盖（灵笔 DocumentConflict 语义）
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, confirmInsert: true } : m)),
        );
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        chapter?: { content?: string };
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? "插入失败");
      if (data?.chapter?.content !== undefined) {
        setBody(data.chapter.content); // 服务端正文为准（本地不再拼接）
        setSaveState("saved");
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, inserted: true, confirmInsert: false } : m)),
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setInsertingId(null);
    }
  }

  /** 冲突确认：仍要插入（confirmInsert 已 true → force 重发） */
  function forceInsert(msgId: number) {
    void insertToChapter(msgId);
  }

  /** 演示模式切换（仅 Mock）：重置全部本地态；normal 重新加载真实正文 */
  function switchDemoMode(mode: DemoMode) {
    genIdRef.current++;
    clearTimer();
    setStreaming(false);
    setDemoMode(mode);
    setDemoOpen(false);
    setMessages([]);
    setInput("");
    setSaveState("saved");
    setErrorMsg(null);
    if (mode === "empty") {
      setBody("");
    } else if (mode === "normal") {
      setBody("");
      if (novelId && chapterId) {
        fetch(`/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data: { chapter?: { content?: string } } | null) => {
            if (data?.chapter) setBody(data.chapter.content ?? "");
          });
      }
    } else {
      setBody(EXAMPLE_BODY);
    }
    // 场景技能随章节状态切换（空=起笔，非空=续写）
    setActiveSkills(mode === "empty" ? ["章节起笔"] : ["章节续写"]);
  }

  /** 错误人性化（演示）：标题 + 怎么办 + 动作（灵笔 humanizeError 语义简化） */
  function humanizeError(code: string): { title: string; guidance: string; action: string } {
    switch (code) {
      case "AiNoApiKey":
        return { title: "还没有配置 AI", guidance: "先选择模型并配置可用渠道。", action: "reconfigure" };
      case "AiRateLimited":
        return { title: "请求太频繁", guidance: "模型暂时繁忙，稍后重试或切换模型。", action: "switch_model" };
      case "AiInvalidResponse":
        return { title: "AI 返回了无法理解的内容", guidance: "请重试，或切换模型。", action: "retry" };
      default:
        return { title: "生成失败", guidance: "请稍后重试。", action: "retry" };
    }
  }

  const startPlaceholder = emptyChapter
    ? "让 AI 起笔这一章（对话式，可多轮调整）"
    : "和 AI 对话，继续写这一章…";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-6 lg:px-8">
      {/* 顶栏：返回 + 章节标识 + 模型/风格 + 保存态 + 演示菜单 */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/projects"
          className="flex items-center gap-1.5 rounded-full border border-surface-2 px-3 py-1.5 text-xs text-faint transition hover:border-zinc-600 hover:text-zinc-200"
        >
          <ArrowLeft size={13} aria-hidden />
          返回作品
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs text-faint">{ch}</span>
          <span className="font-semibold text-zinc-100">{title}</span>
          <span className="rounded-full border border-surface-2 px-2 py-0.5 text-[10px] text-faint">
            草稿
          </span>
          <span
            className={`text-[10px] ${
              saveState === "dirty"
                ? "text-yellow-400"
                : saveState === "failed"
                  ? "text-red-400"
                  : saveState === "saving"
                    ? "text-faint"
                    : "text-faint"
            }`}
          >
            {saveState === "dirty"
              ? "未保存"
              : saveState === "failed"
                ? "保存失败"
                : saveState === "saving"
                  ? "保存中…"
                  : "已保存"}
          </span>
          <button
            onClick={() => void saveBody(body)}
            disabled={saveState === "saving"}
            className="rounded-full border border-surface-2 px-2.5 py-0.5 text-[10px] text-faint transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
          >
            保存
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-faint">
            模型
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={streaming}
              className="rounded-xl border border-surface-2 bg-zinc-950 px-3 py-1.5 text-zinc-200 outline-none transition focus:border-accent disabled:opacity-50"
            >
              {MOCK_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m === "deepseek-v4-flash" ? "DeepSeek（免费）" : "GLM（免费）"}
                </option>
              ))}
            </select>
          </label>
          {/* 风格胶囊（Mock 库；形态复用 chat 胶囊） */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-faint">风格</span>
            <button
              onClick={() => setStyleId(null)}
              disabled={streaming}
              className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                styleId === null
                  ? "bg-accent/15 text-accent"
                  : "border border-surface-2 text-faint hover:text-zinc-300"
              }`}
            >
              无
            </button>
            {styleLibrary.map((s) => (
              <button
                key={s.id}
                onClick={() => setStyleId(s.id)}
                disabled={streaming}
                className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                  styleId === s.id
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
          {/* 演示菜单（仅 Mock 阶段验收用，UI Frozen 后删除） */}
          <div className="relative">
            <button
              onClick={() => setDemoOpen((v) => !v)}
              aria-label="演示模式"
              title="演示模式（仅 Mock）"
              className="flex size-7 items-center justify-center rounded-full border border-surface-2 text-faint transition hover:text-zinc-200"
            >
              <DotsThree size={15} weight="bold" />
            </button>
            {demoOpen && (
              <div className="absolute right-0 top-9 z-20 w-44 rounded-card border border-surface-2 bg-surface p-1.5 shadow-xl">
                <p className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-faint">
                  演示（Mock）
                </p>
                {(
                  [
                    { key: "normal", label: "正常" },
                    { key: "no-model", label: "模型不可用" },
                    { key: "fail", label: "生成失败" },
                    { key: "empty", label: "空章节示例" },
                  ] as Array<{ key: DemoMode; label: string }>
                ).map((d) => (
                  <button
                    key={d.key}
                    onClick={() => switchDemoMode(d.key)}
                    className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      demoMode === d.key
                        ? "bg-accent/15 text-accent"
                        : "text-zinc-300 hover:bg-surface-2"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mt-5 flex min-h-0 flex-1 gap-5">
        {/* 正文编辑区（对话期间永不锁定，可随时编辑） */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs text-faint">正文</span>
            {!emptyChapter && (
              <span className="text-[11px] text-faint">
                {body.length} 字 · 对话中的 AI 会参考正文，编辑后以最新为准
              </span>
            )}
          </div>
          {errorMsg && (
            <p role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs text-red-400">
              {errorMsg}
            </p>
          )}
          <textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder={
              !bodyLoaded
                ? "加载中…"
                : emptyChapter
                  ? "这一章还没有正文。在右侧和 AI 对话让它起笔，或直接开写。"
                  : "从这里继续写你的故事…"
            }
            className="mt-2 min-h-[62vh] w-full flex-1 resize-none rounded-card border border-surface-2 bg-surface/40 px-6 py-5 text-[15px] leading-8 text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
          />
          {bodyLoaded && emptyChapter && (
            <button
              onClick={() => void sendChat("以黄土纪年的文风，为这一章写一个开头", ["章节起笔"])}
              disabled={streaming || demoMode === "no-model"}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-accent/40 bg-accent/5 py-4 text-sm font-medium text-accent transition hover:bg-accent/10 disabled:opacity-40"
            >
              <Sparkle size={16} weight="fill" aria-hidden />
              让 AI 起笔这一章（技能：章节起笔）
            </button>
          )}
        </section>

        {/* 右侧 AI 对话面板（对话代理式：多轮对话 + 产出插入正文） */}
        <aside className="flex w-[360px] shrink-0 flex-col rounded-card border border-surface-2 bg-surface/60">
          <div className="border-b border-surface-2 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Sparkle size={15} weight="duotone" className="text-accent" aria-hidden />
                AI 对话
              </div>
              <span className="text-[10px] text-faint">参考：{ch} {title} 正文 {body.length} 字</span>
            </div>
            {/* v3 技能驱动对话：技能胶囊行（多选；默认场景技能，随章节状态切换） */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-faint">技能</span>
              {availableSkills.map((sk) => (
                <button
                  key={sk}
                  onClick={() => toggleSkill(sk)}
                  disabled={streaming}
                  title={sk === "章节续写" || sk === "章节起笔" ? "平台内置场景技能" : "我的技能"}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                    activeSkills.includes(sk)
                      ? "bg-accent/15 text-accent"
                      : "border border-surface-2 text-faint hover:text-zinc-300"
                  }`}
                >
                  {sk}
                </button>
              ))}
            </div>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
                <Sparkle size={22} weight="duotone" className="text-zinc-600" aria-hidden />
                <p className="text-sm text-faint">
                  {emptyChapter ? "空章节：让 AI 起笔，再逐轮调整" : "和 AI 对话，继续写这一章"}
                </p>
                <p className="text-xs text-zinc-600">
                  对话参考当前正文与作品设定，回复可插入正文
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                    m.role === "user"
                      ? "rounded-br-sm bg-accent text-white"
                      : "rounded-bl-sm border border-surface-2 bg-zinc-950 text-zinc-200"
                  }`}
                >
                  {/* v3：AI 回复头部显示本次生效技能（模拟 system 注入的可见性） */}
                  {m.role === "assistant" && m.skills.length > 0 && (
                    <p className="mb-1.5 text-[10px] text-faint">
                      [技能] {m.skills.join(" · ")}
                    </p>
                  )}
                  {m.content}
                  {m.role === "assistant" && m.status === "streaming" && (
                    <>
                      {m.content === "" && subphase === "preparing" && (
                        <span className="text-xs text-faint">正在组织上下文…</span>
                      )}
                      <span
                        aria-label="正在生成"
                        className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent"
                      />
                    </>
                  )}
                  {/* AI 消息操作区 */}
                  {m.role === "assistant" && m.status !== "streaming" && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-surface-2 pt-2">
                      {m.status === "error" ? (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <Warning size={13} aria-hidden />
                          {humanizeError(m.errorCode ?? "UNKNOWN").title} ·{" "}
                          {humanizeError(m.errorCode ?? "UNKNOWN").guidance}
                        </span>
                      ) : (
                        <>
                          {m.inserted ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-400">
                              <Check size={13} weight="bold" aria-hidden />
                              已插入正文
                            </span>
                          ) : m.confirmInsert ? (
                            <span className="flex flex-wrap items-center gap-2 text-xs text-yellow-400">
                              <Warning size={13} aria-hidden />
                              正文已变化，这条回复基于旧正文
                              <button
                                onClick={() => forceInsert(m.id)}
                                className="rounded-full border border-current px-2.5 py-0.5 transition hover:bg-current/10"
                              >
                                仍要插入
                              </button>
                              <button
                                onClick={() =>
                                  setMessages((prev) =>
                                    prev.map((x) =>
                                      x.id === m.id ? { ...x, confirmInsert: false } : x,
                                    ),
                                  )
                                }
                                className="rounded-full border border-surface-2 px-2.5 py-0.5 text-zinc-400 transition hover:text-zinc-200"
                              >
                                取消
                              </button>
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => void insertToChapter(m.id)}
                                disabled={!m.content.trim() || insertingId === m.id}
                                className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                              >
                                {insertingId === m.id ? "插入中…" : "插入正文"}
                              </button>
                              {m.status === "stopped" && (
                                <span className="text-[10px] text-faint">
                                  已停止 · 可插入已生成部分
                                </span>
                              )}
                              <button
                                onClick={() =>
                                  setMessages((prev) =>
                                    prev.map((x) =>
                                      x.id === m.id ? { ...x, confirmInsert: false } : x,
                                    ),
                                  )
                                }
                                className="rounded-full border border-surface-2 px-2.5 py-1 text-xs text-faint transition hover:text-zinc-300"
                              >
                                忽略
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 输入区 */}
          <div className="border-t border-surface-2 p-3">
            {demoMode === "no-model" && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-400">
                ⚠ 模型不可用（演示）：对话已禁用
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-surface-2 bg-zinc-950 p-2 transition focus-within:border-accent">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                disabled={streaming || demoMode === "no-model"}
                rows={2}
                placeholder={streaming ? "正在生成…" : startPlaceholder}
                className="max-h-28 w-full resize-none bg-transparent px-1.5 py-1 text-sm text-zinc-100 outline-none placeholder:text-faint"
              />
              {streaming ? (
                <button
                  onClick={stopReply}
                  aria-label="停止"
                  title="停止生成"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-surface-2 text-zinc-300 transition hover:border-red-500/40 hover:text-red-400"
                >
                  <Pause size={15} weight="bold" />
                </button>
              ) : (
                <button
                  onClick={() => void sendChat()}
                  disabled={!input.trim() || streaming || demoMode === "no-model"}
                  aria-label="发送"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-violet-500 active:translate-y-px disabled:opacity-40"
                >
                  <ArrowUp size={15} weight="bold" />
                </button>
              )}
            </div>
            <p className="mt-2 text-[10px] text-faint">
              Enter 发送，Shift+Enter 换行 · 对话可多轮，回复确认后插入正文
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
