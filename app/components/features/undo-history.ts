// Journey ⑧（V1.2）：正文编辑 Undo / Redo — 方案 A 自定义轻量 history 栈（UI Freeze 文档冻结）。
// 纯逻辑核心（可单测）+ useBodyHistory hook（薄包装，仅负责与 React 状态同步）。
// 语义（冻结规范 §5）：
//   - type()：用户输入。MERGE_MS 窗口内连续输入合并为一层 undo（与 2s 自动保存同窗口，心智一致）；
//   - apply()：程序化变更（AI 插入 / force 插入 / 起笔 / 清空）。始终作为单个原子操作入栈；
//   - undo()/redo()：栈式回退/前进；返回 null 表示不可用；
//   - reset()：加载正文（入栈历史清零）。保存/自动保存**不清栈**（由编辑器在 saveBody 侧维护 lastSaved 比较）。
// 会话级：组件卸载即丢弃（切换章节/刷新/跨设备不保留，冻结规则）。

export const UNDO_MERGE_MS = 2000;

export interface BodyHistory {
  current: string;
  canUndo: boolean;
  canRedo: boolean;
  type(value: string): void;
  apply(value: string): void;
  undo(): string | null;
  redo(): string | null;
  reset(value: string): void;
}

export function createBodyHistory(initial: string, mergeMs = UNDO_MERGE_MS): BodyHistory {
  let current = initial;
  let past: string[] = [];
  let future: string[] = [];
  let lastCommitAt = 0;

  return {
    get current() {
      return current;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },

    /** 用户输入：窗口内连续输入合并为一层；窗口外 push 当前值为栈底 */
    type(value: string) {
      if (value === current) return;
      const now = Date.now();
      if (now - lastCommitAt > mergeMs) {
        past.push(current);
        future = [];
      }
      lastCommitAt = now;
      current = value;
    },

    /** 程序化变更（AI 插入等）：原子一层；并打断输入合并窗口（后续输入从新一层开始） */
    apply(value: string) {
      if (value === current) return;
      past.push(current);
      future = [];
      lastCommitAt = 0;
      current = value;
    },

    undo() {
      const prev = past.pop();
      if (prev === undefined) return null;
      future.push(current);
      lastCommitAt = 0; // undo 后继续输入从新一层开始
      current = prev;
      return prev;
    },

    redo() {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(current);
      lastCommitAt = 0;
      current = next;
      return next;
    },

    reset(value: string) {
      current = value;
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
      get canUndo() {
        return hist.canUndo;
      },
      get canRedo() {
        return hist.canRedo;
      },
      type: (v: string) => {
        hist.type(v);
        bump();
      },
      apply: (v: string) => {
        hist.apply(v);
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
