"use client";

// 章节编辑器：真实正文读写、章节对话、候选确认/丢弃与撤销恢复。
// 章节正文、对话和候选消息均通过真实 API 与模型 provider 交互。
//
// 工作方式（用户定案 B：对话代理式，接写作对话的形态）：
//   正文编辑器 + 右侧 AI 对话面板。用户在章节上下文里与 AI 多轮对话，
//   AI 回复流式出现，完成后可「插入正文」；正文在对话期间**不锁定**，
//   可随时编辑；正文变化时旧消息的插入走冲突确认（灵笔 DocumentConflict/CandidateStale 语义）。
//   保存状态（未保存/已保存）为本地态展示。
//
// 状态机（对话式）：ChatIdle → ChatStreaming(Preparing/Streaming/Cancelling) → MessageDone
//   → InsertConfirm(正文已变) / Inserted / Cancelled / Error。Empty 变体：空章节空态"让 AI 起笔"。
// UI Frozen 后保留交互形态，数据与生成均走真实章节契约。
import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowUp,
  Check,
  Pause,
  Sparkle,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { useBodyHistory, type SelectionState } from "./undo-history";

type MessageStatus =
  | "streaming"
  | "done"
  | "generating"
  | "completed_candidate"
  | "stopped"
  | "error"
  | "applied"
  | "discarded";

type GenerationSubphase = "preparing" | "streaming" | "finishing" | "cancelling";

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
  generationKey?: string | null;
  baseRevision?: number | null;
  errorMessage?: string | null;
  /** 冲突确认中（第一层：正文已变化） */
  confirmInsert: boolean;
  /** 选区冲突确认中（J9 第二层：bound 选区内容已变化） */
  confirmSelection?: boolean;
  /** 服务端错误码 */
  errorCode?: string;
  /** 质量门检查摘要（候选确认路径展示，工单 03 收尾） */
  qualityGate?: string | null;
}

/** one-api 中配置的可用模型 */
const CHAT_MODELS = ["deepseek-v4-flash", "glm-4.5-flash"] as const;

let msgSeq = 0;

