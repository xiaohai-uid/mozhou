"use client";

// 章节编辑器 Mock Preview（V1.1 Journey ⑦ 章节级续写，UI-First 阶段）
// ⚠️ 全前端 Mock：无 DB / 无 API / 无 Provider / 无真实 Streaming——纯本地假数据 + 定时器模拟流式。
// 状态机（continuation-design-20260811.md C 节）：Idle(Empty 变体) → Configuring → Generating
//   → CandidateReady → Accepted(撤销条) / Rejected / Cancelled / Error(Retry)。
// UI Frozen 后 progressive swap：mock 函数族换真实契约，本组件形态保持。
import { useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  DotsThree,
  Pause,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";

type Phase =
  | "idle" // 正文可编辑（空正文 = EmptyChapter 变体，入口文案变"生成开头"）
  | "configuring" // 配置面板展开（正文仍可编辑，可随时收起）
  | "generating" // 生成中（subphase: preparing | streaming | cancelling）
  | "candidate" // 候选就绪（预览可编辑 = Partial Accept 通道）
  | "accepted" // 已采纳（撤销条常驻）
  | "cancelled" // 已停止（提示条）
  | "error"; // 失败（重试/丢弃）

type SubPhase = "preparing" | "streaming" | "cancelling";

/** Mock 模型（仅演示；UI Frozen 后换真实模型契约） */
const MOCK_MODELS = ["deepseek-v4-flash", "glm-4.5-flash"] as const;

/** Mock 风格库（仅演示；UI Frozen 后换 /api/v1/styles 真实库，胶囊形态不变） */
const MOCK_STYLES = [
  { id: 1, name: "黄土纪年体" },
  { id: 2, name: "意象绵长" },
];

const LENGTHS = [
  { key: "short", label: "短", hint: "≈200 字" },
  { key: "mid", label: "中", hint: "≈500 字" },
  { key: "long", label: "长", hint: "≈1000 字" },
] as const;

type LengthKey = (typeof LENGTHS)[number]["key"];

/** 演示模式（仅 Mock 阶段验收用；UI Frozen 后删除） */
type DemoMode = "normal" | "no-model" | "fail" | "empty";

/** 示例正文（有正文示例；与产品文风一致） */
const EXAMPLE_BODY = `黄土坡上，老周把锄头抡起来，一下，一下。土腥气顺着风钻进鼻子里，他嗅了嗅，又嗅了嗅。这地是沉的，锄刃磕下去，像是磕在铁上。

村里人叫他周三两，因为他称地从来只称三两。他蹲在田埂上，把土块捻碎了，凑到眼前看。墒够，他说。旁边的后生不信，拿脚跺了跺，果然湿气上来。

天擦黑的时候，沟里的水声大起来。老周收了锄，沿着垄沟走回去。家里灶上煨着粥，他媳妇在门口纳鞋底，见他回来，也不说话，只把粥碗往前推了推。`;

/** Mock 续写文字池（假输出，按 chunk 顺序流式追加） */
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

export function ChapterEditorView() {
  const params = useSearchParams();
  const novelName = params.get("novel") ?? "示例作品";
  const ch = params.get("ch") ?? "001";
  const title = params.get("title") ?? "第一章";

  const [phase, setPhase] = useState<Phase>("idle");
  const [subphase, setSubphase] = useState<SubPhase>("preparing");
  const [body, setBody] = useState(EXAMPLE_BODY);
  const [configOpen, setConfigOpen] = useState(false);
  const [model, setModel] = useState<string>(MOCK_MODELS[0]);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [length, setLength] = useState<LengthKey>("mid");
  const [instruction, setInstruction] = useState("");
  const [candidate, setCandidate] = useState("");
  const [beforeSnapshot, setBeforeSnapshot] = useState("");
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<DemoMode>("normal");
  const [demoOpen, setDemoOpen] = useState(false);

  // 代际计数：每次开始/取消/切换演示 +1，使旧代定时回调全部失效（防竞态）
  const genIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const emptyChapter = body.trim().length === 0;
  const locked = phase === "generating" || phase === "candidate";

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /** mockContinueChapter + mockStreamContinuation：开始续写并流式输出（纯本地定时器） */
  function mockContinueChapter() {
    if (
      phase !== "idle" &&
      phase !== "configuring" &&
      phase !== "cancelled" &&
      phase !== "error" &&
      phase !== "accepted"
    )
      return;
    const gen = ++genIdRef.current;
    setConfigOpen(false);
    setAcceptedCount(0); // 开始新生成 = 放弃上一次采纳的撤销权（撤销条随之消失）
    setPhase("generating");
    setSubphase("preparing");
    setCandidate("");
    setErrorMsg(null);

    // 演示：生成失败 → Error（Preparing 后中断）
    if (demoMode === "fail") {
      setTimeout(() => {
        if (genIdRef.current !== gen) return;
        setPhase("error");
        setErrorMsg("生成失败：模型输出解析失败，请重试（演示模式）");
      }, 600);
      return;
    }

    // Preparing（组织上下文）→ Streaming（逐 chunk 出字）
    // ⚠️ 不检查 phase state（setTimeout 闭包捕获的是旧值）；只用 genId 代际校验防竞态
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
          setPhase("candidate");
          return;
        }
        setCandidate((prev) => prev + chunk);
      }, 110);
    }, 700);
  }

  /** mockCancelContinuation：停止生成（Cancelling 瞬态 → Cancelled，正文零变化） */
  function mockCancelContinuation() {
    const gen = genIdRef.current;
    genIdRef.current++; // 作废本代所有回调
    clearTimer();
    setSubphase("cancelling");
    setTimeout(() => {
      // 仅当期间无新动作（未重新开始生成）时落 Cancelled
      if (genIdRef.current === gen + 1) setPhase("cancelled");
    }, 250);
  }

  /** mockAcceptCandidate（含 mockPartialAcceptCandidate：预览区已可删改，删改后采纳即部分采纳） */
  function mockAcceptCandidate() {
    const text = candidate.trim();
    if (!text) return;
    setBeforeSnapshot(body);
    setBody(body.trim() ? body + "\n\n" + text : text);
    setAcceptedCount(text.length);
    setCandidate("");
    setPhase("accepted");
  }

  /** 撤销采纳：恢复采纳前正文快照 */
  function undoAccept() {
    setBody(beforeSnapshot);
    setAcceptedCount(0);
    setPhase("idle");
  }

  /** mockRejectCandidate：丢弃候选，正文零变化 */
  function mockRejectCandidate() {
    setCandidate("");
    setPhase("idle");
  }

  /** mockRetryContinuation：重新生成（新候选覆盖旧候选） */
  function mockRetryContinuation() {
    if (phase !== "candidate" && phase !== "error") return;
    setCandidate("");
    setErrorMsg(null);
    mockContinueChapter();
  }

  /** 正文编辑：accepted 态下再次编辑即撤销条消失（回到普通可编辑态） */
  function onBodyChange(v: string) {
    setBody(v);
    if (phase === "accepted") {
      setAcceptedCount(0);
      setPhase("idle");
    }
  }

  /** 演示模式切换（仅 Mock 阶段）：重置全部本地态 */
  function switchDemoMode(mode: DemoMode) {
    genIdRef.current++;
    clearTimer();
    setDemoMode(mode);
    setDemoOpen(false);
    setPhase("idle");
    setConfigOpen(false);
    setCandidate("");
    setErrorMsg(null);
    setBody(mode === "empty" ? "" : EXAMPLE_BODY);
  }

  const startLabel = emptyChapter ? "生成开头" : "续写";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-6 lg:px-8">
      {/* 顶栏：返回 + 章节标识 + 模型/风格 + 演示菜单 */}
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
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-faint">
            模型
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={locked}
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
              disabled={locked}
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
                disabled={locked}
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

      {/* 正文编辑区（生成/候选期间锁定） */}
      <textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        disabled={locked}
        placeholder={
          emptyChapter
            ? "这一章还没有正文。点下方「生成开头」让 AI 起笔，或直接开写。"
            : "从这里继续写你的故事…"
        }
        className="mt-5 min-h-[55vh] w-full resize-none rounded-card border border-surface-2 bg-surface/40 px-6 py-5 text-[15px] leading-8 text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent disabled:opacity-60"
      />

      {/* 状态提示条：Accepted / Cancelled / Error */}
      {phase === "accepted" && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 text-xs text-accent">
          <span className="flex items-center gap-2">
            <Check size={14} weight="bold" aria-hidden />
            已采纳 {acceptedCount} 字，正文已更新
          </span>
          <button
            onClick={undoAccept}
            className="rounded-full border border-current px-3 py-1 transition hover:bg-current/10"
          >
            撤销采纳
          </button>
        </div>
      )}
      {phase === "cancelled" && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-surface-2 bg-surface/50 px-4 py-2.5 text-xs text-zinc-400">
          <Pause size={13} aria-hidden />
          已停止生成，未写入正文。可随时重新续写。
        </div>
      )}
      {phase === "error" && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-xs text-red-400">
          <span>{errorMsg}</span>
          <span className="flex shrink-0 gap-2">
            <button
              onClick={() => void mockRejectCandidate()}
              className="rounded-full border border-current px-3 py-1 transition hover:bg-current/10"
            >
              丢弃
            </button>
            <button
              onClick={() => void mockRetryContinuation()}
              className="rounded-full bg-accent px-3 py-1 text-white transition hover:bg-violet-500"
            >
              重试
            </button>
          </span>
        </div>
      )}

      {/* 底部续写区（sticky）——按状态机切换主形态 */}
      {phase !== "generating" && phase !== "candidate" ? (
        <div className="sticky bottom-4 mt-4 rounded-card border border-surface-2 bg-surface/90 p-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              onClick={() => void mockContinueChapter()}
              disabled={demoMode === "no-model" || locked}
              className="flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              <Sparkle size={15} weight="fill" aria-hidden />
              {startLabel}
            </button>
            <span className="text-xs text-faint">
              {emptyChapter
                ? "空章节：让 AI 从设定与文风起笔"
                : `从正文末尾接续（当前 ${body.length} 字）`}
            </span>
            <button
              onClick={() => setConfigOpen((v) => !v)}
              disabled={locked}
              className="ml-auto flex items-center gap-1 rounded-full border border-surface-2 px-3 py-1.5 text-xs text-faint transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
            >
              {configOpen ? "收起" : "配置"}
              <span className={`transition-transform ${configOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
          </div>

          {/* 模型不可用：主条常显黄条（不藏进配置面板，用户看得见原因） */}
          {demoMode === "no-model" && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-400">
              ⚠ 模型不可用（演示）：当前无可用模型渠道，续写已禁用
            </div>
          )}

          {configOpen && (
            <div className="mt-4 space-y-4 border-t border-surface-2 pt-4">
              {/* 续写长度三档 */}
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-faint">长度</span>
                {LENGTHS.map((l) => (
                  <button
                    key={l.key}
                    onClick={() => setLength(l.key)}
                    disabled={demoMode === "no-model"}
                    className={`rounded-full px-3.5 py-1.5 text-xs transition disabled:opacity-40 ${
                      length === l.key
                        ? "bg-accent/15 text-accent"
                        : "border border-surface-2 text-faint hover:text-zinc-300"
                    }`}
                  >
                    {l.label}
                    <span className="ml-1 text-[10px] opacity-70">{l.hint}</span>
                  </button>
                ))}
              </div>
              {/* 自定义要求（可空） */}
              <label className="block">
                <span className="text-xs text-faint">自定义要求（可空）</span>
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  disabled={demoMode === "no-model"}
                  placeholder="如：这一章要埋一个伏笔，结尾留钩子…"
                  className="mt-1.5 w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent disabled:opacity-40"
                />
              </label>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-faint">
                  参考范围：前文 {body.length} 字 + 作品设定（RAG 跟随作品级开关）
                </span>
                <button
                  onClick={() => void mockContinueChapter()}
                  disabled={demoMode === "no-model"}
                  className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                >
                  开始生成
                </button>
              </div>
            </div>
          )}
        </div>
      ) : phase === "generating" ? (
        <div className="sticky bottom-4 mt-4 rounded-card border border-accent/40 bg-surface/90 p-4 backdrop-blur">
          {/* 流式预览（正文不动，此处逐字出现） */}
          <div className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-zinc-200">
            {candidate}
            <span
              aria-label="正在生成"
              className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent"
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-faint">
            <span>
              {subphase === "preparing"
                ? "正在组织上下文…"
                : subphase === "cancelling"
                  ? "正在停止…"
                  : "AI 续写中…"}{" "}
              · 参考前文 {body.length} 字 · 作品设定跟随 RAG 开关
            </span>
            <button
              onClick={mockCancelContinuation}
              className="flex items-center gap-1.5 rounded-full border border-surface-2 px-3.5 py-1.5 text-zinc-300 transition hover:border-red-500/40 hover:text-red-400"
            >
              <Pause size={13} aria-hidden />
              停止
            </button>
          </div>
        </div>
      ) : (
        <div className="sticky bottom-4 mt-4 rounded-card border border-surface-2 bg-surface/90 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-xs text-faint">
            <Sparkle size={13} weight="duotone" className="text-accent" aria-hidden />
            续写候选 · 可直接删改（部分采纳），再点采纳
          </div>
          <textarea
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            rows={7}
            className="mt-2 w-full resize-none rounded-xl border border-surface-2 bg-zinc-950 px-4 py-3 text-sm leading-7 text-zinc-200 outline-none transition placeholder:text-faint focus:border-accent"
          />
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[11px] text-faint">{novelName} · {ch} {title}</span>
            <span className="flex items-center gap-2">
              <button
                onClick={mockRejectCandidate}
                className="rounded-full border border-surface-2 px-3.5 py-1.5 text-xs text-zinc-300 transition hover:text-zinc-100"
              >
                丢弃
              </button>
              <button
                onClick={() => void mockRetryContinuation()}
                className="rounded-full border border-surface-2 px-3.5 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
              >
                重新生成
              </button>
              <button
                onClick={mockAcceptCandidate}
                disabled={!candidate.trim()}
                className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
              >
                <Check size={13} weight="bold" aria-hidden />
                采纳当前内容
              </button>
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
