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
import { useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

/** Mock 风格库（仅演示；UI Frozen 后换 /api/v1/styles 真实库，胶囊形态不变） */
const MOCK_STYLES = [
  { id: 1, name: "黄土纪年体" },
  { id: 2, name: "意象绵长" },
];

/** Mock 技能库（v3：技能驱动对话；仅演示，UI Frozen 后换 /api/v1/skills 真实库，胶囊形态不变）。
 * 去AI味/人物小传/信息差设计 = 墨舟技能广场真实技能；章节续写/章节起笔 = 场景技能（按章节状态切换）。 */
const MOCK_SKILLS = [
  {
    name: "章节续写",
    description: "接续前文，保持文风与人物一致",
    systemPrompt:
      "通读前文与作品设定；保持叙事视角与句式节奏；结尾留钩子。只输出正文。",
  },
  {
    name: "章节起笔",
    description: "空章节起笔，按作品文风开局",
    systemPrompt:
      "根据作品设定与风格指南起笔；建立场景与人物；结尾留钩子。只输出正文。",
  },
  {
    name: "去 AI 味",
    description: "反例库机检，清除 AI 腔套话",
    systemPrompt:
      "检查并清除文本中的 AI 腔：禁用'值得注意的是/总而言之/不仅…而且'等套话，句子要有信息增量。",
  },
  {
    name: "人物小传",
    description: "角色弧光与动机推导",
    systemPrompt:
      "为每个主要角色维护小传：外貌/动机/弧光/禁忌，写作时保持行为一致。",
  },
  {
    name: "信息差设计",
    description: "读者已知/角色已知对照",
    systemPrompt:
      "写作时维护信息差：读者已知、角色A已知、角色B已知三张表，用信息差制造悬念。",
  },
] as const;

/** 示例正文（有正文示例；与产品文风一致） */
const EXAMPLE_BODY = `黄土坡上，老周把锄头抡起来，一下，一下。土腥气顺着风钻进鼻子里，他嗅了嗅，又嗅了嗅。这地是沉的，锄刃磕下去，像是磕在铁上。

村里人叫他周三两，因为他称地从来只称三两。他蹲在田埂上，把土块捻碎了，凑到眼前看。墒够，他说。旁边的后生不信，拿脚跺了跺，果然湿气上来。

天擦黑的时候，沟里的水声大起来。老周收了锄，沿着垄沟走回去。家里灶上煨着粥，他媳妇在门口纳鞋底，见他回来，也不说话，只把粥碗往前推了推。`;

/** Mock 回复文字池（按 chunk 顺序流式追加；每轮对话从头取，长轮次自然截断） */
const MOCK_CHUNKS = [
  "后半夜起了风。\n",
  "风是从东洼那边过来的，裹着土腥气和麦秆灰。老周翻了个身，炕席吱呀一声。\n",
  "他想起白天翻的那片地。墒是够了，就是太板，犁铧下去像刮铁皮。后生们都说今年旱，他不信。\n",
  "渠水声一夜没停。\n",
  "天蒙蒙亮的时候，老周披衣下炕。媳妇在灶间烧火，见他起来，也不问，把一碗糊糊推过来。\n",
  "他蹲在门槛上喝完，抹了把嘴：东洼那片，今儿再下一遍犁。\n",
  "媳妇说，翻死了。\n",
  "翻不死。老周把碗搁下，声音不大，却像犁铧磕在石头上。土地这东西，你哄它，它就哄你。\n",
];

let msgSeq = 0;

export function ChapterEditorView() {
  const params = useSearchParams();
  const ch = params.get("ch") ?? "001";
  const title = params.get("title") ?? "第一章";

  const [body, setBody] = useState(EXAMPLE_BODY);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [subphase, setSubphase] = useState<"preparing" | "streaming" | "cancelling">("preparing");
  const [model, setModel] = useState<string>(MOCK_MODELS[0]);
  const [styleId, setStyleId] = useState<number | null>(null);
  // v3 技能驱动对话：可用技能按章节状态切换（空章节=起笔，非空=续写），默认选中场景技能
  const [activeSkills, setActiveSkills] = useState<string[]>(["章节续写"]);
  const [dirty, setDirty] = useState(false); // 未保存标记（本地态展示；真实保存接 Contract 后）
  const [demoMode, setDemoMode] = useState<DemoMode>("normal");
  const [demoOpen, setDemoOpen] = useState(false);

  // 代际计数：每条消息一轮生成；+1 使旧代定时回调全部失效（防竞态）
  const genIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dirtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emptyChapter = body.trim().length === 0;

  /** 可用技能（空章节=起笔场景；非空=续写场景） */
  const availableSkills = MOCK_SKILLS.filter((s) =>
    emptyChapter ? s.name !== "章节续写" : s.name !== "章节起笔",
  ).map((s) => s.name);

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

  /** 正文编辑：对话期间正文永不锁定；编辑置未保存（2s 防抖回落"已保存"本地态） */
  function onBodyChange(v: string) {
    setBody(v);
    setDirty(true);
    if (dirtyTimerRef.current) clearTimeout(dirtyTimerRef.current);
    dirtyTimerRef.current = setTimeout(() => setDirty(false), 2000);
  }

  /** mockSendChat：发送一条用户消息 → AI 流式回复（纯本地定时器；技能驱动：回复携带生效技能） */
  function mockSendChat(text?: string, skillsOverride?: string[]) {
    const content = (text ?? input).trim();
    if (!content || streaming || demoMode === "no-model") return;
    const gen = ++genIdRef.current;
    setInput("");
    setSubphase("preparing");
    setStreaming(true);
    const snapshot = body; // 生成时正文快照（冲突检测基准）
    const replyId = ++msgSeq;
    // 生效技能：显式覆盖（起笔）> 当前选中 ∩ 可用；为空则自动补场景技能
    const skills =
      skillsOverride ??
      (() => {
        const kept = activeSkills.filter((s) => availableSkills.includes(s));
        return kept.length > 0 ? kept : [emptyChapter ? "章节起笔" : "章节续写"];
      })();
    setMessages((prev) => [
      ...prev,
      { id: ++msgSeq, role: "user", content, status: "done", skills: [], snapshot, inserted: false, confirmInsert: false },
      { id: replyId, role: "assistant", content: "", status: "streaming", skills, snapshot, inserted: false, confirmInsert: false },
    ]);

    // 演示：生成失败 → 人性化错误面板
    if (demoMode === "fail") {
      setTimeout(() => {
        if (genIdRef.current !== gen) return;
        setStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId
              ? { ...m, status: "error", errorCode: "AiInvalidResponse" }
              : m,
          ),
        );
      }, 600);
      return;
    }

    // Preparing（组织上下文）→ Streaming（逐 chunk 出字）
    // ⚠️ 不检查 state（setTimeout 闭包捕获旧值）；只用 genId 代际校验防竞态
    setTimeout(() => {
      if (genIdRef.current !== gen) return;
      setSubphase("streaming");
      let idx = 0;
      timerRef.current = setInterval(() => {
        if (genIdRef.current !== gen) {
          clearTimer();
          return;
        }
        const chunk = MOCK_CHUNKS[idx];
        idx += 1;
        if (!chunk) {
          clearTimer();
          setStreaming(false);
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, status: "done" } : m)),
          );
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId ? { ...m, content: m.content + chunk } : m,
          ),
        );
      }, 110);
    }, 700);
  }

  /** mockStopReply：停止当前回复（保留已输出部分 = 天然部分插入通道） */
  function mockStopReply() {
    const gen = genIdRef.current;
    genIdRef.current++;
    clearTimer();
    setSubphase("cancelling");
    setTimeout(() => {
      // 仅当期间无新动作时落"已停止"
      if (genIdRef.current === gen + 1) {
        setStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.status === "streaming" ? { ...m, status: "stopped" } : m,
          ),
        );
      }
    }, 250);
  }

  /** mockInsertToChapter：AI 消息插入正文（正文已变 → 冲突确认，灵笔 DocumentConflict 语义） */
  function mockInsertToChapter(msgId: number) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.status === "streaming" || msg.inserted) return;
    const content = msg.content.trim();
    if (!content) return;
    if (msg.snapshot !== body && !msg.confirmInsert) {
      // 正文在生成期间被修改：先确认，不覆盖（灵笔 DocumentConflict / CandidateStale 语义）
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, confirmInsert: true } : m)),
      );
      return;
    }
    setBody(body.trim() ? body + "\n\n" + content : content);
    setDirty(true);
    if (dirtyTimerRef.current) clearTimeout(dirtyTimerRef.current);
    dirtyTimerRef.current = setTimeout(() => setDirty(false), 2000);
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, inserted: true, confirmInsert: false } : m)),
    );
  }

  /** 冲突确认：仍要插入 */
  function forceInsert(msgId: number) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, confirmInsert: false } : m)),
    );
    mockInsertToChapter(msgId);
  }

  /** 演示模式切换（仅 Mock）：重置全部本地态 */
  function switchDemoMode(mode: DemoMode) {
    genIdRef.current++;
    clearTimer();
    setStreaming(false);
    setDemoMode(mode);
    setDemoOpen(false);
    setMessages([]);
    setInput("");
    setDirty(false);
    setBody(mode === "empty" ? "" : EXAMPLE_BODY);
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
          <span className={`text-[10px] ${dirty ? "text-yellow-400" : "text-faint"}`}>
            {dirty ? "未保存" : "已保存（本地）"}
          </span>
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
            {MOCK_STYLES.map((s) => (
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
          <textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder={
              emptyChapter
                ? "这一章还没有正文。在右侧和 AI 对话让它起笔，或直接开写。"
                : "从这里继续写你的故事…"
            }
            className="mt-2 min-h-[62vh] w-full flex-1 resize-none rounded-card border border-surface-2 bg-surface/40 px-6 py-5 text-[15px] leading-8 text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
          />
          {emptyChapter && (
            <button
              onClick={() => void mockSendChat("以黄土纪年的文风，为这一章写一个开头", ["章节起笔"])}
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
                  title={MOCK_SKILLS.find((s) => s.name === sk)?.description}
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
                                onClick={() => mockInsertToChapter(m.id)}
                                disabled={!m.content.trim()}
                                className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                              >
                                插入正文
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
                    void mockSendChat();
                  }
                }}
                disabled={streaming || demoMode === "no-model"}
                rows={2}
                placeholder={streaming ? "正在生成…" : startPlaceholder}
                className="max-h-28 w-full resize-none bg-transparent px-1.5 py-1 text-sm text-zinc-100 outline-none placeholder:text-faint"
              />
              {streaming ? (
                <button
                  onClick={mockStopReply}
                  aria-label="停止"
                  title="停止生成"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-surface-2 text-zinc-300 transition hover:border-red-500/40 hover:text-red-400"
                >
                  <Pause size={15} weight="bold" />
                </button>
              ) : (
                <button
                  onClick={() => void mockSendChat()}
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