export function ChapterEditorView() {
  const params = useSearchParams();
  const { chapterId: pathChapterId } = useParams<{ chapterId: string }>();
  const chapterId = Number(pathChapterId);
  const novelId = Number(params.get("novelId") ?? 0);
  const ch = params.get("ch") ?? "001";
  const title = params.get("title") ?? "第一章";

  // 工单 16：正文从真实 API 加载；工单 17：对话消息真实持久化（留存 Q1）
  // Journey ⑧：正文经 useBodyHistory 统一变更（会话级 undo/redo history，方案 A 冻结）
  const bodyHist = useBodyHistory("");
  const body = bodyHist.body;
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "failed">("saved");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 工单 17：我的技能（真实 /api/v1/skills?scope=mine）+ 场景技能（内置）
  const [mySkillNames, setMySkillNames] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [subphase, setSubphase] = useState<GenerationSubphase>("preparing");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [model, setModel] = useState<string>(CHAT_MODELS[0]);
  const [styleId, setStyleId] = useState<number | null>(null);
  // v3 技能驱动对话：可用技能按章节状态切换（空章节=起笔，非空=续写），默认选中场景技能
  const [activeSkills, setActiveSkills] = useState<string[]>(["章节续写"]);

  const dirtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 最后保存/服务端确认的正文（撤销/重做后的保存状态比较基准，Journey ⑧） */
  const lastSavedRef = useRef("");
  /** J9：正文 textarea 引用（插入后 caret/focus 恢复） */
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** J9：editor insertion target（DOM focus ≠ target：blur 不重置；用户重新点击正文才更新） */
  const targetRef = useRef<SelectionState>({ start: 0, end: 0 });
  const [, bumpTarget] = useReducer((n: number) => n + 1, 0);
  /** J9：generation-bound selection snapshot（仅选区作为 AI 输入时建立；会话级，不写 DB） */
  const boundRef = useRef<Map<number, { start: number; end: number; text: string }>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const generationKeyRef = useRef<string | null>(null);
  // 工单 17：真实风格库（styleId 注入路径）
  const [styleLibrary, setStyleLibrary] = useState<Array<{ id: number; name: string }>>([]);
  // 工单 18：插入中 + 插入错误提示
  const [insertingId, setInsertingId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!streaming || generationStartedAt === null) return;
    const timer = window.setInterval(() => {
      setGenerationElapsedMs(Date.now() - generationStartedAt);
    }, 100);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, streaming]);

  /** 工单 16：加载真实正文（GET 单章含 content）+ 工单 17：加载对话历史（留存 Q1）+ 我的技能 */
  useEffect(() => {
    if (!novelId || !chapterId) return;
    fetch(`/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { chapter?: { content?: string } } | null) => {
        if (data?.chapter) {
          bodyHist.reset(data.chapter.content ?? "");
          lastSavedRef.current = data.chapter.content ?? "";
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
  }, [novelId, chapterId, bodyHist]); // bodyHist 实例稳定（useState 惰性初始化），仅随章节变化重载

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
      lastSavedRef.current = content;
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

  /** 正文变更统一入口（Journey ⑧）：保存状态 = 与最后保存内容比较；不同则进 2s 防抖自动保存（保存不清 undo 栈） */
  function markChanged(next: string) {
    const sameAsSaved = next === lastSavedRef.current;
    setSaveState(sameAsSaved ? "saved" : "dirty");
    if (!sameAsSaved) {
      if (dirtyTimerRef.current) clearTimeout(dirtyTimerRef.current);
      dirtyTimerRef.current = setTimeout(() => {
        void saveBody(next);
      }, 2000);
    }
  }

  /** J9：跟踪 textarea 最后有效 caret/selection（DOM focus ≠ editor target；blur 不重置） */
  function onEditorSelect() {
    const ta = bodyTextareaRef.current;
    if (!ta) return;
    const sel = { start: ta.selectionStart, end: ta.selectionEnd };
    targetRef.current = sel;
    bodyHist.setSelection(sel); // 纯 caret 移动不入 history
    bumpTarget(); // 按钮文案（插入正文/替换选中内容）随 target 变化重渲
  }

  /** 正文编辑：对话期间正文永不锁定；输入走 history（2s 窗口内连续输入合并为一层 undo） */
  function onBodyChange(v: string) {
    const ta = bodyTextareaRef.current;
    const sel: SelectionState = ta
      ? { start: ta.selectionStart, end: ta.selectionEnd }
      : { start: v.length, end: v.length };
    bodyHist.type(v, sel);
    targetRef.current = sel;
    markChanged(v);
  }

  /** Journey ⑧+⑨：撤销/重做（栈空时返回 null）；恢复正文同时恢复该层的光标/选区并聚焦 */
  function doUndo() {
    const r = bodyHist.undo();
    if (r !== null) {
      markChanged(r.content);
      restoreSelection(r.selection);
    }
  }
  function doRedo() {
    const r = bodyHist.redo();
    if (r !== null) {
      markChanged(r.content);
      restoreSelection(r.selection);
    }
  }
  /** 恢复 caret/选区（focus 回正文，用户可立即继续） */
  function restoreSelection(sel: SelectionState) {
    targetRef.current = { ...sel };
    requestAnimationFrame(() => {
      const ta = bodyTextareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(
          Math.min(sel.start, ta.value.length),
          Math.min(sel.end, ta.value.length),
        );
      }
    });
  }

  /** textarea 快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y（阻止默认，避免与浏览器原生双重撤销） */
  function onBodyKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (k === "y") {
      e.preventDefault();
      doRedo();
    }
  }

  /** 章节对话：POST 真实 chat SSE 流式，技能驱动；停止=abort */
  async function sendChat(text?: string, skillsOverride?: string[]) {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    const skills =
      skillsOverride ??
      (() => {
        const kept = activeSkills.filter((s) => availableSkills.includes(s));
        return kept.length > 0 ? kept : [emptyChapter ? "章节起笔" : "章节续写"];
      })();
    setInput("");
    const generationKey = crypto.randomUUID();
    generationKeyRef.current = generationKey;
    setSubphase("preparing");
    setGenerationStartedAt(Date.now());
    setGenerationElapsedMs(0);
    setStreaming(true);
    // 本地临时 id 用负命名空间（服务端 id 为正整数、全局序列——空库时从 1 起，正 id 会在 done
    // 替换后与 user 本地 id 撞车，find() 取错消息插入错误内容；生产 smoke 复现后修复）
    const replyId = --msgSeq;
    const snapshot = body; // 本地快照（工单 18 换服务端快照比对）
    // J9：选区作为 AI 输入（改写/润色等）→ 绑定 generation-bound selection snapshot（会话级）
    const ta = bodyTextareaRef.current;
    const hasSelection = ta !== null && ta.selectionStart !== ta.selectionEnd;
    const selection = hasSelection && ta
      ? {
          start: ta.selectionStart,
          end: ta.selectionEnd,
          text: body.slice(ta.selectionStart, ta.selectionEnd),
        }
      : undefined;
    if (selection) boundRef.current.set(replyId, selection);
    setMessages((prev) => [
      ...prev,
      { id: --msgSeq, role: "user", content, status: "done", skills: [], snapshot, inserted: false, confirmInsert: false },
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
          body: JSON.stringify({
            content,
            model,
            styleId,
            skills,
            ...(selection ? { selection } : {}),
            generationKey,
          }),
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
              status?: MessageStatus;
              code?: string;
              message?: string;
              phase?: GenerationSubphase;
          };
          if (data.type === "delta" && data.text) {
            setSubphase("streaming");
            current += data.text;
            setMessages((prev) =>
              prev.map((m) => (m.id === replyId ? { ...m, content: current } : m)),
            );
          } else if (data.type === "done") {
            // 用服务端 messageId 替换本地临时 id（插入/后续操作必须用真实 id）；bound snapshot 同步迁移
            const bound = boundRef.current.get(replyId);
            if (bound && data.messageId) {
              boundRef.current.delete(replyId);
              boundRef.current.set(data.messageId, bound);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === replyId
                  ? {
                      ...m,
                      id: data.messageId ?? m.id,
                      content: current,
                      status: (data.status as MessageStatus | undefined) ?? "completed_candidate",
                    }
                  : m,
              ),
            );
          } else if (data.type === "phase" && data.phase) {
            const phase = data.phase;
            if (phase === "preparing" || phase === "streaming" || phase === "finishing") {
              setSubphase(phase);
            }
          } else if (data.type === "error") {
            // 消息级错误：带 code 供人性化映射（工单 19）
            setMessages((prev) =>
              prev.map((m) =>
                m.id === replyId
                  ? { ...m, status: "error", errorCode: data.code ?? "UNKNOWN" }
                  : m,
              ),
            );
            return;
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
      setGenerationStartedAt(null);
      setSubphase("preparing");
    }
  }

  /** stopReply → stopReply（工单 17）：abort 当前 SSE */
  function stopReply() {
    const generationKey = generationKeyRef.current;
    setSubphase("cancelling");
    if (novelId && chapterId && generationKey) {
      void fetch(`/api/v1/novels/${novelId}/chapters/chat/stop?chapterId=${chapterId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationKey }),
        keepalive: true,
      }).catch(() => {});
    }
    abortRef.current?.abort();
  }

  /** insertToChapter（工单 18 + J9 精确插入）：点击插入 → 两层冲突 → 服务端 splice → caret 恢复 */
  async function insertToChapter(msgId: number) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.status === "streaming" || msg.inserted) return;
    const content = msg.content.trim();
    if (!content) return;
    setInsertingId(msgId);
    setErrorMsg(null);
    try {
      // J9：位置 = 点击插入这一刻的 editor target（blur 不丢；用户移动 caret/选区才更新）
      const target = { ...targetRef.current };
      const mode: "insert" | "replace" = target.start !== target.end ? "replace" : "insert";

      // J9 第二层：bound selection source conflict（仅选区作为 AI 输入的候选）
      const bound = boundRef.current.get(msgId);
      if (mode === "replace" && bound && !msg.confirmSelection) {
        const currentText = body.slice(target.start, target.end);
        if (currentText !== bound.text) {
          // 目标文字与 AI 当初处理的不同 → 轻量冲突（不静默覆盖；复用 ContentChanged 视觉）
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, confirmSelection: true } : m)),
          );
          return;
        }
      }

      // J9 第一层：先可靠落盘本地正文（防抖可能未触发）→ expectedContent = 点击插入时正文
      const saved = await saveBody(body);
      if (!saved) throw new Error("正文保存失败，请重试");
      const res = await fetch(
        `/api/v1/novels/${novelId}/chapters/messages/${msgId}/insert?chapterId=${chapterId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            force: msg.confirmInsert || msg.confirmSelection,
            mode,
            ...(mode === "insert"
              ? { position: target.start }
              : { range: { start: target.start, end: target.end } }),
            expectedContent: body,
          }),
        },
      );
      if (res.status === 409) {
        // 第一层冲突：点击插入后到服务端执行之间正文被改 → 确认，不覆盖（灵笔 DocumentConflict 语义）
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
        const after = data.chapter.content;
        // caret：插入/替换结果末尾（J9 冻结：ABCXYZ|DEF / ABCnew text|DEF）
        const caret = Math.min(target.start + content.length, after.length);
        bodyHist.apply(after, { start: caret, end: caret }); // 服务端正文为准（原子一层，一次撤销整体回退）
        targetRef.current = { start: caret, end: caret };
        lastSavedRef.current = after;
        setSaveState("saved");
        restoreSelection({ start: caret, end: caret });
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, inserted: true, confirmInsert: false, confirmSelection: false }
            : m,
        ),
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setInsertingId(null);
    }
  }

  /** 冲突确认：仍要插入/替换（force 重发；force 只跳过用户已确认的内容冲突，校验不绕过） */
  function forceInsert(msgId: number) {
    void insertToChapter(msgId);
  }

  async function discardMessage(msgId: number) {
    try {
      const res = await fetch(
        `/api/v1/novels/${novelId}/chapters/messages/${msgId}/discard?chapterId=${chapterId}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("忽略失败，请刷新后重试");
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: "discarded", confirmInsert: false, confirmSelection: false } : m)),
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  }

  /** 错误人性化（工单 19 正式化）：标题 + 怎么办（灵笔 humanizeError 语义，映射契约 21 错误码） */
  function humanizeError(code: string): { title: string; guidance: string } {
    switch (code) {
      case "AiNoApiKey":
        return { title: "还没有配置 AI", guidance: "先选择模型并配置可用渠道。" };
      case "AiRateLimited":
        return { title: "请求太频繁", guidance: "模型暂时繁忙，稍后重试或切换模型。" };
      case "AiServerError":
        return { title: "模型暂时繁忙", guidance: "稍后重试或切换模型。" };
      case "AiTimeout":
      case "AiNetworkError":
        return { title: "网络连接失败", guidance: "请检查网络后重试。" };
      case "AiInvalidResponse":
        return { title: "AI 返回了无法理解的内容", guidance: "请重试，或切换模型。" };
      case "AiCancelled":
        return { title: "已取消生成", guidance: "生成已停止，你可以继续写作。" };
      case "ContentChanged":
        return { title: "正文已经变化", guidance: "这条回复基于旧正文，请重新生成。" };
      case "ChapterNotFound":
        return { title: "章节不存在", guidance: "返回作品列表重新选择。" };
      default:
        return { title: "操作没有成功", guidance: "请稍后重试。" };
    }
  }

  const startPlaceholder = emptyChapter
    ? "让 AI 起笔这一章（对话式，可多轮调整）"
    : "和 AI 对话，继续写这一章…";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-6 lg:px-8">
      {/* 顶栏：返回 + 章节标识 + 模型/风格 + 保存态 */}
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
              {CHAT_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m === "deepseek-v4-flash" ? "DeepSeek（免费）" : "GLM（免费）"}
                </option>
              ))}
            </select>
          </label>
          {/* 风格胶囊（当前作品已绑定的风格；形态复用 chat 胶囊） */}
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
        </div>

      </header>

      <div className="mt-5 flex min-h-0 flex-1 gap-5">
        {/* 正文编辑区（对话期间永不锁定，可随时编辑） */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs text-faint">正文</span>
            <div className="flex items-center gap-2">
              {!emptyChapter && (
                <span className="text-[11px] text-faint">
                  {body.length} 字 · 对话中的 AI 会参考正文，编辑后以最新为准
                </span>
              )}
              {/* Journey ⑧：撤销/重做（会话级 history；栈空 disabled） */}
              <div className="flex items-center gap-1">
                <button
                  onClick={doUndo}
                  disabled={!bodyHist.canUndo}
                  title="撤销 (Ctrl+Z)"
                  aria-label="撤销"
                  className="rounded-lg border border-surface-2 p-1 text-faint transition hover:text-zinc-200 disabled:opacity-30"
                >
                  <ArrowCounterClockwise size={14} aria-hidden />
                </button>
                <button
                  onClick={doRedo}
                  disabled={!bodyHist.canRedo}
                  title="重做 (Ctrl+Shift+Z)"
                  aria-label="重做"
                  className="rounded-lg border border-surface-2 p-1 text-faint transition hover:text-zinc-200 disabled:opacity-30"
                >
                  <ArrowClockwise size={14} aria-hidden />
                </button>
              </div>
            </div>
          </div>
          {errorMsg && (
            <p role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs text-red-400">
              {errorMsg}
            </p>
          )}
          <textarea
            ref={bodyTextareaRef}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            onSelect={onEditorSelect}
            onKeyDown={onBodyKeyDown}
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
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                onClick={() => bodyTextareaRef.current?.focus()}
                disabled={streaming}
                className="flex w-full items-center justify-center gap-2 rounded-card border border-surface-2 bg-surface/60 py-4 text-sm font-medium text-zinc-200 transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
              >
                我自己先写
              </button>
              <button
                onClick={() => void sendChat("根据当前作品设定，为这一章写一个开头", ["章节起笔"])}
                disabled={streaming}
                className="flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-accent/40 bg-accent/5 py-4 text-sm font-medium text-accent transition hover:bg-accent/10 disabled:opacity-40"
              >
                <Sparkle size={16} weight="fill" aria-hidden />
                让 AI 起笔
              </button>
            </div>
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
                      {m.content === "" && (
                        <span className="text-xs text-faint">
                          {subphase === "preparing"
                            ? "正在组织上下文…"
                            : subphase === "finishing"
                              ? "正在保存并检查…"
                              : subphase === "cancelling"
                                ? "正在停止并保留已生成内容…"
                                : "正在生成…"}
                        </span>
                      )}
                      {m.content === "" && (
                        <span className="ml-2 text-[10px] text-zinc-600">
                          已等待 {Math.floor(generationElapsedMs / 1000)} 秒
                        </span>
                      )}
                      <span
                        aria-label="正在生成"
                        className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent"
                      />
                    </>
                  )}
                  {/* 质量门检查摘要（候选确认前可见；存在未通过项时插入会记录覆盖动作） */}
                  {m.role === "assistant" && m.qualityGate && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-surface-2 bg-surface/40 px-3 py-2">
                      <Sparkle size={12} weight="duotone" className="mt-0.5 shrink-0 text-accent" aria-hidden />
                      <p className="text-[11px] leading-4 text-muted">质量门：{m.qualityGate}</p>
                    </div>
                  )}
                  {/* AI 消息操作区 */}
                  {m.role === "assistant" && m.status !== "streaming" && m.status !== "generating" && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-surface-2 pt-2">
                      {m.status === "discarded" ? (
                        <span className="text-xs text-faint">已忽略候选</span>
                      ) : m.status === "error" ? (
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
                          ) : m.confirmSelection ? (
                            // J9 第二层：bound 选区内容已变化（不静默覆盖）
                            <span className="flex flex-wrap items-center gap-2 text-xs text-yellow-400">
                              <Warning size={13} aria-hidden />
                              选中内容已发生变化——AI 是根据之前的选中文字生成的
                              <button
                                onClick={() => forceInsert(m.id)}
                                className="rounded-full border border-current px-2.5 py-0.5 transition hover:bg-current/10"
                              >
                                仍要替换
                              </button>
                              <button
                                onClick={() =>
                                  setMessages((prev) =>
                                    prev.map((x) =>
                                      x.id === m.id ? { ...x, confirmSelection: false } : x,
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
                                {/* J9：有效非空 selection target（blur 不丢）→ 替换选中内容；否则插入正文 */}
                                {insertingId === m.id
                                  ? "插入中…"
                                  : targetRef.current.start !== targetRef.current.end
                                    ? "替换选中内容"
                                    : "插入正文"}
                              </button>
                              {m.status === "stopped" && (
                                <span className="text-[10px] text-faint">
                                  已停止 · 可插入已生成部分
                                </span>
                              )}
                              <button
                                onClick={() => void discardMessage(m.id)}
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
                disabled={streaming}
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
                  disabled={!input.trim() || streaming}
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
