// Journey ⑧+⑨（V1.2）：正文编辑 Undo / Redo + 光标/选区 — 自定义轻量 history 栈（方案 A 冻结实现）。
// 纯逻辑核心（可单测）+ useBodyHistory hook（薄包装，仅负责与 React 状态同步）。
// 语义（冻结规范）：
//   - type()：用户输入。MERGE_MS 窗口内连续输入合并为一层 undo（与 2s 自动保存同窗口）；
//   - apply()：程序化变更（AI 插入 / 替换 / 起笔 / 清空）。始终作为单个原子操作入栈；
//   - selection 随 history：每层记录操作前的 {content, selection}；undo 恢复操作前状态（含光标/选区），
//     redo 恢复操作后状态。纯 caret 移动（setSelection）不创建 undo entry；
//   - reset()：加载正文（入栈历史清零）。保存/自动保存**不清栈**（由编辑器在 saveBody 侧维护 lastSaved 比较）。
// 会话级：组件卸载即丢弃（切换章节/刷新/跨设备不保留，冻结规则）。

export const UNDO_MERGE_MS = 2000;

export interface SelectionState {
  start: number;
  end: number;
}

interface HistoryEntry {
  content: string;
  selection: SelectionState;
}

export interface BodyHistory {
  current: string;
  selection: SelectionState;
  canUndo: boolean;
  canRedo: boolean;
  /** 纯 caret/选区移动：同步 selection，不创建 undo entry（不因方向键/点击产生历史层） */
  setSelection(sel: SelectionState): void;
  /** 用户输入：窗口内连续输入合并为一层；窗口外 push 当前状态为栈底 */
  type(value: string, sel: SelectionState): void;
  /** 程序化变更（AI 插入/替换等）：原子一层；并打断输入合并窗口 */
  apply(value: string, sel: SelectionState): void;
  /** 撤销：恢复该层操作前的正文 + 光标/选区；无层可撤返回 null */
  undo(): { content: string; selection: SelectionState } | null;
  /** 重做：恢复该层操作后的正文 + 光标/选区；无层可重做返回 null */
  redo(): { content: string; selection: SelectionState } | null;
  reset(value: string): void;
}

export function createBodyHistory(initial: string, mergeMs = UNDO_MERGE_MS): BodyHistory {
  let current = initial;
  let selection: SelectionState = { start: 0, end: 0 };
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  let lastCommitAt = 0;

  return {
    get current() {
      return current;
    },
    get selection() {
      return selection;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },

    setSelection(sel: SelectionState) {
      selection = { ...sel };
    },

    type(value: string, sel: SelectionState) {
      if (value === current) return;
      const now = Date.now();
      if (now - lastCommitAt > mergeMs) {
        past.push({ content: current, selection: { ...selection } });
        future = [];
      }
      lastCommitAt = now;
      current = value;
      selection = { ...sel };
    },

    apply(value: string, sel: SelectionState) {
      if (value === current) return;
      past.push({ content: current, selection: { ...selection } });
      future = [];
      lastCommitAt = 0; // apply 后继续输入从新一层开始
      current = value;
      selection = { ...sel };
    },

    undo() {
      const entry = past.pop();
      if (!entry) return null;
      future.push({ content: current, selection: { ...selection } });
      lastCommitAt = 0;
      current = entry.content;
      selection = { ...entry.selection };
      return { content: current, selection: { ...selection } };
    },

    redo() {
      const entry = future.pop();
      if (!entry) return null;
      past.push({ content: current, selection: { ...selection } });
      lastCommitAt = 0;
      current = entry.content;
      selection = { ...entry.selection };
      return { content: current, selection: { ...selection } };
    },

    reset(value: string) {
      current = value;
      selection = { start: 0, end: 0 };
      past = [];
      future = [];
      lastCommitAt = 0;
    },
  };
}

import { useMemo, useReducer, useState } from "react";

/** React 包装：useState 惰性初始化保证 history 实例稳定；bump 触发重渲。
 * 返回对象 useMemo 稳定（getter 惰性读取 current/canUndo/canRedo），
 * 可安全放入 effect 依赖数组而不会导致每次渲染重跑。 */
export function useBodyHistory(initial: string) {
  const [hist] = useState(() => createBodyHistory(initial));
  const [, bump] = useReducer((n: number) => n + 1, 0);

  return useMemo(
    () => ({
      get body() {
        return hist.current;
      },
      get selection() {
        return hist.selection;
      },
      get canUndo() {
        return hist.canUndo;
      },
      get canRedo() {
        return hist.canRedo;
      },
      setSelection: (sel: SelectionState) => {
        hist.setSelection(sel);
        bump();
      },
      type: (v: string, sel: SelectionState) => {
        hist.type(v, sel);
        bump();
      },
      apply: (v: string, sel: SelectionState) => {
        hist.apply(v, sel);
        bump();
      },
      undo: () => {
        const r = hist.undo();
        if (r !== null) bump();
        return r;
      },
      redo: () => {
        const r = hist.redo();
        if (r !== null) bump();
        return r;
      },
      reset: (v: string) => {
        hist.reset(v);
        bump();
      },
    }),
    [hist, bump],
  );
}
